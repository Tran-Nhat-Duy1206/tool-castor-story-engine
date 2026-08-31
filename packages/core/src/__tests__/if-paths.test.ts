import { describe, expect, it } from "vitest";
import { enumerateRuntimePaths } from "../interactive-film/paths.js";
import { StoryGraphSchema, type StoryGraph } from "../interactive-film/graph-schema.js";

function g(over: Record<string, unknown>): StoryGraph {
  return StoryGraphSchema.parse({ schemaVersion: 1, projectId: "p", title: "T", variables: [], nodes: [], endings: [], ...over });
}

describe("enumerateRuntimePaths", () => {
  it("enumerates both branches to two endings", () => {
    const graph = g({
      nodes: [
        { id: "s", type: "start", choices: [{ id: "a", text: "mock_text", targetNodeId: "e1" }, { id: "b", text: "mock_text", targetNodeId: "e2" }] },
        { id: "e1", type: "ending", choices: [] },
        { id: "e2", type: "ending", choices: [] },
      ],
      endings: [{ id: "g1", nodeId: "e1", title: "mock_text", type: "good" }, { id: "b1", nodeId: "e2", title: "mock_text", type: "bad" }],
    });
    const { paths } = enumerateRuntimePaths(graph);
    expect(paths.length).toBe(2);
    expect(paths.map((p) => p.endingId).sort()).toEqual(["b1", "g1"]);
    expect(paths.every((p) => p.nodeIds[0] === "s")).toBe(true);
  });

  it("respects variable-gated choices (hidden when condition unmet)", () => {
    const graph = g({
      variables: [{ name: "trust", type: "counter", default: 0, desc: "" }],
      nodes: [
        { id: "s", type: "start", choices: [
          { id: "a", text: "mock_text", targetNodeId: "e1", condition: { var: "trust", op: ">=", value: 1 } },
          { id: "b", text: "mock_text", targetNodeId: "e2" },
        ] },
        { id: "e1", type: "ending", choices: [] },
        { id: "e2", type: "ending", choices: [] },
      ],
      endings: [{ id: "g1", nodeId: "e1", title: "mock_text", type: "good" }, { id: "b1", nodeId: "e2", title: "mock_text", type: "bad" }],
    });
    const { paths } = enumerateRuntimePaths(graph);
    // trust starts 0, choice a hidden → only the path to e2
    expect(paths.length).toBe(1);
    expect(paths[0].endingId).toBe("b1");
  });

  it("guards against cycles and truncates at maxPaths", () => {
    const graph = g({
      nodes: [
        { id: "s", type: "start", choices: [{ id: "c", text: "loop", targetNodeId: "s" }, { id: "d", text: "out", targetNodeId: "e" }] },
        { id: "e", type: "ending", choices: [] },
      ],
      endings: [{ id: "g1", nodeId: "e", title: "mock_text", type: "good" }],
    });
    const { paths } = enumerateRuntimePaths(graph, { maxPaths: 50 });
    // cycle guard: 's' not re-entered in a single path → finite; the 'out' path reaches e
    expect(paths.some((p) => p.endingId === "g1")).toBe(true);
    expect(paths.length).toBeLessThanOrEqual(50);
  });

  it("allows state-changing loops to unlock later choices", () => {
    const graph = g({
      variables: [{ name: "clue", type: "counter", default: 0, desc: "" }],
      nodes: [
        { id: "s", type: "start", choices: [
          { id: "search", text: "mock_text", targetNodeId: "s", effects: [{ var: "clue", op: "add", value: 1 }] },
          { id: "solve", text: "mock_text", targetNodeId: "e", condition: { var: "clue", op: ">=", value: 2 } },
        ] },
        { id: "e", type: "ending", choices: [] },
      ],
      endings: [{ id: "truth", nodeId: "e", title: "Su that", type: "good" }],
    });
    const { paths, truncated } = enumerateRuntimePaths(graph, { maxPaths: 20 });
    expect(truncated).toBe(true);
    expect(paths.some((p) => p.endingId === "truth" && p.nodeIds.filter((id) => id === "s").length >= 3)).toBe(true);
  });

  it("sets truncated=true and returns exactly 1 path when maxPaths=1 and graph has 2 reachable endings", () => {
    const graph = g({
      nodes: [
        { id: "s", type: "start", choices: [
          { id: "a", text: "A", targetNodeId: "e1" },
          { id: "b", text: "B", targetNodeId: "e2" },
        ] },
        { id: "e1", type: "ending", choices: [] },
        { id: "e2", type: "ending", choices: [] },
      ],
      endings: [
        { id: "g1", nodeId: "e1", title: "mock_text", type: "good" },
        { id: "b1", nodeId: "e2", title: "mock_text", type: "bad" },
      ],
    });
    const { paths, truncated } = enumerateRuntimePaths(graph, { maxPaths: 1 });
    expect(truncated).toBe(true);
    expect(paths.length).toBe(1);
  });

  it("returns paths=[] and truncated=false when graph has no start node", () => {
    const graph = g({
      nodes: [
        { id: "e1", type: "ending", choices: [] },
      ],
      endings: [{ id: "g1", nodeId: "e1", title: "mock_text", type: "good" }],
    });
    const { paths, truncated } = enumerateRuntimePaths(graph);
    expect(paths.length).toBe(0);
    expect(truncated).toBe(false);
  });

  it("records a dead-end normal node (no choices, no ending) as a path with endingId=null ending at that node", () => {
    const graph = g({
      nodes: [
        { id: "s", type: "start", choices: [{ id: "a", text: "mock_text", targetNodeId: "d" }] },
        { id: "d", type: "normal", choices: [] },
      ],
    });
    const { paths } = enumerateRuntimePaths(graph);
    const deadEndPath = paths.find((p) => p.endingId === null);
    expect(deadEndPath).toBeDefined();
    expect(deadEndPath!.nodeIds.at(-1)).toBe("d");
  });
});
