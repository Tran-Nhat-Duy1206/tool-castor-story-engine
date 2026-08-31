import { describe, it, expect } from "vitest";
import { analyzeStyle } from "../agents/style-analyzer.js";

describe("analyzeStyle", () => {
  const sampleText = [
    "mock_text。mock_text，mock_text。mock_text，mock_text。",
    "",
    "\"mock_text？\"mock_text，mock_text。mock_text，mock_text。",
    "",
    "mock_text，mock_text。mock_text，mock_text。mock_text。mock_text。mock_text。mock_text。mock_text，mock_text。mock_text。",
  ].join("\n");

  it("calculates sentence length statistics", () => {
    const profile = analyzeStyle(sampleText);
    expect(profile.avgSentenceLength).toBeGreaterThan(0);
    expect(profile.sentenceLengthStdDev).toBeGreaterThan(0);
  });

  it("calculates paragraph length statistics", () => {
    const profile = analyzeStyle(sampleText);
    expect(profile.avgParagraphLength).toBeGreaterThan(0);
    expect(profile.paragraphLengthRange.min).toBeGreaterThan(0);
    expect(profile.paragraphLengthRange.max).toBeGreaterThanOrEqual(profile.paragraphLengthRange.min);
  });

  it("calculates vocabulary diversity", () => {
    const profile = analyzeStyle(sampleText);
    expect(profile.vocabularyDiversity).toBeGreaterThan(0);
    expect(profile.vocabularyDiversity).toBeLessThanOrEqual(1);
  });

  it("includes source name when provided", () => {
    const profile = analyzeStyle(sampleText, "Testmock_text");
    expect(profile.sourceName).toBe("Testmock_text");
  });

  it("includes analyzed timestamp", () => {
    const profile = analyzeStyle(sampleText);
    expect(profile.analyzedAt).toBeDefined();
  });

  it("handles empty text", () => {
    const profile = analyzeStyle("");
    expect(profile.avgSentenceLength).toBe(0);
    expect(profile.avgParagraphLength).toBe(0);
    expect(profile.vocabularyDiversity).toBe(0);
  });

  it("detects top patterns from repeated sentence openings", () => {
    const repetitiveText = [
      "mock_text。mock_text。mock_text。mock_text。",
      "",
      "mock_text。mock_text。",
    ].join("\n");

    const profile = analyzeStyle(repetitiveText);
    // "mock_text" should be detected as a top pattern
    const hasHeKan = profile.topPatterns.some((p) => p.includes("mock_text"));
    expect(hasHeKan).toBe(true);
  });
});

describe("analyzeStyle (English)", () => {
  const sampleEn = [
    "He stepped onto the cracked stone. He looked down. He smiled.",
    "",
    "The eyes in the dark watched him like a cold winter wind. He was not afraid. He had faced worse. He had faced far more dangerous men. He gripped the hilt and walked toward them.",
  ].join("\n");

  it("measures sentence length in words, not characters", () => {
    const profile = analyzeStyle(sampleEn, "ref", "en");
    expect(profile.avgSentenceLength).toBeGreaterThan(0);
    expect(profile.avgSentenceLength).toBeLessThan(40); // words; a char count would be far higher
  });

  it("computes word-level vocabulary diversity", () => {
    const profile = analyzeStyle(sampleEn, "ref", "en");
    expect(profile.vocabularyDiversity).toBeGreaterThan(0);
    expect(profile.vocabularyDiversity).toBeLessThanOrEqual(1);
  });

  it("detects repeated English sentence openings by word", () => {
    const profile = analyzeStyle(sampleEn, "ref", "en");
    expect(profile.topPatterns.some((p) => p.toLowerCase().startsWith("he"))).toBe(true);
  });
});
