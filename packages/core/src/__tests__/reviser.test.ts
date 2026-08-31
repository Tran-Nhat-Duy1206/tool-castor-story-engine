import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReviserAgent } from "../agents/reviser.js";
import { buildLengthSpec } from "../utils/length-metrics.js";
import type { AuditIssue } from "../agents/continuity.js";

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

const CRITICAL_ISSUE: AuditIssue = {
  severity: "critical",
  category: "continuity",
  description: "Fix the broken continuity",
  suggestion: "Repair the contradiction",
};

describe("ReviserAgent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prefers book language override when building revision prompts", async () => {
    const root = await mkdtemp(join(tmpdir(), "castor-reviser-lang-test-"));
    const bookDir = join(root, "book");
    await mkdir(join(bookDir, "story"), { recursive: true });
    await mkdir(join(root, "prompt", "longform"), { recursive: true });

    await writeFile(
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
    );
    await writeFile(join(root, "prompt", "longform", "reviser.md"), "PROJECT REVISER OVERRIDE", "utf-8");

    const agent = new ReviserAgent({
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

    const chatSpy = vi.spyOn(ReviserAgent.prototype as never, "chat" as never).mockResolvedValue({
      content: [
        "=== FIXED_ISSUES ===",
        "- repaired",
        "",
        "=== REVISED_CONTENT ===",
        "Revised chapter content.",
        "",
        "=== UPDATED_STATE ===",
        "State card",
        "",
        "=== UPDATED_HOOKS ===",
        "Hooks board",
      ].join("\n"),
      usage: ZERO_USAGE,
    });

    try {
      const output = await agent.reviseChapter(bookDir, "Original chapter content.", 1, [CRITICAL_ISSUE], "rewrite", "xuanhuan");

      const messages = chatSpy.mock.calls[0]?.[0] as
        | ReadonlyArray<{ content: string }>
        | undefined;
      const systemPrompt = messages?.[0]?.content ?? "";

      expect(systemPrompt).toContain("MUST be in English");
      expect(systemPrompt).toContain("PROJECT REVISER OVERRIDE");
      expect(systemPrompt).not.toContain("=== UPDATED_STATE ===");
      expect(systemPrompt).not.toContain("=== UPDATED_HOOKS ===");
      expect("updatedState" in output).toBe(false);
      expect("updatedHooks" in output).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps rewrite mode local-first instead of encouraging full-chapter replacement", async () => {
    const root = await mkdtemp(join(tmpdir(), "castor-reviser-rewrite-guardrail-test-"));
    const bookDir = join(root, "book");
    await mkdir(join(bookDir, "story"), { recursive: true });

    const agent = new ReviserAgent({
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

    const chatSpy = vi.spyOn(ReviserAgent.prototype as never, "chat" as never).mockResolvedValue({
      content: [
        "=== FIXED_ISSUES ===",
        "- repaired",
        "",
        "=== PATCHES ===",
        "--- PATCH 1 ---",
        "TARGET_TEXT:",
        "mock_text。",
        "REPLACEMENT_TEXT:",
        "mock_text。",
        "--- END PATCH ---",
        "",
        "=== UPDATED_STATE ===",
        "mock_text",
        "",
        "=== UPDATED_HOOKS ===",
        "mock_text",
      ].join("\n"),
      usage: ZERO_USAGE,
    });

    try {
      await agent.reviseChapter(bookDir, "mock_text。", 1, [CRITICAL_ISSUE], "rewrite", "xuanhuan");

      const messages = chatSpy.mock.calls[0]?.[0] as
        | ReadonlyArray<{ content: string }>
        | undefined;
      const systemPrompt = messages?.[0]?.content ?? "";

      expect(systemPrompt).toContain("mock_text");
      expect(systemPrompt).toContain("mock_text");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("tells the model to preserve the target range when a length spec is provided", async () => {
    const root = await mkdtemp(join(tmpdir(), "castor-reviser-test-"));
    const bookDir = join(root, "book");
    await mkdir(join(bookDir, "story"), { recursive: true });

    const agent = new ReviserAgent({
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

    const chatSpy = vi.spyOn(ReviserAgent.prototype as never, "chat" as never).mockResolvedValue({
      content: [
        "=== FIXED_ISSUES ===",
        "- repaired",
        "",
        "=== PATCHES ===",
        "--- PATCH 1 ---",
        "TARGET_TEXT:",
        "mock_text。",
        "REPLACEMENT_TEXT:",
        "mock_text。",
        "--- END PATCH ---",
        "",
        "=== UPDATED_STATE ===",
        "mock_text",
        "",
        "=== UPDATED_HOOKS ===",
        "mock_text",
      ].join("\n"),
      usage: ZERO_USAGE,
    });

    try {
      await agent.reviseChapter(
        bookDir,
        "mock_text。",
        1,
        [CRITICAL_ISSUE],
        "spot-fix",
        "xuanhuan",
        {
          lengthSpec: buildLengthSpec(220, "vi"),
        },
      );

      const messages = chatSpy.mock.calls[0]?.[0] as
        | ReadonlyArray<{ content: string }>
        | undefined;
      const systemPrompt = messages?.[0]?.content ?? "";
      const userPrompt = messages?.[1]?.content ?? "";

      expect(systemPrompt).toContain("mock_text từmock_text");
      expect(systemPrompt).toContain("=== PATCHES ===");
      expect(systemPrompt).not.toContain("=== REVISED_CONTENT ===");
      expect(userPrompt).toContain("mock_text từmock_text：220");
      expect(userPrompt).toContain("mock_text：190-250");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reconstructs revised content from spot-fix patches and preserves untouched text", async () => {
    const root = await mkdtemp(join(tmpdir(), "castor-reviser-spotfix-patch-test-"));
    const bookDir = join(root, "book");
    await mkdir(join(bookDir, "story"), { recursive: true });

    const agent = new ReviserAgent({
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

    vi.spyOn(ReviserAgent.prototype as never, "chat" as never).mockResolvedValue({
      content: [
        "=== FIXED_ISSUES ===",
        "- mock_text。",
        "",
        "=== PATCHES ===",
        "--- PATCH 1 ---",
        "TARGET_TEXT:",
        "mock_text。",
        "REPLACEMENT_TEXT:",
        "mock_text，mock_text。",
        "--- END PATCH ---",
        "",
        "=== UPDATED_STATE ===",
        "mock_text",
        "",
        "=== UPDATED_HOOKS ===",
        "mock_text",
      ].join("\n"),
      usage: ZERO_USAGE,
    });

    const original = [
      "mock_text。",
      "mock_text。",
      "",
      "mock_text。",
      "mock_text，mock_text。",
      "mock_text，mock_text。",
    ].join("\n");

    try {
      const result = await agent.reviseChapter(
        bookDir,
        original,
        1,
        [CRITICAL_ISSUE],
        "spot-fix",
        "xuanhuan",
      );

      expect(result.revisedContent).toBe([
        "mock_text。",
        "mock_text，mock_text。",
        "",
        "mock_text。",
        "mock_text，mock_text。",
        "mock_text，mock_text。",
      ].join("\n"));
      expect(result.fixedIssues).toEqual(["- mock_text。"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("ignores REVISED_CONTENT for auto mode when issues are local-only and PATCHES are available", async () => {
    const root = await mkdtemp(join(tmpdir(), "castor-reviser-auto-local-only-test-"));
    const bookDir = join(root, "book");
    await mkdir(join(bookDir, "story"), { recursive: true });

    const agent = new ReviserAgent({
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

    vi.spyOn(ReviserAgent.prototype as never, "chat" as never).mockResolvedValue({
      content: [
        "=== FIXED_ISSUES ===",
        "- removed the AI tell",
        "",
        "=== PATCHES ===",
        "--- PATCH 1 ---",
        "TARGET_TEXT:",
        "mock_text。",
        "REPLACEMENT_TEXT:",
        "mock_text。",
        "--- END PATCH ---",
        "",
        "=== REVISED_CONTENT ===",
        "mock_text，mock_text。",
        "",
        "=== UPDATED_STATE ===",
        "mock_text",
        "",
        "=== UPDATED_HOOKS ===",
        "mock_text",
      ].join("\n"),
      usage: ZERO_USAGE,
    });

    try {
      const result = await agent.reviseChapter(
        bookDir,
        "mock_text。\n\nmock_text。",
        1,
        [{
          severity: "warning",
          category: "mock_text",
          description: "mock_text",
          suggestion: "mock_text",
          repairScope: "local",
        }],
        "auto",
        "xuanhuan",
      );

      expect(result.revisedContent).toContain("mock_text。");
      expect(result.revisedContent).not.toContain("mock_text");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps REVISED_CONTENT available for auto mode when issues are whole-chapter", async () => {
    const root = await mkdtemp(join(tmpdir(), "castor-reviser-auto-whole-chapter-test-"));
    const bookDir = join(root, "book");
    await mkdir(join(bookDir, "story"), { recursive: true });

    const agent = new ReviserAgent({
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

    vi.spyOn(ReviserAgent.prototype as never, "chat" as never).mockResolvedValue({
      content: [
        "=== FIXED_ISSUES ===",
        "- restructured chapter pacing",
        "",
        "=== PATCHES ===",
        "--- PATCH 1 ---",
        "TARGET_TEXT:",
        "Chương mock_text。",
        "REPLACEMENT_TEXT:",
        "Chương mock_text（mock_text）。",
        "--- END PATCH ---",
        "",
        "=== REVISED_CONTENT ===",
        "mock_text，mock_text。",
        "",
        "=== UPDATED_STATE ===",
        "mock_text",
        "",
        "=== UPDATED_HOOKS ===",
        "mock_text",
      ].join("\n"),
      usage: ZERO_USAGE,
    });

    try {
      const result = await agent.reviseChapter(
        bookDir,
        "Chương mock_text。\n\nChương mock_text。\n\nChương mock_text。",
        1,
        [{
          severity: "critical",
          category: "Outline Drift Check",
          description: "mock_text",
          suggestion: "mock_text",
        }],
        "auto",
        "xuanhuan",
      );

      expect(result.revisedContent).toContain("mock_text");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("sanitizes reduced governed control input so raw hook ids and source labels do not enter reviser prompts", async () => {
    const root = await mkdtemp(join(tmpdir(), "castor-reviser-governed-sanitize-test-"));
    const bookDir = join(root, "book");
    await mkdir(join(bookDir, "story"), { recursive: true });

    const agent = new ReviserAgent({
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

    const chatSpy = vi.spyOn(ReviserAgent.prototype as never, "chat" as never).mockResolvedValue({
      content: [
        "=== FIXED_ISSUES ===",
        "- fixed",
        "",
        "=== PATCHES ===",
        "--- PATCH 1 ---",
        "TARGET_TEXT:",
        "mock_text。",
        "REPLACEMENT_TEXT:",
        "mock_text。",
        "--- END PATCH ---",
        "",
        "=== UPDATED_STATE ===",
        "mock_text",
        "",
        "=== UPDATED_HOOKS ===",
        "mock_text",
      ].join("\n"),
      usage: ZERO_USAGE,
    });

    try {
      await agent.reviseChapter(
        bookDir,
        "mock_text。",
        1,
        [CRITICAL_ISSUE],
        "auto",
        "xuanhuan",
        {
          chapterIntent: [
            "# Chapter Intent",
            "",
            "## Goal",
            "Bring the focus back to the mentor oath conflict.",
            "",
            "## Must Avoid",
            "- mock_text",
            "- mock_text H001/H002 mock_text",
            "",
            "## Hook Agenda",
            "### Resolve",
            "- H001",
            "",
            "### Advance",
            "- H002",
          ].join("\n"),
          contextPackage: {
            chapter: 1,
            selectedContext: [
              {
                source: "runtime/hook_debt#H001",
                reason: "Narrative debt brief with original seed text for this hook agenda target.",
                excerpt: "H001 | original seed (ch1): the oath debt first surfaced",
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

      const userPrompt = (chatSpy.mock.calls[0]?.[0] as ReadonlyArray<{ content: string }> | undefined)?.[1]?.content ?? "";
      expect(userPrompt).not.toContain("runtime/hook_debt#H001");
      expect(userPrompt).not.toContain("## Hook Agenda");
      expect(userPrompt).not.toContain("H001");
      expect(userPrompt).not.toContain("H002");
      expect(userPrompt).not.toContain("mock_text");
      expect(userPrompt).not.toContain("mock_text");
      expect(userPrompt).toContain("Bring the focus back to the mentor oath conflict.");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses selected summary and hook evidence instead of full long-history markdown in governed mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "castor-reviser-governed-test-"));
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
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 100\nTrack the merchant guild trail.\n", "utf-8"),
      writeFile(
        join(storyDir, "story_bible.md"),
        [
          "# Story Bible",
          "",
          "- The jade seal cannot be destroyed.",
          "- Guildmaster Ren secretly forged the harbor roster in chapter 140.",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "character_matrix.md"),
        [
          "# mock_text",
          "",
          "### mock_text",
          "| mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| Lin Yue | oath | restraint | clipped | stubborn | self | repay debt | find mentor |",
          "| Guildmaster Ren | guild | swagger | loud | opportunistic | rival | stall Mara | seize seal |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(join(storyDir, "style_guide.md"), "# Style Guide\n\n- Keep the prose restrained.\n", "utf-8"),
    ]);

    const agent = new ReviserAgent({
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

    const chatSpy = vi.spyOn(ReviserAgent.prototype as never, "chat" as never).mockResolvedValue({
      content: [
        "=== FIXED_ISSUES ===",
        "- repaired",
        "",
        "=== PATCHES ===",
        "--- PATCH 1 ---",
        "TARGET_TEXT:",
        "mock_text。",
        "REPLACEMENT_TEXT:",
        "mock_text。",
        "--- END PATCH ---",
        "",
        "=== UPDATED_STATE ===",
        "mock_text",
        "",
        "=== UPDATED_HOOKS ===",
        "mock_text",
      ].join("\n"),
      usage: ZERO_USAGE,
    });

    try {
      await agent.reviseChapter(
        bookDir,
        "mock_text。",
        100,
        [CRITICAL_ISSUE],
        "spot-fix",
        "xuanhuan",
        {
          chapterIntent: "# Chapter Intent\n\n## Goal\nBring the focus back to the mentor oath conflict.\n",
          contextPackage: {
            chapter: 100,
            selectedContext: [
              {
                source: "story/story_bible.md",
                reason: "Preserve canon constraints referenced by mustKeep.",
                excerpt: "The jade seal cannot be destroyed.",
              },
              {
                source: "story/volume_outline.md",
                reason: "Anchor the default planning node for this chapter.",
                excerpt: "Track the mentor oath fallout.",
              },
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
          lengthSpec: buildLengthSpec(220, "vi"),
        },
      );

      const messages = chatSpy.mock.calls[0]?.[0] as
        | ReadonlyArray<{ content: string }>
        | undefined;
      const userPrompt = messages?.[1]?.content ?? "";

      expect(userPrompt).not.toContain("story/chapter_summaries.md#99");
      expect(userPrompt).not.toContain("story/pending_hooks.md#mentor-oath");
      expect(userPrompt).not.toContain("story/story_bible.md");
      expect(userPrompt).not.toContain("story/volume_outline.md");
      expect(userPrompt).toContain("The jade seal cannot be destroyed.");
      expect(userPrompt).toContain("Track the mentor oath fallout.");
      expect(userPrompt).not.toContain("| 1 | Guild Trail |");
      expect(userPrompt).not.toContain("guild-route | 1 | mystery");
      expect(userPrompt).not.toContain("Guildmaster Ren secretly forged the harbor roster in chapter 140.");
      expect(userPrompt).not.toContain("| Guildmaster Ren | guild | swagger | loud | opportunistic | rival | stall Mara | seize seal |");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("routes structural issues to REVISED_CONTENT (rewrite-only) and rejects stray PATCHES", async () => {
    const root = await mkdtemp(join(tmpdir(), "castor-reviser-route-structural-"));
    const bookDir = join(root, "book");
    await mkdir(join(bookDir, "story"), { recursive: true });

    const agent = new ReviserAgent({
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

    // Model returns PATCHES when reviewer asked for REVISED_CONTENT — parser
    // must reject the patches and leave the chapter unchanged.
    const chatSpy = vi.spyOn(ReviserAgent.prototype as never, "chat" as never).mockResolvedValue({
      content: [
        "=== FIXED_ISSUES ===",
        "- tried to patch but problem is structural",
        "",
        "=== PATCHES ===",
        "--- PATCH 1 ---",
        "TARGET_TEXT:",
        "mock_text。",
        "REPLACEMENT_TEXT:",
        "mock_text。",
        "--- END PATCH ---",
        "",
        "=== UPDATED_STATE ===",
        "mock_text",
        "",
        "=== UPDATED_HOOKS ===",
        "mock_text",
      ].join("\n"),
      usage: ZERO_USAGE,
    });

    try {
      const out = await agent.reviseChapter(
        bookDir,
        "mock_text。",
        1,
        [
	          {
	            severity: "critical",
	            category: "mock_text",
	            description: "mock_text memo mock_text goal",
	            suggestion: "mock_text",
	            repairScope: "structural",
	          },
        ],
        "auto",
        "xuanhuan",
      );

      const messages = chatSpy.mock.calls[0]?.[0] as
        | ReadonlyArray<{ content: string }>
        | undefined;
      const systemPrompt = messages?.[0]?.content ?? "";

      // System prompt directs model to REVISED_CONTENT for structural issues.
      expect(systemPrompt).toContain("mock_text");
      expect(systemPrompt).toContain("mock_text REVISED_CONTENT");
      // Parser rejects stray PATCHES in rewrite-only mode.
      expect(out.revisedContent).toBe("mock_text。");
      expect(out.fixedIssues).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("routes local issues to PATCHES (patch-only) and rejects stray REVISED_CONTENT", async () => {
    const root = await mkdtemp(join(tmpdir(), "castor-reviser-route-local-"));
    const bookDir = join(root, "book");
    await mkdir(join(bookDir, "story"), { recursive: true });

    const agent = new ReviserAgent({
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

    // Model returns REVISED_CONTENT when reviewer asked for PATCHES — parser
    // must reject the rewrite (patch-only mode) and leave the chapter unchanged.
    const chatSpy = vi.spyOn(ReviserAgent.prototype as never, "chat" as never).mockResolvedValue({
      content: [
        "=== FIXED_ISSUES ===",
        "- rewrote whole chapter",
        "",
        "=== REVISED_CONTENT ===",
        "mock_text。",
        "",
        "=== UPDATED_STATE ===",
        "mock_text",
        "",
        "=== UPDATED_HOOKS ===",
        "mock_text",
      ].join("\n"),
      usage: ZERO_USAGE,
    });

    try {
      const out = await agent.reviseChapter(
        bookDir,
        "mock_text。",
        1,
        [
	          {
	            severity: "warning",
	            category: "mock_text",
	            description: "'mock_text' mock_text",
	            suggestion: "mock_text",
	            repairScope: "local",
	          },
        ],
        "auto",
        "xuanhuan",
      );

      const messages = chatSpy.mock.calls[0]?.[0] as
        | ReadonlyArray<{ content: string }>
        | undefined;
      const systemPrompt = messages?.[0]?.content ?? "";

      expect(systemPrompt).toContain("mock_text");
      expect(systemPrompt).toContain("mock_text PATCHES");
      // Parser rejects REVISED_CONTENT in patch-only mode.
      expect(out.revisedContent).toBe("mock_text。");
      expect(out.fixedIssues).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
