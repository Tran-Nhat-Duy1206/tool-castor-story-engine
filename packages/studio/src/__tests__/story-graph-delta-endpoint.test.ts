import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioServer } from "../api/server.js";
import { loadStoryGraph } from "@actalk/castor-core";

describe("POST /api/v1/projects/:id/story-graph/delta", () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "if-delta-")); await mkdir(join(root, "interactive-films", "p"), { recursive: true }); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("applies a delta and returns the new rev", async () => {
    const app = createStudioServer({} as never, root);
    const res = await app.request("/api/v1/projects/p/story-graph/delta", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delta: { worldAnchor: { storyCore: "X" } } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { rev: number };
    expect(body.rev).toBe(1);
    expect((await loadStoryGraph(root, "p"))?.worldAnchor?.storyCore).toBe("X");
  });

  it("rejects an unsafe id with 400", async () => {
    const app = createStudioServer({} as never, root);
    const res = await app.request("/api/v1/projects/..%2Fx/story-graph/delta", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(res.status).toBe(400);
  });
});
