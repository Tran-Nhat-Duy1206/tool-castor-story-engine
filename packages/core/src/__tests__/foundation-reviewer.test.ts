import { describe, expect, it, vi } from "vitest";
import {
  FoundationReviewerAgent,
  FoundationReviewParseError,
} from "../agents/foundation-reviewer.js";
import type { LLMClient } from "../llm/provider.js";

const TEST_CLIENT: LLMClient = {
  provider: "openai",
  apiFormat: "chat",
  stream: false,
} as unknown as LLMClient;

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

describe("FoundationReviewerAgent", () => {
  it("reviews original foundations against the requested chapter count", async () => {
    const agent = new FoundationReviewerAgent({
      client: TEST_CLIENT,
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const chatSpy = vi.spyOn(
      agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> },
      "chat",
    ).mockResolvedValue({
      content: [
        "=== DIMENSION: 1 ===",
        "mock_text：80",
        "mock_text：mock_text",
        "=== DIMENSION: 2 ===",
        "mock_text：80",
        "mock_text：mock_text",
        "=== DIMENSION: 3 ===",
        "mock_text：80",
        "mock_text：mock_text",
        "=== DIMENSION: 4 ===",
        "mock_text：80",
        "mock_text：mock_text",
        "=== DIMENSION: 5 ===",
        "mock_text：80",
        "mock_text：mock_text",
        "=== OVERALL ===",
        "mock_text：80",
        "mock_text：mock_text",
        "mock_text：mock_text。",
      ].join("\n"),
      usage: ZERO_USAGE,
    });

    await agent.review({
      language: "vi",
      mode: "original",
      targetChapters: 8,
      foundation: {
        storyBible: "mock_text",
        volumeOutline: "8mock_text",
        bookRules: "mock_text",
        currentState: "mock_text",
        pendingHooks: "mock_text",
      },
    });

    const messages = chatSpy.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    expect(messages[0]?.content).toContain("mock_text8mock_text");
    expect(messages[0]?.content).toContain("mock_text5mock_text");
    expect(messages[0]?.content).toContain("mock_text8mock_text");
    expect(messages[0]?.content).not.toContain("mock_text40mock_text");
    expect(messages[0]?.content).not.toContain("mock_text10mock_text");
  });

  it("does not silently truncate foundation, canon, or style inputs before review", async () => {
    const agent = new FoundationReviewerAgent({
      client: TEST_CLIENT,
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const chatSpy = vi.spyOn(
      agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> },
      "chat",
    ).mockResolvedValue({
      content: [
        "=== DIMENSION: 1 ===",
        "mock_text：80",
        "mock_text：mock_text",
        "=== DIMENSION: 2 ===",
        "mock_text：80",
        "mock_text：mock_text",
        "=== DIMENSION: 3 ===",
        "mock_text：80",
        "mock_text：mock_text",
        "=== DIMENSION: 4 ===",
        "mock_text：80",
        "mock_text：mock_text",
        "=== DIMENSION: 5 ===",
        "mock_text：80",
        "mock_text：mock_text",
        "=== OVERALL ===",
        "mock_text：80",
        "mock_text：mock_text",
        "mock_text：mock_text。",
      ].join("\n"),
      usage: ZERO_USAGE,
    });

    await agent.review({
      language: "vi",
      mode: "fanfic",
      sourceCanon: `${"mock_text".repeat(9000)}\nSOURCE_CANON_TAIL_MARKER`,
      styleGuide: `${"mock_text".repeat(3000)}\nSTYLE_GUIDE_TAIL_MARKER`,
      foundation: {
        storyBible: `${"mock_text".repeat(5000)}\nSTORY_BIBLE_TAIL_MARKER`,
        volumeOutline: `${"mock_text".repeat(5000)}\nVOLUME_OUTLINE_TAIL_MARKER`,
        bookRules: `${"mock_text".repeat(3000)}\nBOOK_RULES_TAIL_MARKER`,
        currentState: `${"mock_text".repeat(2000)}\nCURRENT_STATE_TAIL_MARKER`,
        pendingHooks: `${"mock_text".repeat(2000)}\nPENDING_HOOKS_TAIL_MARKER`,
      },
    });

    const messages = chatSpy.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    expect(messages[0]?.content).toContain("SOURCE_CANON_TAIL_MARKER");
    expect(messages[0]?.content).toContain("STYLE_GUIDE_TAIL_MARKER");
    expect(messages[1]?.content).toContain("STORY_BIBLE_TAIL_MARKER");
    expect(messages[1]?.content).toContain("VOLUME_OUTLINE_TAIL_MARKER");
    expect(messages[1]?.content).toContain("BOOK_RULES_TAIL_MARKER");
    expect(messages[1]?.content).toContain("CURRENT_STATE_TAIL_MARKER");
    expect(messages[1]?.content).toContain("PENDING_HOOKS_TAIL_MARKER");
  });

  it("parses Task 10 structured exact-unit findings without deriving them from scores", async () => {
    const agent = new FoundationReviewerAgent({
      client: TEST_CLIENT,
      model: "test-model",
      projectRoot: process.cwd(),
    });
    vi.spyOn(
      agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> },
      "chat",
    ).mockResolvedValue({
      content: [
        ...[1, 2, 3, 4, 5].flatMap((number) => [
          `=== DIMENSION: ${number} ===`,
          "Score: 90",
          "Feedback: informational",
        ]),
        "=== FINDINGS_JSON ===",
        JSON.stringify([{
          unitId: "sf-theme-tone",
          category: "story_core",
          severity: "minor",
          repairScope: "local",
          evidence: "Weak premise",
          suggestedAction: "Focused premise",
        }]),
        "=== OVERALL ===",
        "Total: 90",
        "Passed: yes",
        "Summary: one exact local finding",
      ].join("\n"),
      usage: ZERO_USAGE,
    });

    const result = await agent.review({
      language: "en",
      mode: "original",
      structuredFindings: true,
      foundation: {
        storyBible: "[unitId=sf-theme-tone] Weak premise",
        volumeOutline: "volume",
        bookRules: "rules",
        currentState: "",
        pendingHooks: "hooks",
      },
    });
    expect(result.findings).toEqual([expect.objectContaining({
      unitId: "sf-theme-tone",
      repairScope: "local",
      evidence: "Weak premise",
    })]);
  });

  it("fails closed when Task 10 requires structured findings but the model omits them", async () => {
    const agent = new FoundationReviewerAgent({
      client: TEST_CLIENT,
      model: "test-model",
      projectRoot: process.cwd(),
    });
    vi.spyOn(
      agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> },
      "chat",
    ).mockResolvedValue({
      content: [
        ...[1, 2, 3, 4, 5].flatMap((number) => [
          `=== DIMENSION: ${number} ===`,
          "Score: 90",
          "Feedback: informational",
        ]),
        "=== OVERALL ===",
        "Total: 90",
        "Passed: yes",
        "Summary: omitted structured findings",
      ].join("\n"),
      usage: ZERO_USAGE,
    });
    await expect(agent.review({
      language: "en",
      mode: "original",
      structuredFindings: true,
      foundation: {
        storyBible: "story",
        volumeOutline: "volume",
        bookRules: "rules",
        currentState: "",
        pendingHooks: "hooks",
      },
    })).rejects.toThrow(/missing required FINDINGS_JSON/i);
  });

  it("does not turn a malformed review into fake 50-point quality scores", async () => {
    const agent = new FoundationReviewerAgent({
      client: TEST_CLIENT,
      model: "test-model",
      projectRoot: process.cwd(),
    });

    vi.spyOn(
      agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> },
      "chat",
    ).mockResolvedValue({
      content: [
        "### mock_text",
        "mock_text：82",
        "mock_text：mock_text，mock_text。",
      ].join("\n"),
      usage: ZERO_USAGE,
    });

    await expect(agent.review({
      language: "vi",
      mode: "original",
      targetChapters: 60,
      foundation: {
        storyBible: "mock_text",
        volumeOutline: "60mock_text",
        bookRules: "mock_text",
        currentState: "mock_text",
        pendingHooks: "mock_text",
      },
    })).rejects.toEqual(expect.objectContaining<Partial<FoundationReviewParseError>>({
      name: "FoundationReviewParseError",
      missingDimensions: [1, 2, 3, 4, 5],
    }));
  });
});
