import { join } from "node:path";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChapterMeta } from "../models/chapter.js";
import { captureBookMetadata, createCanonBook, type CanonBookFixture } from "./helpers/canon-fixture.js";
import {
  ACTIVE_REVIEW_RELPATH,
  RECEIPTS_DIR,
  findReceiptByReviewId,
  loadStateReview,
  publishActiveProposal,
  writeResolvedReceipt,
} from "../state/state-review-store.js";
import { ResolvedReviewReceiptSchema, StateReviewArtifactSchema } from "../models/state-review.js";
import {
  addUserStateReviewItem,
  decideStateReviewItem,
  editStateReviewItem,
  handleStateRelevantProseSave,
} from "../state/state-review-service.js";
import { executeEditTransaction } from "../interaction/edit-controller.js";
import { assertCanAdvanceStory } from "../state/advancement-gate.js";
import { ContinuityAuditor } from "../agents/continuity.js";
import { WriterAgent } from "../agents/writer.js";

const CREATED_AT = "2026-08-24T00:00:00.000Z";
const REVIEW_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const SHELL_RELPATH = ACTIVE_REVIEW_RELPATH(16);

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

function chapterEntry(number: number, status: ChapterMeta["status"], title = `第${number}章`) {
  return {
    number,
    title,
    status,
    wordCount: 10 + number,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    auditIssues: [],
    lengthWarnings: [],
  };
}

async function seedChapters(
  fixture: CanonBookFixture,
  entries: ReadonlyArray<{ number: number; status: ChapterMeta["status"] }>,
): Promise<void> {
  await mkdir(join(fixture.bookDir, "chapters"), { recursive: true });
  for (const entry of entries) {
    await writeFile(
      join(fixture.bookDir, "chapters", `${String(entry.number).padStart(4, "0")}_旧.md`),
      `# 第${entry.number}章 旧\n\n这是第${entry.number}章的旧正文。`,
      "utf-8",
    );
  }
  await writeFile(
    join(fixture.bookDir, "chapters", "index.json"),
    JSON.stringify(entries.map(({ number, status }) => chapterEntry(number, status)), null, 2),
    "utf-8",
  );
}

function replaceDeps(fixture: CanonBookFixture, renameFile?: (from: string, to: string) => Promise<void>) {
  return {
    bookDir: () => fixture.bookDir,
    loadChapterIndex: async () =>
      JSON.parse(await readFile(join(fixture.bookDir, "chapters", "index.json"), "utf-8")) as never,
    saveChapterIndex: vi.fn(async () => undefined),
    ...(renameFile ? { renameFile } : {}),
  };
}

async function seedReceipt(fixture: CanonBookFixture, chapter: number, reviewId = REVIEW_ID) {
  const receipt = ResolvedReviewReceiptSchema.parse({
    schemaVersion: 1,
    reviewId,
    sourceChapter: chapter,
    effectiveChapter: chapter + 1,
    proseRevision: "1111222233334444",
    baseCanonRevision: "aaaabbbbccccdddd",
    resultingCanonRevision: "eeeeffff00001111",
    proposals: [{ type: "fact", change: { action: "set", subject: "主角", predicate: "当前位置", object: "北岸灯塔" } }],
    decisions: [{ itemId: "current-state-fact:0:x", decision: "accepted" }],
    effectiveChanges: [{ type: "fact", change: { action: "set", subject: "主角", predicate: "当前位置", object: "北岸灯塔" } }],
    evidence: [{
      itemId: "current-state-fact:0:x",
      evidence: { claimedLevel: "explicit", verifiedLevel: "explicit", quote: "他走向了北岸灯塔" },
    }],
    resolvedAt: "2026-08-24T02:00:00.000Z",
    resolution: "confirmed-changes",
  });
  await writeResolvedReceipt(fixture.bookDir, chapter, receipt);
  return receipt;
}

const NEW_PROSE = "# 第16章 反转\n\n林秋在黎明烧毁了账本，决定留守伦敦追查遗嘱。";

describe("state-review-invalidation", () => {
  let fixture: CanonBookFixture;

  beforeEach(async () => {
    fixture = await createCanonBook({ seedSnapshotsThrough: 12 });
  });

  afterEach(async () => {
    await rm(fixture.root, { recursive: true, force: true }).catch(() => undefined);
  });

  it("(C) handler on a chapter with no review history returns EMPTY receiptWrites and a valid shell write", async () => {
    const result = await handleStateRelevantProseSave({
      bookDir: fixture.bookDir,
      chapter: 16,
      language: "zh",
    });

    expect(result.receiptWrites).toEqual([]);
    const parsed = JSON.parse(result.shellWrite.content);
    expect(parsed.status).toBe("rebuild_required");
    expect(Object.keys(parsed).sort()).toEqual([
      "createdAt", "language", "reason", "schemaVersion", "sourceChapter", "status",
    ]);
    expect(parsed.sourceChapter).toBe(16);
    // Shell carries NO active-only fields.
    expect(parsed.reviewId).toBeUndefined();
    expect(parsed.reviewRevision).toBeUndefined();
    expect(parsed.items).toBeUndefined();
    expect(parsed.proseRevision).toBeUndefined();
    expect(parsed.baseCanonRevision).toBeUndefined();
    expect(result.shellWrite.relativePath.replace(/\\/g, "/")).toBe(SHELL_RELPATH);
  });

  it("(A) prose edit on an ACTIVE pending review atomically replaces it with a rebuild_required shell", async () => {
    await seedChapters(fixture, [{ number: 16, status: "needs-state-review" }]);
    await publishActiveProposal(fixture.bookDir, {
      schemaVersion: 1,
      status: "active",
      reviewId: REVIEW_ID,
      sourceChapter: 16,
      effectiveChapter: 17,
      proseRevision: "0123456789abcdef",
      baseCanonRevision: "fedcba9876543210",
      reviewRevision: 3,
      items: [],
      createdAt: CREATED_AT,
      language: "zh",
    });
    const before = await captureBookMetadata(fixture.root);

    const result = await executeEditTransaction(replaceDeps(fixture), {
      kind: "chapter-replace",
      bookId: "demo-canon-book",
      chapterNumber: 16,
      fullText: NEW_PROSE,
    });

    expect(result.reviewRequired).toBe(true);
    const after = await captureBookMetadata(fixture.root);
    expectOnlyPathsChanged(before, after, [
      "chapters/0016_旧.md",
      SHELL_RELPATH,
      "chapters/index.json",
    ]);

    // Exact durable prose bytes (single trailing newline normalization).
    await expect(readFile(join(fixture.bookDir, "chapters", "0016_旧.md"), "utf-8"))
      .resolves.toBe(`${NEW_PROSE}\n`);
    // Artifact REPLACED by the non-confirmable shell — no active fields survive.
    const reloaded = await loadStateReview(fixture.bookDir, 16);
    expect(reloaded?.status).toBe("rebuild_required");
    if (reloaded?.status === "rebuild_required") {
      expect(reloaded.sourceChapter).toBe(16);
      expect("reviewId" in reloaded).toBe(false);
      expect("items" in reloaded).toBe(false);
    }
    // Index stays needs-state-review ON DISK, same commit.
    const indexOnDisk = JSON.parse(await readFile(join(fixture.bookDir, "chapters", "index.json"), "utf-8"));
    expect(indexOnDisk[0].status).toBe("needs-state-review");
    // Canon untouched (fixture-seeded structured state byte-identical via tree diff above).
  });

  it("(L) completed decisions and user items are invalidated: shell replaces them and Task 8 APIs refuse shells", async () => {
    await seedChapters(fixture, [{ number: 16, status: "needs-state-review" }]);
    await publishActiveProposal(fixture.bookDir, {
      schemaVersion: 1,
      status: "active",
      reviewId: REVIEW_ID,
      sourceChapter: 16,
      effectiveChapter: 17,
      proseRevision: "0123456789abcdef",
      baseCanonRevision: "fedcba9876543210",
      reviewRevision: 1,
      items: [
        {
          id: "current-state-fact:0:a", kind: "current-state-fact", origin: "ai",
          title: "goal", proposal: { type: "fact", change: { action: "set", subject: "主角", predicate: "当前目标", object: "查账" } },
          decision: "undecided",
        },
      ],
      createdAt: CREATED_AT,
      language: "zh",
    });
    await decideStateReviewItem({ bookDir: fixture.bookDir, chapter: 16, itemId: "current-state-fact:0:a", decision: "accept", expectedReviewRevision: 1 });
    const withEdit = await editStateReviewItem({
      bookDir: fixture.bookDir, chapter: 16, itemId: "current-state-fact:0:a",
      expectedReviewRevision: 2, editedChange: { type: "fact", change: { action: "set", subject: "主角", predicate: "当前目标", object: "焚账" } },
    });
    const withUser = await addUserStateReviewItem({
      bookDir: fixture.bookDir, chapter: 16, expectedReviewRevision: withEdit.reviewRevision,
      kind: "current-state-fact", title: "missing",
      change: { type: "fact", change: { action: "set", subject: "主角", predicate: "当前位置", object: "西郊仓库" } },
    });

    await executeEditTransaction(replaceDeps(fixture), {
      kind: "chapter-replace", bookId: "demo-canon-book", chapterNumber: 16, fullText: NEW_PROSE,
    });

    const reloaded = await loadStateReview(fixture.bookDir, 16);
    expect(reloaded?.status).toBe("rebuild_required");
    // Task 8 decision APIs must no longer be able to mutate the shell.
    const before = await captureBookMetadata(fixture.root);
    await expect(decideStateReviewItem({
      bookDir: fixture.bookDir, chapter: 16, itemId: "current-state-fact:0:a",
      decision: "accept", expectedReviewRevision: withUser.reviewRevision + 1,
    })).rejects.toMatchObject({ code: "state_review_stale" });
    expect(await captureBookMetadata(fixture.root)).toEqual(before);
  });

  it("(B) READY chapter with resolved receipt leaves READY atomically: needs-state-review + shell + superseded receipt", async () => {
    await seedChapters(fixture, [
      { number: 16, status: "approved" },
      { number: 17, status: "approved" },
    ]);
    const receipt = await seedReceipt(fixture, 16);
    const before = await captureBookMetadata(fixture.root);

    await executeEditTransaction(replaceDeps(fixture), {
      kind: "chapter-replace", bookId: "demo-canon-book", chapterNumber: 16, fullText: NEW_PROSE,
    });

    const after = await captureBookMetadata(fixture.root);
    expectOnlyPathsChanged(before, after, [
      "chapters/0016_旧.md",
      SHELL_RELPATH,
      "chapters/index.json",
      `${RECEIPTS_DIR(16)}/${REVIEW_ID}.json`,
    ]);
    // Receipt flipped to superseded with EVERY historical field preserved.
    const superseded = await findReceiptByReviewId(fixture.bookDir, 16, REVIEW_ID);
    expect(superseded).toEqual({ ...receipt, resolution: "superseded" });
    // Index left READY in the SAME commit.
    const indexOnDisk = JSON.parse(await readFile(join(fixture.bookDir, "chapters", "index.json"), "utf-8"));
    expect(indexOnDisk[0].status).toBe("needs-state-review");
    expect(indexOnDisk[1].status).toBe("approved");
    const reloaded = await loadStateReview(fixture.bookDir, 16);
    expect(reloaded?.status).toBe("rebuild_required");
  });

  it("(K) mid-set rename failure restores OLD prose, OLD index, ACTIVE artifact and receipt completely", async () => {
    await seedChapters(fixture, [{ number: 16, status: "needs-state-review" }]);
    await publishActiveProposal(fixture.bookDir, {
      schemaVersion: 1, status: "active", reviewId: REVIEW_ID, sourceChapter: 16,
      effectiveChapter: 17, proseRevision: "0123456789abcdef", baseCanonRevision: "fedcba9876543210",
      reviewRevision: 2, items: [], createdAt: CREATED_AT, language: "zh",
    });
    const beforeBytes = {
      prose: await readFile(join(fixture.bookDir, "chapters", "0016_旧.md"), "utf-8"),
      artifact: await readFile(join(fixture.bookDir, SHELL_RELPATH), "utf-8"),
      index: await readFile(join(fixture.bookDir, "chapters", "index.json"), "utf-8"),
    };
    const before = await captureBookMetadata(fixture.root);

    // Fail during the COMMIT phase of the staged index write (after earlier
    // staged renames succeeded) so rollback must undo real committed work.
    let sawStagedIndexRename = false;
    const failingRename = async (from: string, to: string): Promise<void> => {
      if (!sawStagedIndexRename && /index\.json$/.test(from.replace(/\\/g, "/")) && from.includes("staged")) {
        sawStagedIndexRename = true;
        throw new Error("injected mid-set rename failure");
      }
      const { rename } = await import("node:fs/promises");
      await rename(from, to);
    };

    await expect(executeEditTransaction(replaceDeps(fixture, failingRename), {
      kind: "chapter-replace", bookId: "demo-canon-book", chapterNumber: 16, fullText: NEW_PROSE,
    })).rejects.toThrow(/injected mid-set rename failure/);

    expect(await readFile(join(fixture.bookDir, "chapters", "0016_旧.md"), "utf-8")).toBe(beforeBytes.prose);
    expect(await readFile(join(fixture.bookDir, SHELL_RELPATH), "utf-8")).toBe(beforeBytes.artifact);
    expect(await readFile(join(fixture.bookDir, "chapters", "index.json"), "utf-8")).toBe(beforeBytes.index);
    // The legacy version-archive side-write (pre-transaction, by design) is
    // the ONLY permitted difference; every authoritative path rolled back.
    const stripVersions = (snapshot: Record<string, unknown>): Record<string, unknown> =>
      Object.fromEntries(Object.entries(snapshot).filter(([key]) => !key.includes(".versions")));
    expect(stripVersions(await captureBookMetadata(fixture.root))).toEqual(stripVersions(before));
    const afterKeys = Object.keys(await captureBookMetadata(fixture.root));
    const newVersionKeys = afterKeys.filter((key) => key.includes(".versions")
      && !(key in before));
    expect(newVersionKeys).toHaveLength(1);
    await expect(readFile(join(fixture.root, newVersionKeys[0]!), "utf-8")).resolves.toBe(beforeBytes.prose);
    expect((await readdir(fixture.root, { recursive: true }))
      .map((entry) => entry.replace(/\\/g, "/"))
      .filter((entry) => entry.includes(".inkos-file-txn-")))
      .toEqual([]);
  });

  it("(D/H) historical chapter 16 edit with head at 25 cascades NOTHING and blocks chapter 26 via Task 5", async () => {
    await seedChapters(fixture, [
      { number: 16, status: "approved" },
      ...Array.from({ length: 9 }, (_, index) => ({ number: 17 + index, status: "approved" as const })),
    ]);
    await seedReceipt(fixture, 16);
    const before = await captureBookMetadata(fixture.root);

    await executeEditTransaction(replaceDeps(fixture), {
      kind: "chapter-replace", bookId: "demo-canon-book", chapterNumber: 16, fullText: NEW_PROSE,
    });

    const changedKeys = Object.keys(captureDiff(before, await captureBookMetadata(fixture.root)));
    const normalized = changedKeys.map((key) => key.replace(/\\/g, "/"));
    for (const key of normalized) {
      expect(["chapters/0016_旧.md", SHELL_RELPATH, "chapters/index.json", `${RECEIPTS_DIR(16)}/${REVIEW_ID}.json`])
        .toContain(key);
    }
    // Chapters 17–25 files untouched (only ch16 prose + shared index changed).
    for (let number = 17; number <= 25; number += 1) {
      await expect(readFile(join(fixture.bookDir, "chapters", `${String(number).padStart(4, "0")}_旧.md`), "utf-8"))
        .resolves.toContain(`这是第${number}章的旧正文`);
    }
    // Shell binds the HISTORICAL source chapter…
    const reloaded = await loadStateReview(fixture.bookDir, 16);
    expect(reloaded?.status).toBe("rebuild_required");
    if (reloaded?.status === "rebuild_required") expect(reloaded.sourceChapter).toBe(16);
    // …and Task 5 therefore refuses normal advancement to chapter 26.
    await expect(assertCanAdvanceStory(fixture.bookDir, 26)).rejects.toThrow();
  });

  it("(Q) corrupt ACTIVE artifact fails closed before any write", async () => {
    await seedChapters(fixture, [{ number: 16, status: "needs-state-review" }]);
    await mkdir(join(fixture.bookDir, "story", "runtime"), { recursive: true });
    await writeFile(join(fixture.bookDir, SHELL_RELPATH), "{ not json", "utf-8");
    const before = await captureBookMetadata(fixture.root);

    await expect(executeEditTransaction(replaceDeps(fixture), {
      kind: "chapter-replace", bookId: "demo-canon-book", chapterNumber: 16, fullText: NEW_PROSE,
    })).rejects.toThrow();

    expect(await captureBookMetadata(fixture.root)).toEqual(before);
  });

  it("(R) corrupt resolved receipt fails closed before any write", async () => {
    await seedChapters(fixture, [{ number: 16, status: "approved" }]);
    await mkdir(join(fixture.bookDir, RECEIPTS_DIR(16)), { recursive: true });
    await writeFile(join(fixture.bookDir, RECEIPTS_DIR(16), `${REVIEW_ID}.json`), "{ broken", "utf-8");
    const before = await captureBookMetadata(fixture.root);

    await expect(executeEditTransaction(replaceDeps(fixture), {
      kind: "chapter-replace", bookId: "demo-canon-book", chapterNumber: 16, fullText: NEW_PROSE,
    })).rejects.toThrow();

    expect(await captureBookMetadata(fixture.root)).toEqual(before);
  });

  it("(I/J) no AI/audit/settlement runs, saveChapterIndex is NOT called, legacy runtime deletes still happen", async () => {
    await seedChapters(fixture, [{ number: 16, status: "needs-state-review" }]);
    await mkdir(join(fixture.bookDir, "story", "runtime"), { recursive: true });
    await writeFile(join(fixture.bookDir, "story", "runtime", "chapter-0016.plan.md"), "old plan", "utf-8");
    await writeFile(join(fixture.bookDir, "story", "runtime", "chapter-0016.user-brief.md"), "保留雨夜证词。\n", "utf-8");
    const writeSpy = vi.spyOn(WriterAgent.prototype, "writeChapter");
    const settleSpy = vi.spyOn(WriterAgent.prototype, "settleChapterState");
    const auditSpy = vi.spyOn(ContinuityAuditor.prototype, "auditChapter");
    const deps = replaceDeps(fixture);

    await executeEditTransaction(deps, {
      kind: "chapter-replace", bookId: "demo-canon-book", chapterNumber: 16, fullText: NEW_PROSE,
    });

    expect(writeSpy).not.toHaveBeenCalled();
    expect(settleSpy).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
    expect(deps.saveChapterIndex).not.toHaveBeenCalled();
    await expect(readFile(join(fixture.bookDir, "story", "runtime", "chapter-0016.plan.md"), "utf-8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    // User brief is preserved by legacy exclusion.
    await expect(readFile(join(fixture.bookDir, "story", "runtime", "chapter-0016.user-brief.md"), "utf-8"))
      .resolves.toBe("保留雨夜证词。\n");
  });

  it("(P/N) editing over an existing rebuild_required shell keeps a fresh rebuild_required shell", async () => {
    await seedChapters(fixture, [{ number: 16, status: "needs-state-review" }]);
    await executeEditTransaction(replaceDeps(fixture), {
      kind: "chapter-replace", bookId: "demo-canon-book", chapterNumber: 16, fullText: NEW_PROSE,
    });
    const firstShell = await loadStateReview(fixture.bookDir, 16);

    await executeEditTransaction(replaceDeps(fixture), {
      kind: "chapter-replace", bookId: "demo-canon-book", chapterNumber: 16, fullText: `${NEW_PROSE}\n\n补一段新的结尾。`,
    });

    const secondShell = await loadStateReview(fixture.bookDir, 16);
    expect(secondShell?.status).toBe("rebuild_required");
    expect(firstShell?.status).toBe("rebuild_required");
  });

  it("(i-9.1A) approved chapter WITHOUT a resolved receipt still leaves READY via the legacy-compatibility rule", async () => {
    // Pre-Phase-4 book shape: approved lifecycle, valid Canon/projections from
    // the fixture, but NO state-review receipt has ever existed for ch16.
    await seedChapters(fixture, [{ number: 16, status: "approved" }]);
    const before = await captureBookMetadata(fixture.root);

    await executeEditTransaction(replaceDeps(fixture), {
      kind: "chapter-replace", bookId: "demo-canon-book", chapterNumber: 16, fullText: NEW_PROSE,
    });

    const after = await captureBookMetadata(fixture.root);
    expectOnlyPathsChanged(before, after, [
      "chapters/0016_旧.md",
      SHELL_RELPATH,
      "chapters/index.json",
    ]);
    await expect(readFile(join(fixture.bookDir, "chapters", "0016_旧.md"), "utf-8"))
      .resolves.toBe(`${NEW_PROSE}\n`);
    const indexOnDisk = JSON.parse(await readFile(join(fixture.bookDir, "chapters", "index.json"), "utf-8"));
    expect(indexOnDisk[0].status).toBe("needs-state-review");
    const reloaded = await loadStateReview(fixture.bookDir, 16);
    expect(reloaded?.status).toBe("rebuild_required");
    if (reloaded?.status === "rebuild_required") {
      expect(reloaded.sourceChapter).toBe(16);
      expect("reviewId" in reloaded).toBe(false);
    }
    // No receipt fabricated and none superseded — the receipts directory for
    // this chapter must not exist after the edit.
    await expect(readFile(join(fixture.bookDir, RECEIPTS_DIR(16), "anything.json"), "utf-8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    expect((await readdir(join(fixture.bookDir, "story", "runtime"), { recursive: true }))
      .map((entry) => entry.replace(/\\/g, "/"))
      .filter((entry) => entry.includes("state-review-receipts")))
      .toEqual([]);
    // Canon byte-identical (story/state/** is outside the allow-list above).
  });

  it("(i-9.1B) prose edit over a STALE artifact replaces it with a non-confirmable rebuild_required shell", async () => {
    await seedChapters(fixture, [{ number: 16, status: "needs-state-review" }]);
    // Exact Task 1 stale variant: active-shaped anchors, non-confirmable status.
    const staleArtifact = StateReviewArtifactSchema.parse({
      schemaVersion: 1,
      status: "stale",
      sourceChapter: 16,
      createdAt: CREATED_AT,
      language: "zh",
      reviewId: REVIEW_ID,
      effectiveChapter: 17,
      proseRevision: "0123456789abcdef",
      baseCanonRevision: "fedcba9876543210",
      reviewRevision: 4,
      items: [{
        id: "current-state-fact:0:a",
        kind: "current-state-fact",
        origin: "ai",
        title: "stale proposal item",
        proposal: { type: "fact", change: { action: "set", subject: "主角", predicate: "当前位置", object: "旧宅" } },
        decision: "accepted",
      }],
    });
    await mkdir(join(fixture.bookDir, "story", "runtime"), { recursive: true });
    await writeFile(join(fixture.bookDir, SHELL_RELPATH), JSON.stringify(staleArtifact, null, 2), "utf-8");
    const before = await captureBookMetadata(fixture.root);

    await executeEditTransaction(replaceDeps(fixture), {
      kind: "chapter-replace", bookId: "demo-canon-book", chapterNumber: 16, fullText: NEW_PROSE,
    });

    const after = await captureBookMetadata(fixture.root);
    expectOnlyPathsChanged(before, after, [
      "chapters/0016_旧.md",
      SHELL_RELPATH,
      "chapters/index.json",
    ]);
    await expect(readFile(join(fixture.bookDir, "chapters", "0016_旧.md"), "utf-8"))
      .resolves.toBe(`${NEW_PROSE}\n`);
    // Stale identity/items/decisions are NOT carried into the shell.
    const reloaded = await loadStateReview(fixture.bookDir, 16);
    expect(reloaded?.status).toBe("rebuild_required");
    if (reloaded?.status === "rebuild_required") {
      expect(reloaded.sourceChapter).toBe(16);
      expect("reviewId" in reloaded).toBe(false);
      expect("items" in reloaded).toBe(false);
    }
    const indexOnDisk = JSON.parse(await readFile(join(fixture.bookDir, "chapters", "index.json"), "utf-8"));
    expect(indexOnDisk[0].status).toBe("needs-state-review");
    // Real Task 8 mutation against the resulting shell must refuse with ZERO write.
    await expect(decideStateReviewItem({
      bookDir: fixture.bookDir,
      chapter: 16,
      itemId: "current-state-fact:0:a",
      decision: "accept",
      expectedReviewRevision: 5,
    })).rejects.toMatchObject({ code: "state_review_stale" });
    expect(await captureBookMetadata(fixture.root)).toEqual(after);
  });
});

function captureDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  const normalizeKey = (key: string): string => key.replace(/\\/g, "/");
  const keys = new Set([...Object.keys(before), ...Object.keys(after)].map(normalizeKey));
  const changed: string[] = [];
  for (const key of keys) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changed.push(key);
  }
  return changed;
}
