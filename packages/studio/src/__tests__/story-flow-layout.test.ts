import { describe, expect, it } from "vitest";
import { layoutStoryGraph } from "../lib/story-flow-layout";
import { StoryGraphSchema } from "@actalk/castor-core";

const g = StoryGraphSchema.parse({
  schemaVersion: 1, projectId: "p", title: "T", variables: [],
  nodes: [
    { id: "s", type: "start", title: "开场", choices: [{ id: "c1", text: "A", targetNodeId: "m" }, { id: "c2", text: "B", targetNodeId: "ghost" }] },
    { id: "m", type: "branch", title: "中段", choices: [{ id: "c3", text: "go", targetNodeId: "e" }] },
    { id: "e", type: "ending", title: "结局", choices: [] },
  ],
  endings: [{ id: "g1", nodeId: "e", title: "end", type: "good" }],
});

describe("layoutStoryGraph", () => {
  it("positions nodes left-to-right by BFS depth", () => {
    const byId = Object.fromEntries(layoutStoryGraph(g).nodes.map((n) => [n.id, n]));
    expect(byId.s.position.x).toBe(0);
    expect(byId.m.position.x).toBeGreaterThan(byId.s.position.x);
    expect(byId.e.position.x).toBeGreaterThan(byId.m.position.x);
  });
  it("builds an edge per valid choice (with label) and skips dangling targets", () => {
    const edges = layoutStoryGraph(g).edges;
    const c1 = edges.find((e) => e.id === "s->c1");
    expect(c1).toBeDefined();
    expect(c1?.source).toBe("s");
    expect(c1?.target).toBe("m");
    expect(c1?.label).toBe("A");
    expect(edges.some((e) => e.target === "ghost")).toBe(false);
  });
  it("carries node type + label in data", () => {
    const nodes = layoutStoryGraph(g).nodes;
    expect(nodes.find((n) => n.id === "e")?.data.nodeType).toBe("ending");
    expect(nodes.find((n) => n.id === "s")?.data.label).toBe("开场");
  });
  it("places an unreachable node at a deeper column than reachable ones", () => {
    const g2 = StoryGraphSchema.parse({ ...g, nodes: [...g.nodes, { id: "island", type: "normal", title: "孤岛", choices: [] }] });
    const byId = Object.fromEntries(layoutStoryGraph(g2).nodes.map((n) => [n.id, n]));
    expect(byId.island.position.x).toBeGreaterThanOrEqual(byId.e.position.x);
  });
});
