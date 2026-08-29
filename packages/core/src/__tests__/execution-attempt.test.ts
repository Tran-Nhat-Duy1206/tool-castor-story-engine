import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createExecutionAttempt,
  loadExecutionAttempt,
  recordAttemptRunning,
  recordAttemptDrafted,
  recordAttemptFailure,
  abortAttemptForPlanDefect,
  acceptAttempt,
  classifyAttemptDefect,
  type ExecutionAttempt,
} from "../execution/attempt.js";
import {
  freezeExecutionSnapshot,
  loadExecutionSnapshot,
  type ExecutionSnapshot,
} from "../execution/snapshot.js";
import {
  buildDetailedPlan,
  loadDetailedPlan,
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
  root = await mkdtemp(join(tmpdir(), "castor-exec-attempt-"));
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

async function helperFreezeSnapshot(chapterNumber = 5): Promise<ExecutionSnapshot> {
  const { planId } = await buildDetailedPlan(bookDir, chapterNumber, {
    intent: sampleIntent(chapterNumber),
    memo: sampleMemo(chapterNumber),
  });
  const plan = (await loadDetailedPlan(bookDir, planId))!;
  const bundle = await composeContext({
    bookDir,
    profile: "writer_context",
    subject: { kind: "detailed_plan", planId, planHash: plan.planHash },
  });
  const res = await freezeExecutionSnapshot(bookDir, planId, bundle);
  if (res.status !== "frozen") {
    throw new Error(`Failed to freeze helper snapshot: ${res.reason}`);
  }
  return res.snapshot;
}

describe("Execution Attempt Lifecycle and Invariants", () => {
  it("creates durable execution attempt linked to snapshot with valid replanNumber (0..2)", async () => {
    const snapshot = await helperFreezeSnapshot(5);

    // Initial attempt (replanNumber = 0)
    const att0 = await createExecutionAttempt(bookDir, snapshot.snapshotId, 5, 0);
    expect(att0.snapshotId).toBe(snapshot.snapshotId);
    expect(att0.chapterNumber).toBe(5);
    expect(att0.replanNumber).toBe(0);
    expect(att0.status).toBe("created");

    // Replan 1 (replanNumber = 1)
    const att1 = await createExecutionAttempt(bookDir, snapshot.snapshotId, 5, 1);
    expect(att1.replanNumber).toBe(1);

    // Replan 2 (replanNumber = 2)
    const att2 = await createExecutionAttempt(bookDir, snapshot.snapshotId, 5, 2);
    expect(att2.replanNumber).toBe(2);

    // Replan 3+ forbidden -> throws
    await expect(createExecutionAttempt(bookDir, snapshot.snapshotId, 5, 3)).rejects.toThrow();
    // Negative replan forbidden -> throws
    await expect(createExecutionAttempt(bookDir, snapshot.snapshotId, 5, -1)).rejects.toThrow();
  });

  it("follows deterministic lifecycle transitions (created -> running -> drafted -> accepted)", async () => {
    const snapshot = await helperFreezeSnapshot(5);
    const attempt = await createExecutionAttempt(bookDir, snapshot.snapshotId, 5, 0);

    // 1. created -> running
    await recordAttemptRunning(bookDir, attempt.attemptId);
    let loaded = await loadExecutionAttempt(bookDir, attempt.attemptId);
    expect(loaded?.status).toBe("running");

    // 2. running -> drafted
    await recordAttemptDrafted(bookDir, attempt.attemptId, ["story/drafts/ch5-att1.md"]);
    loaded = await loadExecutionAttempt(bookDir, attempt.attemptId);
    expect(loaded?.status).toBe("drafted");
    expect(loaded?.draftArtifactRefs).toEqual(["story/drafts/ch5-att1.md"]);

    // 3. drafted -> accepted
    await acceptAttempt(bookDir, attempt.attemptId);
    loaded = await loadExecutionAttempt(bookDir, attempt.attemptId);
    expect(loaded?.status).toBe("accepted");

    // 4. illegal transition: accepted -> running (must throw)
    await expect(recordAttemptRunning(bookDir, attempt.attemptId)).rejects.toThrow();
  });

  it("handles provider failure durably without mutating Snapshot or Canon", async () => {
    const snapshot = await helperFreezeSnapshot(5);
    const attempt = await createExecutionAttempt(bookDir, snapshot.snapshotId, 5, 0);
    await recordAttemptRunning(bookDir, attempt.attemptId);

    const canonBefore = await readFile(canonPath(), "utf-8");

    await recordAttemptFailure(bookDir, attempt.attemptId, {
      provider: "mock-llm",
      model: "mock-model",
      message: "Connection timeout to provider",
      at: new Date().toISOString(),
    });

    const loaded = await loadExecutionAttempt(bookDir, attempt.attemptId);
    expect(loaded?.status).toBe("failed");
    expect(loaded?.providerFailure?.provider).toBe("mock-llm");

    // Snapshot remains unchanged
    const loadedSnapshot = await loadExecutionSnapshot(bookDir, snapshot.snapshotId);
    expect(loadedSnapshot).toEqual(snapshot);

    // Canon remains unchanged
    expect(await readFile(canonPath(), "utf-8")).toBe(canonBefore);
  });

  it("handles plan defect abortion durably (aborted_for_plan_defect)", async () => {
    const snapshot = await helperFreezeSnapshot(5);
    const attempt = await createExecutionAttempt(bookDir, snapshot.snapshotId, 5, 0);
    await recordAttemptRunning(bookDir, attempt.attemptId);

    await abortAttemptForPlanDefect(bookDir, attempt.attemptId, "Scene contradicted arc turn beat");
    const loaded = await loadExecutionAttempt(bookDir, attempt.attemptId);
    expect(loaded?.status).toBe("aborted_for_plan_defect");
    expect(loaded?.defect).toBe("plan_defect");

    // Illegal to transition aborted -> running
    await expect(recordAttemptRunning(bookDir, attempt.attemptId)).rejects.toThrow();
  });
});

describe("Attempt Defect Classification", () => {
  it("classifies prose_defect, plan_defect, authority_defect, and canon_conflict", () => {
    expect(classifyAttemptDefect({ kind: "prose_defect" })).toEqual({
      status: "prose_defect",
      next: "revise_same_snapshot",
    });
    expect(classifyAttemptDefect({ kind: "plan_defect" })).toEqual({
      status: "plan_defect",
      next: "fresh_plan_and_snapshot",
    });
    expect(classifyAttemptDefect({ kind: "authority_defect" })).toEqual({
      status: "authority_defect",
      next: "authority_resolver",
    });
    expect(classifyAttemptDefect({ kind: "canon_conflict" })).toEqual({
      status: "canon_conflict",
      next: "hard_stop",
    });
  });
});

describe("Authority and Canon Safety", () => {
  it("acceptAttempt does not mutate Canon or consume authorizations", async () => {
    const snapshot = await helperFreezeSnapshot(5);
    const attempt = await createExecutionAttempt(bookDir, snapshot.snapshotId, 5, 0);
    await recordAttemptRunning(bookDir, attempt.attemptId);
    await recordAttemptDrafted(bookDir, attempt.attemptId, ["story/drafts/ch5-att1.md"]);

    const canonBefore = await readFile(canonPath(), "utf-8");
    await acceptAttempt(bookDir, attempt.attemptId);

    // Canon manifest must be byte-identical (settlement is in Task 20)
    expect(await readFile(canonPath(), "utf-8")).toBe(canonBefore);
  });
});
