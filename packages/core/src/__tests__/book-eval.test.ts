import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { StateManager } from "../state/manager.js";
import { evaluateBookQuality } from "../utils/book-eval.js";

describe("evaluateBookQuality", () => {
  let root = "";

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("computes a reusable quality report from a persisted book", async () => {
    root = await mkdtemp(join(tmpdir(), "castor-book-eval-"));
    const state = new StateManager(root);
    const now = new Date().toISOString();
    const book = {
      id: "demo-book",
      title: "Demo Book",
      platform: "other" as const,
      genre: "other" as const,
      status: "active" as const,
      targetChapters: 10,
      chapterWordCount: 1200,
      createdAt: now,
      updatedAt: now,
    };
    await state.saveBookConfig(book.id, book);
    await state.ensureControlDocuments(book.id);
    await state.saveChapterIndex(book.id, [
      { number: 1, title: "Chương mock_text", status: "approved", wordCount: 1200, auditIssues: [], lengthWarnings: [], createdAt: now, updatedAt: now },
      { number: 2, title: "Chương mock_text", status: "audit-failed", wordCount: 900, auditIssues: ["pov drift"], lengthWarnings: [], createdAt: now, updatedAt: now },
    ]);
    const bookDir = state.bookDir(book.id);
    await mkdir(join(bookDir, "chapters"), { recursive: true });
    await writeFile(join(bookDir, "chapters", "0001_Chương mock_text.md"), "# Chương mock_text\n\nmock_text，mock_text。", "utf-8");
    await writeFile(join(bookDir, "chapters", "0002_Chương mock_text.md"), "# Chương mock_text\n\nmock_text。\n\nmock_text。", "utf-8");
    await writeFile(join(bookDir, "story", "pending_hooks.md"), "| mock_text | mock_text |\n| --- | --- |\n| mock_text | mock_text |\n", "utf-8");

    const report = await evaluateBookQuality({ state, bookId: book.id });

    expect(report).toMatchObject({
      bookId: "demo-book",
      totalChapters: 2,
      duplicateTitles: 1,
      hookResolveRate: 100,
    });
    expect(report.qualityScore).toBeGreaterThanOrEqual(0);
    expect(report.qualityTrend).toHaveLength(2);
    expect(report.chapters[1]).toMatchObject({
      number: 2,
      auditIssueCount: 1,
      status: "audit-failed",
    });
  });
});
