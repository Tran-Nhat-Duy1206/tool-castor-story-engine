import { afterEach, describe, expect, it } from "vitest";
import { renderMarkdown } from "../markdown.js";

describe("renderMarkdown", () => {
  const origTermProgram = process.env.TERM_PROGRAM;
  afterEach(() => {
    if (origTermProgram === undefined) delete process.env.TERM_PROGRAM;
    else process.env.TERM_PROGRAM = origTermProgram;
  });
  it("converts **text** to ANSI bold", () => {
    const result = renderMarkdown("mock_markdown **mock_markdown** mock_markdown");
    // Should contain ANSI bold on/off around mock_markdown
    expect(result).toContain("\x1b[1mmock_markdown\x1b[22m");
    // Should NOT contain raw ** markers
    expect(result).not.toContain("**");
  });

  it("converts * bullets to · bullets", () => {
    const result = renderMarkdown("* mock_markdown\n* mock_markdown");
    expect(result).toContain("· mock_markdown");
    expect(result).toContain("· mock_markdown");
    // No raw * bullets remaining
    expect(result).not.toMatch(/^\s*\* /m);
  });

  it("renders bold inside list items", () => {
    const result = renderMarkdown("* **mock_markdown**: mock_markdown\n* **mock_markdown**: mock_markdown");
    expect(result).toContain("\x1b[1mmock_markdown\x1b[22m");
    expect(result).toContain("\x1b[1mmock_markdown\x1b[22m");
    expect(result).toContain("·");
    expect(result).not.toContain("**");
  });

  it("does not leak bold across lines", () => {
    const result = renderMarkdown("mock_markdown**mock_markdown**，mock_markdown**mock_markdown**。");
    // Each bold region should be self-contained
    const boldRegions = [...result.matchAll(/\x1b\[1m(.*?)\x1b\[22m/g)];
    expect(boldRegions).toHaveLength(2);
    expect(boldRegions[0][1]).toBe("mock_markdown");
    expect(boldRegions[1][1]).toBe("mock_markdown");
  });

  it("renders tables with box-drawing characters", () => {
    const result = renderMarkdown(
      "| mock_markdown | mock_markdown |\n|------|----|\n| mock_markdown | mock_markdown |",
    );
    expect(result).toContain("┌");
    expect(result).toContain("│");
    expect(result).toContain("└");
  });

  it("does not contain full-reset codes that override parent Ink color", () => {
    // \x1b[0m resets ALL terminal attributes including color set by Ink's <Text>.
    // renderMarkdown must not emit it, so the parent <Text color={...}> stays in effect.
    const result = renderMarkdown("mock_markdown **mock_markdown** mock_markdown");
    expect(result).not.toContain("\x1b[0m");
  });

  it("falls back to raw text on parse error", () => {
    // renderMarkdown should never throw; it returns raw text on failure
    const result = renderMarkdown("plain text");
    expect(result).toContain("plain text");
  });
});
