import { describe, expect, it } from "vitest";
import { reviewStoryGraph } from "../interactive-film/validation.js";
import { enumerateRuntimePaths } from "../interactive-film/paths.js";
import { StoryGraphSchema, type StoryGraph } from "../interactive-film/graph-schema.js";
const g = (over: Record<string, unknown>): StoryGraph => StoryGraphSchema.parse({ schemaVersion: 1, projectId: "p", title: "T", variables: [], nodes: [], endings: [], ...over });
const codes = (graph: StoryGraph) => reviewStoryGraph(graph).issues.map((i) => i.code);

describe("reviewStoryGraph new rules", () => {
  it("ENDING_UNREACHABLE: an ending no runtime path reaches", () => {
    const graph = g({
      variables: [{ name: "trust", type: "counter", default: 0, desc: "" }],
      nodes: [
        { id: "s", type: "start", choices: [{ id: "a", text: "mock_text", targetNodeId: "e2" }, { id: "b", text: "mock_text", targetNodeId: "e1", condition: { var: "trust", op: ">=", value: 9 } }] },
        { id: "e1", type: "ending", choices: [] }, // gated by trust>=9, never reachable (trust starts 0, never written)
        { id: "e2", type: "ending", choices: [] },
      ],
      endings: [{ id: "g1", nodeId: "e1", title: "mock_text", type: "good" }, { id: "b1", nodeId: "e2", title: "mock_text", type: "bad" }],
    });
    expect(codes(graph)).toContain("ENDING_UNREACHABLE");
  });

  it("LINEAR_GRAPH: start+normal nodes+ending but no branch node", () => {
    const graph = g({
      nodes: [
        { id: "s", type: "start", choices: [{ id: "c", text: "go", targetNodeId: "n1" }] },
        { id: "n1", type: "normal", choices: [{ id: "c2", text: "continue", targetNodeId: "n2" }] },
        { id: "n2", type: "normal", choices: [{ id: "c3", text: "end", targetNodeId: "e" }] },
        { id: "e", type: "ending", choices: [] },
      ],
      endings: [{ id: "g1", nodeId: "e", title: "mock_text", type: "good" }],
    });
    expect(codes(graph)).toContain("LINEAR_GRAPH");
  });

  it("ISOLATED_NODE: a non-start node with no incoming edge gets UNREACHABLE (from gate) but NOT ISOLATED_NODE (Fix 2 dedup)", () => {
    const graph = g({
      nodes: [
        { id: "s", type: "start", choices: [{ id: "c", text: "go", targetNodeId: "e" }] },
        { id: "e", type: "ending", choices: [] },
        { id: "orphan", type: "normal", choices: [] }, // nothing points to it
      ],
      endings: [{ id: "g1", nodeId: "e", title: "mock_text", type: "good" }],
    });
    const report = reviewStoryGraph(graph);
    const c = report.issues.map((i) => i.code);
    // The gate's BFS-based UNREACHABLE is more informative and already present
    expect(report.issues.some((i) => i.code === "UNREACHABLE" && i.nodeIds.includes("orphan"))).toBe(true);
    // ISOLATED_NODE must be suppressed for this node since UNREACHABLE already covers it
    expect(report.issues.some((i) => i.code === "ISOLATED_NODE" && i.nodeIds.includes("orphan"))).toBe(false);
  });

  it("ENDING_UNREACHABLE: gated ending yields exactly that code and NOT also GATED_UNREACHABLE", () => {
    const graph = g({
      variables: [{ name: "trust", type: "counter", default: 0, desc: "" }],
      nodes: [
        { id: "s", type: "start", choices: [{ id: "a", text: "mock_text", targetNodeId: "e2" }, { id: "b", text: "mock_text", targetNodeId: "e1", condition: { var: "trust", op: ">=", value: 9 } }] },
        { id: "e1", type: "ending", choices: [] }, // gated by trust>=9, never reachable
        { id: "e2", type: "ending", choices: [] },
      ],
      endings: [{ id: "g1", nodeId: "e1", title: "mock_text", type: "good" }, { id: "b1", nodeId: "e2", title: "mock_text", type: "bad" }],
    });
    const c = codes(graph);
    expect(c).toContain("ENDING_UNREACHABLE");
    expect(c).not.toContain("GATED_UNREACHABLE"); // Fix 1: ending deduplicated
    expect(c).not.toContain("ISOLATED_NODE");     // Fix 1: ending deduplicated
  });

  it("GATED_UNREACHABLE: normal node edge-reachable but behind an always-false condition", () => {
    const graph = g({
      variables: [{ name: "trust", type: "counter", default: 0, desc: "" }],
      nodes: [
        { id: "s", type: "start", choices: [
          { id: "a", text: "go", targetNodeId: "mid" },
          { id: "b", text: "unlock", targetNodeId: "locked", condition: { var: "trust", op: ">=", value: 9 } },
        ] },
        { id: "mid", type: "normal", choices: [{ id: "c", text: "end", targetNodeId: "e" }] },
        { id: "locked", type: "normal", choices: [{ id: "d", text: "end", targetNodeId: "e" }] }, // trust never written → never reachable at runtime
        { id: "e", type: "ending", choices: [] },
      ],
      endings: [{ id: "g1", nodeId: "e", title: "mock_text", type: "good" }],
    });
    const c = codes(graph);
    expect(c).toContain("GATED_UNREACHABLE");
    expect(c).not.toContain("ENDING_UNREACHABLE"); // ending "e" IS reachable via mid
  });

  it("ILLUSORY_BRANCH: branch node whose choices all target the same node with no effects", () => {
    const graph = g({
      nodes: [
        { id: "s", type: "start", choices: [{ id: "c", text: "go", targetNodeId: "branch" }] },
        { id: "branch", type: "normal", choices: [
          { id: "c1", text: "mock_textA", targetNodeId: "e" },
          { id: "c2", text: "mock_textB", targetNodeId: "e" }, // same target, no effects
        ] },
        { id: "e", type: "ending", choices: [] },
      ],
      endings: [{ id: "g1", nodeId: "e", title: "mock_text", type: "good" }],
    });
    expect(codes(graph)).toContain("ILLUSORY_BRANCH");
  });

  it("LONG_LINEAR_CHAIN: chain of 5 single-choice normal nodes fires", () => {
    const graph = g({
      nodes: [
        { id: "s", type: "start", choices: [{ id: "c0", text: "go", targetNodeId: "n1" }] },
        { id: "n1", type: "normal", choices: [{ id: "c1", text: "next", targetNodeId: "n2" }] },
        { id: "n2", type: "normal", choices: [{ id: "c2", text: "next", targetNodeId: "n3" }] },
        { id: "n3", type: "normal", choices: [{ id: "c3", text: "next", targetNodeId: "n4" }] },
        { id: "n4", type: "normal", choices: [{ id: "c4", text: "next", targetNodeId: "n5" }] },
        { id: "n5", type: "normal", choices: [{ id: "c5", text: "end", targetNodeId: "e" }] },
        { id: "e", type: "ending", choices: [] },
      ],
      endings: [{ id: "g1", nodeId: "e", title: "mock_text", type: "good" }],
    });
    expect(codes(graph)).toContain("LONG_LINEAR_CHAIN");
  });

  it("LONG_LINEAR_CHAIN: chain of 4 single-choice normal nodes does NOT fire", () => {
    const graph = g({
      nodes: [
        { id: "s", type: "start", choices: [{ id: "c0", text: "go", targetNodeId: "n1" }] },
        { id: "n1", type: "normal", choices: [{ id: "c1", text: "next", targetNodeId: "n2" }] },
        { id: "n2", type: "normal", choices: [{ id: "c2", text: "next", targetNodeId: "n3" }] },
        { id: "n3", type: "normal", choices: [{ id: "c3", text: "next", targetNodeId: "n4" }] },
        { id: "n4", type: "normal", choices: [{ id: "c4", text: "end", targetNodeId: "e" }] },
        { id: "e", type: "ending", choices: [] },
      ],
      endings: [{ id: "g1", nodeId: "e", title: "mock_text", type: "good" }],
    });
    expect(codes(graph)).not.toContain("LONG_LINEAR_CHAIN");
  });

  it("truncated enumeration (>200 paths): no false GATED_UNREACHABLE or ENDING_UNREACHABLE (Fix 1)", () => {
    // 8 binary-branch nodes (b0..b7), each with 2 choices both targeting the next node.
    // Start (s) → b0 → b1 → ... → b7 → ending (e).
    // Total paths = 2^8 = 256 > 200, so enumeration truncates.
    // After truncation, reachedNodeIds is incomplete — neither GATED_UNREACHABLE nor
    // ENDING_UNREACHABLE should fire because we cannot soundly assert unreachability.
    const branchNodes = Array.from({ length: 8 }, (_, i) => ({
      id: `b${i}`,
      type: "normal" as const,
      choices: [
        { id: `b${i}c1`, text: "A", targetNodeId: i < 7 ? `b${i + 1}` : "e" },
        { id: `b${i}c2`, text: "B", targetNodeId: i < 7 ? `b${i + 1}` : "e" },
      ],
    }));
    const graph = g({
      nodes: [
        { id: "s", type: "start", choices: [{ id: "sc", text: "start", targetNodeId: "b0" }] },
        ...branchNodes,
        { id: "e", type: "ending", choices: [] },
      ],
      endings: [{ id: "end1", nodeId: "e", title: "mock_text", type: "good" }],
    });

    // Confirm enumeration truncates
    const { truncated } = enumerateRuntimePaths(graph);
    expect(truncated).toBe(true);

    // Confirm neither reachability rule fires (Fix 1)
    const c = codes(graph);
    expect(c).not.toContain("GATED_UNREACHABLE");
    expect(c).not.toContain("ENDING_UNREACHABLE");
  });

  it("clean branching graph → none of the new codes", () => {
    const graph = g({
      nodes: [
        { id: "s", type: "start", imageSlot: { prompt: "p", assetRef: "x" }, choices: [{ id: "a", text: "A", targetNodeId: "e1" }, { id: "b", text: "B", targetNodeId: "e2" }] },
        { id: "e1", type: "ending", choices: [] }, { id: "e2", type: "ending", choices: [] },
      ],
      endings: [{ id: "g1", nodeId: "e1", title: "mock_text", type: "good" }, { id: "b1", nodeId: "e2", title: "mock_text", type: "bad" }],
    });
    const c = codes(graph);
    for (const code of ["GATED_UNREACHABLE","ENDING_UNREACHABLE","ILLUSORY_BRANCH","LINEAR_GRAPH","ISOLATED_NODE","LONG_LINEAR_CHAIN"]) {
      expect(c).not.toContain(code);
    }
  });
});
