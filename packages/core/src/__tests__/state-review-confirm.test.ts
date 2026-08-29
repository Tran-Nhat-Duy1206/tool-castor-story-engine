import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureBookMetadata, createCanonBook, type CanonBookFixture } from "./helpers/canon-fixture.js";
import {
  ACTIVE_REVIEW_RELPATH,
  findReceiptByReviewId,
  loadStateReview,
  publishActiveProposal,
  readLiveRuntimeStateSnapshot,
} from "../state/state-review-store.js";
import {
  CurrentStateStateSchema,
  HooksStateSchema,
  StateManifestSchema,
  ChapterSummariesStateSchema,
} from "../models/runtime-state.js";
import { ChapterMetaSchema } from "../models/chapter.js";
import {
  ResolvedReviewReceiptSchema,
  StateReviewError,
  type ReviewItem,
} from "../models/state-review.js";
import { computeProseRevision } from "../utils/prose-revision.js";
import { readStoryCanon } from "../state/canon-service.js";
import { prepareStateReviewConfirm } from "../state/state-review-confirm.js";

const t12 = vi.hoisted(() => ({
  commits: 0,
  lockAcquisitions: 0,
  lockReleases: 0,
  syncCalls: { rebuildIndex: 0, rebuildHistory: 0, invalidate: 0 },
  failDerivedRebuild: false,
  failDerivedInvalidation: false,
}));

vi.mock("../utils/atomic-file-set.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/atomic-file-set.js")>();
  return {
    ...actual,
    commitAtomicFileSet: async (input: Parameters<typeof actual.commitAtomicFileSet>[0]) => {
      t12.commits += 1;
      await actual.commitAtomicFileSet(input);
    },
  };
});

vi.mock("../state/manager.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../state/manager.js")>();
  class CountingStateManager extends actual.StateManager {
    override async acquireBookLock(bookId: string): Promise<() => Promise<void>> {
      const release = await super.acquireBookLock(bookId);
      t12.lockAcquisitions += 1;
      return async () => {
        t12.lockReleases += 1;
        await release();
      };
    }
  }
  return { ...actual, StateManager: CountingStateManager };
});

vi.mock("../state/memory-sync.js", () => ({
  rebuildNarrativeMemoryIndex: async () => {
    t12.syncCalls.rebuildIndex += 1;
    if (t12.failDerivedRebuild) throw new Error("derived rebuild exploded");
  },
  rebuildCurrentStateFactHistory: async () => {
    t12.syncCalls.rebuildHistory += 1;
    if (t12.failDerivedRebuild) throw new Error("derived rebuild exploded");
  },
  invalidateDerivedMemory: async () => {
    t12.syncCalls.invalidate += 1;
    return t12.failDerivedInvalidation
      ? ({ invalidated: false, strategy: "failed", warning: "derived memory invalidation failed; memory.db may be stale" } as const)
      : ({ invalidated: true, strategy: "deleted" } as const);
  },
}));

// eslint-disable-next-line import/order -- mocked modules must resolve through the hoisted factory
import { StateManager } from "../state/manager.js";
import { confirmStateReview } from "../state/state-review-finalize.js";

const CREATED_AT = "2026-08-24T00:00:00.000Z";
const REVIEW_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
const PROSE_16 = "# 第16章 反转\n\n林秋在北岸灯塔烧毁了账本。";

/** Module-scope mirror so the Task 12 describe can assert typed errors too. */
function expectStateReviewError(error: unknown, code: string, itemId?: string): void {
  expect(error).toBeInstanceOf(StateReviewError);
  expect((error as StateReviewError).code).toBe(code);
  if (itemId !== undefined) {
    expect((error as StateReviewError).itemId).toBe(itemId);
  }
}

function factProposal(predicate: string, object: string) {
  return {
    type: "fact" as const,
    change: { action: "set" as const, subject: "主角", predicate, object },
  };
}

function factItem(id: string, predicate: string, object: string, overrides?: Partial<ReviewItem>): ReviewItem {
  return {
    id,
    kind: "current-state-fact",
    origin: "ai",
    title: `Current-state update: ${predicate}`,
    proposal: factProposal(predicate, object),
    evidence: { claimedLevel: "explicit", verifiedLevel: "explicit", quote: "北岸灯塔" },
    decision: "accepted",
    ...overrides,
  };
}

async function seedProseAndIndex(
  fixture: CanonBookFixture,
  chapter: number,
  prose: string,
  statuses: Record<number, string>,
): Promise<void> {
  const prefix = String(chapter).padStart(4, "0");
  const chaptersDir = join(fixture.bookDir, "chapters");
  // Replace any colliding durable prose for this chapter (fixture seeds
  // `0016_第16章.md`; the reviewed generation owns exactly ONE file).
  for (const name of await readdir(chaptersDir)) {
    if (name.startsWith(`${prefix}_`) && name.endsWith(".md")) {
      await rm(join(chaptersDir, name));
    }
  }
  await writeFile(join(chaptersDir, `${prefix}_反转.md`), prose, "utf-8");
  const numbers = [...Object.keys(statuses).map(Number)].sort((a, b) => a - b);
  await writeFile(
    join(fixture.bookDir, "chapters", "index.json"),
    JSON.stringify(numbers.map((number) => ({
      number,
      title: `第${number}章`,
      status: statuses[number],
      wordCount: 10,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      auditIssues: [],
      lengthWarnings: [],
    })), null, 2),
    "utf-8",
  );
}

/** Publish a schema-valid ACTIVE review whose anchors match the live fixture state. */
async function publishActiveReview(
  fixture: CanonBookFixture,
  options: {
    readonly sourceChapter: number;
    readonly effectiveChapter: number;
    readonly items: ReadonlyArray<ReviewItem>;
    readonly reviewId?: string;
    readonly proseText?: string;
    readonly extraStatuses?: Record<number, string>;
  },
): Promise<string> {
  const proseText = options.proseText ?? PROSE_16;
  await seedProseAndIndex(
    fixture,
    options.sourceChapter,
    proseText,
    Object.fromEntries(
      [
        ...(options.sourceChapter > 1 ? [[1, "approved"] as const] : []),
        [options.sourceChapter, "needs-state-review"] as const,
        ...Object.entries(options.extraStatuses ?? {}).map(
          ([number, status]) => [Number(number), status] as const,
        ),
      ],
    ),
  );
  const canon = await readStoryCanon(fixture.bookDir);
  const reviewId = options.reviewId ?? REVIEW_ID;
  await publishActiveProposal(fixture.bookDir, {
    status: "active",
    schemaVersion: 1,
    sourceChapter: options.sourceChapter,
    createdAt: CREATED_AT,
    language: "zh",
    reviewId,
    effectiveChapter: options.effectiveChapter,
    proseRevision: computeProseRevision(proseText),
    baseCanonRevision: canon.revision,
    reviewRevision: 1,
    items: [...options.items],
  });
  return reviewId;
}

describe("state-review-confirm PREPARE (pure)", () => {
  let fixture: CanonBookFixture;

  beforeEach(async () => {
    // Confirmed Canon head = 25: contiguous chapters 1..25 AND
    // manifest.lastAppliedChapter = 25 (createCanonBook ties them together).
    fixture = await createCanonBook({ chapterCount: 25 });
  });

  afterEach(async () => {
    await rm(fixture.root, { recursive: true, force: true }).catch(() => undefined);
  });

  async function expectZeroWrites(run: () => Promise<unknown>): Promise<void> {
    const before = await captureBookMetadata(fixture.root);
    await run();
    expect(await captureBookMetadata(fixture.root)).toEqual(before);
  }

  function expectStateReviewError(error: unknown, code: string, itemId?: string): void {
    expect(error).toBeInstanceOf(StateReviewError);
    const reviewError = error as StateReviewError;
    expect(reviewError.code).toBe(code);
    if (itemId !== undefined) expect(reviewError.itemId).toBe(itemId);
  }

  it("(T1) complete accepted AI items compile into candidate canon, projections, index, receipt — ZERO disk writes", async () => {
    const reviewId = await publishActiveReview(fixture, {
      sourceChapter: 16,
      effectiveChapter: 26,
      items: [
        factItem("item-fact", "当前位置", "北岸灯塔"),
        {
          id: "item-summary",
          kind: "chapter-summary",
          origin: "ai",
          title: "Chapter summary: ch 16 反转",
          proposal: {
            type: "chapter-summary",
            row: {
              chapter: 16,
              title: "反转",
              characters: "主角；林秋",
              events: "林秋在北岸灯塔烧毁了账本",
              stateChanges: "当前位置→北岸灯塔",
              hookActivity: "",
              mood: "紧张",
              chapterType: "调查",
            },
          },
          decision: "accepted",
        },
      ],
    });
    const before = await captureBookMetadata(fixture.root);

    const prepared = await prepareStateReviewConfirm({
      bookDir: fixture.bookDir,
      chapter: 16,
      expectedReviewRevision: 1,
      durableHead: 25,
    });

    // ---- shape / semantics -------------------------------------------------
    expect(prepared.effectiveChapter).toBe(26);
    expect(prepared.zeroEffectiveChange).toBe(false);
    expect(prepared.deletes).toEqual([ACTIVE_REVIEW_RELPATH(16)]);
    expect(prepared.receiptWrite.relativePath)
      .toBe(`story/runtime/state-review-receipts/chapter-0016/${reviewId}.json`);

    // Candidate canon writes parse against the REAL state schemas and encode
    // application AT the effective chapter 26 (not the source chapter).
    expect(prepared.canonWrites.map((w) => w.relativePath)).toEqual([
      "story/state/manifest.json",
      "story/state/current_state.json",
      "story/state/hooks.json",
      "story/state/chapter_summaries.json",
    ]);
    const byPath = new Map(prepared.canonWrites.map((w) => [w.relativePath, w.content]));
    const manifest = StateManifestSchema.parse(JSON.parse(byPath.get("story/state/manifest.json")!));
    expect(manifest.lastAppliedChapter).toBe(26);
    const currentState = CurrentStateStateSchema.parse(JSON.parse(byPath.get("story/state/current_state.json")!));
    expect(currentState.chapter).toBe(26);
    const lighthouse = currentState.facts.find((fact) => fact.object === "北岸灯塔");
    expect(lighthouse?.validFromChapter).toBe(26);
    expect(lighthouse?.sourceChapter).toBe(26);
    const summaries = ChapterSummariesStateSchema.parse(JSON.parse(byPath.get("story/state/chapter_summaries.json")!));
    expect(summaries.rows.some((row) => row.chapter === 26 && row.title === "反转")).toBe(true);
    HooksStateSchema.parse(JSON.parse(byPath.get("story/state/hooks.json")!));

    // Projections correspond to the SAME candidate state.
    expect(prepared.projectionWrites.map((w) => w.relativePath)).toEqual([
      "story/current_state.md",
      "story/pending_hooks.md",
      "story/chapter_summaries.md",
    ]);
    const projectionByPath = new Map(prepared.projectionWrites.map((w) => [w.relativePath, w.content]));
    expect(projectionByPath.get("story/current_state.md")).toContain("北岸灯塔");

    // Snapshot writes are composed for story/snapshots/26 but NOT on disk.
    const snapshotPaths = prepared.snapshotWrites.map((w) => w.relativePath);
    expect(snapshotPaths).toContain("story/snapshots/26/current_state.md");
    expect(snapshotPaths).toContain("story/snapshots/26/state/manifest.json");
    expect(snapshotPaths.find((p) => p.endsWith("snapshots/26/state/current_state.json")))
      .toBeDefined();
    const snapshotManifest = StateManifestSchema.parse(JSON.parse(
      prepared.snapshotWrites.find((w) => w.relativePath === "story/snapshots/26/state/manifest.json")!.content,
    ));
    expect(snapshotManifest.lastAppliedChapter).toBe(26);

    // Index candidate: reviewed chapter becomes approved IN MEMORY only.
    const indexEntries = ChapterMetaSchema.array().parse(JSON.parse(prepared.indexWrite.content));
    expect(indexEntries.find((entry) => entry.number === 16)?.status).toBe("approved");

    // Receipt freezes ALL typed layers + evidence, binds identity.
    const receipt = ResolvedReviewReceiptSchema.parse(JSON.parse(prepared.receiptWrite.content));
    expect(receipt.reviewId).toBe(reviewId);
    expect(receipt.sourceChapter).toBe(16);
    expect(receipt.effectiveChapter).toBe(26);
    expect(receipt.resolution).toBe("confirmed-changes");
    expect(receipt.proposals).toHaveLength(2);
    expect(receipt.decisions.map((d) => d.decision)).toEqual(["accepted", "accepted"]);
    expect(receipt.effectiveChanges).toHaveLength(2);
    expect(receipt.evidence).toEqual([
      { itemId: "item-fact", evidence: { claimedLevel: "explicit", verifiedLevel: "explicit", quote: "北岸灯塔" } },
    ]);
    expect(prepared.resultingCanonRevision).toMatch(/^[0-9a-f]{16}$/);
    expect(prepared.resultingCanonRevision).not.toBe(receipt.baseCanonRevision);

    // ---- ZERO-WRITE guarantee ---------------------------------------------
    expect(await captureBookMetadata(fixture.root)).toEqual(before);
  });

  it("(T2/T3/T5) edited compiles editedChange; rejected contributes nothing; stale editedChange on rejected is ignored", async () => {
    const reviewId = await publishActiveReview(fixture, {
      sourceChapter: 16,
      effectiveChapter: 26,
      items: [
        factItem("item-edited", "当前位置", "提案里的旧值", {
          decision: "edited",
          editedChange: factProposal("当前目标", "查明遗嘱真相"),
        }),
        factItem("item-rejected", "主角状态", "被拒绝的值", {
          decision: "rejected",
          editedChange: factProposal("当前目标", "拒绝项上残留的旧编辑"),
        }),
      ],
    });
    const before = await captureBookMetadata(fixture.root);

    const prepared = await prepareStateReviewConfirm({
      bookDir: fixture.bookDir, chapter: 16, expectedReviewRevision: 1, durableHead: 25,
    });

    const currentJson = prepared.canonWrites.find((w) => w.relativePath === "story/state/current_state.json")!;
    const candidate = CurrentStateStateSchema.parse(JSON.parse(currentJson.content));
    expect(candidate.facts.some((fact) => fact.predicate === "当前目标" && fact.object === "查明遗嘱真相")).toBe(true);
    expect(candidate.facts.some((fact) => fact.object === "提案里的旧值")).toBe(false);
    expect(candidate.facts.some((fact) => fact.object === "被拒绝的值")).toBe(false);
    expect(candidate.facts.some((fact) => fact.object === "拒绝项上残留的旧编辑")).toBe(false);
    const receipt = ResolvedReviewReceiptSchema.parse(JSON.parse(prepared.receiptWrite.content));
    expect(receipt.reviewId).toBe(reviewId);
    // Rejected stays in audit history with its stale edit, but contributes none.
    expect(receipt.decisions).toEqual([
      { itemId: "item-edited", decision: "edited" },
      { itemId: "item-rejected", decision: "rejected" },
    ].map((d) => expect.objectContaining(d)));
    expect(receipt.effectiveChanges[1]).toEqual({ type: "none" });
    expect(await captureBookMetadata(fixture.root)).toEqual(before);
  });

  it("(T4/Q) accepted USER item flows through the SAME compiler and receipt history", async () => {
    await publishActiveReview(fixture, {
      sourceChapter: 16,
      effectiveChapter: 26,
      items: [
        factItem("item-user", "主角状态", "用户改写：轻伤痊愈", { origin: "user" }),
      ],
    });
    const before = await captureBookMetadata(fixture.root);

    const prepared = await prepareStateReviewConfirm({
      bookDir: fixture.bookDir, chapter: 16, expectedReviewRevision: 1, durableHead: 25,
    });

    const candidate = CurrentStateStateSchema.parse(JSON.parse(
      prepared.canonWrites.find((w) => w.relativePath === "story/state/current_state.json")!.content,
    ));
    expect(candidate.facts.some((fact) => fact.predicate === "主角状态" && fact.object === "用户改写：轻伤痊愈")).toBe(true);
    const receipt = ResolvedReviewReceiptSchema.parse(JSON.parse(prepared.receiptWrite.content));
    expect(receipt.proposals[0]).toEqual(factProposal("主角状态", "用户改写：轻伤痊愈"));
    expect(receipt.decisions[0]?.decision).toBe("accepted");
    expect(await captureBookMetadata(fixture.root)).toEqual(before);
  });

  it("(T6/I) undecided actionable AI item blocks PREPARE with itemId and zero writes", async () => {
    await publishActiveReview(fixture, {
      sourceChapter: 16,
      effectiveChapter: 26,
      items: [
        factItem("item-open", "当前位置", "北岸灯塔", { decision: "undecided" }),
        { id: "item-note", kind: "note", origin: "ai", title: "备注", proposal: { type: "none" }, decision: "undecided" },
      ],
    });
    await expect(expectZeroWrites(() => prepareStateReviewConfirm({
      bookDir: fixture.bookDir, chapter: 16, expectedReviewRevision: 1, durableHead: 25,
    }))).rejects.toSatisfy((error: unknown) => {
      expectStateReviewError(error, "state_review_incomplete", "item-open");
      return true;
    });
  });

  it("(T7/AC/AD) undecided NOTE does not block; zero-effective confirmation still ADVANCES bookkeeping to the effective slot", async () => {
    await publishActiveReview(fixture, {
      sourceChapter: 16,
      effectiveChapter: 26,
      items: [
        { id: "item-note", kind: "note", origin: "ai", title: "备注", proposal: { type: "none" }, decision: "undecided" },
      ],
    });
    const before = await captureBookMetadata(fixture.root);
    const baseRevision = (await readStoryCanon(fixture.bookDir)).revision;

    const prepared = await prepareStateReviewConfirm({
      bookDir: fixture.bookDir, chapter: 16, expectedReviewRevision: 1, durableHead: 25,
    });

    // Semantic classification is unchanged…
    expect(prepared.zeroEffectiveChange).toBe(true);
    const receipt = ResolvedReviewReceiptSchema.parse(JSON.parse(prepared.receiptWrite.content));
    expect(receipt.resolution).toBe("confirmed-no-changes");
    // …but the confirmed temporal slot 26 is CONSUMED by system bookkeeping.
    expect(prepared.canonWrites).toHaveLength(4);
    expect(prepared.projectionWrites).toHaveLength(3);
    const manifest = StateManifestSchema.parse(JSON.parse(
      prepared.canonWrites.find((w) => w.relativePath === "story/state/manifest.json")!.content,
    ));
    expect(manifest.lastAppliedChapter).toBe(26);
    const candidateState = CurrentStateStateSchema.parse(JSON.parse(
      prepared.canonWrites.find((w) => w.relativePath === "story/state/current_state.json")!.content,
    ));
    expect(candidateState.chapter).toBe(26);
    expect(candidateState.facts.some((fact) => fact.object === "北岸灯塔")).toBe(false);
    const currentStateProjection = prepared.projectionWrites.find((w) => w.relativePath === "story/current_state.md")!;
    expect(currentStateProjection.content).toContain("26");
    const snapshotManifest = StateManifestSchema.parse(JSON.parse(
      prepared.snapshotWrites.find((w) => w.relativePath === "story/snapshots/26/state/manifest.json")!.content,
    ));
    expect(snapshotManifest.lastAppliedChapter).toBe(26);
    expect(prepared.resultingCanonRevision).not.toBe(baseRevision);
    expect(prepared.indexWrite.content).toContain("\"approved\"");
    // Still absolute zero-write.
    expect(await captureBookMetadata(fixture.root)).toEqual(before);
  });

  it("(T8/T9/J) zero-item AND all-rejected reviews advance the applied head with no semantic mutation", async () => {
    await publishActiveReview(fixture, {
      sourceChapter: 26, effectiveChapter: 26,
      proseText: "# 第26章 终局\n\n林秋抵达北岸灯塔。",
      items: [],
    });
    const empty = await prepareStateReviewConfirm({
      bookDir: fixture.bookDir, chapter: 26, expectedReviewRevision: 1, durableHead: 25,
    });
    expect(empty.zeroEffectiveChange).toBe(true);
    expect(empty.canonWrites).toHaveLength(4);
    expect(empty.projectionWrites).toHaveLength(3);
    const emptyManifest = StateManifestSchema.parse(JSON.parse(
      empty.canonWrites.find((w) => w.relativePath === "story/state/manifest.json")!.content,
    ));
    expect(emptyManifest.lastAppliedChapter).toBe(26);
    expect(empty.receiptWrite.content).toContain("confirmed-no-changes");
    // Snapshot mirror represents POST-confirm state at slot 26.
    const snapManifest = StateManifestSchema.parse(JSON.parse(
      empty.snapshotWrites.find((w) => w.relativePath === "story/snapshots/26/state/manifest.json")!.content,
    ));
    expect(snapManifest.lastAppliedChapter).toBe(26);

    await publishActiveReview(fixture, {
      sourceChapter: 16,
      effectiveChapter: 26,
      reviewId: "3f2504e0-4f89-41d3-9a0c-0305e82c3303",
      items: [factItem("item-rej", "当前位置", "北岸灯塔", { decision: "rejected" })],
    });
    const before = await captureBookMetadata(fixture.root);
    const allRejected = await prepareStateReviewConfirm({
      bookDir: fixture.bookDir, chapter: 16, expectedReviewRevision: 1, durableHead: 25,
    });
    expect(allRejected.zeroEffectiveChange).toBe(true);
    expect(allRejected.canonWrites).toHaveLength(4);
    const candidate = CurrentStateStateSchema.parse(JSON.parse(
      allRejected.canonWrites.find((w) => w.relativePath === "story/state/current_state.json")!.content,
    ));
    // The rejected proposal NEVER enters semantics; only bookkeeping advances.
    expect(candidate.facts.some((fact) => fact.object === "北岸灯塔")).toBe(false);
    const rejectedManifest = StateManifestSchema.parse(JSON.parse(
      allRejected.canonWrites.find((w) => w.relativePath === "story/state/manifest.json")!.content,
    ));
    expect(rejectedManifest.lastAppliedChapter).toBe(26);
    const rejectedReceipt = ResolvedReviewReceiptSchema.parse(JSON.parse(allRejected.receiptWrite.content));
    expect(rejectedReceipt.effectiveChanges).toEqual([{ type: "none" }]);
    expect(rejectedReceipt.resolution).toBe("confirmed-no-changes");
    expect(await captureBookMetadata(fixture.root)).toEqual(before);
  });

  it("(T10/E) missing artifact and non-active shells fail closed with zero writes", async () => {
    await expect(expectZeroWrites(() => prepareStateReviewConfirm({
      bookDir: fixture.bookDir, chapter: 16, expectedReviewRevision: 1, durableHead: 25,
    }))).rejects.toSatisfy((error: unknown) => {
      expectStateReviewError(error, "state_review_not_found");
      return true;
    });

    await mkdir(join(fixture.bookDir, "story", "runtime"), { recursive: true });
    await writeFile(
      join(fixture.bookDir, ACTIVE_REVIEW_RELPATH(16)),
      JSON.stringify({
        schemaVersion: 1, sourceChapter: 16, createdAt: CREATED_AT, language: "zh",
        status: "rebuild_required", reason: "",
      }),
      "utf-8",
    );
    await expect(expectZeroWrites(() => prepareStateReviewConfirm({
      bookDir: fixture.bookDir, chapter: 16, expectedReviewRevision: 1, durableHead: 25,
    }))).rejects.toSatisfy((error: unknown) => {
      expectStateReviewError(error, "state_review_conflict");
      return true;
    });
  });

  it("(T11/AH) expectedReviewRevision mismatch fails edit_conflict with zero writes", async () => {
    await publishActiveReview(fixture, {
      sourceChapter: 16, effectiveChapter: 26,
      items: [factItem("item-fact", "当前位置", "北岸灯塔")],
    });
    await expect(expectZeroWrites(() => prepareStateReviewConfirm({
      bookDir: fixture.bookDir, chapter: 16, expectedReviewRevision: 4, durableHead: 25,
    }))).rejects.toSatisfy((error: unknown) => {
      expectStateReviewError(error, "state_review_edit_conflict");
      return true;
    });
  });

  it("(T12/AG) prose drift fails stale with zero writes", async () => {
    await publishActiveReview(fixture, {
      sourceChapter: 16, effectiveChapter: 26,
      items: [factItem("item-fact", "当前位置", "北岸灯塔")],
    });
    // Tamper prose AFTER publication without Task 9 (simulates out-of-band edit).
    await seedProseAndIndex(fixture, 16, `${PROSE_16}\n\n后续追加的一段。`, { 1: "approved", 16: "needs-state-review" });
    await expect(expectZeroWrites(() => prepareStateReviewConfirm({
      bookDir: fixture.bookDir, chapter: 16, expectedReviewRevision: 1, durableHead: 25,
    }))).rejects.toSatisfy((error: unknown) => {
      expectStateReviewError(error, "state_review_stale");
      return true;
    });
  });

  it("(T13/AF) Canon drift WITHOUT head change fails conflict with zero writes", async () => {
    await publishActiveReview(fixture, {
      sourceChapter: 16, effectiveChapter: 26,
      items: [factItem("item-fact", "当前位置", "北岸灯塔")],
    });
    // Concurrent/manual correction of one fact value; manifest untouched.
    const statePath = join(fixture.bookDir, "story", "state", "current_state.json");
    const parsed = JSON.parse(await readFile(statePath, "utf-8")) as {
      facts: Array<{ predicate: string; object: string }>;
    };
    parsed.facts = parsed.facts.map((fact) =>
      fact.predicate === "主角状态" ? { ...fact, object: "手动修正后的状态" } : fact);
    await writeFile(statePath, JSON.stringify(parsed, null, 2), "utf-8");

    await expect(expectZeroWrites(() => prepareStateReviewConfirm({
      bookDir: fixture.bookDir, chapter: 16, expectedReviewRevision: 1, durableHead: 25,
    }))).rejects.toSatisfy((error: unknown) => {
      expectStateReviewError(error, "state_review_conflict");
      return true;
    });
  });

  it("(T14/AE) confirmed-head drift fails CLOSED instead of rebasing effectiveChapter", async () => {
    await publishActiveReview(fixture, {
      sourceChapter: 16, effectiveChapter: 26,
      items: [factItem("item-fact", "当前位置", "北岸灯塔")],
    });
    // Another valid confirmation advances the confirmed head to 26 AFTER the
    // proposal was generated. PREPARE must NOT shift effective 26 → 27.
    const manifestPath = join(fixture.bookDir, "story", "state", "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as { lastAppliedChapter: number };
    manifest.lastAppliedChapter = 26;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

    await expect(expectZeroWrites(() => prepareStateReviewConfirm({
      bookDir: fixture.bookDir, chapter: 16, expectedReviewRevision: 1, durableHead: 26,
    }))).rejects.toSatisfy((error: unknown) => {
      expectStateReviewError(error, "state_review_conflict");
      return true;
    });
  });

  it("(§9.A RED) caller-passed head ≥ effectiveChapter is an APPLY-ZERO error", async () => {
    await publishActiveReview(fixture, {
      sourceChapter: 16, effectiveChapter: 26,
      items: [factItem("item-fact", "当前位置", "北岸灯塔")],
    });
    await expect(expectZeroWrites(() => prepareStateReviewConfirm({
      bookDir: fixture.bookDir, chapter: 16, expectedReviewRevision: 1, durableHead: 27,
    }))).rejects.toSatisfy((error: unknown) => {
      expectStateReviewError(error, "state_review_conflict");
      return true;
    });
  });

  it("(T15/G) pending CURRENT chapter source26/effective26 over confirmed head25 PREPAREs literally at 26", async () => {
    const prose26 = "# 第26章 终局\n\n林秋抵达北岸灯塔。";
    const reviewId = await publishActiveReview(fixture, {
      sourceChapter: 26,
      effectiveChapter: 26,
      proseText: prose26,
      items: [factItem("item-fact", "当前位置", "北岸灯塔")],
    });
    const before = await captureBookMetadata(fixture.root);

    const prepared = await prepareStateReviewConfirm({
      bookDir: fixture.bookDir, chapter: 26, expectedReviewRevision: 1, durableHead: 25,
    });

    // Literal design result: NO push to 27 anywhere.
    expect(prepared.effectiveChapter).toBe(26);
    const manifest = StateManifestSchema.parse(JSON.parse(
      prepared.canonWrites.find((w) => w.relativePath === "story/state/manifest.json")!.content,
    ));
    expect(manifest.lastAppliedChapter).toBe(26);
    expect(prepared.receiptWrite.content).toContain(reviewId);
    expect(await captureBookMetadata(fixture.root)).toEqual(before);
  });

  it("(T16/R/K) invalid effective change fails ALL-OR-NOTHING with itemId and zero writes", async () => {
    await publishActiveReview(fixture, {
      sourceChapter: 16,
      effectiveChapter: 26,
      items: [
        factItem("item-good", "当前位置", "北岸灯塔"),
        // Schema-VALID envelope, semantically invalid: edited without payload.
        factItem("item-bad", "主角状态", "占位", {
          decision: "edited",
          // editedChange deliberately absent
        }),
      ],
    });
    await expect(expectZeroWrites(() => prepareStateReviewConfirm({
      bookDir: fixture.bookDir, chapter: 16, expectedReviewRevision: 1, durableHead: 25,
    }))).rejects.toSatisfy((error: unknown) => {
      expectStateReviewError(error, "state_review_invalid_change", "item-bad");
      return true;
    });
  });

  it("(K/M/P) compiler defense: unknown predicate, fact removal, summary-chapter mismatch each fail with itemId", async () => {
    // Unknown predicate on an ACCEPTED item.
    await publishActiveReview(fixture, {
      sourceChapter: 16, effectiveChapter: 26,
      items: [factItem("item-weird", "不存在的谓词", "任意值")],
    });
    await expect(expectZeroWrites(() => prepareStateReviewConfirm({
      bookDir: fixture.bookDir, chapter: 16, expectedReviewRevision: 1, durableHead: 25,
    }))).rejects.toSatisfy((error: unknown) => {
      expectStateReviewError(error, "state_review_invalid_change", "item-weird");
      return true;
    });

    // Fact REMOVAL cannot be represented in the reducer vocabulary.
    await publishActiveReview(fixture, {
      sourceChapter: 16,
      effectiveChapter: 26,
      reviewId: "3f2504e0-4f89-41d3-9a0c-0305e82c3304",
      items: [{
        id: "item-remove",
        kind: "current-state-fact",
        origin: "ai",
        title: "remove?",
        proposal: { type: "fact", change: { action: "remove", subject: "主角", predicate: "当前位置" } },
        decision: "accepted",
      }],
    });
    await expect(expectZeroWrites(() => prepareStateReviewConfirm({
      bookDir: fixture.bookDir, chapter: 16, expectedReviewRevision: 1, durableHead: 25,
    }))).rejects.toSatisfy((error: unknown) => {
      expectStateReviewError(error, "state_review_invalid_change", "item-remove");
      return true;
    });

    // Summary row belonging to NEITHER the source nor the effective chapter.
    await publishActiveReview(fixture, {
      sourceChapter: 16,
      effectiveChapter: 26,
      reviewId: "3f2504e0-4f89-41d3-9a0c-0305e82c3305",
      items: [{
        id: "item-summary-bad",
        kind: "chapter-summary",
        origin: "ai",
        title: "misaligned summary",
        proposal: {
          type: "chapter-summary",
          row: {
            chapter: 17,
            title: "反转",
            characters: "主角",
            events: "事件",
            stateChanges: "",
            hookActivity: "",
            mood: "",
            chapterType: "调查",
          },
        },
        decision: "accepted",
      }],
    });
    await expect(expectZeroWrites(() => prepareStateReviewConfirm({
      bookDir: fixture.bookDir, chapter: 16, expectedReviewRevision: 1, durableHead: 25,
    }))).rejects.toSatisfy((error: unknown) => {
      expectStateReviewError(error, "state_review_invalid_change", "item-summary-bad");
      return true;
    });
  });

  it("(T17/S/U) compiled delta is schema-valid, reducer-applied IN MEMORY, and candidate state passes validateRuntimeState", async () => {
    await publishActiveReview(fixture, {
      sourceChapter: 16,
      effectiveChapter: 26,
      items: [
        factItem("item-fact", "当前位置", "北岸灯塔"),
        {
          id: "item-hook",
          kind: "hook-upsert",
          origin: "ai",
          title: "Hook upsert: hook-sub-neighbor",
          proposal: {
            type: "hook-upsert",
            hook: {
              hookId: "hook-sub-neighbor",
              startChapter: 5,
              type: "subplot",
              status: "open",
              lastAdvancedChapter: 26,
              expectedPayoff: "邻居目击证词",
              payoffTiming: "near-term",
              notes: "第26章推进",
            },
          },
          decision: "accepted",
        },
      ],
    });
    const before = await captureBookMetadata(fixture.root);

    const prepared = await prepareStateReviewConfirm({
      bookDir: fixture.bookDir, chapter: 16, expectedReviewRevision: 1, durableHead: 25,
    });

    // The candidate hooks doc contains the merged hook — proof the EXISTING
    // reducer ran over the live snapshot purely in memory.
    const hooks = HooksStateSchema.parse(JSON.parse(
      prepared.canonWrites.find((w) => w.relativePath === "story/state/hooks.json")!.content,
    ));
    const neighbor = hooks.hooks.find((hook) => hook.hookId === "hook-sub-neighbor");
    expect(neighbor?.notes).toBe("第26章推进");
    // Live disk hooks remain untouched (still the fixture notes: "").
    const liveSnapshot = await readLiveRuntimeStateSnapshot(fixture.bookDir);
    expect(liveSnapshot.hooks.hooks.find((hook) => hook.hookId === "hook-sub-neighbor")?.notes).toBe("");
    expect(await captureBookMetadata(fixture.root)).toEqual(before);
  });

  it("(T20/W/X/Y) snapshotWrites mirror the CANDIDATE state and copy unchanged slots, purely composed", async () => {
    await publishActiveReview(fixture, {
      sourceChapter: 16, effectiveChapter: 26,
      items: [factItem("item-fact", "当前位置", "北岸灯塔")],
    });
    // An unrelated story slot that must be copied unchanged into the snapshot.
    await writeFile(join(fixture.bookDir, "story", "particle_ledger.md"), "粒子账本内容", "utf-8");
    const before = await captureBookMetadata(fixture.root);

    const prepared = await prepareStateReviewConfirm({
      bookDir: fixture.bookDir, chapter: 16, expectedReviewRevision: 1, durableHead: 25,
    });

    const byPath = new Map(prepared.snapshotWrites.map((w) => [w.relativePath, w.content]));
    expect(byPath.get("story/snapshots/26/particle_ledger.md")).toBe("粒子账本内容");
    expect(byPath.get("story/snapshots/26/current_state.md")).toContain("北岸灯塔");
    const snapState = CurrentStateStateSchema.parse(JSON.parse(
      byPath.get("story/snapshots/26/state/current_state.json")!,
    ));
    expect(snapState.chapter).toBe(26);
    expect(await captureBookMetadata(fixture.root)).toEqual(before);
  });

  it("(Z) index candidate flips ONLY the reviewed chapter to approved and preserves unrelated entries exactly", async () => {
    await publishActiveReview(fixture, {
      sourceChapter: 16, effectiveChapter: 26,
      items: [factItem("item-fact", "当前位置", "北岸灯塔")],
    });
    // Extra unrelated entry that must survive byte-for-byte in values.
    const indexPath = join(fixture.bookDir, "chapters", "index.json");
    const existing = JSON.parse(await readFile(indexPath, "utf-8")) as Array<Record<string, unknown>>;
    existing.push({
      number: 2, title: "第二章", status: "approved", wordCount: 99,
      createdAt: CREATED_AT, updatedAt: CREATED_AT, auditIssues: ["遗留问题"], lengthWarnings: [],
    });
    await writeFile(indexPath, JSON.stringify(existing, null, 2), "utf-8");

    const prepared = await prepareStateReviewConfirm({
      bookDir: fixture.bookDir, chapter: 16, expectedReviewRevision: 1, durableHead: 25,
    });

    const entries = ChapterMetaSchema.array().parse(JSON.parse(prepared.indexWrite.content));
    expect(entries.find((entry) => entry.number === 16)?.status).toBe("approved");
    const untouched = entries.find((entry) => entry.number === 2);
    expect(untouched?.status).toBe("approved");
    expect(untouched?.auditIssues).toEqual(["遗留问题"]);
    expect(untouched?.wordCount).toBe(99);
    expect(entries.filter((entry) => entry.status === "ready-for-review")).toEqual([]);
  });

  it("(I-11.1/L-N/O/P) historical source-chaptered summary retargets to the effective slot for application; proposal history stays at 16", async () => {
    const reviewId = await publishActiveReview(fixture, {
      sourceChapter: 16,
      effectiveChapter: 26,
      items: [{
        id: "item-summary",
        kind: "chapter-summary",
        origin: "ai",
        title: "Chapter summary: ch 16 反转",
        proposal: {
          type: "chapter-summary",
          row: {
            chapter: 16,
            title: "反转",
            characters: "主角；林秋",
            events: "林秋在北岸灯塔烧毁了账本",
            stateChanges: "当前位置→北岸灯塔",
            hookActivity: "",
            mood: "紧张",
            chapterType: "调查",
          },
        },
        decision: "accepted",
      }],
    });
    const before = await captureBookMetadata(fixture.root);
    const artifactBefore = await readFile(join(fixture.bookDir, ACTIVE_REVIEW_RELPATH(16)), "utf-8");

    const prepared = await prepareStateReviewConfirm({
      bookDir: fixture.bookDir, chapter: 16, expectedReviewRevision: 1, durableHead: 25,
    });

    // Applied delta/bookkeeping lives at effective 26.
    expect(prepared.effectiveChapter).toBe(26);
    const summaries = ChapterSummariesStateSchema.parse(JSON.parse(
      prepared.canonWrites.find((w) => w.relativePath === "story/state/chapter_summaries.json")!.content,
    ));
    const applied = summaries.rows.find((row) => row.title === "反转");
    expect(applied?.chapter).toBe(26);
    expect(applied?.events).toBe("林秋在北岸灯塔烧毁了账本");
    const manifest = StateManifestSchema.parse(JSON.parse(
      prepared.canonWrites.find((w) => w.relativePath === "story/state/manifest.json")!.content,
    ));
    expect(manifest.lastAppliedChapter).toBe(26);

    // Receipt keeps BOTH layers: original proposal row16, applied change row26.
    const receipt = ResolvedReviewReceiptSchema.parse(JSON.parse(prepared.receiptWrite.content));
    expect(receipt.reviewId).toBe(reviewId);
    expect(receipt.sourceChapter).toBe(16);
    expect(receipt.effectiveChapter).toBe(26);
    const proposalRow = (receipt.proposals[0] as { type: "chapter-summary"; row: { chapter: number } }).row;
    expect(proposalRow.chapter).toBe(16);
    const appliedChange = receipt.effectiveChanges[0] as { type: "chapter-summary"; row: { chapter: number } };
    expect(appliedChange.row.chapter).toBe(26);

    // Original ReviewItem/proposal object untouched on disk.
    expect(await readFile(join(fixture.bookDir, ACTIVE_REVIEW_RELPATH(16)), "utf-8")).toBe(artifactBefore);
    expect(await captureBookMetadata(fixture.root)).toEqual(before);
  });

  it("(m-11.1/V) caller durableHead that contradicts the live confirmed head fails closed", async () => {
    await publishActiveReview(fixture, {
      sourceChapter: 26,
      effectiveChapter: 26,
      proseText: "# 第26章 终局\n\n林秋抵达北岸灯塔。",
      items: [],
    });
    // Live manifest says 25; a stale caller reporting 24 must NOT slip the
    // pending-source temporal derivation through.
    await expect(expectZeroWrites(() => prepareStateReviewConfirm({
      bookDir: fixture.bookDir, chapter: 26, expectedReviewRevision: 1, durableHead: 24,
    }))).rejects.toSatisfy((error: unknown) => {
      expectStateReviewError(error, "state_review_conflict");
      return true;
    });
  });

  it("(Purity) PREPARE module imports no mutating primitive or banned loader", async () => {
    const source = await readFile(
      fileURLToPath(new URL("../state/state-review-confirm.ts", import.meta.url)),
      "utf-8",
    );
    for (const banned of [
      "bootstrapStructuredStateFromMarkdown",
      "loadRuntimeStateSnapshot(",
      "mkdir",
      "writeFile",
      "rename",
      "commitAtomicFileSet",
      "saveChapterIndex",
      "publishActiveProposal",
      "mutateActiveProposal",
      "writeResolvedReceipt",
      "snapshotState",
      "resolveDurableStoryProgress",
    ]) {
      expect(source.includes(banned), `banned token: ${banned}`).toBe(false);
    }
  });
});

describe("state-review-confirm CONFIRM transaction (Task 12)", () => {
  let fixture: CanonBookFixture;

  const FACT_ITEM = (id = "item-fact") =>
    factItem(id, "当前位置", "北岸灯塔");

  const SUMMARY_ITEM = (id = "item-summary"): ReviewItem => ({
    id,
    kind: "chapter-summary",
    origin: "ai",
    title: "Chapter summary: ch 16 反转",
    proposal: {
      type: "chapter-summary",
      row: {
        chapter: 16,
        title: "反转",
        characters: "主角；林秋",
        events: "林秋在北岸灯塔烧毁了账本",
        stateChanges: "当前位置→北岸灯塔",
        hookActivity: "",
        mood: "紧张",
        chapterType: "调查",
      },
    },
    decision: "accepted",
  });

  async function confirmTx(
    chapter: number,
    reviewId: string,
    overrides?: {
      readonly expectedReviewRevision?: number;
      readonly renameFile?: (from: string, to: string) => Promise<void>;
    },
  ) {
    return confirmStateReview({
      bookDir: fixture.bookDir,
      chapter,
      reviewId,
      expectedReviewRevision: overrides?.expectedReviewRevision ?? 1,
      ...(overrides?.renameFile ? { deps: { renameFile: overrides.renameFile } } : {}),
    });
  }

  async function expectLockFree(): Promise<void> {
    const manager = new StateManager(dirname(fixture.bookDir));
    const release = await manager.acquireBookLock(basename(fixture.bookDir));
    await release();
  }

  function countersBefore() {
    return {
      commits: t12.commits,
      rebuildIndex: t12.syncCalls.rebuildIndex,
      rebuildHistory: t12.syncCalls.rebuildHistory,
      invalidate: t12.syncCalls.invalidate,
      lockAcquisitions: t12.lockAcquisitions,
      lockReleases: t12.lockReleases,
    };
  }

  beforeEach(async () => {
    t12.commits = 0;
    t12.lockAcquisitions = 0;
    t12.lockReleases = 0;
    t12.syncCalls.rebuildIndex = 0;
    t12.syncCalls.rebuildHistory = 0;
    t12.syncCalls.invalidate = 0;
    t12.failDerivedRebuild = false;
    t12.failDerivedInvalidation = false;
    fixture = await createCanonBook({ chapterCount: 25 });
  });

  it("(a/1-7,16,20-25) normal confirm commits ONE atomic set; active deleted; receipt/index/canon/projections/snapshot durable", async () => {
    await publishActiveReview(fixture, {
      sourceChapter: 16,
      effectiveChapter: 26,
      items: [FACT_ITEM(), SUMMARY_ITEM()],
    });
    // Pure PREPARE once for candidate comparison (does not mutate anything).
    const prepared = await prepareStateReviewConfirm({
      bookDir: fixture.bookDir, chapter: 16, expectedReviewRevision: 1, durableHead: 25,
    });
    const before = countersBefore();

    const result = await confirmTx(16, REVIEW_ID);

    expect(result.status).toBe("resolved");
    expect(result.warnings).toEqual([]);
    expect(result.resultingCanonRevision).toBe(prepared.resultingCanonRevision);
    expect(t12.commits - before.commits).toBe(1);
    expect(t12.lockAcquisitions - before.lockAcquisitions).toBe(1);

    // Authoritative disk state.
    expect(await loadStateReview(fixture.bookDir, 16)).toBeNull();
    const diskReceiptRaw = await readFile(
      join(fixture.bookDir, "story/runtime/state-review-receipts/chapter-0016", `${REVIEW_ID}.json`),
      "utf-8",
    );
    const diskReceipt = ResolvedReviewReceiptSchema.parse(JSON.parse(diskReceiptRaw));
    // PART T: Task 12 persists prepared.receiptWrite EXACTLY — disk and result
    // come from the SAME prepare run, so they must match byte-for-byte.
    expect(diskReceipt).toEqual(result.receipt);
    // Cross-run identity (separate pure prepare): semantic fields identical;
    // resolvedAt naturally differs per run.
    expect(prepared.receipt.reviewId).toEqual(result.receipt.reviewId);
    expect(prepared.receipt.effectiveChanges).toEqual(result.receipt.effectiveChanges);
    expect(prepared.receipt.proposals).toEqual(result.receipt.proposals);

    const index = ChapterMetaSchema.array().parse(
      JSON.parse(await readFile(join(fixture.bookDir, "chapters/index.json"), "utf-8")),
    );
    expect(index.find((meta) => meta.number === 16)?.status).toBe("approved");
    // Unrelated-entry preservation is proven exhaustively by the PREPARE (Z)
    // test against the full 25-chapter index; this helper-written minimal
    // index only carries the reviewed chapter.

    for (const write of prepared.canonWrites) {
      expect(await readFile(join(fixture.bookDir, write.relativePath), "utf-8")).toBe(write.content);
    }
    for (const write of prepared.projectionWrites) {
      expect(await readFile(join(fixture.bookDir, write.relativePath), "utf-8")).toBe(write.content);
    }
    for (const write of prepared.snapshotWrites) {
      expect(await readFile(join(fixture.bookDir, write.relativePath), "utf-8")).toBe(write.content);
    }
    const manifest = StateManifestSchema.parse(
      JSON.parse(await readFile(join(fixture.bookDir, "story/state/manifest.json"), "utf-8")),
    );
    expect(manifest.lastAppliedChapter).toBe(26);
    expect(existsSync(join(fixture.bookDir, ACTIVE_REVIEW_RELPATH(16)))).toBe(false);

    // Post-commit derived sync ran exactly once per duty.
    expect(t12.syncCalls.rebuildIndex - before.rebuildIndex).toBe(1);
    expect(t12.syncCalls.rebuildHistory - before.rebuildHistory).toBe(1);
    expect(t12.syncCalls.invalidate - before.invalidate).toBe(0);
  });

  it("(b/c/AD/X/AJ) lost-response retry with SAME reviewId is already_resolved: zero writes, stale revision ignored, no PREPARE/commit/sync", async () => {
    await publishActiveReview(fixture, {
      sourceChapter: 16, effectiveChapter: 26, items: [FACT_ITEM()],
    });
    const first = await confirmTx(16, REVIEW_ID);
    expect(first.status).toBe("resolved");
    const stable = await captureBookMetadata(fixture.root);
    const before = countersBefore();
    // Tamper prose + bump nothing: if PREPARE ran it would throw stale —
    // receipt-first lookup must return BEFORE any validation.
    await writeFile(
      join(fixture.bookDir, "chapters/0016_第16章.md"),
      "# 第16章 反转\n\n被篡改的内容。",
      "utf-8",
    );
    const tampered = await captureBookMetadata(fixture.root);

    const retry = await confirmTx(16, REVIEW_ID, { expectedReviewRevision: 999 });

    expect(retry.status).toBe("already_resolved");
    expect(retry.warnings).toEqual([]);
    expect(retry.receipt.reviewId).toBe(REVIEW_ID);
    expect(retry.resultingCanonRevision).toBe(first.resultingCanonRevision);
    expect(await captureBookMetadata(fixture.root)).toEqual(tampered);
    expect(tampered).not.toEqual(stable); // prose tamper itself visible, nothing else changed
    expect(t12.commits - before.commits).toBe(0);
    expect(t12.syncCalls.rebuildIndex - before.rebuildIndex).toBe(0);
    expect(t12.syncCalls.rebuildHistory - before.rebuildHistory).toBe(0);
    expect(t12.lockAcquisitions - before.lockAcquisitions).toBe(1);
    await expectLockFree();
  });

  it("(d/e/AB) wrong reviewId never confirms the current active generation; post-resolution foreign id also fails closed", async () => {
    const activeId = await publishActiveReview(fixture, {
      sourceChapter: 16, effectiveChapter: 26, items: [FACT_ITEM()],
    });
    expect(activeId).not.toBe(`${REVIEW_ID}-old`);
    const before = await captureBookMetadata(fixture.root);
    const counters = countersBefore();

    await expect(confirmTx(16, `${REVIEW_ID}-old`)).rejects.toSatisfy((error: unknown) => {
      expectStateReviewError(error, "state_review_not_found");
      expect(String(error)).toContain(activeId); // names the superseding generation
      return true;
    });

    expect(await captureBookMetadata(fixture.root)).toEqual(before);
    expect(t12.commits - counters.commits).toBe(0);
    expect(t12.syncCalls.rebuildIndex - counters.rebuildIndex).toBe(0);
    await expectLockFree();

    // Resolve the real generation, then a foreign id must still fail closed.
    await confirmTx(16, activeId);
    const afterResolve = await captureBookMetadata(fixture.root);
    const counters2 = countersBefore();
    await expect(confirmTx(16, `${REVIEW_ID}-other`)).rejects.toSatisfy((error: unknown) => {
      expectStateReviewError(error, "state_review_not_found");
      return true;
    });
    expect(await captureBookMetadata(fixture.root)).toEqual(afterResolve);
    expect(t12.commits - counters2.commits).toBe(0);
  });

  it("(f/h/AC) Task 11 anchor failures propagate through CONFIRM as typed zero-write errors", async () => {
    await publishActiveReview(fixture, {
      sourceChapter: 16, effectiveChapter: 26, items: [FACT_ITEM()],
    });
    const baseline = await captureBookMetadata(fixture.root);
    const counters = countersBefore();

    // Stale expectedReviewRevision ⇒ edit_conflict.
    await expect(confirmTx(16, REVIEW_ID, { expectedReviewRevision: 42 })).rejects.toSatisfy(
      (error: unknown) => {
        expectStateReviewError(error, "state_review_edit_conflict");
        return true;
      },
    );
    expect(await captureBookMetadata(fixture.root)).toEqual(baseline);

    // Prose drift ⇒ state_review_stale (Task 11 anchor, not reinterpreted).
    await writeFile(
      join(fixture.bookDir, "chapters/0016_第16章.md"),
      "# 第16章 反转\n\n林秋在北岸灯塔烧毁了账本。额外段落。",
      "utf-8",
    );
    const drifted = await captureBookMetadata(fixture.root);
    await expect(confirmTx(16, REVIEW_ID)).rejects.toSatisfy((error: unknown) => {
      expectStateReviewError(error, "state_review_stale");
      return true;
    });
    expect(await captureBookMetadata(fixture.root)).toEqual(drifted);
    expect(t12.commits - counters.commits).toBe(0);
    expect(t12.syncCalls.rebuildIndex - counters.rebuildIndex).toBe(0);
  });

  it("(i/P/14-15) zero-effective confirmation commits bookkeeping advancement with confirmed-no-changes", async () => {
    await publishActiveReview(fixture, {
      sourceChapter: 26,
      effectiveChapter: 26,
      proseText: "# 第26章 终局\n\n林秋抵达北岸灯塔。",
      items: [],
    });
    const result = await confirmTx(26, REVIEW_ID);

    expect(result.status).toBe("resolved");
    expect(result.receipt.resolution).toBe("confirmed-no-changes");
    // Literally zero items ⇒ no per-item effective entries at all.
    expect(result.receipt.effectiveChanges).toEqual([]);
    const manifest = StateManifestSchema.parse(
      JSON.parse(await readFile(join(fixture.bookDir, "story/state/manifest.json"), "utf-8")),
    );
    expect(manifest.lastAppliedChapter).toBe(26);
    const currentState = CurrentStateStateSchema.parse(
      JSON.parse(await readFile(join(fixture.bookDir, "story/state/current_state.json"), "utf-8")),
    );
    expect(currentState.facts.some((fact) => fact.object === "北岸灯塔")).toBe(false);
    expect(StateManifestSchema.parse(JSON.parse(
      await readFile(join(fixture.bookDir, "story/snapshots/26/state/manifest.json"), "utf-8"),
    )).lastAppliedChapter).toBe(26);
    const index = ChapterMetaSchema.array().parse(
      JSON.parse(await readFile(join(fixture.bookDir, "chapters/index.json"), "utf-8")),
    );
    expect(index.find((meta) => meta.number === 26)?.status).toBe("approved");
    expect(await loadStateReview(fixture.bookDir, 26)).toBeNull();
    expect(t12.commits).toBeGreaterThanOrEqual(1); // exactly ONE confirm transaction (publish path is store-internal)
  });

  it("(g/R/S/17-19) injected mid-set rename failure rolls back EVERYTHING; active stays confirmable; no residue; retry succeeds", async () => {
    await publishActiveReview(fixture, {
      sourceChapter: 16, effectiveChapter: 26, items: [FACT_ITEM()],
    });
    const pristine = await captureBookMetadata(fixture.root);
    let renames = 0;

    await expect(confirmTx(16, REVIEW_ID, {
      renameFile: async (from, to) => {
        renames += 1;
        if (to.replaceAll("\\", "/").endsWith("story/current_state.md")) {
          throw new Error("injected disk failure");
        }
        await rename(from, to);
      },
    })).rejects.toThrow(/injected disk failure/);
    expect(renames).toBeGreaterThan(5); // failure landed AFTER staging/backups

    expect(await captureBookMetadata(fixture.root)).toEqual(pristine);
    const stillActive = await loadStateReview(fixture.bookDir, 16);
    expect(stillActive?.status).toBe("active");
    expect((stillActive as { reviewId?: string } | null)?.reviewId).toBe(REVIEW_ID);
    await expect(findReceiptByReviewId(fixture.bookDir, 16, REVIEW_ID)).resolves.toBeNull();
    expect(existsSync(join(fixture.bookDir, "story/snapshots/26"))).toBe(false);
    const rootEntries = await readdir(fixture.bookDir);
    expect(rootEntries.some((name) => name.startsWith(".castor-file-txn-"))).toBe(false);
    expect(t12.syncCalls.rebuildIndex).toBe(0);
    expect(t12.syncCalls.rebuildHistory).toBe(0);

    // Same generation remains confirmable (S), then resolves cleanly.
    const retry = await confirmTx(16, REVIEW_ID);
    expect(retry.status).toBe("resolved");
    expect(await loadStateReview(fixture.bookDir, 16)).toBeNull();
    await expect(findReceiptByReviewId(fixture.bookDir, 16, REVIEW_ID)).resolves.not.toBeNull();
  });

  it("(j/W/X/Y/Z/21-23) derived-sync failure AFTER commit keeps the authoritative state and warns; retry does no second commit/sync", async () => {
    await publishActiveReview(fixture, {
      sourceChapter: 16, effectiveChapter: 26, items: [FACT_ITEM()],
    });
    t12.failDerivedRebuild = true;
    t12.failDerivedInvalidation = true; // force strategy==="failed" ⇒ exact P3 warning

    const result = await confirmTx(16, REVIEW_ID);

    expect(result.status).toBe("resolved"); // authoritative commit stands
    expect(result.warnings).toEqual([
      "derived memory invalidation failed; memory.db may be stale",
    ]);
    // First rebuild duty failed ⇒ the pair aborts into invalidation (plan
    // step 7 order): index attempt counted once, history never reached.
    expect(t12.syncCalls.rebuildIndex).toBe(1);
    expect(t12.syncCalls.rebuildHistory).toBe(0);
    expect(t12.syncCalls.invalidate).toBe(1);
    expect(await loadStateReview(fixture.bookDir, 16)).toBeNull();
    await expect(findReceiptByReviewId(fixture.bookDir, 16, REVIEW_ID)).resolves.not.toBeNull();
    const index = ChapterMetaSchema.array().parse(
      JSON.parse(await readFile(join(fixture.bookDir, "chapters/index.json"), "utf-8")),
    );
    expect(index.find((meta) => meta.number === 16)?.status).toBe("approved");
    expect(StateManifestSchema.parse(JSON.parse(
      await readFile(join(fixture.bookDir, "story/state/manifest.json"), "utf-8"),
    )).lastAppliedChapter).toBe(26);

    // Retry after derived failure: receipt-first idempotency, NO duplicate work.
    const before = countersBefore();
    const retry = await confirmTx(16, REVIEW_ID);
    expect(retry.status).toBe("already_resolved");
    expect(t12.commits - before.commits).toBe(0);
    expect(t12.syncCalls.rebuildIndex - before.rebuildIndex).toBe(0);
    expect(t12.syncCalls.rebuildHistory - before.rebuildHistory).toBe(0);
    expect(t12.syncCalls.invalidate - before.invalidate).toBe(0);
  });

  it("(AH/I-11.2-B/25) COMPLETE pre-existing snapshot target fails closed with ZERO writes", async () => {
    await publishActiveReview(fixture, {
      sourceChapter: 16, effectiveChapter: 26, items: [FACT_ITEM()],
    });
    const prepared = await prepareStateReviewConfirm({
      bookDir: fixture.bookDir, chapter: 16, expectedReviewRevision: 1, durableHead: 25,
    });
    for (const write of prepared.snapshotWrites) {
      await mkdir(dirname(join(fixture.bookDir, write.relativePath)), { recursive: true });
      await writeFile(join(fixture.bookDir, write.relativePath), "stale-material", "utf-8");
    }
    const seeded = await captureBookMetadata(fixture.root);
    const counters = countersBefore();

    await expect(confirmTx(16, REVIEW_ID)).rejects.toSatisfy((error: unknown) => {
      expectStateReviewError(error, "state_review_conflict");
      expect(String(error)).toContain("story/snapshots/");
      return true;
    });

    expect(await captureBookMetadata(fixture.root)).toEqual(seeded);
    expect(t12.commits - counters.commits).toBe(0);
    await expect(loadStateReview(fixture.bookDir, 16)).resolves.not.toBeNull();
    await expect(findReceiptByReviewId(fixture.bookDir, 16, REVIEW_ID)).resolves.toBeNull();
  });

  it("(AI/26) PARTIAL pre-existing snapshot target also fails closed without overwriting", async () => {
    await publishActiveReview(fixture, {
      sourceChapter: 16, effectiveChapter: 26, items: [FACT_ITEM()],
    });
    const prepared = await prepareStateReviewConfirm({
      bookDir: fixture.bookDir, chapter: 16, expectedReviewRevision: 1, durableHead: 25,
    });
    const partialTarget = prepared.snapshotWrites[0]!;
    await mkdir(dirname(join(fixture.bookDir, partialTarget.relativePath)), { recursive: true });
    await writeFile(join(fixture.bookDir, partialTarget.relativePath), "orphan-history", "utf-8");
    const seeded = await captureBookMetadata(fixture.root);
    const counters = countersBefore();

    await expect(confirmTx(16, REVIEW_ID)).rejects.toSatisfy((error: unknown) => {
      expectStateReviewError(error, "state_review_conflict");
      return true;
    });

    expect(await captureBookMetadata(fixture.root)).toEqual(seeded);
    expect(t12.commits - counters.commits).toBe(0);
    expect(
      await readFile(join(fixture.bookDir, partialTarget.relativePath), "utf-8"),
    ).toBe("orphan-history");
  });

  it("(AG/28) two active reviews targeting the SAME effective slot cannot overwrite each other", async () => {
    await publishActiveReview(fixture, {
      sourceChapter: 16, effectiveChapter: 26, items: [SUMMARY_ITEM()],
    }); // A: artifact under chapter-16, targets snapshots/26
    await publishActiveReview(fixture, {
      sourceChapter: 26,
      effectiveChapter: 26,
      reviewId: "3f2504e0-4f89-41d3-9a0c-0305e82c3303",
      proseText: "# 第26章 终局\n\n林秋抵达北岸灯塔。",
      items: [factItem("item-b", "当前位置", "北岸灯塔")],
      extraStatuses: { 16: "needs-state-review" }, // A and B active in parallel
    }); // B: artifact under chapter-26, same slot

    const resultA = await confirmTx(16, REVIEW_ID);
    expect(resultA.status).toBe("resolved");
    const slotAfterA = await captureBookMetadata(fixture.root);
    const receiptFilesAfterA = await collectReceiptRelativePaths();

    // B must NOT overwrite the committed effective slot. Canon/head anchors
    // reject it during PREPARE (head reached 26) — either way: fail CLOSED.
    await expect(confirmTx(26, "3f2504e0-4f89-41d3-9a0c-0305e82c3303")).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(StateReviewError);
        return true;
      },
    );

    const slotAfterB = await captureBookMetadata(fixture.root);
    expect(slotAfterB).toEqual(slotAfterA); // snapshots/26 byte-identical
    expect(await collectReceiptRelativePaths()).toEqual(receiptFilesAfterA);
    await expect(loadStateReview(fixture.bookDir, 26)).resolves.not.toBeNull(); // B intact for rebuild
  });

  it("(AM) transaction module stays semantically dumb — no resolver/compiler/AI imports", async () => {
    const source = await readFile(
      fileURLToPath(new URL("../state/state-review-finalize.ts", import.meta.url)),
      "utf-8",
    );
    for (const banned of [
      "resolveReviewItemEffectiveChange",
      "buildStateReviewItems",
      "applyRuntimeStateDelta",
      "WriterAgent",
      "ChapterAnalyzerAgent",
      "settleChapterState",
      "writeResolvedReceipt",
      "saveChapterIndex",
      "publishActiveProposal",
      "mutateActiveProposal",
    ]) {
      expect(source.includes(banned), `banned token in finalize module: ${banned}`).toBe(false);
    }
  });

  async function collectReceiptRelativePaths(): Promise<string[]> {
    const runtimeDir = join(fixture.bookDir, "story/runtime");
    const chapters = await readdir(runtimeDir).catch(() => [] as string[]);
    const paths: string[] = [];
    for (const entry of chapters.filter((name) => name.startsWith("state-review-receipts"))) {
      for (const file of await readdir(join(runtimeDir, entry))) {
        paths.push(`${entry}/${file}`);
      }
    }
    return paths.sort();
  }
});

function existsSync(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}
