import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ShortFictionOutlineAgent,
  ShortFictionOutlineReviewerAgent,
  ShortFictionOutlineReviserAgent,
  ShortFictionWriterAgent,
  ShortFictionDraftReviewerAgent,
  ShortFictionDraftReviserAgent,
  ShortFictionPackagingAgent,
  parseShortFictionBatchDraft,
} from "../agents/short-fiction.js";
import { runShortFictionProduction } from "../pipeline/short-fiction-runner.js";

const CH = 12;
const DRAFT_MD = `
=== SHORT_FICTION_TITLE ===
mock_text
${Array.from({ length: CH }, (_, i) => `=== CHAPTER ${i + 1} TITLE ===
Chương ${i + 1}mock_text
=== CHAPTER ${i + 1} CONTENT ===
${"mock_text，mock_text。".repeat(50)}`).join("\n")}
`;
const PARTIAL_DRAFT_MD = `
=== SHORT_FICTION_TITLE ===
mock_text
${Array.from({ length: 5 }, (_, i) => `=== CHAPTER ${i + 1} TITLE ===
Chương ${i + 1}mock_text
=== CHAPTER ${i + 1} CONTENT ===
${"mock_text，mock_text。".repeat(20)}`).join("\n")}
`;
const MIDDLE_GAP_DRAFT_MD = `
=== SHORT_FICTION_TITLE ===
mock_text
${Array.from({ length: CH }, (_, i) => `=== CHAPTER ${i + 1} TITLE ===
Chương ${i + 1}mock_text
=== CHAPTER ${i + 1} CONTENT ===
${i === 4 || i === 7 ? "" : "mock_text，mock_text。".repeat(20)}`).join("\n")}
`;
const CHAPTER_5_ONLY_CONTINUATION_MD = `
=== CHAPTER 5 TITLE ===
Chương 5
=== CHAPTER 5 CONTENT ===
${"Chương mock_text，mock_text。".repeat(20)}
`;

function ctx(projectRoot: string) {
  return { client: { provider: "openai" } as never, model: "fake", projectRoot };
}
function runtimes(projectRoot: string) {
  const c = ctx(projectRoot);
  return { planner: c, outlineReview: c, writer: c, draftReview: c, revise: c, package: c };
}

describe("short fiction resume + failure marker (C2)", () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "castor-shortc2-")); });
  afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

  function stubDownstream() {
    const draft = parseShortFictionBatchDraft(DRAFT_MD, { expectedChapters: CH });
    vi.spyOn(ShortFictionWriterAgent.prototype, "writeDraft").mockResolvedValue(draft);
    vi.spyOn(ShortFictionDraftReviewerAgent.prototype, "reviewDraft").mockResolvedValue("looks fine");
    vi.spyOn(ShortFictionDraftReviserAgent.prototype, "reviseDraft").mockResolvedValue(draft);
    vi.spyOn(ShortFictionPackagingAgent.prototype, "generatePackage").mockResolvedValue({
      title: "mock_text", intro: "mock_text", sellingPoints: ["mock_text"], coverPrompt: "", rawContent: "",
    });
  }

  it("uses a later non-empty duplicate chapter content block when filling a previously empty chapter", () => {
    const merged = `${MIDDLE_GAP_DRAFT_MD}\n\n${CHAPTER_5_ONLY_CONTINUATION_MD}`;
    const draft = parseShortFictionBatchDraft(merged, { expectedChapters: CH });

    expect(draft.chapters[4]?.content).toContain("Chương mock_text");
    expect(findEmptyChapterNumbers(draft)).toEqual([8]);
  });

  it("resumes from an existing outline/v002.md, skipping the three outline stages", async () => {
    await mkdir(join(root, "shorts", "elevator", "outline"), { recursive: true });
    await writeFile(join(root, "shorts", "elevator", "outline", "v002.md"), "## mock_text\n12mock_text", "utf-8");

    const createOutline = vi.spyOn(ShortFictionOutlineAgent.prototype, "createOutline");
    const reviewOutline = vi.spyOn(ShortFictionOutlineReviewerAgent.prototype, "reviewOutline");
    stubDownstream();

    const result = await runShortFictionProduction({
      projectRoot: root, direction: "mock_text", storyId: "elevator",
      chapterCount: CH, charsPerChapter: 1000, cover: false, runtimes: runtimes(root),
    });

    expect(createOutline).not.toHaveBeenCalled();   // outline resumed from disk
    expect(reviewOutline).not.toHaveBeenCalled();
    await expect(access(join(root, "shorts", "elevator", "final", "full.md"))).resolves.toBeUndefined();
    expect(result.storyId).toBe("elevator");
  });

  it("writes a failure marker (status.json) when a stage throws, instead of orphaning a silent partial", async () => {
    await mkdir(join(root, "shorts", "elevator", "outline"), { recursive: true });
    await writeFile(join(root, "shorts", "elevator", "outline", "v002.md"), "## mock_text", "utf-8");
    // Writer stage fails with a transient-style upstream error.
    vi.spyOn(ShortFictionWriterAgent.prototype, "writeDraft").mockRejectedValue(new Error("503 temporarily unavailable"));

    await expect(runShortFictionProduction({
      projectRoot: root, direction: "mock_text", storyId: "elevator",
      chapterCount: CH, charsPerChapter: 1000, cover: false, runtimes: runtimes(root),
    })).rejects.toThrow(/503/);

    const status = JSON.parse(await readFile(join(root, "shorts", "elevator", "status.json"), "utf-8"));
    expect(status.status).toBe("failed");
    expect(status.error).toContain("503");
  });

  it("keeps the complete first outline when the optional outline revision fails", async () => {
    const firstOutline = { storyTitle: "mock_text", rawContent: "# mock_text\n\n## 12mock_text\nmock_textChương mock_text" };
    vi.spyOn(ShortFictionOutlineAgent.prototype, "createOutline").mockResolvedValue(firstOutline);
    vi.spyOn(ShortFictionOutlineReviewerAgent.prototype, "reviewOutline").mockResolvedValue("Chương mock_text");
    vi.spyOn(ShortFictionOutlineReviserAgent.prototype, "reviseOutline")
      .mockRejectedValue(new Error("model reached the output limit (length)"));
    const complete = parseShortFictionBatchDraft(DRAFT_MD, { expectedChapters: CH });
    const writeDraft = vi.spyOn(ShortFictionWriterAgent.prototype, "writeDraft").mockResolvedValue(complete);
    vi.spyOn(ShortFictionDraftReviewerAgent.prototype, "reviewDraft").mockResolvedValue("looks fine");
    vi.spyOn(ShortFictionDraftReviserAgent.prototype, "reviseDraft").mockResolvedValue(complete);
    vi.spyOn(ShortFictionPackagingAgent.prototype, "generatePackage").mockResolvedValue({
      title: "mock_text", intro: "mock_text", sellingPoints: ["mock_text"], coverPrompt: "", rawContent: "",
    });

    const result = await runShortFictionProduction({
      projectRoot: root, direction: "mock_text", chapterCount: CH,
      charsPerChapter: 1000, cover: false, runtimes: runtimes(root),
    });

    expect(writeDraft).toHaveBeenCalledWith(expect.objectContaining({ outlineMarkdown: firstOutline.rawContent }));
    expect((await readFile(join(root, result.outlinePath), "utf-8")).trim()).toBe(firstOutline.rawContent);
    expect(await readFile(join(root, "shorts", result.storyId, "reviews", "outline-v002-warning.md"), "utf-8"))
      .toContain("model reached the output limit");
    const status = JSON.parse(await readFile(join(root, "shorts", result.storyId, "status.json"), "utf-8"));
    expect(status).toMatchObject({ status: "complete" });
    expect(status.observations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        metric: "optional-revision",
        severity: "warning",
        actual: expect.stringContaining("outline revision skipped"),
      }),
    ]));
  });

  it("uses the confirmed title as project identity instead of a malformed generated heading", async () => {
    const malformedOutline = {
      storyTitle: "one-line-platform-title",
      rawContent: "# One line platform title\n\n## 12mock_text\nmock_text",
    };
    vi.spyOn(ShortFictionOutlineAgent.prototype, "createOutline").mockResolvedValue(malformedOutline);
    vi.spyOn(ShortFictionOutlineReviewerAgent.prototype, "reviewOutline").mockResolvedValue("mock_text");
    vi.spyOn(ShortFictionOutlineReviserAgent.prototype, "reviseOutline").mockResolvedValue(malformedOutline);
    stubDownstream();

    const result = await runShortFictionProduction({
      projectRoot: root,
      title: "《mock_text》",
      direction: "mock_text",
      chapterCount: CH,
      charsPerChapter: 1000,
      cover: false,
      runtimes: runtimes(root),
    });

    expect(result.storyId).toBe("mock_text");
    await expect(access(join(root, "shorts", "mock_text", "final", "full.md"))).resolves.toBeUndefined();
    await expect(access(join(root, "shorts", "one-line-platform-title"))).rejects.toThrow();
  });

  it("continues a truncated first draft before review instead of reviewing empty chapters", async () => {
    await mkdir(join(root, "shorts", "elevator", "outline"), { recursive: true });
    await writeFile(join(root, "shorts", "elevator", "outline", "v002.md"), "## mock_text", "utf-8");
    const partial = parseShortFictionBatchDraft(PARTIAL_DRAFT_MD, { expectedChapters: CH });
    const complete = parseShortFictionBatchDraft(DRAFT_MD, { expectedChapters: CH });
    const continueDraft = vi.spyOn(ShortFictionWriterAgent.prototype, "continueDraft").mockResolvedValue(complete);
    vi.spyOn(ShortFictionWriterAgent.prototype, "writeDraft").mockResolvedValue(partial);
    vi.spyOn(ShortFictionDraftReviewerAgent.prototype, "reviewDraft").mockResolvedValue("looks fine");
    vi.spyOn(ShortFictionDraftReviserAgent.prototype, "reviseDraft").mockResolvedValue(complete);
    vi.spyOn(ShortFictionPackagingAgent.prototype, "generatePackage").mockResolvedValue({
      title: "mock_text", intro: "mock_text", sellingPoints: ["mock_text"], coverPrompt: "", rawContent: "",
    });

    await runShortFictionProduction({
      projectRoot: root, direction: "mock_text", storyId: "elevator",
      chapterCount: CH, charsPerChapter: 1000, cover: false, runtimes: runtimes(root),
    });

    expect(continueDraft).toHaveBeenCalled();
    await expect(access(join(root, "shorts", "elevator", "drafts", "v001-partial", "full.md"))).resolves.toBeUndefined();
    const final = await readFile(join(root, "shorts", "elevator", "final", "full.md"), "utf-8");
    expect(final).toContain("Chương 12");
  });

  it("keeps completing a draft when the first continuation fills only some missing middle chapters", async () => {
    await mkdir(join(root, "shorts", "elevator", "outline"), { recursive: true });
    await writeFile(join(root, "shorts", "elevator", "outline", "v002.md"), "## mock_text", "utf-8");
    const initial = parseShortFictionBatchDraft(MIDDLE_GAP_DRAFT_MD, { expectedChapters: CH });
    const chapter5Only = parseShortFictionBatchDraft(`${MIDDLE_GAP_DRAFT_MD}\n\n${CHAPTER_5_ONLY_CONTINUATION_MD}`, { expectedChapters: CH });
    const complete = parseShortFictionBatchDraft(DRAFT_MD, { expectedChapters: CH });
    const continueDraft = vi.spyOn(ShortFictionWriterAgent.prototype, "continueDraft")
      .mockResolvedValueOnce(chapter5Only)
      .mockResolvedValueOnce(complete);
    vi.spyOn(ShortFictionWriterAgent.prototype, "writeDraft").mockResolvedValue(initial);
    vi.spyOn(ShortFictionDraftReviewerAgent.prototype, "reviewDraft").mockResolvedValue("looks fine");
    vi.spyOn(ShortFictionDraftReviserAgent.prototype, "reviseDraft").mockResolvedValue(complete);
    vi.spyOn(ShortFictionPackagingAgent.prototype, "generatePackage").mockResolvedValue({
      title: "mock_text", intro: "mock_text", sellingPoints: ["mock_text"], coverPrompt: "", rawContent: "",
    });

    await runShortFictionProduction({
      projectRoot: root, direction: "mock_text", storyId: "elevator",
      chapterCount: CH, charsPerChapter: 1000, cover: false, runtimes: runtimes(root),
    });

    expect(continueDraft).toHaveBeenCalledTimes(2);
    const finalJson = JSON.parse(await readFile(join(root, "shorts", "elevator", "final", "short-story.json"), "utf-8"));
    expect(finalJson.chapters.every((chapter: { content: string }) => chapter.content.length > 0)).toBe(true);
  });

  it("keeps the complete first draft when the single revision output is invalid", async () => {
    await mkdir(join(root, "shorts", "elevator", "outline"), { recursive: true });
    await writeFile(join(root, "shorts", "elevator", "outline", "v002.md"), "## mock_text", "utf-8");
    const complete = parseShortFictionBatchDraft(DRAFT_MD, { expectedChapters: CH });
    const invalidRevision = parseShortFictionBatchDraft("=== SHORT_FICTION_TITLE ===\nmock_text", { expectedChapters: CH });
    vi.spyOn(ShortFictionWriterAgent.prototype, "writeDraft").mockResolvedValue(complete);
    vi.spyOn(ShortFictionDraftReviewerAgent.prototype, "reviewDraft").mockResolvedValue("looks fine");
    vi.spyOn(ShortFictionDraftReviserAgent.prototype, "reviseDraft").mockResolvedValue(invalidRevision);
    vi.spyOn(ShortFictionPackagingAgent.prototype, "generatePackage").mockResolvedValue({
      title: "mock_text", intro: "mock_text", sellingPoints: ["mock_text"], coverPrompt: "", rawContent: "",
    });

    await runShortFictionProduction({
      projectRoot: root, direction: "mock_text", storyId: "elevator",
      chapterCount: CH, charsPerChapter: 1000, cover: false, runtimes: runtimes(root),
    });

    const warning = await readFile(join(root, "shorts", "elevator", "reviews", "draft-v002-warning.md"), "utf-8");
    expect(warning).toContain("Chương mock_text");
    const finalJson = JSON.parse(await readFile(join(root, "shorts", "elevator", "final", "short-story.json"), "utf-8"));
    expect(finalJson.chapters.every((chapter: { content: string }) => chapter.content.length > 0)).toBe(true);
  });

  it("returns the existing short untouched when final/full.md already exists (idempotent)", async () => {
    await mkdir(join(root, "shorts", "elevator", "final"), { recursive: true });
    await writeFile(join(root, "shorts", "elevator", "final", "full.md"), "# done", "utf-8");
    const writeDraft = vi.spyOn(ShortFictionWriterAgent.prototype, "writeDraft");

    const result = await runShortFictionProduction({
      projectRoot: root, direction: "mock_text", storyId: "elevator",
      chapterCount: CH, charsPerChapter: 1000, cover: false, runtimes: runtimes(root),
    });

    expect(writeDraft).not.toHaveBeenCalled();       // nothing regenerated
    expect(result.coverError).toBe("already-complete");
  });

  it("does not skip a previously failed run just because final/full.md exists", async () => {
    await mkdir(join(root, "shorts", "elevator", "outline"), { recursive: true });
    await mkdir(join(root, "shorts", "elevator", "final"), { recursive: true });
    await writeFile(join(root, "shorts", "elevator", "outline", "v002.md"), "## mock_text", "utf-8");
    await writeFile(join(root, "shorts", "elevator", "final", "full.md"), "# partial final", "utf-8");
    await writeFile(join(root, "shorts", "elevator", "status.json"), JSON.stringify({ status: "failed", error: "package failed" }), "utf-8");
    stubDownstream();
    const packageSpy = vi.spyOn(ShortFictionPackagingAgent.prototype, "generatePackage");

    const result = await runShortFictionProduction({
      projectRoot: root, direction: "mock_text", storyId: "elevator",
      chapterCount: CH, charsPerChapter: 1000, cover: false, runtimes: runtimes(root),
    });

    expect(result.coverError).toBe("disabled");
    expect(packageSpy).toHaveBeenCalled();
    await expect(access(join(root, "shorts", "elevator", "final", "sales-package.md"))).resolves.toBeUndefined();
  });
});

function findEmptyChapterNumbers(draft: ReturnType<typeof parseShortFictionBatchDraft>): number[] {
  return draft.chapters.filter((chapter) => !chapter.content.trim()).map((chapter) => chapter.number);
}
