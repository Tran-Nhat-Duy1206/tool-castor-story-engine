import { describe, expect, it } from "vitest";
import { buildSpinoffFoundationContext } from "../pipeline/runner.js";

const PARENT_CANON = "## mock_text\nLin Shen：mock_text。\n## mock_text\nmock_text。";

describe("buildSpinoffFoundationContext (mock_text framing)", () => {
  it("frames the work as an independent side-story that must not advance the parent main line", () => {
    const ctx = buildSpinoffFoundationContext(PARENT_CANON, "mock_textLin Shenmock_text", "vi");
    expect(ctx).toContain("mock_text");
    expect(ctx).toContain("mock_text");
    expect(ctx).toContain("mock_text");
  });

  it("embeds the parent canon so the architect reuses its cast and world", () => {
    const ctx = buildSpinoffFoundationContext(PARENT_CANON, undefined, "vi");
    expect(ctx).toContain("mock_text");
    expect(ctx).toContain("Lin Shen");
    expect(ctx).toContain("mock_text");
  });

  it("includes the user's side-story direction when provided, omits the section when blank", () => {
    const withDir = buildSpinoffFoundationContext(PARENT_CANON, "mock_text", "vi");
    expect(withDir).toContain("mock_text");
    expect(withDir).toContain("mock_text");

    const noDir = buildSpinoffFoundationContext(PARENT_CANON, "   ", "vi");
    expect(noDir).not.toContain("mock_text");
  });

  it("produces an English framing for en books", () => {
    const ctx = buildSpinoffFoundationContext(PARENT_CANON, "A what-if where the clinic never opened", "en");
    expect(ctx).toContain("This is a SIDE-STORY");
    expect(ctx).toContain("does NOT advance or contradict the parent work's main storyline");
    expect(ctx).toContain("Side-story direction");
    expect(ctx).toContain("Parent canon");
  });
});
