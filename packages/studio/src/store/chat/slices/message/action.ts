import type { StateCreator } from "zustand";
import { nanoid } from "nanoid";
import type {
  AgentResponse,
  ChatAttachmentPayload,
  ChatSessionKind,
  ChatStore,
  MessageActions,
  SendMessageOptions,
  SessionResponse,
  SessionSummary,
} from "../../types";
import { fetchJson } from "../../../../hooks/use-api";
import { tr } from "../../../../lib/app-language";
import { isConfirmedProductionSend } from "../../message-policy";
import { attachSessionStreamListeners } from "./stream-events";
import {
  bookKey,
  createSessionRuntime,
  deriveResolvedProposals,
  deserializeMessages,
  extractErrorMessage,
  hasAnyInFlightExecution,
  markRunningToolsFailed,
  mergeToolExecution,
  mergeTaskExecution,
  mergeSessionIds,
  updateSession,
  upsertSessionSummary,
  withToolExecutions,
} from "./runtime";

const SKILL_DIRECTIVE_RE = /(^|\s)@([a-z][a-z0-9-]*)(?=\s|$)/gi;

function parseSkillDirectives(text: string): { instruction: string; requestedSkills: string[] } {
  const requestedSkills: string[] = [];
  const seen = new Set<string>();
  const instruction = text.replace(SKILL_DIRECTIVE_RE, (match, prefix: string, rawId: string) => {
    const id = rawId.toLowerCase();
    if (!seen.has(id)) {
      seen.add(id);
      requestedSkills.push(id);
    }
    return prefix;
  }).replace(/\s+/g, " ").trim();
  return { instruction: instruction || text.trim(), requestedSkills };
}

function mergeSkillIds(
  parsed: ReadonlyArray<string>,
  explicit: ReadonlyArray<string> | undefined,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of [...parsed, ...(explicit ?? [])]) {
    const id = value.trim().toLowerCase();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function formatAttachmentSize(size: number): string {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${size} B`;
}

function formatUserMessageForDisplay(text: string, attachments: ReadonlyArray<ChatAttachmentPayload>): string {
  if (attachments.length === 0) return text;
  const heading = tr("Tệp đính kèm: ", "Attachments:");
  const lines = text ? [text, "", heading] : [heading];
  for (const attachment of attachments) {
    lines.push(`- ${attachment.filename} (${attachment.mediaType || "application/octet-stream"}, ${formatAttachmentSize(attachment.size)})`);
  }
  return lines.join("\n");
}

export const createMessageSlice: StateCreator<ChatStore, [], [], MessageActions> = (set, get) => {
  const abortPreviousChatRound = (nextSessionId: string | null): void => {
    const previousSessionId = get().activeSessionId;
    if (!previousSessionId || previousSessionId === nextSessionId) return;
    if (!get().sessions[previousSessionId]?.isChatStreaming) return;
    void get().abortSession(previousSessionId, "chat");
  };

  return {
    activateSession: (sessionId) => {
      abortPreviousChatRound(sessionId);
      set({ activeSessionId: sessionId });
    },

  setSessionPlayMode: (sessionId, playMode) => {
    const session = get().sessions[sessionId];
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, () => ({ playMode })),
    }));
    if (session?.isDraft) return;
    void fetchJson(`/sessions/${sessionId}/play-mode`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playMode }),
    }).catch(() => undefined);
  },

  setInput: (text) => set({ input: text }),

  addUserMessage: (sessionId, content) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (session) => ({
        messages: [...session.messages, { role: "user", content, timestamp: Date.now() }],
        lastError: null,
      })),
    })),

  appendStreamChunk: (sessionId, text, streamTs) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (session) => {
        const last = session.messages[session.messages.length - 1];
        if (last?.timestamp === streamTs && last.role === "assistant") {
          return {
            messages: [...session.messages.slice(0, -1), { ...last, content: last.content + text }],
          };
        }
        return {
          messages: [...session.messages, { role: "assistant", content: text, timestamp: streamTs }],
        };
      }),
    })),

  finalizeStream: (sessionId, streamTs, content, toolCall) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (session) => ({
        messages: session.messages.map((message) => {
          if (message.timestamp !== streamTs || message.role !== "assistant") return message;
          const parts = [...(message.parts ?? [])];
          const lastPart = parts[parts.length - 1];
          if (lastPart?.type === "text") {
            parts[parts.length - 1] = { ...lastPart, content };
          } else if (content) {
            parts.push({ type: "text", content });
          }
          return { ...message, content, toolCall, parts };
        }),
      })),
    })),

  replaceStreamWithError: (sessionId, streamTs, errorMsg) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (session) => {
        const streamMessage = session.messages.find(
          (message) => message.timestamp === streamTs && message.role === "assistant",
        );
        const streamExecutions = [
          ...(streamMessage?.toolExecutions ?? []),
          ...(streamMessage?.parts ?? []).flatMap((part) => (
            part.type === "tool" ? [part.execution] : []
          )),
        ];
        const hasActiveOrFailedTool = streamExecutions.some(
          (execution) => execution.status === "running"
            || execution.status === "processing"
            || execution.status === "error",
        );
        // Mark only running tools in this turn's (streamTs) message as failed:
        // background task cards running in parallel attach to earlier messages, and a
        // chat-turn error does not mean the task failed. isStreaming / stream
        // finalization is left to sendMessage's finally, which checks for running tasks.
        const messages = hasActiveOrFailedTool
          ? session.messages.map((message) => (
              message.timestamp === streamTs && message.role === "assistant"
                ? markRunningToolsFailed([message], errorMsg)[0]!
                : message
            ))
          : [
              ...session.messages.filter(
                (message) => !(message.timestamp === streamTs && message.role === "assistant"),
              ),
              { role: "assistant" as const, content: `\u2717 ${errorMsg}`, timestamp: Date.now() },
            ];
        return {
          messages,
          lastError: errorMsg,
        };
      }),
    })),

  addErrorMessage: (sessionId, errorMsg) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (session) => ({
        messages: [...session.messages, { role: "assistant", content: `\u2717 ${errorMsg}`, timestamp: Date.now() }],
        lastError: errorMsg,
      })),
    })),

  loadSessionMessages: (sessionId, msgs) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session || session.messages.length > 0) return {};
      const messages = deserializeMessages(msgs);
      return {
        sessions: updateSession(state.sessions, sessionId, () => ({ messages })),
        resolvedProposals: {
          ...state.resolvedProposals,
          ...deriveResolvedProposals(messages),
        },
      };
    }),

  setSelectedModel: (model, service) => set({ selectedModel: model, selectedService: service }),

  loadSessionList: async (bookId) => {
    const query = bookId === null ? "null" : encodeURIComponent(bookId);
    try {
      const data = await fetchJson<{ sessions: ReadonlyArray<SessionSummary> }>(`/sessions?bookId=${query}`);
      set((state) => {
        let sessions = state.sessions;
        for (const summary of data.sessions) {
          sessions = upsertSessionSummary(sessions, summary);
        }
        return {
          sessions,
          sessionIdsByBook: {
            ...state.sessionIdsByBook,
            [bookKey(bookId)]: data.sessions.map((session) => session.sessionId),
          },
        };
      });
      return data.sessions;
    } catch {
      return [];
    }
  },

  createSession: async (bookId, sessionKind, playMode) => {
    abortPreviousChatRound(null);
    const data = await fetchJson<SessionResponse>("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookId, sessionKind, playMode }),
    });
    const sessionId = data.session?.sessionId;
    if (!sessionId) {
      throw new Error("Failed to create session");
    }

    set((state) => {
      const runtime = createSessionRuntime({
        sessionId,
        bookId: data.session?.bookId ?? bookId ?? null,
        sessionKind: data.session?.sessionKind ?? sessionKind,
        playMode: data.session?.playMode,
        title: data.session?.title ?? null,
      });
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: runtime,
        },
        sessionIdsByBook: {
          ...state.sessionIdsByBook,
          [bookKey(runtime.bookId)]: mergeSessionIds(
            state.sessionIdsByBook[bookKey(runtime.bookId)],
            [sessionId],
          ),
        },
        activeSessionId: sessionId,
      };
    });

    return sessionId;
  },

  createDraftSession: (bookId, sessionKind, playMode) => {
    abortPreviousChatRound(null);
    // The client generates the sessionId (same format as createBookSession); it is
    // not persisted to disk yet and not added to sessionIdsByBook, so the sidebar
    // cannot see this draft. When the first message is sent, sendMessage calls
    // POST /sessions { sessionId, bookId } to persist it and appends the id to
    // sessionIdsByBook - only then does the session (with its title) appear.
    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set((state) => {
      const runtime = createSessionRuntime({
        sessionId,
        bookId,
        sessionKind,
        playMode,
        title: null,
        isDraft: true,
      });
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: runtime,
        },
        activeSessionId: sessionId,
      };
    });
    return sessionId;
  },

  renameSession: async (sessionId, title) => {
    const previous = get().sessions[sessionId]?.title ?? null;
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, () => ({ title })),
    }));

    try {
      await fetchJson(`/sessions/${sessionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
    } catch {
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, () => ({ title: previous })),
      }));
    }
  },

  deleteSession: async (sessionId) => {
    const session = get().sessions[sessionId];
    session?.stream?.close();
    // Draft session not yet on disk: skip the DELETE request to avoid a 404 from the backend
    if (session && !session.isDraft) {
      try {
        await fetchJson(`/sessions/${sessionId}`, { method: "DELETE" });
      } catch {
        // ignore
      }
    }

    set((state) => {
      const { [sessionId]: deleted, ...rest } = state.sessions;
      const sessionIdsByBook = Object.fromEntries(
        Object.entries(state.sessionIdsByBook).map(([key, ids]) => [
          key,
          ids.filter((id) => id !== sessionId),
        ]),
      );

      let activeSessionId = state.activeSessionId;
      if (activeSessionId === sessionId) {
        const fallbackKey = bookKey(session?.bookId ?? null);
        activeSessionId = sessionIdsByBook[fallbackKey]?.[0] ?? null;
      }

      return {
        sessions: rest,
        sessionIdsByBook,
        activeSessionId,
      };
    });
  },

  abortSession: async (sessionId, scope = "all") => {
    const session = get().sessions[sessionId];
    const stoppedAt = Date.now();
    const stoppedMessage = tr("Người dùng đã dừng", "Stopped by user");
    const chatOnly = scope === "chat";
    const messages = markRunningToolsFailed(
      session?.messages ?? [],
      stoppedMessage,
      stoppedAt,
      (execution) => !chatOnly || execution.background !== true,
    );
    const keepProductionStream = chatOnly && hasAnyInFlightExecution(messages);
    if (!keepProductionStream) session?.stream?.close();
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (runtime) => ({
        isStreaming: keepProductionStream,
        isChatStreaming: false,
        stream: keepProductionStream ? runtime.stream : null,
        lastError: null,
        messages,
      })),
    }));
    try {
      await fetchJson(`/sessions/${sessionId}/abort${chatOnly ? "?scope=chat" : ""}`, {
        method: "POST",
      });
    } catch (error) {
      get().addErrorMessage(sessionId, error instanceof Error ? error.message : String(error));
    }
  },

  loadSessionDetail: async (sessionId) => {
    // Draft session: no file on disk yet, skip the remote fetch.
    const existing = get().sessions[sessionId];
    if (existing?.isDraft) return;
    if (existing?.isStreaming && existing.stream) return;

    try {
      const data = await fetchJson<SessionResponse>(`/sessions/${sessionId}`);
      const detail = data.session;
      if (!detail?.sessionId) return;
      const detailSessionId = detail.sessionId;
      const persistedMessages = detail.messages ? deserializeMessages(detail.messages) : [];
      const task = data.task;
      const taskRunning = task?.execution.status === "running" || task?.execution.status === "processing";
      let restoredMessages: ReadonlyArray<ReturnType<typeof deserializeMessages>[number]> = persistedMessages;
      if (task) restoredMessages = mergeTaskExecution(restoredMessages, task.execution);
      const messages = restoredMessages;
      const restoredResolutions = deriveResolvedProposals(messages);

      set((state) => {
        const runtime = state.sessions[detailSessionId];
        const nextBookId = detail.bookId ?? runtime?.bookId ?? null;
        const baseMessages = runtime?.messages.length ? runtime.messages : messages;
        const nextMessages = task ? mergeTaskExecution(baseMessages, task.execution) : baseMessages;
        return {
          sessions: {
            ...state.sessions,
            [detailSessionId]: {
              ...(runtime ?? createSessionRuntime({
                sessionId: detailSessionId,
                bookId: nextBookId,
                sessionKind: detail.sessionKind,
                playMode: detail.playMode,
                title: detail.title ?? null,
              })),
              bookId: nextBookId,
              sessionKind: detail.sessionKind ?? runtime?.sessionKind,
              playMode: detail.playMode ?? runtime?.playMode,
              title: detail.title ?? runtime?.title ?? null,
              messages: nextMessages,
              isStreaming: taskRunning,
            },
          },
          sessionIdsByBook: {
            ...state.sessionIdsByBook,
            [bookKey(nextBookId)]: mergeSessionIds(
              state.sessionIdsByBook[bookKey(nextBookId)],
              [detailSessionId],
            ),
          },
          resolvedProposals: {
            ...state.resolvedProposals,
            ...restoredResolutions,
          },
        };
      });

      if (taskRunning && task) {
        const current = get().sessions[detailSessionId];
        current?.stream?.close();
        const streamEs = new EventSource(`/api/v1/events?sessionId=${encodeURIComponent(detailSessionId)}`);
        set((state) => ({
          sessions: updateSession(state.sessions, detailSessionId, () => ({ stream: streamEs, isStreaming: true })),
        }));
        attachSessionStreamListeners({
          sessionId: detailSessionId,
          streamTs: task.execution.startedAt,
          streamEs,
          set,
          get,
        });
      }
    } catch {
      // ignore
    }
  },

  sendMessage: async (sessionId, text, options?: SendMessageOptions) => {
    const trimmed = text.trim();
    const attachments = options?.attachments ?? [];
    const session = get().sessions[sessionId];
    // Only block while a chat turn is streaming: during background production
    // tasks (isStreaming=true but isChatStreaming=false) sending messages stays
    // allowed, so chat and task run in parallel.
    if ((!trimmed && attachments.length === 0) || !session || session.isChatStreaming) return;
    const userInstruction = trimmed || tr("Vui lòng đọc các tệp tôi đã tải lên.", "Please read the files I uploaded.");
    const activeBookId = options?.activeBookId ?? session.bookId ?? undefined;
    const sessionKind: ChatSessionKind = options?.sessionKind
      ?? session.sessionKind
      ?? (activeBookId ? "book" : "chat");
    const actionSource = options?.actionSource ?? "free-text";
    const playMode = options?.playMode ?? session.playMode;
    // The send turn of a confirmed production task is not a "chat turn": the
    // request stays pending until the task ends while the user can keep chatting,
    // so isChatStreaming is not set.
    const isProductionTaskSend = isConfirmedProductionSend(actionSource, options?.requestedIntent);
    // On chat-turn failure, record the original send parameters (text + options)
    // so the "Retry" button can resend them in one click. Production task turns are
    // not recorded: task failures are shown by the task card itself; retry only
    // covers chat turns.
    const rememberFailedSend = () => {
      if (isProductionTaskSend) return;
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, () => ({
          lastFailedSend: options ? { text, options } : { text },
        })),
      }));
    };

    if (!get().selectedModel) {
      get().addUserMessage(sessionId, formatUserMessageForDisplay(userInstruction, attachments));
      get().addErrorMessage(sessionId, tr("Vui lòng chọn một mô hình trước", "Select a model first"));
      rememberFailedSend();
      return;
    }

    // Draft session: the session file is written to disk only when the first
    // message is sent. The backend POST /sessions accepts a client-provided
    // sessionId, so the id stays consistent and the runtime in the store needs no
    // remount - just flip isDraft to false.
    if (session.isDraft) {
      try {
        await fetchJson<SessionResponse>("/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, bookId: session.bookId, sessionKind, playMode }),
        });
        // Persisted: flip isDraft to false and append the sessionId to
        // sessionIdsByBook so the sidebar sees the session only now.
        set((state) => ({
          sessions: updateSession(state.sessions, sessionId, () => ({ isDraft: false, sessionKind, playMode })),
          sessionIdsByBook: {
            ...state.sessionIdsByBook,
            [bookKey(session.bookId)]: mergeSessionIds(
              state.sessionIdsByBook[bookKey(session.bookId)],
              [sessionId],
            ),
          },
        }));
      } catch (err) {
        get().addErrorMessage(sessionId, err instanceof Error ? err.message : String(err));
        rememberFailedSend();
        return;
      }
    }

    const skillDirectives = parseSkillDirectives(userInstruction);
    const instruction = skillDirectives.instruction;
    const requestedSkills = mergeSkillIds(skillDirectives.requestedSkills, options?.requestedSkills);
    const disabledSkills = mergeSkillIds([], options?.disabledSkills);
    const streamTs = Date.now() + 1;
    const sourceRequestId = nanoid();

    set((state) => ({
      input: "",
      activeSessionId: sessionId,
      sessions: updateSession(state.sessions, sessionId, () => ({
        isStreaming: true,
        isChatStreaming: !isProductionTaskSend,
        lastError: null,
        // Clear the previous failure record as soon as a new send starts: if this
        // turn fails it will be recorded again; if it succeeds the conversation moved
        // on and the old retry entry is dropped.
        lastFailedSend: undefined,
      })),
    }));

    get().addUserMessage(sessionId, formatUserMessageForDisplay(userInstruction, attachments));
    // Single-connection principle: close old connections (e.g. a task recovery
    // stream) and switch to this turn's new connection. Running task cards are
    // unaffected - on connect the server replays running snapshots, and task logs
    // and finalization match by execution id, independent of streamTs.
    session.stream?.close();
    const streamEs = new EventSource(`/api/v1/events?sessionId=${encodeURIComponent(sessionId)}`);
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, () => ({ stream: streamEs })),
    }));
    attachSessionStreamListeners({ sessionId, streamTs, sourceRequestId, streamEs, set, get });

    try {
      const data = await fetchJson<AgentResponse>("/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruction,
          activeBookId,
          sessionKind,
          playMode,
          actionSource,
          requestedIntent: options?.requestedIntent,
          actionPayload: options?.actionPayload,
          requestedSkills,
          disabledSkills,
          attachments,
          sessionId,
          clientRequestId: sourceRequestId,
          model: get().selectedModel ?? undefined,
          service: get().selectedService ?? undefined,
        }),
      });

      const finalContent = data.details?.draftRaw || data.response || "";
      const toolCall = data.details?.toolCall ?? undefined;
      const responseToolExecutions = data.details?.toolExecutions ?? [];
      const responseBookId = data.session?.activeBookId ?? data.session?.bookId;
      const responseSessionKind = data.session?.sessionKind;
      if (responseBookId || responseSessionKind || data.session?.title || data.session?.playMode) {
        set((state) => {
          const runtime = state.sessions[sessionId];
          if (!runtime) return {};
          const nextBookId = responseBookId ?? runtime.bookId;
          return {
            sessions: updateSession(state.sessions, sessionId, () => ({
              bookId: nextBookId,
              sessionKind: responseSessionKind ?? runtime.sessionKind,
              playMode: data.session?.playMode ?? runtime.playMode,
              title: data.session?.title ?? runtime.title,
            })),
            sessionIdsByBook: {
              ...state.sessionIdsByBook,
              [bookKey(nextBookId)]: mergeSessionIds(
                state.sessionIdsByBook[bookKey(nextBookId)],
                [sessionId],
              ),
            },
          };
        });
      }
      const hasStream = Boolean(
        get().sessions[sessionId]?.messages.some((message) => message.timestamp === streamTs),
      );
      const attachResponseTools = () => {
        if (responseToolExecutions.length === 0) return;
        set((state) => ({
          sessions: updateSession(state.sessions, sessionId, (runtime) => ({
            messages: responseToolExecutions.reduce<ReadonlyArray<(typeof runtime.messages)[number]>>(
              (messages, execution) => mergeToolExecution(messages, execution),
              runtime.messages,
            ),
          })),
        }));
      };

      if (data.error) {
        const errorMessage = extractErrorMessage(data.error);
        if (hasStream) {
          get().replaceStreamWithError(sessionId, streamTs, errorMessage);
        } else {
          get().addErrorMessage(sessionId, errorMessage);
        }
        // A user-initiated mid-turn stop (abortSession) flips isChatStreaming to
        // false first: that is not a failure, so no retry record.
        if (get().sessions[sessionId]?.isChatStreaming) rememberFailedSend();
      } else if (finalContent) {
        if (hasStream) {
          get().finalizeStream(sessionId, streamTs, finalContent, toolCall);
          attachResponseTools();
        } else {
          const message = withToolExecutions({
            role: "assistant",
            content: finalContent,
            timestamp: Date.now(),
            toolCall,
          }, responseToolExecutions);
          set((state) => ({
            sessions: updateSession(state.sessions, sessionId, (runtime) => ({
              messages: [
                ...runtime.messages,
                message,
              ],
            })),
          }));
        }
      } else if (responseToolExecutions.length > 0) {
        if (hasStream) {
          get().finalizeStream(sessionId, streamTs, "", toolCall);
          attachResponseTools();
        } else {
          // A confirmed production task can be restored from task:snapshot before
          // tool:start arrives. That card uses the server-side startedAt timestamp,
          // not this request's streamTs, so hasStream is false even though the same
          // execution is already visible. Always merge by execution id here: it
          // updates the restored card, or appends one when no SSE event was observed.
          attachResponseTools();
        }
      } else {
        if (hasStream) {
          get().finalizeStream(sessionId, streamTs, "", toolCall);
        } else {
          const emptyMessage = tr(
            "Mô hình không trả về nội dung văn bản. Vui lòng kiểm tra loại giao thức (chat/responses), công tắc stream hoặc tính tương thích của dịch vụ thượng nguồn.",
            "The model returned no text. Check the protocol type (chat/responses), the streaming toggle, or upstream service compatibility.",
          );
          get().addErrorMessage(sessionId, emptyMessage);
          // An empty response also fails this turn; user-stopped turns already have
          // isChatStreaming=false and are not recorded.
          if (get().sessions[sessionId]?.isChatStreaming) rememberFailedSend();
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // A user stop flips isChatStreaming to false before the aborted request
      // rejects here: not a failure, no retry record; a genuine request failure has
      // isChatStreaming still true at this point.
      if (get().sessions[sessionId]?.isChatStreaming) rememberFailedSend();
      const failureAlreadyShown = get().sessions[sessionId]?.messages.some((message) => {
        const executions = [
          ...(message.toolExecutions ?? []),
          ...(message.parts ?? []).flatMap((part) => (
            part.type === "tool" ? [part.execution] : []
          )),
        ];
        return executions.some(
          (execution) => execution.status === "error"
            && (execution.completedAt ?? 0) >= streamTs,
        );
      }) ?? false;
      if (failureAlreadyShown) return;
      const hasStream = Boolean(
        get().sessions[sessionId]?.messages.some((message) => message.timestamp === streamTs),
      );
      if (hasStream) {
        get().replaceStreamWithError(sessionId, streamTs, errorMessage);
      } else {
        get().addErrorMessage(sessionId, errorMessage);
      }
    } finally {
      // This turn's request ended (success or error both land here). Finalize only
      // when the session's connection still belongs to this turn: if a new message
      // replaced the old connection (stream points at a newer turn), that turn owns
      // the subsequent state.
      const runtime = get().sessions[sessionId];
      if (runtime && (runtime.stream === streamEs || runtime.stream === null)) {
        // A production task is still running: keep the connection and isStreaming;
        // stream-events finalizes when the task's own final events arrive
        // (tool:end -> agent:complete).
        const taskInFlight = hasAnyInFlightExecution(runtime.messages);
        if (!taskInFlight) streamEs.close();
        set((state) => ({
          sessions: updateSession(state.sessions, sessionId, () => ({
            isChatStreaming: false,
            isStreaming: taskInFlight,
            stream: taskInFlight ? streamEs : null,
          })),
        }));
      }
    }
  },

  retryLastSend: async (sessionId) => {
    const session = get().sessions[sessionId];
    const failed = session?.lastFailedSend;
    if (!session || !failed || session.isChatStreaming) return;
    // Clear the record before resending: on a double click the second invocation
    // finds no record and returns early, avoiding a duplicate send.
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, () => ({ lastFailedSend: undefined })),
    }));
    await get().sendMessage(sessionId, failed.text, failed.options);
    },
  };
};
