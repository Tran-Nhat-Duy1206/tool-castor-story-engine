import { join } from "node:path";
import { readFile, rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureBookMetadata, createCanonBook, type CanonBookFixture } from "./helpers/canon-fixture.js";
import {
  ACTIVE_REVIEW_RELPATH,
  loadStateReview,
  publishActiveProposal,
  saveStateReviewShell,
} from "../state/state-review-store.js";
import { resolveReviewItemEffectiveChange } from "../models/state-review.js";
import type { ActiveStateReviewArtifact, ProposalChange, ReviewItem } from "../models/state-review.js";
import {
  addUserStateReviewItem,
  decideStateReviewItem,
  editStateReviewItem,
  rejectAllAiItems,
  removeUserStateReviewItem,
} from "../state/state-review-service.js";

const CREATED_AT = "2026-08-24T00:00:00.000Z";
const REVIEW_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

// ---------------------------------------------------------------------------
// Item fixtures (hand-built ids are irrelevant to the service; they only need
// to be unique strings within the artifact).
// ---------------------------------------------------------------------------

function factChange(object: string): ProposalChange {
  return { type: "fact", change: { action: "set", subject: "protagonist", predicate: "current-location", object } };
}

function hookRecord(hookId: string) {
  return {
    hookId,
    startChapter: 12,
    type: "mock_text",
    status: "open" as const,
    lastAdvancedChapter: 13,
    expectedPayoff: "",
    notes: "",
  };
}

function baseItems(): ReviewItem[] {
  return [
    {
      id: "current-state-fact:0:explicit",
      kind: "current-state-fact",
      origin: "ai",
      title: "Location change",
      proposal: factChange("mock_text"),
      evidence: { claimedLevel: "explicit", verifiedLevel: "explicit", quote: "mock_text" },
      decision: "undecided",
    },
    {
      id: "current-state-fact:1:inferred",
      kind: "current-state-fact",
      origin: "ai",
      title: "Goal change",
      proposal: factChange("mock_text"),
      evidence: { claimedLevel: "inferred", verifiedLevel: "inferred" },
      decision: "undecided",
    },
    {
      id: "hook-upsert:0:u1",
      kind: "hook-upsert",
      origin: "ai",
      title: "Hook upsert: H09",
      proposal: { type: "hook-upsert", hook: hookRecord("H09") },
      evidence: { claimedLevel: "explicit", verifiedLevel: "explicit", quote: "mock_text" },
      decision: "undecided",
    },
    {
      id: "note:0:n1",
      kind: "note",
      origin: "ai",
      title: "Informational delta content",
      proposal: { type: "none" },
      decision: "undecided",
    },
  ];
}

async function seedActive(
  fixture: CanonBookFixture,
  overrides: Partial<ActiveStateReviewArtifact> = {},
): Promise<ActiveStateReviewArtifact> {
  const artifact: ActiveStateReviewArtifact = {
    schemaVersion: 1,
    status: "active",
    reviewId: REVIEW_ID,
    sourceChapter: 13,
    effectiveChapter: 14,
    proseRevision: "0123456789abcdef",
    baseCanonRevision: "fedcba9876543210",
    reviewRevision: 1,
    items: baseItems(),
    createdAt: CREATED_AT,
    language: "vi",
    ...overrides,
  };
  await publishActiveProposal(fixture.bookDir, artifact);
  return artifact;
}

/** Whole-tree diff restricted to an allow-list of relative paths ("/"-normalized). */
function expectOnlyPathsChanged(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  allowedRelativePaths: ReadonlyArray<string>,
): void {
  const normalizeKey = (key: string): string => key.replace(/\\/g, "/");
  const allowed = new Set(allowedRelativePaths.map(normalizeKey));
  const keys = new Set([...Object.keys(before), ...Object.keys(after)].map(normalizeKey));
  const unexpected: string[] = [];
  for (const key of keys) {
    if (allowed.has(key)) continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) unexpected.push(key);
  }
  expect(unexpected).toEqual([]);
}

const REVIEW_FILE = ACTIVE_REVIEW_RELPATH(13);

/** Reload FROM DISK and narrow to the ACTIVE variant (tests never mutate shells). */
async function loadActive(bookDir: string, chapter: number): Promise<ActiveStateReviewArtifact> {
  const loaded = await loadStateReview(bookDir, chapter);
  if (!loaded || loaded.status !== "active") {
    throw new Error(`expected an active state review artifact for chapter ${chapter}`);
  }
  return loaded;
}

describe("state-review-decisions", () => {
  let fixture: CanonBookFixture;

  beforeEach(async () => {
    fixture = await createCanonBook({ seedSnapshotsThrough: 12 });
  });

  afterEach(async () => {
    await rm(fixture.root, { recursive: true, force: true }).catch(() => undefined);
  });

  describe("accept", () => {
    it("accepts an undecided AI item: decision persisted, proposal/evidence untouched, revision +1, only the review file changes", async () => {
      const seeded = await seedActive(fixture);
      const targetBefore = structuredClone(
        seeded.items.find((entry) => entry.id === "current-state-fact:1:inferred")!,
      );
      const before = await captureBookMetadata(fixture.root);

      const result = await decideStateReviewItem({
        bookDir: fixture.bookDir,
        chapter: 13,
        itemId: "current-state-fact:1:inferred",
        decision: "accept",
        expectedReviewRevision: 1,
      });

      expect(result.reviewRevision).toBe(2);
      // Whole-tree freeze except the single review artifact.
      const after = await captureBookMetadata(fixture.root);
      expectOnlyPathsChanged(before, after, [REVIEW_FILE]);

      // Reload FROM DISK through loadStateReview.
      const reloaded = await loadActive(fixture.bookDir, 13);
      expect(reloaded?.status).toBe("active");
      expect(reloaded?.reviewRevision).toBe(2);
      const accepted = reloaded?.items.find((item) => item.id === "current-state-fact:1:inferred");
      expect(accepted?.decision).toBe("accepted");
      // Immutable AI layers survive byte/structurally unchanged.
      expect(accepted?.proposal).toEqual(targetBefore.proposal);
      expect(accepted?.evidence).toEqual(targetBefore.evidence);
      expect(accepted?.kind).toBe(targetBefore.kind);
      expect(accepted?.origin).toBe(targetBefore.origin);
    });

    it("resolver returns the ORIGINAL proposal for an accepted AI item", async () => {
      await seedActive(fixture);
      await decideStateReviewItem({
        bookDir: fixture.bookDir, chapter: 13, itemId: "current-state-fact:1:inferred",
        decision: "accept", expectedReviewRevision: 1,
      });
      const reloaded = await loadActive(fixture.bookDir, 13);
      const item = reloaded!.items.find((entry) => entry.id === "current-state-fact:1:inferred")!;
      expect(resolveReviewItemEffectiveChange(item)).toEqual(factChange("mock_text"));
    });
  });

  describe("edit + save", () => {
    it("edits an AI item: proposal PRESERVED, edited typed change stored, immediately reviewed, resolver returns the edit", async () => {
      const seeded = await seedActive(fixture);
      const proposalBefore = structuredClone(seeded.items[0]!.proposal);
      const evidenceBefore = structuredClone(seeded.items[0]!.evidence);
      const edited: ProposalChange = factChange("mock_text");

      const result = await editStateReviewItem({
        bookDir: fixture.bookDir,
        chapter: 13,
        itemId: "current-state-fact:0:explicit",
        expectedReviewRevision: 1,
        editedChange: edited,
      });

      expect(result.reviewRevision).toBe(2);
      const reloaded = await loadActive(fixture.bookDir, 13);
      const editedItem = reloaded!.items.find((entry) => entry.id === "current-state-fact:0:explicit")!;
      expect(editedItem.decision).toBe("edited");
      expect(editedItem.editedChange).toEqual(edited);
      // The immutable AI proposal and its evidence are retained alongside.
      expect(editedItem.proposal).toEqual(proposalBefore);
      expect(editedItem.evidence).toEqual(evidenceBefore);
      // Resolver returns the EDITED semantic change.
      expect(resolveReviewItemEffectiveChange(editedItem)).toEqual(edited);
    });

    it("rejects a kind/payload mismatch with invalid_change and ZERO writes", async () => {
      await seedActive(fixture);
      const before = await captureBookMetadata(fixture.root);

      await expect(editStateReviewItem({
        bookDir: fixture.bookDir,
        chapter: 13,
        itemId: "hook-upsert:0:u1",
        expectedReviewRevision: 1,
        editedChange: factChange("mock_text"),
      })).rejects.toMatchObject({
        name: "StateReviewError",
        code: "state_review_invalid_change",
        itemId: "hook-upsert:0:u1",
      });

      expect(await captureBookMetadata(fixture.root)).toEqual(before);
    });

    it("rejects an arbitrary/invalid semantic payload with invalid_change and ZERO writes", async () => {
      await seedActive(fixture);
      const before = await captureBookMetadata(fixture.root);

      await expect(editStateReviewItem({
        bookDir: fixture.bookDir,
        chapter: 13,
        itemId: "current-state-fact:0:explicit",
        expectedReviewRevision: 1,
        editedChange: { type: "fact", change: { action: "set", subject: "x", predicate: "y" } } as unknown as ProposalChange,
      })).rejects.toMatchObject({ code: "state_review_invalid_change" });

      expect(await captureBookMetadata(fixture.root)).toEqual(before);
    });

    it("a note can never be edited into a semantic mutation", async () => {
      await seedActive(fixture);
      const before = await captureBookMetadata(fixture.root);

      await expect(editStateReviewItem({
        bookDir: fixture.bookDir,
        chapter: 13,
        itemId: "note:0:n1",
        expectedReviewRevision: 1,
        editedChange: factChange("mock_text"),
      })).rejects.toMatchObject({ code: "state_review_invalid_change", itemId: "note:0:n1" });

      expect(await captureBookMetadata(fixture.root)).toEqual(before);
    });
  });

  describe("reject", () => {
    it("rejects an inferred AI item without warning: rejected, effective none, revision +1", async () => {
      await seedActive(fixture);
      const before = await captureBookMetadata(fixture.root);

      const result = await decideStateReviewItem({
        bookDir: fixture.bookDir,
        chapter: 13,
        itemId: "current-state-fact:1:inferred",
        decision: "reject",
        expectedReviewRevision: 1,
      });

      expect(result.reviewRevision).toBe(2);
      expectOnlyPathsChanged(before, await captureBookMetadata(fixture.root), [REVIEW_FILE]);
      const reloaded = await loadActive(fixture.bookDir, 13);
      const rejected = reloaded!.items.find((entry) => entry.id === "current-state-fact:1:inferred")!;
      expect(rejected.decision).toBe("rejected");
      expect(rejected.proposal).toEqual(factChange("mock_text"));
      expect(resolveReviewItemEffectiveChange(rejected)).toEqual({ type: "none" });
    });

    it("rejecting a verified-explicit AI item WITHOUT override warns and writes NOTHING", async () => {
      await seedActive(fixture);
      const before = await captureBookMetadata(fixture.root);

      await expect(decideStateReviewItem({
        bookDir: fixture.bookDir,
        chapter: 13,
        itemId: "current-state-fact:0:explicit",
        decision: "reject",
        expectedReviewRevision: 1,
      })).rejects.toMatchObject({
        name: "StateReviewError",
        code: "state_review_invalid_change",
        itemId: "current-state-fact:0:explicit",
        message: expect.stringContaining("explicit-evidence-warning-required"),
      });

      // ZERO writes — not even the review artifact changed.
      expect(await captureBookMetadata(fixture.root)).toEqual(before);
      const reloaded = await loadActive(fixture.bookDir, 13);
      expect(reloaded?.reviewRevision).toBe(1);
      expect(reloaded!.items.find((entry) => entry.id === "current-state-fact:0:explicit")!.decision)
        .toBe("undecided");
    });

    it("Reject Anyway persists the rejection and advances the revision", async () => {
      const seeded = await seedActive(fixture);
      const evidenceBefore = structuredClone(seeded.items[0]!.evidence);
      const proposalBefore = structuredClone(seeded.items[0]!.proposal);

      const result = await decideStateReviewItem({
        bookDir: fixture.bookDir,
        chapter: 13,
        itemId: "current-state-fact:0:explicit",
        decision: "reject",
        expectedReviewRevision: 1,
        overrideExplicitWarning: true,
      });

      expect(result.reviewRevision).toBe(2);
      const reloaded = await loadActive(fixture.bookDir, 13);
      const rejected = reloaded!.items.find((entry) => entry.id === "current-state-fact:0:explicit")!;
      expect(rejected.decision).toBe("rejected");
      // Proposal AND evidence retained as audit history.
      expect(rejected.proposal).toEqual(proposalBefore);
      expect(rejected.evidence).toEqual(evidenceBefore);
      expect(resolveReviewItemEffectiveChange(rejected)).toEqual({ type: "none" });
    });
  });

  describe("add missing change", () => {
    it("adds a user item: origin user, typed change, immediately accepted, unique stable id, revision +1", async () => {
      await seedActive(fixture);
      const before = await captureBookMetadata(fixture.root);
      const change = factChange("mock_text");

      const result = await addUserStateReviewItem({
        bookDir: fixture.bookDir,
        chapter: 13,
        expectedReviewRevision: 1,
        kind: "current-state-fact",
        change,
        title: "Missing location change",
      });

      expect(result.reviewRevision).toBe(2);
      expectOnlyPathsChanged(before, await captureBookMetadata(fixture.root), [REVIEW_FILE]);
      const reloaded = await loadActive(fixture.bookDir, 13);
      const added = reloaded!.items.find((entry) => entry.origin === "user");
      expect(added).toBeDefined();
      expect(added!.id.startsWith("user:")).toBe(true);
      expect(added!.decision).toBe("accepted");
      expect(added!.proposal).toEqual(change);
      expect(added!.title).toBe("Missing location change");
      expect(resolveReviewItemEffectiveChange(added!)).toEqual(change);
    });

    it("generates UNIQUE ids for identical user payloads and keeps them stable across later mutations", async () => {
      await seedActive(fixture);
      const change = factChange("mock_text");

      const first = await addUserStateReviewItem({
        bookDir: fixture.bookDir, chapter: 13, expectedReviewRevision: 1,
        kind: "current-state-fact", change, title: "first",
      });
      const second = await addUserStateReviewItem({
        bookDir: fixture.bookDir, chapter: 13, expectedReviewRevision: 2,
        kind: "current-state-fact", change, title: "second",
      });

      const firstId = first.items.at(-1)!.id;
      const secondId = second.items.at(-1)!.id;
      expect(firstId).not.toBe(secondId);

      // A later unrelated mutation must NOT regenerate existing ids.
      await decideStateReviewItem({
        bookDir: fixture.bookDir, chapter: 13, itemId: "current-state-fact:1:inferred",
        decision: "accept", expectedReviewRevision: 3,
      });
      const reloaded = await loadActive(fixture.bookDir, 13)!;
      const userIds = reloaded.items.filter((entry) => entry.origin === "user").map((entry) => entry.id);
      expect(userIds).toEqual([firstId, secondId]);
    });
  });

  describe("user item edit / remove", () => {
    it("edits a user-added item: identity and origin kept, still decided, revision +1", async () => {
      await seedActive(fixture);
      const added = await addUserStateReviewItem({
        bookDir: fixture.bookDir, chapter: 13, expectedReviewRevision: 1,
        kind: "current-state-fact", change: factChange("mock_text"), title: "missing",
      });
      const userId = added.items.at(-1)!.id;
      const before = await captureBookMetadata(fixture.root);
      const edited: ProposalChange = factChange("mock_text");

      const result = await editStateReviewItem({
        bookDir: fixture.bookDir, chapter: 13, itemId: userId,
        expectedReviewRevision: 2, editedChange: edited,
      });

      expect(result.reviewRevision).toBe(3);
      expectOnlyPathsChanged(before, await captureBookMetadata(fixture.root), [REVIEW_FILE]);
      const reloaded = await loadActive(fixture.bookDir, 13);
      const item = reloaded!.items.find((entry) => entry.id === userId)!;
      expect(item.origin).toBe("user");
      expect(item.id).toBe(userId);
      expect(item.decision).toBe("edited");
      expect(item.proposal).toEqual(factChange("mock_text"));
      expect(item.editedChange).toEqual(edited);
      expect(resolveReviewItemEffectiveChange(item)).toEqual(edited);
    });

    it("removes a user-added item while AI items stay untouched", async () => {
      await seedActive(fixture);
      const added = await addUserStateReviewItem({
        bookDir: fixture.bookDir, chapter: 13, expectedReviewRevision: 1,
        kind: "current-state-fact", change: factChange("mock_text"), title: "missing",
      });
      const userId = added.items.at(-1)!.id;

      const result = await removeUserStateReviewItem({
        bookDir: fixture.bookDir, chapter: 13, itemId: userId, expectedReviewRevision: 2,
      });

      expect(result.reviewRevision).toBe(3);
      const reloaded = await loadActive(fixture.bookDir, 13);
      expect(reloaded!.items.some((entry) => entry.id === userId)).toBe(false);
      // All four original AI items remain.
      expect(reloaded!.items.filter((entry) => entry.origin === "ai")).toHaveLength(4);
    });

    it("refuses to remove an AI item: invalid_change, ZERO writes", async () => {
      await seedActive(fixture);
      const before = await captureBookMetadata(fixture.root);

      await expect(removeUserStateReviewItem({
        bookDir: fixture.bookDir, chapter: 13, itemId: "current-state-fact:0:explicit",
        expectedReviewRevision: 1,
      })).rejects.toMatchObject({
        code: "state_review_invalid_change",
        itemId: "current-state-fact:0:explicit",
      });

      expect(await captureBookMetadata(fixture.root)).toEqual(before);
    });
  });

  describe("reject all AI items", () => {
    it("batch-rejects actionable AI items in ONE revision bump; notes and user items untouched; review stays active", async () => {
      // Shape the artifact: one already-edited AI item, explicit+inferred undecided, note, user item.
      const seeded = await seedActive(fixture);
      const withEdits = await editStateReviewItem({
        bookDir: fixture.bookDir, chapter: 13, itemId: "current-state-fact:0:explicit",
        expectedReviewRevision: 1, editedChange: factChange("mock_text"),
      });
      const withUser = await addUserStateReviewItem({
        bookDir: fixture.bookDir, chapter: 13, expectedReviewRevision: withEdits.reviewRevision,
        kind: "current-state-fact", change: factChange("mock_text"), title: "missing",
      });
      const before = await captureBookMetadata(fixture.root);

      const result = await rejectAllAiItems({
        bookDir: fixture.bookDir, chapter: 13,
        expectedReviewRevision: withUser.reviewRevision,
        overrideExplicitWarning: true,
      });

      // EXACTLY ONE revision bump for the whole batch.
      expect(result.reviewRevision).toBe(withUser.reviewRevision + 1);
      expectOnlyPathsChanged(before, await captureBookMetadata(fixture.root), [REVIEW_FILE]);

      const reloaded = await loadActive(fixture.bookDir, 13)!;
      expect(reloaded.status).toBe("active");
      const byId = new Map(reloaded.items.map((entry) => [entry.id, entry]));
      // Every actionable AI item is explicitly rejected…
      expect(byId.get("current-state-fact:0:explicit")!.decision).toBe("rejected");
      expect(byId.get("current-state-fact:1:inferred")!.decision).toBe("rejected");
      expect(byId.get("hook-upsert:0:u1")!.decision).toBe("rejected");
      // …its earlier human edit layer survives as history…
      expect(byId.get("current-state-fact:0:explicit")!.editedChange).toEqual(factChange("mock_text"));
      // …the note is untouched and undecided…
      expect(byId.get("note:0:n1")!.decision).toBe("undecided");
      // …and the user-added item is NOT silently rejected or deleted.
      const userItems = reloaded.items.filter((entry) => entry.origin === "user");
      expect(userItems).toHaveLength(1);
      expect(userItems[0]!.decision).toBe("accepted");
    });

    it("requires the explicit-evidence override when any flipping AI item is verified-explicit; ZERO writes otherwise", async () => {
      await seedActive(fixture);
      const before = await captureBookMetadata(fixture.root);

      await expect(rejectAllAiItems({
        bookDir: fixture.bookDir, chapter: 13, expectedReviewRevision: 1,
      })).rejects.toMatchObject({
        code: "state_review_invalid_change",
        message: expect.stringContaining("explicit-evidence-warning-required"),
      });

      expect(await captureBookMetadata(fixture.root)).toEqual(before);
      const reloaded = await loadActive(fixture.bookDir, 13);
      expect(reloaded?.reviewRevision).toBe(1);
      expect(reloaded!.items.every((entry) => entry.decision === "undecided")).toBe(true);
    });

    it("does NOT warn when every verified-explicit AI item is already rejected (nothing flips)", async () => {
      // Reject the two explicit items first, then batch-reject without override.
      await seedActive(fixture);
      await decideStateReviewItem({
        bookDir: fixture.bookDir, chapter: 13, itemId: "current-state-fact:0:explicit",
        decision: "reject", expectedReviewRevision: 1, overrideExplicitWarning: true,
      });
      await decideStateReviewItem({
        bookDir: fixture.bookDir, chapter: 13, itemId: "hook-upsert:0:u1",
        decision: "reject", expectedReviewRevision: 2, overrideExplicitWarning: true,
      });

      const result = await rejectAllAiItems({
        bookDir: fixture.bookDir, chapter: 13, expectedReviewRevision: 3,
      });

      expect(result.reviewRevision).toBe(4);
      const reloaded = await loadActive(fixture.bookDir, 13)!;
      expect(reloaded.items.find((entry) => entry.id === "current-state-fact:1:inferred")!.decision)
        .toBe("rejected");
      expect(reloaded.items.find((entry) => entry.id === "note:0:n1")!.decision).toBe("undecided");
    });
  });

  describe("CAS / lookup / shell contracts", () => {
    it("stale expectedReviewRevision → state_review_edit_conflict with ZERO writes and no applied semantics", async () => {
      await seedActive(fixture);
      const before = await captureBookMetadata(fixture.root);

      await expect(decideStateReviewItem({
        bookDir: fixture.bookDir, chapter: 13, itemId: "current-state-fact:1:inferred",
        decision: "accept", expectedReviewRevision: 7,
      })).rejects.toMatchObject({ code: "state_review_edit_conflict" });

      expect(await captureBookMetadata(fixture.root)).toEqual(before);
      const reloaded = await loadActive(fixture.bookDir, 13);
      expect(reloaded?.reviewRevision).toBe(1);
      expect(reloaded!.items.find((entry) => entry.id === "current-state-fact:1:inferred")!.decision)
        .toBe("undecided");
    });

    it("unknown itemId → state_review_not_found carrying the itemId, ZERO writes", async () => {
      await seedActive(fixture);
      const before = await captureBookMetadata(fixture.root);

      await expect(decideStateReviewItem({
        bookDir: fixture.bookDir, chapter: 13, itemId: "nope:9:missing",
        decision: "accept", expectedReviewRevision: 1,
      })).rejects.toMatchObject({ code: "state_review_not_found", itemId: "nope:9:missing" });

      expect(await captureBookMetadata(fixture.root)).toEqual(before);
    });

    it.each(["rebuild_required", "rebuild_failed"] as const)(
      "%s shell target → state_review_stale, ZERO writes",
      async (status) => {
        await saveStateReviewShell(fixture.bookDir, {
          schemaVersion: 1,
          status,
          sourceChapter: 13,
          createdAt: CREATED_AT,
          language: "vi",
          reason: status === "rebuild_failed" ? "settler failed" : "",
        });
        const before = await captureBookMetadata(fixture.root);

        await expect(decideStateReviewItem({
          bookDir: fixture.bookDir, chapter: 13, itemId: "current-state-fact:0:explicit",
          decision: "accept", expectedReviewRevision: 1,
        })).rejects.toMatchObject({ code: "state_review_stale" });

        expect(await captureBookMetadata(fixture.root)).toEqual(before);
      },
    );

    it("stale active-shaped artifact → state_review_stale, ZERO writes", async () => {
      await publishActiveProposal(fixture.bookDir, {
        schemaVersion: 1,
        status: "stale",
        reviewId: REVIEW_ID,
        sourceChapter: 13,
        effectiveChapter: 14,
        proseRevision: "0123456789abcdef",
        baseCanonRevision: "fedcba9876543210",
        reviewRevision: 1,
        items: baseItems(),
        createdAt: CREATED_AT,
        language: "vi",
      });
      const before = await captureBookMetadata(fixture.root);

      await expect(decideStateReviewItem({
        bookDir: fixture.bookDir, chapter: 13, itemId: "current-state-fact:0:explicit",
        decision: "accept", expectedReviewRevision: 1,
      })).rejects.toMatchObject({ code: "state_review_stale" });

      expect(await captureBookMetadata(fixture.root)).toEqual(before);
    });
  });

  describe("anchors, atomicity, lifecycle freeze", () => {
    it("successive mutations keep every generation anchor frozen while reviewRevision steps 1→4", async () => {
      const seeded = await seedActive(fixture);
      const anchors = {
        schemaVersion: seeded.schemaVersion,
        reviewId: seeded.reviewId,
        sourceChapter: seeded.sourceChapter,
        effectiveChapter: seeded.effectiveChapter,
        proseRevision: seeded.proseRevision,
        baseCanonRevision: seeded.baseCanonRevision,
        createdAt: seeded.createdAt,
        language: seeded.language,
        status: seeded.status,
      };

      await decideStateReviewItem({
        bookDir: fixture.bookDir, chapter: 13, itemId: "current-state-fact:1:inferred",
        decision: "accept", expectedReviewRevision: 1,
      });
      await editStateReviewItem({
        bookDir: fixture.bookDir, chapter: 13, itemId: "current-state-fact:0:explicit",
        expectedReviewRevision: 2, editedChange: factChange("mock_text"),
      });
      await addUserStateReviewItem({
        bookDir: fixture.bookDir, chapter: 13, expectedReviewRevision: 3,
        kind: "chapter-summary",
        change: { type: "chapter-summary", row: { chapter: 14, title: "mock_text", characters: "mock_text", events: "mock_text", stateChanges: "", hookActivity: "", mood: "", chapterType: "" } },
        title: "missing summary",
      });

      const reloaded = await loadActive(fixture.bookDir, 13)!;
      expect(reloaded.reviewRevision).toBe(4);
      for (const [field, value] of Object.entries(anchors)) {
        expect((reloaded as unknown as Record<string, unknown>)[field]).toBe(value);
      }
    });

    it("atomic replacement failure leaves the artifact byte-identical with unchanged revision and no residue", async () => {
      await seedActive(fixture);
      const artifactPath = join(fixture.bookDir, REVIEW_FILE);
      const bytesBefore = await readFile(artifactPath, "utf-8");

      await expect(decideStateReviewItem({
        bookDir: fixture.bookDir, chapter: 13, itemId: "current-state-fact:1:inferred",
        decision: "accept", expectedReviewRevision: 1,
        deps: { renameFile: async () => { throw new Error("injected mid-set rename failure"); } },
      })).rejects.toThrow(/injected mid-set rename failure/);

      expect(await readFile(artifactPath, "utf-8")).toBe(bytesBefore);
      const reloaded = await loadActive(fixture.bookDir, 13);
      expect(reloaded?.reviewRevision).toBe(1);
      expect(reloaded!.items.find((entry) => entry.id === "current-state-fact:1:inferred")!.decision)
        .toBe("undecided");
    });

    it("decisions never touch chapter lifecycle: index stays needs-state-review and prose stays put", async () => {
      await seedActive(fixture);
      // Seed a gated index + prose file, then mutate decisions around them.
      const chaptersDir = join(fixture.bookDir, "chapters");
      await import("node:fs/promises").then(({ mkdir, writeFile }) =>
        Promise.all([
          mkdir(chaptersDir, { recursive: true }),
          writeFile(join(chaptersDir, "0013_mock_text.md"), "# Chương 13 mock_text\n\nmock_text。", "utf-8"),
          writeFile(join(chaptersDir, "index.json"), JSON.stringify([
            { number: 13, title: "mock_text", status: "needs-state-review", wordCount: 4, createdAt: CREATED_AT, updatedAt: CREATED_AT, auditIssues: [], lengthWarnings: [] },
          ], null, 2), "utf-8"),
        ]),
      );
      const before = await captureBookMetadata(fixture.root);

      await decideStateReviewItem({
        bookDir: fixture.bookDir, chapter: 13, itemId: "current-state-fact:1:inferred",
        decision: "accept", expectedReviewRevision: 1,
      });
      await rejectAllAiItems({
        bookDir: fixture.bookDir, chapter: 13, expectedReviewRevision: 2,
        overrideExplicitWarning: true,
      });

      const after = await captureBookMetadata(fixture.root);
      expectOnlyPathsChanged(before, after, [REVIEW_FILE]);
      const indexOnDisk = JSON.parse(await readFile(join(chaptersDir, "index.json"), "utf-8"));
      expect(indexOnDisk[0].status).toBe("needs-state-review");
    });
  });
});
