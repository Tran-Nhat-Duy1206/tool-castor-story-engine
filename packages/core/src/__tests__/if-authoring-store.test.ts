import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyGraphDelta, loadAuthoringState, revertToSnapshot } from "../interactive-film/authoring-store.js";
import { loadStoryGraph } from "../interactive-film/graph-store.js";
import { StoryGraphDeltaSchema } from "../interactive-film/delta.js";

const emptyTitleDelta = StoryGraphDeltaSchema.parse({ worldAnchor: { storyCore: "mock_textA" } });

describe("authoring-store", () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "if-auth-")); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("starts at phase=world rev=0 when nothing exists", async () => {
    expect(await loadAuthoringState(root, "p")).toEqual({ phase: "world", rev: 0 });
  });

  it("applies a delta onto an empty graph, persists graph + bumps rev", async () => {
    const { graph, rev } = await applyGraphDelta({
      projectRoot: root, projectId: "p",
      delta: StoryGraphDeltaSchema.parse({
        nodes: { upsert: [{ id: "s", type: "start", choices: [] }] },
        worldAnchor: { storyCore: "mock_textA" },
      }),
      phase: "structure",
    });
    expect(rev).toBe(1);
    expect(graph.nodes.map(n => n.id)).toEqual(["s"]);
    expect((await loadStoryGraph(root, "p"))?.worldAnchor?.storyCore).toBe("mock_textA");
    expect(await loadAuthoringState(root, "p")).toEqual({ phase: "structure", rev: 1 });
  });

  it("writes a snapshot before applying, and revert restores it", async () => {
    await applyGraphDelta({ projectRoot: root, projectId: "p", delta: StoryGraphDeltaSchema.parse({ worldAnchor: { storyCore: "v1" } }) });
    await applyGraphDelta({ projectRoot: root, projectId: "p", delta: StoryGraphDeltaSchema.parse({ worldAnchor: { storyCore: "v2" } }) });
    // snapshot 1 captured the state before the 2nd apply (storyCore v1)
    const reverted = await revertToSnapshot({ projectRoot: root, projectId: "p", rev: 1 });
    expect(reverted.worldAnchor?.storyCore).toBe("v1");
    const snaps = await readdir(join(root, "interactive-films", "p", "snapshots"));
    expect(snaps.length).toBeGreaterThanOrEqual(1);
  });

  it("serializes concurrent applyGraphDelta calls without losing updates", async () => {
    await Promise.all([
      applyGraphDelta({ projectRoot: root, projectId: "p", delta: StoryGraphDeltaSchema.parse({ variables: { upsert: [{ name: "a", type: "counter", default: 0, desc: "" }] } }) }),
      applyGraphDelta({ projectRoot: root, projectId: "p", delta: StoryGraphDeltaSchema.parse({ variables: { upsert: [{ name: "b", type: "counter", default: 0, desc: "" }] } }) }),
    ]);
    const graph = await loadStoryGraph(root, "p");
    expect(graph?.variables.map(v => v.name).sort()).toEqual(["a", "b"]); // both landed, no lost update
    const state = await loadAuthoringState(root, "p");
    expect(state.rev).toBe(2); // two distinct revs, not 1
  });
});
