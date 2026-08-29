import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioServer } from "../api/server.js";
import { saveStoryGraph, StoryGraphSchema } from "@actalk/castor-core";

describe("GET /api/v1/projects/:id/story-graph/analysis", () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "if-an-")); await mkdir(join(root, "interactive-films", "p"), { recursive: true }); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("returns report + arcs + distribution", async () => {
    await saveStoryGraph(root, "p", StoryGraphSchema.parse({
      schemaVersion: 1, projectId: "p", title: "T", variables: [],
      nodes: [
        { id: "s", type: "start", choices: [{ id: "a", text: "A", targetNodeId: "e1" }, { id: "b", text: "B", targetNodeId: "e2" }] },
        { id: "e1", type: "ending", choices: [] }, { id: "e2", type: "ending", choices: [] },
      ],
      endings: [{ id: "g1", nodeId: "e1", title: "好", type: "good" }, { id: "b1", nodeId: "e2", title: "坏", type: "bad" }],
    }));
    const app = createStudioServer({} as never, root);
    const res = await app.request("/api/v1/projects/p/story-graph/analysis");
    expect(res.status).toBe(200);
    const body = await res.json() as { report: { issues: unknown[] }; arcs: { arcs: unknown[] }; distribution: { total: number } };
    expect(Array.isArray(body.report.issues)).toBe(true);
    expect(body.distribution.total).toBe(2);
  });

  it("404 no graph, 400 unsafe id", async () => {
    const app = createStudioServer({} as never, root);
    expect((await app.request("/api/v1/projects/nope/story-graph/analysis")).status).toBe(404);
    expect((await app.request("/api/v1/projects/..%2Fx/story-graph/analysis")).status).toBe(400);
  });
});
