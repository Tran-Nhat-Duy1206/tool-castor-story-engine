import { join } from "node:path";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCanonBook, captureBookMetadata, type CanonBookFixture } from "./helpers/canon-fixture.js";
import {
  ACTIVE_REVIEW_RELPATH,
  RECEIPTS_DIR,
  findReceiptByReviewId,
  listReceiptsForChapter,
  loadStateReview,
  mutateActiveProposal,
  publishActiveProposal,
  readLiveRuntimeStateSnapshot,
  saveStateReviewShell,
  supersedeReceiptsForChapter,
  writeResolvedReceipt,
} from "../state/state-review-store.js";
import {
  ResolvedReviewReceiptSchema,
  StateReviewError,
  type ActiveStateReviewArtifact,
  type ReviewItem,
  type StateReviewShellArtifact,
} from "../models/state-review.js";

const CREATED_AT = "2026-08-24T00:00:00.000Z";
const REVIEW_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

function evidenceItem(): ReviewItem {
  return {
    id: "current-state-fact:0:test",
    kind: "current-state-fact",
    origin: "ai",
    title: "Location change",
    proposal: { type: "fact", change: { action: "set", subject: "protagonist", predicate: "current-location", object: "东城公寓" } },
    evidence: { claimedLevel: "explicit", verifiedLevel: "explicit", quote: "他推开了门" },
    decision: "undecided",
  };
}

function shellRequired(sourceChapter = 13): StateReviewShellArtifact {
  return {
    schemaVersion: 1,
    status: "rebuild_required",
    sourceChapter,
    createdAt: CREATED_AT,
    language: "zh",
    reason: "",
  };
}

function activeProposal(overrides: Partial<ActiveStateReviewArtifact> = {}): ActiveStateReviewArtifact {
  return {
    schemaVersion: 1,
    status: "active",
    reviewId: REVIEW_ID,
    sourceChapter: 13,
    effectiveChapter: 14,
    proseRevision: "0123456789abcdef",
    baseCanonRevision: "fedcba9876543210",
    reviewRevision: 1,
    items: [evidenceItem()],
    createdAt: CREATED_AT,
    language: "zh",
    ...overrides,
  };
}

function receiptFixture(overrides: Record<string, unknown> = {}) {
  return ResolvedReviewReceiptSchema.parse({
    schemaVersion: 1,
    reviewId: REVIEW_ID,
    sourceChapter: 13,
    effectiveChapter: 14,
    proseRevision: "0123456789abcdef",
    baseCanonRevision: "fedcba9876543210",
    resultingCanonRevision: "0000000000000001",
    proposals: [],
    decisions: [],
    effectiveChanges: [],
    evidence: [{ itemId: "current-state-fact:0:test", evidence: { claimedLevel: "explicit", verifiedLevel: "explicit", quote: "他推开了门" } }],
    resolvedAt: "2026-08-24T01:00:00.000Z",
    resolution: "confirmed-changes",
    ...overrides,
  });
}

/** Whole-tree diff limited to unexpected paths (expected writes are whitelisted). */
function expectOnlyPathsChanged(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  allowedRelativePaths: ReadonlyArray<string>,
): void {
  // captureBookMetadata keys follow the host OS separators; compare on "/".
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

describe("state-review-store", () => {
  let fixture: CanonBookFixture;

  beforeEach(async () => {
    fixture = await createCanonBook({ seedSnapshotsThrough: 12 });
  });

  afterEach(async () => {
    await rm(fixture.root, { recursive: true, force: true }).catch(() => undefined);
  });

  describe("artifact paths", () => {
    it("zero-pads chapter numbers in artifact and receipt paths", () => {
      expect(ACTIVE_REVIEW_RELPATH(13)).toBe("story/runtime/chapter-0013.state-review.json");
      expect(RECEIPTS_DIR(7)).toBe("story/runtime/state-review-receipts/chapter-0007");
    });
  });

  describe("loadStateReview", () => {
    it("returns null for a missing artifact without touching the tree", async () => {
      const before = await captureBookMetadata(fixture.root);
      await expect(loadStateReview(fixture.bookDir, 13)).resolves.toBeNull();
      expect(await captureBookMetadata(fixture.root)).toEqual(before);
    });

    it("round-trips a rebuild_required shell with NO active-only anchors/items", async () => {
      await saveStateReviewShell(fixture.bookDir, shellRequired());
      const loaded = await loadStateReview(fixture.bookDir, 13);
      expect(loaded?.status).toBe("rebuild_required");
      expect(loaded).not.toHaveProperty("reviewId");
      expect(loaded).not.toHaveProperty("items");
      expect(loaded).not.toHaveProperty("proseRevision");
    });

    it("round-trips an active proposal retaining anchors and typed item evidence", async () => {
      await publishActiveProposal(fixture.bookDir, activeProposal());
      const loaded = await loadStateReview(fixture.bookDir, 13);
      expect(loaded?.status).toBe("active");
      expect(loaded).toMatchObject({ reviewId: REVIEW_ID, effectiveChapter: 14, reviewRevision: 1 });
      if (loaded?.status !== "active" && loaded?.status !== "stale") throw new Error("expected active-shaped artifact");
      expect((loaded as ActiveStateReviewArtifact).items[0]?.evidence).toEqual({
        claimedLevel: "explicit",
        verifiedLevel: "explicit",
        quote: "他推开了门",
      });
    });

    it("fails closed on malformed artifact JSON and leaves the file untouched", async () => {
      const relPath = ACTIVE_REVIEW_RELPATH(13);
      const target = join(fixture.bookDir, relPath);
      await mkdir(join(target, ".."), { recursive: true });
      await writeFile(target, "{ not json at all", "utf-8");
      const before = await captureBookMetadata(fixture.root);
      await expect(loadStateReview(fixture.bookDir, 13)).rejects.toThrow();
      expect(await captureBookMetadata(fixture.root)).toEqual(before);
    });

    it("fails closed on schema-invalid artifact content without repairing it", async () => {
      const target = join(fixture.bookDir, ACTIVE_REVIEW_RELPATH(13));
      await mkdir(join(target, ".."), { recursive: true });
      await writeFile(target, JSON.stringify({ schemaVersion: 1, status: "active", reviewId: REVIEW_ID }), "utf-8");
      const before = await captureBookMetadata(fixture.root);
      await expect(loadStateReview(fixture.bookDir, 13)).rejects.toThrow();
      expect(await captureBookMetadata(fixture.root)).toEqual(before);
    });
  });

  describe("reviewRevision CAS", () => {
    it("bumps revision exactly from expected to expected+1 and applies the mutation", async () => {
      await publishActiveProposal(fixture.bookDir, activeProposal());
      const updated = await mutateActiveProposal({
        bookDir: fixture.bookDir,
        chapter: 13,
        expectedReviewRevision: 1,
        mutate: (active) => ({
          ...active,
          items: active.items.map((item) => ({ ...item, decision: "accepted" as const })),
        }),
      });
      expect(updated.reviewRevision).toBe(2);
      expect(updated.items[0]?.decision).toBe("accepted");
      const reloaded = await loadStateReview(fixture.bookDir, 13);
      expect(reloaded).toMatchObject({ status: "active", reviewRevision: 2 });
    });

    it("throws state_review_edit_conflict and performs ZERO writes on stale expectation", async () => {
      await publishActiveProposal(fixture.bookDir, activeProposal());
      const before = await captureBookMetadata(fixture.root);
      await expect(
        mutateActiveProposal({
          bookDir: fixture.bookDir,
          chapter: 13,
          expectedReviewRevision: 99,
          mutate: (active) => active,
        }),
      ).rejects.toMatchObject({ code: "state_review_edit_conflict" });
      expect(await captureBookMetadata(fixture.root)).toEqual(before);
    });

    it("refuses to mutate shells with a typed stale error and zero writes", async () => {
      await saveStateReviewShell(fixture.bookDir, shellRequired());
      const before = await captureBookMetadata(fixture.root);
      await expect(
        mutateActiveProposal({
          bookDir: fixture.bookDir,
          chapter: 13,
          expectedReviewRevision: 1,
          mutate: (active) => active,
        }),
      ).rejects.toMatchObject({ code: "state_review_stale" });
      expect(await captureBookMetadata(fixture.root)).toEqual(before);
    });

    it("does not silently retry a stale revision", async () => {
      await publishActiveProposal(fixture.bookDir, activeProposal());
      let attempts = 0;
      await expect(
        mutateActiveProposal({
          bookDir: fixture.bookDir,
          chapter: 13,
          expectedReviewRevision: 5,
          mutate: (active) => {
            attempts += 1;
            return active;
          },
        }),
      ).rejects.toMatchObject({ code: "state_review_edit_conflict" });
      expect(attempts).toBe(0);
    });

    it("rejects a callback that changes reviewId, leaving the artifact byte-identical", async () => {
      await publishActiveProposal(fixture.bookDir, activeProposal());
      const before = await captureBookMetadata(fixture.root);
      await expect(
        mutateActiveProposal({
          bookDir: fixture.bookDir,
          chapter: 13,
          expectedReviewRevision: 1,
          mutate: (active) => ({ ...active, reviewId: "99999999-8888-4777-9666-555555555555" }),
        }),
      ).rejects.toMatchObject({ code: "state_review_invalid_change" });
      expect(await captureBookMetadata(fixture.root)).toEqual(before);
      const onDisk = await loadStateReview(fixture.bookDir, 13);
      expect(onDisk).toMatchObject({ reviewId: REVIEW_ID, reviewRevision: 1 });
    });

    it.each([
      ["sourceChapter", 99],
      ["effectiveChapter", 99],
      ["proseRevision", "ffffffffffffffff"],
      ["baseCanonRevision", "ffffffffffffffff"],
      ["createdAt", "2027-01-01T00:00:00.000Z"],
      ["language", "en"],
    ] as const)("rejects a callback that changes immutable field %s with zero writes", async (field, value) => {
      await publishActiveProposal(fixture.bookDir, activeProposal());
      const before = await captureBookMetadata(fixture.root);
      await expect(
        mutateActiveProposal({
          bookDir: fixture.bookDir,
          chapter: 13,
          expectedReviewRevision: 1,
          mutate: (active) => ({ ...active, [field]: value }) as ActiveStateReviewArtifact,
        }),
      ).rejects.toMatchObject({ code: "state_review_invalid_change" });
      expect(await captureBookMetadata(fixture.root)).toEqual(before);
    });

    it("rejects a callback that demotes status away from active with zero writes", async () => {
      await publishActiveProposal(fixture.bookDir, activeProposal());
      const before = await captureBookMetadata(fixture.root);
      await expect(
        mutateActiveProposal({
          bookDir: fixture.bookDir,
          chapter: 13,
          expectedReviewRevision: 1,
          mutate: (active) => ({ ...active, status: "stale" }),
        }),
      ).rejects.toMatchObject({ code: "state_review_invalid_change" });
      expect(await captureBookMetadata(fixture.root)).toEqual(before);
    });

    it("keeps reviewRevision store-owned even when the callback supplies its own value", async () => {
      await publishActiveProposal(fixture.bookDir, activeProposal());
      const updated = await mutateActiveProposal({
        bookDir: fixture.bookDir,
        chapter: 13,
        expectedReviewRevision: 1,
        mutate: (active) => ({
          ...active,
          reviewRevision: 42,
          items: active.items.map((item) => ({ ...item, decision: "accepted" as const })),
        }),
      });
      expect(updated.reviewRevision).toBe(2);
      expect(updated.items[0]?.decision).toBe("accepted");
      expect(updated.effectiveChapter).toBe(14);
      const reloaded = await loadStateReview(fixture.bookDir, 13);
      expect(reloaded).toMatchObject({ reviewRevision: 2 });
    });

    it("survives an injected rename failure with the old artifact intact and no temp litter", async () => {
      await publishActiveProposal(fixture.bookDir, activeProposal());
      const before = await captureBookMetadata(fixture.root);
      await expect(
        mutateActiveProposal({
          bookDir: fixture.bookDir,
          chapter: 13,
          expectedReviewRevision: 1,
          mutate: (active) => ({
            ...active,
            // Identity-preserving content change; the point of this test is
            // the atomic write seam, not the payload.
            items: active.items.map((item) => ({ ...item, decision: "accepted" as const })),
          }),
          deps: {
            renameFile: async () => {
              throw new Error("injected rename failure");
            },
          },
        }),
      ).rejects.toThrow(/injected rename failure/);
      expect(await captureBookMetadata(fixture.root)).toEqual(before);
      const runtimeDir = join(fixture.bookDir, "story", "runtime");
      const entries = await readdir(runtimeDir);
      expect(entries.filter((name) => name.includes(".tmp-"))).toEqual([]);
    });
  });

  describe("write ownership", () => {
    it("shell saver rejects an active proposal with zero writes", async () => {
      const before = await captureBookMetadata(fixture.root);
      await expect(saveStateReviewShell(fixture.bookDir, activeProposal() as never)).rejects.toMatchObject({
        code: "state_review_invalid_change",
      });
      expect(await captureBookMetadata(fixture.root)).toEqual(before);
      await expect(loadStateReview(fixture.bookDir, 13)).resolves.toBeNull();
    });

    it.each([
      ["rebuild_required", shellRequired()],
      ["rebuild_failed", { ...shellRequired(), status: "rebuild_failed", reason: "analyzer failed" }],
    ] as const)("active publisher rejects a %s shell with zero writes", async (_label, shell) => {
      const before = await captureBookMetadata(fixture.root);
      await expect(publishActiveProposal(fixture.bookDir, shell as never)).rejects.toMatchObject({
        code: "state_review_invalid_change",
      });
      expect(await captureBookMetadata(fixture.root)).toEqual(before);
      await expect(loadStateReview(fixture.bookDir, 13)).resolves.toBeNull();
    });
  });

  describe("canon purity for write operations", () => {
    it("leaves everything except story/runtime artifacts byte-and-mtime identical", async () => {
      const before = await captureBookMetadata(fixture.root);
      await saveStateReviewShell(fixture.bookDir, shellRequired(21));
      await publishActiveProposal(fixture.bookDir, activeProposal());
      await mutateActiveProposal({
        bookDir: fixture.bookDir,
        chapter: 13,
        expectedReviewRevision: 1,
        mutate: (active) => ({ ...active, reviewRevision: active.reviewRevision }),
        deps: { renameFile: undefined },
      });
      const after = await captureBookMetadata(fixture.root);
      const bookPrefix = fixture.bookDir.slice(fixture.root.length + 1).replace(/\\/g, "/");
      expectOnlyPathsChanged(before, after, [
        `${bookPrefix}/${ACTIVE_REVIEW_RELPATH(13)}`,
        `${bookPrefix}/${ACTIVE_REVIEW_RELPATH(21)}`,
      ]);
    });
  });

  describe("receipt store", () => {
    async function writeReceiptDirectly(chapter: number, reviewId: string, content: string): Promise<void> {
      const dir = join(fixture.bookDir, RECEIPTS_DIR(chapter));
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${reviewId}.json`), content, "utf-8");
    }

    it("returns null for a missing receipt", async () => {
      await expect(findReceiptByReviewId(fixture.bookDir, 13, REVIEW_ID)).resolves.toBeNull();
    });

    it("finds a typed parsed receipt including its REQUIRED evidence layer", async () => {
      await writeResolvedReceipt(fixture.bookDir, 13, receiptFixture());
      const found = await findReceiptByReviewId(fixture.bookDir, 13, REVIEW_ID);
      expect(found).not.toBeNull();
      expect(found?.resolution).toBe("confirmed-changes");
      expect(found?.evidence).toEqual([
        { itemId: "current-state-fact:0:test", evidence: { claimedLevel: "explicit", verifiedLevel: "explicit", quote: "他推开了门" } },
      ]);
    });

    it("lists receipts deterministically by resolvedAt then reviewId", async () => {
      await writeResolvedReceipt(fixture.bookDir, 13, receiptFixture({
        reviewId: "bbbbbbbb-cccc-4ddd-9eee-ffffffffffff",
        resolvedAt: "2026-08-24T02:00:00.000Z",
      }));
      await writeResolvedReceipt(fixture.bookDir, 13, receiptFixture({
        reviewId: REVIEW_ID,
        resolvedAt: "2026-08-24T01:00:00.000Z",
      }));
      await writeResolvedReceipt(fixture.bookDir, 13, receiptFixture({
        reviewId: "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee",
        resolvedAt: "2026-08-24T02:00:00.000Z",
      }));
      const listed = await listReceiptsForChapter(fixture.bookDir, 13);
      expect(listed.map((receipt) => receipt.reviewId)).toEqual([
        REVIEW_ID,
        "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee",
        "bbbbbbbb-cccc-4ddd-9eee-ffffffffffff",
      ]);
    });

    it("fails closed on a corrupt receipt file for both find and list", async () => {
      await writeReceiptDirectly(13, REVIEW_ID, "{ truncated");
      await expect(findReceiptByReviewId(fixture.bookDir, 13, REVIEW_ID)).rejects.toThrow();
      await expect(listReceiptsForChapter(fixture.bookDir, 13)).rejects.toThrow();
    });

    it("treats path-traversal review ids as absent and refuses to write them", async () => {
      await expect(findReceiptByReviewId(fixture.bookDir, 13, "../evil")).resolves.toBeNull();
      await expect(
        writeResolvedReceipt(fixture.bookDir, 13, receiptFixture({ reviewId: "../evil" }) as never),
      ).rejects.toMatchObject({ code: "state_review_invalid_change" });
    });

    it("refuses to overwrite an existing DIFFERENT resolved receipt", async () => {
      await writeResolvedReceipt(fixture.bookDir, 13, receiptFixture());
      await expect(
        writeResolvedReceipt(fixture.bookDir, 13, receiptFixture({ resultingCanonRevision: "9999999999999999" })),
      ).rejects.toThrow(/refusing to overwrite/i);
      const found = await findReceiptByReviewId(fixture.bookDir, 13, REVIEW_ID);
      expect(found?.resultingCanonRevision).toBe("0000000000000001");
    });

    it("is idempotent when rewriting byte-identical receipt content", async () => {
      await writeResolvedReceipt(fixture.bookDir, 13, receiptFixture());
      await expect(writeResolvedReceipt(fixture.bookDir, 13, receiptFixture())).resolves.toBe(
        `${RECEIPTS_DIR(13)}/${REVIEW_ID}.json`,
      );
    });

    it("supersede returns write entries WITHOUT writing anything itself", async () => {
      await writeResolvedReceipt(fixture.bookDir, 13, receiptFixture());
      const before = await captureBookMetadata(fixture.root);
      const entries = await supersedeReceiptsForChapter({ bookDir: fixture.bookDir, chapter: 13 });
      expect(await captureBookMetadata(fixture.root)).toEqual(before);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.relativePath).toBe(`${RECEIPTS_DIR(13)}/${REVIEW_ID}.json`);
      const parsed = ResolvedReviewReceiptSchema.parse(JSON.parse(entries[0]!.content));
      expect(parsed.resolution).toBe("superseded");
    });

    it("supersession changes ONLY lifecycle fields and skips already-superseded receipts", async () => {
      await writeResolvedReceipt(fixture.bookDir, 13, receiptFixture());
      await writeResolvedReceipt(fixture.bookDir, 13, receiptFixture({
        reviewId: "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee",
        resolvedAt: "2026-08-24T03:00:00.000Z",
      }));
      // Pre-supersede ONLY the first receipt through the returned-entry mechanism.
      const first = await supersedeReceiptsForChapter({ bookDir: fixture.bookDir, chapter: 13 });
      expect(first).toHaveLength(2);
      for (const entry of first.filter((candidate) => candidate.relativePath.endsWith(`${REVIEW_ID}.json`))) {
        await writeFile(join(fixture.bookDir, entry.relativePath), entry.content, "utf-8");
      }
      // Second pass: already-superseded REVIEW_ID is skipped; only the other remains.
      const second = await supersedeReceiptsForChapter({
        bookDir: fixture.bookDir,
        chapter: 13,
        supersededBy: "cccccccc-dddd-4eee-9fff-111111111111",
      });
      expect(second).toHaveLength(1);
      expect(second[0]?.relativePath.endsWith("aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee.json")).toBe(true);

      const frozen = await findReceiptByReviewId(fixture.bookDir, 13, REVIEW_ID);
      const original = receiptFixture();
      expect(frozen).toMatchObject({
        reviewId: original.reviewId,
        sourceChapter: original.sourceChapter,
        effectiveChapter: original.effectiveChapter,
        proseRevision: original.proseRevision,
        baseCanonRevision: original.baseCanonRevision,
        resultingCanonRevision: original.resultingCanonRevision,
        proposals: original.proposals,
        decisions: original.decisions,
        effectiveChanges: original.effectiveChanges,
        evidence: original.evidence,
        resolvedAt: original.resolvedAt,
        resolution: "superseded",
      });
      // Superseded during pass 1, which carried no successor id.
      expect(frozen?.supersededBy).toBeUndefined();
      const pendingEntry = ResolvedReviewReceiptSchema.parse(JSON.parse(second[0]!.content));
      expect(pendingEntry).toMatchObject({
        reviewId: "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee",
        resolution: "superseded",
        supersededBy: "cccccccc-dddd-4eee-9fff-111111111111",
      });
    });
  });

  describe("readLiveRuntimeStateSnapshot (pure)", () => {
    it("returns validated live structured canon state without any writes", async () => {
      const before = await captureBookMetadata(fixture.root);
      const snapshot = await readLiveRuntimeStateSnapshot(fixture.bookDir);
      expect(snapshot.manifest.schemaVersion).toBe(2);
      expect(snapshot.currentState.facts.length).toBeGreaterThan(0);
      expect(Array.isArray(snapshot.hooks.hooks)).toBe(true);
      expect(Array.isArray(snapshot.chapterSummaries.rows)).toBe(true);
      expect(await captureBookMetadata(fixture.root)).toEqual(before);
    });

    it("fails closed on corrupt structured canon and never heals or creates files", async () => {
      const target = join(fixture.bookDir, "story", "state", "hooks.json");
      await writeFile(target, "{ broken", "utf-8");
      const before = await captureBookMetadata(fixture.root);
      await expect(readLiveRuntimeStateSnapshot(fixture.bookDir)).rejects.toThrow(/runtime state unreadable/);
      expect(await captureBookMetadata(fixture.root)).toEqual(before);
    });

    it("fails closed when a structured canon file is missing entirely", async () => {
      const target = join(fixture.bookDir, "story", "state", "chapter_summaries.json");
      await rm(target, { force: true });
      const before = await captureBookMetadata(fixture.root);
      await expect(readLiveRuntimeStateSnapshot(fixture.bookDir)).rejects.toThrow(/runtime state unreadable/);
      expect(await captureBookMetadata(fixture.root)).toEqual(before);
    });
  });

  describe("read-operation filesystem purity", () => {
    it("load/find/list/supersede/readLive perform ZERO tree mutations combined", async () => {
      await publishActiveProposal(fixture.bookDir, activeProposal());
      await writeResolvedReceipt(fixture.bookDir, 13, receiptFixture());
      const before = await captureBookMetadata(fixture.root);
      await loadStateReview(fixture.bookDir, 13);
      await findReceiptByReviewId(fixture.bookDir, 13, REVIEW_ID);
      await listReceiptsForChapter(fixture.bookDir, 13);
      await supersedeReceiptsForChapter({ bookDir: fixture.bookDir, chapter: 13 });
      await readLiveRuntimeStateSnapshot(fixture.bookDir);
      expect(await captureBookMetadata(fixture.root)).toEqual(before);
    });
  });
});
