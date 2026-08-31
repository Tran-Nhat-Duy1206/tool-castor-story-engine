import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlannerAgent } from "../agents/planner.js";
import * as llmProvider from "../llm/provider.js";
import type { LLMClient } from "../llm/provider.js";
import type { BookConfig } from "../models/book.js";

const VALID_BODY = `
## Cảnh và ngân sách độ dài
- mock_text（900 từ）：mock_text，mock_text。
- mock_text（1200 từ）：mock_text，mock_text。
- mock_text（900 từ）：mock_text，mock_text。

## Nhiệm vụ hiện tại
mock_text，mock_text，mock_text"mock_text"mock_text。

## Độc giả đang chờ đợi điều gì lúc này
1) mock_text
2) mock_text，mock_text

## Cần thực hiện / tạm giữ lại
- mock_text：mock_text → mock_text
- mock_text：mock_text → mock_textChương 20

## Nhịp chậm / chuyển cảnh đảm nhận điều gì
mock_text - mock_text，mock_text。

## Kiểm tra ba câu hỏi cho lựa chọn then chốt
- mock_text：
  - mock_text？mock_text
  - mock_text？mock_text
  - mock_text？mock_text
- mock_text/mock_text：
  - mock_text？mock_text
  - mock_text？mock_text
  - mock_text？mock_text

## Thay đổi bắt buộc cuối chương
- mock_text：mock_text，mock_text

## Sổ hook chương này
advance:
- H03 "mock_text" → mock_text pressured → near_payoff（mock_text）
resolve:
- S004 "mock_text" → mock_text，mock_text
defer:
- H07 "mock_text" → Chương 20mock_text

## Không làm
- mock_text
- mock_text
`.trim();

function validMemoRaw(chapter: number): string {
  return `# Chương  ${chapter} mock_text memo

## mock_text
mock_text

## mock_text
- H03
- S004

${VALID_BODY}
`;
}

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

const STUB_CLIENT: LLMClient = {
  provider: "openai",
  apiFormat: "chat",
  stream: false,
  defaults: { temperature: 0.7, maxTokens: 2048, thinkingBudget: 0, maxTokensCap: null, extra: {} },
};

function makeBook(): BookConfig {
  return {
    id: "book-plan-1",
    title: "Test Book",
    genre: "urban",
    platform: "qidian",
    status: "active",
    language: "vi",
    targetChapters: 120,
    chapterWordCount: 3000,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
  };
}

async function seedStoryFiles(bookDir: string): Promise<void> {
  const storyDir = join(bookDir, "story");
  await mkdir(storyDir, { recursive: true });
  await Promise.all([
    writeFile(join(storyDir, "author_intent.md"), "# Intent\n- Tell a taut mystery.", "utf-8"),
    writeFile(join(storyDir, "current_focus.md"), "# Focus\n- Keep pressure on the seventh gate.", "utf-8"),
    writeFile(join(storyDir, "story_bible.md"), "# Bible\n- Protagonist: mock_text", "utf-8"),
    writeFile(join(storyDir, "volume_outline.md"), "# Outline\n- Chương 1：Mo dau", "utf-8"),
    writeFile(join(storyDir, "chapter_summaries.md"), "# Summaries\n", "utf-8"),
    writeFile(join(storyDir, "book_rules.md"), "# Rules\n- mock_text", "utf-8"),
    writeFile(join(storyDir, "current_state.md"), "# State\n- mock_text", "utf-8"),
    writeFile(join(storyDir, "pending_hooks.md"), "# Hooks\n", "utf-8"),
    writeFile(join(storyDir, "subplot_board.md"), "# Subplot\n", "utf-8"),
    writeFile(join(storyDir, "emotional_arcs.md"), "# Arcs\n", "utf-8"),
    writeFile(join(storyDir, "character_matrix.md"), "# Matrix\n", "utf-8"),
  ]);
}

describe("PlannerAgent.planChapter memo generation", () => {
  let root: string;
  let bookDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "planner-memo-"));
    bookDir = join(root, "book");
    await seedStoryFiles(bookDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  function makePlanner(): PlannerAgent {
    return new PlannerAgent({
      client: STUB_CLIENT,
      model: "test-model",
      projectRoot: root,
      bookId: "book-plan-1",
    });
  }

  it("produces a valid ChapterMemo when the LLM returns well-formed output", async () => {
    const chatSpy = vi.spyOn(llmProvider, "chatCompletion").mockResolvedValue({
      content: validMemoRaw(1),
      usage: ZERO_USAGE,
    } as unknown as Awaited<ReturnType<typeof llmProvider.chatCompletion>>);

    const result = await makePlanner().planChapter({
      book: makeBook(),
      bookDir,
      chapterNumber: 1,
    });

    expect(chatSpy).toHaveBeenCalledTimes(1);
    expect(result.memo.chapter).toBe(1);
    expect(result.memo.isGoldenOpening).toBe(true); // ch1 zh → golden opening, authoritative over LLM
    expect(result.memo.goal).toBe("mock_text");
    expect(result.memo.threadRefs).toEqual(["H03", "S004"]);
    expect(result.memo.body).toContain("## Nhiệm vụ hiện tại");
  });

  it("does not hard-cap memo generation below the configured model output budget", async () => {
    const chatSpy = vi.spyOn(llmProvider, "chatCompletion").mockResolvedValue({
      content: validMemoRaw(1),
      usage: ZERO_USAGE,
    } as unknown as Awaited<ReturnType<typeof llmProvider.chatCompletion>>);

    await makePlanner().planChapter({
      book: makeBook(),
      bookDir,
      chapterNumber: 1,
    });

    const callArgs = chatSpy.mock.calls[0]!;
    const options = callArgs[3] as { temperature?: number; maxTokens?: number } | undefined;
    expect(options).toEqual(expect.objectContaining({ temperature: 0.7 }));
    expect(options).not.toHaveProperty("maxTokens");
  });

  it("passes per-chapter user context into the memo prompt as a high-priority instruction", async () => {
    const chatSpy = vi.spyOn(llmProvider, "chatCompletion").mockResolvedValue({
      content: validMemoRaw(1),
      usage: ZERO_USAGE,
    } as unknown as Awaited<ReturnType<typeof llmProvider.chatCompletion>>);

    await makePlanner().planChapter({
      book: makeBook(),
      bookDir,
      chapterNumber: 1,
      externalContext: "mock_text：mock_text\nmock_text。",
    });

    const callArgs = chatSpy.mock.calls[0]!;
    const messages = callArgs[2] as ReadonlyArray<{ role: string; content: string }>;
    const userMsg = messages.find((m) => m.role === "user");
    expect(userMsg?.content).toContain("mock_text");
    expect(userMsg?.content).toContain("mock_text：mock_text");
    expect(userMsg?.content).toContain("mock_text");
  });

  it("retries when the first response is malformed and succeeds on retry", async () => {
    const chatSpy = vi.spyOn(llmProvider, "chatCompletion")
      .mockResolvedValueOnce({
        content: "no memo sections here",
        usage: ZERO_USAGE,
      } as unknown as Awaited<ReturnType<typeof llmProvider.chatCompletion>>)
      .mockResolvedValueOnce({
        content: "still no memo sections",
        usage: ZERO_USAGE,
      } as unknown as Awaited<ReturnType<typeof llmProvider.chatCompletion>>)
      .mockResolvedValueOnce({
        content: validMemoRaw(4),
        usage: ZERO_USAGE,
      } as unknown as Awaited<ReturnType<typeof llmProvider.chatCompletion>>);

    const result = await makePlanner().planChapter({
      book: makeBook(),
      bookDir,
      chapterNumber: 4,
    });

    expect(chatSpy).toHaveBeenCalledTimes(3);
    expect(result.memo.chapter).toBe(4);
    expect(result.memo.isGoldenOpening).toBe(false);

    // Retry prompts must include the failure feedback
    const secondCallArgs = chatSpy.mock.calls[1]!;
    const secondMessages = secondCallArgs[2] as ReadonlyArray<{ role: string; content: string }>;
    const userMsg = secondMessages.find((m) => m.role === "user");
    expect(userMsg?.content).toContain("mock_text");
  });

  // Phase hotfix 4: English books must receive English system + user prompts
  // and English golden-opening guidance for chapters ≤ 3.
  it("uses English prompts end-to-end when book.language is en", async () => {
    const VALID_EN_BODY = `
## Scene and length budget
- Scene one (600 words): enter Door 7, inspect the lock, and rule out ordinary wear.
- Scene two (800 words): compare access logs with surveillance timing and establish a verifiable chain of evidence.
- Scene three (600 words): leave with proof while the mastermind's pressure closes in without revealing them.

## Current task
Pin the Door 7 tampering from suspicion to live evidence.

## What the reader is waiting for right now
1) Reader expects to learn whether Door 7 is really compromised.
2) This chapter pays it off in full — live evidence on stage.

## To pay off / to keep buried
- Pay off: Door 7 anomaly → live evidence
- Keep buried: the mastermind → push to chapter 20

## What the slow / transitional beats carry
n/a — pressure chapter, no transitional beats.

## Three-question check on the key choice
- Protagonist's most important choice this chapter:
  - Why this choice? It is the only remaining lead.
  - Does it match current interest? Yes.
  - Does it match their persona? Yes.
- Antagonist / supporting cast's most important choice this chapter:
  - Why this choice? To cover their tracks.
  - Does it match current interest? Yes.
  - Does it match their persona? Yes.

## Required end-of-chapter change
- Information change: protagonist holds live evidence.

## Hook ledger for this chapter
advance:
- H03 "Door 7 anomaly" → pressured → near_payoff (pinned as live evidence this chapter)
defer:
- H07 "the mastermind" → hold until chapter 20

## Do not
- Do not let the antagonist suddenly turn dumb.
- Do not directly name the mastermind.
`.trim();

    const validEnRaw = `# Chapter 1 memo

## Chapter goal
Pin Door 7 tampering as live evidence

## Thread refs
- H03

${VALID_EN_BODY}
`;

    const chatSpy = vi.spyOn(llmProvider, "chatCompletion").mockResolvedValue({
      content: validEnRaw,
      usage: ZERO_USAGE,
    } as unknown as Awaited<ReturnType<typeof llmProvider.chatCompletion>>);

    const enBook = { ...makeBook(), language: "en" as const };
    const result = await makePlanner().planChapter({
      book: enBook,
      bookDir,
      chapterNumber: 1,
    });

    expect(chatSpy).toHaveBeenCalledTimes(1);
    expect(result.memo.chapter).toBe(1);
    expect(result.memo.isGoldenOpening).toBe(true); // ch1 en → also golden (≤5)

    // System prompt must be the English variant
    const callArgs = chatSpy.mock.calls[0]!;
    const messages = callArgs[2] as ReadonlyArray<{ role: string; content: string }>;
    const systemMsg = messages.find((m) => m.role === "system");
    const userMsg = messages.find((m) => m.role === "user");

    // English system prompt markers
    expect(systemMsg?.content).toContain("editor-in-chief");
    expect(systemMsg?.content).toContain("Output format (strict)");
    expect(systemMsg?.content).not.toContain("mock_text");

    // English user template markers
    expect(userMsg?.content).toContain("# Chapter 1 memo request");
    expect(userMsg?.content).toContain("Last screen of previous chapter");
    expect(userMsg?.content).toContain("Golden opening chapter: yes");
    expect(userMsg?.content).not.toContain("# Chương 1 memo mock_text");

    // English golden-opening guidance appended for ch ≤ 3
    expect(userMsg?.content).toContain("Golden Opening Guidance");
    expect(userMsg?.content).toContain("Chapter 1");
    expect(userMsg?.content).not.toContain("mock_text");
  });

  it("returns a degraded memo instead of throwing when all 3 attempts fail", async () => {
    vi.spyOn(llmProvider, "chatCompletion").mockResolvedValue({
      content: "permanently broken",
      usage: ZERO_USAGE,
    } as unknown as Awaited<ReturnType<typeof llmProvider.chatCompletion>>);

    const result = await makePlanner().planChapter({
      book: makeBook(),
      bookDir,
      chapterNumber: 2,
    });

    expect(result.memo.chapter).toBe(2);
    expect(result.memo.goal.length).toBeGreaterThan(0);
    expect(result.memo.body).toContain("## Nhiệm vụ hiện tại");
    expect(result.memo.body).toContain("## Planner warning");
    expect(result.intentMarkdown).toContain("Planner warning");
  });

  // Phase hotfix 5: planner.intent.mustAvoid must come from the Phase 5
  // authoritative loader (story_frame frontmatter), not from raw
  // book_rules.md — for new-layout books the legacy file is just a shim.
  it("derives intent.mustAvoid from outline/story_frame.md frontmatter (new layout)", async () => {
    // Replace book_rules.md with a Phase 5 compat shim (no YAML, just pointer)
    // and put the authoritative YAML on outline/story_frame.md.
    const storyDir = join(bookDir, "story");
    await mkdir(join(storyDir, "outline"), { recursive: true });
    await writeFile(
      join(storyDir, "outline/story_frame.md"),
      [
        "---",
        "version: \"1.0\"",
        "protagonist:",
        "  name: mock_text",
        "  personalityLock: []",
        "  behavioralConstraints: []",
        "prohibitions:",
        "  - mock_text",
        "  - mock_text",
        "---",
        "",
        "## mock_text",
        "mock_text。",
      ].join("\n"),
      "utf-8",
    );
    await writeFile(
      join(storyDir, "book_rules.md"),
      "# mock_text（mock_text——mock_text）\n\n> mock_text。",
      "utf-8",
    );

    vi.spyOn(llmProvider, "chatCompletion").mockResolvedValue({
      content: validMemoRaw(2),
      usage: ZERO_USAGE,
    } as unknown as Awaited<ReturnType<typeof llmProvider.chatCompletion>>);

    const result = await makePlanner().planChapter({
      book: makeBook(),
      bookDir,
      chapterNumber: 2,
    });

    expect(result.intent.mustAvoid).toContain("mock_text");
    expect(result.intent.mustAvoid).toContain("mock_text");
  });
});
