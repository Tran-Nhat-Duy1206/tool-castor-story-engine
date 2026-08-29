import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const logMock = vi.fn();
const logErrorMock = vi.fn();
let projectRoot = "";

vi.mock("../utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils.js")>()),
  findProjectRoot: () => projectRoot,
  log: (message: string) => logMock(message),
  logError: (message: string) => logErrorMock(message),
}));

interface ChapterEntry {
  readonly number: number;
  readonly title: string;
  readonly status: string;
  readonly wordCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly auditIssues: ReadonlyArray<string>;
  readonly lengthWarnings: ReadonlyArray<string>;
}

function chapterEntry(number: number, title: string, wordCount: number): ChapterEntry {
  const now = new Date().toISOString();
  return {
    number,
    title,
    status: "ready-for-review",
    wordCount,
    createdAt: now,
    updatedAt: now,
    auditIssues: [],
    lengthWarnings: [],
  };
}

async function setupBook(params: {
  readonly bookId: string;
  readonly chapters: ReadonlyArray<{ readonly file: string; readonly content: string }>;
  readonly index: ReadonlyArray<ChapterEntry>;
  readonly snapshotChapters?: ReadonlyArray<number>;
}): Promise<string> {
  projectRoot = await mkdtemp(join(tmpdir(), "castor-chapter-cmd-"));
  const bookDir = join(projectRoot, "books", params.bookId);
  await mkdir(join(bookDir, "chapters"), { recursive: true });
  await writeFile(
    join(bookDir, "book.json"),
    JSON.stringify({ id: params.bookId, title: params.bookId, language: "zh" }),
    "utf-8",
  );
  for (const chapter of params.chapters) {
    await writeFile(join(bookDir, "chapters", chapter.file), chapter.content, "utf-8");
  }
  await writeFile(join(bookDir, "chapters", "index.json"), JSON.stringify(params.index, null, 2), "utf-8");

  const storyDir = join(bookDir, "story");
  await mkdir(storyDir, { recursive: true });
  await writeFile(join(storyDir, "current_state.md"), "state after latest", "utf-8");
  await writeFile(join(storyDir, "pending_hooks.md"), "hooks after latest", "utf-8");
  for (const snapshotChapter of params.snapshotChapters ?? []) {
    const snapshotDir = join(storyDir, "snapshots", String(snapshotChapter));
    await mkdir(snapshotDir, { recursive: true });
    await writeFile(join(snapshotDir, "current_state.md"), `state at ${snapshotChapter}`, "utf-8");
    await writeFile(join(snapshotDir, "pending_hooks.md"), `hooks at ${snapshotChapter}`, "utf-8");
  }
  return bookDir;
}

describe("castor chapter sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("recounts drifted chapters and prints JSON with --json", async () => {
    const bookDir = await setupBook({
      bookId: "driftbook",
      chapters: [
        // "风从码头吹进巷子。" → 9 chars after stripping heading + whitespace.
        { file: "0001_起风.md", content: "# 第1章 起风\n\n风从码头吹进巷子。" },
      ],
      index: [chapterEntry(1, "起风", 3000)],
    });

    const { chapterCommand } = await import("../commands/chapter.js");
    await chapterCommand.parseAsync(["node", "chapter", "sync", "driftbook", "--json"], { from: "node" });

    expect(logErrorMock).not.toHaveBeenCalled();
    const output = JSON.parse(logMock.mock.calls.at(-1)?.[0] as string) as {
      changes: ReadonlyArray<{ number: number; previousWordCount: number; wordCount: number }>;
    };
    expect(output.changes).toEqual([
      expect.objectContaining({ number: 1, previousWordCount: 3000, wordCount: 9 }),
    ]);

    const savedIndex = JSON.parse(await readFile(join(bookDir, "chapters", "index.json"), "utf-8")) as ChapterEntry[];
    expect(savedIndex[0]?.wordCount).toBe(9);
  });

  it("prints a bilingual summary when the index is already in sync", async () => {
    await setupBook({
      bookId: "steadybook",
      chapters: [{ file: "0001_起风.md", content: "# 第1章 起风\n\n风从码头吹进巷子。" }],
      index: [chapterEntry(1, "起风", 9)],
    });

    const { chapterCommand } = await import("../commands/chapter.js");
    await chapterCommand.parseAsync(["node", "chapter", "sync", "steadybook"], { from: "node" });

    expect(logErrorMock).not.toHaveBeenCalled();
    const printed = logMock.mock.calls.map((call) => call[0] as string).join("\n");
    expect(printed).toContain("Đã đối chiếu 1 chương");
  });
});

describe("castor chapter delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes the latest chapter with --force and prints JSON with --json", async () => {
    const bookDir = await setupBook({
      bookId: "delbook",
      chapters: [
        { file: "0001_起风.md", content: "第一章。" },
        { file: "0002_落雨.md", content: "第二章。" },
      ],
      index: [chapterEntry(1, "起风", 4), chapterEntry(2, "落雨", 4)],
      snapshotChapters: [1, 2],
    });

    const { chapterCommand } = await import("../commands/chapter.js");
    await chapterCommand.parseAsync(["node", "chapter", "delete", "delbook", "--force", "--json"], { from: "node" });

    expect(logErrorMock).not.toHaveBeenCalled();
    const output = JSON.parse(logMock.mock.calls.at(-1)?.[0] as string) as {
      deletedChapter: number;
      rolledBackTo: number;
      trashedFiles: ReadonlyArray<string>;
    };
    expect(output.deletedChapter).toBe(2);
    expect(output.rolledBackTo).toBe(1);
    expect(output.trashedFiles).toEqual(["chapters/.trash/0002_落雨.md"]);

    const savedIndex = JSON.parse(await readFile(join(bookDir, "chapters", "index.json"), "utf-8")) as ChapterEntry[];
    expect(savedIndex.map((c) => c.number)).toEqual([1]);
    await expect(readFile(join(bookDir, "chapters", ".trash", "0002_落雨.md"), "utf-8"))
      .resolves.toBe("第二章。");
  });

  it("fails with exit code 1 when asked to delete a non-latest chapter", async () => {
    await setupBook({
      bookId: "midbook",
      chapters: [
        { file: "0001_起风.md", content: "第一章。" },
        { file: "0002_落雨.md", content: "第二章。" },
      ],
      index: [chapterEntry(1, "起风", 4), chapterEntry(2, "落雨", 4)],
      snapshotChapters: [1, 2],
    });

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    try {
      const { chapterCommand } = await import("../commands/chapter.js");
      await chapterCommand.parseAsync(["node", "chapter", "delete", "midbook", "--chapter", "1", "--force"], { from: "node" });

      expect(logErrorMock).toHaveBeenCalledWith(expect.stringContaining("latest chapter"));
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore();
    }
  });
});
