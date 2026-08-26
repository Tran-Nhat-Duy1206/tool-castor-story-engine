import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Task 16 — CLI refusal surfacing (hardened plan): `inkos write` is another
// human interface in front of the SAME Core State Review system. When the
// Phase 4 advancement gate (assertCanAdvanceStory) refuses chapter generation
// because a State Review is unresolved, the refusal text MUST reach the
// terminal verbatim — "State Review" + the blocking chapter + the Studio
// pointer ("Open State Review in Studio.") — never swallowed by a generic
// failure message. Also pins that the prose `review` command surface stays
// unchanged (no State Review subcommand collision).

const writeNextChapterMock = vi.fn();
const buildPipelineConfigMock = vi.fn();
const loadConfigMock = vi.fn();
const loadBookConfigMock = vi.fn();
const getNextChapterNumberMock = vi.fn();
const loadChapterIndexMock = vi.fn();
const saveChapterIndexMock = vi.fn();
const restoreStateMock = vi.fn();
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
    async loadChapterIndex() {
      return loadChapterIndexMock();
    }
    async saveChapterIndex() {
      return saveChapterIndexMock();
    }
    async restoreState() {
      return restoreStateMock();
    }
    bookDir(bookId: string) {
      return `/project/books/${bookId}`;
    }
  },
  // Mirrors the real core implementation (unit-tested in core).
  resolveChapterReviewMode: (
    book: { writing?: { reviewMode?: "auto" | "manual" } },
    projectWriting?: { reviewMode?: "auto" | "manual" },
  ) => book.writing?.reviewMode ?? projectWriting?.reviewMode ?? "auto",
}));

vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(async () => ["0005_第五章.md"]),
  stat: vi.fn(async () => ({ mtimeMs: 0 })),
  unlink: vi.fn(async () => undefined),
}));

vi.mock("../utils.js", () => ({
  loadConfig: loadConfigMock,
  buildPipelineConfig: buildPipelineConfigMock,
  findProjectRoot: vi.fn(() => "/project"),
  resolveBookId: vi.fn(async (bookId?: string) => bookId ?? "demo-book"),
  getLegacyMigrationHint: vi.fn(async () => null),
  resolveContext: vi.fn(async () => undefined),
  log: logMock,
  logError: logErrorMock,
}));

vi.mock("../localization.js", () => ({
  formatWriteNextProgress: vi.fn(() => "progress"),
  formatWriteNextResultLines: vi.fn(() => ["ok"]),
  formatWriteNextComplete: vi.fn(() => "done"),
  formatNotifyCommandTitle: vi.fn(() => "notify-title"),
  formatNotifyBatchWriteBody: vi.fn(() => "notify-body"),
  formatNotifyFailureBody: vi.fn((_lang: unknown, e: unknown) => String(e)),
  resolveCliLanguage: vi.fn(() => "zh"),
}));

vi.mock("../notify-helper.js", () => ({
  sendCommandNotification: vi.fn(async () => undefined),
}));

// Verbatim blocker shape thrown by assertCanAdvanceStory for an unresolved
// ACTIVE/STALE review whose effective slot blocks the next prose chapter.
function gateRefusalError(sourceChapter: number, effectiveChapter: number, nextChapter: number): Error {
  return new Error(
    `State Review for chapter ${sourceChapter} is unresolved and `
    + `its proposed changes affect chapter ${effectiveChapter}, which is `
    + `not ahead of chapter ${nextChapter}. Resolve chapter ${sourceChapter}'s `
    + `State Review in Studio before generating chapter ${nextChapter}. `
    + "Open State Review in Studio.",
  );
}

const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

afterAll(() => {
  exitSpy.mockRestore();
});

beforeEach(() => {
  vi.clearAllMocks();
  loadBookConfigMock.mockResolvedValue({
    language: "zh",
    writing: { reviewMode: "auto" },
  });
  loadConfigMock.mockResolvedValue({ llm: {}, writing: { reviewRetries: 1 } });
  buildPipelineConfigMock.mockReturnValue({});
  loadChapterIndexMock.mockResolvedValue([]);
  restoreStateMock.mockResolvedValue(true);
});

describe("castor write next — State Review gate refusal surfacing", () => {
  it("prints the gate refusal verbatim: reason, blocking chapter and Studio pointer, then exits nonzero without replaying", async () => {
    writeNextChapterMock.mockRejectedValue(gateRefusalError(3, 3, 4));

    const { writeCommand } = await import("../commands/write.js");
    await writeCommand.parseAsync(["node", "write", "next", "demo-book"], { from: "node" });

    expect(writeNextChapterMock).toHaveBeenCalledTimes(1); // no automatic retry/replay
    const printed = logErrorMock.mock.calls.map((call) => String(call[0])).join("\n");
    expect(printed).toContain("State Review");
    expect(printed).toContain("chapter 3");
    expect(printed).toContain("Open State Review in Studio.");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("keeps the gate refusal intact in --json mode", async () => {
    writeNextChapterMock.mockRejectedValue(
      new Error(
        "Rebuild required state was recorded for chapter 2: its State Review "
        + "is unresolved and blocks generation of chapter 5. "
        + "Open State Review in Studio.",
      ),
    );

    const { writeCommand } = await import("../commands/write.js");
    await writeCommand.parseAsync(["node", "write", "next", "demo-book", "--json"], { from: "node" });

    const printed = logMock.mock.calls.map((call) => String(call[0])).join("\n");
    expect(printed).toContain("State Review");
    expect(printed).toContain("Rebuild required");
    expect(printed).toContain("chapter 2");
    expect(printed).toContain("Open State Review in Studio.");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe("castor write rewrite — State Review gate refusal surfacing", () => {
  function setupRewriteFixtures(): void {
    loadChapterIndexMock.mockResolvedValue([
      { number: 4, title: "第四章", wordCount: 1000, status: "approved" },
      { number: 5, title: "第五章", wordCount: 1000, status: "ready-for-review" },
    ]);
    getNextChapterNumberMock.mockResolvedValue(5);
  }

  it("prints the gate refusal verbatim on the regeneration path (:233)", async () => {
    setupRewriteFixtures();
    writeNextChapterMock.mockRejectedValue(gateRefusalError(3, 3, 5));

    const { writeCommand } = await import("../commands/write.js");
    await writeCommand.parseAsync(["node", "write", "rewrite", "demo-book", "5", "--force"], { from: "node" });

    expect(writeNextChapterMock).toHaveBeenCalledTimes(1);
    const printed = logErrorMock.mock.calls.map((call) => String(call[0])).join("\n");
    expect(printed).toContain("State Review");
    expect(printed).toContain("chapter 3");
    expect(printed).toContain("Open State Review in Studio.");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe("prose review command surface — no collision with State Review", () => {
  it("keeps the existing castor review subcommand set unchanged", async () => {
    const { reviewCommand } = await import("../commands/review.js");
    const names = reviewCommand.commands.map((command) => command.name()).sort();
    expect(names).toEqual(["approve", "approve-all", "list", "reject"]);
  });
});
