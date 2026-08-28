import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  freezeExecutionSnapshot,
  freezeExecutionSnapshotUnderLock,
  loadExecutionSnapshot,
  type ExecutionSnapshot,
} from "../execution/snapshot.js";
import { StateManager } from "../state/manager.js";
import {
  buildDetailedPlan,
  loadDetailedPlan,
  type DetailedChapterPlanRecord,
} from "../planning/detailed-plan.js";
import { composeContext } from "../context/composer.js";
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
  root = await mkdtemp(join(tmpdir(), "inkos-exec-snapshot-"));
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

describe("Execution Snapshot Freeze & Immutability", () => {
  it("freezes exact persisted plan and returns immutable snapshot", async () => {
    const { planId } = await buildDetailedPlan(bookDir, 5, {
      intent: sampleIntent(5),
      memo: sampleMemo(5),
    });
    const plan = (await loadDetailedPlan(bookDir, planId))!;

    const bundle = await composeContext({
      bookDir,
      profile: "writer_context",
      subject: { kind: "detailed_plan", planId, planHash: plan.planHash },
    });

    const res = await freezeExecutionSnapshot(bookDir, planId, bundle);
    expect(res.status).toBe("frozen");
    if (res.status === "frozen") {
      expect(res.snapshot.planId).toBe(planId);
      expect(res.snapshot.planHash).toBe(plan.planHash);
      expect(res.snapshot.chapterNumber).toBe(5);
      expect(res.snapshot.contextBundleId).toBe(bundle.bundleId);

      const loaded = await loadExecutionSnapshot(bookDir, res.snapshot.snapshotId);
      expect(loaded).toEqual(res.snapshot);
    }
  });

  it("rejects freeze when ContextBundle was composed for another plan", async () => {
    const { planId: planAId } = await buildDetailedPlan(bookDir, 5, { intent: sampleIntent(5), memo: sampleMemo(5) });
    const { planId: planBId } = await buildDetailedPlan(bookDir, 5, { intent: sampleIntent(5), memo: sampleMemo(5) });
    const planA = (await loadDetailedPlan(bookDir, planAId))!;

    // Bundle composed for Plan A
    const bundleA = await composeContext({
      bookDir,
      profile: "writer_context",
      subject: { kind: "detailed_plan", planId: planAId, planHash: planA.planHash },
    });

    // Attempt to freeze Plan B with Bundle A
    const res = await freezeExecutionSnapshot(bookDir, planBId, bundleA);
    expect(res.status).toBe("execution_prepare_failed");
  });

  it("rejects freeze when planHash changed after bundle was composed", async () => {
    const { planId } = await buildDetailedPlan(bookDir, 5, {
      intent: sampleIntent(5),
      memo: sampleMemo(5),
    });
    const plan = (await loadDetailedPlan(bookDir, planId))!;

    const bundle = await composeContext({
      bookDir,
      profile: "writer_context",
      subject: { kind: "detailed_plan", planId, planHash: plan.planHash },
    });

    // Stale bundle with forged/old hash
    const staleBundle = {
      ...bundle,
      subject: { kind: "detailed_plan" as const, planId, planHash: "old-stale-hash" },
    };

    const res = await freezeExecutionSnapshot(bookDir, planId, staleBundle);
    expect(res.status).toBe("execution_prepare_failed");
  });

  it("prepare race: state change during freeze fails closed with execution_prepare_failed", async () => {
    const { planId } = await buildDetailedPlan(bookDir, 5, {
      intent: sampleIntent(5),
      memo: sampleMemo(5),
    });
    const plan = (await loadDetailedPlan(bookDir, planId))!;

    const bundle = await composeContext({
      bookDir,
      profile: "writer_context",
      subject: { kind: "detailed_plan", planId, planHash: plan.planHash },
    });

    // Advance Foundation version to v2 before freeze
    await seedFoundation(2);

    const res = await freezeExecutionSnapshot(bookDir, planId, bundle);
    expect(res.status).toBe("execution_prepare_failed");
  });

  it("mutating plan after snapshot freeze leaves previously frozen snapshot immutable", async () => {
    const { planId } = await buildDetailedPlan(bookDir, 5, {
      intent: sampleIntent(5),
      memo: sampleMemo(5),
    });
    const plan = (await loadDetailedPlan(bookDir, planId))!;

    const bundle = await composeContext({
      bookDir,
      profile: "writer_context",
      subject: { kind: "detailed_plan", planId, planHash: plan.planHash },
    });

    const res = await freezeExecutionSnapshot(bookDir, planId, bundle);
    expect(res.status).toBe("frozen");

    if (res.status === "frozen") {
      const originalSnapshot = res.snapshot;

      // Mutate plan in place
      const mutatedPlan: DetailedChapterPlanRecord = {
        ...plan,
        intent: { ...plan.intent, goal: "Mutated goal" },
        planHash: "mutated-hash-xyz",
      };
      await writeFile(
        join(bookDir, "story", "governance", "detailed-plans", `${planId}.json`),
        JSON.stringify(mutatedPlan, null, 2),
        "utf-8",
      );

      // Snapshot on disk remains completely unchanged
      const loadedSnapshot = await loadExecutionSnapshot(bookDir, originalSnapshot.snapshotId);
      expect(loadedSnapshot?.planHash).toBe(originalSnapshot.planHash);
      expect(loadedSnapshot?.bindings).toEqual(originalSnapshot.bindings);
    }
  });

  it("freezeExecutionSnapshotUnderLock fails closed when book lock is not held", async () => {
    const { planId } = await buildDetailedPlan(bookDir, 5, {
      intent: sampleIntent(5),
      memo: sampleMemo(5),
    });
    const plan = (await loadDetailedPlan(bookDir, planId))!;

    const bundle = await composeContext({
      bookDir,
      profile: "writer_context",
      subject: { kind: "detailed_plan", planId, planHash: plan.planHash },
    });

    const forgedRelease = async () => undefined;
    const res = await freezeExecutionSnapshotUnderLock(bookDir, planId, bundle, forgedRelease);
    expect(res.status).toBe("execution_prepare_failed");
    if (res.status === "execution_prepare_failed") {
      expect(res.reason).toContain("without valid lock ownership");
    }
  });

  it("public freeze cannot bypass an existing lock, while the exact lock owner can use the internal path", async () => {
    const { planId } = await buildDetailedPlan(bookDir, 5, {
      intent: sampleIntent(5),
      memo: sampleMemo(5),
    });
    const plan = (await loadDetailedPlan(bookDir, planId))!;

    const bundle = await composeContext({
      bookDir,
      profile: "writer_context",
      subject: { kind: "detailed_plan", planId, planHash: plan.planHash },
    });

    const manager = new StateManager(root);
    const releaseLock = await manager.acquireBookLock("demo-book");
    try {
      const publicResult = await freezeExecutionSnapshot(bookDir, planId, bundle);
      expect(publicResult.status).toBe("execution_prepare_failed");

      const ownerResult = await freezeExecutionSnapshotUnderLock(
        bookDir,
        planId,
        bundle,
        releaseLock,
      );
      expect(ownerResult.status).toBe("frozen");
    } finally {
      await releaseLock();
    }
  });
});
