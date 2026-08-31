import { describe, expect, it } from "vitest";
import { PLANNER_MEMO_SYSTEM_PROMPT, PLANNER_MEMO_SYSTEM_PROMPT_EN } from "../agents/planner-prompts.js";

describe("planner prompt line-ratio handling", () => {
  it("requires user-specified plot proportions to become visible chapter beats", () => {
    expect(PLANNER_MEMO_SYSTEM_PROMPT).toContain("mock_text");
    expect(PLANNER_MEMO_SYSTEM_PROMPT).toContain("mock_text/mock_text");
    expect(PLANNER_MEMO_SYSTEM_PROMPT_EN).toContain("User-specified content proportions must become scenes");
    expect(PLANNER_MEMO_SYSTEM_PROMPT_EN).toContain("politics 50% / romance 50%");
  });
});
