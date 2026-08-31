import { afterEach, describe, expect, it, vi } from "vitest";
import { PolisherAgent } from "../agents/polisher.js";

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

function makeAgent(): PolisherAgent {
  return new PolisherAgent({
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
    projectRoot: "/tmp/irrelevant",
  });
}

describe("PolisherAgent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("encodes file-layer scope boundary and six prose checks in the vi system prompt (English canonical)", async () => {
    const agent = makeAgent();
    const chatSpy = vi.spyOn(PolisherAgent.prototype as never, "chat" as never).mockResolvedValue({
      content: "Nội dung đã được trau chuốt.",
      usage: ZERO_USAGE,
    });

    await agent.polishChapter({
      chapterContent: "Nội dung gốc.",
      chapterNumber: 7,
      language: "vi",
    });

    const messages = chatSpy.mock.calls[0]?.[0] as
      | ReadonlyArray<{ content: string }>
      | undefined;
    const systemPrompt = messages?.[0]?.content ?? "";

    // Hard scope boundary - now English canonical for vi as well.
    expect(systemPrompt).toContain("Polisher Scope");
    expect(systemPrompt).toContain("FORBIDDEN from adding or removing plot beats");
    expect(systemPrompt).toContain("Structure is the Reviewer's job");
    // File-layer checks subset.
    expect(systemPrompt).toContain("Ineffective description");
    expect(systemPrompt).toContain("Over-purple prose");
    expect(systemPrompt).toContain("Bad formatting");
    // Hard text-layer rules.
    expect(systemPrompt).toContain("3-5 lines");
    expect(systemPrompt).toContain("Five senses");
    expect(systemPrompt).toContain("Dialogue naturalness");
  });

  it("routes plot/structure findings to [polisher-note] lines instead of rewriting", async () => {
    const agent = makeAgent();
    const chatSpy = vi.spyOn(PolisherAgent.prototype as never, "chat" as never).mockResolvedValue({
      content: "Nội dung đã được trau chuốt.",
      usage: ZERO_USAGE,
    });

    await agent.polishChapter({
      chapterContent: "Nội dung gốc.",
      chapterNumber: 7,
      language: "vi",
    });

    const messages = chatSpy.mock.calls[0]?.[0] as
      | ReadonlyArray<{ content: string }>
      | undefined;
    const systemPrompt = messages?.[0]?.content ?? "";

    expect(systemPrompt).toContain("[polisher-note]");
  });

  it("injects the chapter memo so polish stays anchored to the memo goal", async () => {
    const agent = makeAgent();
    const chatSpy = vi.spyOn(PolisherAgent.prototype as never, "chat" as never).mockResolvedValue({
      content: "Nội dung đã được trau chuốt.",
      usage: ZERO_USAGE,
    });

    await agent.polishChapter({
      chapterContent: "Nội dung gốc.",
      chapterNumber: 7,
      language: "vi",
      chapterMemo: {
        chapter: 7,
        goal: "Lục Phần lấy lại tàn nhẫn",
        isGoldenOpening: false,
        body: "## Nhiệm vụ hiện tại\nLục Phần lấy lại tàn nhẫn.",
        threadRefs: [],
      },
    });

    const messages = chatSpy.mock.calls[0]?.[0] as
      | ReadonlyArray<{ content: string }>
      | undefined;
    const userPrompt = messages?.[1]?.content ?? "";

    expect(userPrompt).toContain("## Chapter Memo");
    expect(userPrompt).toContain("Goal: Lục Phần lấy lại tàn nhẫn");
  });

  it("returns polished content and flags 'changed' when output differs", async () => {
    const agent = makeAgent();
    vi.spyOn(PolisherAgent.prototype as never, "chat" as never).mockResolvedValue({
      content: "Nội dung đã được trau chuốt.",
      usage: ZERO_USAGE,
    });

    const out = await agent.polishChapter({
      chapterContent: "Nội dung gốc.",
      chapterNumber: 1,
      language: "vi",
    });

    expect(out.polishedContent).toBe("Nội dung đã được trau chuốt.");
    expect(out.changed).toBe(true);
  });

  it("preserves the original chapter when the model returns empty content", async () => {
    const agent = makeAgent();
    vi.spyOn(PolisherAgent.prototype as never, "chat" as never).mockResolvedValue({
      content: "",
      usage: ZERO_USAGE,
    });

    const out = await agent.polishChapter({
      chapterContent: "Nội dung gốc.",
      chapterNumber: 1,
      language: "vi",
    });

    expect(out.polishedContent).toBe("Nội dung gốc.");
    expect(out.changed).toBe(false);
  });

  it("strips a surrounding fenced-code-block wrapper if the model adds one", async () => {
    const agent = makeAgent();
    vi.spyOn(PolisherAgent.prototype as never, "chat" as never).mockResolvedValue({
      content: "```markdown\nNội dung đã được trau chuốt.\n```",
      usage: ZERO_USAGE,
    });

    const out = await agent.polishChapter({
      chapterContent: "Nội dung gốc.",
      chapterNumber: 1,
      language: "vi",
    });

    expect(out.polishedContent).toBe("Nội dung đã được trau chuốt.");
    expect(out.changed).toBe(true);
  });

  it("builds the English system prompt when language is en", async () => {
    const agent = makeAgent();
    const chatSpy = vi.spyOn(PolisherAgent.prototype as never, "chat" as never).mockResolvedValue({
      content: "Polished chapter body.",
      usage: ZERO_USAGE,
    });

    await agent.polishChapter({
      chapterContent: "Original chapter body.",
      chapterNumber: 3,
      language: "en",
    });

    const messages = chatSpy.mock.calls[0]?.[0] as
      | ReadonlyArray<{ content: string }>
      | undefined;
    const systemPrompt = messages?.[0]?.content ?? "";

    expect(systemPrompt).toContain("Polisher Scope");
    expect(systemPrompt).toContain("FORBIDDEN from adding or removing plot beats");
    expect(systemPrompt).toContain("Ineffective description");
    expect(systemPrompt).toContain("Dialogue naturalness");
  });
});
