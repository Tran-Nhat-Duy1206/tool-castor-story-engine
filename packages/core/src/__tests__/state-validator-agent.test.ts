import { afterEach, describe, expect, it, vi } from "vitest";
import { StateValidatorAgent } from "../agents/state-validator.js";

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

describe("StateValidatorAgent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts a valid JSON object even when the model appends markdown with extra braces", async () => {
    const agent = new StateValidatorAgent({
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

    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "{\"warnings\":[],\"passed\":true}",
          "",
          "## Notes",
          "Trailing markdown can still mention braces like } without changing the verdict.",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    await expect(agent.validate(
      "Chapter body.",
      3,
      "old state",
      "new state",
      "old hooks",
      "new hooks",
      "en",
    )).resolves.toEqual({
      warnings: [],
      passed: true,
      repairRequired: false,
    });
  });

  it("returns a structured repair verdict without classifying warning text in code", async () => {
    const agent = new StateValidatorAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: { temperature: 0.7, maxTokens: 4096, thinkingBudget: 0, extra: {} },
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });
    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: "REPAIR\n[missing_state_update] mock_text，mock_text",
        usage: ZERO_USAGE,
      });

    await expect(agent.validate(
      "mock_text。",
      3,
      "mock_text：mock_text",
      "mock_text：mock_text",
      "H1 mock_text",
      "H1 mock_text",
    )).resolves.toEqual({
      passed: false,
      repairRequired: true,
      warnings: [{
        category: "missing_state_update",
        description: "mock_text，mock_text",
      }],
    });
  });

  it("passes maxTokens large enough for thinking models to chat()", async () => {
    const agent = new StateValidatorAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 8192,
          thinkingBudget: 0,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const chatSpy = vi.spyOn(
      agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> },
      "chat",
    ).mockResolvedValue({ content: "PASS", usage: ZERO_USAGE });

    await agent.validate("Body.", 1, "old", "new state", "old hooks", "new hooks", "vi");

    const options = chatSpy.mock.calls[0]?.[1] as { maxTokens?: number } | undefined;
    // Must not hardcode a small value like 2048 that starves thinking models
    expect(options?.maxTokens).toBeUndefined();
  });

  it("passes authority truth context into the cross-file validation prompt", async () => {
    const agent = new StateValidatorAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 8192,
          thinkingBudget: 0,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const chatSpy = vi.spyOn(
      agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> },
      "chat",
    ).mockResolvedValue({ content: "PASS", usage: ZERO_USAGE });

    await agent.validate(
      "mock_text：Chương mock_text。",
      2,
      "old state",
      "new state: Chương mock_text",
      "old hooks",
      "new hooks",
      "vi",
      {
        storyFrame: "mock_text：mock_text：mock_text。",
        bookRules: "mock_text：mock_text。",
        chapterSummaries: "Chương 1：mock_textChương mock_text。",
      },
    );

    const messages = chatSpy.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    expect(messages[0]?.content).toContain("truth files");
    expect(messages[0]?.content).toContain("numbered");
    expect(messages[1]?.content).toContain("## Authority / Cross-Truth Context");
    expect(messages[1]?.content).toContain("mock_text：mock_text");
    expect(messages[1]?.content).toContain("Chương 1：mock_textChương mock_text");
  });

  it("does not silently truncate chapter or authority context before validation", async () => {
    const agent = new StateValidatorAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 8192,
          thinkingBudget: 0,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const chatSpy = vi.spyOn(
      agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> },
      "chat",
    ).mockResolvedValue({ content: "PASS", usage: ZERO_USAGE });

    await agent.validate(
      `${"mock_text".repeat(7000)}\nCHAPTER_TAIL_MARKER`,
      8,
      "old state",
      "new state",
      "old hooks",
      "new hooks",
      "vi",
      {
        storyFrame: `${"mock_text".repeat(4000)}\nSTORY_FRAME_TAIL_MARKER`,
        bookRules: `${"mock_text".repeat(3000)}\nBOOK_RULES_TAIL_MARKER`,
        chapterSummaries: `${"mock_text".repeat(4000)}\nCHAPTER_SUMMARIES_TAIL_MARKER`,
      },
    );

    const messages = chatSpy.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    expect(messages[1]?.content).toContain("CHAPTER_TAIL_MARKER");
    expect(messages[1]?.content).toContain("STORY_FRAME_TAIL_MARKER");
    expect(messages[1]?.content).toContain("BOOK_RULES_TAIL_MARKER");
    expect(messages[1]?.content).toContain("CHAPTER_SUMMARIES_TAIL_MARKER");
    expect(messages[1]?.content).not.toContain("[...truncated...]");
  });

  it("throws when the validator model returns an empty response", async () => {
    const agent = new StateValidatorAgent({
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

    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: "",
        usage: ZERO_USAGE,
      });

    // Empty response throws (fail-closed)
    await expect(agent.validate(
      "Chapter body.",
      3,
      "old state",
      "new state",
      "old hooks",
      "new hooks",
      "en",
    )).rejects.toThrow("empty response");
  });
});
