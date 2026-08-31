import { describe, expect, it } from "vitest";
import { applyStoryGraphDelta, StoryGraphDeltaSchema } from "../interactive-film/delta.js";
import { StoryGraphSchema, type StoryGraph } from "../interactive-film/graph-schema.js";

function baseGraph(): StoryGraph {
  return StoryGraphSchema.parse({
    schemaVersion: 1, projectId: "t", title: "T",
    variables: [{ name: "trust", type: "counter", default: 0, desc: "" }],
    nodes: [
      { id: "s", type: "start", choices: [{ id: "c", text: "go", targetNodeId: "e" }] },
      { id: "e", type: "ending", choices: [] },
    ],
    endings: [{ id: "x", nodeId: "e", title: "end", type: "good" }],
  });
}

describe("applyStoryGraphDelta", () => {
  it("merges worldAnchor as a patch without dropping other fields", () => {
    const g = applyStoryGraphDelta({
      graph: { ...baseGraph(), worldAnchor: { storyCore: "A", theme: "T", genre: "G", worldRules: "R", durationMinutes: 10 } },
      delta: StoryGraphDeltaSchema.parse({ worldAnchor: { theme: "T2" } }),
    });
    expect(g.worldAnchor).toEqual({ storyCore: "A", theme: "T2", genre: "G", worldRules: "R", durationMinutes: 10 });
  });

  it("upserts a node by id and does not mutate input", () => {
    const input = baseGraph();
    const g = applyStoryGraphDelta({
      graph: input,
      delta: StoryGraphDeltaSchema.parse({ nodes: { upsert: [{ id: "s", type: "start", title: "mock_textMo dau", choices: [{ id: "c", text: "go", targetNodeId: "e" }] }] } }),
    });
    expect(g.nodes.find(n => n.id === "s")?.title).toBe("mock_textMo dau");
    expect(input.nodes.find(n => n.id === "s")?.title).toBe(""); // unchanged
  });

  it("removes a variable by name and a node by id", () => {
    const g = applyStoryGraphDelta({
      graph: baseGraph(),
      delta: StoryGraphDeltaSchema.parse({ variables: { remove: ["trust"] } }),
    });
    expect(g.variables).toHaveLength(0);
  });

  it("upserts a character", () => {
    const g = applyStoryGraphDelta({
      graph: baseGraph(),
      delta: StoryGraphDeltaSchema.parse({ characters: { upsert: [{ id: "mei", name: "A Mei" }] } }),
    });
    expect(g.characters.map(c => c.id)).toEqual(["mei"]);
  });

  it("throws when an ending references a missing node", () => {
    expect(() => applyStoryGraphDelta({
      graph: baseGraph(),
      delta: StoryGraphDeltaSchema.parse({ endings: { upsert: [{ id: "bad", nodeId: "ghost", title: "x", type: "bad" }] } }),
    })).toThrow(/ghost/);
  });

  it("empty delta returns an equivalent graph", () => {
    const g = applyStoryGraphDelta({ graph: baseGraph(), delta: StoryGraphDeltaSchema.parse({}) });
    expect(g).toEqual(baseGraph());
  });
});
