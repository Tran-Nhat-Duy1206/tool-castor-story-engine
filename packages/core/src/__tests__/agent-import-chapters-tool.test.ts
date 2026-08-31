import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateManager } from "../state/manager.js";
import { createImportChaptersTool } from "../agent/agent-tools.js";

function mockPipeline() {
  return {
    runWithAgentContext: vi.fn(async (
      _context: { readonly signal?: AbortSignal },
      task: () => Promise<unknown>,
    ) => task()),
    importChapters: vi.fn(async (input: { bookId: string; chapters: ReadonlyArray<{ title: string; content: string }> }) => ({
      bookId: input.bookId,
      importedCount: input.chapters.length,
      totalWords: 4200,
      nextChapter: input.chapters.length + 1,
    })),
  };
}

describe("import_chapters agent tool", () => {
  let root: string;
  let state: StateManager;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "castor-import-chapters-tool-"));
    state = new StateManager(root);

    await state.saveBookConfig("harbor", {
      id: "harbor",
      title: "Harbor",
      platform: "tomato",
      genre: "other",
      status: "active",
      targetChapters: 20,
      chapterWordCount: 3000,
      createdAt: "2026-07-07T00:00:00.000Z",
      updatedAt: "2026-07-07T00:00:00.000Z",
    });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("imports a directory of .md/.txt files in filename order with prefix-stripped titles", async () => {
    const sourceDir = join(root, "source-dir");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "02_mock_text.txt"), "mock_text。", "utf-8");
    await writeFile(join(sourceDir, "01_mock_text.md"), "mock_text。", "utf-8");
    await writeFile(join(sourceDir, "notes.pdf"), "ignored", "utf-8");

    const pipeline = mockPipeline();
    const tool = createImportChaptersTool(pipeline as never, "harbor", root);

    const result = await tool.execute("tool-import-dir", { sourcePath: sourceDir });

    expect(pipeline.importChapters).toHaveBeenCalledTimes(1);
    expect(pipeline.importChapters).toHaveBeenCalledWith({
      bookId: "harbor",
      chapters: [
        { title: "mock_text", content: "mock_text。" },
        { title: "mock_text", content: "mock_text。" },
      ],
      resumeFrom: undefined,
      importMode: undefined,
    });
    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain('Imported 2 chapter(s) into book "harbor"');
      expect(result.content[0].text).toContain("Next chapter to write: 3");
    }
    expect(result.details).toMatchObject({
      kind: "chapters_imported",
      bookId: "harbor",
      importedCount: 2,
      totalWords: 4200,
      nextChapter: 3,
      importMode: "continuation",
    });
  });

  it("runs import inside the tool AbortSignal scope", async () => {
    const sourceDir = join(root, "abort-source-dir");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "01_mock_text.md"), "mock_text。", "utf-8");
    const controller = new AbortController();
    const pipeline = mockPipeline();
    const tool = createImportChaptersTool(pipeline as never, "harbor", root);

    await tool.execute("tool-import-abort", { sourcePath: sourceDir }, controller.signal);

    expect(pipeline.runWithAgentContext).toHaveBeenCalledWith(
      { signal: controller.signal, activatedSkills: [] },
      expect.any(Function),
    );
    expect(pipeline.importChapters).toHaveBeenCalledOnce();
  });

  it("auto-splits a single file by chapter headings and resolves project-relative stored_path", async () => {
    await mkdir(join(root, ".castor", "uploads", "s1"), { recursive: true });
    await writeFile(
      join(root, ".castor", "uploads", "s1", "novel.txt"),
      "Chương mock_text mock_text\n\nmock_text。\n\nChương mock_text mock_text\n\nmock_text。\n",
      "utf-8",
    );

    const pipeline = mockPipeline();
    const tool = createImportChaptersTool(pipeline as never, "harbor", root);

    await tool.execute("tool-import-file", { sourcePath: ".castor/uploads/s1/novel.txt" });

    expect(pipeline.importChapters).toHaveBeenCalledWith({
      bookId: "harbor",
      chapters: [
        { title: "mock_text", content: "mock_text。" },
        { title: "mock_text", content: "mock_text。" },
      ],
      resumeFrom: undefined,
      importMode: undefined,
    });
  });

  it("splits a single file with a custom splitPattern", async () => {
    const sourceFile = join(root, "novel-custom.txt");
    await writeFile(sourceFile, "Part mock_text\nmock_text。\nPart mock_text\nmock_text。\n", "utf-8");

    const pipeline = mockPipeline();
    const tool = createImportChaptersTool(pipeline as never, "harbor", root);

    await tool.execute("tool-import-custom-split", {
      sourcePath: sourceFile,
      splitPattern: "^Part\\s+(.*)$",
    });

    expect(pipeline.importChapters).toHaveBeenCalledWith({
      bookId: "harbor",
      chapters: [
        { title: "mock_text", content: "mock_text。" },
        { title: "mock_text", content: "mock_text。" },
      ],
      resumeFrom: undefined,
      importMode: undefined,
    });
  });

  it("throws when the single file yields no chapters", async () => {
    const sourceFile = join(root, "no-headings.txt");
    await writeFile(sourceFile, "mock_text，mock_text。", "utf-8");

    const pipeline = mockPipeline();
    const tool = createImportChaptersTool(pipeline as never, "harbor", root);

    await expect(tool.execute("tool-import-no-split", { sourcePath: sourceFile }))
      .rejects.toThrow(/No chapters found/);
    expect(pipeline.importChapters).not.toHaveBeenCalled();
  });

  it("throws when the book already has chapters and resumeFrom is missing", async () => {
    await mkdir(join(state.bookDir("harbor"), "chapters"), { recursive: true });
    await writeFile(
      join(state.bookDir("harbor"), "chapters", "0001_mock_text.md"),
      "# Chương 1 mock_text\n\nmock_text。\n",
      "utf-8",
    );
    await state.saveChapterIndex("harbor", [{
      number: 1,
      title: "mock_text",
      status: "imported",
      wordCount: 10,
      createdAt: "2026-07-07T00:00:00.000Z",
      updatedAt: "2026-07-07T00:00:00.000Z",
      auditIssues: [],
      lengthWarnings: [],
    }]);

    const sourceDir = join(root, "source-dir");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "01_mock_text.md"), "mock_text。", "utf-8");

    const pipeline = mockPipeline();
    const tool = createImportChaptersTool(pipeline as never, "harbor", root);

    await expect(tool.execute("tool-import-conflict", { sourcePath: sourceDir }))
      .rejects.toThrow(/already has 1 chapter\(s\).*resumeFrom/);
    expect(pipeline.importChapters).not.toHaveBeenCalled();
  });

  it("passes resumeFrom and importMode through to pipeline.importChapters", async () => {
    await mkdir(join(state.bookDir("harbor"), "chapters"), { recursive: true });
    await writeFile(
      join(state.bookDir("harbor"), "chapters", "0001_mock_text.md"),
      "# Chương 1 mock_text\n\nmock_text。\n",
      "utf-8",
    );
    await state.saveChapterIndex("harbor", [{
      number: 1,
      title: "mock_text",
      status: "imported",
      wordCount: 10,
      createdAt: "2026-07-07T00:00:00.000Z",
      updatedAt: "2026-07-07T00:00:00.000Z",
      auditIssues: [],
      lengthWarnings: [],
    }]);

    const sourceDir = join(root, "source-dir");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "01_mock_text.md"), "mock_text。", "utf-8");
    await writeFile(join(sourceDir, "02_mock_text.md"), "mock_text。", "utf-8");

    const pipeline = mockPipeline();
    const tool = createImportChaptersTool(pipeline as never, "harbor", root);

    const result = await tool.execute("tool-import-resume", {
      sourcePath: sourceDir,
      resumeFrom: 2,
      importMode: "series",
    });

    expect(pipeline.importChapters).toHaveBeenCalledWith({
      bookId: "harbor",
      chapters: [
        { title: "mock_text", content: "mock_text。" },
        { title: "mock_text", content: "mock_text。" },
      ],
      resumeFrom: 2,
      importMode: "series",
    });
    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("Resumed replay from chapter 2");
    }
    expect(result.details).toMatchObject({ importMode: "series" });
  });

  it("rejects a bookId that does not match the active book", async () => {
    const pipeline = mockPipeline();
    const tool = createImportChaptersTool(pipeline as never, "harbor", root);

    await expect(tool.execute("tool-import-wrong-book", {
      bookId: "other-book",
      sourcePath: join(root, "whatever.txt"),
    })).rejects.toThrow(/must match the active book/);
    expect(pipeline.importChapters).not.toHaveBeenCalled();
  });
});
