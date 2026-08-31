import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NarrativeForecastAgent } from "../forecast/agent.js";
import {
  createNarrativeForecast,
  getNarrativeForecast,
  selectNarrativeBranch,
} from "../forecast/runner.js";
import type { AgentContext } from "../agents/base.js";
import {
  makeModelBranch,
  snapshotCanonicalFiles,
  writeForecastFixtureBook,
} from "./helpers/forecast-fixture.js";

const BOOK_ID = "demo-book";
const FIXED_NOW = () => new Date("2026-07-15T00:00:00Z");
const FIXED_ID = "fc-20260715-000000";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function runtime(projectRoot: string): AgentContext {
  return { client: { provider: "openai" } as never, model: "fake", projectRoot };
}

function stubBranches() {
  return [
    makeModelBranch({ title: "Chap nhan de nghi" }),
    makeModelBranch({
      title: "Tu choi de nghi",
      premise: "Gia dinh nhan vat chinh tu choi de nghi.",
      projectedChanges: {
        characters: ["Nhan vat chinh bi nghi ngo"],
        relationships: ["Quan he voi dong minh ran nut"],
        world: ["The luc doi thu manh len"],
        hooks: ["hook-03 kich hoat"],
      },
    }),
  ];
}

describe("narrative forecast runner", () => {
  let root: string;
  let bookDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "castor-forecast-run-"));
    bookDir = join(root, "books", BOOK_ID);
    await writeForecastFixtureBook(bookDir);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  function stubAgent() {
    return vi.spyOn(NarrativeForecastAgent.prototype, "generateBranches")
      .mockResolvedValue({ branches: stubBranches() });
  }

  function createOptions() {
    return {
      projectRoot: root,
      bookId: BOOK_ID,
      divergence: "Nhan vat chinh co chap nhan de nghi hop tac",
      branchCount: 2,
      horizon: 5,
      runtime: runtime(root),
      determinism: { now: FIXED_NOW },
    };
  }

  it("creates forecast.json and comparison.md with assigned branch ids", async () => {
    const spy = stubAgent();

    const result = await createNarrativeForecast(createOptions());

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.forecast.forecastId).toBe(FIXED_ID);
    expect(result.forecast.baseChapter).toBe(2);
    expect(result.forecast.status).toBe("active");
    expect(result.forecast.branches.map((branch) => branch.branchId)).toEqual(["branch-1", "branch-2"]);
    expect(result.forecast.createdAt).toBe("2026-07-15T00:00:00.000Z");

    const onDisk = JSON.parse(await readFile(result.forecastJsonPath, "utf-8"));
    expect(onDisk.contextFingerprint).toMatch(/^[0-9a-f]{64}$/);
    const comparison = await readFile(result.comparisonPath, "utf-8");
    expect(comparison).toContain("Chap nhan de nghi");
    expect(comparison).toContain("Tu choi de nghi");
  });

  it("keeps sibling branches isolated in the stored forecast", async () => {
    stubAgent();

    const result = await createNarrativeForecast(createOptions());

    const [first, second] = result.forecast.branches;
    expect(first?.projectedChanges.relationships).toEqual(["Nhan vat chinh va dong minh ran nut"]);
    expect(second?.projectedChanges.relationships).toEqual(["Quan he voi dong minh ran nut"]);
    expect(first?.beats).not.toBe(second?.beats);
  });

  it("does not modify any canonical file when creating a forecast", async () => {
    stubAgent();
    const before = await snapshotCanonicalFiles(bookDir);

    await createNarrativeForecast(createOptions());

    expect(await snapshotCanonicalFiles(bookDir)).toEqual(before);
  });

  it("leaves no forecast files behind when the model output is invalid", async () => {
    const chatSpy = vi.spyOn(
      NarrativeForecastAgent.prototype as unknown as { chat: () => Promise<{ content: string; usage: object }> },
      "chat",
    ).mockResolvedValue({ content: "not valid JSON", usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } });

    await expect(createNarrativeForecast(createOptions())).rejects.toThrow(/not valid JSON/);

    expect(chatSpy).toHaveBeenCalledTimes(2);
    expect(await exists(join(bookDir, "story", "runtime", "narrative-forecasts"))).toBe(false);
  });

  it("rejects out-of-range branch counts and horizons before calling the model", async () => {
    const spy = stubAgent();

    await expect(createNarrativeForecast({ ...createOptions(), branchCount: 1 })).rejects.toThrow(/branchCount/);
    await expect(createNarrativeForecast({ ...createOptions(), horizon: 0 })).rejects.toThrow(/horizon/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("reports a fresh forecast as active", async () => {
    stubAgent();
    await createNarrativeForecast(createOptions());

    const result = await getNarrativeForecast({ projectRoot: root, bookId: BOOK_ID, forecastId: FIXED_ID });

    expect(result.stale).toBe(false);
    expect(result.forecast.status).toBe("active");
  });

  it("marks a forecast stale after the canonical context changes", async () => {
    stubAgent();
    await createNarrativeForecast(createOptions());
    await writeFile(join(bookDir, "story", "state", "current_state.json"), JSON.stringify({ facts: ["mock_text"] }), "utf-8");

    const result = await getNarrativeForecast({ projectRoot: root, bookId: BOOK_ID, forecastId: FIXED_ID });

    expect(result.stale).toBe(true);
    const onDisk = JSON.parse(await readFile(result.forecastJsonPath, "utf-8"));
    expect(onDisk.status).toBe("stale");
  });

  it("marks a forecast stale after the story frame changes", async () => {
    stubAgent();
    await createNarrativeForecast(createOptions());
    await writeFile(join(bookDir, "story", "outline", "story_frame.md"), "# mock_text\nmock_text", "utf-8");

    const result = await getNarrativeForecast({ projectRoot: root, bookId: BOOK_ID, forecastId: FIXED_ID });

    expect(result.stale).toBe(true);
  });

  it("selects a branch by writing only selected-branch-plan.md", async () => {
    stubAgent();
    await createNarrativeForecast(createOptions());
    const forecastJsonPath = join(bookDir, "story", "runtime", "narrative-forecasts", FIXED_ID, "forecast.json");
    const forecastJsonBefore = await readFile(forecastJsonPath, "utf-8");
    const canonBefore = await snapshotCanonicalFiles(bookDir);

    const result = await selectNarrativeBranch({
      projectRoot: root,
      bookId: BOOK_ID,
      forecastId: FIXED_ID,
      branchId: "branch-2",
      determinism: { now: FIXED_NOW },
    });

    expect(result.branch.branchId).toBe("branch-2");
    const plan = await readFile(result.planPath, "utf-8");
    expect(plan).toContain("Tu choi de nghi");
    expect(plan).not.toContain("branch-1");
    expect(await readFile(forecastJsonPath, "utf-8")).toBe(forecastJsonBefore);
    expect(await snapshotCanonicalFiles(bookDir)).toEqual(canonBefore);
  });

  it("refuses to select a branch that does not exist", async () => {
    stubAgent();
    await createNarrativeForecast(createOptions());

    await expect(selectNarrativeBranch({
      projectRoot: root,
      bookId: BOOK_ID,
      forecastId: FIXED_ID,
      branchId: "branch-9",
    })).rejects.toThrow(/branch-9[\s\S]*branch-1, branch-2/);

    expect(await exists(join(
      bookDir, "story", "runtime", "narrative-forecasts", FIXED_ID, "selected-branch-plan.md",
    ))).toBe(false);
  });

  it("warns in the plan when selecting from a stale forecast", async () => {
    stubAgent();
    await createNarrativeForecast(createOptions());
    await writeFile(join(bookDir, "chapters", "0003_mock_text.md"), "Chương mock_text", "utf-8");

    const result = await selectNarrativeBranch({
      projectRoot: root,
      bookId: BOOK_ID,
      forecastId: FIXED_ID,
      branchId: "branch-1",
      determinism: { now: FIXED_NOW },
    });

    expect(result.stale).toBe(true);
    expect(await readFile(result.planPath, "utf-8")).toContain("⚠️ Bản suy diễn này đã cũ");
  });

  it("errors early when the book does not exist", async () => {
    await mkdir(join(root, "books"), { recursive: true });
    await expect(createNarrativeForecast({ ...createOptions(), bookId: "nope" })).rejects.toThrow(/nope/);
  });
});
