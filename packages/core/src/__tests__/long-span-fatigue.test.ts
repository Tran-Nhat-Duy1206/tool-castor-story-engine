import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  analyzeLongSpanFatigue,
  buildEnglishVarianceBrief,
} from "../utils/long-span-fatigue.js";

async function createBookDir(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const bookDir = join(root, "book");
  await mkdir(join(bookDir, "story"), { recursive: true });
  await mkdir(join(bookDir, "chapters"), { recursive: true });
  return bookDir;
}

async function writeChapter(bookDir: string, chapter: number, title: string, body: string): Promise<void> {
  const filename = `${String(chapter).padStart(4, "0")}_${title}.md`;
  await writeFile(
    join(bookDir, "chapters", filename),
    `# Chương ${chapter}mock_text ${title}\n\n${body}\n`,
    "utf-8",
  );
}

describe("analyzeLongSpanFatigue", () => {
  it("warns when the last three chapter types are identical", async () => {
    const bookDir = await createBookDir("castor-long-span-type-test-");

    await Promise.all([
      writeChapter(bookDir, 1, "mock_text", "mock_text。mock_text，mock_text。mock_text。"),
      writeChapter(bookDir, 2, "mock_text", "mock_text。mock_text，mock_text。mock_text。"),
      writeFile(
        join(bookDir, "story", "chapter_summaries.md"),
        [
          "# mock_text",
          "",
          "| mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text |",
          "|------|------|----------|----------|----------|----------|----------|----------|",
          "| 1 | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text |",
          "| 2 | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text |",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    try {
      const result = await analyzeLongSpanFatigue({
        bookDir,
        chapterNumber: 3,
        chapterContent: "Bong demmock_text。mock_text，mock_text。mock_text，mock_text。",
        chapterSummary: "| 3 | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text |",
        language: "vi",
      });

      expect(result.issues.some((issue) => issue.category === "mock_text")).toBe(true);
    } finally {
      await rm(join(bookDir, ".."), { recursive: true, force: true });
    }
  });

  it("warns in English when recent chapter endings are highly similar", async () => {
    const bookDir = await createBookDir("castor-long-span-ending-test-");

    await Promise.all([
      writeChapter(bookDir, 1, "Debt", "The rain had finally stopped. The harbor lights thinned behind him. He knew the debt had only grown heavier."),
      writeChapter(bookDir, 2, "Weight", "Morning fog crawled over the quay. No one called his name. He knew the debt had only grown heavier tonight."),
    ]);

    try {
      const result = await analyzeLongSpanFatigue({
        bookDir,
        chapterNumber: 3,
        chapterContent: "The alley was empty by the time he turned back. Even the dogs had gone quiet. He knew the debt had only grown heavier again.",
        language: "en",
      });

      expect(result.issues.some((issue) => issue.category === "Ending Pattern Repetition")).toBe(true);
      expect(result.issues.some((issue) => issue.description.includes("last 3 chapter endings"))).toBe(true);
    } finally {
      await rm(join(bookDir, ".."), { recursive: true, force: true });
    }
  });

  it("builds an English variance brief with phrase, opening, ending, and scene guidance", async () => {
    const bookDir = await createBookDir("castor-variance-brief-test-");

    await Promise.all([
      writeChapter(bookDir, 1, "Ledger", "Mara kept the ledger close to her chest. The corridor stayed quiet after the bell. There it was again."),
      writeChapter(bookDir, 2, "Ash", "Mara kept the ledger close to her chest while the ash fell. The corridor stayed quiet until Taryn stopped. There it was again."),
      writeChapter(bookDir, 3, "Harbor", "Mara kept the ledger close to her chest near the harbor gate. The corridor stayed quiet while the guards changed. There it was again."),
      writeFile(
        join(bookDir, "story", "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| 1 | Ledger | Mara | Mara hides the ledger | pressure tightens | none | tense | investigation |",
          "| 2 | Ash | Mara,Taryn | Ash falls over the archive | pressure tightens | none | tense | investigation |",
          "| 3 | Harbor | Mara,Taryn | The gate stays under watch | pressure tightens | none | tense | investigation |",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    try {
      const brief = await buildEnglishVarianceBrief({
        bookDir,
        chapterNumber: 4,
      });

      expect(brief?.highFrequencyPhrases.length).toBeGreaterThan(0);
      expect(brief?.repeatedOpeningPatterns.length).toBeGreaterThan(0);
      expect(brief?.repeatedEndingShapes.length).toBeGreaterThan(0);
      expect(brief?.sceneObligation).toBeTruthy();
      expect(brief?.text).toContain("High-frequency phrases");
      expect(brief?.text).toContain("Scene obligation");
    } finally {
      await rm(join(bookDir, ".."), { recursive: true, force: true });
    }
  });

  it("warns when title focus collapses and high-tension mood never releases", async () => {
    const bookDir = await createBookDir("castor-long-span-cadence-test-");

    await Promise.all([
      writeChapter(bookDir, 1, "mock_text", "mock_text。mock_text，mock_text。"),
      writeChapter(bookDir, 2, "mock_text", "mock_text。mock_text，mock_text。"),
      writeFile(
        join(bookDir, "story", "chapter_summaries.md"),
        [
          "# mock_text",
          "",
          "| mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text |",
          "|------|------|----------|----------|----------|----------|----------|----------|",
          "| 1 | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text、mock_text | mock_text |",
          "| 2 | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text、mock_text | mock_text |",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    try {
      const result = await analyzeLongSpanFatigue({
        bookDir,
        chapterNumber: 3,
        chapterContent: "mock_text。mock_text，mock_text，mock_text。",
        chapterSummary: "| 3 | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text、mock_text | mock_text |",
        language: "vi",
      });

      expect(result.issues.some((issue) => issue.category === "mock_text")).toBe(true);
      expect(result.issues.some((issue) => issue.category === "mock_text")).toBe(true);
    } finally {
      await rm(join(bookDir, ".."), { recursive: true, force: true });
    }
  });
});
