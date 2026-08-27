import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as arcPlanModule from "../planning/arc-plan.js";
import {
  loadArcPlanDraft,
  loadPublishedArcPlan,
  restoreArcPlanAsRevisionDraft,
  saveArcPlanDraft,
  type ArcPlanDraftRecord,
  type ArcPlanSnapshot,
  type ArcPlanVersion,
} from "../planning/arc-plan.js";
import { createVersionStore, type VersionEnvelope } from "../governance/versions.js";
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
    authorizations: ["auth-identity-reveal"],
    dependencies: [
      { kind: "foundation_unit", unitId: "character-hero", contentRevision: 1, approvedRevision: 1, foundationVersion: 1 },
    ],
    changedBeats: ["beat-discover-hideout"],
    changedAuthorizations: ["auth-identity-reveal"],
  };
}

function sampleDraft(draftId = "draft-a", arcId = "arc-1"): ArcPlanDraftRecord {
  return {
    draftId,
    arcId,
    snapshot: sampleSnapshot(arcId),
    draftHash: "hash-draft-12345678",
    foundationVersion: 1,
    baseCanonRevision: 0,
    status: "draft",
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "inkos-arc-plan-"));
  bookDir = join(root, "books", "demo-book");
  await mkdir(join(bookDir, "story", "state"), { recursive: true });
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
});

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("Arc Plan draft storage", () => {
  it("save/load Draft A round-trip by draftId", async () => {
    const draftA = sampleDraft("draft-alpha", "arc-1");
    const result = await saveArcPlanDraft(bookDir, draftA);
    expect(result.draftId).toBe("draft-alpha");
    const loaded = await loadArcPlanDraft(bookDir, "draft-alpha");
    expect(loaded).toEqual(draftA);
  });

  it("Draft A and Draft B for same arcId stay distinct and do not overwrite each other", async () => {
    const draftA = sampleDraft("draft-a", "arc-1");
    const draftB: ArcPlanDraftRecord = {
      ...sampleDraft("draft-b", "arc-1"),
      snapshot: { ...sampleSnapshot("arc-1"), goal: "Alternative goal for B" },
      draftHash: "hash-draft-b-87654321",
    };
    await saveArcPlanDraft(bookDir, draftA);
    await saveArcPlanDraft(bookDir, draftB);

    const loadedA = await loadArcPlanDraft(bookDir, "draft-a");
    const loadedB = await loadArcPlanDraft(bookDir, "draft-b");

    expect(loadedA?.snapshot.goal).toBe("Defeat the shadow syndicate in the capital");
    expect(loadedB?.snapshot.goal).toBe("Alternative goal for B");
  });

  it("fails closed on corrupt or missing draft", async () => {
    expect(await loadArcPlanDraft(bookDir, "non-existent")).toBeNull();

    const corruptPath = join(bookDir, "story", "governance", "arc-plan-drafts", "draft-corrupt.json");
    await mkdir(join(bookDir, "story", "governance", "arc-plan-drafts"), { recursive: true });
    await writeFile(corruptPath, "{not-json", "utf-8");
    await expect(loadArcPlanDraft(bookDir, "draft-corrupt")).rejects.toThrow();
  });

  it("rejects unsafe draftId or arcId", async () => {
    await expect(saveArcPlanDraft(bookDir, sampleDraft("../bad-draft", "arc-1"))).rejects.toThrow();
    await expect(saveArcPlanDraft(bookDir, sampleDraft("draft-ok", "../bad-arc"))).rejects.toThrow();
    await expect(loadArcPlanDraft(bookDir, "../escape")).rejects.toThrow();
  });
});

describe("Published Arc read-only access and restore-to-draft", () => {
  async function seedPublishedArcVersion(arcId: string, version: number, snapshot: ArcPlanSnapshot): Promise<void> {
    const store = createVersionStore(bookDir);
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

  it("loads published Arc plan history as read-only VersionEnvelope and reuses Task 5 type", async () => {
    expect(await loadPublishedArcPlan(bookDir, "arc-1")).toBeNull();

    const snapshot = sampleSnapshot("arc-1");
    await seedPublishedArcVersion("arc-1", 1, snapshot);

    const published = await loadPublishedArcPlan(bookDir, "arc-1");
    expect(published).not.toBeNull();
    expect(published?.artifactKind).toBe("arc_plan");
    expect(published?.unitId).toBe("arc-1");
    expect(published?.version).toBe(1);
    expect(published?.snapshot.goal).toBe(snapshot.goal);

    // Type assignment check
    const _typed: ArcPlanVersion | null = published;
    const _envelope: VersionEnvelope<ArcPlanSnapshot> | null = published;
    expect(_typed?.version).toBe(_envelope?.version);
  });

  it("restore reads historical version and creates a NEW durable Draft C without modifying published authority", async () => {
    const snapshotV1 = sampleSnapshot("arc-1");
    const snapshotV2 = { ...sampleSnapshot("arc-1"), goal: "V2 goal" };
    await seedPublishedArcVersion("arc-1", 1, snapshotV1);
    await seedPublishedArcVersion("arc-1", 2, snapshotV2);

    const beforeRestore = await loadPublishedArcPlan(bookDir, "arc-1");
    expect(beforeRestore?.version).toBe(2);

    const { draftId } = await restoreArcPlanAsRevisionDraft(bookDir, "arc-1", 1);
    expect(draftId).toMatch(/^draft-arc-/);

    // Draft C loads through normal loadArcPlanDraft
    const restoredDraft = await loadArcPlanDraft(bookDir, draftId);
    expect(restoredDraft).not.toBeNull();
    expect(restoredDraft?.snapshot.goal).toBe(snapshotV1.goal);
    expect(restoredDraft?.arcId).toBe("arc-1");
    expect(restoredDraft?.status).toBe("draft");

    // Current published authority is UNCHANGED (still V2)
    const afterRestore = await loadPublishedArcPlan(bookDir, "arc-1");
    expect(afterRestore?.version).toBe(2);
    expect(afterRestore?.snapshot.goal).toBe("V2 goal");

    // VersionStore lists only versions 1 and 2 (no v3 created by restore)
    const store = createVersionStore(bookDir);
    const versions = await store.listVersions("arc_plan", "arc-1");
    expect(versions).toEqual([1, 2]);
  });

  it("fails restore if historical version does not exist or version is invalid", async () => {
    await expect(restoreArcPlanAsRevisionDraft(bookDir, "arc-1", 99)).rejects.toThrow(/not found/i);
    await expect(restoreArcPlanAsRevisionDraft(bookDir, "arc-1", 0)).rejects.toThrow(/invalid/i);
    await expect(restoreArcPlanAsRevisionDraft(bookDir, "arc-1", -1)).rejects.toThrow(/invalid/i);
  });

  it("verifies no publish API exists in Task 12 module", () => {
    expect("publishArcPlan" in arcPlanModule).toBe(false);
    expect("approveArcPlan" in arcPlanModule).toBe(false);
    expect("activateArcPlan" in arcPlanModule).toBe(false);
    expect("advanceArcVersion" in arcPlanModule).toBe(false);
  });

  it("leaves Canon, authorizations, and book governance markers unchanged", async () => {
    const canonBefore = await readFile(canonPath(), "utf-8");
    const bookBefore = await readFile(bookPath(), "utf-8");

    const draft = sampleDraft("draft-x", "arc-1");
    await saveArcPlanDraft(bookDir, draft);

    expect(await readFile(canonPath(), "utf-8")).toBe(canonBefore);
    expect(await readFile(bookPath(), "utf-8")).toBe(bookBefore);

    const parsedBook = JSON.parse(bookBefore);
    expect(parsedBook.governance.planning).toBe("legacy");
  });
});
