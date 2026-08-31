import { describe, it, expect } from "vitest";
import { parseWriterOutput, parseCreativeOutput, type ParsedWriterOutput } from "../agents/writer-parser.js";
import type { GenreProfile } from "../models/genre-profile.js";
import { countChapterLength } from "../utils/length-metrics.js";

const defaultGenreProfile: GenreProfile = {
  name: "Test",
  id: "test",
  language: "vi",
  chapterTypes: [],
  fatigueWords: [],
  numericalSystem: true,
  powerScaling: false,
  eraResearch: false,
  pacingRule: "",
  satisfactionTypes: [],
  auditDimensions: [],
};

function callParseOutput(
  chapterNumber: number,
  content: string,
  genreProfile: GenreProfile = defaultGenreProfile,
  countingMode: "zh_chars" | "en_words" = "zh_chars",
): ParsedWriterOutput {
  return parseWriterOutput(chapterNumber, content, genreProfile, countingMode);
}

// ---------------------------------------------------------------------------
// Full tagged output
// ---------------------------------------------------------------------------

describe("WriterAgent parseOutput", () => {
  const fullOutput = [
    "=== PRE_WRITE_CHECK ===",
    "| mock_text | mock_text | mock_text |",
    "|--------|----------|------|",
    "| mock_text | Chương 1 | |",
    "",
    "=== CHAPTER_TITLE ===",
    "mock_text",
    "",
    "=== CHAPTER_CONTENT ===",
    "mock_text，mock_text。",
    "mock_text，mock_text。",
    "",
    "=== POST_SETTLEMENT ===",
    "| mock_text | mock_text | mock_text |",
    "|--------|----------|------|",
    "| mock_text | mock_text0 / mock_text+100 / mock_text100 | |",
    "",
    "=== UPDATED_STATE ===",
    "# mock_text",
    "|  từmock_text | mock_text |",
    "|------|-----|",
    "| mock_text | 1 |",
    "",
    "=== UPDATED_LEDGER ===",
    "# mock_text",
    "| mock_text | mock_text | mock_text | mock_text | mock_text |",
    "|------|------|------|------|------|",
    "| 1 | 0 | mock_text | +100 | 100 |",
    "",
    "=== UPDATED_HOOKS ===",
    "# mock_text",
    "| ID | mock_text | mock_text |",
    "|-----|------|------|",
    "| H001 | mock_text | open |",
  ].join("\n");

  it("extracts all sections from a complete tagged output", () => {
    const result = callParseOutput(1, fullOutput);

    expect(result.chapterNumber).toBe(1);
    expect(result.title).toBe("mock_text");
    expect(result.content).toContain("mock_text");
    expect(result.content).toContain("mock_text");
    expect(result.preWriteCheck).toContain("mock_text");
    expect(result.postSettlement).toContain("mock_text");
    expect(result.updatedState).toContain("mock_text");
    expect(result.updatedLedger).toContain("mock_text");
    expect(result.updatedHooks).toContain("H001");
  });

  it("calculates wordCount with the shared counting helper", () => {
    const result = callParseOutput(1, fullOutput);
    const expectedContent =
      "mock_text，mock_text。\nmock_text，mock_text。";
    expect(result.wordCount).toBe(countChapterLength(expectedContent, "zh_chars"));
  });

  // -------------------------------------------------------------------------
  // Missing sections
  // -------------------------------------------------------------------------

  it("returns default title when CHAPTER_TITLE is missing", () => {
    const output = [
      "=== CHAPTER_CONTENT ===",
      "Some content here.",
    ].join("\n");

    const result = callParseOutput(42, output);
    expect(result.title).toBe("Chương 42");
  });

  it("returns an English default title when CHAPTER_TITLE is missing in English mode", () => {
    const output = [
      "=== CHAPTER_CONTENT ===",
      "Some content here.",
    ].join("\n");

    const result = callParseOutput(42, output, defaultGenreProfile, "en_words");
    expect(result.title).toBe("Chapter 42");
  });

  it("returns empty content when CHAPTER_CONTENT is missing", () => {
    const output = [
      "=== CHAPTER_TITLE ===",
      "A Title",
    ].join("\n");

    const result = callParseOutput(1, output);
    expect(result.content).toBe("");
    expect(result.wordCount).toBe(0);
  });

  it("returns fallback strings for missing state sections", () => {
    const output = [
      "=== CHAPTER_TITLE ===",
      "Title",
      "",
      "=== CHAPTER_CONTENT ===",
      "Content.",
    ].join("\n");

    const result = callParseOutput(1, output);
    expect(result.updatedState).toBe("(mock_text)");
    expect(result.updatedLedger).toBe("(mock_text)");
    expect(result.updatedHooks).toBe("(mock_text)");
  });

  it("returns English fallback strings for missing state sections in English mode", () => {
    const output = [
      "=== CHAPTER_TITLE ===",
      "Title",
      "",
      "=== CHAPTER_CONTENT ===",
      "Content.",
    ].join("\n");

    const result = callParseOutput(1, output, defaultGenreProfile, "en_words");
    expect(result.updatedState).toBe("(state card not updated)");
    expect(result.updatedLedger).toBe("(ledger not updated)");
    expect(result.updatedHooks).toBe("(hooks pool not updated)");
  });

  it("returns empty string for missing PRE_WRITE_CHECK", () => {
    const output = [
      "=== CHAPTER_TITLE ===",
      "Title",
      "",
      "=== CHAPTER_CONTENT ===",
      "Content.",
    ].join("\n");

    const result = callParseOutput(1, output);
    expect(result.preWriteCheck).toBe("");
  });

  it("returns empty string for missing POST_SETTLEMENT", () => {
    const output = [
      "=== CHAPTER_TITLE ===",
      "Title",
      "",
      "=== CHAPTER_CONTENT ===",
      "Content.",
    ].join("\n");

    const result = callParseOutput(1, output);
    expect(result.postSettlement).toBe("");
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  it("handles completely empty input", () => {
    const result = callParseOutput(1, "");
    expect(result.chapterNumber).toBe(1);
    expect(result.title).toBe("Chương 1");
    expect(result.content).toBe("");
    expect(result.wordCount).toBe(0);
    expect(result.updatedState).toBe("(mock_text)");
    expect(result.updatedLedger).toBe("(mock_text)");
    expect(result.updatedHooks).toBe("(mock_text)");
  });

  it("handles content with no tags at all", () => {
    const result = callParseOutput(5, "Just some random text without tags");
    expect(result.title).toBe("Chương 5");
    expect(result.content).toBe("");
    expect(result.wordCount).toBe(0);
  });

  it("preserves multiline content within a section", () => {
    const output = [
      "=== CHAPTER_CONTENT ===",
      "Chương mock_text：mock_text。",
      "",
      "Chương mock_text：mock_text。",
      "",
      "Chương mock_text：mock_text。",
      "",
      "=== POST_SETTLEMENT ===",
      "No settlement.",
    ].join("\n");

    const result = callParseOutput(1, output);
    expect(result.content).toContain("Chương mock_text");
    expect(result.content).toContain("Chương mock_text");
    expect(result.content).toContain("Chương mock_text");
  });

  it("trims whitespace from extracted section values", () => {
    const output = [
      "=== CHAPTER_TITLE ===",
      "   mock_text   ",
      "",
      "=== CHAPTER_CONTENT ===",
      "  mock_text  ",
    ].join("\n");

    const result = callParseOutput(1, output);
    expect(result.title).toBe("mock_text");
    expect(result.content).toBe("mock_text");
  });

  it("correctly counts Chinese characters in wordCount", () => {
    const chineseContent = "mock_textTestmock_text，mock_text từmock_text。";
    const output = [
      "=== CHAPTER_CONTENT ===",
      chineseContent,
    ].join("\n");

    const result = callParseOutput(1, output);
    // wordCount is content.length which counts each character (including punctuation)
    expect(result.wordCount).toBe(chineseContent.length);
  });

  it("counts English content with the shared counting helper when requested", () => {
    const englishContent = "He looked at the sky.";
    const output = [
      "=== CHAPTER_CONTENT ===",
      englishContent,
    ].join("\n");

    const result = callParseOutput(1, output, defaultGenreProfile, "en_words");
    expect(result.wordCount).toBe(countChapterLength(englishContent, "en_words"));
  });
});

// ---------------------------------------------------------------------------
// Fallback parsing for local/small models (#13)
// ---------------------------------------------------------------------------

describe("parseCreativeOutput fallback", () => {
  it("extracts content from markdown heading when tags are missing", () => {
    const raw = `# Chương 1 mock_text

mock_text，mock_text。mock_text，${"mock_text".repeat(30)}mock_text。`;

    const result = parseCreativeOutput(1, raw);
    expect(result.title).toBe("mock_text");
    expect(result.content.length).toBeGreaterThan(100);
    expect(result.content).toContain("mock_text");
  });

  it("extracts English content from markdown headings when tags are missing", () => {
    const raw = `# Chapter 1: Awakening Day

He woke to the sound of distant bells and the taste of salt in the air. ${"Long English prose follows. ".repeat(15)}`;

    const result = parseCreativeOutput(1, raw, "en_words");
    expect(result.title).toBe("Awakening Day");
    expect(result.content.length).toBeGreaterThan(100);
    expect(result.content).toContain("distant bells");
  });

  it("extracts content from mock_text label when tags are missing", () => {
    const raw = `mock_text：mock_text

mock_text：
${"mock_text，mock_text。".repeat(20)}`;

    const result = parseCreativeOutput(5, raw);
    expect(result.title).toBe("mock_text");
    expect(result.content.length).toBeGreaterThan(100);
  });

  it("falls back to longest prose block when no structure is found", () => {
    const prose = "mock_text，mock_text。".repeat(10);
    const raw = `PRE_WRITE_CHECK: completedmock_text
CHAPTER_TITLE: mock_text

${prose}`;

    const result = parseCreativeOutput(3, raw);
    expect(result.content.length).toBeGreaterThan(100);
  });

  it("returns empty content when raw output is too short", () => {
    const result = parseCreativeOutput(1, "mock_text");
    expect(result.content).toBe("");
    expect(result.title).toBe("Chương 1");
  });

  it("returns an English fallback title when short English output has no structure", () => {
    const result = parseCreativeOutput(1, "too short", "en_words");
    expect(result.content).toBe("");
    expect(result.title).toBe("Chapter 1");
  });

  it("still works with proper === TAG === format", () => {
    const raw = `=== PRE_WRITE_CHECK ===
mock_text

=== CHAPTER_TITLE ===
mock_text

=== CHAPTER_CONTENT ===
mock_text，mock_text。`;

    const result = parseCreativeOutput(1, raw);
    expect(result.title).toBe("mock_text");
    expect(result.content).toBe("mock_text，mock_text。");
  });

  it("counts creative output with the shared helper when a counting mode is supplied", () => {
    const raw = `=== CHAPTER_TITLE ===
English Chapter

=== CHAPTER_CONTENT ===
He looked at the sky.`;

    const result = parseCreativeOutput(1, raw, "en_words");
    expect(result.wordCount).toBe(countChapterLength("He looked at the sky.", "en_words"));
  });
});
