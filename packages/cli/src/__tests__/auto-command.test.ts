import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const writeNextChapterMock = vi.fn();
const buildPipelineConfigMock = vi.fn();
const loadConfigMock = vi.fn();
const loadBookConfigMock = vi.fn();
const getNextChapterNumberMock = vi.fn();
const logMock = vi.fn();
const logErrorMock = vi.fn();

vi.mock("@actalk/inkos-core", () => ({
  PipelineRunner: class {
    writeNextChapter = writeNextChapterMock;
  },
  StateManager: class {
    async loadBookConfig() {
      return loadBookConfigMock();
    }
    async getNextChapterNumber() {
      return getNextChapterNumberMock();
    }
  },
}));

vi.mock("../utils.js", () => ({
  loadConfig: loadConfigMock,
  buildPipelineConfig: buildPipelineConfigMock,
  findProjectRoot: vi.fn(() => "/project"),
  resolveBookId: vi.fn(async (bookId?: string) => bookId ?? "auto-book"),
  getLegacyMigrationHint: vi.fn(async () => null),
  log: logMock,
  logError: logErrorMock,
}));

vi.mock("../localization.js", () => ({
  formatWriteNextProgress: vi.fn(() => "progress"),
  formatWriteNextResultLines: vi.fn(() => ["ok"]),
  formatWriteNextComplete: vi.fn(() => "done"),
  formatAutoWriteStart: vi.fn(() => "auto-start"),
  formatAutoWriteAlreadyComplete: vi.fn(() => "nothing-to-do"),
  resolveCliLanguage: vi.fn(() => "zh"),
}));

function chapterResult(chapterNumber: number, status = "ready-for-review") {
  return {
    chapterNumber,
    title: `第${chapterNumber}章`,
    wordCount: 3000,
    auditResult: { passed: true, issues: [], summary: "ok" },
    revised: false,
    status,
  };
}

const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

describe("castor auto command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadBookConfigMock.mockResolvedValue({
      language: "zh",
      writing: { reviewMode: "manual" },
    });
    loadConfigMock.mockResolvedValue({
      llm: {},
      writing: { reviewRetries: 1, reviewMode: "manual" },
    });
    buildPipelineConfigMock.mockReturnValue({});
  });

  afterAll(() => {
    exitSpy.mockRestore();
  });

  it("writes from the current chapter up to the target chapter with forced auto review", async () => {
    getNextChapterNumberMock.mockResolvedValue(3);
    let chapter = 2;
    writeNextChapterMock.mockImplementation(async () => chapterResult(++chapter));

    const { autoCommand } = await import("../commands/auto.js");
    await autoCommand.parseAsync(["node", "auto", "demo-book", "5"], { from: "node" });

    expect(writeNextChapterMock).toHaveBeenCalledTimes(3);
    // reviewMode is "manual" on both book and project, but auto-write must
    // force the inline audit→revise loop.
    expect(buildPipelineConfigMock).toHaveBeenCalledWith(
      expect.anything(),
      "/project",
      expect.objectContaining({ chapterReviewMode: "auto" }),
    );
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("does nothing when the book already reached the target chapter", async () => {
    getNextChapterNumberMock.mockResolvedValue(6);

    const { autoCommand } = await import("../commands/auto.js");
    await autoCommand.parseAsync(["node", "auto", "demo-book", "5"], { from: "node" });

    expect(writeNextChapterMock).not.toHaveBeenCalled();
    expect(buildPipelineConfigMock).not.toHaveBeenCalled();
    expect(logMock).toHaveBeenCalledWith("nothing-to-do");
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("stops immediately when a chapter write fails", async () => {
    getNextChapterNumberMock.mockResolvedValue(1);
    writeNextChapterMock
      .mockResolvedValueOnce(chapterResult(1))
      .mockRejectedValueOnce(new Error("LLM exploded"));

    const { autoCommand } = await import("../commands/auto.js");
    await autoCommand.parseAsync(["node", "auto", "demo-book", "3"], { from: "node" });

    expect(writeNextChapterMock).toHaveBeenCalledTimes(2);
    expect(logErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("Chapter 2 failed"),
    );
    expect(logErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("LLM exploded"),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("stops when a chapter ends in state-degraded status", async () => {
    getNextChapterNumberMock.mockResolvedValue(1);
    writeNextChapterMock
      .mockResolvedValueOnce(chapterResult(1))
      .mockResolvedValueOnce(chapterResult(2, "state-degraded"));

    const { autoCommand } = await import("../commands/auto.js");
    await autoCommand.parseAsync(["node", "auto", "demo-book", "3"], { from: "node" });

    expect(writeNextChapterMock).toHaveBeenCalledTimes(2);
    expect(logErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("state-degraded"),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  // Task 16 — CLI refusal surfacing (hardened plan): the Phase 4 advancement
  // gate refuses unattended batch writing when a chapter's human-governed
  // State Review is unresolved. The refusal text Core throws MUST reach the
  // terminal VERBATIM — "State Review" + the blocking chapter + the Studio
  // pointer — so an author is guided to the right interface instead of seeing
  // a generic failure.
  it("surfaces the State Review gate refusal verbatim: reason, blocking chapter and Studio pointer", async () => {
    getNextChapterNumberMock.mockResolvedValue(3);
    // Exact blocker shape thrown by assertCanAdvanceStory (advancement-gate).
    writeNextChapterMock.mockRejectedValue(new Error(
      "State Review for chapter 3 is unresolved and its proposed changes affect "
      + "chapter 3, which is not ahead of chapter 3. Resolve chapter 3's State "
      + "Review in Studio before generating chapter 3. Open State Review in Studio.",
    ));

    const { autoCommand } = await import("../commands/auto.js");
    await autoCommand.parseAsync(["node", "auto", "demo-book", "5"], { from: "node" });

    expect(writeNextChapterMock).toHaveBeenCalledTimes(1); // stopped immediately, no replay
    const printed = logErrorMock.mock.calls.map((call) => String(call[0])).join("\n");
    expect(printed).toContain("State Review");
    expect(printed).toContain("chapter 3");
    expect(printed).toContain("Open State Review in Studio.");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("keeps the gate refusal intact in --json mode", async () => {
    getNextChapterNumberMock.mockResolvedValue(1);
    writeNextChapterMock.mockRejectedValue(new Error(
      "Chapter 1 has not completed its review gate (status: needs-state-review). "
      + "Open State Review in Studio.",
    ));

    const { autoCommand } = await import("../commands/auto.js");
    await autoCommand.parseAsync(["node", "auto", "demo-book", "2", "--json"], { from: "node" });

    const printed = logMock.mock.calls.map((call) => String(call[0])).join("\n");
    expect(printed).toContain("State Review");
    expect(printed).toContain("Open State Review in Studio.");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
