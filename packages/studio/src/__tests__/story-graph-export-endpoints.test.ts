import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioServer } from "../api/server.js";
import { saveStoryGraph, StoryGraphSchema } from "@actalk/castor-core";

const PNG = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);

describe("export endpoints", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "if-exp-"));
    const dir = join(root, "interactive-films", "p", "assets", "nodes");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "s.png"), PNG);
    await saveStoryGraph(root, "p", StoryGraphSchema.parse({
      schemaVersion: 1, projectId: "p", title: "T", variables: [],
      nodes: [
        { id: "s", type: "start", title: "Mo dau", imageSlot: { prompt: "x", assetRef: "interactive-films/p/assets/nodes/s.png" }, choices: [{ id: "c", text: "go", targetNodeId: "e" }] },
        { id: "e", type: "ending", title: "mock_val", choices: [] },
      ],
      endings: [{ id: "g1", nodeId: "e", title: "mock_val", type: "good" }],
    }));
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("json export", async () => {
    const app = createStudioServer({} as never, root);
    const res = await app.request("/api/v1/projects/p/export/json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("attachment");
    const body = await res.json() as { projectId: string };
    expect(body.projectId).toBe("p");
  });
  it("ink export", async () => {
    const app = createStudioServer({} as never, root);
    const res = await app.request("/api/v1/projects/p/export/ink");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("=== node_s ===");
  });
  it("html export inlines the image as base64 + is self-contained", async () => {
    const app = createStudioServer({} as never, root);
    const res = await app.request("/api/v1/projects/p/export/html");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<!doctype html>");
    expect(html).toMatch(/data:image\/png;base64,/); // image inlined
  });
  it("exports projects with non-ascii ids without invalid response headers", async () => {
    const id = "Testmock_val";
    const dir = join(root, "interactive-films", id, "assets", "nodes");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "s.png"), PNG);
    await saveStoryGraph(root, id, StoryGraphSchema.parse({
      schemaVersion: 1, projectId: id, title: "mock_val", variables: [],
      nodes: [
        { id: "s", type: "start", title: "Mo dau", imageSlot: { prompt: "x", assetRef: `interactive-films/${id}/assets/nodes/s.png` }, choices: [{ id: "c", text: "go", targetNodeId: "e" }] },
        { id: "e", type: "ending", title: "mock_val", choices: [] },
      ],
      endings: [{ id: "g1", nodeId: "e", title: "mock_val", type: "good" }],
    }));

    const app = createStudioServer({} as never, root);
    for (const fmt of ["json", "ink", "html"] as const) {
      const res = await app.request(`/api/v1/projects/${encodeURIComponent(id)}/export/${fmt}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-disposition")).toContain("attachment");
    }
  });
  it("404 no graph, 400 unsafe id", async () => {
    const app = createStudioServer({} as never, root);
    expect((await app.request("/api/v1/projects/nope/export/json")).status).toBe(404);
    expect((await app.request("/api/v1/projects/..%2Fx/export/html")).status).toBe(400);
  });
});
