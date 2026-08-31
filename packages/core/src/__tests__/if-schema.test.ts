import { describe, expect, it } from "vitest";
import { StoryGraphSchema } from "../interactive-film/graph-schema.js";

const minimal = {
  schemaVersion: 1,
  projectId: "demo",
  title: "Demo",
  variables: [{ name: "trust", type: "counter", default: 0, desc: "mock_text" }],
  nodes: [
    { id: "n1", title: "Mo dau", type: "start", choices: [{ id: "c1", text: "mock_text", targetNodeId: "n2" }] },
    { id: "n2", title: "mock_text", type: "ending", choices: [] },
  ],
  endings: [{ id: "e1", nodeId: "n2", title: "mock_text", type: "good" }],
};

describe("StoryGraphSchema", () => {
  it("parses a minimal graph and applies defaults", () => {
    const g = StoryGraphSchema.parse(minimal);
    expect(g.nodes[0].choices[0].effects).toEqual([]);
    expect(g.nodes[0].sceneDesc).toBe("");
    expect(g.nodes[0].dialogue).toEqual([]);
    expect(g.endings[0].description).toBe("");
  });

  it("rejects an unknown schemaVersion", () => {
    expect(() => StoryGraphSchema.parse({ ...minimal, schemaVersion: 2 })).toThrow();
  });

  it("rejects a node with an invalid type", () => {
    const bad = { ...minimal, nodes: [{ id: "x", type: "bogus", choices: [] }] };
    expect(() => StoryGraphSchema.parse(bad)).toThrow();
  });
});
