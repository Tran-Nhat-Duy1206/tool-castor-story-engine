import { beforeEach, describe, expect, it, vi } from "vitest";

const reviseDraftMock = vi.fn();
const buildPipelineConfigMock = vi.fn();
const loadConfigMock = vi.fn();
const loadBookConfigMock = vi.fn();
const logMock = vi.fn();
const logErrorMock = vi.fn();

vi.mock("@actalk/castor-core", () => ({
  DEFAULT_REVISE_MODE: "spot-fix",
  PipelineRunner: class {
    reviseDraft = reviseDraftMock;
  },
  StateManager: class {
    async loadBookConfig() {
      return loadBookConfigMock();
    }
  },
  // Mirrors the real core implementation: book-level overrides project-level,
  // both unset falls back to "strict". The real function is unit-tested in
  // packages/core/src/__tests__/revision-gate.test.ts.
  resolveRevisionGate: (
    book: { writing?: { revisionGate?: "strict" | "lenient" | "always" } },
    projectWriting?: { revisionGate?: "strict" | "lenient" | "always" },
  ) => book.writing?.revisionGate ?? projectWriting?.revisionGate ?? "strict",
}));

vi.mock("../utils.js", () => ({
  loadConfig: loadConfigMock,
  buildPipelineConfig: buildPipelineConfigMock,
  findProjectRoot: vi.fn(() => "/project"),
  resolveBookId: vi.fn(async (bookId?: string) => bookId ?? "auto-book"),
  castorEnv: (key: string, env: NodeJS.ProcessEnv = {}) => env[key],
  log: logMock,
  logError: logErrorMock,
}));

describe("castor revise revision gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reviseDraftMock.mockResolvedValue({
      chapterNumber: 1,
      wordCount: 3000,
      fixedIssues: ["- fixed"],
      applied: true,
      status: "ready-for-review",
    });
    buildPipelineConfigMock.mockReturnValue({});
  });

  it("passes the book-level revisionGate into the pipeline config", async () => {
    loadBookConfigMock.mockResolvedValue({
      language: "zh",
      writing: { revisionGate: "always" },
    });
    loadConfigMock.mockResolvedValue({
      llm: {},
      writing: { reviewRetries: 1, revisionGate: "strict" },
    });

    const { reviseCommand } = await import("../commands/revise.js");
    await reviseCommand.parseAsync(["node", "revise", "demo-book", "1"], { from: "node" });

    expect(buildPipelineConfigMock).toHaveBeenCalledWith(
      expect.anything(),
      "/project",
      expect.objectContaining({ revisionGate: "always" }),
    );
    expect(reviseDraftMock).toHaveBeenCalledWith("demo-book", 1, "spot-fix");
  });

  it("falls back to the project-level revisionGate when the book does not set one", async () => {
    loadBookConfigMock.mockResolvedValue({ language: "zh" });
    loadConfigMock.mockResolvedValue({
      llm: {},
      writing: { reviewRetries: 1, revisionGate: "lenient" },
    });

    const { reviseCommand } = await import("../commands/revise.js");
    await reviseCommand.parseAsync(["node", "revise", "demo-book", "1"], { from: "node" });

    expect(buildPipelineConfigMock).toHaveBeenCalledWith(
      expect.anything(),
      "/project",
      expect.objectContaining({ revisionGate: "lenient" }),
    );
  });

  it("defaults to strict when neither book nor project sets a revisionGate", async () => {
    loadBookConfigMock.mockResolvedValue({ language: "zh" });
    loadConfigMock.mockResolvedValue({ llm: {}, writing: { reviewRetries: 1 } });

    const { reviseCommand } = await import("../commands/revise.js");
    await reviseCommand.parseAsync(["node", "revise", "demo-book", "1"], { from: "node" });

    expect(buildPipelineConfigMock).toHaveBeenCalledWith(
      expect.anything(),
      "/project",
      expect.objectContaining({ revisionGate: "strict" }),
    );
  });
});
