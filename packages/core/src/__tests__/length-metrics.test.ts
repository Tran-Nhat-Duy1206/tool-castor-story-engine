import { describe, it, expect } from "vitest";
import {
  buildLengthSpec,
  countChapterLength,
  defaultChapterLength,
  isOutsideHardRange,
  isOutsideSoftRange,
} from "../utils/length-metrics.js";

describe("length metrics", () => {
  it("counts Chinese chapter length using zh_chars", () => {
    expect(countChapterLength("mock_text。", "zh_chars")).toBe(6);
  });

  it("counts English chapter length using en_words", () => {
    expect(countChapterLength("He looked at the sky.", "en_words")).toBe(5);
  });

  it("defaults chapter length to the language-native unit", () => {
    expect(defaultChapterLength("vi")).toBe(3000);
    expect(defaultChapterLength("en")).toBe(2000);
    expect(defaultChapterLength()).toBe(3000);
  });

  it("counts prose only for markdown-shaped Chinese chapters", () => {
    const markdownChapter = [
      "---",
      "title: Chương 1 mock_text",
      "---",
      "",
      "# Chương 1 mock_text",
      "",
      "mock_text。",
    ].join("\n");

    expect(countChapterLength(markdownChapter, "zh_chars")).toBe("mock_text。".length);
  });

  it("builds a conservative length spec for Chinese chapters", () => {
    const spec = buildLengthSpec(2200, "vi");

    expect(spec).toEqual({
      target: 2200,
      softMin: 1900,
      softMax: 2500,
      hardMin: 1600,
      hardMax: 2800,
      countingMode: "zh_chars",
    });
  });

  it("builds a conservative length spec for English chapters", () => {
    const spec = buildLengthSpec(2200, "en");

    expect(spec.countingMode).toBe("en_words");
    expect(spec.softMin).toBe(1900);
    expect(spec.softMax).toBe(2500);
    expect(spec.hardMin).toBe(1600);
    expect(spec.hardMax).toBe(2800);
  });

  it("scales the conservative bands for smaller targets", () => {
    const spec = buildLengthSpec(220, "vi");

    expect(spec.softMin).toBe(190);
    expect(spec.softMax).toBe(250);
    expect(spec.hardMin).toBe(160);
    expect(spec.hardMax).toBe(280);
  });

  it("detects soft and hard range drift", () => {
    const spec = buildLengthSpec(2200, "vi");

    expect(isOutsideSoftRange(1800, spec)).toBe(true);
    expect(isOutsideSoftRange(2200, spec)).toBe(false);
    expect(isOutsideHardRange(1500, spec)).toBe(true);
    expect(isOutsideHardRange(2200, spec)).toBe(false);
  });

});
