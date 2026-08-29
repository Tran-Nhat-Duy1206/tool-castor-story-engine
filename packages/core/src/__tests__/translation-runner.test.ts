import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createTranslationProjectFromFile,
  runTranslationProject,
  writeTranslationExport,
  type TranslationModelPort,
} from "../translation/index.js";

describe("translation runner", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "castor-translation-runner-"));
    await mkdir(join(root, "inputs"), { recursive: true });
    await writeFile(join(root, "inputs", "book.md"), [
      "# 第一章 雨夜",
      "",
      "第一段。",
      "",
      "第二段。",
    ].join("\n"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("translates pending segments, persists review report, and resumes without duplicate model calls", async () => {
    const created = await createTranslationProjectFromFile(root, {
      filePath: "inputs/book.md",
      sourceLanguage: "zh",
      targetLanguage: "en",
    });
    const translateSegments = vi.fn<TranslationModelPort["translateSegments"]>(async ({ segments }) => ({
      segments: segments.map((segment) => ({
        index: segment.index,
        target: `EN:${segment.source}`,
      })),
      glossary: [{ source: "雨夜", target: "rainy night", note: "chapter tone" }],
    }));
    const reviewChapter = vi.fn<NonNullable<TranslationModelPort["reviewChapter"]>>(async () => ({
      passed: true,
      summary: "ok",
      issues: [],
    }));

    const first = await runTranslationProject(root, created.manifest.id, {
      model: { translateSegments, reviewChapter },
      batchSize: 1,
    });
    expect(first.translatedSegments).toBe(2);
    expect(first.reviewedChapters).toBe(1);
    expect(translateSegments).toHaveBeenCalledTimes(2);

    const report = await readFile(join(root, first.reportPath), "utf-8");
    expect(report).toContain("ok");
    expect(report).toContain("雨夜");

    const second = await runTranslationProject(root, created.manifest.id, {
      model: { translateSegments, reviewChapter },
      batchSize: 1,
    });
    expect(second.translatedSegments).toBe(0);
    expect(translateSegments).toHaveBeenCalledTimes(2);

    const exported = await writeTranslationExport(root, created.manifest.id, { format: "md" });
    const markdown = await readFile(exported.outputPath, "utf-8");
    expect(markdown).toContain("EN:第一段。");
    expect(markdown).toContain("EN:第二段。");
    expect(markdown).not.toContain("\n第一段。\n");
  });
});
