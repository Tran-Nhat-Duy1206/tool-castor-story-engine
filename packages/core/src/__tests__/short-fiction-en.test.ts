import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildShortFictionDraftContinuationUserPrompt,
  buildShortFictionDraftReviewSystemPrompt,
  buildShortFictionDraftReviewUserPrompt,
  buildShortFictionDraftRevisionFollowup,
  buildShortFictionOutlineReviewSystemPrompt,
  buildShortFictionOutlineReviewUserPrompt,
  buildShortFictionOutlineRevisionFollowup,
  buildShortFictionOutlineSystemPrompt,
  buildShortFictionOutlineUserPrompt,
  buildShortFictionPackageSystemPrompt,
  buildShortFictionPackageUserPrompt,
  buildShortFictionWriterSystemPrompt,
  buildShortFictionWriterUserPrompt,
} from "../prompts/short-fiction.js";
import {
  ShortFictionDraftReviewerAgent,
  ShortFictionDraftReviserAgent,
  ShortFictionPackagingAgent,
  ShortFictionWriterAgent,
  parseShortFictionBatchDraft,
  parseShortFictionOutline,
  renderShortFictionDraftMarkdown,
} from "../agents/short-fiction.js";
import { runShortFictionProduction } from "../pipeline/short-fiction-runner.js";

const CJK = /[一-鿿]/;

const OUTLINE_INPUT = {
  direction: "revenge thriller inside a law firm, hidden evidence, final reversal",
  chapterCount: 12,
  charsPerChapter: 650,
  reference: { text: "short reference sample" },
};

const DRAFT_INPUT = {
  direction: "revenge thriller inside a law firm",
  outlineMarkdown: "## Plan\nChapter 1: the setup scene",
  chapterCount: 12,
  charsPerChapter: 650,
};

describe("short-fiction English prompt branch", () => {
  it("produces fully English prompts with no Chinese instruction text", () => {
    const enPrompts: Record<string, string> = {
      outlineSystem: buildShortFictionOutlineSystemPrompt("en"),
      outlineUser: buildShortFictionOutlineUserPrompt(OUTLINE_INPUT, "en"),
      outlineReviewSystem: buildShortFictionOutlineReviewSystemPrompt("en"),
      outlineReviewUser: buildShortFictionOutlineReviewUserPrompt({
        direction: OUTLINE_INPUT.direction,
        outline: { rawContent: "the plan body" },
      }, "en"),
      outlineRevisionFollowup: buildShortFictionOutlineRevisionFollowup({
        direction: OUTLINE_INPUT.direction,
        outline: { rawContent: "the plan body" },
        review: "the back half sags",
        chapterCount: 12,
        charsPerChapter: 650,
      }, "en"),
      writerSystem: buildShortFictionWriterSystemPrompt("en"),
      writerUser: buildShortFictionWriterUserPrompt(DRAFT_INPUT, "en"),
      continuationUser: buildShortFictionDraftContinuationUserPrompt({
        ...DRAFT_INPUT,
        existingDraftMarkdown: "# Existing Draft",
        missingChapters: [3, 4],
      }, "en"),
      draftReviewSystem: buildShortFictionDraftReviewSystemPrompt("en"),
      draftReviewUser: buildShortFictionDraftReviewUserPrompt({
        ...DRAFT_INPUT,
        draftMarkdown: "# The Draft Body",
      }, "en"),
      draftRevisionFollowup: buildShortFictionDraftRevisionFollowup({
        ...DRAFT_INPUT,
        review: "fix the timeline in chapter 4",
      }, "en"),
      packageSystem: buildShortFictionPackageSystemPrompt("en"),
      packageUser: buildShortFictionPackageUserPrompt({
        direction: OUTLINE_INPUT.direction,
        outlineMarkdown: "the plan",
        draftMarkdown: "the draft",
        draftTitle: "The Extra Floor",
      }, "en"),
    };

    for (const [name, prompt] of Object.entries(enPrompts)) {
      expect(prompt.trim().length, `${name} is empty`).toBeGreaterThan(0);
      expect(CJK.test(prompt), `${name} contains Chinese: ${prompt.match(CJK)?.[0]}`).toBe(false);
    }
  });

  it("keeps machine-readable block tags and word calibration in the en writer prompt", () => {
    const prompt = buildShortFictionWriterUserPrompt(DRAFT_INPUT, "en");
    expect(prompt).toContain("=== SHORT_FICTION_TITLE ===");
    expect(prompt).toContain("=== SHORT_FICTION_OPENING_HOOK ===");
    expect(prompt).toContain("=== CHAPTER 1 TITLE ===");
    expect(prompt).toContain("=== CHAPTER 12 CONTENT ===");
    expect(prompt).toContain("650 words per chapter");
  });

  it("keeps the zh default identical to the explicit zh branch", () => {
    expect(buildShortFictionWriterSystemPrompt()).toBe(buildShortFictionWriterSystemPrompt("zh"));
    expect(buildShortFictionOutlineSystemPrompt()).toBe(buildShortFictionOutlineSystemPrompt("zh"));
    expect(buildShortFictionWriterSystemPrompt()).toContain("中文短篇 BatchWriter");
    const zhWriterUser = buildShortFictionWriterUserPrompt({ ...DRAFT_INPUT, charsPerChapter: 1000 });
    expect(zhWriterUser).toContain("高潮即场景");
    expect(zhWriterUser).toContain("每章约 1000 字");
  });
});

const EN_TWO_CHAPTER_DRAFT = `
=== SHORT_FICTION_TITLE ===
The Extra Floor
=== SHORT_FICTION_OPENING_HOOK ===
The elevator stopped on a floor that does not exist.
=== CHAPTER 1 TITLE ===
Chapter 1: The Thirteenth Button
=== CHAPTER 1 CONTENT ===
The elevator doors opened onto a hallway that was not on any blueprint.
=== CHAPTER 2 TITLE ===
The Night Shift
=== CHAPTER 2 CONTENT ===
She pressed the button five times before the panel finally went dark.
`;

describe("short-fiction English parsing and rendering", () => {
  it("counts en chapter length in words, not characters", () => {
    const draft = parseShortFictionBatchDraft(EN_TWO_CHAPTER_DRAFT, { expectedChapters: 2, language: "en" });
    // "The elevator doors opened onto a hallway that was not on any blueprint." = 13 words
    expect(draft.chapters[0]?.charCount).toBe(13);
    // "She pressed the button five times before the panel finally went dark." = 12 words
    expect(draft.chapters[1]?.charCount).toBe(12);
  });

  it("keeps zh default counting by characters", () => {
    const draft = parseShortFictionBatchDraft([
      "=== SHORT_FICTION_TITLE ===",
      "电梯多一层",
      "=== CHAPTER 1 TITLE ===",
      "第十三个按钮",
      "=== CHAPTER 1 CONTENT ===",
      "深夜电梯 停在十三层",
    ].join("\n"), { expectedChapters: 1 });
    expect(draft.chapters[0]?.charCount).toBe(9); // whitespace excluded, characters counted
  });

  it("strips the Chapter N prefix from en titles and uses en fallbacks", () => {
    const draft = parseShortFictionBatchDraft(EN_TWO_CHAPTER_DRAFT, { expectedChapters: 3, language: "en" });
    expect(draft.chapters[0]?.title).toBe("The Thirteenth Button");
    expect(draft.chapters[1]?.title).toBe("The Night Shift");
    expect(draft.chapters[2]?.title).toBe("Chapter 3"); // missing chapter falls back in English
    expect(parseShortFictionOutline("no tags here", "en").storyTitle).toBe("Untitled Short Story");
  });

  it("renders en draft markdown with English headings", () => {
    const draft = parseShortFictionBatchDraft(EN_TWO_CHAPTER_DRAFT, { expectedChapters: 2, language: "en" });
    const markdown = renderShortFictionDraftMarkdown(draft, "en");
    expect(markdown).toContain("# The Extra Floor");
    expect(markdown).toContain("## Opening Hook");
    expect(markdown).toContain("## Chapter 1: The Thirteenth Button");
    expect(markdown).toContain("## Chapter 2: The Night Shift");
    expect(CJK.test(markdown)).toBe(false);
  });
});

describe("short-fiction runner English branch", () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "castor-short-en-")); });
  afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

  function runtimes(projectRoot: string) {
    const context = { client: { provider: "openai" } as never, model: "fake", projectRoot };
    return { planner: context, outlineReview: context, writer: context, draftReview: context, revise: context, package: context };
  }

  it("bounds en charsPerChapter in words (600-800), rejecting the zh char range", async () => {
    await expect(runShortFictionProduction({
      projectRoot: root,
      direction: "haunted elevator",
      language: "en",
      charsPerChapter: 1000,
      cover: false,
      runtimes: runtimes(root),
    })).rejects.toThrow(/charsPerChapter must be an integer between 600 and 800/);
  });

  it("threads language and the en word default through the pipeline and artifacts", async () => {
    const CH = 12;
    await mkdir(join(root, "shorts", "extra-floor", "outline"), { recursive: true });
    await writeFile(join(root, "shorts", "extra-floor", "outline", "v002.md"), "## Existing plan", "utf-8");

    const draftMd = [
      "=== SHORT_FICTION_TITLE ===",
      "The Extra Floor",
      ...Array.from({ length: CH }, (_, index) => [
        `=== CHAPTER ${index + 1} TITLE ===`,
        `Room ${index + 1}`,
        `=== CHAPTER ${index + 1} CONTENT ===`,
        "The corridor bends where no corridor should bend. ".repeat(20),
      ].join("\n")),
    ].join("\n");
    const draft = parseShortFictionBatchDraft(draftMd, { expectedChapters: CH, language: "en" });

    const writeDraft = vi.spyOn(ShortFictionWriterAgent.prototype, "writeDraft").mockResolvedValue(draft);
    vi.spyOn(ShortFictionDraftReviewerAgent.prototype, "reviewDraft").mockResolvedValue("reads fine");
    vi.spyOn(ShortFictionDraftReviserAgent.prototype, "reviseDraft").mockResolvedValue(draft);
    vi.spyOn(ShortFictionPackagingAgent.prototype, "generatePackage").mockResolvedValue({
      title: "The Extra Floor", intro: "An elevator hook.", sellingPoints: ["reversal"], coverPrompt: "", rawContent: "",
    });

    await runShortFictionProduction({
      projectRoot: root,
      direction: "haunted elevator",
      storyId: "extra-floor",
      chapterCount: CH,
      cover: false,
      language: "en",
      runtimes: runtimes(root),
    });

    expect(writeDraft).toHaveBeenCalledWith(expect.objectContaining({ language: "en", charsPerChapter: 650 }));
    const final = await readFile(join(root, "shorts", "extra-floor", "final", "full.md"), "utf-8");
    expect(final).toContain("## Chapter 12: Room 12");
    expect(CJK.test(final)).toBe(false);
    const chapterFile = await readFile(join(root, "shorts", "extra-floor", "final", "chapters", "0001.md"), "utf-8");
    expect(chapterFile.startsWith("# Chapter 1: Room 1")).toBe(true);
    const salesPackage = await readFile(join(root, "shorts", "extra-floor", "final", "sales-package.md"), "utf-8");
    expect(salesPackage).toContain("## Synopsis");
    expect(salesPackage).toContain("## Selling Points");
  });
});
