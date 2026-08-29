import { describe, expect, it } from "vitest";
import { computePhaseProgress, computeStaleFlags } from "../lib/film-wizard-progress";
import { StoryGraphSchema } from "@actalk/castor-core";

const empty = StoryGraphSchema.parse({ schemaVersion: 1, projectId: "p", title: "", variables: [], nodes: [], endings: [] });
const full = StoryGraphSchema.parse({
  schemaVersion: 1, projectId: "p", title: "T",
  worldAnchor: { storyCore: "核心", theme: "信任", genre: "宫斗", worldRules: "", durationMinutes: 20 },
  characters: [{ id: "mei", name: "阿梅" }], variables: [],
  nodes: [
    { id: "s", type: "start", title: "开场", sceneDesc: "宫门", choices: [{ id: "c", text: "去", targetNodeId: "e" }] },
    { id: "e", type: "ending", title: "结局", choices: [] },
  ],
  endings: [{ id: "g", nodeId: "e", title: "好", type: "good" }],
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
