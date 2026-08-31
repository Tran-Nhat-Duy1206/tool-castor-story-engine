import { describe, expect, it, vi } from "vitest";
import { chatCompletion, createLLMClient } from "../llm/provider.js";

const { fetchCalls, responseQueue } = vi.hoisted(() => ({
  fetchCalls: [] as Array<{ url: string; init: RequestInit; body: Record<string, unknown> }>,
  responseQueue: [] as Response[],
}));

vi.mock("../utils/proxy-fetch.js", () => ({
  fetchWithProxy: vi.fn(async (url: string, init: RequestInit) => {
    fetchCalls.push({
      url,
      init,
      body: JSON.parse(String(init.body ?? "{}")),
    });
    const queued = responseQueue.shift();
    if (queued) return queued;
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    } as Response;
  }),
}));

vi.mock("@mariozechner/pi-ai", () => ({
  completeSimple: vi.fn(async () => {
    throw new Error("MiniMax OpenAI-compatible requests must use Castor native transport");
  }),
  streamSimple: vi.fn(async function* () {
    throw new Error("MiniMax OpenAI-compatible requests must use Castor native transport");
  }),
}));

function minimaxClient(model: string, stream = false) {
  return createLLMClient({
    provider: "openai",
    service: "minimax",
    model,
    apiKey: "sk-test",
    apiFormat: "chat",
    stream,
    temperature: 0.9,
    thinkingBudget: 0,
    extra: {},
  } as never);
}

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    json: async () => payload,
  } as Response;
}

function sseResponse(events: string[]): Response {
  const chunks = events.map((event) => `data: ${event}\n\n`);
  let index = 0;
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: async () => index < chunks.length
          ? { value: new TextEncoder().encode(chunks[index++]), done: false }
          : { value: undefined, done: true },
      }),
    },
  } as unknown as Response;
}

describe("MiniMax thinking defaults", () => {
  it("disables MiniMax-M3 thinking and requests reasoning_split by default", async () => {
    fetchCalls.length = 0;
    const client = minimaxClient("MiniMax-M3");

    const result = await chatCompletion(client, "MiniMax-M3", [
      { role: "user", content: "hi" },
    ], { retry: false });

    expect(result.content).toBe("ok");
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]!.url).toBe("https://api.minimaxi.com/v1/chat/completions");
    expect(fetchCalls[0]!.body).toMatchObject({
      model: "MiniMax-M3",
      thinking: { type: "disabled" },
      reasoning_split: true,
    });
  });

  it("sends reasoning_split but no thinking control to MiniMax-M2.x models", async () => {
    fetchCalls.length = 0;
    const client = minimaxClient("MiniMax-M2.7");

    await chatCompletion(client, "MiniMax-M2.7", [
      { role: "user", content: "hi" },
    ], { retry: false });

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]!.body).not.toHaveProperty("thinking");
    expect(fetchCalls[0]!.body).toMatchObject({ reasoning_split: true });
  });
});

describe("MiniMax thinking leak prevention (issue #329)", () => {
  it("does not merge reasoning_content into the returned content (non-stream)", async () => {
    fetchCalls.length = 0;
    responseQueue.push(jsonResponse({
      choices: [{
        message: {
          content: "Chương mock_text。",
          reasoning_content: "mock_text……",
        },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));
    const client = minimaxClient("MiniMax-M2.7");

    const result = await chatCompletion(client, "MiniMax-M2.7", [
      { role: "user", content: "mock_textChương mock_text" },
    ], { retry: false });

    expect(result.content).toBe("Chương mock_text。");
    expect(result.content).not.toContain("mock_text");
  });

  it("strips a leading inline <think> block from non-stream content", async () => {
    fetchCalls.length = 0;
    responseQueue.push(jsonResponse({
      choices: [{
        message: {
          content: "<think>mock_text，mock_text</think>\n\nChương mock_text。",
        },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));
    const client = minimaxClient("MiniMax-M2.7");

    const result = await chatCompletion(client, "MiniMax-M2.7", [
      { role: "user", content: "mock_textChương mock_text" },
    ], { retry: false });

    expect(result.content).toBe("Chương mock_text。");
    expect(result.content).not.toContain("mock_text");
  });

  it("keeps reasoning_content and reasoning_details deltas out of streamed content", async () => {
    fetchCalls.length = 0;
    responseQueue.push(sseResponse([
      JSON.stringify({ choices: [{ delta: { reasoning_content: "mock_textA" } }] }),
      JSON.stringify({ choices: [{ delta: { reasoning_details: [{ text: "mock_textB" }] } }] }),
      JSON.stringify({ choices: [{ delta: { content: "Chương mock_text" } }] }),
      JSON.stringify({ choices: [{ delta: { content: "mock_text。" } }] }),
      JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } }),
      "[DONE]",
    ]));
    const client = minimaxClient("MiniMax-M2.7", true);
    const deltas: string[] = [];

    const result = await chatCompletion(client, "MiniMax-M2.7", [
      { role: "user", content: "mock_textChương mock_text" },
    ], { retry: false, onTextDelta: (text) => deltas.push(text) });

    expect(result.content).toBe("Chương mock_text。");
    expect(result.content).not.toContain("mock_text");
    expect(deltas.join("")).toBe("Chương mock_text。");
  });

  it("strips a leading inline <think> block split across stream chunks", async () => {
    fetchCalls.length = 0;
    responseQueue.push(sseResponse([
      JSON.stringify({ choices: [{ delta: { content: "<th" } }] }),
      JSON.stringify({ choices: [{ delta: { content: "ink>mock_text" } }] }),
      JSON.stringify({ choices: [{ delta: { content: "</think>\nChương mock_text" } }] }),
      JSON.stringify({ choices: [{ delta: { content: "mock_text。" } }] }),
      JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }),
      "[DONE]",
    ]));
    const client = minimaxClient("MiniMax-M2.7", true);
    const deltas: string[] = [];

    const result = await chatCompletion(client, "MiniMax-M2.7", [
      { role: "user", content: "mock_textChương mock_text" },
    ], { retry: false, onTextDelta: (text) => deltas.push(text) });

    expect(result.content).toBe("Chương mock_text。");
    expect(deltas.join("")).toBe("Chương mock_text。");
    expect(deltas.join("")).not.toContain("mock_text");
  });
});
