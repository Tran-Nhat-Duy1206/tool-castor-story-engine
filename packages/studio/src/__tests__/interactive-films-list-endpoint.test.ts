import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioServer } from "../api/server.js";
import { saveStoryGraph, StoryGraphSchema } from "@actalk/castor-core";

describe("GET /api/v1/interactive-films", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "film-list-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("returns both seeded film projects sorted by title", async () => {
    await saveStoryGraph(
      root,
      "alpha",
      StoryGraphSchema.parse({
        schemaVersion: 1,
        projectId: "alpha",
        title: "Alpha Film",
        variables: [],
        nodes: [{ id: "s", type: "start", sceneDesc: "desc", choices: [] }],
        endings: [],
      }),
    );
    await saveStoryGraph(
      root,
      "beta",
      StoryGraphSchema.parse({
        schemaVersion: 1,
        projectId: "beta",
        title: "Beta Film",
        variables: [],
        nodes: [{ id: "s", type: "start", sceneDesc: "desc", choices: [] }],
        endings: [],
      }),
    );

    const app = createStudioServer({} as never, root);
    const res = await app.request("/api/v1/interactive-films");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { films: Array<{ projectId: string; title: string }> };
    expect(body.films).toHaveLength(2);
    expect(body.films.map((f) => f.projectId).sort()).toEqual(["alpha", "beta"]);
    expect(body.films.find((f) => f.projectId === "alpha")?.title).toBe("Alpha Film");
    expect(body.films.find((f) => f.projectId === "beta")?.title).toBe("Beta Film");
  });

  it("returns empty films array when interactive-films directory does not exist", async () => {
    const app = createStudioServer({} as never, root);
    const res = await app.request("/api/v1/interactive-films");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { films: unknown[] };
    expect(body.films).toEqual([]);
  });
});
