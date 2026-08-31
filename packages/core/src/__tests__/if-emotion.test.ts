import { describe, expect, it } from "vitest";
import { emotionScore, nodeEmotion, analyzeEmotionalArcs, analyzePathDistribution } from "../interactive-film/emotion.js";
import { StoryNodeSchema, StoryGraphSchema, type StoryGraph } from "../interactive-film/graph-schema.js";

describe("emotion analysis", () => {
  it("emotionScore: positive vs negative vs unknown", () => {
    expect(emotionScore("vui vẻ")).toBeGreaterThan(0);
    expect(emotionScore("sad")).toBeLessThan(0);
    expect(emotionScore("zzzUnknownWord")).toBe(0);
  });
  it("emotionScore: negation prefix flips valence", () => {
    expect(emotionScore("không vui")).toBeLessThanOrEqual(0);
    expect(emotionScore("vui")).toBeGreaterThan(0);
    expect(emotionScore("chưa vui")).toBeLessThanOrEqual(0);
    expect(emotionScore("not happy")).toBeLessThanOrEqual(0);
  });
  it("nodeEmotion averages dialogue emotions", () => {
    const node = StoryNodeSchema.parse({ id: "n", type: "branch", dialogue: [{ speaker: "a", text: "x", emotion: "vui vẻ" }, { speaker: "b", text: "y", emotion: "sad" }], choices: [] });
    expect(typeof nodeEmotion(node)).toBe("number");
  });
  it("analyzeEmotionalArcs returns a point series per path", () => {
    const graph: StoryGraph = StoryGraphSchema.parse({
      schemaVersion: 1, projectId: "p", title: "T", variables: [],
      nodes: [
        { id: "s", type: "start", dialogue: [{ speaker: "a", text: "x", emotion: "hope" }], choices: [{ id: "c", text: "go", targetNodeId: "e" }] },
        { id: "e", type: "ending", dialogue: [{ speaker: "a", text: "y", emotion: "joy" }], choices: [] },
      ],
      endings: [{ id: "g1", nodeId: "e", title: "Good End", type: "good" }],
    });
    const { arcs } = analyzeEmotionalArcs(graph);
    expect(arcs.length).toBe(1);
    expect(arcs[0].points.map((p) => p.nodeId)).toEqual(["s", "e"]);
  });
  it("analyzePathDistribution counts paths by ending + length", () => {
    const graph: StoryGraph = StoryGraphSchema.parse({
      schemaVersion: 1, projectId: "p", title: "T", variables: [],
      nodes: [
        { id: "s", type: "start", choices: [{ id: "a", text: "A", targetNodeId: "e1" }, { id: "b", text: "B", targetNodeId: "e2" }] },
        { id: "e1", type: "ending", choices: [] }, { id: "e2", type: "ending", choices: [] },
      ],
      endings: [{ id: "g1", nodeId: "e1", title: "Good End", type: "good" }, { id: "b1", nodeId: "e2", title: "Bad End", type: "bad" }],
    });
    const d = analyzePathDistribution(graph);
    expect(d.total).toBe(2);
    expect(d.byEnding.g1).toBe(1);
    expect(d.byEnding.b1).toBe(1);
  });
});
