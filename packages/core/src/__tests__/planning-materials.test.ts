import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gatherPlanningMaterials } from "../utils/planning-materials.js";

describe("gatherPlanningMaterials", () => {
  let root: string;
  let bookDir: string;
  let storyDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "castor-planning-materials-"));
    bookDir = join(root, "books", "harbor-book");
    storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });
    await mkdir(join(bookDir, "chapters"), { recursive: true });

    await Promise.all([
      writeFile(join(storyDir, "author_intent.md"), "# Author Intent\n\nStay on the mentor-debt line.\n", "utf-8"),
      writeFile(join(storyDir, "current_focus.md"), "# Current Focus\n\nReturn to the harbor ledger.\n", "utf-8"),
      writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n\n- The jade seal cannot be destroyed.\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 4\nForce the warehouse confrontation.\n", "utf-8"),
      writeFile(join(storyDir, "book_rules.md"), "---\nprohibitions:\n  - Do not reveal the mastermind\n---\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "# Current State\n\n- Lin Yue is still injured.\n", "utf-8"),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
          "|---|---|---|---|---|---|---|---|",
          "| 2 | Trial Fallout | Lin Yue | Mentor leaves the trial | Debt deepens | Mentor debt unresolved | tense | investigation |",
          "| 3 | Canal Shadow | Lin Yue,A Sheng | Ledger trail appears | Harbor pressure rises | Ledger route now points to the warehouse | tight | pursuit |",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "pending_hooks.md"),
        [
          "# Pending Hooks",
          "",
          "| hook_id | start_chapter | type | status | last_advanced_chapter | expected_payoff | payoff_timing | notes |",
          "|---|---|---|---|---|---|---|---|",
          "| H019 | 2 | mentor-debt | active | 3 | Mentor debt becomes immediate cost | mid-arc | Ledger pressure keeps tightening |",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(bookDir, "chapters", "0003_Canal Shadow.md"),
        [
          "# Chương 3 Canal Shadow",
          "",
          "mock_text，mock_text。",
          "mock_text，mock_text：mock_text。",
        ].join("\n"),
        "utf-8",
      ),
    ]);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("collects deterministic planning materials without reading prior chapter bodies", async () => {
    const result = await gatherPlanningMaterials({
      bookDir,
      chapterNumber: 4,
      goal: "Force the warehouse confrontation.",
      outlineNode: "Force the warehouse confrontation.",
    });

    expect(result.authorIntent).toContain("mentor-debt");
    expect(result.currentFocus).toContain("harbor ledger");
    expect(result.recentSummaries).toHaveLength(2);
    expect(result.previousEndingHook).toContain("warehouse");
    expect(result.previousEndingExcerpt).toContain("mock_text");
    expect(result.activeHooks).toEqual([
      expect.objectContaining({
        hookId: "H019",
      }),
    ]);
    expect(result.plannerInputs).toEqual(expect.arrayContaining([
      join(storyDir, "author_intent.md"),
      join(storyDir, "chapter_summaries.md"),
      join(storyDir, "pending_hooks.md"),
    ]));
  });
});
