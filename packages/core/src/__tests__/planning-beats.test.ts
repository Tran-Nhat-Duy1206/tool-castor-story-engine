import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  evaluateBeatFromCanon,
  evaluateBeatState,
  type BeatEvaluationEvidence,
  type BeatRef,
} from "../planning/beats.js";

let root = "";
let bookDir = "";
const canonPath = () => join(bookDir, "story", "state", "manifest.json");

function requiredBeat(beatId = "beat-req-1", category: BeatRef["category"] = "event"): BeatRef {
  return {
    beatId,
    category,
    importance: "required",
    description: "Discover the forbidden library in the castle",
  };
}

function optionalBeat(beatId = "beat-opt-1", category: BeatRef["category"] = "relationship_change"): BeatRef {
  return {
    beatId,
    category,
    importance: "optional",
    description: "Form an alliance with the wandering merchant",
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "castor-beats-"));
  bookDir = join(root, "books", "demo-book");
  await mkdir(join(bookDir, "story", "state"), { recursive: true });
  await writeFile(canonPath(), `${JSON.stringify({
    schemaVersion: 2,
    language: "en",
    lastAppliedChapter: 5,
    projectionVersion: 1,
    migrationWarnings: [],
  }, null, 2)}\n`, "utf-8");
});

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("Major Beats Canon evidence evaluation", () => {
  it("advances beat to satisfied when concrete Canon evidence exists", () => {
    const beat = requiredBeat("beat-1", "event");
    const evidence: BeatEvaluationEvidence = {
      canonRevision: 5,
      source: "canon_evidence",
      evidenceConfidence: "certain",
      matchingFacts: ["Fact: The library beneath the castle was breached and examined in Chapter 5."],
    };
    const result = evaluateBeatState(beat, evidence);
    expect(result.status).toBe("satisfied");
    if (result.status === "satisfied") {
      expect(result.verifiedAtCanonRevision).toBe(5);
      expect(result.evidence).toContain("breached and examined");
    }
  });

  it("refuses to advance beat when evidence is only planner prediction", () => {
    const beat = requiredBeat("beat-1", "event");
    const evidence: BeatEvaluationEvidence = {
      canonRevision: 5,
      source: "planner_prediction",
      evidenceConfidence: "certain",
      matchingFacts: ["Prediction: Chapter 6 will reveal the library."],
    };
    const result = evaluateBeatState(beat, evidence);
    expect(result.status).toBe("in_progress");
    if (result.status === "in_progress") {
      expect(result.reason).toContain("planner_prediction_cannot_satisfy_beat");
    }
  });

  it("keeps beat in_progress when Canon evidence is semantically uncertain", () => {
    const beat = requiredBeat("beat-1", "character_change");
    const evidence: BeatEvaluationEvidence = {
      canonRevision: 5,
      source: "canon_evidence",
      evidenceConfidence: "uncertain",
      matchingFacts: ["Hero seemed hesitant about their loyalties."],
    };
    const result = evaluateBeatState(beat, evidence);
    expect(result.status).toBe("in_progress");
    if (result.status === "in_progress") {
      expect(result.reason).toContain("semantic_uncertainty_in_progress");
    }
  });

  it("blocks silent superseding of REQUIRED beats", () => {
    const beat = requiredBeat("beat-crucial", "arc_turn");
    const supersedeAttempt: BeatEvaluationEvidence = {
      canonRevision: 5,
      source: "canon_evidence",
      evidenceConfidence: "certain",
      action: "supersede",
      supersededReason: "Direction moved away from this plot point",
    };
    expect(() => evaluateBeatState(beat, supersedeAttempt)).toThrow(/cannot be silently superseded/i);
  });

  it("allows superseding of OPTIONAL beats with explicit reason", () => {
    const beat = optionalBeat("beat-side-quest", "relationship_change");
    const supersedeAttempt: BeatEvaluationEvidence = {
      canonRevision: 5,
      source: "canon_evidence",
      evidenceConfidence: "certain",
      action: "supersede",
      supersededReason: "Merchant departed from region without interaction",
      supersededBy: "beat-new-ally",
    };
    const result = evaluateBeatState(beat, supersedeAttempt);
    expect(result.status).toBe("superseded");
    if (result.status === "superseded") {
      expect(result.reason).toBe("Merchant departed from region without interaction");
      expect(result.supersededBy).toBe("beat-new-ally");
    }
  });

  it("evaluates beat from Canon file without modifying Canon truth", async () => {
    const canonBefore = await readFile(canonPath(), "utf-8");
    const beat = requiredBeat("beat-test");

    const result = await evaluateBeatFromCanon(bookDir, beat, {
      source: "canon_evidence",
      evidenceConfidence: "certain",
      matchingFacts: ["Fact: Found the secret chamber in Chapter 5."],
    });

    expect(result.status).toBe("satisfied");
    expect(await readFile(canonPath(), "utf-8")).toBe(canonBefore);
  });
});
