import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { BookSessionSchema, type BookSession } from "./session.js";
import {
  appendTranscriptEvents,
  legacyBookSessionPath,
} from "./session-transcript.js";
import type { MessageEvent } from "./session-transcript-schema.js";

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export async function readLegacyBookSession(
  projectRoot: string,
  sessionId: string,
): Promise<BookSession | null> {
  // Legacy-format .json session: check the canonical tree first, then the
  // pre-rename legacy runtime-dir location (read-only compatibility view).
  const { LEGACY_CASTOR_RUNTIME_DIRNAME } = await import("../config/product-identity.js");
  const legacyDir = join(projectRoot, LEGACY_CASTOR_RUNTIME_DIRNAME, "sessions");
  for (const path of [
    legacyBookSessionPath(projectRoot, sessionId),
    join(legacyDir, `${sessionId}.json`),
  ]) {
    try {
      const raw = await readFile(path, "utf-8");
      return BookSessionSchema.parse(JSON.parse(raw));
    } catch {
      // try the next location
    }
  }
  return null;
}

export async function migrateLegacyBookSessionToTranscript(
  projectRoot: string,
  session: BookSession,
): Promise<void> {
  await appendTranscriptEvents(projectRoot, session.sessionId, ({ events, nextSeq }) => {
    if (events.length > 0) return [];

    const sessionCreatedSeq = nextSeq;
    const requestStartedSeq = nextSeq + 1;
    let messageSeq = nextSeq + 2;
    const requestId = `legacy-${randomUUID()}`;
    const transcriptEvents: MessageEvent[] = [];
    let parentUuid: string | null = null;

    for (const legacyMessage of session.messages) {
      const uuid = randomUUID();
      const message = legacyMessage.role === "assistant"
        ? {
            role: "assistant",
            content: [{ type: "text", text: legacyMessage.content }],
            api: "anthropic-messages",
            provider: "legacy",
            model: "unknown",
            usage: EMPTY_USAGE,
            stopReason: "stop",
            timestamp: legacyMessage.timestamp,
          }
        : {
            role: legacyMessage.role,
            content: legacyMessage.content,
            timestamp: legacyMessage.timestamp,
          };
      transcriptEvents.push({
        type: "message",
        version: 1,
        sessionId: session.sessionId,
        requestId,
        uuid,
        parentUuid,
        seq: messageSeq++,
        role: legacyMessage.role === "assistant" ? "assistant" : legacyMessage.role,
        timestamp: legacyMessage.timestamp,
        ...(legacyMessage.role === "assistant" && legacyMessage.thinking
          ? { legacyDisplay: { thinking: legacyMessage.thinking } }
          : {}),
        message,
      });
      parentUuid = uuid;
    }

    return [
      {
        type: "session_created",
        version: 1,
        sessionId: session.sessionId,
        seq: sessionCreatedSeq,
        timestamp: session.createdAt,
        bookId: session.bookId,
        ...(session.sessionKind ? { sessionKind: session.sessionKind } : {}),
        ...(session.playMode ? { playMode: session.playMode } : {}),
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      },
      {
        type: "request_started",
        version: 1,
        sessionId: session.sessionId,
        requestId,
        seq: requestStartedSeq,
        timestamp: session.createdAt,
        input: "",
      },
      ...transcriptEvents,
      {
        type: "request_committed",
        version: 1,
        sessionId: session.sessionId,
        requestId,
        seq: messageSeq,
        timestamp: session.updatedAt,
      },
    ];
  });
}
