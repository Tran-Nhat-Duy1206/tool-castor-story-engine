import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContinuityAuditor } from "../agents/continuity.js";

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

describe("ContinuityAuditor", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a critical audit issue instead of throwing when audit output is not JSON", () => {
    const auditor = new ContinuityAuditor({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: "/tmp/castor-auditor-bad-json-test",
    });

    const result = (auditor as any).parseAuditResult("Mô hình chỉ trả về văn xuôi, không có JSON.", "vi");

    expect(result.passed).toBe(false);
    expect(result.summary).toContain("Audit output parsing failed");
    expect(result.issues).toEqual([
      expect.objectContaining({
        severity: "critical",
        category: "System Error",
      }),
    ]);
  });

  it("parses typed repair_scope from audit JSON", () => {
    const auditor = new ContinuityAuditor({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: "/tmp/castor-auditor-repair-scope-test",
    });

    const result = (auditor as any).parseAuditResult(JSON.stringify({
      passed: false,
      issues: [{
        severity: "critical",
        repair_scope: "structural",
        category: "mock_text",
        description: "mock_text",
        suggestion: "mock_text",
      }],
      summary: "needs rewrite",
    }), "vi");

    expect(result.issues[0]).toMatchObject({
      repairScope: "structural",
      category: "mock_text",
    });
  });

  it("prefers book language override when building audit prompts", async () => {
    const root = await mkdtemp(join(tmpdir(), "castor-auditor-lang-test-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });
    await mkdir(join(root, "prompt", "longform"), { recursive: true });

    await Promise.all([
      writeFile(join(root, "prompt", "longform", "auditor.md"), "PROJECT AUDITOR OVERRIDE", "utf-8"),
      writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({
          id: "english-book",
          title: "English Book",
          genre: "xuanhuan",
          platform: "royalroad",
          chapterWordCount: 800,
          targetChapters: 60,
          status: "active",
          language: "en",
          createdAt: "2026-03-23T00:00:00.000Z",
          updatedAt: "2026-03-23T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      ),
      writeFile(join(storyDir, "current_state.md"), "# Current State\n\n- Lin Yue keeps the oath token hidden.\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), "# Chapter Summaries\n", "utf-8"),
      writeFile(join(storyDir, "subplot_board.md"), "# Subplot Board\n", "utf-8"),
      writeFile(join(storyDir, "emotional_arcs.md"), "# Emotional Arcs\n", "utf-8"),
      writeFile(join(storyDir, "character_matrix.md"), "# Character Matrix\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 1\nReturn to the mentor debt.\n", "utf-8"),
      writeFile(join(storyDir, "style_guide.md"), "# Style Guide\n\n- Keep the prose restrained.\n", "utf-8"),
    ]);

    const auditor = new ContinuityAuditor({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: root,
    });

    const chatSpy = vi.spyOn(ContinuityAuditor.prototype as never, "chat" as never).mockResolvedValue({
      content: JSON.stringify({
        passed: true,
        issues: [],
        summary: "ok",
      }),
      usage: ZERO_USAGE,
    });

    try {
      await auditor.auditChapter(bookDir, "Chapter body.", 1, "xuanhuan");

      const messages = chatSpy.mock.calls[0]?.[0] as
        | ReadonlyArray<{ content: string }>
        | undefined;
      const systemPrompt = messages?.[0]?.content ?? "";

      expect(systemPrompt).toContain("ALL OUTPUT MUST BE IN ENGLISH");
      expect(systemPrompt).toContain("PROJECT AUDITOR OVERRIDE");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("localizes English audit prompts instead of mixing Chinese control text", async () => {
    const root = await mkdtemp(join(tmpdir(), "castor-auditor-en-prompt-test-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({
          id: "english-book",
          title: "English Book",
          genre: "other",
          platform: "royalroad",
          chapterWordCount: 800,
          targetChapters: 60,
          status: "active",
          language: "en",
          createdAt: "2026-03-23T00:00:00.000Z",
          updatedAt: "2026-03-23T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      ),
      writeFile(join(storyDir, "current_state.md"), "# Current State\n\n- Mara keeps the warehouse key hidden.\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), "# Chapter Summaries\n", "utf-8"),
      writeFile(join(storyDir, "subplot_board.md"), "# Subplot Board\n", "utf-8"),
      writeFile(join(storyDir, "emotional_arcs.md"), "# Emotional Arcs\n", "utf-8"),
      writeFile(join(storyDir, "character_matrix.md"), "# Character Matrix\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 1\nCheck Warehouse 9.\n", "utf-8"),
      writeFile(join(storyDir, "style_guide.md"), "# Style Guide\n\n- Keep the prose restrained.\n", "utf-8"),
    ]);

    const auditor = new ContinuityAuditor({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: root,
    });

    const chatSpy = vi.spyOn(ContinuityAuditor.prototype as never, "chat" as never).mockResolvedValue({
      content: JSON.stringify({
        passed: true,
        issues: [],
        summary: "ok",
      }),
      usage: ZERO_USAGE,
    });

    try {
      await auditor.auditChapter(bookDir, "Chapter body.", 1, "other");

      const messages = chatSpy.mock.calls[0]?.[0] as
        | ReadonlyArray<{ content: string }>
        | undefined;
      const systemPrompt = messages?.[0]?.content ?? "";
      const userPrompt = messages?.[1]?.content ?? "";

      expect(systemPrompt).toContain("Hook Check");
      expect(systemPrompt).toContain("Chapter Memo Drift Check");
      expect(systemPrompt).not.toContain("Outline Drift Check");
      expect(systemPrompt).toContain("stays dormant long enough to feel abandoned");
      expect(systemPrompt).toContain("3-question test");
      expect(systemPrompt).toContain("same mode long enough to flatten rhythm");
      expect(systemPrompt).not.toContain("more than 5 chapters");
      expect(systemPrompt).not.toContain("3 straight chapters");
      expect(systemPrompt).not.toContain("3+ consecutive chapters");
      expect(systemPrompt).not.toContain("mock_text");
      expect(systemPrompt).not.toContain("mock_text");

      expect(userPrompt).toContain("Review chapter 1.");
      expect(userPrompt).toContain("## Current State Card");
      expect(userPrompt).toContain("## Pending Hooks");
      expect(userPrompt).not.toContain("mock_textChương 1");
      expect(userPrompt).not.toContain("## mock_text");
      expect(userPrompt).not.toContain("## mock_text");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses selected summary and hook evidence instead of full long-history markdown in governed mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "castor-auditor-test-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(join(storyDir, "current_state.md"), "# Current State\n\n- Lin Yue still hides the broken oath token.\n", "utf-8"),
      writeFile(
        join(storyDir, "pending_hooks.md"),
        [
          "# Pending Hooks",
          "",
          "| hook_id | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| guild-route | 1 | mystery | open | 2 | 6 | Merchant guild trail |",
          "| mentor-oath | 8 | relationship | open | 99 | 101 | Mentor oath debt with Lin Yue |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| 1 | Guild Trail | Merchant guild flees west | Route clues only | None | guild-route seeded | tense | action |",
          "| 99 | Trial Echo | Lin Yue | Mentor left without explanation | Oath token matters again | mentor-oath advanced | aching | fallout |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(join(storyDir, "subplot_board.md"), "# mock_text\n", "utf-8"),
      writeFile(join(storyDir, "emotional_arcs.md"), "# mock_text\n", "utf-8"),
      writeFile(join(storyDir, "character_matrix.md"), "# mock_text\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 100\nTrack the merchant guild trail.\n", "utf-8"),
      writeFile(join(storyDir, "style_guide.md"), "# Style Guide\n\n- Keep the prose restrained.\n", "utf-8"),
    ]);

    const auditor = new ContinuityAuditor({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: root,
    });

    const chatSpy = vi.spyOn(ContinuityAuditor.prototype as never, "chat" as never).mockResolvedValue({
      content: JSON.stringify({
        passed: true,
        issues: [],
        summary: "ok",
      }),
      usage: ZERO_USAGE,
    });

    try {
      await auditor.auditChapter(
        bookDir,
        "Chapter body.",
        100,
        "xuanhuan",
        {
          chapterIntent: "# Chapter Intent\n\n## Goal\nBring the focus back to the mentor oath conflict.\n",
          contextPackage: {
            chapter: 100,
            selectedContext: [
              {
                source: "story/chapter_summaries.md#99",
                reason: "Relevant episodic memory.",
                excerpt: "Trial Echo | Mentor left without explanation | mentor-oath advanced",
              },
              {
                source: "story/pending_hooks.md#mentor-oath",
                reason: "Carry forward unresolved hook.",
                excerpt: "relationship | open | 101 | Mentor oath debt with Lin Yue",
              },
            ],
          },
          ruleStack: {
            layers: [{ id: "L4", name: "current_task", precedence: 70, scope: "local" }],
            sections: {
              hard: ["current_state"],
              soft: ["current_focus"],
              diagnostic: ["continuity_audit"],
            },
            overrideEdges: [],
            activeOverrides: [],
          },
        },
      );

      const messages = chatSpy.mock.calls[0]?.[0] as
        | ReadonlyArray<{ content: string }>
        | undefined;
      const userPrompt = messages?.[1]?.content ?? "";

      expect(userPrompt).toContain("story/chapter_summaries.md#99");
      expect(userPrompt).toContain("story/pending_hooks.md#mentor-oath");
      expect(userPrompt).not.toContain("| 1 | Guild Trail |");
      expect(userPrompt).not.toContain("guild-route | 1 | mystery");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("injects the chapter memo into the audit prompt for memo-drift checking", async () => {
    const root = await mkdtemp(join(tmpdir(), "castor-auditor-memo-drift-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(join(storyDir, "current_state.md"), "# Current State\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), "# Chapter Summaries\n", "utf-8"),
      writeFile(join(storyDir, "subplot_board.md"), "# mock_text\n", "utf-8"),
      writeFile(join(storyDir, "emotional_arcs.md"), "# mock_text\n", "utf-8"),
      writeFile(join(storyDir, "character_matrix.md"), "# mock_text\n", "utf-8"),
      writeFile(join(storyDir, "style_guide.md"), "# Style\n", "utf-8"),
    ]);

    const auditor = new ContinuityAuditor({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: root,
    });

    const chatSpy = vi.spyOn(ContinuityAuditor.prototype as never, "chat" as never).mockResolvedValue({
      content: JSON.stringify({ passed: true, issues: [], summary: "ok" }),
      usage: ZERO_USAGE,
    });

    const memoBody = [
      "## Nhiệm vụ hiện tại",
      "mock_text。",
      "",
      "## Độc giả đang chờ đợi điều gì lúc này",
      "mock_text。",
      "",
      "## Cần thực hiện / tạm giữ lại",
      "mock_text：mock_text；mock_text：mock_text。",
      "",
      "## Nhịp chậm / chuyển cảnh đảm nhận điều gì",
      "mock_text → mock_text + mock_text。",
      "",
      "## Kiểm tra ba câu hỏi cho lựa chọn then chốt",
      "mock_text？",
      "",
      "## Thay đổi bắt buộc cuối chương",
      "mock_text，mock_text。",
      "",
      "## Sổ hook chương này",
      "resolve: H11 mock_text → mock_text。defer: H04 mock_text → mock_textChương 50。",
      "",
      "## Không làm",
      "mock_text。",
    ].join("\n");

    try {
      await auditor.auditChapter(bookDir, "Chapter body.", 42, "xuanhuan", {
        chapterMemo: {
          chapter: 42,
          goal: "mock_text",
          isGoldenOpening: false,
          body: memoBody,
          threadRefs: [],
        },
      });

      const messages = chatSpy.mock.calls[0]?.[0] as
        | ReadonlyArray<{ content: string }>
        | undefined;
      const systemPrompt = messages?.[0]?.content ?? "";
      const userPrompt = messages?.[1]?.content ?? "";

      // Prompt declares structure-only scope and sparse-memo legality.
      expect(systemPrompt).toContain("Reviewer Scope");
      expect(systemPrompt).toContain("You audit completion and structure only");
      expect(systemPrompt).toContain("Sparse chapter_memo is legitimate");
      expect(systemPrompt).toContain("Kiểm tra Lệch Ghi nhớ Chương");
      expect(systemPrompt).not.toContain("volume-outline drift detection");

      // User prompt injects the memo for drift-checking.
      expect(userPrompt).toContain("## Chapter Memo (for memo drift checks)");
      expect(userPrompt).toContain("Goal: mock_text");
      expect(userPrompt).toContain("## Thay đổi bắt buộc cuối chương");
      // Legacy volume-outline block is gone.
      expect(userPrompt).not.toContain("## Volume Outline");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
