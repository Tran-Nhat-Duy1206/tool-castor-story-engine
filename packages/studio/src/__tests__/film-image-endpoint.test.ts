import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioServer } from "../api/server.js";
import { saveStoryGraph, loadStoryGraph, StoryGraphSchema } from "@actalk/castor-core";

const PNG = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);

describe("POST /api/v1/projects/:id/nodes/:nodeId/image", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "if-imgep-"));
    await mkdir(join(root, "interactive-films", "p"), { recursive: true });
    await saveStoryGraph(root, "p", StoryGraphSchema.parse({ schemaVersion: 1, projectId: "p", title: "T", variables: [], nodes: [{ id: "s", type: "start", sceneDesc: "Cong dien", choices: [] }], endings: [] }));
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("generates (stubbed) and writes assetRef back", async () => {
    const app = createStudioServer({} as never, root, { nodeImageGenerator: { generateImage: async () => ({ buffer: PNG, extension: "png" }) } });
    const res = await app.request("/api/v1/projects/p/nodes/s/image", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json() as { assetRef: string; rev: number };
    expect(body.assetRef).toBe("interactive-films/p/assets/nodes/s.png");
    expect((await loadStoryGraph(root, "p"))?.nodes.find(n => n.id === "s")?.imageSlot?.assetRef).toBe(body.assetRef);
  });

  it("404 for a missing node; 400 for an unsafe id", async () => {
    const app = createStudioServer({} as never, root, { nodeImageGenerator: { generateImage: async () => ({ buffer: PNG, extension: "png" }) } });
    expect((await app.request("/api/v1/projects/p/nodes/ghost/image", { method: "POST" })).status).toBe(404);
    expect((await app.request("/api/v1/projects/..%2Fx/nodes/s/image", { method: "POST" })).status).toBe(400);
  });
});
