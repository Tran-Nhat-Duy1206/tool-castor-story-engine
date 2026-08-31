import { describe, it, expect } from "vitest";
import {
  PLANNER_MEMO_SYSTEM_PROMPT,
  PLANNER_MEMO_USER_TEMPLATE,
  buildPlannerUserMessage,
  buildGoldenOpeningGuidance,
} from "../agents/planner-prompts.js";

const LENGTH_BUDGET = {
  target: 2200,
  softMin: 1900,
  softMax: 2500,
  hardMin: 1600,
  hardMax: 2800,
  unit: " từ",
} as const;

describe("PLANNER_MEMO_SYSTEM_PROMPT", () => {
  it("contains key mobile web-fiction craft phrases", () => {
    expect(PLANNER_MEMO_SYSTEM_PROMPT).toContain("1 mock_text + 1 mock_text");
    expect(PLANNER_MEMO_SYSTEM_PROMPT).toContain("mock_text");
    expect(PLANNER_MEMO_SYSTEM_PROMPT).toContain("mock_text YAML frontmatter");
    expect(PLANNER_MEMO_SYSTEM_PROMPT).toContain("## mock_text");
    expect(PLANNER_MEMO_SYSTEM_PROMPT).toContain("## mock_text");
    expect(PLANNER_MEMO_SYSTEM_PROMPT).toContain("## Cảnh và ngân sách độ dài");
    expect(PLANNER_MEMO_SYSTEM_PROMPT).toContain("mock_text 50  từ");
    expect(PLANNER_MEMO_SYSTEM_PROMPT).toContain("## Nhiệm vụ hiện tại");
    expect(PLANNER_MEMO_SYSTEM_PROMPT).toContain("## Không làm");
  });

  it("is not accidentally empty", () => {
    expect(PLANNER_MEMO_SYSTEM_PROMPT.length).toBeGreaterThan(500);
  });
});

describe("PLANNER_MEMO_USER_TEMPLATE", () => {
  it("contains all placeholders", () => {
    const placeholders = [
      "{{chapterNumber}}",
      "{{previous_chapter_ending_excerpt}}",
      "{{recent_summaries}}",
      "{{current_arc_prose}}",
      "{{protagonist_matrix_row}}",
      "{{opponent_rows}}",
      "{{collaborator_rows}}",
      "{{relevant_threads}}",
      "{{recyclable_hooks}}",
      "{{isGoldenOpening}}",
      "{{lengthTarget}}",
      "{{lengthSoftMin}}",
      "{{lengthSoftMax}}",
      "{{lengthHardMin}}",
      "{{lengthHardMax}}",
      "{{lengthUnit}}",
      "{{book_rules_relevant}}",
    ];
    for (const ph of placeholders) {
      expect(PLANNER_MEMO_USER_TEMPLATE).toContain(ph);
    }
  });
});

describe("buildPlannerUserMessage", () => {
  it("fills placeholders in order", () => {
    const out = buildPlannerUserMessage({
      chapterNumber: 12,
      previousChapterEndingExcerpt: "mock_text",
      recentSummaries: "| ch9 | ... |",
      currentArcProse: "mock_text",
      protagonistMatrixRow: "| mock_text | mock_text | ... |",
      opponentRows: "| mock_text | mock_text | ... |",
      collaboratorRows: "| mock_text | mock_text | ... |",
      relevantThreads: "- H03: mock_text\n- S004: mock_text",
      recyclableHooks: "（Chua comock_text hook——mock_text）",
      isGoldenOpening: false,
      lengthBudget: LENGTH_BUDGET,
      bookRulesRelevant: "- mock_text",
    });

    expect(out).toContain("# Chương 12 memo mock_text");
    expect(out).toContain("mock_text");
    expect(out).toContain("| ch9 | ... |");
    expect(out).toContain("mock_text");
    expect(out).toContain("| mock_text | mock_text | ... |");
    expect(out).toContain("| mock_text | mock_text | ... |");
    expect(out).toContain("| mock_text | mock_text | ... |");
    expect(out).toContain("- H03: mock_text");
    expect(out).toContain("mock_text：mock_text");
    expect(out).toContain("mock_text 2200  từ");
    expect(out).toContain("mock_text 1600-2800");
    expect(out).toContain("- mock_text");
    expect(out).not.toContain("{{");
  });

  it("translates isGoldenOpening true to mock_text", () => {
    const out = buildPlannerUserMessage({
      chapterNumber: 1,
      previousChapterEndingExcerpt: "",
      recentSummaries: "",
      currentArcProse: "",
      protagonistMatrixRow: "",
      opponentRows: "",
      collaboratorRows: "",
      relevantThreads: "",
      recyclableHooks: "",
      isGoldenOpening: true,
      lengthBudget: LENGTH_BUDGET,
      bookRulesRelevant: "",
    });
    expect(out).toContain("mock_text：mock_text");
  });
});

// ---------------------------------------------------------------------------
// Phase 6.5 — Golden Opening Guidance prose
// ---------------------------------------------------------------------------

describe("buildGoldenOpeningGuidance", () => {
  it("emits zh slot prose for chapter 1 (confront core conflict)", () => {
    const out = buildGoldenOpeningGuidance(1, "vi");
    expect(out).toContain("mock_text");
    expect(out).toContain("Chương 1");
    // Ch1 slot: throw protagonist into core conflict
    expect(out).toContain("mock_text");
    expect(out).toContain("mock_text");
    // Opening economy
    expect(out).toContain("mock_text ≤ 3");
    expect(out).toContain("mock_text ≤ 3");
    // Information layering
    expect(out).toContain("mock_text");
  });

  it("emits zh slot prose for chapter 2 (demonstrate the edge)", () => {
    const out = buildGoldenOpeningGuidance(2, "vi");
    expect(out).toContain("Chương 2");
    expect(out).toContain("mock_text");
    // Must demand a concrete event, not narration
    expect(out).toContain("mock_text");
  });

  it("emits zh slot prose for chapter 3 (lock the short-term goal)", () => {
    const out = buildGoldenOpeningGuidance(3, "vi");
    expect(out).toContain("Chương 3");
    expect(out).toContain("mock_text");
    expect(out).toContain("3-10 mock_text");
  });

  it("emits en slot prose for chapter 1 with all three slot descriptions", () => {
    const out = buildGoldenOpeningGuidance(1, "en");
    expect(out).toContain("Golden Opening Guidance");
    expect(out).toContain("Chapter 1");
    expect(out).toContain("core conflict");
    expect(out).toContain("concrete event");
    expect(out).toContain("short-term goal");
  });

  it("returns empty string for ch>=4 in both languages", () => {
    expect(buildGoldenOpeningGuidance(4, "vi")).toBe("");
    expect(buildGoldenOpeningGuidance(5, "vi")).toBe("");
    expect(buildGoldenOpeningGuidance(4, "en")).toBe("");
    expect(buildGoldenOpeningGuidance(99, "en")).toBe("");
  });

  it("renders as cohesive prose, not a numbered or bulleted checklist", () => {
    const zh = buildGoldenOpeningGuidance(1, "vi");
    // Heading is allowed; body must not contain enumerated lines.
    expect(zh).not.toMatch(/^\s*1\.\s/m);
    expect(zh).not.toMatch(/^\s*-\s/m);
    expect(zh).not.toMatch(/^\s*\*\s/m);
  });

  it("buildPlannerUserMessage appends guidance for ch<=3 and omits it for ch>=4", () => {
    const base = {
      previousChapterEndingExcerpt: "",
      recentSummaries: "",
      currentArcProse: "",
      protagonistMatrixRow: "",
      opponentRows: "",
      collaboratorRows: "",
      relevantThreads: "",
      recyclableHooks: "",
      isGoldenOpening: false,
      lengthBudget: LENGTH_BUDGET,
      bookRulesRelevant: "",
    };

    const ch2 = buildPlannerUserMessage({ ...base, chapterNumber: 2 });
    expect(ch2).toContain("mock_text");
    expect(ch2).toContain("Chương 2");

    const ch4 = buildPlannerUserMessage({ ...base, chapterNumber: 4 });
    expect(ch4).not.toContain("mock_text");
  });
});
