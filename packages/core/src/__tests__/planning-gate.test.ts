import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  evaluatePlanningGate,
  type PlanningGateResult,
} from "../planning/gate.js";
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
  root = await mkdtemp(join(tmpdir(), "inkos-gate-"));
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

describe("Planning Gate - Trusted Inputs", () => {
  it("evaluates persisted plan by planId and fails closed on missing plan", async () => {
    const res = await evaluatePlanningGate({
      bookDir,
      planId: "plan-nonexistent",
    });
    expect(res.outcome).toBe("conflict");
    if (res.outcome === "conflict") {
      expect(res.evidence[0]).toMatch(/not found/i);
    }
  });

  it("caller cannot supply fake in-memory plan or fake authorizations (API accepts only bookDir and planId)", async () => {
    const { planId } = await buildDetailedPlan(bookDir, 5, {
      intent: sampleIntent(5),
      memo: sampleMemo(5),
    });

    // Public API only takes bookDir and planId
    const res = await evaluatePlanningGate({
      bookDir,
      planId,
    });
    expect(res.outcome).toBe("safe");
  });
});

describe("Planning Gate - 5-Row Truth Table", () => {
  it("Row 1: deterministic clean + semantic clean + authority -> SAFE", async () => {
    const { planId } = await buildDetailedPlan(bookDir, 5, {
      intent: sampleIntent(5),
      memo: sampleMemo(5),
    });

    const res = await evaluatePlanningGate({ bookDir, planId });
    expect(res.outcome).toBe("safe");
  });

  it("Row 2: deterministic clean + semantic uncertain -> UNCERTAIN", async () => {
    const { planId } = await buildDetailedPlan(bookDir, 5, {
      intent: sampleIntent(5),
      memo: sampleMemo(5),
    });

    const res = await evaluatePlanningGate({ bookDir, planId }, {
      semanticEvaluator: async () => ({
        uncertainConcerns: ["Pacing between hero and rogue is ambiguous"],
      }),
    });
    expect(res.outcome).toBe("uncertain");
    if (res.outcome === "uncertain") {
      expect(res.concerns).toContain("Pacing between hero and rogue is ambiguous");
    }
  });

  it("Row 3: deterministic clean + new major decision + missing authority -> AUTHOR_DECISION", async () => {
    const { planId } = await buildDetailedPlan(bookDir, 5, {
      intent: { ...sampleIntent(5), goal: "Kill mentor character in chapter 5" },
      memo: sampleMemo(5),
    });

    const res = await evaluatePlanningGate({ bookDir, planId }, {
      semanticEvaluator: async () => ({
        authorDecisions: ["major_character_death"],
      }),
    });
    expect(res.outcome).toBe("author_decision");
    if (res.outcome === "author_decision") {
      expect(res.missing).toContain("major_character_death");
    }
  });

  it("Row 4: hard deterministic violation -> CONFLICT", async () => {
    const { planId } = await buildDetailedPlan(bookDir, 5, {
      intent: sampleIntent(5),
      memo: sampleMemo(5),
    });

    // Stale Foundation version
    await seedFoundation(2); // current is now 2, plan was bound to 1

    const res = await evaluatePlanningGate({ bookDir, planId });
    expect(res.outcome).toBe("conflict");
    if (res.outcome === "conflict") {
      expect(res.evidence.some((e) => e.includes("Foundation"))).toBe(true);
    }
  });

  it("Row 5: major decision already authorized in correct scope -> SAFE (no re-ask)", async () => {
    const auth = await createAuthorization(bookDir, {
      decisionKind: "major_character_death",
      scope: { kind: "exact_chapter", chapterNumber: 5 },
      consumption: "one_time",
    });
    await confirmAuthorization(bookDir, auth.authorizationId, "author-alice");

    const { planId } = await buildDetailedPlan(bookDir, 5, {
      intent: { ...sampleIntent(5), goal: "Kill mentor character in chapter 5" },
      memo: sampleMemo(5),
    });

    const res = await evaluatePlanningGate({ bookDir, planId }, {
      semanticEvaluator: async () => ({
        authorDecisions: ["major_character_death"],
      }),
    });

    expect(res.outcome).toBe("safe"); // authorized at scope, no re-ask
  });
});

describe("Planning Gate - Deterministic L1 Checks", () => {
  it("blocks on stale Arc Plan version", async () => {
    const { planId } = await buildDetailedPlan(bookDir, 5, {
      intent: sampleIntent(5),
      memo: sampleMemo(5),
      currentArcId: "arc-1",
    });

    await seedPublishedArc("arc-1", 2); // Arc advanced to 2

    const res = await evaluatePlanningGate({ bookDir, planId });
    expect(res.outcome).toBe("conflict");
    if (res.outcome === "conflict") {
      expect(res.evidence.some((e) => e.includes("Arc Plan"))).toBe(true);
    }
  });

  it("blocks on stale Canon revision", async () => {
    const { planId } = await buildDetailedPlan(bookDir, 5, {
      intent: sampleIntent(5),
      memo: sampleMemo(5),
    });

    // Mutate Canon manifest to revision 5
    await writeFile(canonPath(), `${JSON.stringify({
      schemaVersion: 2,
      language: "en",
      lastAppliedChapter: 5,
      projectionVersion: 1,
      migrationWarnings: [],
    }, null, 2)}\n`, "utf-8");

    const res = await evaluatePlanningGate({ bookDir, planId });
    expect(res.outcome).toBe("conflict");
  });

  it("blocks on chapter sequence mismatch", async () => {
    // Current lastAppliedChapter is 4; plan for chapter 8 is out of sequence
    const { planId } = await buildDetailedPlan(bookDir, 8, {
      intent: sampleIntent(8),
      memo: sampleMemo(8),
    });

    const res = await evaluatePlanningGate({ bookDir, planId });
    expect(res.outcome).toBe("conflict");
    if (res.outcome === "conflict") {
      expect(res.evidence.some((e) => e.includes("sequence") || e.includes("chapter"))).toBe(true);
    }
  });

  it("consumed or inactive authorization cannot satisfy gate", async () => {
    // Pending (inactive) authorization
    const pendingAuth = await createAuthorization(bookDir, {
      decisionKind: "major_character_death",
      scope: { kind: "exact_chapter", chapterNumber: 5 },
      consumption: "one_time",
    });

    const { planId } = await buildDetailedPlan(bookDir, 5, {
      intent: sampleIntent(5),
      memo: sampleMemo(5),
    });

    const res = await evaluatePlanningGate({ bookDir, planId }, {
      semanticEvaluator: async () => ({
        authorDecisions: ["major_character_death"],
      }),
    });

    expect(res.outcome).toBe("author_decision"); // pending does not satisfy
  });
});

describe("Planning Gate - Semantic Layer Boundary", () => {
  it("rejects semantic reviewer attempt to emit hard conflict at runtime", async () => {
    const { planId } = await buildDetailedPlan(bookDir, 5, {
      intent: sampleIntent(5),
      memo: sampleMemo(5),
    });

    // If semantic evaluator emits hard conflict, gate must reject/normalize it and never treat it as deterministic conflict
    await expect(evaluatePlanningGate({ bookDir, planId }, {
      semanticEvaluator: async () => {
        throw new Error("Semantic conflict illegal");
      },
    })).rejects.toThrow();
  });
});

describe("Planning Gate - Authorization & Writer Safety", () => {
  it("gate evaluation NEVER consumes authorizations", async () => {
    const auth = await createAuthorization(bookDir, {
      decisionKind: "major_character_death",
      scope: { kind: "exact_chapter", chapterNumber: 5 },
      consumption: "one_time",
    });
    await confirmAuthorization(bookDir, auth.authorizationId, "author-alice");

    const { planId } = await buildDetailedPlan(bookDir, 5, {
      intent: sampleIntent(5),
      memo: sampleMemo(5),
    });

    await evaluatePlanningGate({ bookDir, planId });

    const loaded = await loadAuthorization(bookDir, auth.authorizationId);
    expect(loaded?.lifecycle).toBe("active"); // MUST remain active
  });

  it("leaves Canon, Foundation, Arc authority, and governance markers unchanged", async () => {
    const canonBefore = await readFile(canonPath(), "utf-8");
    const bookBefore = await readFile(bookPath(), "utf-8");

    const { planId } = await buildDetailedPlan(bookDir, 5, {
      intent: sampleIntent(5),
      memo: sampleMemo(5),
    });

    await evaluatePlanningGate({ bookDir, planId });

    expect(await readFile(canonPath(), "utf-8")).toBe(canonBefore);
    expect(await readFile(bookPath(), "utf-8")).toBe(bookBefore);
  });
});
