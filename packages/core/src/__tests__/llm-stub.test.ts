import { describe, expect, it, afterEach } from "vitest";
import { isLlmStubEnabled, stubChatCompletion } from "../agent/llm-stub.js";

describe("llm-stub", () => {
  const prev = process.env.CASTOR_AGENT_LLM_STUB;
  afterEach(() => {
    if (prev === undefined) delete process.env.CASTOR_AGENT_LLM_STUB;
    else process.env.CASTOR_AGENT_LLM_STUB = prev;
  });

  it("isLlmStubEnabled reflects the env var", () => {
    process.env.CASTOR_AGENT_LLM_STUB = "1";
    expect(isLlmStubEnabled()).toBe(true);
    delete process.env.CASTOR_AGENT_LLM_STUB;
    expect(isLlmStubEnabled()).toBe(false);
  });

  it("stubChatCompletion returns a valid structure JSON for a structure prompt", () => {
    const res = stubChatCompletion(
      [
        { role: "system", content: "mock_text JSON：{nodes:[...]}" },
        { role: "user", content: "mock_text" },
      ],
      "stub-model",
    );
    const parsed = JSON.parse(res.content) as { nodes: unknown[] };
    expect(Array.isArray(parsed.nodes)).toBe(true);
    expect(parsed.nodes.length).toBeGreaterThanOrEqual(2);
  });
});
