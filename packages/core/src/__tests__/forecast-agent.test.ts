import { describe, expect, it, vi, afterEach } from "vitest";
import { NarrativeForecastAgent } from "../forecast/agent.js";
import { makeForecastBranch } from "./helpers/forecast-fixture.js";
import type { LLMMessage, LLMResponse } from "../llm/provider.js";

function llmResponse(content: string): LLMResponse {
  return { content, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
}

function validModelJson(count: number): string {
  const branches = Array.from({ length: count }, (_, index) => {
    const { branchId: _branchId, ...rest } = makeForecastBranch({ title: `分支${index + 1}` });
    return rest;
  });
  return JSON.stringify({ branches });
}

function makeAgent(): NarrativeForecastAgent {
  return new NarrativeForecastAgent({
    client: { provider: "openai" } as never,
    model: "fake",
    projectRoot: "/tmp",
  });
}

function spyOnChat(responses: ReadonlyArray<string>) {
  const spy = vi.spyOn(
    NarrativeForecastAgent.prototype as unknown as { chat: (messages: ReadonlyArray<LLMMessage>) => Promise<LLMResponse> },
    "chat",
  );
  for (const content of responses) {
    spy.mockResolvedValueOnce(llmResponse(content));
  }
  return spy;
}

const INPUT = {
  contextMarkdown: "# 正史上下文",
  divergence: "主角是否接受提议",
  branchCount: 2,
  horizon: 5,
  baseChapter: 12,
  language: "vi" as const,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("NarrativeForecastAgent", () => {
  it("returns validated branches from a valid first response", async () => {
    const spy = spyOnChat([validModelJson(2)]);

    const output = await makeAgent().generateBranches(INPUT);

    expect(output.branches).toHaveLength(2);
    expect(spy).toHaveBeenCalledTimes(1);
    const [messages] = spy.mock.calls[0]!;
    expect(messages[0]?.role).toBe("system");
    expect(messages[1]?.content).toContain("主角是否接受提议");
  });

  it("retries once with the validation error when the first response is invalid", async () => {
    const spy = spyOnChat(["这不是 JSON", validModelJson(2)]);

    const output = await makeAgent().generateBranches(INPUT);

    expect(output.branches).toHaveLength(2);
    expect(spy).toHaveBeenCalledTimes(2);
    const [retryMessages] = spy.mock.calls[1]!;
    expect(retryMessages.at(-2)?.role).toBe("assistant");
    expect(retryMessages.at(-1)?.content).toContain("not valid JSON");
  });

  it("throws after two invalid responses without further retries", async () => {
    const spy = spyOnChat(["垃圾输出一", "垃圾输出二"]);

    await expect(makeAgent().generateBranches(INPUT)).rejects.toThrow(/not valid JSON/);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("treats a branch count mismatch as invalid output", async () => {
    const spy = spyOnChat([validModelJson(3), validModelJson(2)]);

    const output = await makeAgent().generateBranches(INPUT);

    expect(output.branches).toHaveLength(2);
    expect(spy).toHaveBeenCalledTimes(2);
    const [retryMessages] = spy.mock.calls[1]!;
    expect(retryMessages.at(-1)?.content).toContain("2");
  });
});
