import { describe, it, expect } from "vitest";
import {
  parseDraftDirectives,
  createDirectiveStreamFilter,
} from "../interaction/draft-directive-parser.js";

// ---------------------------------------------------------------------------
// 1. Pure markdown — no directives
// ---------------------------------------------------------------------------

describe("parseDraftDirectives", () => {
  it("returns empty fields and full text when input has no directives", () => {
    const raw = "# mock_text\n\nmock_text markdown，mock_text。";
    const result = parseDraftDirectives(raw);

    expect(result.fields).toEqual({});
    expect(result.textContent).toBe(raw);
    expect(result.summary).toBe("");
    expect(result.raw).toBe(raw);
  });

  // ---------------------------------------------------------------------------
  // 2. Single :::field extraction
  // ---------------------------------------------------------------------------

  it("extracts a single :::field block", () => {
    const raw = [
      "mock_text từ：",
      "",
      ':::field{key="title" label="mock_text"}',
      "mock_text",
      ":::",
      "",
      "mock_text từ！",
    ].join("\n");

    const result = parseDraftDirectives(raw);

    expect(result.fields["title"]).toBe("mock_text");
    expect(result.textContent).toBe(
      ["mock_text từ：", "", "", "mock_text từ！"].join("\n"),
    );
    expect(result.raw).toBe(raw);
  });

  // ---------------------------------------------------------------------------
  // 3. Multiple fields of different types
  // ---------------------------------------------------------------------------

  it("extracts multiple fields of different types", () => {
    const raw = [
      "mock_text：",
      "",
      ':::field{key="title" label="mock_text"}',
      "mock_text",
      ":::",
      "",
      ':::field{key="worldPremise" label="mock_text" type="textarea"}',
      "mock_text",
      ":::",
      "",
      ':::pick{key="platform" label="mock_text"}',
      "- mock_text",
      "- mock_text",
      "- mock_text",
      ":::",
      "",
      ':::number{key="targetChapters" label="mock_text"}',
      "300",
      ":::",
    ].join("\n");

    const result = parseDraftDirectives(raw);

    expect(result.fields["title"]).toBe("mock_text");
    expect(result.fields["worldPremise"]).toBe("mock_text");
    expect(result.fields["platform"]).toBe("mock_text");
    expect(result.fields["targetChapters"]).toBe("300");
  });

  // ---------------------------------------------------------------------------
  // 4. Nested :::group containing multiple fields
  // ---------------------------------------------------------------------------

  it("extracts fields nested inside a :::group", () => {
    const raw = [
      "mock_text：",
      "",
      ':::group{label="mock_text"}',
      ':::number{key="targetChapters" label="mock_text"}',
      "300",
      ":::",
      ':::number{key="chapterLength" label="mock_text từmock_text"}',
      "3000",
      ":::",
      ":::",
      "",
      "mock_text！",
    ].join("\n");

    const result = parseDraftDirectives(raw);

    expect(result.fields["targetChapters"]).toBe("300");
    expect(result.fields["chapterLength"]).toBe("3000");
    // group itself should not appear in textContent
    expect(result.textContent).toBe(
      ["mock_text：", "", "", "mock_text！"].join("\n"),
    );
  });

  // ---------------------------------------------------------------------------
  // 5. Mixed content: markdown paragraphs interspersed with directives
  // ---------------------------------------------------------------------------

  it("handles mixed markdown and directives", () => {
    const raw = [
      "# mock_text",
      "",
      "mock_text。mock_text：",
      "",
      ':::field{key="title" label="mock_text"}',
      "mock_text",
      ":::",
      "",
      "mock_text！mock_text：",
      "",
      ':::field{key="worldPremise" label="mock_text" type="textarea"}',
      "mock_text",
      ":::",
      "",
      "mock_text。",
    ].join("\n");

    const result = parseDraftDirectives(raw);

    expect(result.fields["title"]).toBe("mock_text");
    expect(result.fields["worldPremise"]).toBe("mock_text");
    expect(result.textContent).toContain("# mock_text");
    expect(result.textContent).toContain("mock_text。mock_text：");
    expect(result.textContent).toContain("mock_text！mock_text：");
    expect(result.textContent).toContain("mock_text。");
    expect(result.textContent).not.toContain(":::field");
    expect(result.textContent).not.toContain("mock_text");
  });

  // ---------------------------------------------------------------------------
  // 6. :::pick extracts first option as default value
  // ---------------------------------------------------------------------------

  it("extracts first option from :::pick as default value", () => {
    const raw = [
      ':::pick{key="genre" label="mock_text"}',
      "- mock_text",
      "- mock_text",
      "- mock_text",
      ":::",
    ].join("\n");

    const result = parseDraftDirectives(raw);
    expect(result.fields["genre"]).toBe("mock_text");
  });

  it("handles :::pick with no options gracefully", () => {
    const raw = [
      ':::pick{key="genre" label="mock_text"}',
      ":::",
    ].join("\n");

    const result = parseDraftDirectives(raw);
    expect(result.fields["genre"]).toBe("");
  });

  // ---------------------------------------------------------------------------
  // 7. Summary generation from field labels
  // ---------------------------------------------------------------------------

  it("generates summary from field labels", () => {
    const raw = [
      ':::field{key="title" label="mock_text"}',
      "mock_text",
      ":::",
      ':::field{key="worldPremise" label="mock_text"}',
      "mock_text",
      ":::",
      ':::field{key="protagonist" label="mock_text"}',
      "mock_text",
      ":::",
    ].join("\n");

    const result = parseDraftDirectives(raw);
    expect(result.summary).toBe("mock_text、mock_text");
  });

  it("generates summary with single field", () => {
    const raw = [
      ':::field{key="title" label="mock_text"}',
      "mock_text",
      ":::",
    ].join("\n");

    const result = parseDraftDirectives(raw);
    expect(result.summary).toBe("mock_text");
  });

  it("generates summary with two fields", () => {
    const raw = [
      ':::field{key="title" label="mock_text"}',
      "mock_text",
      ":::",
      ':::field{key="worldPremise" label="mock_text"}',
      "mock_text",
      ":::",
    ].join("\n");

    const result = parseDraftDirectives(raw);
    expect(result.summary).toBe("mock_text");
  });

  // ---------------------------------------------------------------------------
  // 8. Edge case: ::: in code blocks should NOT be parsed as directives
  // ---------------------------------------------------------------------------

  it("does not parse ::: inside fenced code blocks", () => {
    const raw = [
      "mock_text：",
      "",
      "```markdown",
      ':::field{key="demo" label="mock_text"}',
      "mock_text từmock_text",
      ":::",
      "```",
      "",
      "mock_text。",
    ].join("\n");

    const result = parseDraftDirectives(raw);

    expect(result.fields).toEqual({});
    expect(result.textContent).toBe(raw);
  });

  it("does not parse ::: inside indented code blocks with backtick fences", () => {
    const raw = [
      "mock_text：",
      "",
      "````",
      ':::field{key="demo" label="mock_text"}',
      "mock_text từmock_text",
      ":::",
      "````",
      "",
      "mock_text。",
    ].join("\n");

    const result = parseDraftDirectives(raw);
    expect(result.fields).toEqual({});
    expect(result.textContent).toBe(raw);
  });

  // ---------------------------------------------------------------------------
  // Multi-line field value
  // ---------------------------------------------------------------------------

  it("extracts multi-line field value from textarea type", () => {
    const raw = [
      ':::field{key="outline" label="mock_text" type="textarea"}',
      "Chương mock_text：mock_text",
      "Chương mock_text：mock_text",
      "Chương mock_text：mock_text",
      ":::",
    ].join("\n");

    const result = parseDraftDirectives(raw);
    expect(result.fields["outline"]).toBe(
      "Chương mock_text：mock_text\nChương mock_text：mock_text\nChương mock_text：mock_text",
    );
  });

  // ---------------------------------------------------------------------------
  // group label appears in summary
  // ---------------------------------------------------------------------------

  it("does not include group labels in summary (only leaf fields)", () => {
    const raw = [
      ':::group{label="mock_text"}',
      ':::number{key="chapterCount" label="mock_text"}',
      "200",
      ":::",
      ":::",
    ].join("\n");

    const result = parseDraftDirectives(raw);
    // summary should mention "mock_text", not "mock_text"
    expect(result.summary).toBe("mock_text");
  });

  // ---------------------------------------------------------------------------
  // Attribute parsing edge cases
  // ---------------------------------------------------------------------------

  it("handles single-quoted attributes", () => {
    const raw = [
      ":::field{key='title' label='mock_text'}",
      "mock_text",
      ":::",
    ].join("\n");

    const result = parseDraftDirectives(raw);
    expect(result.fields["title"]).toBe("mock_text");
  });

  it("handles attributes with extra spaces", () => {
    const raw = [
      ':::field{ key="title"  label="mock_text" }',
      "mock_text",
      ":::",
    ].join("\n");

    const result = parseDraftDirectives(raw);
    expect(result.fields["title"]).toBe("mock_text");
  });
});

// ---------------------------------------------------------------------------
// Streaming filter
// ---------------------------------------------------------------------------

describe("createDirectiveStreamFilter", () => {
  it("passes through pure text unchanged", () => {
    const filter = createDirectiveStreamFilter();
    expect(filter("mock_text")).toBe("mock_text");
    expect(filter("Chương mock_text từ")).toBe("Chương mock_text từ");
  });

  it("filters out a complete directive block arriving in one chunk", () => {
    const filter = createDirectiveStreamFilter();
    const chunk = ':::field{key="title" label="mock_text"}\nmock_text\n:::\n';
    expect(filter(chunk)).toBe("");
  });

  it("filters directive blocks arriving across multiple chunks", () => {
    const filter = createDirectiveStreamFilter();

    const out1 = filter("mock_text！\n");
    expect(out1).toBe("mock_text！\n");

    // directive opening arrives
    const out2 = filter(':::field{key="title" label="mock_text"}\n');
    expect(out2).toBe("");

    // content inside directive
    const out3 = filter("mock_text\n");
    expect(out3).toBe("");

    // directive close
    const out4 = filter(":::\n");
    expect(out4).toBe("");

    // back to normal text
    const out5 = filter("mock_text。\n");
    expect(out5).toBe("mock_text。\n");
  });

  it("handles nested group directives in stream", () => {
    const filter = createDirectiveStreamFilter();

    expect(filter("mock_text\n")).toBe("mock_text\n");
    expect(filter(':::group{label="mock_text"}\n')).toBe("");
    expect(filter(':::number{key="ch" label="mock_text"}\n')).toBe("");
    expect(filter("300\n")).toBe("");
    expect(filter(":::\n")).toBe(""); // closes number
    expect(filter(":::\n")).toBe(""); // closes group
    expect(filter("mock_text\n")).toBe("mock_text\n");
  });

  it("does not filter ::: inside code blocks during streaming", () => {
    const filter = createDirectiveStreamFilter();

    expect(filter("```\n")).toBe("```\n");
    expect(filter(':::field{key="x" label="y"}\n')).toBe(
      ':::field{key="x" label="y"}\n',
    );
    expect(filter(":::\n")).toBe(":::\n");
    expect(filter("```\n")).toBe("```\n");
  });
});
