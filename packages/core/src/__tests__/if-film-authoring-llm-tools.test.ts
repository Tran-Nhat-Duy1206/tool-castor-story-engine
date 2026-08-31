import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFillNodeTool, createReviseNodeTool, type FilmLLMDeps } from "../agent/film-authoring-tools.js";
import { loadStoryGraph } from "../interactive-film/graph-store.js";
import { saveStoryGraph } from "../interactive-film/graph-store.js";
import { StoryGraphSchema, StoryNodeSchema } from "../interactive-film/graph-schema.js";

const node = StoryNodeSchema.parse({
  id: "n1",
  type: "branch",
  title: "Quyet dinh",
  sceneDesc: "Cong dien",
  dialogue: [{ speaker: "A Mei", text: "mock_text", emotion: "kien dinh" }],
  choices: [{ id: "a", text: "Cong khai", targetNodeId: "e" }],
});

function filmDeps(overrides: Partial<FilmLLMDeps> = {}): FilmLLMDeps {
  return {
    submitNode: async (_system, _user, nodeId) => ({ ...node, id: nodeId }),
    submitStructure: async () => [],
    ...overrides,
  };
}

describe("fill_node tool (stubbed LLM)", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "if-llm-"));
    await mkdir(join(root, "interactive-films", "p"), { recursive: true });
    await saveStoryGraph(root, "p", StoryGraphSchema.parse({ schemaVersion: 1, projectId: "p", title: "T", variables: [], nodes: [{ id: "n1", type: "branch", choices: [] }, { id: "e", type: "ending", choices: [] }], endings: [] }));
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("fills a node from stubbed LLM text and persists it", async () => {
    const tool = createFillNodeTool(root, "p", filmDeps({
      skillIds: () => ["castor-interactive-film"],
    }));
    const result = await tool.execute("call-1", { nodeId: "n1", instruction: "mock_textQuyet dinhmock_text" } as never);
    const g = await loadStoryGraph(root, "p");
    expect(g?.nodes.find(n => n.id === "n1")?.dialogue?.[0].speaker).toBe("A Mei");
    expect(result.details).toMatchObject({ skillIds: ["castor-interactive-film"] });
  });

  it("loads interactive-film script prompt-pack overrides and reports skill details", async () => {
    await mkdir(join(root, "prompt", "interactive-film"), { recursive: true });
    await writeFile(join(root, "prompt", "interactive-film", "script.md"), "PROJECT SCRIPT OVERRIDE: keep node dialogue short and playable.");
    let systemPrompt = "";
    const tool = createFillNodeTool(root, "p", filmDeps({
      submitNode: async (system, _user, nodeId) => {
        systemPrompt = system;
        return { ...node, id: nodeId };
      },
    }));

    const result = await tool.execute("call-1", { nodeId: "n1", instruction: "mock_textQuyet dinhmock_text" } as never);

    expect(systemPrompt).toContain("Prompt Pack Guidance");
    expect(systemPrompt).toContain("PROJECT SCRIPT OVERRIDE");
    expect(result.details).not.toHaveProperty("usedSkills");
    expect((result.details as any).promptPacks).toContain("interactive-film.script");
  });
});

describe("revise_node tool (stubbed LLM)", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "if-llm-rv-"));
    await mkdir(join(root, "interactive-films", "p"), { recursive: true });
    await saveStoryGraph(root, "p", StoryGraphSchema.parse({
      schemaVersion: 1, projectId: "p", title: "T", variables: [],
      nodes: [
        { id: "n1", type: "branch", sceneDesc: "mock_text", dialogue: [{ speaker: "mock_text", text: "mock_text", emotion: "mock_text" }], choices: [] },
        { id: "e", type: "ending", choices: [] },
      ],
      endings: [],
    }));
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("revises a node via stubbed LLM text and persists updated dialogue", async () => {
    const revised = StoryNodeSchema.parse({
      id: "n1",
      type: "branch",
      title: "mock_text",
      sceneDesc: "mock_text",
      dialogue: [{ speaker: "mock_text", text: "mock_text", emotion: "mock_text" }],
      choices: [{ id: "c1", text: "mock_text", targetNodeId: "e" }],
    });
    const tool = createReviseNodeTool(root, "p", filmDeps({
      submitNode: async (_system, _user, nodeId) => ({ ...revised, id: nodeId }),
    }));
    await tool.execute("call-2", { nodeId: "n1", instruction: "mock_text" } as never);
    const g = await loadStoryGraph(root, "p");
    const updated = g?.nodes.find(n => n.id === "n1");
    expect(updated?.dialogue?.[0].speaker).toBe("mock_text");
    expect(updated?.sceneDesc).toBe("mock_text");
  });
});
