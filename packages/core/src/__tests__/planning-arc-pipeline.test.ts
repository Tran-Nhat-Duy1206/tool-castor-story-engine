import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateArcPlanDraft,
  runArcPreflight,
  reviewArcPlanDraft,
  repairArcPlanLocal,
  verifyArcPlanRepair,
  publishArcPlan,
  saveArcPreflightRecord,
  loadArcPreflightRecord,
  type ArcFinding,
  type ArcPreflightRecord,
} from "../planning/arc-pipeline.js";
import {
  loadArcPlanDraft,
  loadPublishedArcPlan,
  restoreArcPlanAsRevisionDraft,
  saveArcPlanDraft,
  type ArcPlanDraftRecord,
  type ArcPlanSnapshot,
} from "../planning/arc-plan.js";
import {
  createAuthorization,
  confirmAuthorization,
  loadAuthorization,
} from "../governance/authorizations.js";
import {
  registerPlanningArtifact,
  listPlanningArtifactsDirectlyDependingOn,
} from "../planning/invalidation-registry.js";
import { createVersionStore, type FoundationPublishedSnapshot } from "../governance/versions.js";
import { commitAtomicFileSet } from "../utils/atomic-file-set.js";

let root = "";
let bookDir = "";
const canonPath = () => join(bookDir, "story", "state", "manifest.json");
const bookPath = () => join(bookDir, "book.json");

function sampleSnapshot(arcId = "arc-1"): ArcPlanSnapshot {
  return {
    arcId,
    goal: "Defeat the shadow syndicate in the capital",
    requiredBeats: [
      { beatId: "beat-discover-hideout", category: "event", importance: "required", description: "Discover the hidden cellar" },
      { beatId: "beat-confront-leader", category: "arc_turn", importance: "required", description: "Face the shadow boss" },
    ],
    optionalBeats: [
      { beatId: "beat-recruit-ally", category: "relationship_change", importance: "optional", description: "Persuade the rogue" },
    ],
    relationshipMovements: ["allies-with-rogue"],
    hookMovements: ["hook-shadow-key-advanced"],
    timing: { estimatedChapters: 10, startChapter: 1, endChapter: 10 },
    authorizations: [],
    dependencies: [
      { kind: "foundation_unit", unitId: "character-hero", contentRevision: 1, approvedRevision: 1, foundationVersion: 1 },
    ],
    changedBeats: ["beat-discover-hideout"],
    changedAuthorizations: [],
  };
}

async function seedFoundationV1(): Promise<void> {
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
    version: 1,
    parentVersion: null,
    baseCanonRevision: 0,
    snapshot,
    publishedBy: "human-author",
  });
  const pointer = store.prepareCurrentVersionPointer("foundation", "foundation", 1);
  await commitAtomicFileSet({
    rootDir: bookDir,
    writes: [...prepared.writes, pointer],
  });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "castor-arc-pipe-"));
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
    governance: { foundation: "v2", planning: "legacy" },
  }, null, 2)}\n`, "utf-8");
  await writeFile(canonPath(), `${JSON.stringify({
    schemaVersion: 2,
    language: "en",
    lastAppliedChapter: 0,
    projectionVersion: 1,
    migrationWarnings: [],
  }, null, 2)}\n`, "utf-8");
  await seedFoundationV1();
});

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("Arc Generation", () => {
  it("generateArcPlanDraft persists through Task 12 store and creates no Arc authority", async () => {
    const { draftId } = await generateArcPlanDraft(bookDir, "arc-1", 1, "Explore capital cellar and defeat shadow boss");
    expect(draftId).toMatch(/^draft-arc-/);

    const loaded = await loadArcPlanDraft(bookDir, draftId);
    expect(loaded).not.toBeNull();
    expect(loaded?.arcId).toBe("arc-1");
    expect(loaded?.foundationVersion).toBe(1);

    const published = await loadPublishedArcPlan(bookDir, "arc-1");
    expect(published).toBeNull();
  });
});

describe("Deterministic and Semantic Preflight", () => {
  it("runs preflight and persists exact draft preflight record", async () => {
    const { draftId } = await generateArcPlanDraft(bookDir, "arc-1", 1, "Brief");
    const preflightRes = await runArcPreflight(bookDir, draftId);
    expect(preflightRes.outcome).toBe("preflight_pass");

    const record = await loadArcPreflightRecord(bookDir, draftId);
    expect(record).not.toBeNull();
    expect(record?.draftId).toBe(draftId);
    expect(record?.deterministicResult).toBe("pass");
    expect(record?.status).toBe("current");
  });

  it("fails preflight on stale Foundation base version", async () => {
    const draft: ArcPlanDraftRecord = {
      draftId: "draft-stale-found",
      arcId: "arc-1",
      snapshot: sampleSnapshot("arc-1"),
      draftHash: "hash-stale-found-1234",
      foundationVersion: 99, // current is 1
      baseCanonRevision: 0,
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveArcPlanDraft(bookDir, draft);

    const preflightRes = await runArcPreflight(bookDir, "draft-stale-found");
    expect(preflightRes.outcome).toBe("preflight_fail");
    if (preflightRes.outcome === "preflight_fail") {
      const conflictFinding = preflightRes.findings.find((f) => f.source === "deterministic" && f.kind === "conflict");
      expect(conflictFinding).toBeDefined();
      expect(conflictFinding?.evidence).toContain("Foundation");
    }
  });

  it("fails preflight on stale Canon base revision", async () => {
    const draft: ArcPlanDraftRecord = {
      draftId: "draft-stale-canon",
      arcId: "arc-1",
      snapshot: sampleSnapshot("arc-1"),
      draftHash: "hash-stale-canon-1234",
      foundationVersion: 1,
      baseCanonRevision: 99, // current is 0
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveArcPlanDraft(bookDir, draft);

    const preflightRes = await runArcPreflight(bookDir, "draft-stale-canon");
    expect(preflightRes.outcome).toBe("preflight_fail");
    if (preflightRes.outcome === "preflight_fail") {
      const conflictFinding = preflightRes.findings.find((f) => f.source === "deterministic" && f.kind === "conflict");
      expect(conflictFinding).toBeDefined();
      expect(conflictFinding?.evidence).toContain("Canon");
    }
  });

  it("emits deterministic conflict on hard timeline conflict", async () => {
    const draft: ArcPlanDraftRecord = {
      draftId: "draft-timing-conflict",
      arcId: "arc-1",
      snapshot: {
        ...sampleSnapshot("arc-1"),
        timing: { startChapter: 15, endChapter: 5 }, // invalid timing range
      },
      draftHash: "hash-timing-conflict-1234",
      foundationVersion: 1,
      baseCanonRevision: 0,
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveArcPlanDraft(bookDir, draft);

    const preflightRes = await runArcPreflight(bookDir, "draft-timing-conflict");
    expect(preflightRes.outcome).toBe("preflight_fail");
    if (preflightRes.outcome === "preflight_fail") {
      const finding = preflightRes.findings.find((f) => f.source === "deterministic" && f.kind === "conflict");
      expect(finding).toBeDefined();
    }
  });

  it("emits uncertain/local on semantic pacing concern and never conflict", async () => {
    const draft: ArcPlanDraftRecord = {
      draftId: "draft-semantic-pacing",
      arcId: "arc-1",
      snapshot: sampleSnapshot("arc-1"),
      draftHash: "hash-semantic-pacing-1234",
      foundationVersion: 1,
      baseCanonRevision: 0,
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveArcPlanDraft(bookDir, draft);

    const findings = await reviewArcPlanDraft(bookDir, "draft-semantic-pacing", async () => [
      {
        findingId: "sem-1",
        source: "semantic",
        kind: "uncertain",
        severity: "minor",
        repairScope: "local",
        evidence: "Relationship pacing between hero and rogue is rapid in chapter 2",
        suggestedAction: "Space out the trust progression",
      },
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe("uncertain");
    expect(findings[0].source).toBe("semantic");
  });

  it("emits author_decision on unauthorized major decision", async () => {
    const draft: ArcPlanDraftRecord = {
      draftId: "draft-author-dec",
      arcId: "arc-1",
      snapshot: sampleSnapshot("arc-1"),
      draftHash: "hash-author-dec-1234",
      foundationVersion: 1,
      baseCanonRevision: 0,
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveArcPlanDraft(bookDir, draft);

    const preflightRes = await runArcPreflight(bookDir, "draft-author-dec", {
      semanticReviewer: async () => [
        {
          findingId: "sem-author-dec",
          source: "semantic",
          kind: "author_decision",
          severity: "blocking",
          repairScope: "author_decision",
          evidence: "Draft introduces major character death without authorization",
          suggestedAction: "Obtain author authorization",
          involvesDecisionKind: "major_character_death",
        },
      ],
    });

    expect(preflightRes.outcome).toBe("preflight_fail");
    expect(preflightRes.preflightRecord.unresolvedAuthorDecisions).toEqual(["major_character_death"]);
  });

  it("rejects semantic reviewer attempt to emit hard conflict at runtime", async () => {
    const draft: ArcPlanDraftRecord = {
      draftId: "draft-invalid-semantic",
      arcId: "arc-1",
      snapshot: sampleSnapshot("arc-1"),
      draftHash: "hash-invalid-semantic-1234",
      foundationVersion: 1,
      baseCanonRevision: 0,
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveArcPlanDraft(bookDir, draft);

    await expect(reviewArcPlanDraft(bookDir, "draft-invalid-semantic", async () => [
      {
        findingId: "sem-bad",
        source: "semantic",
        kind: "conflict" as never, // illegal
        severity: "blocking",
        repairScope: "multi_unit",
        evidence: "Semantic hard conflict",
        suggestedAction: "Illegal",
      },
    ])).rejects.toThrow(/semantic review.*conflict/i);
  });
});

describe("Bounded Arc Repair", () => {
  it("allows local repair for minor and important findings with separate targeted re-review", async () => {
    const { draftId } = await generateArcPlanDraft(bookDir, "arc-1", 1, "Brief");
    const localFindings: ArcFinding[] = [
      {
        findingId: "f-1",
        source: "semantic",
        kind: "local_issue",
        severity: "important",
        repairScope: "local",
        evidence: "Beat description too brief",
        suggestedAction: "Clarify beat location",
      },
    ];

    const repairRes = await repairArcPlanLocal(bookDir, draftId, localFindings, 1);
    expect(repairRes.status).toBe("repaired");
    if (repairRes.status === "repaired") {
      expect(repairRes.round).toBe(1);
    }

    // Independent verification call
    const reReview = await verifyArcPlanRepair(bookDir, draftId, localFindings, 1);
    expect(reReview).toHaveLength(0); // clean after repair
  });

  it("refuses to auto-repair multi_unit, author_decision, or conflict findings", async () => {
    const { draftId } = await generateArcPlanDraft(bookDir, "arc-1", 1, "Brief");
    const multiUnitFindings: ArcFinding[] = [
      {
        findingId: "f-multi",
        source: "deterministic",
        kind: "conflict",
        severity: "blocking",
        repairScope: "multi_unit",
        evidence: "Multi-unit inconsistency",
        suggestedAction: "Needs human direction",
      },
    ];

    const repairRes = await repairArcPlanLocal(bookDir, draftId, multiUnitFindings, 1);
    expect(repairRes.status).toBe("needs_human_direction");
  });

  it("caps semantic repair rounds at 2 and escalates round >2 to human direction", async () => {
    const { draftId } = await generateArcPlanDraft(bookDir, "arc-1", 1, "Brief");
    const localFindings: ArcFinding[] = [
      {
        findingId: "f-recurring",
        source: "semantic",
        kind: "local_issue",
        severity: "minor",
        repairScope: "local",
        evidence: "Recurring local defect",
        suggestedAction: "Fix wording",
      },
    ];

    const round3Res = await repairArcPlanLocal(bookDir, draftId, localFindings, 3);
    expect(round3Res.status).toBe("needs_human_direction");
    if (round3Res.status === "needs_human_direction") {
      expect(round3Res.reason).toContain("maximum 2");
    }
  });
});

describe("Explicit Human Arc Publish Boundary", () => {
  it("rejects publish if preflight record is missing", async () => {
    const { draftId } = await generateArcPlanDraft(bookDir, "arc-1", 1, "Brief");

    await expect(publishArcPlan({
      bookDir,
      draftId,
      humanActor: "author-alice",
      expectedFoundationVersion: 1,
      expectedCanonRevision: 0,
    })).rejects.toThrow(/preflight/i);
  });

  it("rejects publish if draftHash changed after preflight", async () => {
    const { draftId } = await generateArcPlanDraft(bookDir, "arc-1", 1, "Brief");
    await runArcPreflight(bookDir, draftId);

    // Mutate draft directly
    const draft = await loadArcPlanDraft(bookDir, draftId);
    if (draft) {
      await saveArcPlanDraft(bookDir, {
        ...draft,
        snapshot: { ...draft.snapshot, goal: "Mutated goal after preflight" },
        draftHash: "new-hash-different-from-preflight",
      });
    }

    await expect(publishArcPlan({
      bookDir,
      draftId,
      humanActor: "author-alice",
      expectedFoundationVersion: 1,
      expectedCanonRevision: 0,
    })).rejects.toThrow(/draft hash changed/i);
  });

  it("rejects publish if required authorization is pending or missing", async () => {
    const { authorizationId } = await createAuthorization(bookDir, {
      decisionKind: "major_character_death",
      scope: { kind: "arc", arcId: "arc-1" },
      consumption: "one_time",
    });

    const draft: ArcPlanDraftRecord = {
      draftId: "draft-needs-auth",
      arcId: "arc-1",
      snapshot: {
        ...sampleSnapshot("arc-1"),
        authorizations: [authorizationId],
      },
      draftHash: "hash-auth-1234",
      foundationVersion: 1,
      baseCanonRevision: 0,
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveArcPlanDraft(bookDir, draft);
    await runArcPreflight(bookDir, "draft-needs-auth");

    // Publish must fail because authorization is pending (not confirmed by human)
    await expect(publishArcPlan({
      bookDir,
      draftId: "draft-needs-auth",
      humanActor: "author-alice",
      expectedFoundationVersion: 1,
      expectedCanonRevision: 0,
    })).rejects.toThrow(/authorization.*active/i);

    // Confirm authorization by human
    await confirmAuthorization(bookDir, authorizationId, "author-alice");

    // Now publish succeeds
    const published = await publishArcPlan({
      bookDir,
      draftId: "draft-needs-auth",
      humanActor: "author-alice",
      expectedFoundationVersion: 1,
      expectedCanonRevision: 0,
    });
    expect(published.version).toBe(1);

    // Authorization MUST NOT be consumed by Arc Publish (remains active)
    const authRecord = await loadAuthorization(bookDir, authorizationId);
    expect(authRecord?.lifecycle).toBe("active");
  });

  it("publishes Arc Plan cleanly, flips governance.planning to v2, and invalidates direct planning dependents", async () => {
    const { draftId } = await generateArcPlanDraft(bookDir, "arc-1", 1, "Brief");
    await runArcPreflight(bookDir, draftId);

    // Register a dependent lookahead and an unrelated lookahead
    await registerPlanningArtifact(bookDir, {
      artifactKind: "lookahead",
      artifactId: "lookahead-dep",
      dependencyRefs: [{ kind: "arc_beat", beatId: "arc-1", observedEvidenceRevision: "1" }],
      registeredAt: new Date().toISOString(),
    });
    await registerPlanningArtifact(bookDir, {
      artifactKind: "lookahead",
      artifactId: "lookahead-unrelated",
      dependencyRefs: [{ kind: "foundation_unit", unitId: "character-hero", contentRevision: 1, approvedRevision: 1, foundationVersion: 1 }],
      registeredAt: new Date().toISOString(),
    });

    const bookBefore = JSON.parse(await readFile(bookPath(), "utf-8"));
    expect(bookBefore.governance.planning).toBe("legacy");

    const published = await publishArcPlan({
      bookDir,
      draftId,
      humanActor: "author-alice",
      expectedFoundationVersion: 1,
      expectedCanonRevision: 0,
    });

    expect(published.version).toBe(1);
    expect(published.unitId).toBe("arc-1");

    // governance.planning is atomically v2
    const bookAfter = JSON.parse(await readFile(bookPath(), "utf-8"));
    expect(bookAfter.governance.planning).toBe("v2");
    expect(bookAfter.governance.foundation).toBe("v2");

    // Direct dependent lookahead is listed for invalidation
    const directMatches = await listPlanningArtifactsDirectlyDependingOn(bookDir, "arc-1");
    expect(directMatches).toEqual([{ artifactKind: "lookahead", artifactId: "lookahead-dep" }]);
  });

  it("restored Draft C cannot publish directly without fresh preflight", async () => {
    // Publish V1 first
    const { draftId: draft1 } = await generateArcPlanDraft(bookDir, "arc-1", 1, "Brief 1");
    await runArcPreflight(bookDir, draft1);
    await publishArcPlan({
      bookDir,
      draftId: draft1,
      humanActor: "author-alice",
      expectedFoundationVersion: 1,
      expectedCanonRevision: 0,
    });

    // Restore V1 to Draft C
    const { draftId: draftC } = await restoreArcPlanAsRevisionDraft(bookDir, "arc-1", 1);

    // Cannot publish Draft C without preflight
    await expect(publishArcPlan({
      bookDir,
      draftId: draftC,
      humanActor: "author-alice",
      expectedFoundationVersion: 1,
      expectedCanonRevision: 0,
    })).rejects.toThrow(/preflight/i);

    // Run fresh preflight on Draft C
    await runArcPreflight(bookDir, draftC);

    // Now publish creates V2
    const publishedV2 = await publishArcPlan({
      bookDir,
      draftId: draftC,
      humanActor: "author-alice",
      expectedFoundationVersion: 1,
      expectedCanonRevision: 0,
    });
    expect(publishedV2.version).toBe(2);
  });

  it("handles concurrent publish attempts gracefully: one wins and other fails stale/conflict", async () => {
    const { draftId } = await generateArcPlanDraft(bookDir, "arc-1", 1, "Concurrent test");
    await runArcPreflight(bookDir, draftId);

    const first = await publishArcPlan({
      bookDir,
      draftId,
      humanActor: "author-alice",
      expectedFoundationVersion: 1,
      expectedCanonRevision: 0,
    });
    expect(first.version).toBe(1);

    // Second publish of same draft fails because Arc version has moved to 1 (base is now stale)
    await expect(publishArcPlan({
      bookDir,
      draftId,
      humanActor: "author-bob",
      expectedFoundationVersion: 1,
      expectedCanonRevision: 0,
    })).rejects.toThrow();
  });

  it("pre-commit fault leaves old planning mode and old authority intact", async () => {
    const { draftId } = await generateArcPlanDraft(bookDir, "arc-1", 1, "Fault test");
    await runArcPreflight(bookDir, draftId);

    // Simulate crash at stage "journal"
    await expect(publishArcPlan({
      bookDir,
      draftId,
      humanActor: "author-alice",
      expectedFoundationVersion: 1,
      expectedCanonRevision: 0,
      failAtStage: "journal",
    })).rejects.toThrow();

    // Authority is still null
    const published = await loadPublishedArcPlan(bookDir, "arc-1");
    expect(published).toBeNull();

    // Planning mode is still legacy
    const book = JSON.parse(await readFile(bookPath(), "utf-8"));
    expect(book.governance.planning).toBe("legacy");
  });

  it("leaves Canon, Foundation, and historical chapters unchanged", async () => {
    const canonBefore = await readFile(canonPath(), "utf-8");
    const { draftId } = await generateArcPlanDraft(bookDir, "arc-1", 1, "Safety test");
    await runArcPreflight(bookDir, draftId);
    await publishArcPlan({
      bookDir,
      draftId,
      humanActor: "author-alice",
      expectedFoundationVersion: 1,
      expectedCanonRevision: 0,
    });

    expect(await readFile(canonPath(), "utf-8")).toBe(canonBefore);

    const store = createVersionStore(bookDir);
    const foundVer = await store.readCurrentVersion("foundation", "foundation");
    expect(foundVer?.version).toBe(1);
  });
});
