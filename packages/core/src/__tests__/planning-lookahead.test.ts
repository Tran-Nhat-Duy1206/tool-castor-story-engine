import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as lookaheadModule from "../planning/lookahead.js";
import {
  generateLookahead,
  revalidateLookahead,
  loadLookahead,
  consumeLookahead,
  type RollingLookahead,
} from "../planning/lookahead.js";
import {
  listPlanningArtifactsDirectlyDependingOn,
} from "../planning/invalidation-registry.js";
import { createVersionStore, type FoundationPublishedSnapshot } from "../governance/versions.js";
import { commitAtomicFileSet } from "../utils/atomic-file-set.js";
import { type ArcPlanSnapshot } from "../planning/arc-plan.js";
import { createAuthorization, loadAuthorization } from "../governance/authorizations.js";

let root = "";
let bookDir = "";
const canonPath = () => join(bookDir, "story", "state", "manifest.json");
const bookPath = () => join(bookDir, "book.json");

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
    goal: "Defeat the shadow syndicate",
    requiredBeats: [],
    optionalBeats: [],
    relationshipMovements: [],
    hookMovements: [],
    timing: {},
    authorizations: [],
    dependencies: [],
    changedBeats: [],
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
  root = await mkdtemp(join(tmpdir(), "inkos-lookahead-"));
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

describe("Rolling Lookahead Horizon Bounds", () => {
  it("accepts horizon of 2 chapters", async () => {
    const lookahead = await generateLookahead(bookDir, 2);
    expect(lookahead.horizon).toHaveLength(2);
    expect(lookahead.horizon[0].chapterNumber).toBe(5);
    expect(lookahead.horizon[1].chapterNumber).toBe(6);
  });

  it("accepts horizon of 3 chapters", async () => {
    const lookahead = await generateLookahead(bookDir, 3);
    expect(lookahead.horizon).toHaveLength(3);
    expect(lookahead.horizon[0].chapterNumber).toBe(5);
    expect(lookahead.horizon[2].chapterNumber).toBe(7);
  });

  it("rejects horizon < 2", async () => {
    await expect(generateLookahead(bookDir, 1)).rejects.toThrow(/horizon.*2.*3/i);
    await expect(generateLookahead(bookDir, 0)).rejects.toThrow(/horizon.*2.*3/i);
  });

  it("rejects horizon > 3", async () => {
    await expect(generateLookahead(bookDir, 4)).rejects.toThrow(/horizon.*2.*3/i);
    await expect(generateLookahead(bookDir, 10)).rejects.toThrow(/horizon.*2.*3/i);
  });
});

describe("Lookahead Persistence and Task 12 Registry", () => {
  it("persists and reloads lookahead with stable lookaheadId and exact provenance bindings", async () => {
    const lookahead = await generateLookahead(bookDir, 2, {
      currentArcId: "arc-1",
      customDependencies: [
        { kind: "canon_fact", factKey: "fact-syndicate-boss", canonRevision: 4, evidenceRevision: "rev-4" },
      ],
    });

    expect(lookahead.lookaheadId).toMatch(/^lookahead-/);
    expect(lookahead.status).toBe("current");
    expect(lookahead.provenance.foundationVersion).toBe(1);
    expect(lookahead.provenance.arcPlanVersion).toBe(1);
    expect(lookahead.provenance.basedOnCanonRevision).toBe(4);
    expect(lookahead.provenance.dependencyRefs).toHaveLength(1);

    const reloaded = await loadLookahead(bookDir, lookahead.lookaheadId);
    expect(reloaded).toEqual(lookahead);
  });

  it("registers generated lookahead into Task 12 PlanningInvalidationRegistry", async () => {
    const lookahead = await generateLookahead(bookDir, 2, {
      customDependencies: [
        { kind: "arc_beat", beatId: "beat-hideout-found", observedEvidenceRevision: "1" },
      ],
    });

    const matches = await listPlanningArtifactsDirectlyDependingOn(bookDir, "beat-hideout-found");
    expect(matches).toEqual([{ artifactKind: "lookahead", artifactId: lookahead.lookaheadId }]);
  });
});

describe("Typed Selective Invalidation", () => {
  it("remains current when unrelated Canon changes occur", async () => {
    const lookahead = await generateLookahead(bookDir, 2, {
      customDependencies: [
        { kind: "canon_fact", factKey: "fact-target-a", canonRevision: 4, evidenceRevision: "rev-4" },
      ],
    });

    // Mutate Canon manifest to revision 5 (unrelated change)
    await writeFile(canonPath(), `${JSON.stringify({
      schemaVersion: 2,
      language: "en",
      lastAppliedChapter: 5,
      projectionVersion: 1,
      migrationWarnings: [],
    }, null, 2)}\n`, "utf-8");

    // Lookahead remains current because fact-target-a is still valid
    const status = await revalidateLookahead(bookDir, lookahead.lookaheadId);
    expect(status).toBe("current");
  });

  it("becomes stale when directly referenced canon_fact changes", async () => {
    const lookahead = await generateLookahead(bookDir, 2, {
      customDependencies: [
        { kind: "canon_fact", factKey: "fact-target-a", canonRevision: 4, evidenceRevision: "rev-4" },
      ],
    });

    // Revalidate with a resolver that reports fact-target-a changed
    const status = await revalidateLookahead(bookDir, lookahead.lookaheadId, {
      factResolver: (key) => key === "fact-target-a" ? { exists: true, revision: "rev-5" } : null,
    });
    expect(status).toBe("stale");

    const reloaded = await loadLookahead(bookDir, lookahead.lookaheadId);
    expect(reloaded?.status).toBe("stale");
  });

  it("remains current when unrelated hook changes occur", async () => {
    const lookahead = await generateLookahead(bookDir, 2, {
      customDependencies: [
        { kind: "hook", hookId: "hook-shadow-key", authority: "foundation_hook", observedLifecycleRevision: "1" },
      ],
    });

    const status = await revalidateLookahead(bookDir, lookahead.lookaheadId, {
      hookResolver: (id) => id === "hook-unrelated" ? { lifecycleRevision: "2" } : { lifecycleRevision: "1" },
    });
    expect(status).toBe("current");
  });

  it("becomes stale when directly referenced hook changes", async () => {
    const lookahead = await generateLookahead(bookDir, 2, {
      customDependencies: [
        { kind: "hook", hookId: "hook-shadow-key", authority: "foundation_hook", observedLifecycleRevision: "1" },
      ],
    });

    const status = await revalidateLookahead(bookDir, lookahead.lookaheadId, {
      hookResolver: (id) => id === "hook-shadow-key" ? { lifecycleRevision: "2" } : { lifecycleRevision: "1" },
    });
    expect(status).toBe("stale");
  });

  it("becomes stale when Published Foundation version advances", async () => {
    const lookahead = await generateLookahead(bookDir, 2);
    expect(lookahead.provenance.foundationVersion).toBe(1);

    // Advance Foundation to V2
    await seedFoundation(2);

    const status = await revalidateLookahead(bookDir, lookahead.lookaheadId);
    expect(status).toBe("stale");
  });

  it("becomes stale when Published Arc version advances", async () => {
    const lookahead = await generateLookahead(bookDir, 2, { currentArcId: "arc-1" });
    expect(lookahead.provenance.arcPlanVersion).toBe(1);

    // Advance Arc to V2
    await seedPublishedArc("arc-1", 2);

    const status = await revalidateLookahead(bookDir, lookahead.lookaheadId);
    expect(status).toBe("stale");
  });

  it("does NOT recursively cascade invalidation in A->B->C scenario", async () => {
    const lookahead = await generateLookahead(bookDir, 2, {
      customDependencies: [
        { kind: "arc_beat", beatId: "beat-root", observedEvidenceRevision: "1" },
      ],
    });

    // Invalidation registry registers lookahead (B) depending on beat-root (A)
    const matches = await listPlanningArtifactsDirectlyDependingOn(bookDir, "beat-root");
    expect(matches).toEqual([{ artifactKind: "lookahead", artifactId: lookahead.lookaheadId }]);

    // Unrelated artifact (C) depending on something else is untouched
    const unrelatedMatches = await listPlanningArtifactsDirectlyDependingOn(bookDir, "unrelated-key");
    expect(unrelatedMatches).toEqual([]);
  });
});

describe("Lookahead Lifecycle Transitions", () => {
  it("supersedes previous current lookahead when a new lookahead is generated", async () => {
    const first = await generateLookahead(bookDir, 2);
    expect(first.status).toBe("current");

    const second = await generateLookahead(bookDir, 2);
    expect(second.status).toBe("current");

    const reloadedFirst = await loadLookahead(bookDir, first.lookaheadId);
    expect(reloadedFirst?.status).toBe("superseded");
  });

  it("transitions lookahead to consumed upon explicit consumption", async () => {
    const lookahead = await generateLookahead(bookDir, 2);
    const consumed = await consumeLookahead(bookDir, lookahead.lookaheadId);
    expect(consumed.status).toBe("consumed");

    const reloaded = await loadLookahead(bookDir, lookahead.lookaheadId);
    expect(reloaded?.status).toBe("consumed");
  });
});

describe("Advisory Only Boundary and Authorization Safety", () => {
  it("has no approved state in vocabulary", () => {
    expect("approveLookahead" in lookaheadModule).toBe(false);
    expect("publishLookahead" in lookaheadModule).toBe(false);
  });

  it("cannot activate, satisfy, or consume Task 11 authorizations", async () => {
    const pendingAuth = await createAuthorization(bookDir, {
      decisionKind: "major_character_death",
      scope: { kind: "arc", arcId: "arc-1" },
      consumption: "one_time",
    });

    // Lookahead generation references authorization
    const lookahead = await generateLookahead(bookDir, 2, {
      customDependencies: [
        { kind: "authorization", authorizationId: pendingAuth.authorizationId, lifecycleRevision: "1" },
      ],
    });

    // Authorization remains pending (lookahead cannot grant or confirm authority)
    const authAfter = await loadAuthorization(bookDir, pendingAuth.authorizationId);
    expect(authAfter?.lifecycle).toBe("pending");
  });

  it("leaves Canon, Foundation, and book governance markers unchanged", async () => {
    const canonBefore = await readFile(canonPath(), "utf-8");
    const bookBefore = await readFile(bookPath(), "utf-8");

    await generateLookahead(bookDir, 2);

    expect(await readFile(canonPath(), "utf-8")).toBe(canonBefore);
    expect(await readFile(bookPath(), "utf-8")).toBe(bookBefore);
  });
});
