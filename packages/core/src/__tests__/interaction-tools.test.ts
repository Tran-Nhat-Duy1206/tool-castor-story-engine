import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createLogger, type LogSink } from "../index.js";
import {
  buildChapterFileLookup,
  createInteractionToolsFromDeps,
} from "../interaction/project-tools.js";

let projectRoot: string;

function noopBookLock() {
  return vi.fn(async () => async () => undefined);
}

describe("interaction tools", () => {
  beforeAll(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "castor-core-interaction-tools-"));
    await mkdir(join(projectRoot, "books", "harbor", "story"), { recursive: true });
  });

  it("delegates writeNextChapter and reviseDraft to the pipeline", async () => {
    const events: string[] = [];
    const sink: LogSink = {
      write(entry) {
        events.push(entry.message);
      },
    };
    const pipeline = {
      config: {
        logger: createLogger({ tag: "test", sinks: [sink] }),
      },
      writeNextChapter: vi.fn(async () => ({
        config: undefined,
        chapterNumber: 1,
        title: "Draft",
        wordCount: 1000,
        revised: false,
        status: "ready-for-review" as const,
        auditResult: { passed: true, issues: [], summary: "ok" },
      })),
      reviseDraft: vi.fn(async () => ({
        chapterNumber: 3,
        wordCount: 1200,
        fixedIssues: [],
        applied: true,
        status: "ready-for-review" as const,
      })),
    };
    const state = {
      ensureControlDocuments: vi.fn(async () => {}),
      bookDir: vi.fn((bookId: string) => join(projectRoot, "books", bookId)),
      loadBookConfig: vi.fn(async () => ({
        id: "harbor",
        title: "Harbor",
        platform: "other" as const,
        genre: "other",
        status: "outlining" as const,
        targetChapters: 200,
        chapterWordCount: 3000,
        createdAt: "2026-04-10T00:00:00.000Z",
        updatedAt: "2026-04-10T00:00:00.000Z",
      })),
      loadChapterIndex: vi.fn(async () => []),
      saveChapterIndex: vi.fn(async () => undefined),
      listBooks: vi.fn(async () => ["harbor"]),
      acquireBookLock: noopBookLock(),
    };

    const tools = createInteractionToolsFromDeps(pipeline, state);

    const writeResult = await tools.writeNextChapter("harbor");
    await tools.reviseDraft("harbor", 3, "rewrite");

    expect(pipeline.writeNextChapter).toHaveBeenCalledWith("harbor");
    expect(pipeline.reviseDraft).toHaveBeenCalledWith("harbor", 3, "rewrite");
    expect((writeResult as { __interaction?: { activeChapterNumber?: number } }).__interaction?.activeChapterNumber).toBe(1);
    expect(events).toEqual([]);
  });

  it("takes the book lock before deterministic text edit transactions", async () => {
    const root = await mkdtemp(join(tmpdir(), "castor-core-interaction-lock-"));
    try {
      await mkdir(join(root, "books", "harbor", "story"), { recursive: true });
      await mkdir(join(root, "books", "harbor", "chapters"), { recursive: true });
      await writeFile(join(root, "books", "harbor", "story", "story_bible.md"), "Alpha leads.\n", "utf-8");
      await writeFile(join(root, "books", "harbor", "chapters", "0001_Start.md"), "# Start\n\nAlpha meets Gamma.\n", "utf-8");
      await writeFile(join(root, "books", "harbor", "chapters", "index.json"), JSON.stringify([{
        number: 1,
        title: "Start",
        status: "audit-failed",
        wordCount: 20,
        createdAt: "2026-04-10T00:00:00.000Z",
        updatedAt: "2026-04-10T00:00:00.000Z",
        auditIssues: [],
        lengthWarnings: [],
      }]), "utf-8");

      let releases = 0;
      const acquireBookLock = vi.fn(async () => async () => {
        releases += 1;
      });
      const pipeline = {
        writeNextChapter: vi.fn(),
        reviseDraft: vi.fn(),
      };
      const state = {
        ensureControlDocuments: vi.fn(async () => {}),
        bookDir: vi.fn((bookId: string) => join(root, "books", bookId)),
        loadBookConfig: vi.fn(),
        loadChapterIndex: vi.fn(async () => JSON.parse(await readFile(join(root, "books", "harbor", "chapters", "index.json"), "utf-8"))),
        saveChapterIndex: vi.fn(async (_bookId: string, index) => {
          await writeFile(join(root, "books", "harbor", "chapters", "index.json"), JSON.stringify(index, null, 2), "utf-8");
        }),
        listBooks: vi.fn(async () => ["harbor"]),
        acquireBookLock,
      };
      const tools = createInteractionToolsFromDeps(pipeline as never, state as never);

      await tools.renameEntity("harbor", "Alpha", "Beta");
      await tools.patchChapterText("harbor", 1, "Gamma", "Delta");

      expect(acquireBookLock).toHaveBeenNthCalledWith(1, "harbor");
      expect(acquireBookLock).toHaveBeenNthCalledWith(2, "harbor");
      expect(releases).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("captures pipeline stage logs into interaction events", async () => {
    const pipeline = {
      config: {
        logger: createLogger({
          tag: "test",
          sinks: [{
            write() {},
          }],
        }),
      },
      writeNextChapter: vi.fn(async function (this: { config: { logger?: { info: (msg: string) => void } } }) {
        this.config.logger?.info("Stage: preparing chapter inputs");
        this.config.logger?.info("Stage: writing chapter draft");
        return {
          chapterNumber: 4,
          title: "Draft",
          wordCount: 1000,
          revised: false,
          status: "ready-for-review" as const,
          auditResult: { passed: true, issues: [], summary: "ok" },
        };
      }),
      reviseDraft: vi.fn(async () => ({
        chapterNumber: 3,
        wordCount: 1200,
        fixedIssues: [],
        applied: true,
        status: "ready-for-review" as const,
      })),
    };
    const state = {
      ensureControlDocuments: vi.fn(async () => {}),
      bookDir: vi.fn((bookId: string) => join(projectRoot, "books", bookId)),
      loadBookConfig: vi.fn(async () => ({
        id: "harbor",
        title: "Harbor",
        platform: "other" as const,
        genre: "other",
        status: "outlining" as const,
        targetChapters: 200,
        chapterWordCount: 3000,
        createdAt: "2026-04-10T00:00:00.000Z",
        updatedAt: "2026-04-10T00:00:00.000Z",
      })),
      loadChapterIndex: vi.fn(async () => []),
      saveChapterIndex: vi.fn(async () => undefined),
      listBooks: vi.fn(async () => ["harbor"]),
      acquireBookLock: noopBookLock(),
    };

    const tools = createInteractionToolsFromDeps(pipeline, state);
    const result = await tools.writeNextChapter("harbor");

    expect((result as {
      __interaction?: {
        events?: ReadonlyArray<{ kind: string; status: string; detail?: string }>;
      };
    }).__interaction?.events).toEqual([
      expect.objectContaining({ kind: "stage.changed", status: "planning", detail: "preparing chapter inputs" }),
      expect.objectContaining({ kind: "stage.changed", status: "writing", detail: "writing chapter draft" }),
    ]);
  });

  it("writes current_focus and author_intent into canonical story paths", async () => {
    const tools = createInteractionToolsFromDeps(
      {
        writeNextChapter: vi.fn(async () => ({
          chapterNumber: 1,
          title: "Draft",
          wordCount: 1000,
          revised: false,
          status: "ready-for-review" as const,
          auditResult: { passed: true, issues: [], summary: "ok" },
        })),
        reviseDraft: vi.fn(async () => ({
          chapterNumber: 3,
          wordCount: 1200,
          fixedIssues: [],
          applied: true,
          status: "ready-for-review" as const,
        })),
      },
      {
        ensureControlDocuments: vi.fn(async () => {}),
        bookDir: vi.fn((bookId: string) => join(projectRoot, "books", bookId)),
        loadBookConfig: vi.fn(async () => ({
          id: "harbor",
          title: "Harbor",
          platform: "other" as const,
          genre: "other",
          status: "outlining" as const,
          targetChapters: 200,
          chapterWordCount: 3000,
          createdAt: "2026-04-10T00:00:00.000Z",
          updatedAt: "2026-04-10T00:00:00.000Z",
        })),
        loadChapterIndex: vi.fn(async () => []),
        saveChapterIndex: vi.fn(async () => undefined),
        listBooks: vi.fn(async () => ["harbor"]),
        acquireBookLock: noopBookLock(),
      },
    );

    await tools.updateCurrentFocus("harbor", "# Current Focus\n\nBring focus back.\n");
    await tools.updateAuthorIntent("harbor", "# Author Intent\n\nWrite a harbor mystery.\n");

    await expect(readFile(join(projectRoot, "books", "harbor", "story", "current_focus.md"), "utf-8"))
      .resolves.toContain("Bring focus back");
    await expect(readFile(join(projectRoot, "books", "harbor", "story", "author_intent.md"), "utf-8"))
      .resolves.toContain("harbor mystery");
  });

  it("rejects truth-file writes outside the canonical truth-file allowlist", async () => {
    const tools = createInteractionToolsFromDeps(
      {
        writeNextChapter: vi.fn(async () => ({
          chapterNumber: 1,
          title: "Draft",
          wordCount: 1000,
          revised: false,
          status: "ready-for-review" as const,
          auditResult: { passed: true, issues: [], summary: "ok" },
        })),
        reviseDraft: vi.fn(async () => ({
          chapterNumber: 3,
          wordCount: 1200,
          fixedIssues: [],
          applied: true,
          status: "ready-for-review" as const,
        })),
      },
      {
        ensureControlDocuments: vi.fn(async () => {}),
        bookDir: vi.fn((bookId: string) => join(projectRoot, "books", bookId)),
        loadBookConfig: vi.fn(async () => ({
          id: "harbor",
          title: "Harbor",
          platform: "other" as const,
          genre: "other",
          status: "outlining" as const,
          targetChapters: 200,
          chapterWordCount: 3000,
          createdAt: "2026-04-10T00:00:00.000Z",
          updatedAt: "2026-04-10T00:00:00.000Z",
        })),
        loadChapterIndex: vi.fn(async () => []),
        saveChapterIndex: vi.fn(async () => undefined),
        listBooks: vi.fn(async () => ["harbor"]),
        acquireBookLock: noopBookLock(),
      },
    );

    await expect(tools.writeTruthFile("harbor", "runtime/agent_notes.md", "notes"))
      .rejects.toThrow("Invalid truth file name");
  });

  it("forwards foundation draft fields into shared book creation", async () => {
    const pipeline = {
      initBook: vi.fn(async () => undefined),
      writeNextChapter: vi.fn(async () => ({
        chapterNumber: 1,
        title: "Draft",
        wordCount: 1000,
        revised: false,
        status: "ready-for-review" as const,
        auditResult: { passed: true, issues: [], summary: "ok" },
      })),
      reviseDraft: vi.fn(async () => ({
        chapterNumber: 3,
        wordCount: 1200,
        fixedIssues: [],
        applied: true,
        status: "ready-for-review" as const,
      })),
    };
    const state = {
      ensureControlDocuments: vi.fn(async () => {}),
      bookDir: vi.fn((bookId: string) => join(projectRoot, "books", bookId)),
      loadBookConfig: vi.fn(async () => ({
        id: "night-harbor",
        title: "Night Harbor",
        platform: "other" as const,
        genre: "urban",
        status: "outlining" as const,
        targetChapters: 120,
        chapterWordCount: 2800,
        createdAt: "2026-04-10T00:00:00.000Z",
        updatedAt: "2026-04-10T00:00:00.000Z",
      })),
      loadChapterIndex: vi.fn(async () => []),
      saveChapterIndex: vi.fn(async () => undefined),
      listBooks: vi.fn(async () => []),
      acquireBookLock: noopBookLock(),
    };

    const tools = createInteractionToolsFromDeps(pipeline, state);
    await tools.createBook?.({
      title: "Night Harbor",
      genre: "urban",
      platform: "tomato",
      chapterWordCount: 2800,
      targetChapters: 120,
      blurb: "mock_text，mock_text，mock_text。",
      worldPremise: "mock_text，mock_text。",
      protagonist: "mock_text，mock_textPhong so sachmock_text，mock_text，mock_text。",
      conflictCore: "mock_text。",
      volumeOutline: "mock_textKiem tra so sach，mock_text。",
      authorIntent: "# mock_text\n\nmock_text、mock_text、mock_text。\n",
      currentFocus: "# mock_text\n\nmock_text。\n",
    });

    expect(pipeline.initBook).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Night Harbor",
        genre: "urban",
        platform: "tomato",
        targetChapters: 120,
        chapterWordCount: 2800,
      }),
      expect.objectContaining({
        externalContext: expect.stringContaining("mock_text"),
        authorIntent: expect.stringContaining("mock_text、mock_text"),
        currentFocus: expect.stringContaining("mock_text"),
      }),
    );
  });

  it("normalizes human-facing platform aliases before creating a book", async () => {
    const pipeline = {
      initBook: vi.fn(async () => undefined),
      writeNextChapter: vi.fn(),
      reviseDraft: vi.fn(),
    };
    const state = {
      ensureControlDocuments: vi.fn(async () => {}),
      bookDir: vi.fn((bookId: string) => join(projectRoot, "books", bookId)),
      loadBookConfig: vi.fn(),
      loadChapterIndex: vi.fn(async () => []),
      saveChapterIndex: vi.fn(async () => undefined),
      listBooks: vi.fn(async () => []),
      acquireBookLock: noopBookLock(),
    };

    const tools = createInteractionToolsFromDeps(pipeline, state);
    await tools.createBook?.({
      title: "Testmock_text",
      genre: "urban",
      platform: "mock_text",
    });

    expect(pipeline.initBook).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "Testmock_text",
        platform: "tomato",
      }),
      expect.any(Object),
    );
  });

  it("builds a reusable chapter lookup from a single directory listing", () => {
    const lookup = buildChapterFileLookup([
      "0001_First.md",
      "0002_Second.md",
      "notes.txt",
      "0002_Second.backup",
    ]);

    expect(lookup.get(1)).toBe("0001_First.md");
    expect(lookup.get(2)).toBe("0002_Second.md");
    expect(lookup.size).toBe(2);
  });
});
