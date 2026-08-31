import { describe, expect, it } from "vitest";
import { buildShortFictionWriterUserPrompt } from "../prompts/short-fiction.js";

describe("short-fiction writer craft prompt", () => {
  const prompt = buildShortFictionWriterUserPrompt({
    direction: "mock_text mock_text mock_text",
    outlineMarkdown: "## mock_text\nChương 1 mock_text",
    chapterCount: 12,
    charsPerChapter: 1000,
  });

  it("tells the writer to play out the climax as a scene, not summarize it (B3)", () => {
    expect(prompt).toContain("mock_text");
    expect(prompt).toContain("mock_text"); // already-present discipline still holds
  });

  it("restrains simile over-reliance (B2)", () => {
    expect(prompt).toContain("mock_text");
  });
});
