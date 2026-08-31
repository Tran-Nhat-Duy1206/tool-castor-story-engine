import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ChapterMeta } from "../models/chapter.js";
import { StateManager } from "../state/manager.js";
import { syncChapterWordCounts } from "../state/chapter-word-sync.js";

function chapterEntry(number: number, title: string, wordCount: number): ChapterMeta {
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
  readonly language?: "vi" | "en";
  readonly chapters: ReadonlyArray<{ readonly file: string; readonly content: string }>;
  readonly index: ReadonlyArray<ChapterMeta>;
}): Promise<{ readonly root: string; readonly bookDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "castor-word-sync-"));
  const bookDir = join(root, "books", params.bookId);
  await mkdir(join(bookDir, "chapters"), { recursive: true });
  await writeFile(
    join(bookDir, "book.json"),
    JSON.stringify({ id: params.bookId, title: params.bookId, language: params.language ?? "vi" }),
    "utf-8",
  );
  for (const chapter of params.chapters) {
    await writeFile(join(bookDir, "chapters", chapter.file), chapter.content, "utf-8");
  }
  await writeFile(join(bookDir, "chapters", "index.json"), JSON.stringify(params.index, null, 2), "utf-8");
  return { root, bookDir };
}

describe("syncChapterWordCounts", () => {
  it("recounts drifted chapters from files and updates the index on disk", async () => {
    const { root, bookDir } = await setupBook({
      bookId: "driftbook",
      chapters: [
        // Heading stripped, whitespace stripped: "mock_text。" → 9 chars.
        { file: "0001_mock_text.md", content: "# Chương 1 mock_text\n\nmock_text。" },
        // "mock_text，mock_text。" → 10 chars — index below is already correct.
        { file: "0002_mock_text.md", content: "# Chương 2 mock_text\n\nmock_text，mock_text。" },
      ],
      index: [
        chapterEntry(1, "mock_text", 3000),
        chapterEntry(2, "mock_text", 10),
      ],
    });

    const state = new StateManager(root);
    const result = await syncChapterWordCounts(state, "driftbook");

    expect(result.bookId).toBe("driftbook");
    expect(result.countingMode).toBe("zh_chars");
    expect(result.checkedChapters).toBe(2);
    expect(result.changes).toEqual([
      { number: 1, title: "mock_text", previousWordCount: 3000, wordCount: 9 },
    ]);
    expect(result.missingChapterFiles).toEqual([]);

    const savedIndex = JSON.parse(
      await readFile(join(bookDir, "chapters", "index.json"), "utf-8"),
    ) as ChapterMeta[];
    expect(savedIndex.find((c) => c.number === 1)?.wordCount).toBe(9);
    expect(savedIndex.find((c) => c.number === 2)?.wordCount).toBe(10);
  });

  it("reports no changes when the index already matches the files", async () => {
    const { root } = await setupBook({
      bookId: "steadybook",
      chapters: [{ file: "0001_mock_text.md", content: "# Chương 1 mock_text\n\nmock_text。" }],
      index: [chapterEntry(1, "mock_text", 9)],
    });

    const state = new StateManager(root);
    const result = await syncChapterWordCounts(state, "steadybook");

    expect(result.changes).toEqual([]);
    expect(result.checkedChapters).toBe(1);
  });

  it("counts English books in words", async () => {
    const { root } = await setupBook({
      bookId: "enbook",
      language: "en",
      chapters: [{ file: "0001_the_pier.md", content: "# Chapter 1 The Pier\n\nThe wind came off the pier at dusk." }],
      index: [chapterEntry(1, "The Pier", 3)],
    });

    const state = new StateManager(root);
    const result = await syncChapterWordCounts(state, "enbook");

    expect(result.countingMode).toBe("en_words");
    expect(result.changes).toEqual([
      { number: 1, title: "The Pier", previousWordCount: 3, wordCount: 8 },
    ]);
  });

  it("leaves entries without a chapter file untouched and reports them", async () => {
    const { root, bookDir } = await setupBook({
      bookId: "gapbook",
      chapters: [{ file: "0001_mock_text.md", content: "# Chương 1 mock_text\n\nmock_text。" }],
      index: [
        chapterEntry(1, "mock_text", 1),
        chapterEntry(2, "mock_text", 777),
      ],
    });

    const state = new StateManager(root);
    const result = await syncChapterWordCounts(state, "gapbook");

    expect(result.missingChapterFiles).toEqual([2]);
    expect(result.changes).toEqual([
      { number: 1, title: "mock_text", previousWordCount: 1, wordCount: 9 },
    ]);

    const savedIndex = JSON.parse(
      await readFile(join(bookDir, "chapters", "index.json"), "utf-8"),
    ) as ChapterMeta[];
    expect(savedIndex.find((c) => c.number === 2)?.wordCount).toBe(777);
  });
});
