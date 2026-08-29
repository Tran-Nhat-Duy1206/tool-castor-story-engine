import { describe, expect, it } from "vitest";
import { layoutStoryGraph } from "../lib/story-flow-layout";
import { StoryGraphSchema } from "@actalk/castor-core";

describe("layoutStoryGraph respects stored position", () => {
  it("uses node.position when present, BFS otherwise", () => {
    const g = StoryGraphSchema.parse({
      schemaVersion: 1, projectId: "p", title: "T", variables: [],
      nodes: [
        { id: "s", type: "start", choices: [{ id: "c", text: "go", targetNodeId: "e" }], position: { x: 999, y: 7 } },
        { id: "e", type: "ending", choices: [] }, // no position -> BFS
      ],
      endings: [{ id: "g1", nodeId: "e", title: "end", type: "good" }],
    });
    const byId = Object.fromEntries(layoutStoryGraph(g).nodes.map((n) => [n.id, n]));
    expect(byId.s.position).toEqual({ x: 999, y: 7 });   // stored
    expect(byId.e.position.x).toBeGreaterThan(0);          // BFS-derived (depth 1)
  });
});
