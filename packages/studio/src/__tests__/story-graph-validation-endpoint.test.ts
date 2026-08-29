import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioServer } from "../api/server.js";
import { saveStoryGraph, StoryGraphSchema } from "@actalk/castor-core";

describe("GET /api/v1/projects/:id/story-graph/validation", () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "if-val-")); await mkdir(join(root, "interactive-films", "p"), { recursive: true }); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("returns a report including IMAGE_MISSING for an imageless node", async () => {
    await saveStoryGraph(root, "p", StoryGraphSchema.parse({
      schemaVersion: 1, projectId: "p", title: "T", variables: [],
      nodes: [{ id: "s", type: "start", choices: [{ id: "c", text: "go", targetNodeId: "e" }] }, { id: "e", type: "ending", choices: [] }],
      endings: [{ id: "g1", nodeId: "e", title: "end", type: "good" }],
    }));
    const app = createStudioServer({} as never, root);
    const res = await app.request("/api/v1/projects/p/story-graph/validation");
    expect(res.status).toBe(200);
    const report = await res.json() as { ok: boolean; issues: { code: string }[] };
    expect(report.issues.map((i) => i.code)).toContain("IMAGE_MISSING");
  });

  it("404 when no graph, 400 for unsafe id", async () => {
    const app = createStudioServer({} as never, root);
    expect((await app.request("/api/v1/projects/nope/story-graph/validation")).status).toBe(404);
    expect((await app.request("/api/v1/projects/..%2Fx/story-graph/validation")).status).toBe(400);
  });
});
