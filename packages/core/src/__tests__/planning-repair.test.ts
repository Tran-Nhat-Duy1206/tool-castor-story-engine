import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  reviewDetailedPlan,
  repairDetailedPlanLocal,
  verifyDetailedPlanRepair,
  type PlanningFinding,
  type PlanningRepairOutcome,
} from "../planning/repair.js";
import {
  buildDetailedPlan,
  loadDetailedPlan,
  saveDetailedPlanRecord,
  type DetailedChapterPlanRecord,
} from "../planning/detailed-plan.js";
import { createVersionStore, type FoundationPublishedSnapshot } from "../governance/versions.js";
import { commitAtomicFileSet } from "../utils/atomic-file-set.js";
import { type ArcPlanSnapshot } from "../planning/arc-plan.js";
import { type ChapterIntent, type ChapterMemo } from "../models/input-governance.js";

let root = "";
let bookDir = "";
const canonPath = () => join(bookDir, "story", "state", "manifest.json");
const bookPath = () => join(bookDir, "book.json");

function sampleMemo(chapter = 5): ChapterMemo {
  return {
    chapter,
    goal: "Infiltrate shadow cellar",
    isGoldenOpening: false,
    body: "### Narrative Directives\nInfiltrate the cellar.\n\n### Character Directives\nHero moves quietly.\n\n### Relationship Directives\nTrust is tested.\n\n### Pacing Directives\nFast suspense.\n\n### Mystery Directives\nShadow sigil discovered.\n\n### Continuity Directives\nCarries key from ch 4.\n\n### Thematic Directives\nTruth comes at a cost.",
    threadRefs: ["thread-shadow-syndicate"],
  };
}

function sampleIntent(chapter = 5): ChapterIntent {
  return {
    chapter,
    goal: "Infiltrate shadow cellar",
    outlineNode: "Act 2 Turn",
    arcContext: "Arc 1 Climax",
    mustKeep: ["Hero wears cloak", "Cellar door is locked"],
    mustAvoid: ["Revealing villain identity early"],
    styleEmphasis: ["Suspenseful atmosphere"],
  };
}

async function seedFoundation(version = 1): Promise<void> {
  const store = createVersionStore(bookDir);
  const snapshot: FoundationPublishedSnapshot = {
    unitRefs: [
      { unitId: "character-hero", contentRevision: 1, approvedRevision: 1, contentHash: "hash-hero-1" },
    ],
    changedUnitIds: ["character-hero"],
    humanResolutionIds: [],
    dependencyImpact: [],
    baseCanonRevision: 0,
  };
  const prepared = await store.prepareVersionAppend<FoundationPublishedSnapshot>({
    artifactKind: "foundation",
    unitId: "foundation",
    version,
    parentVersion: version > 1 ? version - 1 : null,
    baseCanonRevision: 0,
    snapshot,
    publishedBy: "human-author",
  });
  const pointer = store.prepareCurrentVersionPointer("foundation", "foundation", version);
  await commitAtomicFileSet({
    rootDir: bookDir,
    writes: [...prepared.writes, pointer],
  });
}

async function seedPublishedArc(arcId = "arc-1", version = 1): Promise<void> {
  const store = createVersionStore(bookDir);
  const snapshot: ArcPlanSnapshot = {
    arcId,
    goal: "Defeat shadow boss",
    requiredBeats: [
      { beatId: "beat-infiltrate", category: "event", importance: "required", description: "Infiltrate cellar" },
    ],
    optionalBeats: [],
    relationshipMovements: [],
    hookMovements: [],
    timing: {},
    authorizations: [],
    dependencies: [],
    changedBeats: ["beat-infiltrate"],
    changedAuthorizations: [],
  };
  const prepared = await store.prepareVersionAppend<ArcPlanSnapshot>({
    artifactKind: "arc_plan",
    unitId: arcId,
    version,
    parentVersion: version > 1 ? version - 1 : null,
    baseCanonRevision: 0,
    snapshot,
    publishedBy: "human-author",
  });
  const pointer = store.prepareCurrentVersionPointer("arc_plan", arcId, version);
  await commitAtomicFileSet({
    rootDir: bookDir,
    writes: [...prepared.writes, pointer],
  });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "castor-repair-"));
  bookDir = join(root, "books", "demo-book");
  await mkdir(join(bookDir, "story", "state"), { recursive: true });
  await mkdir(join(bookDir, "story", "governance"), { recursive: true });
  await writeFile(bookPath(), `${JSON.stringify({
    id: "demo-book",
    title: "Demo",
    platform: "other",
    genre: "fantasy",
    status: "active",
    targetChapters: 30,
    chapterWordCount: 2000,
    language: "en",
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
    governance: { foundation: "v2", planning: "v2" },
  }, null, 2)}\n`, "utf-8");
  await writeFile(canonPath(), `${JSON.stringify({
    schemaVersion: 2,
    language: "en",
    lastAppliedChapter: 4,
    projectionVersion: 1,
    migrationWarnings: [],
  }, null, 2)}\n`, "utf-8");
  await seedFoundation(1);
  await seedPublishedArc("arc-1", 1);
});

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("Detailed Plan Review and Bounded Local Repair", () => {
  it("allows MINOR + LOCAL auto-repair and updates plan record", async () => {
    const { planId } = await buildDetailedPlan(bookDir, 5, {
      intent: sampleIntent(5),
      memo: sampleMemo(5),
    });
    const plan = (await loadDetailedPlan(bookDir, planId))!;

    const findings: PlanningFinding[] = [
      {
        findingId: "f-minor-1",
        planId,
        planHash: plan.planHash,
        chapterNumber: 5,
        severity: "minor",
        repairScope: "local",
        evidence: "Pacing transition too abrupt in memo",
        suggestedAction: "Smooth out narrative transition",
      },
    ];

    const repairRes = await repairDetailedPlanLocal(bookDir, planId, findings, 1);
    expect(repairRes.status).toBe("repaired");
    if (repairRes.status === "repaired") {
      expect(repairRes.round).toBe(1);
      expect(repairRes.planId).toBe(planId);
      expect(repairRes.planHash).not.toBe(plan.planHash);
    }
  });

  it("IMPORTANT + LOCAL requires separate targeted re-review", async () => {
    const { planId } = await buildDetailedPlan(bookDir, 5, {
      intent: sampleIntent(5),
      memo: sampleMemo(5),
    });
    const plan = (await loadDetailedPlan(bookDir, planId))!;

    const findings: PlanningFinding[] = [
      {
        findingId: "f-important-1",
        planId,
        planHash: plan.planHash,
        chapterNumber: 5,
        severity: "important",
        repairScope: "local",
        evidence: "Missing key continuity link from ch 4",
        suggestedAction: "Add explicit continuity directive",
      },
    ];

    const repairRes = await repairDetailedPlanLocal(bookDir, planId, findings, 1);
    expect(repairRes.status).toBe("repaired");

    // Targeted separate re-review invocation
    const remaining = await verifyDetailedPlanRepair(bookDir, planId, ["f-important-1"], 1);
    expect(remaining).toHaveLength(0); // verified clean
  });

  it("escalates MULTI_UNIT and AUTHOR_DECISION to human direction", async () => {
    const { planId } = await buildDetailedPlan(bookDir, 5, {
      intent: sampleIntent(5),
      memo: sampleMemo(5),
    });
    const plan = (await loadDetailedPlan(bookDir, planId))!;

    const multiFindings: PlanningFinding[] = [
      {
        findingId: "f-multi",
        planId,
        planHash: plan.planHash,
        chapterNumber: 5,
        severity: "blocking",
        repairScope: "multi_unit",
        evidence: "Multi-chapter contradiction across arc",
        suggestedAction: "Requires global narrative realignment",
      },
    ];

    const repairRes = await repairDetailedPlanLocal(bookDir, planId, multiFindings, 1);
    expect(repairRes.status).toBe("needs_human_direction");
  });

  it("refuses to auto-repair conflict findings", async () => {
    const { planId } = await buildDetailedPlan(bookDir, 5, {
      intent: sampleIntent(5),
      memo: sampleMemo(5),
    });
    const plan = (await loadDetailedPlan(bookDir, planId))!;

    const conflictFindings: PlanningFinding[] = [
      {
        findingId: "f-conflict",
        planId,
        planHash: plan.planHash,
        chapterNumber: 5,
        severity: "blocking",
        repairScope: "local",
        evidence: "Prohibited Book Rule violation",
        suggestedAction: "Cannot be auto-repaired",
      },
    ];

    const repairRes = await repairDetailedPlanLocal(bookDir, planId, conflictFindings, 1);
    expect(repairRes.status).toBe("needs_human_direction");
  });

  it("NEGATIVE TEST: repair attempting to introduce unauthorized major decision routes to human", async () => {
    const { planId } = await buildDetailedPlan(bookDir, 5, {
      intent: sampleIntent(5),
      memo: sampleMemo(5),
    });
    const plan = (await loadDetailedPlan(bookDir, planId))!;

    const findings: PlanningFinding[] = [
      {
        findingId: "f-author-decision",
        planId,
        planHash: plan.planHash,
        chapterNumber: 5,
        severity: "important",
        repairScope: "author_decision",
        evidence: "Attempting major character death without authorization",
        suggestedAction: "Obtain author approval",
        involvesDecisionKind: "major_character_death",
      },
    ];

    const repairRes = await repairDetailedPlanLocal(bookDir, planId, findings, 1);
    expect(repairRes.status).toBe("needs_human_direction");
  });
});

describe("Stale Findings and Wrong Target Protection", () => {
  it("rejects stale finding if planHash changed after finding was created", async () => {
    const { planId } = await buildDetailedPlan(bookDir, 5, {
      intent: sampleIntent(5),
      memo: sampleMemo(5),
    });
    const plan = (await loadDetailedPlan(bookDir, planId))!;

    const staleFinding: PlanningFinding = {
      findingId: "f-stale",
      planId,
      planHash: "old-stale-plan-hash-1234",
      chapterNumber: 5,
      severity: "minor",
      repairScope: "local",
      evidence: "Stale evidence",
      suggestedAction: "Stale action",
    };

    const repairRes = await repairDetailedPlanLocal(bookDir, planId, [staleFinding], 1);
    expect(repairRes.status).toBe("needs_human_direction");
  });

  it("rejects finding from Plan A when attempting to repair Plan B", async () => {
    const { planId: planAId } = await buildDetailedPlan(bookDir, 5, { intent: sampleIntent(5), memo: sampleMemo(5) });
    const { planId: planBId } = await buildDetailedPlan(bookDir, 5, { intent: sampleIntent(5), memo: sampleMemo(5) });
    const planA = (await loadDetailedPlan(bookDir, planAId))!;

    const findingForA: PlanningFinding = {
      findingId: "f-plan-a",
      planId: planAId,
      planHash: planA.planHash,
      chapterNumber: 5,
      severity: "minor",
      repairScope: "local",
      evidence: "Finding on Plan A",
      suggestedAction: "Fix Plan A",
    };

    const repairRes = await repairDetailedPlanLocal(bookDir, planBId, [findingForA], 1);
    expect(repairRes.status).toBe("needs_human_direction");
  });
});

describe("2-Round Cap and Separate Verification", () => {
  it("allows round 1 and round 2, but refuses round > 2", async () => {
    const { planId } = await buildDetailedPlan(bookDir, 5, {
      intent: sampleIntent(5),
      memo: sampleMemo(5),
    });
    const plan = (await loadDetailedPlan(bookDir, planId))!;

    const finding: PlanningFinding = {
      findingId: "f-rec",
      planId,
      planHash: plan.planHash,
      chapterNumber: 5,
      severity: "minor",
      repairScope: "local",
      evidence: "Recurring local issue",
      suggestedAction: "Fix",
    };

    // Round 1
    const r1 = await repairDetailedPlanLocal(bookDir, planId, [finding], 1);
    expect(r1.status).toBe("repaired");

    // Round 2
    const repairedPlan = (await loadDetailedPlan(bookDir, planId))!;
    const findingR2: PlanningFinding = {
      ...finding,
      planHash: repairedPlan.planHash,
    };
    const r2 = await repairDetailedPlanLocal(bookDir, planId, [findingR2], 2);
    expect(r2.status).toBe("repaired");

    // Round 3 -> Refused
    const finalPlan = (await loadDetailedPlan(bookDir, planId))!;
    const findingR3: PlanningFinding = {
      ...finding,
      planHash: finalPlan.planHash,
    };
    const r3 = await repairDetailedPlanLocal(bookDir, planId, [findingR3], 3);
    expect(r3.status).toBe("needs_human_direction");
  });

  it("requires separate verification invocation (no self-certification)", async () => {
    const { planId } = await buildDetailedPlan(bookDir, 5, {
      intent: sampleIntent(5),
      memo: sampleMemo(5),
    });
    const plan = (await loadDetailedPlan(bookDir, planId))!;

    const findings: PlanningFinding[] = [
      {
        findingId: "f-ver-1",
        planId,
        planHash: plan.planHash,
        chapterNumber: 5,
        severity: "important",
        repairScope: "local",
        evidence: "Continuity detail",
        suggestedAction: "Add continuity",
      },
    ];

    const repairRes = await repairDetailedPlanLocal(bookDir, planId, findings, 1);
    expect(repairRes.status).toBe("repaired");

    // Separate verification call must load persisted state
    const verificationResults = await verifyDetailedPlanRepair(bookDir, planId, ["f-ver-1"], 1);
    expect(verificationResults).toHaveLength(0);
  });
});
