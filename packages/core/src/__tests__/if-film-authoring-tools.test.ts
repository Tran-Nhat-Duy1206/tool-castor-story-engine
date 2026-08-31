import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSetWorldAnchorTool, createAddVariableTool, createDefineEndingTool, createUpsertCharactersTool } from "../agent/film-authoring-tools.js";
import { loadStoryGraph, saveStoryGraph } from "../interactive-film/graph-store.js";
import { MemoryDB } from "../state/memory-db.js";
import { StoryGraphSchema } from "../interactive-film/graph-schema.js";

const require = createRequire(import.meta.url);
const hasNodeSqlite = (() => {
  try {
    require("node:sqlite");
    return true;
  } catch {
    return false;
  }
})();
const sqliteIt = hasNodeSqlite ? it : it.skip;

describe("direct-write authoring tools", () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "if-tools-")); await mkdir(join(root, "interactive-films", "p"), { recursive: true }); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("set_world_anchor applies a delta and persists worldAnchor", async () => {
    const tool = createSetWorldAnchorTool(root, "p");
    const res = await tool.execute("call-1", { storyCore: "Kiem tra so sachmock_text", theme: "mock_text" } as never);
    expect((res.content[0] as { type: "text"; text: string }).text).toMatch(/world|mock_text|updated|rev/i);
    expect((await loadStoryGraph(root, "p"))?.worldAnchor?.storyCore).toBe("Kiem tra so sachmock_text");
  });

  it("add_variable applies a delta and persists the variable", async () => {
    const tool = createAddVariableTool(root, "p");
    await tool.execute("call-2", { name: "trust", type: "counter", default: 0, desc: "mock_text" } as never);
    expect((await loadStoryGraph(root, "p"))?.variables.map(v => v.name)).toContain("trust");
  });

  it("define_ending persists an ending referencing an existing node", async () => {
    // Seed a graph with node "e" so referential integrity check passes.
    const seed = StoryGraphSchema.parse({
      schemaVersion: 1,
      projectId: "p",
      title: "test",
      nodes: [{ id: "e", type: "ending" }],
    });
    await saveStoryGraph(root, "p", seed);

    const tool = createDefineEndingTool(root, "p");
    const res = await tool.execute("call-3", {
      id: "end-good",
      nodeId: "e",
      title: "mock_text",
      type: "good",
      description: "mock_text",
    } as never);

    expect((res.content[0] as { type: "text"; text: string }).text).toMatch(/mock_text|Ending|defined/i);
    const graph = await loadStoryGraph(root, "p");
    const ending = graph?.endings.find((e) => e.id === "end-good");
    expect(ending).toBeDefined();
    expect(ending?.nodeId).toBe("e");
    expect(ending?.type).toBe("good");
  });

  sqliteIt("upsert_characters persists character in graph and writes facts to MemoryDB", async () => {
    // MemoryDB needs the story sub-directory to exist for the sqlite file.
    await mkdir(join(root, "interactive-films", "p", "story"), { recursive: true });

    const tool = createUpsertCharactersTool(root, "p");
    await tool.execute("call-4", {
      characters: [{
        id: "mei",
        name: "A Mei",
        role: "protagonist",
        motivation: "Kiem tra so sachmock_text",
        voiceProfile: { speakingRhythm: "mock_text", vocabulary: "mock_text", sampleLines: ["mock_text！"] },
      }],
    } as never);

    // Assert character persisted in story graph.
    const graph = await loadStoryGraph(root, "p");
    const char = graph?.characters.find((c) => c.id === "mei");
    expect(char).toBeDefined();
    expect(char?.name).toBe("A Mei");

    // Assert fact written to MemoryDB.
    const db = new MemoryDB(join(root, "interactive-films", "p"));
    try {
      const facts = db.getFactsForCharacters(["A Mei"]);
      expect(facts.length).toBeGreaterThan(0);
      expect(facts.some((f) => f.subject === "A Mei")).toBe(true);
    } finally {
      db.close();
    }
  });
});
