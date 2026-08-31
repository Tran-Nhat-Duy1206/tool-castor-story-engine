import { describe, expect, it, vi } from "vitest";
import { FanficCanonImporter } from "../agents/fanfic-canon-importer.js";
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

describe("FanficCanonImporter", () => {
  it("semantically compiles long source chunks instead of truncating the tail", async () => {
    const agent = new FanficCanonImporter({
      client: TEST_CLIENT,
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const chatSpy = vi.spyOn(
      agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> },
      "chat",
    )
      .mockResolvedValueOnce({
        content: "mock_text1mock_text：mock_textChương mock_text。",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "mock_text2mock_text：TAIL_CANON_MARKER mock_text。",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== SECTION: world_rules ===",
          "mock_text：TAIL_CANON_MARKER。",
          "=== SECTION: character_profiles ===",
          "| mock_text | mock_text | mock_text | mock_text/mock_text | mock_text | mock_text | mock_text | mock_text |",
          "|------|------|----------|-------------|----------|----------|----------|----------|",
          "| mock_text | mock_text | mock_text | （mock_text） | mock_text | mock_text | mock_text | mock_text |",
          "=== SECTION: key_events ===",
          "| mock_text | mock_text | mock_text | mock_text |",
          "|------|------|----------|------------------|",
          "| 1 | mock_text | mock_text | mock_text TAIL_CANON_MARKER |",
          "=== SECTION: power_system ===",
          "（mock_text）",
          "=== SECTION: writing_style ===",
          "mock_text。",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    const source = `${"mock_text".repeat(25_000)}\nTAIL_CANON_MARKER`;
    const result = await agent.importFromText(source, "mock_text", "canon");

    expect(chatSpy).toHaveBeenCalledTimes(3);
    const secondChunkMessages = chatSpy.mock.calls[1]?.[0] as Array<{ role: string; content: string }>;
    expect(secondChunkMessages[1]?.content).toContain("TAIL_CANON_MARKER");
    const finalMessages = chatSpy.mock.calls[2]?.[0] as Array<{ role: string; content: string }>;
    expect(finalMessages[1]?.content).toContain("mock_text2mock_text：TAIL_CANON_MARKER");
    expect(finalMessages[0]?.content).not.toContain("mock_text");
    expect(result.worldRules).toContain("TAIL_CANON_MARKER");
  });
});
