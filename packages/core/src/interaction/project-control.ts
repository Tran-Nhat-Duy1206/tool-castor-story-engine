import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { appendInteractionEvent } from "./session.js";
import type { InteractionRequest } from "./intents.js";
import type { InteractionRuntimeTools } from "./runtime.js";
import { runInteractionRequest } from "./runtime.js";
import {
  loadProjectSession,
  persistProjectSession,
  resolveSessionActiveBook,
} from "./project-session-store.js";

async function processProjectInteractionRequestInternal(params: {
  readonly projectRoot: string;
  readonly request: InteractionRequest;
  readonly tools: InteractionRuntimeTools;
  readonly activeBookId?: string;
}) {
  const requestLanguage = await detectProjectInteractionLanguage(params.projectRoot);
  const localizedRequest = attachRequestLanguage(params.request, requestLanguage);
  const session = await loadProjectSession(params.projectRoot);
  const restoredBookId = await resolveSessionActiveBook(params.projectRoot, session);
  const resolvedBookId = params.activeBookId ?? localizedRequest.bookId ?? restoredBookId;
  const sessionWithBook = resolvedBookId && session.activeBookId !== resolvedBookId
    ? { ...session, activeBookId: resolvedBookId }
    : session;

  try {
    const result = await runInteractionRequest({
      session: sessionWithBook,
      request: localizedRequest,
      tools: params.tools,
    });
    await persistProjectSession(params.projectRoot, result.session);
    return {
      ...result,
      request: localizedRequest,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const failedSession = appendInteractionEvent({
      ...sessionWithBook,
      currentExecution: {
        status: "failed",
        bookId: sessionWithBook.activeBookId,
        chapterNumber: sessionWithBook.activeChapterNumber,
        stageLabel: localizedRequest.language === "en" ? `failed ${localizedRequest.intent}` : `执行失败：${localizedRequest.intent}`,
      },
    }, {
      kind: "task.failed",
      timestamp: Date.now(),
      status: "failed",
      bookId: sessionWithBook.activeBookId,
      chapterNumber: sessionWithBook.activeChapterNumber,
      detail,
    });
    await persistProjectSession(params.projectRoot, failedSession);
    throw error;
  }
}

export async function processProjectInteractionRequest(params: {
  readonly projectRoot: string;
  readonly request: InteractionRequest;
  readonly tools: InteractionRuntimeTools;
  readonly activeBookId?: string;
}) {
  return processProjectInteractionRequestInternal(params);
}

function attachRequestLanguage(
  request: InteractionRequest,
  language: "vi" | "en" | undefined,
): InteractionRequest {
  if (request.language || !language) {
    return request;
  }

  return {
    ...request,
    language,
  };
}

async function detectProjectInteractionLanguage(projectRoot: string): Promise<"vi" | "en" | undefined> {
  try {
    const { loadProjectConfigFile } = await import("../config/project-config-file.js");
    const parsed = (await loadProjectConfigFile(projectRoot)).config as { language?: string };
    return parsed.language === "en" ? "en" : parsed.language === "vi" ? "vi" : undefined;
  } catch {
    return undefined;
  }
}
