import { describe, expect, it } from "vitest";
import { reviewStoryGraph } from "../interactive-film/validation.js";
import { StoryGraphSchema, type StoryGraph } from "../interactive-film/graph-schema.js";

function g(over: Partial<Record<string, unknown>>): StoryGraph {
  return StoryGraphSchema.parse({
    schemaVersion: 1, projectId: "t", title: "T", variables: [], nodes: [], endings: [], ...over,
  });
}
const codes = (graph: StoryGraph) => reviewStoryGraph(graph).issues.map((i) => i.code);

describe("reviewStoryGraph", () => {
  it("still surfaces Phase-1 gating issues (DEAD_END)", () => {
    const graph = g({ nodes: [{ id: "s", type: "start", choices: [] }] });
    expect(codes(graph)).toContain("DEAD_END");
  });

  it("VARIABLE_UNWRITTEN: condition reads a var nothing writes (warning)", () => {
    const graph = g({
      variables: [{ name: "trust", type: "counter", default: 0, desc: "" }],
      nodes: [
        { id: "s", type: "start", choices: [{ id: "c", text: "go", targetNodeId: "e", condition: { var: "trust", op: ">=", value: 1 } }] },
        { id: "e", type: "ending", imageSlot: { prompt: "p", assetRef: "x" }, choices: [] },
      ],
      endings: [{ id: "g1", nodeId: "e", title: "end", type: "good" }],
    });
    const issue = reviewStoryGraph(graph).issues.find((i) => i.code === "VARIABLE_UNWRITTEN");
    expect(issue?.level).toBe("warning");
    expect(issue?.message).toContain("trust");
  });

  it("VARIABLE_UNUSED: a declared var nothing writes or reads (info)", () => {
    // "phantom" is declared in variables[] but no effect writes it and no condition reads it
    // "gold" is a HUD meter: written by an effect, never read by a condition → must NOT trigger VARIABLE_UNUSED
    const graph = g({
      variables: [
        { name: "phantom", type: "counter", default: 0, desc: "" },
        { name: "gold", type: "counter", default: 0, desc: "" },
      ],
      nodes: [
        { id: "s", type: "start", imageSlot: { prompt: "p", assetRef: "x" }, choices: [{ id: "c", text: "go", targetNodeId: "e", effects: [{ var: "gold", op: "add", value: 1 }] }] },
        { id: "e", type: "ending", choices: [] },
      ],
      endings: [{ id: "g1", nodeId: "e", title: "end", type: "good" }],
    });
    const report = reviewStoryGraph(graph);
    const issue = report.issues.find((i) => i.code === "VARIABLE_UNUSED");
    expect(issue?.level).toBe("info");
    expect(issue?.message).toContain("phantom");
    // HUD display pattern: written by effect but never branched on → must NOT be flagged
    expect(report.issues.find((i) => i.code === "VARIABLE_UNUSED" && i.message.includes("gold"))).toBeUndefined();
  });

  it("ENDING_VARIETY: >=2 endings all same type (info)", () => {
    const graph = g({
      nodes: [
        { id: "s", type: "start", imageSlot: { prompt: "p", assetRef: "x" }, choices: [{ id: "a", text: "A", targetNodeId: "e1" }, { id: "b", text: "B", targetNodeId: "e2" }] },
        { id: "e1", type: "ending", choices: [] },
        { id: "e2", type: "ending", choices: [] },
      ],
      endings: [{ id: "g1", nodeId: "e1", title: "mock_text1", type: "good" }, { id: "g2", nodeId: "e2", title: "mock_text2", type: "good" }],
    });
    expect(codes(graph)).toContain("ENDING_VARIETY");
  });

  it("IMAGE_MISSING: a non-ending node without an image (info)", () => {
    const graph = g({
      nodes: [
        { id: "s", type: "start", choices: [{ id: "c", text: "go", targetNodeId: "e" }] }, // no imageSlot
        { id: "e", type: "ending", choices: [] },
      ],
      endings: [{ id: "g1", nodeId: "e", title: "end", type: "good" }],
    });
    const issue = reviewStoryGraph(graph).issues.find((i) => i.code === "IMAGE_MISSING");
    expect(issue?.nodeIds).toEqual(["s"]);
  });

  it("a clean, fully-configured graph yields no warning/info issues", () => {
    const graph = g({
      variables: [{ name: "trust", type: "counter", default: 0, desc: "" }],
      nodes: [
        { id: "s", type: "start", imageSlot: { prompt: "p", assetRef: "x" }, choices: [{ id: "c", text: "go", targetNodeId: "e", effects: [{ var: "trust", op: "add", value: 1 }] }] },
        { id: "e", type: "ending", choices: [] },
      ],
      endings: [{ id: "g1", nodeId: "e", title: "mock_text", type: "good" }, { id: "b1", nodeId: "e", title: "mock_text", type: "bad" }],
    });
    // trust is written; but never read -> VARIABLE_UNREAD would fire. To be truly clean, add a condition reading it:
    const graph2 = StoryGraphSchema.parse({ ...graph, nodes: [
      { id: "s", type: "start", imageSlot: { prompt: "p", assetRef: "x" }, choices: [{ id: "c", text: "go", targetNodeId: "e", effects: [{ var: "trust", op: "add", value: 1 }], condition: { var: "trust", op: ">=", value: 0 } }] },
      { id: "e", type: "ending", choices: [] },
    ]});
    const report = reviewStoryGraph(graph2);
    expect(report.issues.filter((i) => i.level !== "error")).toEqual([]); // no warning/info
    expect(report.ok).toBe(true);
  });
});
