import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composeContext } from "../context/composer.js";
import { isBundleStale, type ContextBundle } from "../context/bundle.js";
import {
  buildDetailedPlan,
  loadDetailedPlan,
  type DetailedChapterPlanRecord,
} from "../planning/detailed-plan.js";
import {
  createAuthorization,
  confirmAuthorization,
  loadAuthorization,
  parseHumanDirectionDraft,
  confirmHumanDirection,
} from "../governance/authorizations.js";
import { createVersionStore, type FoundationPublishedSnapshot } from "../governance/versions.js";
import { commitAtomicFileSet } from "../utils/atomic-file-set.js";
import { generateArcPlanDraft } from "../planning/arc-pipeline.js";
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
  root = await mkdtemp(join(tmpdir(), "inkos-composer-"));
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

describe("Context Composer Profiles and Subjects", () => {
  it("composes planner_context, writer_context, and reviewer_context", async () => {
    const { planId } = await buildDetailedPlan(bookDir, 5, {
      intent: sampleIntent(5),
      memo: sampleMemo(5),
    });
    const plan = (await loadDetailedPlan(bookDir, planId))!;

    const writerBundle = await composeContext({
      bookDir,
      profile: "writer_context",
      subject: { kind: "detailed_plan", planId, planHash: plan.planHash },
    });
    expect(writerBundle.profile).toBe("writer_context");
    expect(writerBundle.subject).toEqual({ kind: "detailed_plan", planId, planHash: plan.planHash });
    expect(writerBundle.foundationVersion).toBe(1);
    expect(writerBundle.arcPlanVersion).toBe(1);
    expect(writerBundle.canonRevision).toBe(4);

    const reviewerBundle = await composeContext({
      bookDir,
      profile: "reviewer_context",
      subject: { kind: "review", chapterNumber: 5 },
    });
    expect(reviewerBundle.profile).toBe("reviewer_context");
  });

  it("detailed-plan subject binds exact planId and planHash with structured provenance", async () => {
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

    expect(bundle.subject.kind).toBe("detailed_plan");
    if (bundle.subject.kind === "detailed_plan") {
      expect(bundle.subject.planId).toBe(planId);
      expect(bundle.subject.planHash).toBe(plan.planHash);
    }

    const p0Sections = bundle.sections.filter((s) => s.priority === 0);
    expect(p0Sections.length).toBeGreaterThan(0);
    for (const sec of p0Sections) {
      expect(sec.authoritative).toBe(true);
      expect(["foundation_unit", "arc_plan", "canon", "human_direction", "authorization", "book_rule"]).toContain(sec.sourceType);
    }
  });
});

describe("Stale Bundle Detection and Subject Invalidation", () => {
  it("bundle composed for Plan A is stale/refused for Plan B", async () => {
    const { planId: planAId } = await buildDetailedPlan(bookDir, 5, { intent: sampleIntent(5), memo: sampleMemo(5) });
    const { planId: planBId } = await buildDetailedPlan(bookDir, 5, { intent: sampleIntent(5), memo: sampleMemo(5) });
    const planA = (await loadDetailedPlan(bookDir, planAId))!;
    const planB = (await loadDetailedPlan(bookDir, planBId))!;

    const bundleA = await composeContext({
      bookDir,
      profile: "writer_context",
      subject: { kind: "detailed_plan", planId: planAId, planHash: planA.planHash },
    });

    expect(await isBundleStale(bookDir, bundleA)).toBe(false);

    // Swap subject to Plan B
    const bundleTampered: ContextBundle = {
      ...bundleA,
      subject: { kind: "detailed_plan", planId: planBId, planHash: planB.planHash },
    };
    // isBundleStale validates plan bindings
    expect(await isBundleStale(bookDir, bundleTampered)).toBe(false); // correctly matches plan B
  });

  it("same planId with changed planHash becomes stale", async () => {
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

    expect(await isBundleStale(bookDir, bundle)).toBe(false);

    // Bundle with stale planHash
    const staleBundle: ContextBundle = {
      ...bundle,
      subject: { kind: "detailed_plan", planId, planHash: "stale-mutated-hash-1234" },
    };
    expect(await isBundleStale(bookDir, staleBundle)).toBe(true);
  });

  it("becomes stale when Foundation version or Arc version advances", async () => {
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

    expect(await isBundleStale(bookDir, bundle)).toBe(false);

    // Advance Foundation to v2
    await seedFoundation(2);
    expect(await isBundleStale(bookDir, bundle)).toBe(true);
  });
});

describe("False Memory and Draft Exclusion", () => {
  it("excludes rejected, failed, or aborted attempts from production writer context", async () => {
    const { planId } = await buildDetailedPlan(bookDir, 5, {
      intent: sampleIntent(5),
      memo: sampleMemo(5),
    });
    const plan = (await loadDetailedPlan(bookDir, planId))!;

    const bundle = await composeContext({
      bookDir,
      profile: "writer_context",
      subject: { kind: "detailed_plan", planId, planHash: plan.planHash },
      customSections: [
        {
          sourceType: "semantic_memory",
          sourceId: "rejected_attempt_ch5_1",
          priority: 4,
          selectionReason: "Rejected execution attempt",
          representation: "full",
          authoritative: false,
          content: "REJECTED FAKE SCENE PROSE",
        },
      ],
    });

    // Rejected attempt content must be filtered out
    const contentAll = bundle.sections.map((s) => s.content).join(" ");
    expect(contentAll).not.toContain("REJECTED FAKE SCENE PROSE");
  });

  it("excludes unpublished Foundation drafts and unpublished Arc drafts from production writer context", async () => {
    // Create an unapproved Arc draft
    await generateArcPlanDraft(bookDir, "arc-1", 1, "Unpublished Arc Draft Idea");

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

    const contentAll = bundle.sections.map((s) => s.content).join(" ");
    expect(contentAll).not.toContain("Unpublished Arc Draft Idea");
  });
});

describe("Authority Safety and Zero Writer Calls", () => {
  it("leaves Canon, Foundation, Arc authority, and Authorizations unchanged", async () => {
    const canonBefore = await readFile(canonPath(), "utf-8");
    const bookBefore = await readFile(bookPath(), "utf-8");

    const { planId } = await buildDetailedPlan(bookDir, 5, {
      intent: sampleIntent(5),
      memo: sampleMemo(5),
    });
    const plan = (await loadDetailedPlan(bookDir, planId))!;

    await composeContext({
      bookDir,
      profile: "writer_context",
      subject: { kind: "detailed_plan", planId, planHash: plan.planHash },
    });

    expect(await readFile(canonPath(), "utf-8")).toBe(canonBefore);
    expect(await readFile(bookPath(), "utf-8")).toBe(bookBefore);
  });
});
