import { describe, expect, it } from "vitest";
import {
  countMarkdownSections,
  extractMarkdownSection,
  extractProductionDocument,
  extractStoryboardImagePrompts,
  normalizeScriptEpisodeEndLabels,
  renderInteractiveFilmSpec,
  renderScriptSpec,
  renderStoryboardSpec,
} from "../agents/script-storyboard.js";
import { createStoryboardAssetsManifest } from "../pipeline/script-storyboard-runner.js";

describe("script and storyboard creation helpers", () => {
  it("renders a human-readable script spec without excerpting source text", () => {
    const sourceText = "Chương mock_text。".repeat(500);
    const spec = renderScriptSpec({
      title: "mock_text",
      sourceKind: "mock_text",
      targetFormat: "vertical_short_drama",
      sourceText,
      requirements: "mock_text，mock_text。",
      episodeCount: 12,
      episodeDuration: "2mock_text",
    });

    expect(spec).toContain("# mock_text mock_text");
    expect(spec).toContain("mock_text：mock_text");
    expect(spec).toContain("mock_text/mock_text：12");
    expect(spec).toContain("mock_text，mock_text");
    expect(spec).toContain("mock_text");
    expect(spec).toContain(`${sourceText.replace(/\s+/g, " ").trim().length}  từmock_text`);
    expect(spec).not.toContain("Chương mock_text。Chương mock_text。Chương mock_text。");
    expect(spec).not.toContain("...");
  });

  it("renders storyboard specs as editable Markdown", () => {
    const spec = renderStoryboardSpec({
      title: "mock_text",
      sourceKind: "mock_text",
      visualStyle: "mock_text",
      aspectRatio: "9:16",
      granularity: "mock_text",
      maxShots: 18,
      requirements: "mock_text。",
    });

    expect(spec).toContain("# mock_text mock_text");
    expect(spec).toContain("mock_text：mock_text");
    expect(spec).toContain("mock_text：9:16");
    expect(spec).toContain("mock_text：mock_text");
    expect(spec).toContain("mock_text：18");
    expect(spec).toContain("mock_text");
  });

  it("extracts only the storyboard image prompt section when present", () => {
    const prompts = extractStoryboardImagePrompts([
      "# mock_text",
      "",
      "## mock_text",
      "mock_text 1：mock_text。",
      "",
      "## mock_text",
      "1. Prompt: mock_text，mock_text，mock_text，9:16",
      "2. Prompt: mock_text，mock_text，mock_text",
      "",
      "## mock_text",
      "mock_text。",
    ].join("\n"));

    expect(prompts).toContain("mock_text");
    expect(prompts).toContain("mock_text");
    expect(prompts).not.toContain("mock_text");
    expect(prompts).not.toContain("mock_text");
  });

  it("extracts only explicit prompt lines when the model embeds prompts in storyboard content", () => {
    const prompts = extractStoryboardImagePrompts([
      "# mock_text",
      "",
      "## mock_text",
      "| mock_text | mock_text | mock_text |",
      "| --- | --- | --- |",
      "| 1 | mock_text | Prompt: mock_text，mock_text，mock_text，9:16 |",
      "| 2 | mock_text | Prompt: mock_text，mock_text |",
      "",
      "mock_text，mock_text。",
    ].join("\n"));

    expect(prompts).toBe([
      "1. mock_text，mock_text，mock_text，9:16",
      "2. mock_text，mock_text",
    ].join("\n"));
  });

  it("matches markdown section headings with descriptive suffixes", () => {
    const section = extractMarkdownSection([
      "# mock_text",
      "",
      "## mock_text（mock_text+mock_text）",
      "- N1 mock_text -> mock_text A Cong khaimock_text / mock_text B mock_text",
      "",
      "## mock_text",
      "| mock_text | mock_text |",
      "| --- | --- |",
    ].join("\n"), ["mock_text"]);

    expect(section).toContain("N1 mock_text");
    expect(section).not.toContain("mock_text");
  });

  it("extracts the production document after model scratch text", () => {
    const document = extractProductionDocument([
      "mock_text。",
      "mock_text。",
      "",
      "# mock_text",
      "",
      "## mock_text",
      "mock_text",
      "",
      "## mock_text",
      "mock_text。",
    ].join("\n"), "mock_text");

    expect(document).toMatch(/^# mock_text/u);
    expect(document).not.toContain("mock_text");
    expect(countMarkdownSections(document, ["mock_text"])).toBe(1);
    expect(countMarkdownSections(document, ["mock_text"])).toBe(1);
  });

  it("extracts markdown-bold prompt labels with shot ids", () => {
    const prompts = extractStoryboardImagePrompts([
      "# mock_text",
      "",
      "## mock_text（mock_text）",
      "**Prompt for C01**: dark-gold medieval court, candlelight, raven feathers, cinematic",
      "**mock_text C02**：mock_text，mock_text，mock_text",
    ].join("\n"));

    expect(prompts).toBe([
      "1. dark-gold medieval court, candlelight, raven feathers, cinematic",
      "2. mock_text，mock_text，mock_text",
    ].join("\n"));
  });

  it("extracts inline-code Prompt lines emitted by storyboard models", () => {
    const prompts = extractStoryboardImagePrompts([
      "# mock_text",
      "",
      "## mock_text",
      "`Prompt: mock_text，mock_text，mock_text，16:9`",
      "`Prompt: mock_text，mock_text，mock_text`",
    ].join("\n"));

    expect(prompts).toBe([
      "1. mock_text，mock_text，mock_text，16:9",
      "2. mock_text，mock_text，mock_text",
    ].join("\n"));
  });

  it("extracts prompts from markdown tables with a Prompt column", () => {
    const prompts = extractStoryboardImagePrompts([
      "# mock_text",
      "",
      "## mock_text",
      "| mock_text | mock_text | Prompt |",
      "|------|------|--------|",
      "| Chương mock_text | mock_text | mock_text，mock_text，mock_text，mock_text |",
      "| Chương mock_text | 15mock_text | mock_text，mock_text，mock_text，mock_text |",
    ].join("\n"));

    expect(prompts).toBe([
      "1. mock_text，mock_text，mock_text，mock_text",
      "2. mock_text，mock_text，mock_text，mock_text",
    ].join("\n"));
  });

  it("does not treat whole storyboard prose as image prompts", () => {
    const prompts = extractStoryboardImagePrompts([
      "# mock_text",
      "",
      "## mock_text",
      "mock_text 1：mock_text。",
      "mock_text 2：mock_text。",
    ].join("\n"));

    expect(prompts).toBe("");
  });

  it("normalizes mismatched episode-end subtitle labels inside each episode section", () => {
    const script = normalizeScriptEpisodeEndLabels([
      "# mock_text",
      "### Chương mock_text",
      " từmock_text：Chương mock_text",
      "### Chương mock_text",
      " từmock_text：Chương mock_text",
    ].join("\n"));

    expect(script).toContain(" từmock_text：Chương mock_text");
    expect(script).not.toContain(" từmock_text：Chương mock_text");
  });

  it("renders an interactive-film spec with branch and flag boundaries", () => {
    const spec = renderInteractiveFilmSpec({
      title: "mock_text",
      sourceKind: "mock_text",
      requirements: "mock_text，mock_textQuyet dinh。",
      targetAudience: "mock_text",
      budget: "5000mock_text",
      referenceMode: "mock_text",
    });

    expect(spec).toContain("# mock_text mock_text");
    expect(spec).toContain("mock_text：mock_text");
    expect(spec).toContain("mock_text/mock_text");
    expect(spec).toContain("mock_text");
    expect(spec).toContain("5000mock_text");
  });

  it("renders an English script spec with English headings and no Chinese text", () => {
    const sourceText = "Chapter one. ".repeat(300);
    const spec = renderScriptSpec({
      title: "Cold Ledger",
      sourceKind: "novel",
      targetFormat: "vertical_short_drama",
      sourceText,
      requirements: "70% investigation, 30% family grudge.",
      episodeCount: 12,
      episodeDuration: "2 minutes",
      language: "en",
    });

    expect(spec).toContain("# Cold Ledger Script Creation Spec");
    expect(spec).toContain("Deliverable: vertical short drama");
    expect(spec).toContain("- Episode/segment count: 12");
    expect(spec).toContain("70% investigation, 30% family grudge.");
    expect(spec).toContain("Full source material provided");
    expect(spec).toContain(`${sourceText.replace(/\s+/g, " ").trim().length} characters`);
    expect(spec).not.toMatch(/\u4e00-\u9fff/);
  });

  it("renders an English storyboard spec with English headings and no Chinese text", () => {
    const spec = renderStoryboardSpec({
      title: "Cold Ledger",
      sourceKind: "script",
      visualStyle: "desaturated realism",
      aspectRatio: "9:16",
      granularity: "split by scene and key shots",
      maxShots: 18,
      requirements: "Every shot needs a key prop.",
      language: "en",
    });

    expect(spec).toContain("# Cold Ledger Storyboard Creation Spec");
    expect(spec).toContain("- Shot granularity: split by scene and key shots");
    expect(spec).toContain("- Aspect ratio: 9:16");
    expect(spec).toContain("- Visual style: desaturated realism");
    expect(spec).toContain("- Shot cap: 18");
    expect(spec).toContain("Every shot needs a key prop.");
    expect(spec).not.toMatch(/\u4e00-\u9fff/);
  });

  it("renders an English interactive-film spec with English headings and no Chinese text", () => {
    const spec = renderInteractiveFilmSpec({
      title: "Crown Feast",
      sourceKind: "submission brief",
      requirements: "Multiple endings; variables track every key decision.",
      targetAudience: "Western interactive-film players",
      budget: "USD 800",
      referenceMode: "branch-heavy narrative",
      language: "en",
    });

    expect(spec).toContain("# Crown Feast Interactive Film Creation Spec");
    expect(spec).toContain("- Deliverable: interactive film");
    expect(spec).toContain("- Target audience: Western interactive-film players");
    expect(spec).toContain("- Budget constraint: USD 800");
    expect(spec).toContain("Multiple endings; variables track every key decision.");
    expect(spec).not.toMatch(/\u4e00-\u9fff/);
  });

  it("builds a storyboard image asset manifest from editable prompts", () => {
    const manifest = createStoryboardAssetsManifest({
      title: "mock_text",
      projectId: "cold-ledger",
      baseDir: "storyboards/cold-ledger",
      storyboardPath: "storyboards/cold-ledger/storyboard.md",
      imagePromptsPath: "storyboards/cold-ledger/image-prompts.md",
      imagePrompts: [
        "1. Prompt: mock_text，mock_text，mock_text，9:16",
        "2. Prompt: mock_text，mock_text",
      ].join("\n"),
      createdAt: "2026-06-16T00:00:00.000Z",
    });

    expect(manifest.kind).toBe("storyboard_assets");
    expect(manifest.assetsDir).toBe("storyboards/cold-ledger/assets");
    expect(manifest.generatedDir).toBe("storyboards/cold-ledger/assets/generated");
    expect(manifest.selectedDir).toBe("storyboards/cold-ledger/assets/selected");
    expect(manifest.assets).toEqual([
      {
        shotId: "shot-001",
        prompt: "mock_text，mock_text，mock_text，9:16",
        sourceRefs: [],
        variants: [],
        status: "prompt_ready",
      },
      {
        shotId: "shot-002",
        prompt: "mock_text，mock_text",
        sourceRefs: [],
        variants: [],
        status: "prompt_ready",
      },
    ]);
  });
});
