import { describe, it, expect } from "vitest";
import { analyzeSensitiveWords } from "../agents/sensitive-words.js";

describe("analyzeSensitiveWords", () => {
  it("returns no issues for clean text", () => {
    const content = "mock_text。mock_text，mock_text，mock_text。";
    const result = analyzeSensitiveWords(content);
    expect(result.issues).toHaveLength(0);
    expect(result.found).toHaveLength(0);
  });

  it("detects political terms as block severity", () => {
    const content = "mock_text，mock_text。";
    const result = analyzeSensitiveWords(content);
    expect(result.found.length).toBeGreaterThan(0);
    const politicalMatches = result.found.filter((f) => f.severity === "block");
    expect(politicalMatches.length).toBeGreaterThan(0);
    expect(politicalMatches[0]!.word).toBe("mock_text");
    // Issues should have critical severity for block words
    const criticalIssues = result.issues.filter((i) => i.severity === "critical");
    expect(criticalIssues.length).toBeGreaterThan(0);
    expect(criticalIssues[0]!.category).toBe("mock_text");
  });

  it("detects sexual terms as warn severity", () => {
    const content = "mock_text。";
    const result = analyzeSensitiveWords(content);
    expect(result.found.length).toBeGreaterThan(0);
    const warnMatches = result.found.filter((f) => f.severity === "warn");
    expect(warnMatches.length).toBeGreaterThan(0);
    // Issues should have warning severity for warn words
    const warningIssues = result.issues.filter((i) => i.severity === "warning");
    expect(warningIssues.length).toBeGreaterThan(0);
  });

  it("detects extreme violence terms as warn severity", () => {
    const content = "mock_text。";
    const result = analyzeSensitiveWords(content);
    const violenceMatches = result.found.filter((f) => f.word === "mock_text");
    expect(violenceMatches.length).toBe(1);
    expect(violenceMatches[0]!.severity).toBe("warn");
  });

  it("detects custom words", () => {
    const content = "mock_text「mock_text」mock_text。";
    const result = analyzeSensitiveWords(content, ["mock_text", "mock_text"]);
    expect(result.found.length).toBe(1);
    expect(result.found[0]!.word).toBe("mock_text");
    expect(result.found[0]!.severity).toBe("warn");
  });

  it("counts multiple occurrences of the same word", () => {
    const content = "mock_text，mock_text，mock_text。";
    const result = analyzeSensitiveWords(content);
    const match = result.found.find((f) => f.word === "mock_text");
    expect(match).toBeDefined();
    expect(match!.count).toBe(3);
  });

  it("matches substring words (mock_text in context)", () => {
    // "mock_text" is not in the default list, but "mock_text" is.
    // This test verifies that exact matching works.
    const content = "mock_text，mock_text。";
    const result = analyzeSensitiveWords(content);
    // "mock_text" alone is not in the list, only "mock_text" and "mock_text"
    // So this should not match
    const xinjiangMatch = result.found.find((f) => f.word === "mock_text");
    expect(xinjiangMatch).toBeUndefined();
  });

  it("does not false-positive on partial matches for multi-char words", () => {
    const content = "mock_text，mock_text。";
    const result = analyzeSensitiveWords(content);
    // "mock_text" should not match in "mock_text"
    expect(result.found).toHaveLength(0);
  });

  it("detects multiple categories simultaneously", () => {
    const content = "mock_text，mock_text，mock_text。";
    const result = analyzeSensitiveWords(content);
    const blockCount = result.found.filter((f) => f.severity === "block").length;
    const warnCount = result.found.filter((f) => f.severity === "warn").length;
    expect(blockCount).toBeGreaterThan(0);
    expect(warnCount).toBeGreaterThan(0);
    // Should have issues for both political and sexual/violence
    expect(result.issues.length).toBeGreaterThanOrEqual(2);
  });
});
