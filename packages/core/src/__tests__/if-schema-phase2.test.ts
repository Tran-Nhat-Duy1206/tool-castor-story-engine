import { describe, expect, it } from "vitest";
import { StoryGraphSchema, CharacterSchema, WorldAnchorSchema } from "../interactive-film/graph-schema.js";

const phase1Graph = {
  schemaVersion: 1, projectId: "demo", title: "Demo", variables: [],
  nodes: [
    { id: "s", type: "start", choices: [{ id: "c", text: "go", targetNodeId: "e" }] },
    { id: "e", type: "ending", choices: [] },
  ],
  endings: [{ id: "x", nodeId: "e", title: "end", type: "good" }],
};

describe("StoryGraph schema phase-2 extensions", () => {
  it("parses a phase-1 graph with no worldAnchor/characters/act (defaults applied)", () => {
    const g = StoryGraphSchema.parse(phase1Graph);
    expect(g.characters).toEqual([]);
    expect(g.worldAnchor).toBeUndefined();
    expect(g.nodes[0].act).toBe("");
  });

  it("parses worldAnchor and characters with voiceProfile", () => {
    const g = StoryGraphSchema.parse({
      ...phase1Graph,
      worldAnchor: { storyCore: "mock_text", theme: "mock_text", genre: "mock_text", worldRules: "mock_text", durationMinutes: 30 },
      characters: [{ id: "mei", name: "A Mei", role: "protagonist", motivation: "Kiem tra so sach", voiceProfile: { speakingRhythm: "mock_text", vocabulary: "mock_text", sampleLines: ["mock_text"] } }],
    });
    expect(g.worldAnchor?.storyCore).toBe("mock_text");
    expect(g.characters[0].voiceProfile?.sampleLines).toEqual(["mock_text"]);
  });

  it("Character defaults role to other and voiceProfile fields", () => {
    const c = CharacterSchema.parse({ id: "x", name: "mock_text" });
    expect(c.role).toBe("other");
    expect(c.motivation).toBe("");
  });

  it("WorldAnchor applies string/number defaults", () => {
    const w = WorldAnchorSchema.parse({});
    expect(w.storyCore).toBe("");
    expect(w.durationMinutes).toBe(0);
  });

  it("keeps schemaVersion literal 1 (rejects 2)", () => {
    expect(() => StoryGraphSchema.parse({ ...phase1Graph, schemaVersion: 2 })).toThrow();
  });
});
