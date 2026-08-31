import { describe, expect, it } from "vitest";
import { computePhaseProgress, computeStaleFlags } from "../lib/film-wizard-progress";
import { StoryGraphSchema } from "@actalk/castor-core";

const empty = StoryGraphSchema.parse({ schemaVersion: 1, projectId: "p", title: "", variables: [], nodes: [], endings: [] });
const full = StoryGraphSchema.parse({
  schemaVersion: 1, projectId: "p", title: "T",
  worldAnchor: { storyCore: "mock_val", theme: "mock_val", genre: "mock_val", worldRules: "", durationMinutes: 20 },
  characters: [{ id: "mei", name: "A Mei" }], variables: [],
  nodes: [
    { id: "s", type: "start", title: "Mo dau", sceneDesc: "mock_val", choices: [{ id: "c", text: "mock_val", targetNodeId: "e" }] },
    { id: "e", type: "ending", title: "mock_val", choices: [] },
  ],
  endings: [{ id: "g", nodeId: "e", title: "mock_val", type: "good" }],
});

describe("computePhaseProgress", () => {
  it("empty graph → all empty (scale always empty placeholder)", () => {
    const p = computePhaseProgress(empty);
    expect(p.world).toBe("empty");
    expect(p.structure).toBe("empty");
  });
  it("full graph → world done, structure done", () => {
    const p = computePhaseProgress(full);
    expect(p.world).toBe("done");        // worldAnchor.storyCore + a character
    expect(p.structure).toBe("done");    // start + ending + an edge
  });
});

describe("computeStaleFlags", () => {
  it("downstream phase visited at older rev than current → stale", () => {
    const flags = computeStaleFlags(full, { workshop: 1 }, 3);
    expect(flags.workshop).toBe(true);   // workshop recorded at rev1, graph now rev3, workshop non-empty
  });
  it("no recorded rev → not stale", () => {
    expect(computeStaleFlags(full, {}, 3).workshop).toBe(false);
  });
});
