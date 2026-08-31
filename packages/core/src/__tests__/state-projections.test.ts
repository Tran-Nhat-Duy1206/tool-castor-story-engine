import { describe, expect, it } from "vitest";
import {
  renderChapterSummariesProjection,
  renderCurrentStateProjection,
  renderHooksProjection,
} from "../state/state-projections.js";

describe("state projections", () => {
  it("renders pending hooks projection with deterministic English ordering", () => {
    const markdown = renderHooksProjection({
      hooks: [
        {
          hookId: "b-courier",
          startChapter: 12,
          type: "mystery",
          status: "open",
          lastAdvancedChapter: 13,
          expectedPayoff: "Identify the courier.",
          notes: "The seal is still broken.",
        },
        {
          hookId: "a-debt",
          startChapter: 4,
          type: "relationship",
          status: "progressing",
          lastAdvancedChapter: 11,
          expectedPayoff: "Reveal the debt.",
          notes: "Old oath token resurfaces.",
        },
      ],
    }, "en");

    expect(markdown).toBe([
      "# Pending Hooks",
      "",
      "| hook_id | start_chapter | type | status | last_advanced_chapter | expected_payoff | payoff_timing | depends_on | pays_off_in_arc | core_hook | half_life | promoted | notes |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      "| a-debt | 4 | relationship | progressing | 11 | Reveal the debt. | mid-arc | none |  | false |  |  | Old oath token resurfaces. |",
      "| b-courier | 12 | mystery | open | 13 | Identify the courier. | mid-arc | none |  | false |  |  | The seal is still broken. |",
      "",
    ].join("\n"));
  });

  it("renders chapter summaries projection with deterministic Vietnamese ordering", () => {
    const markdown = renderChapterSummariesProjection({
      rows: [
        {
          chapter: 12,
          title: "mock_text",
          characters: "mock_text",
          events: "mock_text",
          stateChanges: "mock_text",
          hookActivity: "mentor-debt mock_text",
          mood: "mock_text",
          chapterType: "mock_text",
        },
        {
          chapter: 11,
          title: "mock_text",
          characters: "mock_text",
          events: "mock_text",
          stateChanges: "mock_text",
          hookActivity: "mentor-debt mock_text",
          mood: "mock_text",
          chapterType: "mock_text",
        },
      ],
    }, "vi");

    expect(markdown).toBe([
      "# Tóm tắt chương",
      "",
      "| Chương | Tiêu đề | Nhân vật | Sự kiện chính | Thay đổi trạng thái | Hoạt động gợi mở | Tông cảm xúc | Loại chương |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      "| 11 | mock_text | mock_text | mock_text | mock_text | mentor-debt mock_text | mock_text | mock_text |",
      "| 12 | mock_text | mock_text | mock_text | mock_text | mentor-debt mock_text | mock_text | mock_text |",
      "",
    ].join("\n"));
  });

  it("renders current state projection with placeholders and additional notes", () => {
    const markdown = renderCurrentStateProjection({
      chapter: 12,
      facts: [
        {
          subject: "protagonist",
          predicate: "Current Goal",
          object: "Track the mentor debt through the river-port ledger.",
          validFromChapter: 12,
          validUntilChapter: null,
          sourceChapter: 12,
        },
        {
          subject: "protagonist",
          predicate: "Current Conflict",
          object: "Guild pressure keeps pulling against the debt trail.",
          validFromChapter: 12,
          validUntilChapter: null,
          sourceChapter: 12,
        },
        {
          subject: "current_state",
          predicate: "note_1",
          object: "Lin Yue still hides the broken oath token.",
          validFromChapter: 12,
          validUntilChapter: null,
          sourceChapter: 12,
        },
      ],
    }, "en");

    expect(markdown).toBe([
      "# Current State",
      "",
      "| Field | Value |",
      "| --- | --- |",
      "| Current Chapter | 12 |",
      "| Current Location | (not set) |",
      "| Protagonist State | (not set) |",
      "| Current Goal | Track the mentor debt through the river-port ledger. |",
      "| Current Constraint | (not set) |",
      "| Current Alliances | (not set) |",
      "| Current Conflict | Guild pressure keeps pulling against the debt trail. |",
      "",
      "## Additional State",
      "- Lin Yue still hides the broken oath token.",
      "",
    ].join("\n"));
  });
});
