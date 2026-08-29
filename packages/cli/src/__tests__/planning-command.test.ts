// Task 23/Phase5 — Planning CLI RED suite (49 cases part 2)
// Covers: arc status, lookahead advisory, gate report delegates to Core, no recompute, no Write Anyway, book isolation, errors fail closed
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const getPublishedArcPlanMock = vi.fn();
const getLookaheadMock = vi.fn();
const getPlanningGateReportMock = vi.fn();
const getArcPreflightMock = vi.fn();
const generateArcDraftMock = vi.fn();
const getBeatProgressMock = vi.fn();
const publishArcPlanMock = vi.fn();
const writeNextChapterMock = vi.fn();
const loadConfigMock = vi.fn();
const loadBookConfigMock = vi.fn();
const logMock = vi.fn();
const logErrorMock = vi.fn();

vi.mock("@actalk/castor-core", () => ({
  StateManager: class {
    async loadBookConfig() { return loadBookConfigMock(); }
    async getNextChapterNumber() { return 5; }
  },
  PipelineRunner: class { writeNextChapter = writeNextChapterMock; },
  getPublishedArcPlan: getPublishedArcPlanMock,
  getLookahead: getLookaheadMock,
  getPlanningGateReport: getPlanningGateReportMock,
  getArcPreflight: getArcPreflightMock,
  generateArcDraft: generateArcDraftMock,
  getBeatProgress: getBeatProgressMock,
  publishArcPlan: publishArcPlanMock,
}));

vi.mock("../utils.js", () => ({
  loadConfig: loadConfigMock,
  buildPipelineConfig: vi.fn(() => ({})),
  findProjectRoot: vi.fn(() => "/project"),
  resolveBookId: vi.fn(async (bookId?: string) => bookId ?? "demo-book"),
  getLegacyMigrationHint: vi.fn(async () => null),
  log: logMock,
  logError: logErrorMock,
}));

vi.mock("../localization.js", () => ({
  resolveCliLanguage: vi.fn(() => "zh"),
}));

const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
afterAll(() => exitSpy.mockRestore());

beforeEach(() => {
  vi.clearAllMocks();
  loadBookConfigMock.mockResolvedValue({ language: "zh", title: "Demo" });
  loadConfigMock.mockResolvedValue({ llm: {}, writing: {} });
  getPublishedArcPlanMock.mockResolvedValue({ arcId: "arc-1", title: "Arc 1", status: "published" });
  getLookaheadMock.mockResolvedValue({ advisory: true, items: [{ id: "lh1", hint: "maybe" }] });
  getPlanningGateReportMock.mockResolvedValue({ verdict: "SAFE", canWrite: true, reasons: [] });
  getArcPreflightMock.mockResolvedValue({ ready: true, pass: true });
  getBeatProgressMock.mockResolvedValue({ beats: [] });
});

describe("planning command — registration", () => {
  it("1 planning command is registered", async () => {
    const { planningCommand } = await import("../commands/planning.js");
    expect(planningCommand.name()).toBe("planning");
  });

  it("2 planning arc status subcommand is registered", async () => {
    const { planningCommand } = await import("../commands/planning.js");
    // arc status may be nested: planning -> arc -> status, or planning -> arc-status
    const names = planningCommand.commands.flatMap((c) => [c.name(), ...c.commands.map((s) => `${c.name()} ${s.name()}`)]);
    const joined = names.join(" ");
    expect(joined).toMatch(/arc/);
  });

  it("3 planning lookahead show subcommand is registered (advisory)", async () => {
    const { planningCommand } = await import("../commands/planning.js");
    const names = planningCommand.commands.flatMap((c) => [c.name(), ...c.commands.map((s) => `${c.name()} ${s.name()}`)]);
    const joined = names.join(" ");
    expect(joined).toMatch(/lookahead/);
  });

  it("4 planning gate report subcommand is registered", async () => {
    const { planningCommand } = await import("../commands/planning.js");
    const names = planningCommand.commands.flatMap((c) => [c.name(), ...c.commands.map((s) => s.name())]);
    expect(names.join(" ")).toMatch(/gate/);
  });
});

describe("planning arc status — Core delegation", () => {
  it("5 arc status delegates to Core getPublishedArcPlan", async () => {
    const { planningCommand } = await import("../commands/planning.js");
    await planningCommand.parseAsync(["node", "planning", "arc", "status", "demo-book"], { from: "node" });
    expect(getPublishedArcPlanMock).toHaveBeenCalledWith(expect.objectContaining({ bookId: "demo-book" }));
  });

  it("6 arc status prints title/status from Core", async () => {
    getPublishedArcPlanMock.mockResolvedValue({ arcId: "arc-1", title: "Epic Arc", status: "published" } as never);
    const { planningCommand } = await import("../commands/planning.js");
    await planningCommand.parseAsync(["node", "planning", "arc", "status", "demo-book"], { from: "node" });
    const printed = logMock.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("Epic Arc");
  });

  it("7 arc status does not call publishArcPlan (read-only)", async () => {
    const { planningCommand } = await import("../commands/planning.js");
    await planningCommand.parseAsync(["node", "planning", "arc", "status", "demo-book"], { from: "node" });
    expect(publishArcPlanMock).not.toHaveBeenCalled();
  });
});

describe("planning lookahead show — advisory", () => {
  it("8 lookahead show delegates to Core getLookahead", async () => {
    const { planningCommand } = await import("../commands/planning.js");
    await planningCommand.parseAsync(["node", "planning", "lookahead", "show", "demo-book"], { from: "node" });
    expect(getLookaheadMock).toHaveBeenCalledWith(expect.objectContaining({ bookId: "demo-book" }));
  });

  it("9 lookahead is advisory (output contains advisory marker, not authority)", async () => {
    getLookaheadMock.mockResolvedValue({ advisory: true, items: [{ hint: "future" }] } as never);
    const { planningCommand } = await import("../commands/planning.js");
    await planningCommand.parseAsync(["node", "planning", "lookahead", "show", "demo-book"], { from: "node" });
    const printed = logMock.mock.calls.map((c) => String(c[0])).join("\n").toLowerCase();
    expect(printed).toContain("advisory");
    expect(publishArcPlanMock).not.toHaveBeenCalled();
  });

  it("10 lookahead has no approve/publish mutation", async () => {
    const { planningCommand } = await import("../commands/planning.js");
    // lookahead subcommand should not expose --approve or --publish
    const lookahead = planningCommand.commands.find((c) => c.name() === "lookahead");
    if (lookahead) {
      const subNames = lookahead.commands.map((c) => c.name());
      expect(subNames).not.toContain("approve");
      expect(subNames).not.toContain("publish");
    }
    // also ensures show does not mutate
    await planningCommand.parseAsync(["node", "planning", "lookahead", "show", "demo-book"], { from: "node" });
    expect(publishArcPlanMock).not.toHaveBeenCalled();
  });
});

describe("planning gate report — Core delegation, no recompute, no Write Anyway", () => {
  it("11 gate report delegates to Core getPlanningGateReport", async () => {
    const { planningCommand } = await import("../commands/planning.js");
    await planningCommand.parseAsync(["node", "planning", "gate", "report", "demo-book"], { from: "node" });
    expect(getPlanningGateReportMock).toHaveBeenCalledWith(expect.objectContaining({ bookId: "demo-book" }));
  });

  it("12 gate report does not recompute (no generateArcDraft)", async () => {
    const { planningCommand } = await import("../commands/planning.js");
    await planningCommand.parseAsync(["node", "planning", "gate", "report", "demo-book"], { from: "node" });
    expect(generateArcDraftMock).not.toHaveBeenCalled();
  });

  it("13 gate report does not trigger Write Anyway (no writeNextChapter)", async () => {
    getPlanningGateReportMock.mockResolvedValue({ verdict: "CONFLICT", canWrite: false } as never);
    const { planningCommand } = await import("../commands/planning.js");
    await planningCommand.parseAsync(["node", "planning", "gate", "report", "demo-book"], { from: "node" });
    expect(writeNextChapterMock).not.toHaveBeenCalled();
  });

  it("14 gate report has no --force / Write Anyway option", async () => {
    const { planningCommand } = await import("../commands/planning.js");
    const gate = planningCommand.commands.find((c) => c.name() === "gate");
    const report = gate?.commands.find((c) => c.name() === "report");
    if (report) {
      const opts = report.options.map((o) => o.long);
      expect(opts).not.toContain("--force");
      expect(opts).not.toContain("--write-anyway");
    } else {
      // fallback: gate itself has no force
      const opts = gate ? gate.options.map((o) => o.long) : [];
      expect(opts).not.toContain("--force");
    }
  });
});

describe("planning — book isolation & fail closed", () => {
  it("15 book isolation: successive calls scoped per bookId", async () => {
    const { planningCommand } = await import("../commands/planning.js");
    await planningCommand.parseAsync(["node", "planning", "arc", "status", "book-A"], { from: "node" });
    await planningCommand.parseAsync(["node", "planning", "arc", "status", "book-B"], { from: "node" });
    expect(getPublishedArcPlanMock).toHaveBeenCalledWith(expect.objectContaining({ bookId: "book-A" }));
    expect(getPublishedArcPlanMock).toHaveBeenCalledWith(expect.objectContaining({ bookId: "book-B" }));
    const calls = getPublishedArcPlanMock.mock.calls as Array<[Record<string, unknown>]>;
    expect(calls[0][0].bookId).not.toBe(calls[1][0].bookId);
  });

  it("16 errors fail closed (exit 1, no silent success)", async () => {
    getPublishedArcPlanMock.mockRejectedValue(new Error("book_not_found"));
    const { planningCommand } = await import("../commands/planning.js");
    await planningCommand.parseAsync(["node", "planning", "arc", "status", "missing-book"], { from: "node" });
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(logErrorMock).toHaveBeenCalled();
  });
});
