import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { gunzipSync } from "node:zlib";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveStoryGraph, StoryGraphSchema } from "@actalk/castor-core";
import { createStudioServer } from "../api/server.js";

const graph = StoryGraphSchema.parse({
  schemaVersion: 1, projectId: "demo", title: "Demo", variables: [],
  nodes: [
    { id: "s", type: "start", choices: [{ id: "c", text: "go", targetNodeId: "e" }] },
    { id: "e", type: "ending", choices: [] },
  ],
  endings: [{ id: "x", nodeId: "e", title: "end", type: "good" }],
});

describe("GET /api/v1/projects/:id/story-graph", () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "if-api-")); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("returns the saved story graph", async () => {
    await saveStoryGraph(root, "demo", graph);
    const app = createStudioServer({} as never, root);
    const res = await app.request("/api/v1/projects/demo/story-graph");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(graph);
  });

  it("returns 404 when missing", async () => {
    const app = createStudioServer({} as never, root);
    const res = await app.request("/api/v1/projects/nope/story-graph");
    expect(res.status).toBe(404);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 400 for a path-traversal id", async () => {
    const app = createStudioServer({} as never, root);
    const res = await app.request("/api/v1/projects/..%2Fsecret/story-graph");
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_ID");
  });

  it("exports an interactive-film project package", async () => {
    await saveStoryGraph(root, "demo", graph);
    await mkdir(join(root, "interactive-films", "demo"), { recursive: true });
    await writeFile(join(root, "interactive-films", "demo", "script.md"), "# Script\n", "utf-8");
    const app = createStudioServer({} as never, root);

    const res = await app.request("/api/v1/projects/demo/export");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/gzip");
    expect(res.headers.get("content-disposition")).toContain("demo.tar.gz");
    const body = Buffer.from(await res.arrayBuffer());
    const tar = gunzipSync(body);
    expect(tar.toString("utf-8")).toContain("demo/story-graph.json");
    expect(tar.toString("utf-8")).toContain("demo/script.md");
  });
});
