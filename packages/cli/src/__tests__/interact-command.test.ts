import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInteractCommand } from "../commands/interact.js";

const {
  buildPipelineConfigMock,
  createClientMock,
  findProjectRootMock,
  loadConfigMock,
  runAgentSessionMock,
} = vi.hoisted(() => ({
  buildPipelineConfigMock: vi.fn(() => ({})),
  createClientMock: vi.fn(() => ({
    _piModel: {
      id: "gpt-5.4",
      name: "gpt-5.4",
      api: "openai-completions",
      provider: "openai",
      baseUrl: "https://example.invalid/v1",
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 8192,
    },
    _apiKey: "secret",
  })),
  findProjectRootMock: vi.fn(() => "/tmp/castor-project"),
  loadConfigMock: vi.fn(async () => ({
    llm: {
      provider: "openai",
      model: "gpt-5.4",
      apiFormat: "chat",
      stream: false,
    },
    language: "zh",
  })),
  runAgentSessionMock: vi.fn(async () => ({
    responseText: "Agent response.",
    messages: [{ role: "assistant", content: "Agent response." }],
  })),
}));

vi.mock("@actalk/castor-core", async () => ({
  PipelineRunner: class PipelineRunnerMock {
    constructor(_config: unknown) {}
  },
  runAgentSession: runAgentSessionMock,
}));

vi.mock("../utils.js", () => ({
  buildPipelineConfig: buildPipelineConfigMock,
  createClient: createClientMock,
  findProjectRoot: findProjectRootMock,
  loadConfig: loadConfigMock,
}));

describe("interact command", () => {
  let stdoutOutput: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutOutput = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      stdoutOutput.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("routes natural language through runAgentSession", async () => {
    const command = createInteractCommand({ readInput: async () => "" });

    await command.parseAsync(["continue", "--book", "harbor"], { from: "user" });

    expect(runAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRoot: "/tmp/castor-project",
        bookId: "harbor",
        sessionKind: "book",
        actionSource: "free-text",
        requestedIntent: undefined,
      }),
      "continue",
    );
    expect(stdoutOutput.join("")).toContain("Agent response.");
  });

  it("passes slash write as a requested intent", async () => {
    const command = createInteractCommand({ readInput: async () => "" });

    await command.parseAsync(["/write", "--book", "harbor", "--json"], { from: "user" });

    expect(runAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        bookId: "harbor",
        sessionKind: "book",
        actionSource: "slash",
        requestedIntent: "write_next",
      }),
      "/write",
    );
    const output = stdoutOutput.join("");
    expect(JSON.parse(output)).toEqual(expect.objectContaining({
      responseText: "Agent response.",
      session: expect.objectContaining({
        sessionKind: "book",
        activeBookId: "harbor",
      }),
    }));
  });

  it("reads input from the injected stdin helper", async () => {
    const command = createInteractCommand({ readInput: async () => "why did it stop?" });

    await command.parseAsync([], { from: "user" });

    expect(runAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKind: "chat",
        actionSource: "free-text",
      }),
      "why did it stop?",
    );
  });
});
