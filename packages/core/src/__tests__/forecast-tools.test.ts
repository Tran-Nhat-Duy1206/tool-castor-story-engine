import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createNarrativeForecastCreateTool,
  createNarrativeForecastGetTool,
  createNarrativeForecastSelectTool,
} from "../agent/forecast-tools.js";
import { NarrativeForecastAgent } from "../forecast/agent.js";
import type { AgentContext } from "../agents/base.js";
import type { PipelineRunner } from "../pipeline/runner.js";
import { makeModelBranch, writeForecastFixtureBook } from "./helpers/forecast-fixture.js";

const BOOK_ID = "demo-book";

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((piece) => piece.text ?? "").join("\n");
}

describe("narrative forecast agent tools", () => {
  let root: string;
  let bookDir: string;
  let pipeline: PipelineRunner;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "castor-forecast-tools-"));
    bookDir = join(root, "books", BOOK_ID);
    await writeForecastFixtureBook(bookDir);
    const runtime: AgentContext = { client: { provider: "openai" } as never, model: "fake", projectRoot: root };
    pipeline = { createAgentContext: () => runtime } as never;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  function stubAgent() {
    return vi.spyOn(NarrativeForecastAgent.prototype, "generateBranches").mockResolvedValue({
      branches: [makeModelBranch({ title: "Chap nhan de nghi" }), makeModelBranch({ title: "Tu choi de nghi" })],
    });
  }

  async function createForecast(): Promise<string> {
    stubAgent();
    const tool = createNarrativeForecastCreateTool(pipeline, BOOK_ID, root);
    const result = await tool.execute("call-1", { divergence: "mock_textChap nhan de nghi", branchCount: 2 });
    const details = result.details as { forecastId: string };
    return details.forecastId;
  }

  it("exposes the three tool names with required params", () => {
    const create = createNarrativeForecastCreateTool(pipeline, BOOK_ID, root);
    const get = createNarrativeForecastGetTool(BOOK_ID, root);
    const select = createNarrativeForecastSelectTool(BOOK_ID, root);

    expect(create.name).toBe("create_narrative_forecast");
    expect(get.name).toBe("get_narrative_forecast");
    expect(select.name).toBe("select_narrative_branch");
    expect(create.parameters.required).toContain("divergence");
    expect(get.parameters.required).toContain("forecastId");
    expect(select.parameters.required).toEqual(expect.arrayContaining(["forecastId", "branchId"]));
  });

  it("create returns an actionable branch overview and forecast id", async () => {
    stubAgent();
    const tool = createNarrativeForecastCreateTool(pipeline, BOOK_ID, root);

    const result = await tool.execute("call-1", { divergence: "mock_textChap nhan de nghi", branchCount: 2 });
    const text = textOf(result as never);

    expect(text).toMatch(/fc-/);
    expect(text).toContain("branch-1");
    expect(text).toContain("branch-2");
    expect(text).toContain("Chap nhan de nghi");
    expect(text).toContain("select_narrative_branch");
  });

  it("create rejects a bookId that does not match the active book", async () => {
    stubAgent();
    const tool = createNarrativeForecastCreateTool(pipeline, BOOK_ID, root);

    await expect(tool.execute("call-1", { bookId: "other-book", divergence: "mock_text" }))
      .rejects.toThrow(/active book/);
  });

  it("get reports staleness after canonical state changes", async () => {
    const forecastId = await createForecast();
    const tool = createNarrativeForecastGetTool(BOOK_ID, root);

    const fresh = textOf(await tool.execute("call-2", { forecastId }) as never);
    expect(fresh).toContain("active");

    await writeFile(join(bookDir, "story", "state", "current_state.json"), JSON.stringify({ facts: ["mock_text"] }), "utf-8");
    const stale = textOf(await tool.execute("call-3", { forecastId }) as never);
    expect(stale).toContain("stale");
  });

  it("select writes the plan and surfaces the path", async () => {
    const forecastId = await createForecast();
    const tool = createNarrativeForecastSelectTool(BOOK_ID, root);

    const text = textOf(await tool.execute("call-2", { forecastId, branchId: "branch-2" }) as never);

    expect(text).toContain("selected-branch-plan.md");
    expect(text).toContain("Tu choi de nghi");
  });

  it("select propagates a missing-branch error listing available branches", async () => {
    const forecastId = await createForecast();
    const tool = createNarrativeForecastSelectTool(BOOK_ID, root);

    await expect(tool.execute("call-2", { forecastId, branchId: "branch-9" }))
      .rejects.toThrow(/branch-1, branch-2/);
  });

  it("tools require a book when none is active", async () => {
    const tool = createNarrativeForecastGetTool(null, root);
    await expect(tool.execute("call-1", { forecastId: "fc-x" })).rejects.toThrow(/bookId/);
  });
});
