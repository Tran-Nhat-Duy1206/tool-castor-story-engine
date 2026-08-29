import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  invalidateDirectPlanningDependents,
  listPlanningArtifactsDirectlyDependingOn,
  registerPlanningArtifact,
  unregisterPlanningArtifact,
  type RegisteredPlanningArtifact,
} from "../planning/invalidation-registry.js";

let root = "";
let bookDir = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "castor-plan-registry-"));
  bookDir = join(root, "books", "demo-book");
});

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("generic planning invalidation registry", () => {
  it("registers and round-trips planning artifacts with declared dependencies", async () => {
    const entry: RegisteredPlanningArtifact = {
      artifactKind: "lookahead",
      artifactId: "lookahead-ch5-7",
      dependencyRefs: [
        { kind: "arc_beat", beatId: "beat-1", observedEvidenceRevision: "1" },
        { kind: "foundation_unit", unitId: "character-alice", contentRevision: 1, approvedRevision: 1, foundationVersion: 1 },
      ],
      registeredAt: new Date().toISOString(),
    };
    await registerPlanningArtifact(bookDir, entry);
    const matches = await listPlanningArtifactsDirectlyDependingOn(bookDir, "beat-1");
    expect(matches).toEqual([{ artifactKind: "lookahead", artifactId: "lookahead-ch5-7" }]);
  });

  it("unregisters an artifact cleanly", async () => {
    const entry: RegisteredPlanningArtifact = {
      artifactKind: "detailed_plan",
      artifactId: "plan-ch6",
      dependencyRefs: [
        { kind: "arc_beat", beatId: "beat-1", observedEvidenceRevision: "1" },
      ],
      registeredAt: new Date().toISOString(),
    };
    await registerPlanningArtifact(bookDir, entry);
    expect(await listPlanningArtifactsDirectlyDependingOn(bookDir, "beat-1")).toHaveLength(1);
    await unregisterPlanningArtifact(bookDir, "detailed_plan", "plan-ch6");
    expect(await listPlanningArtifactsDirectlyDependingOn(bookDir, "beat-1")).toHaveLength(0);
  });

  it("lists only direct dependency matches and ignores non-matching artifacts", async () => {
    await registerPlanningArtifact(bookDir, {
      artifactKind: "lookahead",
      artifactId: "lookahead-a",
      dependencyRefs: [{ kind: "arc_beat", beatId: "beat-alpha", observedEvidenceRevision: "1" }],
      registeredAt: new Date().toISOString(),
    });
    await registerPlanningArtifact(bookDir, {
      artifactKind: "detailed_plan",
      artifactId: "plan-b",
      dependencyRefs: [{ kind: "foundation_unit", unitId: "world-rule-gravity", contentRevision: 1, approvedRevision: 1, foundationVersion: 1 }],
      registeredAt: new Date().toISOString(),
    });
    const arcMatches = await listPlanningArtifactsDirectlyDependingOn(bookDir, "beat-alpha");
    expect(arcMatches).toEqual([{ artifactKind: "lookahead", artifactId: "lookahead-a" }]);
    const ruleMatches = await listPlanningArtifactsDirectlyDependingOn(bookDir, "world-rule-gravity");
    expect(ruleMatches).toEqual([{ artifactKind: "detailed_plan", artifactId: "plan-b" }]);
    const noneMatches = await listPlanningArtifactsDirectlyDependingOn(bookDir, "beat-beta");
    expect(noneMatches).toEqual([]);
  });

  it("direct invalidation marks direct dependent only and A->B->C does NOT cascade C", async () => {
    // A: foundation-rule-1
    // B: lookahead-1 directly depends on A (foundation-rule-1)
    // C: detailed-plan-2 directly depends on direction-1, NOT on A (foundation-rule-1)
    await registerPlanningArtifact(bookDir, {
      artifactKind: "lookahead",
      artifactId: "lookahead-1",
      dependencyRefs: [{ kind: "foundation_unit", unitId: "foundation-rule-1", contentRevision: 1, approvedRevision: 1, foundationVersion: 1 }],
      registeredAt: new Date().toISOString(),
    });
    await registerPlanningArtifact(bookDir, {
      artifactKind: "detailed_plan",
      artifactId: "detailed-plan-2",
      dependencyRefs: [{ kind: "human_direction", directionId: "direction-1", lifecycleRevision: "1" }],
      registeredAt: new Date().toISOString(),
    });

    // Invalidate A (foundation-rule-1)
    const invalidated = await invalidateDirectPlanningDependents(bookDir, "foundation-rule-1");
    // Only B (lookahead-1) is returned as directly invalidated
    expect(invalidated).toEqual([{ artifactKind: "lookahead", artifactId: "lookahead-1" }]);

    // C (detailed-plan-2) is still registered and unchanged
    const cMatches = await listPlanningArtifactsDirectlyDependingOn(bookDir, "direction-1");
    expect(cMatches).toEqual([{ artifactKind: "detailed_plan", artifactId: "detailed-plan-2" }]);
  });

  it("supports generic kinds without importing Task 14/15 concrete types", async () => {
    const entry: RegisteredPlanningArtifact = {
      artifactKind: "lookahead",
      artifactId: "generic-lookahead",
      dependencyRefs: [{ kind: "human_direction", directionId: "direction-1", lifecycleRevision: "1" }],
      registeredAt: new Date().toISOString(),
    };
    await registerPlanningArtifact(bookDir, entry);
    const res = await listPlanningArtifactsDirectlyDependingOn(bookDir, "direction-1");
    expect(res).toEqual([{ artifactKind: "lookahead", artifactId: "generic-lookahead" }]);
  });

  it("rejects unsafe IDs and fails closed", async () => {
    await expect(registerPlanningArtifact(bookDir, {
      artifactKind: "lookahead",
      artifactId: "../escape" as never,
      dependencyRefs: [],
      registeredAt: new Date().toISOString(),
    })).rejects.toThrow();

    await expect(unregisterPlanningArtifact(bookDir, "lookahead", "../../bad")).rejects.toThrow();
    await expect(listPlanningArtifactsDirectlyDependingOn(bookDir, "../invalid")).rejects.toThrow();
    await expect(invalidateDirectPlanningDependents(bookDir, "../invalid")).rejects.toThrow();
  });
});
