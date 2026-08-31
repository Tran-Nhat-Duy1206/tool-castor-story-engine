import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCanonBook, captureBookMetadata, type CanonBookFixture } from "./helpers/canon-fixture.js";
import { assertCanAdvanceStory } from "../state/advancement-gate.js";
import {
  ACTIVE_REVIEW_RELPATH,
  RECEIPTS_DIR,
} from "../state/state-review-store.js";
import {
  ResolvedReviewReceiptSchema,
  StateReviewError,
} from "../models/state-review.js";

const CREATED_AT = "2026-08-24T00:00:00.000Z";
const REVIEW_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

function chapterMeta(number: number, status: string) {
  return {
    number,
    title: `第${number}章`,
    status,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

async function writeIndex(fixture: CanonBookFixture, metas: Array<{ number: number; status: string }>): Promise<void> {
  await mkdir(join(fixture.bookDir, "chapters"), { recursive: true });
  await writeFile(
    join(fixture.bookDir, "chapters", "index.json"),
    JSON.stringify(metas.map((meta) => chapterMeta(meta.number, meta.status))),
    "utf-8",
  );
}

async function writeRuntimeArtifact(fixture: CanonBookFixture, chapter: number, content: string): Promise<void> {
  const target = join(fixture.bookDir, ACTIVE_REVIEW_RELPATH(chapter));
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, content, "utf-8");
}

function shellArtifact(sourceChapter: number, status: "rebuild_required" | "rebuild_failed" = "rebuild_required") {
  return JSON.stringify({
    schemaVersion: 1,
    status,
    sourceChapter,
    createdAt: CREATED_AT,
    language: "vi",
    ...(status === "rebuild_required" ? {} : { reason: "analyzer crashed" }),
  });
}

function activeArtifact(sourceChapter: number, effectiveChapter: number, status: "active" | "stale" = "active") {
  return JSON.stringify({
    schemaVersion: 1,
    status,
    reviewId: REVIEW_ID,
    sourceChapter,
    effectiveChapter,
    proseRevision: "0123456789abcdef",
    baseCanonRevision: "fedcba9876543210",
    reviewRevision: 1,
    items: [],
    createdAt: CREATED_AT,
    language: "vi",
  });
}

async function writeResolvedReceipt(fixture: CanonBookFixture, sourceChapter: number, reviewId = REVIEW_ID): Promise<void> {
  const dir = join(fixture.bookDir, RECEIPTS_DIR(sourceChapter));
  await mkdir(dir, { recursive: true });
  const receipt = ResolvedReviewReceiptSchema.parse({
    schemaVersion: 1,
    reviewId,
    sourceChapter,
    effectiveChapter: sourceChapter + 1,
    proseRevision: "0123456789abcdef",
    baseCanonRevision: "fedcba9876543210",
    resultingCanonRevision: "0000000000000001",
    proposals: [],
    decisions: [],
    effectiveChanges: [],
    evidence: [],
    resolvedAt: "2026-08-24T01:00:00.000Z",
    resolution: "confirmed-no-changes",
  });
  await writeFile(join(dir, `${reviewId}.json`), JSON.stringify(receipt), "utf-8");
}

/** Approved index entry for nextChapter-1 plus nothing else. */
function approvedPrevious(nextChapter: number): Array<{ number: number; status: string }> {
  return [{ number: nextChapter - 1, status: "approved" }];
}

describe("assertCanAdvanceStory", () => {
  let fixture: CanonBookFixture;

  beforeEach(async () => {
    fixture = await createCanonBook({ seedSnapshotsThrough: 12 });
  });

  afterEach(async () => {
    await rm(fixture.root, { recursive: true, force: true }).catch(() => undefined);
  });

  it("passes for nextChapter=1 on a fresh book with no runtime reviews", async () => {
    await expect(assertCanAdvanceStory(fixture.bookDir, 1)).resolves.toBeUndefined();
  });

  it("passes when the previous chapter is approved and no pending review exists", async () => {
    await writeIndex(fixture, approvedPrevious(26));
    await expect(assertCanAdvanceStory(fixture.bookDir, 26)).resolves.toBeUndefined();
  });

  // NOTE: "needs-state-review" becomes a legal ChapterStatus only in Task 7;
  // readiness here is proven with statuses that exist at HEAD. The rule is
  // status !== "approved", which every non-approved member exercises.
  it.each([
    ["revising"],
    ["ready-for-review"],
    ["audit-passed"],
    ["drafted"],
    ["state-degraded"],
  ])("blocks when the previous chapter is %s (only approved counts as READY)", async (status) => {
    await writeIndex(fixture, [{ number: 25, status }]);
    await expect(assertCanAdvanceStory(fixture.bookDir, 26)).rejects.toMatchObject({
      code: "state_review_incomplete",
    });
  });

  it("names the unapproved chapter and mentions State Review in the readiness message", async () => {
    await writeIndex(fixture, [{ number: 25, status: "revising" }]);
    const error = await assertCanAdvanceStory(fixture.bookDir, 26).then(
      () => null,
      (error: unknown) => error as StateReviewError,
    );
    expect(error).toBeInstanceOf(StateReviewError);
    expect(error?.message).toContain("Chapter 25");
    expect(error?.message).toContain("revising");
    expect(error?.message).toContain("State Review");
  });

  describe("active/stale artifact temporal rule (effectiveChapter <= nextChapter)", () => {
    it("blocks when effectiveChapter === nextChapter", async () => {
      await writeIndex(fixture, approvedPrevious(26));
      await writeRuntimeArtifact(fixture, 16, activeArtifact(16, 26));
      await expect(assertCanAdvanceStory(fixture.bookDir, 26)).rejects.toMatchObject({
        code: "state_review_conflict",
      });
    });

    it("blocks when effectiveChapter < nextChapter (historical correction)", async () => {
      await writeIndex(fixture, approvedPrevious(27));
      await writeRuntimeArtifact(fixture, 16, activeArtifact(16, 26));
      await expect(assertCanAdvanceStory(fixture.bookDir, 27)).rejects.toMatchObject({
        code: "state_review_conflict",
      });
    });

    it("does NOT block by the review rule when effectiveChapter > nextChapter", async () => {
      await writeIndex(fixture, approvedPrevious(25));
      await writeRuntimeArtifact(fixture, 16, activeArtifact(16, 26));
      await expect(assertCanAdvanceStory(fixture.bookDir, 25)).resolves.toBeUndefined();
    });

    it("blocks a STALE anchor-bearing artifact under the same <= rule", async () => {
      await writeIndex(fixture, approvedPrevious(26));
      await writeRuntimeArtifact(fixture, 16, activeArtifact(16, 26, "stale"));
      await expect(assertCanAdvanceStory(fixture.bookDir, 26)).rejects.toMatchObject({
        code: "state_review_conflict",
      });
    });

    it("canonical historical scenario: head 25 approved, source 16 effective 26 blocks 26", async () => {
      await writeIndex(fixture, approvedPrevious(26));
      await writeRuntimeArtifact(fixture, 16, activeArtifact(16, 26));
      const error = await assertCanAdvanceStory(fixture.bookDir, 26).then(
        () => null,
        (error: unknown) => error as StateReviewError,
      );
      expect(error?.code).toBe("state_review_conflict");
      expect(error?.message).toContain("State Review");
      expect(error?.message).toContain("16");
      expect(error?.message).toContain("26");
      expect(error?.message).toContain("Open State Review in Studio");
    });

    it("stops blocking once the pending artifact is resolved away (receipt remains)", async () => {
      await writeIndex(fixture, approvedPrevious(26));
      await writeRuntimeArtifact(fixture, 16, activeArtifact(16, 26));
      await writeResolvedReceipt(fixture, 16);
      await expect(assertCanAdvanceStory(fixture.bookDir, 26)).rejects.toBeInstanceOf(StateReviewError);

      await rm(join(fixture.bookDir, ACTIVE_REVIEW_RELPATH(16)), { force: true });
      await expect(assertCanAdvanceStory(fixture.bookDir, 26)).resolves.toBeUndefined();
    });
  });

  describe("rebuild shell temporal rule (sourceChapter < nextChapter)", () => {
    it("blocks a historical rebuild_required shell (source 16, next 26)", async () => {
      await writeIndex(fixture, approvedPrevious(26));
      await writeRuntimeArtifact(fixture, 16, shellArtifact(16));
      await expect(assertCanAdvanceStory(fixture.bookDir, 26)).rejects.toMatchObject({
        code: "state_review_conflict",
      });
    });

    it("blocks a historical rebuild_failed shell (source 16, next 26)", async () => {
      await writeIndex(fixture, approvedPrevious(26));
      await writeRuntimeArtifact(fixture, 16, shellArtifact(16, "rebuild_failed"));
      await expect(assertCanAdvanceStory(fixture.bookDir, 26)).rejects.toMatchObject({
        code: "state_review_conflict",
      });
    });

    it("blocks an older unresolved shell (source 5, next 20)", async () => {
      await writeIndex(fixture, approvedPrevious(20));
      await writeRuntimeArtifact(fixture, 5, shellArtifact(5));
      await expect(assertCanAdvanceStory(fixture.bookDir, 20)).rejects.toMatchObject({
        code: "state_review_conflict",
      });
    });

    it("does NOT block when shell sourceChapter >= nextChapter and previous chapter is approved", async () => {
      await writeIndex(fixture, approvedPrevious(26));
      await writeRuntimeArtifact(fixture, 30, shellArtifact(30));
      await expect(assertCanAdvanceStory(fixture.bookDir, 26)).resolves.toBeUndefined();
    });

    it("blocks a historical ACTIVE artifact for chapter >= 10000 via canonical wide naming", async () => {
      // Canonical filename from ACTIVE_REVIEW_RELPATH: chapter-10000.state-review.json.
      // The old exact-4-digit discovery regex silently missed this file.
      await writeIndex(fixture, [{ number: 10000, status: "approved" }]);
      await writeRuntimeArtifact(fixture, 10000, activeArtifact(10000, 10001));
      await expect(assertCanAdvanceStory(fixture.bookDir, 10001)).rejects.toMatchObject({
        code: "state_review_conflict",
      });
    });

    it("blocks a historical rebuild shell for chapter >= 10000 via canonical wide naming", async () => {
      await writeIndex(fixture, [{ number: 10000, status: "approved" }]);
      await writeRuntimeArtifact(fixture, 10000, shellArtifact(10000));
      await expect(assertCanAdvanceStory(fixture.bookDir, 10001)).rejects.toMatchObject({
        code: "state_review_conflict",
      });
    });
  });

  it("resolved receipts ALONE never block advancement", async () => {
    await writeIndex(fixture, approvedPrevious(26));
    await writeResolvedReceipt(fixture, 16);
    await writeResolvedReceipt(fixture, 17, "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee");
    await expect(assertCanAdvanceStory(fixture.bookDir, 26)).resolves.toBeUndefined();
  });

  it("never treats files inside receipt directories as pending artifacts", async () => {
    await writeIndex(fixture, approvedPrevious(26));
    // A receipt-directory file whose NAME mimics a pending artifact must not match.
    const mimic = join(fixture.bookDir, RECEIPTS_DIR(16), "chapter-0016.state-review.json");
    await mkdir(join(mimic, ".."), { recursive: true });
    await writeFile(mimic, "{ definitely not an artifact", "utf-8");
    await expect(assertCanAdvanceStory(fixture.bookDir, 26)).resolves.toBeUndefined();
  });

  it("selects blockers deterministically by ascending artifact chapter", async () => {
    await writeIndex(fixture, approvedPrevious(12));
    await writeRuntimeArtifact(fixture, 10, activeArtifact(10, 11));
    await writeRuntimeArtifact(fixture, 5, shellArtifact(5));
    const error = await assertCanAdvanceStory(fixture.bookDir, 12).then(
      () => null,
      (error: unknown) => error as StateReviewError,
    );
    expect(error?.message).toContain("chapter 5");
  });

  it("fails closed on a corrupt matched pending artifact and mutates nothing", async () => {
    await writeIndex(fixture, approvedPrevious(26));
    await writeRuntimeArtifact(fixture, 13, "{ this is not valid json");
    const before = await captureBookMetadata(fixture.root);
    await expect(assertCanAdvanceStory(fixture.bookDir, 26)).rejects.toThrow(/chapter-0013\.state-review\.json/);
    expect(await captureBookMetadata(fixture.root)).toEqual(before);
  });

  it("fails closed on a SCHEMA-invalid pending artifact, naming the file", async () => {
    await writeIndex(fixture, approvedPrevious(26));
    await writeRuntimeArtifact(fixture, 13, JSON.stringify({ hello: "world" }));
    await expect(assertCanAdvanceStory(fixture.bookDir, 26)).rejects.toThrow(
      /chapter-0013\.state-review\.json/,
    );
  });

  it("ignores malformed unrelated JSON files under story/runtime", async () => {
    await writeIndex(fixture, approvedPrevious(26));
    const junk = join(fixture.bookDir, "story", "runtime", "debug-notes.json");
    await mkdir(join(junk, ".."), { recursive: true });
    await writeFile(junk, "{ broken", "utf-8");
    await expect(assertCanAdvanceStory(fixture.bookDir, 26)).resolves.toBeUndefined();
  });

  it("performs zero filesystem mutations when the gate passes", async () => {
    await writeIndex(fixture, approvedPrevious(26));
    const before = await captureBookMetadata(fixture.root);
    await assertCanAdvanceStory(fixture.bookDir, 26);
    expect(await captureBookMetadata(fixture.root)).toEqual(before);
  });

  it("performs zero filesystem mutations when the gate blocks", async () => {
    await writeIndex(fixture, approvedPrevious(26));
    await writeRuntimeArtifact(fixture, 16, activeArtifact(16, 26));
    const before = await captureBookMetadata(fixture.root);
    await expect(assertCanAdvanceStory(fixture.bookDir, 26)).rejects.toBeInstanceOf(StateReviewError);
    expect(await captureBookMetadata(fixture.root)).toEqual(before);
  });

  it("reports previous-chapter readiness ahead of pending artifacts, but corruption always wins", async () => {
    await writeIndex(fixture, [{ number: 25, status: "ready-for-review" }]);
    await writeRuntimeArtifact(fixture, 16, activeArtifact(16, 26));
    // Non-corrupt pending + unapproved previous ⇒ readiness blocker reported first.
    await expect(assertCanAdvanceStory(fixture.bookDir, 26)).rejects.toMatchObject({
      code: "state_review_incomplete",
    });

    // Corrupt artifact PLUS unapproved previous ⇒ corruption is NEVER hidden.
    await writeRuntimeArtifact(fixture, 13, "{ broken governance artifact");
    await expect(assertCanAdvanceStory(fixture.bookDir, 26)).rejects.toThrow(
      /chapter-0013\.state-review\.json/,
    );
  });

  it("treats a missing chapter-index record as not-approved (fail-closed)", async () => {
    await writeIndex(fixture, [{ number: 10, status: "approved" }]);
    await expect(assertCanAdvanceStory(fixture.bookDir, 26)).rejects.toMatchObject({
      code: "state_review_incomplete",
    });
  });
});
