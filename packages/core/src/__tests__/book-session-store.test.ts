import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadBookSession,
  persistBookSession,
  listBookSessions,
  renameBookSession,
  deleteBookSession,
  migrateBookSession,
  createAndPersistBookSession,
  extractFirstUserMessageTitle,
  SessionAlreadyMigratedError,
} from "../interaction/book-session-store.js";
import { createBookSession, appendBookSessionMessage } from "../interaction/session.js";
import {
  appendManualSessionMessages,
  legacyBookSessionPath,
  readTranscriptEvents,
  sessionsDir,
} from "../interaction/session-transcript.js";
import { restoreAgentMessagesFromTranscript } from "../interaction/session-transcript-restore.js";

describe("book-session-store", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "castor-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("persistBookSession + loadBookSession", () => {
    it("round-trips a session", async () => {
      const session = createBookSession("my-book");
      await persistBookSession(tempDir, session);
      const loaded = await loadBookSession(tempDir, session.sessionId);
      expect(loaded).not.toBeNull();
      expect(loaded!.sessionId).toBe(session.sessionId);
      expect(loaded!.bookId).toBe("my-book");
    });

    it("returns null for non-existent session", async () => {
      const loaded = await loadBookSession(tempDir, "nonexistent");
      expect(loaded).toBeNull();
    });

    it("persists messages", async () => {
      let session = createBookSession("book");
      session = appendBookSessionMessage(session, { role: "user" as const, content: "test", timestamp: 100 });
      await persistBookSession(tempDir, session);
      const loaded = await loadBookSession(tempDir, session.sessionId);
      expect(loaded!.messages).toHaveLength(1);
      expect(loaded!.messages[0].content).toBe("test");
    });

    it("createBookSession initializes title as null", () => {
      const session = createBookSession("book");
      expect(session.title).toBeNull();
    });

    it("parses old session files without title field", async () => {
      const oldFormat = {
        sessionId: "old-session",
        bookId: "book",
        messages: [],
        draftRounds: [],
        events: [],
        createdAt: 1000,
        updatedAt: 1000,
      };
      const dir = join(tempDir, ".castor", "sessions");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "old-session.json"), JSON.stringify(oldFormat));

      const loaded = await loadBookSession(tempDir, "old-session");
      expect(loaded).not.toBeNull();
      expect(loaded!.title).toBeNull();
    });

    it("round-trips title through persist/load", async () => {
      let session = createBookSession("book");
      session = { ...session, title: "Testmock_text" };
      await persistBookSession(tempDir, session);

      const loaded = await loadBookSession(tempDir, session.sessionId);
      expect(loaded!.title).toBe("Testmock_text");
    });

    it("mock_text legacy JSON mock_text JSONL mock_text UI thinking", async () => {
      const session = {
        ...createBookSession("book-a", "legacy-1"),
        messages: [
          { role: "user" as const, content: "mock_text", timestamp: 10 },
          { role: "assistant" as const, content: "mock_text", thinking: "mock_text", timestamp: 11 },
        ],
      };
      await persistBookSession(tempDir, session);

      const loaded = await loadBookSession(tempDir, "legacy-1");

      expect(loaded).toMatchObject({
        sessionId: "legacy-1",
        bookId: "book-a",
        messages: [
          { role: "user", content: "mock_text" },
          { role: "assistant", content: "mock_text", thinking: "mock_text" },
        ],
      });
      await expect(readFile(join(tempDir, ".castor", "sessions", "legacy-1.jsonl"), "utf-8"))
        .resolves
        .toContain("request_committed");
    });

    it("does not duplicate legacy messages when migration runs concurrently", async () => {
      const legacy = createBookSession("book-a", "legacy-race");
      const withMessages = {
        ...legacy,
        messages: [
          { role: "user" as const, content: "old user", timestamp: legacy.createdAt },
          { role: "assistant" as const, content: "old assistant", timestamp: legacy.createdAt + 1 },
        ],
      };
      await mkdir(sessionsDir(tempDir), { recursive: true });
      await writeFile(
        legacyBookSessionPath(tempDir, "legacy-race"),
        JSON.stringify(withMessages, null, 2),
        "utf-8",
      );

      const [first, second] = await Promise.all([
        loadBookSession(tempDir, "legacy-race"),
        loadBookSession(tempDir, "legacy-race"),
      ]);

      expect(first?.messages).toHaveLength(2);
      expect(second?.messages).toHaveLength(2);

      const restored = await restoreAgentMessagesFromTranscript(tempDir, "legacy-race");
      expect(restored.map((message) => message.role)).toEqual(["user", "assistant"]);
    });

    it("createAndPersistBookSession mock_text session mock_text JSONL mock_text legacy JSON", async () => {
      const session = await createAndPersistBookSession(tempDir, "book-a", "123456-abcdef");

      expect(session.sessionId).toBe("123456-abcdef");
      await expect(readFile(join(tempDir, ".castor", "sessions", "123456-abcdef.jsonl"), "utf-8"))
        .resolves
        .toContain("session_created");
      await expect(readFile(join(tempDir, ".castor", "sessions", "123456-abcdef.json"), "utf-8"))
        .rejects
        .toThrow();
    });

    it("persists and restores playMode for play sessions", async () => {
      const session = await createAndPersistBookSession(tempDir, null, "123456-playmd", "play", { playMode: "guided" });

      expect(session.playMode).toBe("guided");
      const loaded = await loadBookSession(tempDir, "123456-playmd");
      expect(loaded?.playMode).toBe("guided");
      const list = await listBookSessions(tempDir, null);
      expect(list.find((item) => item.sessionId === "123456-playmd")?.playMode).toBe("guided");
    });

    it("does not duplicate session_created when explicit session creation races", async () => {
      await Promise.all([
        createAndPersistBookSession(tempDir, "book-a", "create-race"),
        createAndPersistBookSession(tempDir, "book-a", "create-race"),
      ]);

      const events = await readTranscriptEvents(tempDir, "create-race");
      expect(events.filter((event) => event.type === "session_created")).toHaveLength(1);
      expect(events.map((event) => event.seq)).toEqual([1]);
    });

    it("renameBookSession mock_text metadata event mock_text JSONL mock_text", async () => {
      await createAndPersistBookSession(tempDir, "book-a", "123456-abcdef");

      const renamed = await renameBookSession(tempDir, "123456-abcdef", "mock_text");

      expect(renamed!.title).toBe("mock_text");
      const loaded = await loadBookSession(tempDir, "123456-abcdef");
      expect(loaded!.title).toBe("mock_text");
    });

    it("listBookSessions mock_text JSONL session mock_text legacy JSON session", async () => {
      await createAndPersistBookSession(tempDir, "book-a", "123456-abcdef");
      const dir = join(tempDir, ".castor", "sessions");
      await mkdir(dir, { recursive: true });
      const legacy = { ...createBookSession("book-a", "legacy-1"), updatedAt: 999 };
      await writeFile(join(dir, "legacy-1.json"), JSON.stringify(legacy));

      const list = await listBookSessions(tempDir, "book-a");

      expect(list.map((entry) => entry.sessionId).sort()).toEqual(["123456-abcdef", "legacy-1"]);
    });
  });

  describe("listBookSessions", () => {
    it("returns empty for no sessions", async () => {
      const list = await listBookSessions(tempDir, "no-book");
      expect(list).toEqual([]);
    });

    it("filters by bookId", async () => {
      const s1 = createBookSession("book-a");
      const s2 = createBookSession("book-b");
      const s3 = createBookSession("book-a");
      await persistBookSession(tempDir, s1);
      await persistBookSession(tempDir, s2);
      await persistBookSession(tempDir, s3);

      const listA = await listBookSessions(tempDir, "book-a");
      expect(listA).toHaveLength(2);
      expect(listA.every((s) => s.bookId === "book-a")).toBe(true);

      const listB = await listBookSessions(tempDir, "book-b");
      expect(listB).toHaveLength(1);
    });

    it("sorts by updatedAt descending", async () => {
      const s1 = { ...createBookSession("book"), updatedAt: 100 };
      const s2 = { ...createBookSession("book"), updatedAt: 300 };
      const s3 = { ...createBookSession("book"), updatedAt: 200 };
      await persistBookSession(tempDir, s1);
      await persistBookSession(tempDir, s2);
      await persistBookSession(tempDir, s3);

      const list = await listBookSessions(tempDir, "book");
      expect(list[0].updatedAt).toBe(300);
      expect(list[1].updatedAt).toBe(200);
      expect(list[2].updatedAt).toBe(100);
    });

    it("updates session activity time from committed chat messages", async () => {
      const session = await createAndPersistBookSession(tempDir, "book", "chat-activity");
      await new Promise((resolve) => setTimeout(resolve, 5));

      await appendManualSessionMessages(tempDir, session.sessionId, [{
        role: "user",
        content: "mock_text",
        timestamp: Date.now(),
      } as any]);

      const loaded = await loadBookSession(tempDir, session.sessionId);
      expect(loaded?.updatedAt).toBeGreaterThan(session.updatedAt);
    });

    it("lists null bookId sessions", async () => {
      const s = createBookSession(null);
      await persistBookSession(tempDir, s);
      const list = await listBookSessions(tempDir, null);
      expect(list).toHaveLength(1);
    });
  });

  describe("renameBookSession", () => {
    it("sets title and updates updatedAt", async () => {
      const session = createBookSession("book");
      await persistBookSession(tempDir, session);
      const oldUpdatedAt = session.updatedAt;

      await new Promise((resolve) => setTimeout(resolve, 5));
      await renameBookSession(tempDir, session.sessionId, "mock_text");

      const loaded = await loadBookSession(tempDir, session.sessionId);
      expect(loaded!.title).toBe("mock_text");
      expect(loaded!.updatedAt).toBeGreaterThan(oldUpdatedAt);
    });

    it("returns null for non-existent session", async () => {
      const result = await renameBookSession(tempDir, "nonexistent", "title");
      expect(result).toBeNull();
    });

    it("assigns unique seq for concurrent metadata updates", async () => {
      await createAndPersistBookSession(tempDir, "book-a", "metadata-race");

      await Promise.all([
        renameBookSession(tempDir, "metadata-race", "mock_text A"),
        renameBookSession(tempDir, "metadata-race", "mock_text B"),
      ]);

      const events = await readTranscriptEvents(tempDir, "metadata-race");
      expect(events.map((event) => event.seq)).toEqual([1, 2, 3]);
      expect(new Set(events.map((event) => event.seq)).size).toBe(events.length);
    });
  });

  describe("deleteBookSession", () => {
    it("removes session file", async () => {
      const session = createBookSession("book");
      await persistBookSession(tempDir, session);

      await deleteBookSession(tempDir, session.sessionId);

      const loaded = await loadBookSession(tempDir, session.sessionId);
      expect(loaded).toBeNull();
    });

    it("does nothing for non-existent session", async () => {
      await expect(deleteBookSession(tempDir, "nonexistent")).resolves.toBeUndefined();
    });
  });

  describe("extractFirstUserMessageTitle", () => {
    it("returns null when messages array is empty", () => {
      expect(extractFirstUserMessageTitle([])).toBeNull();
    });

    it("returns null when no user message exists", () => {
      expect(extractFirstUserMessageTitle([
        { role: "assistant", content: "hi" },
        { role: "system", content: "prompt" },
      ])).toBeNull();
    });

    it("picks the first user message content", () => {
      expect(extractFirstUserMessageTitle([
        { role: "system", content: "sys" },
        { role: "user", content: "Chương mock_text" },
        { role: "assistant", content: "mock_text" },
        { role: "user", content: "Chương mock_text" },
      ])).toBe("Chương mock_text");
    });

    it("collapses whitespace into single spaces", () => {
      expect(extractFirstUserMessageTitle([
        { role: "user", content: "mock_text\n\nmock_text   mock_text" },
      ])).toBe("mock_text mock_text mock_text");
    });

    it("truncates content longer than 20 chars with ellipsis", () => {
      expect(extractFirstUserMessageTitle([
        { role: "user", content: "mock_text từmock_text" },
      ])).toBe("mock_text từmock_text…");
    });

    it("returns null when content is only whitespace", () => {
      expect(extractFirstUserMessageTitle([
        { role: "user", content: "   \n\t   " },
      ])).toBeNull();
    });

    it("returns null for non-array input", () => {
      expect(extractFirstUserMessageTitle(null)).toBeNull();
      expect(extractFirstUserMessageTitle(undefined)).toBeNull();
      expect(extractFirstUserMessageTitle("not array")).toBeNull();
    });
  });

  describe("listBookSessions: mock_text session lazy migration", () => {
    it("mock_text title mock_text null mock_text session mock_text title mock_text", async () => {
      const session = {
        ...createBookSession("book-a"),
        title: null,
        messages: [
          { role: "user" as const, content: "mock_text", timestamp: 100 },
          { role: "assistant" as const, content: "mock_text，mock_text...", timestamp: 200 },
        ],
      };
      await persistBookSession(tempDir, session);

      // mock_text list → mock_text
      const list = await listBookSessions(tempDir, "book-a");
      expect(list).toHaveLength(1);
      expect(list[0].title).toBe("mock_text");

      // mock_text
      const reloaded = await loadBookSession(tempDir, session.sessionId);
      expect(reloaded!.title).toBe("mock_text");
    });

    it("mock_text title mock_text session", async () => {
      let session = createBookSession("book-a");
      session = {
        ...session,
        title: "mock_text",
        messages: [
          { role: "user" as const, content: "mock_text", timestamp: 100 },
        ],
      };
      await persistBookSession(tempDir, session);

      const list = await listBookSessions(tempDir, "book-a");
      expect(list[0].title).toBe("mock_text");

      const reloaded = await loadBookSession(tempDir, session.sessionId);
      expect(reloaded!.title).toBe("mock_text");
    });

    it("mock_text session：title mock_text null，mock_text persist", async () => {
      const session = createBookSession("book-a");
      await persistBookSession(tempDir, session);
      const originalUpdatedAt = session.updatedAt;

      const list = await listBookSessions(tempDir, "book-a");
      expect(list[0].title).toBeNull();

      const reloaded = await loadBookSession(tempDir, session.sessionId);
      expect(reloaded!.title).toBeNull();
      expect(reloaded!.updatedAt).toBe(originalUpdatedAt);
    });

    it("mock_text session mock_text", async () => {
      const s1 = {
        ...createBookSession("book-b"),
        title: null,
        messages: [{ role: "user" as const, content: "mock_text", timestamp: 1 }],
      };
      const s2 = {
        ...createBookSession("book-b"),
        title: null,
        messages: [{ role: "user" as const, content: "mock_text", timestamp: 1 }],
      };
      await persistBookSession(tempDir, s1);
      await persistBookSession(tempDir, s2);

      const list = await listBookSessions(tempDir, "book-b");
      expect(list).toHaveLength(2);
      const titles = new Set(list.map((s) => s.title));
      expect(titles).toEqual(new Set(["mock_text", "mock_text"]));
    });
  });

  describe("migrateBookSession", () => {
    it("binds an orphan session to a book", async () => {
      const session = createBookSession(null);
      await persistBookSession(tempDir, session);
      const oldUpdatedAt = session.updatedAt;

      await new Promise((resolve) => setTimeout(resolve, 5));
      const migrated = await migrateBookSession(tempDir, session.sessionId, "book-1");

      expect(migrated).not.toBeNull();
      expect(migrated!.bookId).toBe("book-1");
      expect(migrated!.updatedAt).toBeGreaterThan(oldUpdatedAt);
    });

    it("returns null for non-existent session", async () => {
      const result = await migrateBookSession(tempDir, "nonexistent", "book-1");
      expect(result).toBeNull();
    });

    it("throws when session is already bound to a book", async () => {
      const session = createBookSession("book-1");
      await persistBookSession(tempDir, session);

      await expect(migrateBookSession(tempDir, session.sessionId, "book-2")).rejects.toBeInstanceOf(
        SessionAlreadyMigratedError,
      );
    });
  });
});
