import type { StateCreator } from "zustand";
import type { ChatStore, Message, MessageActions, MessagePart, PipelineStage, ToolExecution } from "../../types";
import { shouldRefreshSidebarForTool } from "../../message-policy";
import { tr } from "../../../../lib/app-language";
import {
  deriveFlat,
  extractToolDetails,
  extractToolError,
  findRunningToolPart,
  getOrCreateStream,
  hasAnyInFlightExecution,
  hasInFlightExecution,
  mergeTaskExecution,
  replaceLast,
  resolveToolLabel,
  sessionMatchesEvent,
  summarizeResult,
  updateSession,
  updateToolPartById,
} from "./runtime";

type SliceSet = Parameters<StateCreator<ChatStore, [], [], MessageActions>>[0];
type SliceGet = Parameters<StateCreator<ChatStore, [], [], MessageActions>>[1];

type ContextCompressionCategory = "session_context" | "story_context";
type ContextCompressionPhase = "start" | "end" | "error";

interface ContextCompressionEventPayload {
  readonly sessionId?: string;
  readonly executionId?: string;
  readonly category?: ContextCompressionCategory;
  readonly phase?: ContextCompressionPhase;
  readonly message?: string;
  readonly protectedTokens?: number;
  readonly compressibleTokens?: number;
  readonly budgetTokens?: number;
  readonly sources?: readonly string[];
}

interface AttachSessionStreamListenersInput {
  sessionId: string;
  streamTs: number;
  sourceRequestId?: string;
  streamEs: EventSource;
  set: SliceSet;
  get: SliceGet;
}

export const STREAM_TEXT_FLUSH_MS = 48;
export const TOOL_PROGRESS_FLUSH_MS = 750;
export const MAX_TOOL_LOGS = 80;

export type StreamTextDelta =
  | { kind: "thinking"; text: string }
  | { kind: "text"; text: string };

interface StreamProgressEventData {
  readonly status?: string;
  readonly elapsedMs: number;
  readonly totalChars: number;
  readonly chineseChars: number;
}

interface ProgressThrottle {
  enqueue(event: StreamProgressEventData): void;
  flush(): void;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Execution id attached by the server to background production task progress events; chat-turn events have none. */
function eventExecutionId(data: unknown): string | undefined {
  const executionId = (data as { executionId?: unknown } | null)?.executionId;
  return typeof executionId === "string" && executionId ? executionId : undefined;
}

export function applyStreamTextDeltas(
  parts: ReadonlyArray<MessagePart>,
  deltas: ReadonlyArray<StreamTextDelta>,
): MessagePart[] {
  const next = [...parts];

  for (const delta of deltas) {
    if (!delta.text) continue;

    if (delta.kind === "thinking") {
      const last = next[next.length - 1];
      if (last?.type === "thinking") {
        next[next.length - 1] = { ...last, content: last.content + delta.text };
      }
      continue;
    }

    const last = next[next.length - 1];
    if (last?.type === "text") {
      next[next.length - 1] = { ...last, content: last.content + delta.text };
    } else {
      next.push({ type: "text", content: delta.text });
    }
  }

  return next;
}

export function appendBoundedToolLogs(
  existing: ReadonlyArray<string> | undefined,
  incoming: ReadonlyArray<string>,
): string[] {
  return [...(existing ?? []), ...incoming].slice(-MAX_TOOL_LOGS);
}

/**
 * Find the most recent running chat-turn tool card (reverse order); skip
 * background task cards flagged with background. Fallback events without an id
 * belong to the chat turn only - applying them to a task card would mix chat
 * logs into the task.
 */
function findRunningChatToolPart(
  parts: ReadonlyArray<MessagePart>,
): (MessagePart & { type: "tool" }) | undefined {
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const part = parts[i]!;
    if (part.type === "tool" && part.execution.status === "running" && !part.execution.background) {
      return part;
    }
  }
  return undefined;
}

/**
 * Scan messages in reverse for the latest still-running chat-turn tool card and
 * update it. When a task runs in parallel with chat, background task cards
 * (execution.background) are skipped - id-less fallback events never belong to
 * a task. If no card can host the update, return null and drop the event (task
 * snapshot replay brings back the task's own accumulated logs, so nothing is
 * lost). update returning null means the card needs no change (treated as no-op).
 */
export function updateLatestRunningToolMessage(
  messages: ReadonlyArray<Message>,
  update: (execution: ToolExecution) => ToolExecution | null,
): ReadonlyArray<Message> | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!;
    const running = findRunningChatToolPart(message.parts ?? []);
    if (!running) continue;
    const updated = update(running.execution);
    if (!updated) return null;
    const parts = (message.parts ?? []).map((part) => (
      part.type === "tool" && part.execution.id === running.execution.id
        ? { type: "tool" as const, execution: updated }
        : part
    ));
    return [
      ...messages.slice(0, i),
      { ...message, ...deriveFlat(parts), parts },
      ...messages.slice(i + 1),
    ];
  }
  return null;
}

export function createStreamTextDeltaBatcher(
  flushDeltas: (deltas: StreamTextDelta[]) => void,
  delayMs = STREAM_TEXT_FLUSH_MS,
): { enqueue: (delta: StreamTextDelta) => void; flush: () => void } {
  let pending: StreamTextDelta[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  const flush = () => {
    clearTimer();
    if (pending.length === 0) return;
    const deltas = pending;
    pending = [];
    flushDeltas(deltas);
  };

  const schedule = () => {
    if (timer !== null) return;
    timer = setTimeout(flush, delayMs);
  };

  return {
    enqueue(delta) {
      pending.push(delta);
      schedule();
    },
    flush,
  };
}

export function createLatestEventThrottle<T>(
  publishLatest: (event: T) => void,
  intervalMs = TOOL_PROGRESS_FLUSH_MS,
): { enqueue: (event: T) => void; flush: () => void } {
  let latest: T | undefined;
  let hasLatest = false;
  let lastPublishedAt: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  const publishNow = (event: T) => {
    lastPublishedAt = Date.now();
    publishLatest(event);
  };

  const flush = () => {
    clearTimer();
    if (!hasLatest) return;
    const event = latest as T;
    latest = undefined;
    hasLatest = false;
    publishNow(event);
  };

  const schedule = () => {
    if (timer !== null) return;
    const elapsed = lastPublishedAt === null ? intervalMs : Date.now() - lastPublishedAt;
    const delay = Math.max(0, intervalMs - elapsed);
    timer = setTimeout(flush, delay);
  };

  return {
    enqueue(event) {
      if (lastPublishedAt === null) {
        publishNow(event);
        return;
      }

      latest = event;
      hasLatest = true;

      if (Date.now() - lastPublishedAt >= intervalMs) {
        flush();
      } else {
        schedule();
      }
    },
    flush,
  };
}

export function attachSessionStreamListeners({
  sessionId,
  streamTs,
  sourceRequestId,
  streamEs,
  set,
  get,
}: AttachSessionStreamListenersInput): void {
  const textDeltaBatcher = createStreamTextDeltaBatcher((deltas) => {
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (runtime) => {
        const [messages, stream] = getOrCreateStream(runtime.messages, streamTs);
        const parts = applyStreamTextDeltas(stream.parts ?? [], deltas);
        const flat = deriveFlat(parts);
        return { messages: replaceLast(messages, { ...stream, ...flat, parts }) };
      }),
    }));
  });

  const flushTextDeltas = () => textDeltaBatcher.flush();

  const applyStageProgress = (execution: ToolExecution, data: StreamProgressEventData): ToolExecution => ({
    ...execution,
    stages: execution.stages?.map((stage) =>
      stage.status === "active"
        ? {
            ...stage,
            progress: {
              status: data.status,
              elapsedMs: data.elapsedMs,
              totalChars: data.totalChars,
              chineseChars: data.chineseChars,
            },
          }
        : stage,
    ),
  });

  // Route llm:progress by the executionId carried in the event: id-bearing events
  // (background production tasks) locate their tool card precisely; id-less ones
  // keep the "most recent running card" fallback (chat-turn tools and legacy
  // events). Each id gets its own throttler so parallel task/chat progress never
  // overwrite each other inside a single "keep latest event" throttle.
  const progressThrottles = new Map<string, ProgressThrottle>();
  const progressThrottleFor = (executionId: string | undefined): ProgressThrottle => {
    const key = executionId ?? "";
    const existing = progressThrottles.get(key);
    if (existing) return existing;
    const throttle = createLatestEventThrottle<StreamProgressEventData>((data) => {
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, (runtime) => {
          const messages = executionId
            ? updateToolPartById(runtime.messages, executionId, (execution) => (
                execution.stages ? applyStageProgress(execution, data) : execution
              ))
            : updateLatestRunningToolMessage(runtime.messages, (execution) => (
                execution.stages ? applyStageProgress(execution, data) : null
              ));
          return messages ? { messages } : {};
        }),
      }));
    });
    progressThrottles.set(key, throttle);
    return throttle;
  };
  const flushProgressThrottles = () => {
    for (const throttle of progressThrottles.values()) throttle.flush();
  };

  streamEs.addEventListener("draft:complete", flushTextDeltas);
  streamEs.addEventListener("draft:error", flushTextDeltas);

  // agent:complete / agent:error / agent:aborted all signal "some request turn
  // ended", but the event cannot tell a chat turn from a background task turn
  // (they share a sessionId):
  // - While the chat turn is in flight (isChatStreaming=true) the connection must
  //   stay open - the event may belong to the chat turn itself (sendMessage's
  //   finally finalizes it) or to the background task (chat continues);
  // - Once the chat turn ended, the connection must stay while any in-flight task
  //   card remains, and close only after the task's own final events arrive
  //   (tool:end -> agent:complete).
  const finishSessionStream = (event: MessageEvent) => {
    try {
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data)) return;
      flushTextDeltas();
      flushProgressThrottles();
      const runtime = get().sessions[sessionId];
      if (!runtime || runtime.isChatStreaming) return;
      if (hasAnyInFlightExecution(runtime.messages)) return;
      streamEs.close();
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, () => ({
          isStreaming: false,
          stream: null,
        })),
      }));
    } catch {
      // ignore
    }
  };
  streamEs.addEventListener("agent:complete", finishSessionStream);
  streamEs.addEventListener("agent:error", finishSessionStream);

  streamEs.addEventListener("task:snapshot", (event: MessageEvent) => {
    try {
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data) || !data?.execution) return;
      const execution = data.execution as ToolExecution;
      const running = execution.status === "running" || execution.status === "processing";
      // EventSource may connect after the production task has already started, so its
      // real-time tool:start broadcast is missed and only this snapshot is replayed.
      // A task started during this request needs the same task-round reclassification;
      // an older task is parallel background work and must not interrupt the new chat.
      const startedByCurrentRequest = running
        && typeof sourceRequestId === "string"
        && data.sourceRequestId === sourceRequestId;
      // The server replays the session's task snapshots on every SSE connect. A
      // final snapshot is only used to finalize a task card that is genuinely still
      // running (page-refresh recovery); if this session is not tracking the task,
      // it is a leftover snapshot of an already-finished task - ignore it, or it
      // would close the newly established stream and lose all subsequent live events.
      if (!running && !hasInFlightExecution(get().sessions[sessionId]?.messages ?? [], execution.id)) {
        return;
      }
      // Final snapshot received while the chat turn is streaming (task just ended,
      // server replayed on new connection): finalize only the task card; keep the
      // connection and streaming state untouched and let the chat turn finish
      // itself - otherwise the running chat stream would be closed and this
      // turn's deltas lost.
      const chatStreaming = Boolean(get().sessions[sessionId]?.isChatStreaming);
      const keepStream = running || chatStreaming;
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, (runtime) => ({
          messages: mergeTaskExecution(runtime.messages, execution),
          isStreaming: keepStream,
          ...(startedByCurrentRequest && runtime.isChatStreaming ? { isChatStreaming: false } : {}),
          stream: keepStream ? runtime.stream : null,
        })),
      }));
      if (!keepStream) streamEs.close();
    } catch {
      // ignore
    }
  });

  streamEs.addEventListener("agent:aborted", finishSessionStream);

  streamEs.addEventListener("thinking:start", (event: MessageEvent) => {
    try {
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data)) return;
      flushTextDeltas();
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, (runtime) => {
          const [messages, stream] = getOrCreateStream(runtime.messages, streamTs);
          const parts = [...(stream.parts ?? []), { type: "thinking" as const, content: "", streaming: true }];
          const flat = deriveFlat(parts);
          return { messages: replaceLast(messages, { ...stream, ...flat, parts }) };
        }),
      }));
    } catch {
      // ignore
    }
  });

  streamEs.addEventListener("thinking:delta", (event: MessageEvent) => {
    try {
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data) || !data?.text) return;
      textDeltaBatcher.enqueue({ kind: "thinking", text: data.text as string });
    } catch {
      // ignore
    }
  });

  streamEs.addEventListener("thinking:end", (event: MessageEvent) => {
    try {
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data)) return;
      flushTextDeltas();
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, (runtime) => {
          const [messages, stream] = getOrCreateStream(runtime.messages, streamTs);
          const parts = [...(stream.parts ?? [])];
          const last = parts[parts.length - 1];
          if (last?.type === "thinking") {
            parts[parts.length - 1] = { ...last, streaming: false };
          }
          const flat = deriveFlat(parts);
          return { messages: replaceLast(messages, { ...stream, ...flat, parts }) };
        }),
      }));
    } catch {
      // ignore
    }
  });

  streamEs.addEventListener("draft:delta", (event: MessageEvent) => {
    try {
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data) || !data?.text) return;
      textDeltaBatcher.enqueue({ kind: "text", text: data.text as string });
    } catch {
      // ignore
    }
  });

  streamEs.addEventListener("tool:start", (event: MessageEvent) => {
    try {
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data) || !data?.tool) return;
      // The server sends background: true on tool:start for confirmed production
      // tasks. When free text hit the server's write-chapter heuristic, the client
      // treated this turn as a chat turn (isChatStreaming=true) at send time; this
      // flag means it actually runs as a background task and must be reclassified:
      // isChatStreaming -> false (so the stop button uses scope=all to get the task
      // controller, and the user can keep chatting), isStreaming stays true (task
      // running). sendMessage's finally finalizes based on remaining tasks.
      const background = data.background === true;
      const belongsToCurrentRequest = typeof sourceRequestId === "string"
        && data.sourceRequestId === sourceRequestId;
      flushTextDeltas();
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, (runtime) => {
          const executionId = data.id as string;
          const alreadyTracked = runtime.messages.some((message) => (
            message.toolExecutions?.some((execution) => execution.id === executionId)
            || message.parts?.some((part) => part.type === "tool" && part.execution.id === executionId)
          ));
          if (alreadyTracked) {
            return background && belongsToCurrentRequest && runtime.isChatStreaming
              ? { isChatStreaming: false }
              : {};
          }
          const [messages, stream] = getOrCreateStream(runtime.messages, streamTs);
          const parts = [...(stream.parts ?? [])];

          if (data.tool === "sub_agent") {
            const last = parts[parts.length - 1];
            if (last?.type === "text" && last.content) {
              parts.pop();
              const prev = parts[parts.length - 1];
              if (prev?.type === "thinking") {
                parts[parts.length - 1] = {
                  ...prev,
                  content: prev.content + (prev.content ? "\n\n" : "") + last.content,
                };
              } else {
                parts.push({ type: "thinking", content: last.content, streaming: false });
              }
            }
          }

          const agent = data.tool === "sub_agent" ? (data.args?.agent as string | undefined) : undefined;
          const stages: PipelineStage[] | undefined = Array.isArray(data.stages) && data.stages.length > 0
            ? (data.stages as string[]).map((label) => ({ label, status: "pending" as const }))
            : undefined;

          parts.push({
            type: "tool",
            execution: {
              id: executionId,
              tool: data.tool as string,
              agent,
              label: resolveToolLabel(data.tool as string, agent),
              status: "running",
              args: data.args as Record<string, unknown> | undefined,
              stages,
              startedAt: Date.now(),
              ...(background ? { background: true } : {}),
            },
          });

          const flat = deriveFlat(parts);
          return {
            messages: replaceLast(messages, { ...stream, ...flat, parts }),
            ...(background && belongsToCurrentRequest && runtime.isChatStreaming
              ? { isChatStreaming: false }
              : {}),
          };
        }),
      }));
    } catch {
      // ignore
    }
  });

  streamEs.addEventListener("tool:end", (event: MessageEvent) => {
    try {
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data) || !data?.tool) return;
      flushTextDeltas();
      flushProgressThrottles();
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, (runtime) => {
          // Locate by execution id across all messages: with parallel chat the task card sits in an earlier message.
          const messages = updateToolPartById(runtime.messages, data.id as string, (previous) => {
            const execution = { ...previous };
            execution.status = data.isError ? "error" : "completed";
            execution.completedAt = Date.now();
            execution.stages = execution.stages?.map((stage) =>
              stage.status !== "completed"
                ? { ...stage, status: "completed" as const, progress: undefined }
                : stage,
            );
            if (data.isError) execution.error = extractToolError(data.result);
            else execution.result = summarizeResult(data.result);
            const details = data.details ?? extractToolDetails(data.result);
            if (details !== undefined) execution.details = details;
            return execution;
          });
          return messages ? { messages } : {};
        }),
      }));

      if (shouldRefreshSidebarForTool(data.tool as string)) {
        get().bumpBookDataVersion();
      }
    } catch {
      // ignore
    }
  });

  streamEs.addEventListener("log", (event: MessageEvent) => {
    try {
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data)) return;
      const message = data?.message as string | undefined;
      if (!message) return;
      const executionId = eventExecutionId(data);
      flushTextDeltas();
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, (runtime) => {
          const appendLog = (execution: ToolExecution): ToolExecution => ({
            ...execution,
            logs: appendBoundedToolLogs(execution.logs, [message]),
          });
          // Logs with an executionId (background production tasks) locate their card
          // by id; if the card has not appeared yet, drop the entry (task snapshot
          // replay brings back the accumulated logs). Never fall back to "most recent
          // running card" - that would mix task logs into a parallel chat-turn card.
          const messages = executionId
            ? updateToolPartById(runtime.messages, executionId, appendLog)
            : updateLatestRunningToolMessage(runtime.messages, appendLog);
          return messages ? { messages } : {};
        }),
      }));
    } catch {
      // ignore
    }
  });

  streamEs.addEventListener("llm:progress", (event: MessageEvent) => {
    try {
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data)) return;
      flushTextDeltas();
      progressThrottleFor(eventExecutionId(data)).enqueue({
        status: typeof data.status === "string" ? data.status : undefined,
        elapsedMs: numberOrZero(data.elapsedMs),
        totalChars: numberOrZero(data.totalChars),
        chineseChars: numberOrZero(data.chineseChars),
      });
    } catch {
      // ignore
    }
  });

  streamEs.addEventListener("context:compression", (event: MessageEvent) => {
    try {
      const data = event.data ? JSON.parse(event.data) as ContextCompressionEventPayload : null;
      if (!sessionMatchesEvent(sessionId, data) || !data?.category || !data.phase) return;
      const category = data.category;
      const phase = data.phase;
      const executionId = eventExecutionId(data);
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, (runtime) => {
          // Compression events with an executionId (background production pipeline):
          // attach as a stage to the matching task card; drop when the card is
          // missing (snapshot replay restores state). Never write into the chat
          // stream - in parallel runs that would leak task state into the chat turn.
          if (executionId) {
            const messages = updateToolPartById(runtime.messages, executionId, (execution) =>
              applyContextCompressionToExecution(execution, category, phase, data),
            );
            return messages ? { messages } : {};
          }
          const [messages, stream] = getOrCreateStream(runtime.messages, streamTs);
          const parts = [...(stream.parts ?? [])];
          applyContextCompressionToParts(parts, category, phase, data);
          const flat = deriveFlat(parts);
          return { messages: replaceLast(messages, { ...stream, ...flat, parts }) };
        }),
      }));
    } catch {
      // ignore
    }
  });
}

function compressionLabel(category: ContextCompressionCategory): string {
  return category === "session_context"
    ? tr("Sắp xếp ký ức phiên", "Organize session memory")
    : tr("Nén ngữ cảnh truyện", "Compress story context");
}

function compressionSourceSummary(sources: readonly string[] | undefined): string {
  if (!sources || sources.length === 0) return "";
  const preview = sources.slice(0, 3).join(", ");
  const suffix = sources.length > 3 ? ` +${sources.length - 3}` : "";
  return `${tr("Nguồn", "sources")} ${sources.length}: ${preview}${suffix}`;
}

function compressionProgress(data: ContextCompressionEventPayload): PipelineStage["progress"] | undefined {
  if (data.phase !== "start") return undefined;
  const parts = [
    data.protectedTokens !== undefined ? `${tr("Được bảo vệ", "protected")} ${data.protectedTokens}` : "",
    data.compressibleTokens !== undefined ? `${tr("Có thể nén", "compressible")} ${data.compressibleTokens}` : "",
    data.budgetTokens !== undefined ? `${tr("Ngân sách", "budget")} ${data.budgetTokens}` : "",
    compressionSourceSummary(data.sources),
  ].filter(Boolean);
  return {
    status: parts.length > 0 ? parts.join(" · ") : "compressing",
    elapsedMs: 0,
    totalChars: 0,
    chineseChars: 0,
  };
}

function upsertCompressionStage(
  stages: PipelineStage[] | undefined,
  category: ContextCompressionCategory,
  phase: ContextCompressionPhase,
  data: ContextCompressionEventPayload,
): PipelineStage[] {
  const label = compressionLabel(category);
  const found = stages?.some((stage) => stage.label === label) ?? false;
  const base = found ? [...(stages ?? [])] : [...(stages ?? []), { label, status: "pending" as const }];
  const status: PipelineStage["status"] = phase === "start" ? "active" : "completed";
  return base.map((stage) =>
    stage.label === label
      ? { ...stage, status, progress: phase === "start" ? compressionProgress(data) : undefined }
      : stage
  );
}

function findRunningExecution(parts: MessagePart[]): ToolExecution | undefined {
  const running = findRunningToolPart(parts);
  return running?.execution;
}

/** Task card located by id: attach the compression event as a stage (immutable update). */
function applyContextCompressionToExecution(
  execution: ToolExecution,
  category: ContextCompressionCategory,
  phase: ContextCompressionPhase,
  data: ContextCompressionEventPayload,
): ToolExecution {
  const stages = upsertCompressionStage(execution.stages, category, phase, data);
  if (phase === "error") {
    return {
      ...execution,
      stages,
      status: "error",
      error: data.message ?? `${compressionLabel(category)}${tr(" thất bại", " failed")}`,
    };
  }
  return { ...execution, stages };
}

function applyContextCompressionToParts(
  parts: MessagePart[],
  category: ContextCompressionCategory,
  phase: ContextCompressionPhase,
  data: ContextCompressionEventPayload,
): void {
  const running = category === "session_context" ? undefined : findRunningExecution(parts);
  if (running) {
    running.stages = upsertCompressionStage(running.stages, category, phase, data);
    if (phase === "error") {
      running.status = "error";
      running.error = data.message ?? `${compressionLabel(category)}${tr(" thất bại", " failed")}`;
    }
    return;
  }

  const id = `context-${category}`;
  const existing = parts.find((part): part is { type: "tool"; execution: ToolExecution } =>
    part.type === "tool" && part.execution.id === id
  );
  const status: ToolExecution["status"] = phase === "start" ? "running" : phase === "error" ? "error" : "completed";
  const execution = existing?.execution ?? {
    id,
    tool: "context_compression",
    label: compressionLabel(category),
    status,
    stages: [],
    startedAt: Date.now(),
  };
  execution.status = status;
  execution.label = compressionLabel(category);
  execution.stages = upsertCompressionStage(execution.stages, category, phase, data);
  if (phase !== "start") execution.completedAt = Date.now();
  if (phase === "error") execution.error = data.message ?? `${compressionLabel(category)}${tr(" thất bại", " failed")}`;
  if (!existing) parts.push({ type: "tool", execution });
}
