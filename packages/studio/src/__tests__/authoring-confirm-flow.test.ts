import { describe, expect, it, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioServer } from "../api/server.js";
import { createAndPersistBookSession, loadStoryGraph } from "@actalk/castor-core";

const CASTOR_CONFIG = JSON.stringify({
  name: "test-project",
  version: "0.1.0",
  language: "zh",
  llm: { model: "test-model", provider: "anthropic" },
  notify: [],
});

describe("interactive-film-authoring confirm flow (stubbed LLM)", () => {
  let root: string;
  const prev = process.env.CASTOR_AGENT_LLM_STUB;
  beforeAll(() => { process.env.CASTOR_AGENT_LLM_STUB = "1"; });
  afterAll(() => {
    if (prev === undefined) delete process.env.CASTOR_AGENT_LLM_STUB;
    else process.env.CASTOR_AGENT_LLM_STUB = prev;
  });
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "if-confirm-"));
    await writeFile(join(root, "inkos.json"), CASTOR_CONFIG, "utf-8");
    await mkdir(join(root, "interactive-films", "p"), { recursive: true });
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("free-text proposes draft_structure, confirm creates the graph", async () => {
    const app = createStudioServer({} as never, root);
    const sessionId = "1000000000-test";
    const bookId = "p";

    // Pre-create the session so the agent endpoint can load it
    await createAndPersistBookSession(root, bookId, sessionId, "interactive-film-authoring");

    // Step 1: free-text instruction → stubbed agent proposes draft_structure via propose_action
    const propose = await app.request("/api/v1/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instruction: "帮我搭一个三幕结构",
        activeBookId: bookId,
        sessionKind: "interactive-film-authoring",
        actionSource: "free-text",
        sessionId,
      }),
    });
    expect(propose.status).toBe(200);

    // Step 2: confirm the proposed action → executeConfirmedProductionAction runs draft_structure
    // stubChatCompletion returns STRUCTURE_JSON (4 nodes) when prompt mentions "骨架/nodes/结构"
    const confirm = await app.request("/api/v1/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instruction: "搭建三幕分支结构",
        activeBookId: bookId,
        sessionKind: "interactive-film-authoring",
        actionSource: "button",
        requestedIntent: "draft_structure",
        actionPayload: { draftStructure: { instruction: "三幕分支结构", projectId: bookId } },
        sessionId,
      }),
    });
    expect(confirm.status).toBe(200);

    // Assert the story graph was created with at least 4 nodes
    const graph = await loadStoryGraph(root, bookId);
    expect(graph?.nodes.length).toBeGreaterThanOrEqual(4);
  });
});
