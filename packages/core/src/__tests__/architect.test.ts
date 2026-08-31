import { afterEach, describe, expect, it, vi } from "vitest";
import { ArchitectAgent } from "../agents/architect.js";
import type { BookConfig } from "../models/book.js";
import type { LLMClient } from "../llm/provider.js";

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

describe("ArchitectAgent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses English prompts when generating foundation from imported English chapters", async () => {
    const agent = new ArchitectAgent({
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
      projectRoot: process.cwd(),
    });

    const book: BookConfig = {
      id: "english-book",
      title: "English Book",
      platform: "other",
      genre: "other",
      status: "active",
      targetChapters: 20,
      chapterWordCount: 2200,
      language: "en",
      createdAt: "2026-03-24T00:00:00.000Z",
      updatedAt: "2026-03-24T00:00:00.000Z",
    };

    const chat = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== SECTION: story_bible ===",
          "# Story Bible",
          "",
          "=== SECTION: volume_outline ===",
          "# Volume Outline",
          "",
          "=== SECTION: book_rules ===",
          "---",
          "version: \"1.0\"",
          "---",
          "",
          "# Book Rules",
          "",
          "=== SECTION: current_state ===",
          "# Current State",
          "",
          "=== SECTION: pending_hooks ===",
          "# Pending Hooks",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    await agent.generateFoundationFromImport(
      book,
      "Chapter 1: Prelude\n\nA cold wind crossed the harbor.",
    );

    const messages = chat.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    expect(messages[0]?.content).toContain("MUST be written in English");
    expect(messages[1]?.content).toContain("Generate the complete foundation");
    expect(messages[1]?.content).not.toContain("mock_text");
  });

  it("does not embed Chinese section headings in imported English foundation prompts", async () => {
    const agent = new ArchitectAgent({
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
      projectRoot: process.cwd(),
    });

    const book: BookConfig = {
      id: "english-book",
      title: "English Book",
      platform: "other",
      genre: "other",
      status: "active",
      targetChapters: 20,
      chapterWordCount: 2200,
      language: "en",
      createdAt: "2026-03-24T00:00:00.000Z",
      updatedAt: "2026-03-24T00:00:00.000Z",
    };

    const chat = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== SECTION: story_bible ===",
          "# Story Bible",
          "",
          "=== SECTION: volume_outline ===",
          "# Volume Outline",
          "",
          "=== SECTION: book_rules ===",
          "---",
          "version: \"1.0\"",
          "---",
          "",
          "# Book Rules",
          "",
          "=== SECTION: current_state ===",
          "# Current State",
          "",
          "=== SECTION: pending_hooks ===",
          "# Pending Hooks",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    await agent.generateFoundationFromImport(
      book,
      "Chapter 1: Prelude\n\nA cold wind crossed the harbor.",
    );

    const messages = chat.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    // Phase 5: architect prompts describe the new prose sections. The English
    // import prompt must not slip Chinese section headers into the system text.
    expect(messages[0]?.content).toContain("story_frame");
    expect(messages[0]?.content).toContain("volume_map");
    expect(messages[0]?.content).not.toContain("## 01_mock_text");
    expect(messages[0]?.content).not.toContain("## mock_text");
  });

  it("embeds reviewer feedback into original foundation regeneration prompts", async () => {
    const agent = new ArchitectAgent({
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
      projectRoot: process.cwd(),
    });

    const book: BookConfig = {
      id: "review-feedback-book",
      title: "mock_text",
      platform: "tomato",
      genre: "urban",
      status: "active",
      targetChapters: 60,
      chapterWordCount: 2200,
      language: "vi",
      createdAt: "2026-04-03T00:00:00.000Z",
      updatedAt: "2026-04-03T00:00:00.000Z",
    };

    const chat = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== SECTION: story_bible ===",
          "# mock_text",
          "",
          "=== SECTION: volume_outline ===",
          "# mock_text",
          "",
          "=== SECTION: book_rules ===",
          "---",
          "version: \"1.0\"",
          "---",
          "",
          "=== SECTION: current_state ===",
          "# mock_text",
          "",
          "=== SECTION: pending_hooks ===",
          "# mock_text",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    await agent.generateFoundation(
      book,
      undefined,
      "mock_text，mock_text。",
    );

    const messages = chat.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    expect(messages[0]?.content).toContain("mock_text");
    expect(messages[0]?.content).toContain("mock_text");
    expect(messages[0]?.content).toContain("mock_text");
  });

  it("embeds reviewer feedback into fanfic foundation regeneration prompts", async () => {
    const agent = new ArchitectAgent({
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
      projectRoot: process.cwd(),
    });

    const book: BookConfig = {
      id: "fanfic-review-feedback-book",
      title: "mock_text：mock_text",
      platform: "tomato",
      genre: "other",
      status: "active",
      targetChapters: 60,
      chapterWordCount: 2200,
      language: "vi",
      createdAt: "2026-04-03T00:00:00.000Z",
      updatedAt: "2026-04-03T00:00:00.000Z",
    };

    const chat = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== SECTION: story_bible ===",
          "# mock_text",
          "",
          "=== SECTION: volume_outline ===",
          "# mock_text",
          "",
          "=== SECTION: book_rules ===",
          "---",
          "version: \"1.0\"",
          "---",
          "",
          "=== SECTION: current_state ===",
          "# mock_text",
          "",
          "=== SECTION: pending_hooks ===",
          "# mock_text",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    await agent.generateFanficFoundation(
      book,
      "# mock_text\n- mock_text。",
      "canon",
      "mock_text，mock_text。",
    );

    const messages = chat.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    expect(messages[0]?.content).toContain("mock_text");
    expect(messages[0]?.content).toContain("mock_text");
    expect(messages[0]?.content).toContain("mock_text");
  });

  it("strips assistant-style trailing coda from the final pending hooks section", async () => {
    const agent = new ArchitectAgent({
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
      projectRoot: process.cwd(),
    });

    const book: BookConfig = {
      id: "zh-book",
      title: "mock_text",
      platform: "other",
      genre: "other",
      status: "active",
      targetChapters: 50,
      chapterWordCount: 2200,
      language: "vi",
      createdAt: "2026-03-24T00:00:00.000Z",
      updatedAt: "2026-03-24T00:00:00.000Z",
    };

    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== SECTION: story_bible ===",
          "# mock_text",
          "",
          "=== SECTION: volume_outline ===",
          "# mock_text",
          "",
          "=== SECTION: book_rules ===",
          "---",
          "version: \"1.0\"",
          "---",
          "",
          "=== SECTION: current_state ===",
          "# mock_text",
          "",
          "=== SECTION: pending_hooks ===",
          "| hook_id | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| H01 | 1 | mock_text | mock_text | mock_text | 10mock_text | mock_text |",
          "",
          "mock_text，mock_text《mock_text》mock_text：",
          "1. mock_text10mock_text",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    const result = await agent.generateFoundation(book);

    // Phase 7 + hotfixes 1/2: ledger renders extended columns — depends_on,
    // pays_off_in_arc, core_hook, half_life (empty when not specified), and
    // promoted (computed at architect time). This hook has no promotion rule
    // firing (core=mock_text, no depends_on, in-volume payoff) so mock_text=mock_text.
    expect(result.pendingHooks).toContain("| H01 | 1 | mock_text | mock_text | 0 | 10mock_text | mock_text | mock_text |  | mock_text |  | mock_text | mock_text |");
    expect(result.pendingHooks).not.toContain("mock_text");
    expect(result.pendingHooks).not.toContain("mock_text10mock_text");
  });

  it("normalizes architect pending hooks into runtime-compatible numeric progress columns", async () => {
    const agent = new ArchitectAgent({
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
      projectRoot: process.cwd(),
    });

    const book: BookConfig = {
      id: "zh-book",
      title: "mock_text",
      platform: "tomato",
      genre: "urban",
      status: "active",
      targetChapters: 80,
      chapterWordCount: 2000,
      language: "vi",
      createdAt: "2026-03-25T00:00:00.000Z",
      updatedAt: "2026-03-25T00:00:00.000Z",
    };

    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== SECTION: story_bible ===",
          "# mock_text",
          "",
          "=== SECTION: volume_outline ===",
          "# mock_text",
          "",
          "=== SECTION: book_rules ===",
          "---",
          "version: \"1.0\"",
          "---",
          "",
          "=== SECTION: current_state ===",
          "# mock_text",
          "",
          "=== SECTION: pending_hooks ===",
          "| hook_id | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| H13 | 22 | mock_text | mock_text | mock_text | 51-60mock_text | mock_text |",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    const result = await agent.generateFoundation(book);

    expect(result.pendingHooks).toContain("| H13 | 22 | mock_text | mock_text | 0 | 51-60mock_text | mock_text | mock_text |  | mock_text |  | mock_text | mock_text（mock_text：mock_text） |");
  });

  it("keeps chapter-zero seed hooks dormant even when the model labels them open", async () => {
    const agent = new ArchitectAgent({
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
      projectRoot: process.cwd(),
    });

    const book: BookConfig = {
      id: "seed-book",
      title: "mock_text",
      platform: "tomato",
      genre: "urban",
      status: "active",
      targetChapters: 80,
      chapterWordCount: 2000,
      language: "vi",
      createdAt: "2026-03-25T00:00:00.000Z",
      updatedAt: "2026-03-25T00:00:00.000Z",
    };

    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== SECTION: story_frame ===",
          "# mock_text",
          "mock_text。",
          "",
          "=== SECTION: volume_map ===",
          "# mock_text",
          "Chương mock_text。",
          "",
          "=== SECTION: roles ===",
          "---ROLE---",
          "tier: major",
          "name: mock_text",
          "---CONTENT---",
          "## mock_text",
          "mock_text。",
          "",
          "=== SECTION: book_rules ===",
          "## mock_text",
          "- mock_text từ：mock_text",
          "",
          "=== SECTION: pending_hooks ===",
          "| hook_id | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text |",
          "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
          "| H00 | 0 | mock_text | open | 0 | mock_text | mock_text | mock_text | mock_text | false |  | mock_text từ |",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    const result = await agent.generateFoundation(book);

    expect(result.pendingHooks).toContain("| H00 | 0 | mock_text | tạm hoãn | 0 | mock_text | mock_text | mock_text | mock_text | mock_text |  | mock_text | mock_text từ |");
  });

  it("accepts section labels with spacing and punctuation drift from non-strict models", async () => {
    const agent = new ArchitectAgent({
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
      projectRoot: process.cwd(),
    });

    const book: BookConfig = {
      id: "format-drift-book",
      title: "mock_textTest",
      platform: "other",
      genre: "other",
      status: "active",
      targetChapters: 20,
      chapterWordCount: 2200,
      language: "vi",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    };

    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== Section：Story Bible ===",
          "# mock_text",
          "",
          "=== section: Volume Outline ===",
          "# mock_text",
          "",
          "=== SECTION: book-rules ===",
          "---",
          "version: \"1.0\"",
          "---",
          "",
          "=== SECTION : current state ===",
          "# mock_text",
          "",
          "=== SECTION: pending hooks ===",
          "| hook_id | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| H01 | 1 | mystery | open | 0 | 10mock_text | mock_text |",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    const result = await agent.generateFoundation(book);

    expect(result.storyBible).toBe("# mock_text");
    expect(result.volumeOutline).toBe("# mock_text");
    expect(result.bookRules).toContain("version: \"1.0\"");
    expect(result.currentState).toBe("# mock_text");
    expect(result.pendingHooks).toContain("| H01 | 1 | mystery | tạm hoãn | 0 | 10mock_text | mock_text | mock_text |  | mock_text |  | mock_text | mock_text |");
  });

  it("throws when a required foundation section is missing", async () => {
    const agent = new ArchitectAgent({
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
      projectRoot: process.cwd(),
    });

    const book: BookConfig = {
      id: "broken-book",
      title: "Broken Book",
      platform: "other",
      genre: "other",
      status: "active",
      targetChapters: 20,
      chapterWordCount: 2200,
      language: "vi",
      createdAt: "2026-03-29T00:00:00.000Z",
      updatedAt: "2026-03-29T00:00:00.000Z",
    };

    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== SECTION: story_bible ===",
          "# mock_text",
          "",
          "=== SECTION: volume_outline ===",
          "# mock_text",
          "",
          "=== SECTION: current_state ===",
          "# mock_text",
          "",
          "=== SECTION: pending_hooks ===",
          "# mock_text",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    await expect(agent.generateFoundation(book)).rejects.toThrow(/book_rules/i);
  });

  it("uses modelCard output budget when generating foundation", async () => {
    const agent = new ArchitectAgent({
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
      projectRoot: process.cwd(),
    });

    const book: BookConfig = {
      id: "max-tokens-book",
      title: "Max Tokens Book",
      platform: "other",
      genre: "other",
      status: "active",
      targetChapters: 20,
      chapterWordCount: 2200,
      language: "vi",
      createdAt: "2026-03-29T00:00:00.000Z",
      updatedAt: "2026-03-29T00:00:00.000Z",
    };

    const chatSpy = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== SECTION: story_bible ===",
          "# mock_text",
          "",
          "=== SECTION: volume_outline ===",
          "# mock_text",
          "",
          "=== SECTION: book_rules ===",
          "---",
          "version: \"1.0\"",
          "---",
          "",
          "=== SECTION: current_state ===",
          "# mock_text",
          "",
          "=== SECTION: pending_hooks ===",
          "| hook_id | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| H01 | 1 | mystery | open | 0 | 10mock_text | mock_text |",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    await agent.generateFoundation(book);

    const options = chatSpy.mock.calls[0]?.[1] as { temperature?: number; maxTokens?: number } | undefined;
    expect(options).toEqual(expect.objectContaining({ temperature: 0.8 }));
    expect(options).not.toHaveProperty("maxTokens");
  });

  it("uses modelCard output budget when generating foundation from import", async () => {
    const agent = new ArchitectAgent({
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
      projectRoot: process.cwd(),
    });

    const book: BookConfig = {
      id: "import-max-tokens-book",
      title: "Import Max Tokens Book",
      platform: "other",
      genre: "other",
      status: "active",
      targetChapters: 20,
      chapterWordCount: 2200,
      language: "vi",
      createdAt: "2026-03-29T00:00:00.000Z",
      updatedAt: "2026-03-29T00:00:00.000Z",
    };

    const chatSpy = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== SECTION: story_bible ===",
          "# mock_text",
          "",
          "=== SECTION: volume_outline ===",
          "# mock_text",
          "",
          "=== SECTION: book_rules ===",
          "---",
          "version: \"1.0\"",
          "---",
          "",
          "=== SECTION: current_state ===",
          "# mock_text",
          "",
          "=== SECTION: pending_hooks ===",
          "| hook_id | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| H01 | 1 | mystery | open | 0 | 10mock_text | mock_text |",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    await agent.generateFoundationFromImport(book, "Chương mock_text");

    const options = chatSpy.mock.calls[0]?.[1] as { temperature?: number; maxTokens?: number } | undefined;
    expect(options).toEqual(expect.objectContaining({ temperature: 0.5 }));
    expect(options).not.toHaveProperty("maxTokens");
  });

  it("uses modelCard output budget when generating fanfic foundation", async () => {
    const agent = new ArchitectAgent({
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
      projectRoot: process.cwd(),
    });

    const book: BookConfig = {
      id: "fanfic-max-tokens-book",
      title: "Fanfic Max Tokens Book",
      platform: "other",
      genre: "fanfic",
      status: "active",
      targetChapters: 20,
      chapterWordCount: 2200,
      language: "vi",
      createdAt: "2026-03-29T00:00:00.000Z",
      updatedAt: "2026-03-29T00:00:00.000Z",
    };

    const chatSpy = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== SECTION: story_bible ===",
          "# mock_text",
          "",
          "=== SECTION: volume_outline ===",
          "# mock_text",
          "",
          "=== SECTION: book_rules ===",
          "---",
          "version: \"1.0\"",
          "---",
          "",
          "=== SECTION: current_state ===",
          "# mock_text",
          "",
          "=== SECTION: pending_hooks ===",
          "| hook_id | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| H01 | 1 | mystery | open | 0 | 10mock_text | mock_text |",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    await agent.generateFanficFoundation(book, "mock_text", "canon");

    const options = chatSpy.mock.calls[0]?.[1] as { temperature?: number; maxTokens?: number } | undefined;
    expect(options).toEqual(expect.objectContaining({ temperature: 0.7 }));
    expect(options).not.toHaveProperty("maxTokens");
  });

  // ---- Phase 5 mock_text ----

  // Test stub：chat mock_text vi.spyOn mock_text，client.defaults mock_text。
  // mock_text temperature / maxTokens mock_text từ——mock_textTestmock_text"mock_text"mock_text
  // mock_text（maxTokens mock_text，mock_text CLAUDE.md mock_text
  // maxTokens mock_text）。mock_text từmock_text。
  const buildPhase5Agent = (): ArchitectAgent =>
    new ArchitectAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
      } as unknown as LLMClient,
      model: "test-model",
      projectRoot: process.cwd(),
    });

  const phase5Book = (): BookConfig => ({
    id: "phase5-book",
    title: "Testmock_text",
    platform: "qidian",
    genre: "xuanhuan",
    status: "active",
    targetChapters: 50,
    chapterWordCount: 3000,
    language: "vi",
    createdAt: "2026-04-19T00:00:00.000Z",
    updatedAt: "2026-04-19T00:00:00.000Z",
  });

  it("generateFoundation parses story_frame / volume_map / roles sections", async () => {
    const agent = buildPhase5Agent();
    const book = phase5Book();

    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== SECTION: story_frame ===",
          "## mock_text",
          "mock_text 1 mock_text。",
          "",
          "## mock_text",
          "mock_text 2 mock_text。",
          "",
          "=== SECTION: volume_map ===",
          "## mock_text 1",
          "mock_text。",
          "",
          "=== SECTION: roles ===",
          "---ROLE---",
          "tier: major",
          "name: mock_text",
          "---CONTENT---",
          "## mock_text",
          "mock_text、mock_text",
          "",
          "---ROLE---",
          "tier: minor",
          "name: mock_textA",
          "---CONTENT---",
          "minormock_text",
          "",
          "=== SECTION: book_rules ===",
          "---",
          "version: \"1.0\"",
          "protagonist:",
          "  name: mock_text",
          "---",
          "",
          "=== SECTION: pending_hooks ===",
          "| hook_id | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text |",
          "|---|---|---|---|---|---|---|---|",
          "| H001 | 1 | mock_text | open | 0 | 3 | mock_text | mock_text |",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    const output = await agent.generateFoundation(book);

    expect(output.storyFrame).toContain("mock_text");
    expect(output.volumeMap).toContain("mock_text 1");
    expect(output.roles).toBeDefined();
    expect(output.roles!.length).toBe(2);
    expect(output.roles![0]).toMatchObject({ tier: "major", name: "mock_text" });
    expect(output.roles![1]).toMatchObject({ tier: "minor", name: "mock_textA" });
  });

  it("writeFoundationFiles writes outline/ and roles/ when Phase 5 fields present", async () => {
    const { mkdtemp, rm, access } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const agent = buildPhase5Agent();
    const tmpDir = await mkdtemp(join(tmpdir(), "castor-arch-test-"));
    try {
      await agent.writeFoundationFiles(tmpDir, {
        storyBible: "legacy shim body",
        volumeOutline: "legacy outline",
        bookRules: "---\nversion: \"1.0\"\n---\n",
        currentState: "",
        pendingHooks: "| hook_id |",
        storyFrame: "## mock_text\n\nmock_text",
        volumeMap: "## mock_text\n\nmock_text",
        roles: [
          { tier: "major", name: "mock_text", content: "mock_text" },
          { tier: "minor", name: "mock_textA", content: "mock_text" },
        ],
      }, false, "vi");

      await expect(access(join(tmpDir, "story", "outline", "story_frame.md"))).resolves.not.toThrow();
      await expect(access(join(tmpDir, "story", "outline", "volume_map.md"))).resolves.not.toThrow();
      await expect(access(join(tmpDir, "story", "roles", "major", "mock_text.md"))).resolves.not.toThrow();
      await expect(access(join(tmpDir, "story", "roles", "minor", "mock_textA.md"))).resolves.not.toThrow();
      // Shim mock_text（mock_text）
      await expect(access(join(tmpDir, "story", "story_bible.md"))).resolves.not.toThrow();
      await expect(access(join(tmpDir, "story", "character_matrix.md"))).resolves.not.toThrow();
      await expect(access(join(tmpDir, "story", "book_rules.md"))).resolves.not.toThrow();
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("writeFoundationFiles falls back to legacy layout when storyFrame is empty", async () => {
    const { mkdtemp, rm, access, readFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const agent = buildPhase5Agent();
    const tmpDir = await mkdtemp(join(tmpdir(), "castor-arch-legacy-test-"));
    try {
      await agent.writeFoundationFiles(tmpDir, {
        storyBible: "# Legacy Story Bible\n",
        volumeOutline: "# Legacy Volume Outline\n",
        bookRules: "# Legacy Book Rules\n",
        currentState: "# Current State\n",
        pendingHooks: "| hook_id |\n",
      }, false, "vi");

      const storyBible = await readFile(join(tmpDir, "story", "story_bible.md"), "utf-8");
      expect(storyBible).toContain("Legacy Story Bible");
      // outline/ mock_text story_frame.md
      await expect(access(join(tmpDir, "story", "outline", "story_frame.md"))).rejects.toThrow();
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
