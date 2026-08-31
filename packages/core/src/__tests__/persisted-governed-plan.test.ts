import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadPersistedPlan,
  savePersistedPlan,
} from "../pipeline/persisted-governed-plan.js";
import type { PlanChapterOutput } from "../agents/planner.js";

const MEMO_BODY = `## Nhiệm vụ hiện tại
mock_text，mock_text。

## Cảnh và ngân sách độ dài
- mock_text 700  từ
- mock_text 1200  từ
- mock_text 900  từ

## Độc giả đang chờ đợi điều gì lúc này
mock_text，mock_text。

## Cần thực hiện / tạm giữ lại
- mock_text：mock_text，mock_text
- mock_text：mock_text，mock_textChương 6mock_text

## Nhịp chậm / chuyển cảnh đảm nhận điều gì
- [Mo daumock_text] → mock_text，mock_text

## Kiểm tra ba câu hỏi cho lựa chọn then chốt
mock_text：mock_text？mock_text？mock_text？

## Thay đổi bắt buộc cuối chương
- mock_text，mock_text

## Sổ hook chương này
advance: H1 mock_text → planted → pressured（mock_text）
defer: H4 mock_text → Chương 6mock_text

## Không làm
- mock_text
- mock_text`;

function buildPlan(chapter: number): PlanChapterOutput {
  return {
    intent: {
      chapter,
      goal: "mock_text",
      outlineNode: "Chapter 1: return",
      arcContext: "mock_text：Chương mock_text",
      mustKeep: ["mock_text", "mock_text"],
      mustAvoid: ["mock_text"],
      styleEmphasis: ["mock_text", "mock_text"],
    },
    memo: {
      chapter,
      goal: "mock_text",
      isGoldenOpening: true,
      threadRefs: ["H1"],
      body: MEMO_BODY,
    },
    intentMarkdown: "# Chapter Intent\n\n## Goal\nmock_text\n",
    plannerInputs: ["story/volume_outline.md", "story/current_state.md"],
    runtimePath: "unused",
  };
}

describe("persisted-governed-plan round trip", () => {
  it("savePersistedPlan + loadPersistedPlan returns equal memo", async () => {
    const dir = await mkdtemp(join(tmpdir(), "castor-plan-"));
    await mkdir(join(dir, "story", "runtime"), { recursive: true });
    // Write the sibling intent.md so loader reads it back.
    await writeFile(
      join(dir, "story", "runtime", "chapter-0001.intent.md"),
      "# Chapter Intent\n\n## Goal\nmock_text\n",
      "utf-8",
    );

    const plan = buildPlan(1);
    await savePersistedPlan(dir, plan);

    const persisted = await readFile(join(dir, "story", "runtime", "chapter-0001.plan.md"), "utf-8");
    expect(persisted.trimStart()).not.toMatch(/^---\s*\n/);
    expect(persisted).toContain("## mock_text");
    expect(persisted).toContain("## mock_text");

    const loaded = await loadPersistedPlan(dir, 1);
    expect(loaded).not.toBeNull();
    expect(loaded!.memo).toEqual(plan.memo);
    expect(loaded!.intent.goal).toBe(plan.intent.goal);
    expect(loaded!.intent.outlineNode).toBe(plan.intent.outlineNode);
    expect(loaded!.intent.arcContext).toBe(plan.intent.arcContext);
    expect(loaded!.intent.mustKeep).toEqual(plan.intent.mustKeep);
    expect(loaded!.intent.mustAvoid).toEqual(plan.intent.mustAvoid);
    expect(loaded!.intent.styleEmphasis).toEqual(plan.intent.styleEmphasis);
    expect(loaded!.plannerInputs).toEqual(plan.plannerInputs);
  });

  it("returns null when plan file does not exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "castor-plan-"));
    await mkdir(join(dir, "story", "runtime"), { recursive: true });
    const loaded = await loadPersistedPlan(dir, 1);
    expect(loaded).toBeNull();
  });

  it("returns null when memo body is missing required sections", async () => {
    const dir = await mkdtemp(join(tmpdir(), "castor-plan-"));
    await mkdir(join(dir, "story", "runtime"), { recursive: true });

    // Corrupt memo body: drop the Không làm heading.
    const corrupt = `---
chapter: 1
goal: mock_text
isGoldenOpening: true
threadRefs: []
intent:
  goal: mock_text
  outlineNode: Chapter 1
  mustKeep: []
  mustAvoid: []
  styleEmphasis: []
plannerInputs: []
---
## Nhiệm vụ hiện tại
mock_text。
`;
    await writeFile(
      join(dir, "story", "runtime", "chapter-0001.plan.md"),
      corrupt,
      "utf-8",
    );

    const loaded = await loadPersistedPlan(dir, 1);
    expect(loaded).toBeNull();
  });

  it("returns null when chapter number does not match", async () => {
    const dir = await mkdtemp(join(tmpdir(), "castor-plan-"));
    await mkdir(join(dir, "story", "runtime"), { recursive: true });
    const plan = buildPlan(2);
    await savePersistedPlan(dir, plan);
    const loaded = await loadPersistedPlan(dir, 3);
    expect(loaded).toBeNull();
  });
});
