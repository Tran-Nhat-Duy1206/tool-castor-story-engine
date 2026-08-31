import { describe, expect, it } from "vitest";
import { buildSpinoffFoundationContext } from "../pipeline/runner.js";

const PARENT_CANON = "## 角色\n林深：记忆债诊所的医生。\n## 世界\n触碰濒死者能读到其记忆。";

describe("buildSpinoffFoundationContext (番外 framing)", () => {
  it("frames the work as an independent side-story that must not advance the parent main line", () => {
    const ctx = buildSpinoffFoundationContext(PARENT_CANON, "讲林深学生时代的一段往事", "vi");
    expect(ctx).toContain("这是一部番外");
    expect(ctx).toContain("独立");
    expect(ctx).toContain("不要推进或违背正传的主线剧情");
  });

  it("embeds the parent canon so the architect reuses its cast and world", () => {
    const ctx = buildSpinoffFoundationContext(PARENT_CANON, undefined, "vi");
    expect(ctx).toContain("正传正典");
    expect(ctx).toContain("林深");
    expect(ctx).toContain("触碰濒死者能读到其记忆");
  });

  it("includes the user's side-story direction when provided, omits the section when blank", () => {
    const withDir = buildSpinoffFoundationContext(PARENT_CANON, "番外聚焦配角的视角", "vi");
    expect(withDir).toContain("番外方向");
    expect(withDir).toContain("番外聚焦配角的视角");

    const noDir = buildSpinoffFoundationContext(PARENT_CANON, "   ", "vi");
    expect(noDir).not.toContain("番外方向");
  });

  it("produces an English framing for en books", () => {
    const ctx = buildSpinoffFoundationContext(PARENT_CANON, "A what-if where the clinic never opened", "en");
    expect(ctx).toContain("This is a SIDE-STORY");
    expect(ctx).toContain("does NOT advance or contradict the parent work's main storyline");
    expect(ctx).toContain("Side-story direction");
    expect(ctx).toContain("Parent canon");
  });
});
