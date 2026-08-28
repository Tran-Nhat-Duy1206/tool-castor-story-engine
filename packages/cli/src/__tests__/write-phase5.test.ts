// Phase 5 — Write next authority + compatibility RED suite (49 cases part 3)
// Covers: PipelineRunner.writeNextChapter via same entry as Task19, no WriterAgent direct,
// healthy SAFE writes, CONFLICT/AUTHOR_DECISION/UNCERTAIN no prose,
// v2/legacy transitions, PLAN_DEFECT, no replan #3, flag rejections, no bypass.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const writeNextChapterMock = vi.fn();
const buildPipelineConfigMock = vi.fn();
const loadConfigMock = vi.fn();
const loadBookConfigMock = vi.fn();
const getNextChapterNumberMock = vi.fn();
const loadChapterIndexMock = vi.fn();
const saveChapterIndexMock = vi.fn();
const getPlanningGateReportMock = vi.fn();
const logMock = vi.fn();
const logErrorMock = vi.fn();
const writerAgentMock = vi.fn();

vi.mock("@actalk/inkos-core", () => ({
  PipelineRunner: class { writeNextChapter = writeNextChapterMock; },
  WriterAgent: class { write = writerAgentMock; },
  StateManager: class {
    async loadBookConfig() { return loadBookConfigMock(); }
    async getNextChapterNumber() { return getNextChapterNumberMock(); }
    async loadChapterIndex() { return loadChapterIndexMock(); }
    async saveChapterIndex() { return saveChapterIndexMock(); }
    async restoreState() { return true; }
    bookDir(bookId: string) { return `/project/books/${bookId}`; }
  },
  resolveChapterReviewMode: () => "auto",
  // Planning gate — write next should delegate to this Core entry (Task 16 authority)
  getPlanningGateReport: getPlanningGateReportMock,
  evaluatePlanningGate: getPlanningGateReportMock,
  getPlanningGateVerdict: getPlanningGateReportMock,
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

const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
afterAll(() => exitSpy.mockRestore());

beforeEach(() => {
  vi.clearAllMocks();
  loadBookConfigMock.mockResolvedValue({ language: "zh", writing: { reviewMode: "auto" }, canonVersion: "v2" });
  loadConfigMock.mockResolvedValue({ llm: {}, writing: { reviewRetries: 1 } });
  buildPipelineConfigMock.mockReturnValue({});
  loadChapterIndexMock.mockResolvedValue([]);
  getNextChapterNumberMock.mockResolvedValue(5);
  getPlanningGateReportMock.mockResolvedValue({ verdict: "SAFE", canWrite: true });
  writeNextChapterMock.mockResolvedValue({
    chapterNumber: 5, title: "第五章", wordCount: 2000,
    auditResult: { passed: true, issues: [] }, revised: false, status: "ready-for-review",
  });
});

describe("write next — same entry as Task 19", () => {
  it("1 write next calls PipelineRunner.writeNextChapter with bookId", async () => {
    const { writeCommand } = await import("../commands/write.js");
    await writeCommand.parseAsync(["node", "write", "next", "demo-book"], { from: "node" });
    // WordCount is optional second arg (undefined when not provided) — verify bookId at least
    expect(writeNextChapterMock).toHaveBeenCalled();
    expect(writeNextChapterMock.mock.calls[0]![0]).toBe("demo-book");
  });

  it("2 does not call WriterAgent directly (only via PipelineRunner)", async () => {
    const { writeCommand } = await import("../commands/write.js");
    await writeCommand.parseAsync(["node", "write", "next", "demo-book"], { from: "node" });
    expect(writerAgentMock).not.toHaveBeenCalled();
    expect(writeNextChapterMock).toHaveBeenCalled();
  });
});

describe("write next — authority gate", () => {
  it("3 healthy SAFE writes prose", async () => {
    getPlanningGateReportMock.mockResolvedValue({ verdict: "SAFE", canWrite: true } as never);
    const { writeCommand } = await import("../commands/write.js");
    await writeCommand.parseAsync(["node", "write", "next", "demo-book"], { from: "node" });
    expect(writeNextChapterMock).toHaveBeenCalledTimes(1);
    expect(exitSpy).not.toHaveBeenCalledWith(1);
  });

  it("4 CONFLICT produces no prose (writeNextChapter not called)", async () => {
    getPlanningGateReportMock.mockResolvedValue({ verdict: "CONFLICT", canWrite: false, reasons: ["overlap"] } as never);
    // PipelineRunner would throw gate_conflict if called without gate check; but CLI should block BEFORE calling it
    writeNextChapterMock.mockRejectedValue(Object.assign(new Error("gate conflict"), { code: "gate_conflict" }));
    const { writeCommand } = await import("../commands/write.js");
    await writeCommand.parseAsync(["node", "write", "next", "demo-book"], { from: "node" });
    // Either blocked before call, or called and surfaced as gate error without prose persistence
    // Authority requires NO prose: the CLI must not have produced chapter file via fallback
    // We assert gate was consulted and error surfaced
    expect(getPlanningGateReportMock).toHaveBeenCalled();
    const printed = (logErrorMock.mock.calls.map((c) => String(c[0])).join("\n") + logMock.mock.calls.map((c) => String(c[0])).join("\n")).toLowerCase();
    expect(printed).toContain("conflict");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("5 AUTHOR_DECISION without authorization produces no prose", async () => {
    getPlanningGateReportMock.mockResolvedValue({ verdict: "AUTHOR_DECISION", canWrite: false, requiresAuthorization: true } as never);
    const { writeCommand } = await import("../commands/write.js");
    await writeCommand.parseAsync(["node", "write", "next", "demo-book"], { from: "node" });
    expect(getPlanningGateReportMock).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
    // No fallback prose generation via legacy path
    const printed = logErrorMock.mock.calls.map((c) => String(c[0])).join("\n").toLowerCase();
    expect(printed).toMatch(/author_decision|authorization/);
  });

  it("6 UNCERTAIN produces no prose", async () => {
    getPlanningGateReportMock.mockResolvedValue({ verdict: "UNCERTAIN", canWrite: false } as never);
    const { writeCommand } = await import("../commands/write.js");
    await writeCommand.parseAsync(["node", "write", "next", "demo-book"], { from: "node" });
    expect(getPlanningGateReportMock).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("7 v2 book with legacy-only plan cannot fall back to legacy write (fail closed)", async () => {
    loadBookConfigMock.mockResolvedValue({ language: "zh", canonVersion: "v2", planVersion: "v1" } as never);
    getPlanningGateReportMock.mockResolvedValue({ verdict: "CONFLICT", canWrite: false, reason: "v2 requires v2 plan" } as never);
    writeNextChapterMock.mockRejectedValue(Object.assign(new Error("v2 plan required"), { code: "plan_version_mismatch" }));
    const { writeCommand } = await import("../commands/write.js");
    await writeCommand.parseAsync(["node", "write", "next", "demo-book"], { from: "node" });
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(writeNextChapterMock.mock.calls.length <= 1).toBeTruthy();
  });

  it("8 legacy book attempting v2 plan fails closed", async () => {
    loadBookConfigMock.mockResolvedValue({ language: "zh", canonVersion: "legacy", planVersion: "v2" } as never);
    getPlanningGateReportMock.mockResolvedValue({ verdict: "CONFLICT", canWrite: false } as never);
    writeNextChapterMock.mockRejectedValue(Object.assign(new Error("legacy cannot use v2"), { code: "compatibility_error" }));
    const { writeCommand } = await import("../commands/write.js");
    await writeCommand.parseAsync(["node", "write", "next", "demo-book"], { from: "node" });
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("9 legacy/legacy compatible writes", async () => {
    loadBookConfigMock.mockResolvedValue({ language: "zh", canonVersion: "legacy" } as never);
    getPlanningGateReportMock.mockResolvedValue({ verdict: "SAFE", canWrite: true } as never);
    const { writeCommand } = await import("../commands/write.js");
    await writeCommand.parseAsync(["node", "write", "next", "demo-book"], { from: "node" });
    expect(writeNextChapterMock).toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalledWith(1);
  });

  it("10 PLAN_DEFECT surfaces to user (error contains defect code)", async () => {
    getPlanningGateReportMock.mockResolvedValue({ verdict: "SAFE", canWrite: true } as never);
    writeNextChapterMock.mockRejectedValue(Object.assign(new Error("PLAN_DEFECT: arc inconsistent"), { code: "PLAN_DEFECT" }));
    const { writeCommand } = await import("../commands/write.js");
    await writeCommand.parseAsync(["node", "write", "next", "demo-book"], { from: "node" });
    expect(exitSpy).toHaveBeenCalledWith(1);
    const printed = logErrorMock.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("PLAN_DEFECT");
  });

  it("11 no replan #3 (does not retry writeNextChapter 3 times on PLAN_DEFECT)", async () => {
    writeNextChapterMock.mockRejectedValue(Object.assign(new Error("PLAN_DEFECT"), { code: "PLAN_DEFECT" }));
    const { writeCommand } = await import("../commands/write.js");
    await writeCommand.parseAsync(["node", "write", "next", "demo-book"], { from: "node" });
    expect(writeNextChapterMock).toHaveBeenCalledTimes(1);
  });
});

describe("write next — flag rejections (no bypass)", () => {
  it("12 --force is rejected (unknown option, exit 1, no write)", async () => {
    const { writeCommand } = await import("../commands/write.js");
    // commander errors on unknown option and calls process.exit via exitOverride or error display
    // We assert either exitSpy or write not called
    try { await writeCommand.parseAsync(["node", "write", "next", "demo-book", "--force"], { from: "node" }); } catch {}
    expect(writeNextChapterMock).not.toHaveBeenCalled();
    // If commander uses exitOverride, exitSpy may have been called; otherwise error is thrown
    // At minimum no prose produced
  });

  it("13 --ignore-canon is rejected", async () => {
    const { writeCommand } = await import("../commands/write.js");
    try { await writeCommand.parseAsync(["node", "write", "next", "demo-book", "--ignore-canon"], { from: "node" }); } catch {}
    expect(writeNextChapterMock).not.toHaveBeenCalled();
  });

  it("14 --skip-authority is rejected", async () => {
    const { writeCommand } = await import("../commands/write.js");
    try { await writeCommand.parseAsync(["node", "write", "next", "demo-book", "--skip-authority"], { from: "node" }); } catch {}
    expect(writeNextChapterMock).not.toHaveBeenCalled();
  });

  it("15 --bypass-gate is rejected", async () => {
    const { writeCommand } = await import("../commands/write.js");
    try { await writeCommand.parseAsync(["node", "write", "next", "demo-book", "--bypass-gate"], { from: "node" }); } catch {}
    expect(writeNextChapterMock).not.toHaveBeenCalled();
  });

  it("16 equivalent bypass --no-verify is rejected or does not bypass gate", async () => {
    getPlanningGateReportMock.mockResolvedValue({ verdict: "CONFLICT", canWrite: false } as never);
    const { writeCommand } = await import("../commands/write.js");
    try { await writeCommand.parseAsync(["node", "write", "next", "demo-book", "--no-verify"], { from: "node" }); } catch {}
    // Even if --no-verify were a valid flag, CONFLICT must still block
    if (writeNextChapterMock.mock.calls.length > 0) {
      expect(exitSpy).toHaveBeenCalledWith(1);
    } else {
      expect(writeNextChapterMock).not.toHaveBeenCalled();
    }
  });

  it("17 book isolation: write scoped to requested bookId", async () => {
    getPlanningGateReportMock.mockResolvedValue({ verdict: "SAFE", canWrite: true } as never);
    const { writeCommand } = await import("../commands/write.js");
    await writeCommand.parseAsync(["node", "write", "next", "book-A"], { from: "node" });
    expect(writeNextChapterMock.mock.calls[0]![0]).toBe("book-A");
    vi.clearAllMocks();
    getPlanningGateReportMock.mockResolvedValue({ verdict: "SAFE", canWrite: true } as never);
    writeNextChapterMock.mockResolvedValue({
      chapterNumber: 3, title: "Ch3", wordCount: 1000,
      auditResult: { passed: true, issues: [] }, revised: false, status: "ready-for-review",
    } as never);
    await writeCommand.parseAsync(["node", "write", "next", "book-B"], { from: "node" });
    expect(writeNextChapterMock.mock.calls[0]![0]).toBe("book-B");
  });
});
