import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildDetailedPlan,
  loadDetailedPlan,
  replanChapter,
  planScopeTooBroad,
  type DetailedChapterPlanRecord,
  type DetailedPlanBindings,
} from "../planning/detailed-plan.js";
import {
  ChapterIntentSchema,
  ChapterMemoSchema,
  type ChapterIntent,
  type ChapterMemo,
} from "../models/input-governance.js";
import {
  createAuthorization,
  confirmAuthorization,
  loadAuthorization,
  parseHumanDirectionDraft,
  confirmHumanDirection,
} from "../governance/authorizations.js";
import {
  listPlanningArtifactsDirectlyDependingOn,
} from "../planning/invalidation-registry.js";
import { createVersionStore, type FoundationPublishedSnapshot } from "../governance/versions.js";
import { commitAtomicFileSet } from "../utils/atomic-file-set.js";
import { type ArcPlanSnapshot } from "../planning/arc-plan.js";

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
  root = await mkdtemp(join(tmpdir(), "castor-detailed-plan-"));
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

describe("Detailed Plan Durability and Restart Survival", () => {
  it("buildDetailedPlan persists and returns planId", async () => {
    const { planId } = await buildDetailedPlan(bookDir, 5, {
      intent: sampleIntent(5),
      memo: sampleMemo(5),
    });
    expect(planId).toMatch(/^plan-ch5-/);

    const loaded = await loadDetailedPlan(bookDir, planId);
    expect(loaded).not.toBeNull();
    expect(loaded?.planId).toBe(planId);
    expect(loaded?.chapterNumber).toBe(5);
    expect(loaded?.status).toBe("draft");
  });

  it("loadDetailedPlan round-trips exact record and survives simulated restart", async () => {
    const { planId } = await buildDetailedPlan(bookDir, 5, {
      intent: sampleIntent(5),
      memo: sampleMemo(5),
    });

    // Fresh load (simulating restart)
    const plan = await loadDetailedPlan(bookDir, planId);
    expect(plan).not.toBeNull();
    expect(plan?.intent.goal).toBe("Infiltrate shadow cellar");
    expect(plan?.memo.chapter).toBe(5);
    expect(plan?.bindings.foundationVersion).toBe(1);
    expect(plan?.bindings.arcPlanVersion).toBe(1);
    expect(plan?.bindings.canonRevision).toBe(4);
    expect(plan?.planHash).toMatch(/^[a-f0-9]{16,64}$/);
  });

  it("fails closed on unsafe planId", async () => {
    await expect(loadDetailedPlan(bookDir, "../escape")).rejects.toThrow();
    await expect(loadDetailedPlan(bookDir, "")).rejects.toThrow();
  });
});

describe("Six Authority Bindings and Filtering", () => {
  it("binds all six authority dimensions explicitly", async () => {
    // Seed active Human Direction for chapter 5
    const proposal = await parseHumanDirectionDraft(
      bookDir,
      "In chapter 5, make the cellar darker and colder",
      { canonRevision: 4, arcPlanVersion: 1 },
    );
    const { directionId } = await confirmHumanDirection(bookDir, proposal.directionId, "author-alice");

    // Seed active Authorization
    const { authorizationId } = await createAuthorization(bookDir, {
      decisionKind: "major_character_death",
      scope: { kind: "exact_chapter", chapterNumber: 5 },
      consumption: "one_time",
    });
    await confirmAuthorization(bookDir, authorizationId, "author-alice");

    const { planId } = await buildDetailedPlan(bookDir, 5, {
      intent: sampleIntent(5),
      memo: sampleMemo(5),
      currentArcId: "arc-1",
    });

    const plan = await loadDetailedPlan(bookDir, planId);
    expect(plan?.bindings.foundationVersion).toBe(1);
    expect(plan?.bindings.arcPlanVersion).toBe(1);
    expect(plan?.bindings.canonRevision).toBe(4);
    expect(plan?.bindings.humanDirectionIds).toContain(directionId);
    expect(plan?.bindings.authorizationIds).toContain(authorizationId);
    expect(plan?.bindings.dependencyRefs.length).toBeGreaterThan(0);
  });

  it("excludes pending directions, pending authorizations, and out-of-scope authorities", async () => {
    // 1. Pending Direction (not confirmed)
    const proposal = await parseHumanDirectionDraft(
      bookDir,
      "In chapter 5, pending draft suggestion",
      { canonRevision: 4, arcPlanVersion: 1 },
    );

    // 2. Pending Authorization (not confirmed)
    const pendingAuth = await createAuthorization(bookDir, {
      decisionKind: "major_character_death",
      scope: { kind: "exact_chapter", chapterNumber: 5 },
      consumption: "one_time",
    });

    // 3. Out-of-scope active Authorization (applies to ch 9, not ch 5)
    const outOfScopeAuth = await createAuthorization(bookDir, {
      decisionKind: "identity_reveal",
      scope: { kind: "exact_chapter", chapterNumber: 9 },
      consumption: "one_time",
    });
    await confirmAuthorization(bookDir, outOfScopeAuth.authorizationId, "author-alice");

    const { planId } = await buildDetailedPlan(bookDir, 5, {
      intent: sampleIntent(5),
      memo: sampleMemo(5),
    });

    const plan = await loadDetailedPlan(bookDir, planId);
    expect(plan?.bindings.humanDirectionIds).not.toContain(proposal.directionId);
    expect(plan?.bindings.authorizationIds).not.toContain(pendingAuth.authorizationId);
    expect(plan?.bindings.authorizationIds).not.toContain(outOfScopeAuth.authorizationId);
  });

  it("planning NEVER consumes authorizations", async () => {
    const auth = await createAuthorization(bookDir, {
      decisionKind: "major_character_death",
      scope: { kind: "exact_chapter", chapterNumber: 5 },
      consumption: "one_time",
    });
    await confirmAuthorization(bookDir, auth.authorizationId, "author-alice");

    await buildDetailedPlan(bookDir, 5, {
      intent: sampleIntent(5),
      memo: sampleMemo(5),
    });

    const loadedAuth = await loadAuthorization(bookDir, auth.authorizationId);
    expect(loadedAuth?.lifecycle).toBe("active");
  });
});

describe("Plan Hash and Distinct Identity", () => {
  it("produces stable planHash for same identity and changes hash upon mutation", async () => {
    const { planId: planAId } = await buildDetailedPlan(bookDir, 5, {
      intent: sampleIntent(5),
      memo: sampleMemo(5),
    });
    const planA = await loadDetailedPlan(bookDir, planAId);

    const { planId: planBId } = await buildDetailedPlan(bookDir, 5, {
      intent: { ...sampleIntent(5), goal: "Completely mutated goal" },
      memo: sampleMemo(5),
    });
    const planB = await loadDetailedPlan(bookDir, planBId);

    expect(planA?.planHash).not.toBe(planB?.planHash);
    expect(planAId).not.toBe(planBId);
  });

  it("preserves historical Plan A when Replan B is generated", async () => {
    const { planId: planAId } = await buildDetailedPlan(bookDir, 5, {
      intent: sampleIntent(5),
      memo: sampleMemo(5),
    });

    const { planId: planBId } = await replanChapter(bookDir, 5, 1, {
      intent: { ...sampleIntent(5), goal: "Replan goal" },
      memo: sampleMemo(5),
    });

    expect(planAId).not.toBe(planBId);

    const planA = await loadDetailedPlan(bookDir, planAId);
    const planB = await loadDetailedPlan(bookDir, planBId);

    expect(planA).not.toBeNull();
    expect(planB).not.toBeNull();
    expect(planA?.intent.goal).toBe("Infiltrate shadow cellar");
    expect(planB?.intent.goal).toBe("Replan goal");
  });
});

describe("Plan Scope and PLAN_SCOPE_TOO_BROAD", () => {
  it("detects acceptable plan scope as valid", () => {
    const ok = planScopeTooBroad({
      intent: sampleIntent(5),
      memo: sampleMemo(5),
    });
    expect(ok).toBe(false);
  });

  it("detects overflow as PLAN_SCOPE_TOO_BROAD instead of silently dropping context", () => {
    const hugeMustKeep = Array.from({ length: 60 }, (_, i) => `Mandatory requirement ${i}`);
    const tooBroad = planScopeTooBroad({
      intent: { ...sampleIntent(5), mustKeep: hugeMustKeep },
      memo: sampleMemo(5),
    });
    expect(tooBroad).toBe(true);
  });
});

describe("Replan Limits (1 Initial + Max 2 Replans)", () => {
  it("allows initial plan, Replan #1, and Replan #2, but refuses Replan #3", async () => {
    // Initial plan
    const { planId: initialId } = await buildDetailedPlan(bookDir, 5, {
      intent: sampleIntent(5),
      memo: sampleMemo(5),
    });
    expect(initialId).toMatch(/^plan-ch5-/);

    // Replan #1
    const { planId: replan1Id } = await replanChapter(bookDir, 5, 1, {
      intent: sampleIntent(5),
      memo: sampleMemo(5),
    });
    expect(replan1Id).toMatch(/^plan-ch5-/);

    // Replan #2
    const { planId: replan2Id } = await replanChapter(bookDir, 5, 2, {
      intent: sampleIntent(5),
      memo: sampleMemo(5),
    });
    expect(replan2Id).toMatch(/^plan-ch5-/);

    // Replan #3 must be refused and route to human
    await expect(replanChapter(bookDir, 5, 3, {
      intent: sampleIntent(5),
      memo: sampleMemo(5),
    })).rejects.toThrow(/maximum 2 automatic replans/i);
  });
});

describe("Task 12 PlanningInvalidationRegistry Integration", () => {
  it("registers detailed plan in registry with artifactKind detailed_plan", async () => {
    const { planId } = await buildDetailedPlan(bookDir, 5, {
      intent: sampleIntent(5),
      memo: sampleMemo(5),
      customBindings: {
        dependencyRefs: [
          { kind: "arc_beat", beatId: "beat-infiltrate", observedEvidenceRevision: "1" },
        ],
      },
    });

    const matches = await listPlanningArtifactsDirectlyDependingOn(bookDir, "beat-infiltrate");
    expect(matches).toEqual([{ artifactKind: "detailed_plan", artifactId: planId }]);
  });
});

describe("ChapterIntent and ChapterMemo Schema Compatibility", () => {
  it("parses existing legacy ChapterIntent and ChapterMemo without Phase 5 fields", () => {
    const legacyIntent = {
      chapter: 1,
      goal: "Introduce hero",
      mustKeep: ["Hero name is Bob"],
      mustAvoid: ["Talking about secret"],
      styleEmphasis: ["Intrigue"],
    };
    const parsedIntent = ChapterIntentSchema.parse(legacyIntent);
    expect(parsedIntent.chapter).toBe(1);
    expect(parsedIntent.humanDirectionIds ?? []).toEqual([]);
    expect(parsedIntent.authorizationIds ?? []).toEqual([]);
    expect(parsedIntent.dependencyRefs ?? []).toEqual([]);

    const legacyMemo = {
      chapter: 1,
      goal: "Introduce hero",
      body: "Body text",
    };
    const parsedMemo = ChapterMemoSchema.parse(legacyMemo);
    expect(parsedMemo.chapter).toBe(1);
    expect(parsedMemo.isGoldenOpening).toBe(false);
  });
});

describe("Authority Safety", () => {
  it("leaves Canon, Foundation, Arc authority, and book governance unchanged", async () => {
    const canonBefore = await readFile(canonPath(), "utf-8");
    const bookBefore = await readFile(bookPath(), "utf-8");

    await buildDetailedPlan(bookDir, 5, {
      intent: sampleIntent(5),
      memo: sampleMemo(5),
    });

    expect(await readFile(canonPath(), "utf-8")).toBe(canonBefore);
    expect(await readFile(bookPath(), "utf-8")).toBe(bookBefore);
  });
});
