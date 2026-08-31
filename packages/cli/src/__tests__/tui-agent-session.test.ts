import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProjectSession, loadProjectSession } from "../tui/session-store.js";

const {
  runAgentSessionMock,
  loadConfigMock,
  buildPipelineConfigMock,
} = vi.hoisted(() => ({
  runAgentSessionMock: vi.fn(),
  loadConfigMock: vi.fn(),
  buildPipelineConfigMock: vi.fn(),
}));

vi.mock("@actalk/castor-core", async () => {
  const actual = await vi.importActual<typeof import("@actalk/castor-core")>("@actalk/castor-core");
  class PipelineRunnerMock {
    constructor(_config: unknown) {}
    async initBook(_book: unknown, _options?: unknown) {}
    async writeNextChapter(_bookId: string) {
      return {
        chapterNumber: 1,
        title: "test_mock",
        wordCount: 1200,
        status: "ready-for-review",
      };
    }
  }
  return {
    ...actual,
    createLLMClient: vi.fn(() => ({
      _piModel: {
        id: "gpt-5.4",
        name: "gpt-5.4",
        api: "openai-completions",
        provider: "openai",
        baseUrl: "https://right.codes/codex/v1",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 8192,
      },
      _apiKey: "secret",
    })),
    PipelineRunner: PipelineRunnerMock as any,
    runAgentSession: runAgentSessionMock,
  };
});

vi.mock("../utils.js", () => ({
  loadConfig: loadConfigMock,
  buildPipelineConfig: buildPipelineConfigMock,
}));

describe("tui agent session bridge", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "castor-tui-agent-"));
    vi.clearAllMocks();
    loadConfigMock.mockResolvedValue({
      llm: {
        provider: "openai",
        model: "gpt-5.4",
        baseUrl: "https://right.codes/codex/v1",
        apiFormat: "chat",
        stream: false,
      },
      language: "vi",
    });
    buildPipelineConfigMock.mockReturnValue({});
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("runs agent chat and persists raw assistant output into the tui session", async () => {
    runAgentSessionMock.mockResolvedValue({
      responseText: "test_mock agent test_mock。",
      messages: [
        { role: "user", content: "test_mock" },
        { role: "assistant", content: "test_mock agent test_mock。", thinking: "internal" },
      ],
    });

    const { processTuiAgentInput } = await import("../tui/agent-input.js");
    const session = {
      ...createProjectSession(projectRoot),
      activeBookId: "harbor",
      messages: [
        { role: "user" as const, content: "test_mock", timestamp: 1 },
        { role: "assistant" as const, content: "test_mock", timestamp: 2 },
      ],
    };

    const result = await processTuiAgentInput({
      projectRoot,
      input: "test_mock",
      session,
      activeBookId: "harbor",
    });

    expect(runAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: session.sessionId,
        bookId: "harbor",
        projectRoot,
      }),
      "test_mock",
      [
        { role: "user", content: "test_mock" },
        { role: "assistant", content: "test_mock" },
      ],
    );
    expect(result.responseText).toBe("test_mock agent test_mock。");
    expect(result.session.messages.at(-1)).toEqual(expect.objectContaining({
      role: "assistant",
      content: "test_mock agent test_mock。",
      thinking: "internal",
    }));

    const persisted = await loadProjectSession(projectRoot);
    expect(persisted.messages.at(-1)).toEqual(expect.objectContaining({
      role: "assistant",
      content: "test_mock agent test_mock。",
    }));
  });

  it("stores the created book from architect tool results as the active TUI book", async () => {
    runAgentSessionMock.mockResolvedValue({
      responseText: "《test_mock》test_mock。",
      messages: [
        {
          role: "toolResult",
          details: { kind: "book_created", bookId: "night-harbor", title: "test_mock" },
        },
        { role: "assistant", content: "《test_mock》test_mock。" },
      ],
    });

    const { processTuiAgentInput } = await import("../tui/agent-input.js");
    const session = createProjectSession(projectRoot);

    const result = await processTuiAgentInput({
      projectRoot,
      input: "test_mock《test_mock》",
      session,
    });

    expect(result.session.activeBookId).toBe("night-harbor");
    const persisted = await loadProjectSession(projectRoot);
    expect(persisted.activeBookId).toBe("night-harbor");
  });

  it("keeps ordinary creation language in chat so the agent can propose a confirmed action", async () => {
    runAgentSessionMock.mockResolvedValue({
      responseText: "test_mock《test_mock》，test_mock。",
      messages: [
        { role: "assistant", content: "test_mock《test_mock》，test_mock。" },
      ],
    });
    const { processTuiAgentInput } = await import("../tui/agent-input.js");
    const session = createProjectSession(projectRoot);

    const result = await processTuiAgentInput({
      projectRoot,
      input: "test_mock10test_mockDo thiHuyen bitest_mock，test_mock《test_mock》，test_mock，test_mock1200 từ。test_mock，test_mock。",
      session,
    });

    expect(runAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKind: "chat",
        actionSource: "free-text",
      }),
      expect.stringContaining("test_mock"),
      [],
    );
    expect(result.session.activeBookId).toBeUndefined();
    expect(result.responseText).toContain("test_mock");
    const persisted = await loadProjectSession(projectRoot);
    expect(persisted.activeBookId).toBeUndefined();
  });

  it("uses explicit slash entries to select book, short, and play surfaces without parsing free text", async () => {
    runAgentSessionMock.mockResolvedValue({
      responseText: "test_mock。",
      messages: [{ role: "assistant", content: "test_mock。" }],
    });
    const { processTuiAgentInput } = await import("../tui/agent-input.js");

    const withBook = { ...createProjectSession(projectRoot), activeBookId: "old-book" };
    const newBook = await processTuiAgentInput({
      projectRoot,
      input: "/new test_mockHuyen bitest_mock",
      session: withBook,
      activeBookId: "old-book",
    });
    expect(runAgentSessionMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ bookId: null, sessionKind: "book-create", actionSource: "slash" }),
      "test_mockHuyen bitest_mock",
      [],
    );
    expect(newBook.session.activeBookId).toBeUndefined();

    await processTuiAgentInput({
      projectRoot,
      input: "/short test_mock",
      session: createProjectSession(projectRoot),
    });
    expect(runAgentSessionMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ bookId: null, sessionKind: "short", actionSource: "slash" }),
      "test_mock",
      [],
    );

    await processTuiAgentInput({
      projectRoot,
      input: "/play open test_mock",
      session: createProjectSession(projectRoot),
    });
    expect(runAgentSessionMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ bookId: null, sessionKind: "play", playMode: "open" }),
      "test_mock",
      [],
    );
  });

  it("persists a structured proposal and replays its payload and skills only after confirmation", async () => {
    runAgentSessionMock.mockResolvedValueOnce({
      responseText: "",
      messages: [{
        role: "toolResult",
        details: {
          kind: "proposed_action",
          action: "interactive_film_create",
          targetSessionKind: "interactive-film",
          title: "test_mock",
          summary: "test_mock。",
          instruction: "test_mock",
          requestedSkills: ["interactive-film-authoring"],
          actionPayload: {
            interactiveFilmCreate: {
              title: "test_mock",
              sourcePath: ".castor/uploads/echo.md",
              episodeCount: 3,
            },
          },
        },
      }],
    });
    runAgentSessionMock.mockResolvedValueOnce({
      responseText: "test_mock。",
      messages: [{ role: "assistant", content: "test_mock。" }],
    });
    const { processTuiAgentInput } = await import("../tui/agent-input.js");

    const proposed = await processTuiAgentInput({
      projectRoot,
      input: "test_mock",
      session: createProjectSession(projectRoot),
    });
    expect(proposed.responseText).toContain("Nhập /confirm");
    expect(proposed.session.pendingProposedAction).toEqual(expect.objectContaining({
      action: "interactive_film_create",
      targetSessionKind: "interactive-film",
      requestedSkills: ["interactive-film-authoring"],
      actionPayload: expect.objectContaining({
        interactiveFilmCreate: expect.objectContaining({ title: "test_mock" }),
      }),
    }));

    const confirmed = await processTuiAgentInput({
      projectRoot,
      input: "/confirm",
      session: proposed.session,
    });
    expect(runAgentSessionMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        bookId: null,
        sessionKind: "interactive-film",
        actionSource: "slash",
        requestedIntent: "interactive_film_create",
        requestedSkills: ["interactive-film-authoring"],
        actionPayload: {
          interactiveFilmCreate: {
            title: "test_mock",
            sourcePath: ".castor/uploads/echo.md",
            episodeCount: 3,
          },
        },
      }),
      "test_mock",
      expect.any(Array),
    );
    expect(confirmed.session.pendingProposedAction).toBeUndefined();
  });

  it("uses the per-session model override when resolving the model client", async () => {
    runAgentSessionMock.mockResolvedValue({
      responseText: "test_mock。",
      messages: [{ role: "assistant", content: "test_mock。" }],
    });
    const { processTuiAgentInput } = await import("../tui/agent-input.js");
    await processTuiAgentInput({
      projectRoot,
      input: "test_mock",
      session: { ...createProjectSession(projectRoot), modelOverride: "deepseek-v4-pro" },
    });

    expect(loadConfigMock).toHaveBeenCalledWith(expect.objectContaining({
      requireApiKey: false,
      projectRoot,
      cli: { model: "deepseek-v4-pro" },
    }));
  });

  it("passes explicit slash write-next as a requested intent to the unified agent session", async () => {
    runAgentSessionMock.mockResolvedValue({
      responseText: "Đã hoàn thành chương tiếp theo cho night-harbor.",
      messages: [
        { role: "assistant", content: "Đã hoàn thành chương tiếp theo cho night-harbor." },
      ],
    });
    const { processTuiAgentInput } = await import("../tui/agent-input.js");
    const session = {
      ...createProjectSession(projectRoot),
      activeBookId: "night-harbor",
    };

    const result = await processTuiAgentInput({
      projectRoot,
      input: "/write",
      session,
    });

    expect(runAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        bookId: "night-harbor",
        sessionKind: "book",
        actionSource: "slash",
        requestedIntent: "write_next",
      }),
      "Viết chương tiếp theo",
      [],
    );
    expect(result.responseText).toContain("test_mock");
    const persisted = await loadProjectSession(projectRoot);
    expect(persisted.activeBookId).toBe("night-harbor");
  });
});
