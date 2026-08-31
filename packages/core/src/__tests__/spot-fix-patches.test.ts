import { describe, expect, it } from "vitest";
import {
  applySpotFixPatches,
  parseSpotFixPatches,
  type SpotFixPatch,
} from "../utils/spot-fix-patches.js";

describe("spot-fix patches", () => {
  it("parses patch blocks from the PATCHES section", () => {
    const patches = parseSpotFixPatches([
      "=== PATCHES ===",
      "--- PATCH 1 ---",
      "TARGET_TEXT:",
      "mock_text。",
      "REPLACEMENT_TEXT:",
      "mock_text。",
      "--- END PATCH ---",
      "--- PATCH 2 ---",
      "TARGET_TEXT:",
      "mock_text。",
      "REPLACEMENT_TEXT:",
      "mock_text。",
      "--- END PATCH ---",
    ].join("\n"));

    expect(patches).toEqual<SpotFixPatch[]>([
      { targetText: "mock_text。", replacementText: "mock_text。" },
      { targetText: "mock_text。", replacementText: "mock_text。" },
    ]);
  });

  it("applies a uniquely targeted patch while preserving untouched text", () => {
    const original = [
      "mock_text。",
      "mock_text。",
      "",
      "mock_text。",
      "mock_text，mock_text。",
      "mock_text，mock_text。",
    ].join("\n");

    const result = applySpotFixPatches(original, [
      {
        targetText: "mock_text。",
        replacementText: "mock_text，mock_text。",
      },
    ]);

    expect(result.applied).toBe(true);
    expect(result.appliedPatchCount).toBe(1);
    expect(result.skippedPatchCount).toBe(0);
    expect(result.revisedContent).toBe([
      "mock_text。",
      "mock_text，mock_text。",
      "",
      "mock_text。",
      "mock_text，mock_text。",
      "mock_text，mock_text。",
    ].join("\n"));
  });

  it("skips non-unique patches instead of rejecting all", () => {
    const original = "mock_text。\nmock_text。\nmock_text。";

    const result = applySpotFixPatches(original, [
      { targetText: "mock_text", replacementText: "mock_text" },
      { targetText: "mock_text。", replacementText: "mock_text。" },
    ]);

    expect(result.applied).toBe(true);
    expect(result.appliedPatchCount).toBe(1);
    expect(result.skippedPatchCount).toBe(1);
    expect(result.revisedContent).toContain("mock_text。");
    expect(result.revisedContent).toContain("mock_text"); // unchanged — patch was skipped
  });

  it("applies patches via fuzzy match when whitespace differs", () => {
    const original = "mock_text，   mock_text\nmock_text。";

    const result = applySpotFixPatches(original, [
      {
        targetText: "mock_text， mock_text mock_text。",
        replacementText: "mock_text，mock_text。",
      },
    ]);

    expect(result.applied).toBe(true);
    expect(result.appliedPatchCount).toBe(1);
    expect(result.revisedContent).toBe("mock_text，mock_text。");
  });

  it("reports all skipped when no patches can be matched", () => {
    const original = "mock_text。";

    const result = applySpotFixPatches(original, [
      { targetText: "mock_text", replacementText: "mock_text" },
    ]);

    expect(result.applied).toBe(false);
    expect(result.appliedPatchCount).toBe(0);
    expect(result.skippedPatchCount).toBe(1);
    expect(result.rejectedReason).toContain("No patches could be matched");
  });
});
