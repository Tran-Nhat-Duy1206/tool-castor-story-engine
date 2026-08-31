import type { AutomationMode } from "./modes.js";
import { routeInteractionRequest } from "./request-router.js";
import type { InteractionRequest } from "./intents.js";
import type { ExecutionState, InteractionEvent } from "./events.js";
import type { PendingDecision, InteractionSession } from "./session.js";
import {
  appendInteractionEvent,
  bindActiveBook,
  clearCreationDraft,
  clearPendingDecision,
  updateCreationDraft,
  updateAutomationMode,
} from "./session.js";

type ReviseMode = "local-fix" | "rewrite";
type RuntimeLanguage = "vi" | "en";

export interface InteractionRuntimeTools {
  readonly listBooks: () => Promise<ReadonlyArray<string>>;
  readonly createBook?: (input: {
    readonly title: string;
    readonly genre?: string;
    readonly platform?: string;
    readonly language?: "vi" | "en";
    readonly chapterWordCount?: number;
    readonly targetChapters?: number;
    readonly blurb?: string;
    readonly worldPremise?: string;
    readonly settingNotes?: string;
    readonly protagonist?: string;
    readonly supportingCast?: string;
    readonly conflictCore?: string;
    readonly volumeOutline?: string;
    readonly constraints?: string;
    readonly authorIntent?: string;
    readonly currentFocus?: string;
  }) => Promise<unknown>;
  readonly exportBook?: (bookId: string, options: {
    readonly format?: "txt" | "md" | "epub";
    readonly approvedOnly?: boolean;
    readonly outputPath?: string;
  }) => Promise<unknown>;
  readonly chat?: (
    input: string,
    options: {
      readonly bookId?: string;
      readonly automationMode: AutomationMode;
    },
  ) => Promise<unknown>;
  readonly writeNextChapter: (bookId: string) => Promise<unknown>;
  readonly reviseDraft: (bookId: string, chapterNumber: number, mode: ReviseMode) => Promise<unknown>;
  readonly patchChapterText: (
    bookId: string,
    chapterNumber: number,
    targetText: string,
    replacementText: string,
  ) => Promise<unknown>;
  readonly replaceChapterText: (
    bookId: string,
    chapterNumber: number,
    fullText: string,
  ) => Promise<unknown>;
  readonly renameEntity: (
    bookId: string,
    oldValue: string,
    newValue: string,
  ) => Promise<unknown>;
  readonly updateCurrentFocus: (bookId: string, content: string) => Promise<unknown>;
  readonly updateAuthorIntent: (bookId: string, content: string) => Promise<unknown>;
  readonly writeTruthFile: (bookId: string, fileName: string, content: string) => Promise<unknown>;
}

export interface InteractionRuntimeResult {
  readonly session: InteractionSession;
  readonly responseText?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

interface InteractionToolMetadata {
  readonly events?: ReadonlyArray<InteractionEvent>;
  readonly activeChapterNumber?: number;
  readonly currentExecution?: ExecutionState;
  readonly pendingDecision?: PendingDecision;
  readonly responseText?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

function extractToolMetadata(value: unknown): InteractionToolMetadata {
  const chapterNumber = typeof value === "object" && value !== null && "chapterNumber" in value
    && typeof (value as { chapterNumber?: unknown }).chapterNumber === "number"
    ? (value as { chapterNumber: number }).chapterNumber
    : undefined;

  if (!value || typeof value !== "object" || !("__interaction" in value)) {
    return {
      ...(chapterNumber !== undefined ? { activeChapterNumber: chapterNumber } : {}),
    };
  }

  const interaction = (value as {
    readonly __interaction?: InteractionToolMetadata;
  }).__interaction;

  return {
    ...interaction,
    ...(interaction?.activeChapterNumber === undefined && chapterNumber !== undefined
      ? { activeChapterNumber: chapterNumber }
      : {}),
  };
}

function resolveRuntimeLanguage(request: InteractionRequest): RuntimeLanguage {
  return request.language === "en" ? "en" : "vi";
}

function localize<T>(language: RuntimeLanguage, messages: { vi: T; en: T }): T {
  return language === "en" ? messages.en : messages.vi;
}

function localizeMode(mode: AutomationMode, language: RuntimeLanguage): string {
  if (language === "en") {
    return mode;
  }

  return {
    auto: "",
    semi: "",
    manual: "",
  }[mode] ?? mode;
}

function renderCreationDraft(
  draft: NonNullable<InteractionSession["creationDraft"]>,
  language: RuntimeLanguage,
): string {
  const lines = language === "en"
    ? [
        "# Current Book Draft",
        draft.title ? `- Title: ${draft.title}` : undefined,
        draft.genre ? `- Genre: ${draft.genre}` : undefined,
        draft.platform ? `- Platform: ${draft.platform}` : undefined,
        draft.worldPremise ? `- World: ${draft.worldPremise}` : undefined,
        draft.protagonist ? `- Protagonist: ${draft.protagonist}` : undefined,
        draft.conflictCore ? `- Core Conflict: ${draft.conflictCore}` : undefined,
        draft.volumeOutline ? `- Volume Direction: ${draft.volumeOutline}` : undefined,
        draft.blurb ? `- Blurb: ${draft.blurb}` : undefined,
        draft.nextQuestion ? `- Next: ${draft.nextQuestion}` : undefined,
      ]
    : [
        "# ",
        draft.title ? `- ：${draft.title}` : undefined,
        draft.genre ? `- ：${draft.genre}` : undefined,
        draft.platform ? `- ：${draft.platform}` : undefined,
        draft.worldPremise ? `- ：${draft.worldPremise}` : undefined,
        draft.protagonist ? `- ：${draft.protagonist}` : undefined,
        draft.conflictCore ? `- ：${draft.conflictCore}` : undefined,
        draft.volumeOutline ? `- ：${draft.volumeOutline}` : undefined,
        draft.blurb ? `- ：${draft.blurb}` : undefined,
        draft.nextQuestion ? `- ：${draft.nextQuestion}` : undefined,
      ];
  return lines.filter(Boolean).join("\n");
}

function buildTaskStartedState(
  session: InteractionSession,
  request: InteractionRequest,
  language: RuntimeLanguage,
): ExecutionState {
  switch (request.intent) {
    case "write_next":
    case "continue_book":
      return {
        status: "planning",
        bookId: request.bookId ?? session.activeBookId,
        chapterNumber: session.activeChapterNumber,
        stageLabel: localize(language, {
          vi: "Chuẩn bị đầu vào chương",
          en: "preparing chapter inputs",
        }),
      };
    case "create_book":
      return {
        status: "planning",
        bookId: request.bookId ?? session.activeBookId,
        stageLabel: localize(language, {
          vi: "Tạo cài đặt nền tảng tác phẩm",
          en: "creating book foundation",
        }),
      };
    case "export_book":
      return {
        status: "persisting",
        bookId: request.bookId ?? session.activeBookId,
        chapterNumber: session.activeChapterNumber,
        stageLabel: localize(language, {
          vi: "Xuất tệp tác phẩm",
          en: "exporting book artifacts",
        }),
      };
    case "revise_chapter":
    case "rewrite_chapter":
      return {
        status: "repairing",
        bookId: request.bookId ?? session.activeBookId,
        chapterNumber: request.chapterNumber ?? session.activeChapterNumber,
        stageLabel: request.intent === "rewrite_chapter"
          ? localize(language, { vi: "Viết lại chương", en: "rewriting chapter" })
          : localize(language, { vi: "Chỉnh sửa chương", en: "revising chapter" }),
      };
    case "update_focus":
    case "update_author_intent":
    case "edit_truth":
      return {
        status: "persisting",
        bookId: request.bookId ?? session.activeBookId,
        chapterNumber: session.activeChapterNumber,
        stageLabel: localize(language, {
          vi: "Áp dụng chỉnh sửa dự án",
          en: "applying project edit",
        }),
      };
    case "pause_book":
    case "discard_book_draft":
      return {
        status: "blocked",
        bookId: request.bookId ?? session.activeBookId,
        chapterNumber: session.activeChapterNumber,
        stageLabel: localize(language, {
          vi: "Đã bị người dùng tạm dừng",
          en: "paused by user",
        }),
      };
    default:
      return {
        status: "planning",
        bookId: request.bookId ?? session.activeBookId,
        chapterNumber: session.activeChapterNumber,
        stageLabel: localize(language, {
          vi: `Đang xử lý: ${request.intent}`,
          en: `handling ${request.intent}`,
        }),
      };
  }
}

function shouldWaitForHuman(
  automationMode: AutomationMode,
  request: InteractionRequest,
): boolean {
  const contentIntent = request.intent === "write_next"
    || request.intent === "continue_book"
    || request.intent === "revise_chapter"
    || request.intent === "rewrite_chapter"
    || request.intent === "patch_chapter_text"
    || request.intent === "replace_chapter_text";
  const editIntent = request.intent === "update_focus"
    || request.intent === "update_author_intent"
    || request.intent === "edit_truth"
    || request.intent === "rename_entity";

  if (automationMode === "auto") {
    return false;
  }
  if (automationMode === "semi") {
    return contentIntent;
  }
  return contentIntent || editIntent;
}

function buildPendingDecision(
  session: InteractionSession,
  request: InteractionRequest,
  language: RuntimeLanguage,
  chapterNumber?: number,
): PendingDecision | undefined {
  if (!shouldWaitForHuman(session.automationMode, request)) {
    return undefined;
  }

  const bookId = request.bookId ?? session.activeBookId;
  if (!bookId) {
    return undefined;
  }

  return {
    kind: "review-next-step",
    bookId,
    ...(chapterNumber !== undefined ? { chapterNumber } : {}),
    summary: session.automationMode === "manual"
      ? localize(language, {
          vi: "Thực thi đã hoàn tất. Vui lòng chọn rõ bước tiếp theo.",
          en: "Execution finished. Choose the next action explicitly.",
        })
      : localize(language, {
          vi: "Thực thi đã hoàn tất, đang chờ quyết định tiếp theo của bạn.",
          en: "Execution finished. Waiting for your next decision.",
        }),
  };
}

function buildWaitingExecution(
  session: InteractionSession,
  request: InteractionRequest,
  language: RuntimeLanguage,
  chapterNumber?: number,
): ExecutionState {
  return {
    status: "waiting_human",
    bookId: request.bookId ?? session.activeBookId,
    ...(chapterNumber !== undefined ? { chapterNumber } : {}),
    stageLabel: localize(language, {
      vi: "Đang chờ quyết định tiếp theo của bạn",
      en: "waiting for your next decision",
    }),
  };
}

function appendToolEvents(
  session: InteractionSession,
  events: ReadonlyArray<InteractionEvent> | undefined,
): InteractionSession {
  if (!events || events.length === 0) {
    return session;
  }

  const baseTimestamp = Date.now();
  return events.reduce((nextSession, event, index) => appendInteractionEvent(nextSession, {
    ...event,
    timestamp: baseTimestamp - events.length + index,
  }), session);
}

interface RuntimeRequestHelpers {
  readonly language: RuntimeLanguage;
  readonly addEvent: (
    nextSession: InteractionSession,
    kind: string,
    status: InteractionEvent["status"],
    detail: string,
  ) => InteractionSession;
  readonly markCompleted: (nextSession: InteractionSession) => InteractionSession;
}

async function handleDraftLifecycleRequest(params: {
  readonly session: InteractionSession;
  readonly request: InteractionRequest;
  readonly tools: InteractionRuntimeTools;
  readonly helpers: RuntimeRequestHelpers;
}): Promise<InteractionRuntimeResult | undefined> {
  const { session, request, tools, helpers } = params;
  const { language, addEvent, markCompleted } = helpers;

  switch (request.intent) {
    case "show_book_draft": {
      if (!session.creationDraft) {
        return {
          session: markCompleted(session),
          responseText: localize(language, {
            vi: "Hiện chưa có bản thảo sáng tác nào. Hãy cho tôi biết bạn muốn viết gì, rồi chúng ta sẽ từng bước hoàn thiện sách.",
            en: "There is no active book draft yet. Start by telling me what you want to write.",
          }),
        };
      }
      return {
        session: markCompleted(session),
        responseText: renderCreationDraft(session.creationDraft, language),
      };
    }
    case "create_book": {
      if (!tools.createBook) {
        throw new Error(localize(language, {
          vi: "Runtime tương tác chưa hỗ trợ tạo tác phẩm.",
          en: "Book creation is not implemented in the interaction runtime yet.",
        }));
      }
      const effectiveDraft = session.creationDraft;
      const title = request.title ?? effectiveDraft?.title;
      if (!title) {
        throw new Error(localize(language, {
          vi: "Tạo tác phẩm cần tiêu đề.",
          en: "Book creation requires a title.",
        }));
      }
      const toolResult = await tools.createBook({
        title,
        genre: request.genre ?? effectiveDraft?.genre,
        platform: request.platform ?? effectiveDraft?.platform,
        language: request.language ?? effectiveDraft?.language,
        chapterWordCount: request.chapterWordCount ?? effectiveDraft?.chapterWordCount,
        targetChapters: request.targetChapters ?? effectiveDraft?.targetChapters,
        blurb: request.blurb ?? effectiveDraft?.blurb,
        worldPremise: request.worldPremise ?? effectiveDraft?.worldPremise,
        settingNotes: request.settingNotes ?? effectiveDraft?.settingNotes,
        protagonist: request.protagonist ?? effectiveDraft?.protagonist,
        supportingCast: request.supportingCast ?? effectiveDraft?.supportingCast,
        conflictCore: request.conflictCore ?? effectiveDraft?.conflictCore,
        volumeOutline: request.volumeOutline ?? effectiveDraft?.volumeOutline,
        constraints: request.constraints ?? effectiveDraft?.constraints,
        authorIntent: request.authorIntent ?? effectiveDraft?.authorIntent,
        currentFocus: request.currentFocus ?? effectiveDraft?.currentFocus,
      });
      const metadata = extractToolMetadata(toolResult);
      const createdBookId = typeof toolResult === "object" && toolResult !== null && "bookId" in toolResult
        && typeof (toolResult as { bookId?: unknown }).bookId === "string"
        ? (toolResult as { bookId: string }).bookId
        : undefined;
      if (!createdBookId) {
        throw new Error(localize(language, {
          vi: " ID。",
          en: "Create-book tool did not return a book id.",
        }));
      }
      const nextSession = appendToolEvents(
        clearCreationDraft(bindActiveBook(session, createdBookId)),
        metadata.events,
      );
      const completed = {
        ...markCompleted(nextSession),
        currentExecution: metadata.currentExecution ?? markCompleted(nextSession).currentExecution,
      };
      return {
        session: addEvent(completed, "task.completed", "completed", localize(language, {
          vi: ` ${createdBookId}。`,
          en: `Created ${createdBookId}.`,
        })),
        responseText: metadata.responseText ?? localize(language, {
          vi: ` ${createdBookId}。`,
          en: `Created ${createdBookId}.`,
        }),
        details: metadata.details,
      };
    }
    case "discard_book_draft": {
      const completed = markCompleted(clearCreationDraft(session));
      return {
        session: addEvent(completed, "task.completed", "completed", localize(language, {
          vi: "。",
          en: "Discarded the current book draft.",
        })),
        responseText: localize(language, {
          vi: "。",
          en: "Discarded the current book draft.",
        }),
      };
    }
    default:
      return undefined;
  }
}

async function handleBookSelectionRequest(params: {
  readonly session: InteractionSession;
  readonly request: InteractionRequest;
  readonly tools: InteractionRuntimeTools;
  readonly helpers: RuntimeRequestHelpers;
}): Promise<InteractionRuntimeResult | undefined> {
  const { session, request, tools, helpers } = params;
  const { language, addEvent, markCompleted } = helpers;

  switch (request.intent) {
    case "list_books": {
      const books = await tools.listBooks();
      const completed = markCompleted(session);
      return {
        session: addEvent(completed, "task.completed", "completed", localize(language, {
          vi: ` ${books.length} 。`,
          en: `Listed ${books.length} book(s).`,
        })),
        responseText: books.length > 0
          ? localize(language, {
              vi: `：${books.join("、")}`,
              en: `Books: ${books.join(", ")}`,
            })
          : localize(language, {
              vi: "。",
              en: "No books found in this project.",
            }),
      };
    }
    case "select_book": {
      if (!request.bookId) {
        throw new Error(localize(language, {
          vi: " ID。",
          en: "Book selection requires a book id.",
        }));
      }
      const books = await tools.listBooks();
      if (!books.includes(request.bookId)) {
        throw new Error(localize(language, {
          vi: `「${request.bookId}」。`,
          en: `Book "${request.bookId}" not found in this project.`,
        }));
      }
      const completed = markCompleted(bindActiveBook(session, request.bookId));
      return {
        session: addEvent(completed, "task.completed", "completed", localize(language, {
          vi: `Đã chuyển tác phẩm hiện tại sang ${request.bookId}。`,
          en: `Bound active book to ${request.bookId}.`,
        })),
        responseText: localize(language, {
          vi: `：${request.bookId}`,
          en: `Active book: ${request.bookId}`,
        }),
      };
    }
    default:
      return undefined;
  }
}

export async function runInteractionRequest(params: {
  readonly session: InteractionSession;
  readonly request: InteractionRequest;
  readonly tools: InteractionRuntimeTools;
}): Promise<InteractionRuntimeResult> {
  const request = routeInteractionRequest(params.request);
  const language = resolveRuntimeLanguage(request);
  let session = params.session;
  const addEvent = (
    nextSession: InteractionSession,
    kind: string,
    status: InteractionEvent["status"],
    detail: string,
  ): InteractionSession => appendInteractionEvent(nextSession, {
    kind,
    timestamp: Date.now(),
    status,
    bookId: nextSession.activeBookId,
    chapterNumber: nextSession.activeChapterNumber,
    detail,
  });

  if (request.mode) {
    session = updateAutomationMode(session, request.mode as AutomationMode);
  }

  session = clearPendingDecision({
    ...session,
    currentExecution: buildTaskStartedState(session, request, language),
  });
  session = addEvent(session, "task.started", session.currentExecution!.status, localize(language, {
    vi: ` ${request.intent}。`,
    en: `Started ${request.intent}.`,
  }));

  const markCompleted = (nextSession: InteractionSession): InteractionSession => ({
    ...nextSession,
    currentExecution: {
      status: "completed",
      bookId: nextSession.activeBookId,
      chapterNumber: nextSession.activeChapterNumber,
      stageLabel: localize(language, {
        vi: "completed",
        en: "completed",
      }),
    },
  });

  const helperContext: RuntimeRequestHelpers = {
    language,
    addEvent,
    markCompleted,
  };

  const draftLifecycleResult = await handleDraftLifecycleRequest({
    session,
    request,
    tools: params.tools,
    helpers: helperContext,
  });
  if (draftLifecycleResult) {
    return draftLifecycleResult;
  }

  const bookSelectionResult = await handleBookSelectionRequest({
    session,
    request,
    tools: params.tools,
    helpers: helperContext,
  });
  if (bookSelectionResult) {
    return bookSelectionResult;
  }

  switch (request.intent) {
    case "write_next":
    case "continue_book": {
      const bookId = request.bookId ?? session.activeBookId;
      if (!bookId) {
        throw new Error(localize(language, {
          vi: "。",
          en: "No active book is bound to the interaction session.",
        }));
      }
      const toolResult = await params.tools.writeNextChapter(bookId);
      const metadata = extractToolMetadata(toolResult);
      session = bindActiveBook(session, bookId, metadata.activeChapterNumber);
      session = appendToolEvents(session, metadata.events);
      const pendingDecision = metadata.pendingDecision ?? buildPendingDecision(
        session,
        request,
        language,
        metadata.activeChapterNumber,
      );
      const completed = pendingDecision
        ? {
            ...session,
            pendingDecision,
            currentExecution: metadata.currentExecution ?? buildWaitingExecution(session, request, language, metadata.activeChapterNumber),
          }
        : {
            ...markCompleted(session),
            currentExecution: metadata.currentExecution ?? markCompleted(session).currentExecution,
          };
      return {
        session: addEvent(completed, "task.completed", "completed", localize(language, {
          vi: ` ${bookId} 。`,
          en: `Completed write_next for ${bookId}.`,
        })),
        responseText: metadata.responseText ?? (
          pendingDecision
            ? localize(language, {
                vi: ` ${bookId} ，Đang chờ quyết định tiếp theo của bạn。`,
                en: `Completed write_next for ${bookId}; waiting for your next decision.`,
              })
            : localize(language, {
                vi: ` ${bookId} 。`,
                en: `Completed write_next for ${bookId}.`,
              })
        ),
      };
    }
    case "revise_chapter":
    case "rewrite_chapter": {
      const bookId = request.bookId ?? session.activeBookId;
      if (!bookId) {
        throw new Error(localize(language, {
          vi: "。",
          en: "No active book is bound to the interaction session.",
        }));
      }
      if (!request.chapterNumber) {
        throw new Error(localize(language, {
          vi: "Chỉnh sửa chương。",
          en: "Chapter number is required for chapter revision.",
        }));
      }
      const mode: ReviseMode = request.intent === "rewrite_chapter" ? "rewrite" : "local-fix";
      const toolResult = await params.tools.reviseDraft(bookId, request.chapterNumber, mode);
      const metadata = extractToolMetadata(toolResult);
      const chapterNumber = metadata.activeChapterNumber ?? request.chapterNumber;
      session = bindActiveBook(session, bookId, chapterNumber);
      session = appendToolEvents(session, metadata.events);
      const pendingDecision = metadata.pendingDecision ?? buildPendingDecision(
        session,
        request,
        language,
        chapterNumber,
      );
      const completed = pendingDecision
        ? {
            ...session,
            pendingDecision,
            currentExecution: metadata.currentExecution ?? buildWaitingExecution(session, request, language, chapterNumber),
          }
        : {
            ...markCompleted(session),
            currentExecution: metadata.currentExecution ?? markCompleted(session).currentExecution,
          };
      return {
        session: addEvent(completed, "task.completed", "completed", localize(language, {
          vi: request.intent === "rewrite_chapter"
            ? ` ${bookId} 。`
            : ` ${bookId} 。`,
          en: `Completed ${request.intent} for ${bookId}.`,
        })),
        responseText: metadata.responseText ?? (
          pendingDecision
            ? localize(language, {
                vi: request.intent === "rewrite_chapter"
                  ? ` ${bookId} ，Đang chờ quyết định tiếp theo của bạn。`
                  : ` ${bookId} ，Đang chờ quyết định tiếp theo của bạn。`,
                en: `Completed ${request.intent} for ${bookId}; waiting for your next decision.`,
              })
            : localize(language, {
                vi: request.intent === "rewrite_chapter"
                  ? ` ${bookId} 。`
                  : ` ${bookId} 。`,
                en: `Completed ${request.intent} for ${bookId}.`,
              })
        ),
      };
    }
    case "patch_chapter_text": {
      const bookId = request.bookId ?? session.activeBookId;
      if (!bookId) {
        throw new Error(localize(language, {
          vi: "。",
          en: "No active book is bound to the interaction session.",
        }));
      }
      if (!request.chapterNumber || !request.targetText || !request.replacementText) {
        throw new Error(localize(language, {
          vi: "、。",
          en: "Chapter patch requires chapter number, target text, and replacement text.",
        }));
      }
      const toolResult = await params.tools.patchChapterText(
        bookId,
        request.chapterNumber,
        request.targetText,
        request.replacementText,
      );
      const metadata = extractToolMetadata(toolResult);
      const chapterNumber = metadata.activeChapterNumber ?? request.chapterNumber;
      session = bindActiveBook(session, bookId, chapterNumber);
      session = appendToolEvents(session, metadata.events);
      const pendingDecision = metadata.pendingDecision ?? buildPendingDecision(
        session,
        request,
        language,
        chapterNumber,
      );
      const completed = pendingDecision
        ? {
            ...session,
            pendingDecision,
            currentExecution: metadata.currentExecution ?? buildWaitingExecution(session, request, language, chapterNumber),
          }
        : {
            ...markCompleted(session),
            currentExecution: metadata.currentExecution ?? markCompleted(session).currentExecution,
          };
      return {
        session: addEvent(completed, "task.completed", "completed", localize(language, {
          vi: ` ${bookId} Chương  ${chapterNumber} 。`,
          en: `Patched chapter ${chapterNumber} for ${bookId}.`,
        })),
        responseText: metadata.responseText ?? (
          pendingDecision
            ? localize(language, {
                vi: ` ${bookId} Chương  ${chapterNumber} ，Đang chờ quyết định tiếp theo của bạn。`,
                en: `Patched chapter ${chapterNumber} for ${bookId}; waiting for your next decision.`,
              })
            : localize(language, {
                vi: ` ${bookId} Chương  ${chapterNumber} 。`,
                en: `Patched chapter ${chapterNumber} for ${bookId}.`,
              })
        ),
      };
    }
    case "replace_chapter_text": {
      const bookId = request.bookId ?? session.activeBookId;
      if (!bookId) {
        throw new Error(localize(language, {
          vi: "。",
          en: "No active book is bound to the interaction session.",
        }));
      }
      if (!request.chapterNumber || !request.fullText) {
        throw new Error(localize(language, {
          vi: "。",
          en: "Whole-chapter replacement requires chapter number and fullText.",
        }));
      }
      const toolResult = await params.tools.replaceChapterText(
        bookId,
        request.chapterNumber,
        request.fullText,
      );
      const metadata = extractToolMetadata(toolResult);
      const chapterNumber = metadata.activeChapterNumber ?? request.chapterNumber;
      session = bindActiveBook(session, bookId, chapterNumber);
      session = appendToolEvents(session, metadata.events);
      const pendingDecision = metadata.pendingDecision ?? buildPendingDecision(
        session,
        request,
        language,
        chapterNumber,
      );
      const completed = pendingDecision
        ? {
            ...session,
            pendingDecision,
            currentExecution: metadata.currentExecution ?? buildWaitingExecution(session, request, language, chapterNumber),
          }
        : {
            ...markCompleted(session),
            currentExecution: metadata.currentExecution ?? markCompleted(session).currentExecution,
          };
      return {
        session: addEvent(completed, "task.completed", "completed", localize(language, {
          vi: ` ${bookId} Chương  ${chapterNumber} 。`,
          en: `Replaced chapter ${chapterNumber} for ${bookId}.`,
        })),
        responseText: metadata.responseText ?? (
          pendingDecision
            ? localize(language, {
                vi: ` ${bookId} Chương  ${chapterNumber} ，Đang chờ quyết định tiếp theo của bạn。`,
                en: `Replaced chapter ${chapterNumber} for ${bookId}; waiting for your next decision.`,
              })
            : localize(language, {
                vi: ` ${bookId} Chương  ${chapterNumber} 。`,
                en: `Replaced chapter ${chapterNumber} for ${bookId}.`,
              })
        ),
      };
    }
    case "rename_entity": {
      const bookId = request.bookId ?? session.activeBookId;
      if (!bookId) {
        throw new Error(localize(language, {
          vi: "。",
          en: "No active book is bound to the interaction session.",
        }));
      }
      if (!request.oldValue || !request.newValue) {
        throw new Error(localize(language, {
          vi: "。",
          en: "Entity rename requires old and new values.",
        }));
      }
      const toolResult = await params.tools.renameEntity(bookId, request.oldValue, request.newValue);
      const metadata = extractToolMetadata(toolResult);
      session = bindActiveBook(session, bookId, metadata.activeChapterNumber);
      session = appendToolEvents(session, metadata.events);
      const pendingDecision = metadata.pendingDecision ?? buildPendingDecision(
        session,
        request,
        language,
        metadata.activeChapterNumber,
      );
      const completed = pendingDecision
        ? {
            ...session,
            pendingDecision,
            currentExecution: metadata.currentExecution ?? buildWaitingExecution(session, request, language, metadata.activeChapterNumber),
          }
        : {
            ...markCompleted(session),
            currentExecution: metadata.currentExecution ?? markCompleted(session).currentExecution,
          };
      return {
        session: addEvent(completed, "task.completed", "completed", localize(language, {
          vi: ` ${bookId}  ${request.oldValue}  ${request.newValue}。`,
          en: `Renamed ${request.oldValue} to ${request.newValue} in ${bookId}.`,
        })),
        responseText: metadata.responseText ?? (
          pendingDecision
            ? localize(language, {
                vi: ` ${bookId}  ${request.oldValue}  ${request.newValue}，Đang chờ quyết định tiếp theo của bạn。`,
                en: `Renamed ${request.oldValue} to ${request.newValue} in ${bookId}; waiting for your next decision.`,
              })
            : localize(language, {
                vi: ` ${bookId}  ${request.oldValue}  ${request.newValue}。`,
                en: `Renamed ${request.oldValue} to ${request.newValue} in ${bookId}.`,
              })
        ),
      };
    }
    case "update_focus": {
      const bookId = request.bookId ?? session.activeBookId;
      if (!bookId) {
        throw new Error(localize(language, {
          vi: "。",
          en: "No active book is bound to the interaction session.",
        }));
      }
      if (!request.instruction) {
        throw new Error(localize(language, {
          vi: "。",
          en: "Focus update requires instruction content.",
        }));
      }
      const toolResult = await params.tools.updateCurrentFocus(bookId, request.instruction);
      const metadata = extractToolMetadata(toolResult);
      session = bindActiveBook(session, bookId);
      session = appendToolEvents(session, metadata.events);
      const pendingDecision = metadata.pendingDecision ?? buildPendingDecision(session, request, language);
      const completed = pendingDecision
        ? {
            ...session,
            pendingDecision,
            currentExecution: metadata.currentExecution ?? buildWaitingExecution(session, request, language),
          }
        : {
            ...markCompleted(session),
            currentExecution: metadata.currentExecution ?? markCompleted(session).currentExecution,
          };
      return {
        session: addEvent(completed, "task.completed", "completed", localize(language, {
          vi: ` ${bookId} 。`,
          en: `Updated current focus for ${bookId}.`,
        })),
        responseText: metadata.responseText ?? (
          pendingDecision
            ? localize(language, {
                vi: ` ${bookId} ，Đang chờ quyết định tiếp theo của bạn。`,
                en: `Updated current focus for ${bookId}; waiting for your next decision.`,
              })
            : localize(language, {
                vi: ` ${bookId} 。`,
                en: `Updated current focus for ${bookId}.`,
              })
        ),
      };
    }
    case "update_author_intent": {
      const bookId = request.bookId ?? session.activeBookId;
      if (!bookId) {
        throw new Error(localize(language, {
          vi: "。",
          en: "No active book is bound to the interaction session.",
        }));
      }
      if (!request.instruction) {
        throw new Error(localize(language, {
          vi: "。",
          en: "Author intent update requires instruction content.",
        }));
      }
      const toolResult = await params.tools.updateAuthorIntent(bookId, request.instruction);
      const metadata = extractToolMetadata(toolResult);
      session = bindActiveBook(session, bookId);
      session = appendToolEvents(session, metadata.events);
      const pendingDecision = metadata.pendingDecision ?? buildPendingDecision(session, request, language);
      const completed = pendingDecision
        ? {
            ...session,
            pendingDecision,
            currentExecution: metadata.currentExecution ?? buildWaitingExecution(session, request, language),
          }
        : {
            ...markCompleted(session),
            currentExecution: metadata.currentExecution ?? markCompleted(session).currentExecution,
          };
      return {
        session: addEvent(completed, "task.completed", "completed", localize(language, {
          vi: ` ${bookId} 。`,
          en: `Updated author intent for ${bookId}.`,
        })),
        responseText: metadata.responseText ?? (
          pendingDecision
            ? localize(language, {
                vi: ` ${bookId} ，Đang chờ quyết định tiếp theo của bạn。`,
                en: `Updated author intent for ${bookId}; waiting for your next decision.`,
              })
            : localize(language, {
                vi: ` ${bookId} 。`,
                en: `Updated author intent for ${bookId}.`,
              })
        ),
      };
    }
    case "edit_truth": {
      const bookId = request.bookId ?? session.activeBookId;
      if (!bookId) {
        throw new Error(localize(language, {
          vi: "。",
          en: "No active book is bound to the interaction session.",
        }));
      }
      if (!request.fileName || !request.instruction) {
        throw new Error(localize(language, {
          vi: "。",
          en: "Truth-file edit requires a file name and content.",
        }));
      }
      const toolResult = await params.tools.writeTruthFile(bookId, request.fileName, request.instruction);
      const metadata = extractToolMetadata(toolResult);
      session = bindActiveBook(session, bookId);
      session = appendToolEvents(session, metadata.events);
      const pendingDecision = metadata.pendingDecision ?? buildPendingDecision(session, request, language);
      const completed = pendingDecision
        ? {
            ...session,
            pendingDecision,
            currentExecution: metadata.currentExecution ?? buildWaitingExecution(session, request, language),
          }
        : {
            ...markCompleted(session),
            currentExecution: metadata.currentExecution ?? markCompleted(session).currentExecution,
          };
      return {
        session: addEvent(completed, "task.completed", "completed", localize(language, {
          vi: ` ${bookId}  ${request.fileName}。`,
          en: `Updated ${request.fileName} for ${bookId}.`,
        })),
        responseText: metadata.responseText ?? (
          pendingDecision
            ? localize(language, {
                vi: ` ${bookId}  ${request.fileName}，Đang chờ quyết định tiếp theo của bạn。`,
                en: `Updated ${request.fileName} for ${bookId}; waiting for your next decision.`,
              })
            : localize(language, {
                vi: ` ${bookId}  ${request.fileName}。`,
                en: `Updated ${request.fileName} for ${bookId}.`,
              })
        ),
      };
    }
    case "export_book": {
      const bookId = request.bookId ?? session.activeBookId;
      if (!params.tools.exportBook) {
        throw new Error(localize(language, {
          vi: "。",
          en: "Book export is not implemented in the interaction runtime yet.",
        }));
      }
      if (!bookId) {
        throw new Error(localize(language, {
          vi: "。",
          en: "No active book is bound to the interaction session.",
        }));
      }
      const toolResult = await params.tools.exportBook(bookId, {
        format: request.format,
        approvedOnly: request.approvedOnly,
        outputPath: request.outputPath,
      });
      const metadata = extractToolMetadata(toolResult);
      session = bindActiveBook(session, bookId, metadata.activeChapterNumber);
      session = appendToolEvents(session, metadata.events);
      const completed = {
        ...markCompleted(session),
        currentExecution: metadata.currentExecution ?? markCompleted(session).currentExecution,
      };
      return {
        session: addEvent(completed, "task.completed", "completed", localize(language, {
          vi: ` ${bookId}。`,
          en: `Exported ${bookId}.`,
        })),
        responseText: metadata.responseText ?? localize(language, {
          vi: ` ${bookId}。`,
          en: `Exported ${bookId}.`,
        }),
        details: metadata.details,
      };
    }
    case "pause_book": {
      const bookId = request.bookId ?? session.activeBookId;
      const paused = {
        ...session,
        currentExecution: {
          status: "blocked" as const,
          bookId,
          chapterNumber: session.activeChapterNumber,
          stageLabel: localize(language, {
            vi: "Đã bị người dùng tạm dừng",
            en: "paused by user",
          }),
        },
      };
      return {
        session: addEvent(paused, "task.completed", "blocked", localize(language, {
          vi: `${bookId ?? ""}。`,
          en: `Paused ${bookId ?? "current book"}.`,
        })),
        responseText: localize(language, {
          vi: `${bookId ?? ""}。`,
          en: `Paused ${bookId ?? "current book"}.`,
        }),
      };
    }
    case "resume_book": {
      const bookId = request.bookId ?? session.activeBookId;
      const resumed = {
        ...session,
        currentExecution: {
          status: "completed" as const,
          bookId,
          chapterNumber: session.activeChapterNumber,
          stageLabel: localize(language, {
            vi: "",
            en: "ready to continue",
          }),
        },
      };
      return {
        session: addEvent(resumed, "task.completed", "completed", localize(language, {
          vi: `${bookId ?? ""}。`,
          en: `Resumed ${bookId ?? "current book"}.`,
        })),
        responseText: localize(language, {
          vi: `${bookId ?? ""}。`,
          en: `Resumed ${bookId ?? "current book"}.`,
        }),
      };
    }
    case "chat": {
      const bookId = request.bookId ?? session.activeBookId;
      const toolResult = params.tools.chat
        ? await params.tools.chat(request.instruction ?? "", {
            bookId,
            automationMode: session.automationMode,
          })
        : undefined;
      const metadata = extractToolMetadata(toolResult);
      const responseText = metadata.responseText ?? (bookId
        ? localize(language, {
            vi: `。 ${bookId}。、Chỉnh sửa chương、、，。`,
            en: `I’m here. Active book is ${bookId}. You can ask me to continue, revise a chapter, rewrite, change focus, or inspect why the pipeline stopped.`,
          })
        : localize(language, {
            vi: "。。、，。",
            en: "I’m here. No active book is bound yet. Open a book, list books, or describe what you want to write.",
          }));
      const completed = markCompleted(session);
      return {
        session: addEvent(completed, "task.completed", "completed", responseText),
        responseText,
      };
    }
    case "explain_status":
    case "explain_failure": {
      const bookId = request.bookId ?? session.activeBookId;
      const baselineExecution = params.session.currentExecution;
      const stage = baselineExecution?.stageLabel ?? baselineExecution?.status ?? "idle";
      const summary = request.intent === "explain_failure"
        ? localize(language, {
            vi: `failed：${bookId ?? ""}  ${stage}。`,
            en: `Current failure context: ${bookId ?? "no active book"} is at ${stage}.`,
          })
        : localize(language, {
            vi: `：${bookId ?? ""}  ${stage}。`,
            en: `Current status: ${bookId ?? "no active book"} is at ${stage}.`,
          });
      const completed = markCompleted(session);
      return {
        session: addEvent(completed, "task.completed", "completed", summary),
        responseText: summary,
      };
    }
    default:
      throw new Error(localize(language, {
        vi: `「${request.intent}」。`,
        en: `Intent "${request.intent}" is not implemented in the interaction runtime yet.`,
      }));
  }
}
