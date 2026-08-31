import { describe, expect, it } from "vitest";
import { summarizeStoryGraph, buildFilmAuthoringContext } from "../interactive-film/film-context.js";
import { StoryGraphSchema, type StoryGraph } from "../interactive-film/graph-schema.js";

const graph: StoryGraph = StoryGraphSchema.parse({
  schemaVersion: 1, projectId: "p", title: "mock_text",
  worldAnchor: { storyCore: "Kiem tra so sachmock_text", theme: "mock_text", genre: "mock_text", worldRules: "mock_text", durationMinutes: 30 },
  characters: [{ id: "mei", name: "A Mei", role: "protagonist", motivation: "Kiem tra so sach", voiceProfile: { speakingRhythm: "mock_text", vocabulary: "mock_text", sampleLines: [] } }],
  variables: [{ name: "trust", type: "counter", default: 0, desc: "" }],
  nodes: [
    { id: "s", type: "start", title: "Mo dau", choices: [{ id: "c", text: "mock_text", targetNodeId: "e" }] },
    { id: "e", type: "ending", title: "Su that", choices: [] },
  ],
  endings: [{ id: "g", nodeId: "e", title: "Su thatmock_text", type: "good", description: "" }],
});

describe("film-context", () => {
  it("summary mentions title, a node with its choice target, and variables", () => {
    const s = summarizeStoryGraph(graph);
    expect(s).toContain("mock_text");
    expect(s).toContain("s");
    expect(s).toContain("e");      // choice target
    expect(s).toContain("trust");
  });
  it("authoring context includes character voice line", () => {
    const ctx = buildFilmAuthoringContext(graph);
    expect(ctx).toContain("A Mei");
    expect(ctx).toContain("mock_text");
  });
});
