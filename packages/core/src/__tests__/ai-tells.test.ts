import { describe, it, expect } from "vitest";
import { analyzeAITells } from "../agents/ai-tells.js";

describe("analyzeAITells", () => {
  it("returns no issues for varied paragraph lengths", () => {
    const content = [
      "mock_text。",
      "",
      "mock_text，mock_text，mock_text。",
      "",
      "mock_text。mock_text，mock_text。mock_text，mock_text。mock_text。",
    ].join("\n");

    const result = analyzeAITells(content);
    const paraIssues = result.issues.filter((i) => i.category === "mock_text");
    expect(paraIssues).toHaveLength(0);
  });

  it("detects uniform paragraph lengths (dim 20)", () => {
    // Generate paragraphs of nearly identical length
    const para = "mock_textTestmock_text，mock_text。";
    const content = [para, "", para, "", para, "", para].join("\n");

    const result = analyzeAITells(content);
    const paraIssues = result.issues.filter((i) => i.category === "mock_text");
    expect(paraIssues.length).toBeGreaterThan(0);
    expect(paraIssues[0]!.severity).toBe("warning");
  });

  it("detects high hedge word density (dim 21)", () => {
    const content = [
      "mock_text。",
      "",
      "mock_text。mock_text。",
      "",
      "mock_text，mock_text。mock_text。",
    ].join("\n");

    const result = analyzeAITells(content);
    const hedgeIssues = result.issues.filter((i) => i.category === "mock_text");
    expect(hedgeIssues.length).toBeGreaterThan(0);
  });

  it("detects formulaic transition repetition (dim 22)", () => {
    const content = [
      "Chương mock_text。mock_text。",
      "",
      "Chương mock_text。mock_text。",
      "",
      "Chương mock_text。mock_text。",
    ].join("\n");

    const result = analyzeAITells(content);
    const transIssues = result.issues.filter((i) => i.category === "mock_text");
    expect(transIssues.length).toBeGreaterThan(0);
    expect(transIssues[0]!.description).toContain("mock_text");
  });

  it("detects list-like sentence structure (dim 23)", () => {
    const content = [
      "mock_text。mock_text。mock_text。mock_text。",
    ].join("\n");

    const result = analyzeAITells(content);
    const listIssues = result.issues.filter((i) => i.category === "mock_text");
    expect(listIssues.length).toBeGreaterThan(0);
    expect(listIssues[0]!.severity).toBe("info");
  });

  it("returns no issues for content with fewer than 3 paragraphs", () => {
    const content = "mock_text。";
    const result = analyzeAITells(content);
    expect(result.issues).toHaveLength(0);
  });

  it("returns no issues for clean varied text", () => {
    const content = [
      "mock_text。mock_text，mock_text。",
      "",
      "mock_text。mock_text，mock_text。mock_text。",
      "",
      "\"mock_text？\"mock_text，mock_text。mock_text，mock_text。mock_text，mock_text。mock_text，mock_text。",
    ].join("\n");

    const result = analyzeAITells(content);
    // Should have no or few issues for natural-looking text
    const warningIssues = result.issues.filter((i) => i.severity === "warning");
    expect(warningIssues).toHaveLength(0);
  });
});
