/**
 * Task 13 — HISTORICAL CORRECTION END-TO-END (incl. shell gating).
 *
 * Proves the already-built Phase-4 machinery composes into one coherent
 * FORWARD-GOVERNED workflow when a human edits an old READY chapter while the
 * Canon is already confirmed through later chapters:
 *
 *   head25 → Task 9 edit ch16 (rebuild_required, old receipt superseded,
 *            Canon + tail 17–25 untouched)
 *         → Task 5 gate BLOCKS ch26 (historical pending shell source16<26)
 *         → Task 10 public rebuild (fresh generation source16/effective26,
 *            no decision carry-forward)
 *         → Task 8 real CAS decisions on the fresh generation
 *         → Task 11 pure PREPARE (candidate advances through 26, zero writes)
 *         → Task 12 public Final Confirm (one atomic commit, snapshot26)
 *         → ch16 approved again, new resolved receipt source16/effective26,
 *            old receipt STILL superseded, tail 17–25 byte-identical,
 *            snapshots 1–25 immutable, gate unblocked.
 *
 * NO CASCADE anywhere: chapters 17–25 prose/statuses/receipts/snapshots are
 * captured before the edit and compared byte-for-byte after Final Confirm.
 * Workflow actions go exclusively through production APIs; only INITIAL
 * durable state is seeded directly (fixture privilege).
 */
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCanonBook, type CanonBookFixture } from "./helpers/canon-fixture.js";
import {
  ACTIVE_REVIEW_RELPATH,
  loadStateReview,
  publishActiveProposal,
  saveStateReviewShell,
} from "../state/state-review-store.js";
import {
  addUserStateReviewItem,
  decideStateReviewItem,
} from "../state/state-review-service.js";
import { prepareStateReviewConfirm } from "../state/state-review-confirm.js";
import { confirmStateReview } from "../state/state-review-finalize.js";
import { assertCanAdvanceStory } from "../state/advancement-gate.js";
import { executeEditTransaction, type EditExecutionDeps } from "../interaction/edit-controller.js";
import { PipelineRunner } from "../pipeline/runner.js";
import { StateManager } from "../state/manager.js";
import { MemoryDB } from "../state/memory-db.js";
import { readStoryCanon } from "../state/canon-service.js";
import { computeProseRevision } from "../utils/prose-revision.js";
import {
  ChapterSummariesStateSchema,
  CurrentStateStateSchema,
  StateManifestSchema,
  type RuntimeStateDelta,
} from "../models/runtime-state.js";
import { ChapterMetaSchema } from "../models/chapter.js";
import {
  ResolvedReviewReceiptSchema,
  type ProposalChange,
  type ReviewItem,
} from "../models/state-review.js";

const HEAD = 25;
const EFFECTIVE = 26;
const SOURCE = 16;
const OLD_RECEIPT_ID = "historical-r16-old-generation";
const P16_OLD = "# Chương 16 mock_text\n\nmock_text。\n";
const P16_NEW = "# Chương 16 mock_text\n\nmock_text，mock_text。\n";
const CREATED_AT = "2026-08-24T00:00:00.000Z";
const TAIL = [17, 18, 19, 20, 21, 22, 23, 24, 25] as const;

function hex(seed: number): string {
  return (seed.toString(16).padStart(15, "0") + "0").slice(0, 16);
}

async function seedHistoricalBook(): Promise<CanonBookFixture> {
  const fixture = await createCanonBook({ chapterCount: HEAD, seedSnapshotsThrough: HEAD });
  // Distinct durable bytes per chapter so no-cascade comparisons are meaningful.
  for (let chapter = 1; chapter <= HEAD; chapter += 1) {
    const name = `Chương ${chapter}mock_text`;
    await rm(join(fixture.bookDir, "chapters", `${String(chapter).padStart(4, "0")}_${name}.md`), { force: true });
    await writeFileDirect(
      join(fixture.bookDir, "chapters", `${String(chapter).padStart(4, "0")}_${name}.md`),
      `# Chương ${chapter}mock_text ${name}\n\nChương ${chapter}mock_text，mock_text。\n`,
    );
  }
  // Exactly ONE durable prose file for the edited chapter.
  {
    const chaptersDir = join(fixture.bookDir, "chapters");
    for (const name of await readdir(chaptersDir)) {
      if (name.startsWith("0016_") && name.endsWith(".md")) {
        await rm(join(chaptersDir, name));
      }
    }
  }
  await writeFileDirect(
    join(fixture.bookDir, "chapters", "0016_mock_text.md"),
    P16_OLD,
  );
  // Full lifecycle index: 1..25 approved (READY head included).
  const index = Array.from({ length: HEAD }, (_, i) => i + 1).map((number) => ({
    number,
    title: `Chương ${number}mock_text`,
    status: "approved",
    wordCount: 100 + number,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  }));
  await writeFileDirect(
    join(fixture.bookDir, "chapters", "index.json"),
    JSON.stringify(ChapterMetaSchema.array().parse(index), null, 2),
  );
  // Resolved receipt history: R16-old plus one receipt per tail chapter.
  await seedResolvedReceipt(fixture.bookDir, SOURCE, OLD_RECEIPT_ID, {
    object: "mock_text",
    resolution: "confirmed-changes",
  });
  for (const chapter of TAIL) {
    await seedResolvedReceipt(fixture.bookDir, chapter, `historical-r${chapter}-gen`, {
      object: `mock_text sự thật${chapter}`,
      resolution: "confirmed-changes",
    });
  }
  return fixture;
}

async function writeFileDirect(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf-8");
}

interface ReceiptSeedOptions {
  readonly object: string;
  readonly resolution: "confirmed-changes" | "confirmed-no-changes";
}

async function seedResolvedReceipt(
  bookDir: string,
  chapter: number,
  reviewId: string,
  options: ReceiptSeedOptions,
): Promise<void> {
  const factChange: ProposalChange = {
    type: "fact",
    change: { action: "set", subject: "mock_text", predicate: "mock_text", object: options.object },
  };
  const receipt = ResolvedReviewReceiptSchema.parse({
    schemaVersion: 1,
    reviewId,
    sourceChapter: chapter,
    effectiveChapter: chapter,
    proseRevision: computeProseRevision(`# Chương ${chapter}mock_text\n\nseeded。`),
    baseCanonRevision: hex(chapter),
    resultingCanonRevision: hex(1000 + chapter),
    proposals: [factChange],
    decisions: [],
    effectiveChanges: options.resolution === "confirmed-changes" ? [factChange] : [],
    evidence: [],
    resolvedAt: CREATED_AT,
    resolution: options.resolution,
  });
  const dir = join(bookDir, "story/runtime/state-review-receipts", `chapter-${String(chapter).padStart(4, "0")}`);
  await mkdir(dir, { recursive: true });
  await writeFileDirect(join(dir, `${reviewId}.json`), JSON.stringify(receipt, null, 2));
}

/** Deterministic no-cascade fingerprint of chapters `from..to`: prose bytes,
 * index entries, receipt files, and snapshot files. */
async function captureTail(bookDir: string, chapters: readonly number[]) {
  const index = ChapterMetaSchema.array().parse(
    JSON.parse(await readFile(join(bookDir, "chapters/index.json"), "utf-8")),
  );
  const result: Record<string, unknown> = {};
  for (const chapter of chapters) {
    const padded = String(chapter).padStart(4, "0");
    const chaptersDir = join(bookDir, "chapters");
    const proseFile = (await readdir(chaptersDir)).find(
      (name) => name.startsWith(`${padded}_`) && name.endsWith(".md"),
    );
    const receiptDir = join(bookDir, "story/runtime/state-review-receipts", `chapter-${padded}`);
    const receiptFiles = (await readdir(receiptDir).catch(() => [] as string[])).sort();
    const snapshotDir = join(bookDir, "story/snapshots", String(chapter), "state");
    const snapshotFiles = (await readdir(snapshotDir).catch(() => [] as string[])).sort();
    result[chapter] = {
      prose: proseFile
        ? await readFile(join(chaptersDir, proseFile), "utf-8")
        : null,
      indexEntry: JSON.stringify(index.find((meta) => meta.number === chapter)),
      receipts: await Promise.all(receiptFiles.map(async (file) => [
        file,
        await readFile(join(receiptDir, file), "utf-8"),
      ])),
      snapshots: await Promise.all(snapshotFiles.map(async (file) => [
        file,
        await readFile(join(snapshotDir, file), "utf-8"),
      ])),
    };
  }
  return result;
}

async function readReceipt(bookDir: string, chapter: number, reviewId: string) {
  return ResolvedReviewReceiptSchema.parse(JSON.parse(await readFile(
    join(bookDir, "story/runtime/state-review-receipts",
      `chapter-${String(chapter).padStart(4, "0")}`, `${reviewId}.json`),
    "utf-8",
  )));
}

describe("state-review HISTORICAL correction end-to-end (Task 13)", () => {
  let fixture: CanonBookFixture;

  beforeEach(async () => {
    fixture = await seedHistoricalBook();
  });

  afterEach(async () => {
    await rm(fixture.root, { recursive: true, force: true }).catch(() => undefined);
  });

  it("(primary E2E) edit ch16 at head25 → invalidate → gate blocks → rebuild → decide → prepare → confirm: forward-governed correction with ZERO cascade", async () => {
    const bookDir = fixture.bookDir;
    const canonBefore = await readStoryCanon(bookDir);
    const tailBefore = await captureTail(bookDir, [...TAIL]);
    // Existing snapshots 1..25 are immutable history — capture slot 16 too.
    const snap16Dir = join(bookDir, "story/snapshots", String(SOURCE), "state");
    const snap16Before = await Promise.all(
      (await readdir(snap16Dir)).sort().map(async (file) => [
        file, await readFile(join(snap16Dir, file), "utf-8"),
      ]),
    );
    const r16Before = await readReceipt(bookDir, SOURCE, OLD_RECEIPT_ID);
    expect(r16Before.resolution).toBe("confirmed-changes");

    // The whole authoring phase runs under ONE caller-owned lock; Final
    // Confirm owns its own lock and is invoked after release.
    const manager = new StateManager(dirname(bookDir));
    const releaseLock = await manager.acquireBookLock(basename(bookDir));

    let freshReviewId = "";
    let expectedRevisionAtConfirm = 1;

    try {
      // ---- Task 9: REAL chapter-replace production path ------------------
      const editDeps: EditExecutionDeps = {
        bookDir: (bookId) => join(fixture.root, "books", bookId),
        loadChapterIndex: async () => ChapterMetaSchema.array().parse(
          JSON.parse(await readFile(join(bookDir, "chapters/index.json"), "utf-8")),
        ),
        saveChapterIndex: async () => undefined,
      };
      const executed = await executeEditTransaction(editDeps, {
        kind: "chapter-replace",
        bookId: basename(bookDir),
        chapterNumber: SOURCE,
        fullText: P16_NEW,
        versionSource: "manual",
      });
      expect(executed.reviewRequired).toBe(true);

      // Prose replaced…
      const proseFile = (await readdir(join(bookDir, "chapters")))
        .find((name) => name.startsWith("0016_"))!;
      expect(await readFile(join(bookDir, "chapters", proseFile), "utf-8")).toBe(P16_NEW);
      // …lifecycle flipped…
      const indexAfterEdit = ChapterMetaSchema.array().parse(
        JSON.parse(await readFile(join(bookDir, "chapters/index.json"), "utf-8")),
      );
      expect(indexAfterEdit.find((meta) => meta.number === SOURCE)?.status).toBe("needs-state-review");
      // …shell rebuild_required source16…
      const shell = await loadStateReview(bookDir, SOURCE);
      expect(shell?.status).toBe("rebuild_required");
      if (shell?.status === "rebuild_required") expect(shell.sourceChapter).toBe(SOURCE);
      // …old receipt superseded with ONLY the lifecycle field changed…
      const r16Superseded = await readReceipt(bookDir, SOURCE, OLD_RECEIPT_ID);
      expect(r16Superseded).toEqual({ ...r16Before, resolution: "superseded" });
      // …Canon structurally unchanged…
      expect(await readStoryCanon(bookDir)).toEqual(canonBefore);
      // …and the tail 17–25 untouched.
      expect(await captureTail(bookDir, [...TAIL])).toEqual(tailBefore);

      // ---- Task 5: historical pending shell BLOCKS advancement to 26 -----
      await expect(assertCanAdvanceStory(bookDir, EFFECTIVE))
        .rejects.toThrow(/Rebuild required/i);

      // ---- Task 10: PUBLIC regenerateStateReview boundary -----------------
      // The production adapter (book lock, index-authoritative title wiring,
      // WriterAgent.settleChapterState over the LATEST durable prose against
      // LIVE Canon) runs for real; only the Settler itself is a fake via the
      // approved `deps.createWriter` seam. No external LLM.
      const settlementDelta: RuntimeStateDelta = {
        chapter: SOURCE,
        currentStatePatch: { currentLocation: "mock_text" },
        hookOps: { upsert: [], mention: [], resolve: [], defer: [] },
        newHookCandidates: [],
        // Source-truthful summary row (design §20/§23): the rebuilt summary
        // DESCRIBES ch16 prose; application retargeting to 26 belongs to
        // Task 11's compiler, not to the proposal layer.
        chapterSummary: {
          chapter: SOURCE,
          title: "mock_text",
          characters: "mock_text；mock_text",
          events: "mock_text",
          stateChanges: "mock_text→mock_text",
          hookActivity: "",
          mood: "mock_text",
          chapterType: "mock_text",
        },
        subplotOps: [],
        emotionalArcOps: [],
        characterMatrixOps: [],
        notes: [],
      };
      const settleProbe = {
        calls: [] as string[],
        chapterNumbers: [] as number[],
        titles: [] as string[],
        contents: [] as string[],
        canonRevisions: [] as string[],
      };
      const runner = new PipelineRunner({
        client: {
          provider: "openai", apiFormat: "chat", stream: false,
          defaults: { temperature: 0.7, maxTokens: 4096, thinkingBudget: 0, extra: {} },
        },
        model: "test-model",
        projectRoot: fixture.root,
      });
      {
        // Public mutation-lock boundary probe (same pattern as the Task 10
        // suite): acquire → settle → release around ONE wrapper call.
        const stateAny = runner as unknown as {
          state: { acquireBookLock: (id: string) => Promise<() => void> };
        };
        const realAcquire = stateAny.state.acquireBookLock.bind(stateAny.state);
        vi.spyOn(stateAny.state, "acquireBookLock").mockImplementation(async (id) => {
          settleProbe.calls.push("acquire");
          const release = await realAcquire(id);
          return () => {
            settleProbe.calls.push("release");
            release();
          };
        });
      }
      const { artifact } = await runner.regenerateStateReview(basename(bookDir), SOURCE, {
        createWriter: () => ({
          settleChapterState: async (input) => {
            settleProbe.calls.push("settle");
            settleProbe.chapterNumbers.push(input.chapterNumber);
            settleProbe.titles.push(input.title);
            settleProbe.contents.push(input.content);
            settleProbe.canonRevisions.push((await readStoryCanon(bookDir)).revision);
            return {
              runtimeStateDelta: settlementDelta,
              updatedState: "# mock_text\n",
              updatedHooks: "# mock_text\n",
            } as never;
          },
        }),
      });
      // Public boundary really ran: lock wrapped settlement; the Settler saw
      // the authoritative index title, source number, LATEST prose bytes and
      // the LIVE head25 Canon as its semantic basis.
      expect(settleProbe.calls).toEqual(["acquire", "settle", "release"]);
      expect(settleProbe.chapterNumbers).toEqual([SOURCE]);
      expect(settleProbe.titles).toEqual(["Chương 16"]);
      expect(settleProbe.contents).toEqual([P16_NEW]); // latest durable prose
      expect(settleProbe.canonRevisions).toEqual([canonBefore.revision]);
      expect(artifact.status).toBe("active");
      expect(artifact.sourceChapter).toBe(SOURCE);
      expect(artifact.effectiveChapter).toBe(EFFECTIVE); // head25 ⇒ anchored 26
      expect(artifact.baseCanonRevision).toBe(canonBefore.revision);
      expect(artifact.proseRevision).toBe(computeProseRevision(P16_NEW));
      expect(artifact.reviewRevision).toBe(1);
      expect(artifact.reviewId).not.toBe(OLD_RECEIPT_ID);
      // NO carry-forward: every item is fresh AI/undecided.
      for (const item of artifact.items as readonly ReviewItem[]) {
        expect(item.origin).toBe("ai");
        expect(item.decision).toBe("undecided");
        expect(item.editedChange).toBeUndefined();
      }

      // ---- Task 8: REAL CAS decisions on the fresh generation -------------
      const factItem = (artifact.items as ReadonlyArray<ReviewItem>)
        .find((item) => item.kind === "current-state-fact")!;
      expect(factItem).toBeDefined();
      await decideStateReviewItem({
        bookDir, chapter: SOURCE, itemId: factItem.id,
        decision: "accept", expectedReviewRevision: 1,
      });
      const summaryItem = (artifact.items as ReadonlyArray<ReviewItem>)
        .find((item) => item.kind === "chapter-summary")!;
      expect(summaryItem).toBeDefined();
      await decideStateReviewItem({
        bookDir, chapter: SOURCE, itemId: summaryItem.id,
        decision: "accept", expectedReviewRevision: 2,
      });
      const afterUserAdd = await addUserStateReviewItem({
        bookDir, chapter: SOURCE, expectedReviewRevision: 3,
        kind: "current-state-fact",
        change: { type: "fact", change: { action: "set", subject: "mock_text", predicate: "mock_text", object: "mock_text" } },
        title: "Human correction: mock_text",
      });
      expectedRevisionAtConfirm = afterUserAdd.reviewRevision;
      expect(expectedRevisionAtConfirm).toBe(4); // three CAS increments
      freshReviewId = afterUserAdd.reviewId;
      expect(freshReviewId).toBe(artifact.reviewId); // same generation throughout
    } finally {
      await releaseLock();
    }

    // ---- Task 11: PURE PREPARE (zero filesystem writes) -------------------
    const treeBeforePrepare = await captureTail(bookDir, [SOURCE, ...TAIL]);
    const prepared = await prepareStateReviewConfirm({
      bookDir, chapter: SOURCE, expectedReviewRevision: expectedRevisionAtConfirm,
      durableHead: HEAD,
    });
    expect(prepared.effectiveChapter).toBe(EFFECTIVE);
    const candidateManifest = StateManifestSchema.parse(JSON.parse(
      prepared.canonWrites.find((w) => w.relativePath === "story/state/manifest.json")!.content,
    ));
    expect(candidateManifest.lastAppliedChapter).toBe(EFFECTIVE);
    const candidateState = CurrentStateStateSchema.parse(JSON.parse(
      prepared.canonWrites.find((w) => w.relativePath === "story/state/current_state.json")!.content,
    ));
    expect(candidateState.chapter).toBe(EFFECTIVE);
    expect(candidateState.facts.some((f) => f.predicate === "mock_text" && f.object === "mock_text")).toBe(true);
    // Source chapter approved in the candidate index — NOT the effective slot.
    const candidateIndex = ChapterMetaSchema.array().parse(JSON.parse(prepared.indexWrite.content));
    expect(candidateIndex.find((meta) => meta.number === SOURCE)?.status).toBe("approved");
    expect(candidateIndex.some((meta) => meta.number === EFFECTIVE)).toBe(false);
    expect(prepared.receipt.sourceChapter).toBe(SOURCE);
    expect(prepared.receipt.effectiveChapter).toBe(EFFECTIVE);
    for (const write of prepared.snapshotWrites) {
      expect(write.relativePath.startsWith(`story/snapshots/${EFFECTIVE}/`)).toBe(true);
    }
    expect(await captureTail(bookDir, [SOURCE, ...TAIL])).toEqual(treeBeforePrepare);

    // ---- Task 12: PUBLIC Final Confirm (derives live head itself) --------
    const result = await confirmStateReview({
      bookDir, chapter: SOURCE, reviewId: freshReviewId,
      expectedReviewRevision: expectedRevisionAtConfirm,
    });
    expect(result.status).toBe("resolved");
    expect(result.warnings).toEqual([]);

    // New resolved receipt carries BOTH identities.
    expect(result.receipt.sourceChapter).toBe(SOURCE);
    expect(result.receipt.effectiveChapter).toBe(EFFECTIVE);
    expect(result.receipt.reviewId).toBe(freshReviewId);
    // Historical retarget layers inside the receipt (I-11.1 E2E):
    const summaryProposal = result.receipt.proposals.find(
      (change) => change.type === "chapter-summary",
    ) as { type: "chapter-summary"; row: { chapter: number } };
    expect(summaryProposal.row.chapter).toBe(SOURCE); // proposal layer stays 16
    const appliedSummary = result.receipt.effectiveChanges.find(
      (change) => change.type === "chapter-summary",
    ) as { type: "chapter-summary"; row: { chapter: number } };
    expect(appliedSummary.row.chapter).toBe(EFFECTIVE); // applied layer is 26

    // Durable Canon advanced THROUGH the effective slot.
    const manifest = StateManifestSchema.parse(JSON.parse(
      await readFile(join(bookDir, "story/state/manifest.json"), "utf-8"),
    ));
    expect(manifest.lastAppliedChapter).toBe(EFFECTIVE);
    const liveState = CurrentStateStateSchema.parse(JSON.parse(
      await readFile(join(bookDir, "story/state/current_state.json"), "utf-8"),
    ));
    expect(liveState.chapter).toBe(EFFECTIVE);
    // DURABILITY of the forward-applied head in the SEMANTIC-CHANGE flow too:
    // the production loader must keep head 26 consistent with no clamping.
    const reloadedCanonPrimary = await readStoryCanon(bookDir);
    expect(reloadedCanonPrimary.manifest.lastAppliedChapter).toBe(EFFECTIVE);
    expect(reloadedCanonPrimary.currentState.chapter).toBe(EFFECTIVE);
    expect(reloadedCanonPrimary.revision).toBe(result.resultingCanonRevision);
    // V1 provenance convention: application anchor 26 in Canon facts.
    const appliedFact = liveState.facts.find((f) => f.predicate === "mock_text" && f.object === "mock_text")!;
    expect(appliedFact.sourceChapter).toBe(EFFECTIVE);
    expect(appliedFact.validFromChapter).toBe(EFFECTIVE);
    // Applied chapter summary lives at slot 26.
    const summaries = ChapterSummariesStateSchema.parse(JSON.parse(
      await readFile(join(bookDir, "story/state/chapter_summaries.json"), "utf-8"),
    ));
    expect(summaries.rows.find((row) => row.title === "mock_text")?.chapter).toBe(EFFECTIVE);

    // Effective-slot snapshot created; NO replacement snapshots/16.
    const snapManifest = StateManifestSchema.parse(JSON.parse(
      await readFile(join(bookDir, `story/snapshots/${EFFECTIVE}/state/manifest.json`), "utf-8"),
    ));
    expect(snapManifest.lastAppliedChapter).toBe(EFFECTIVE);
    // NO replacement snapshots/16 was created — the pre-existing historical
    // slot stays byte-identical (immutable record of what was canonical).
    const snap16After = await Promise.all(
      (await readdir(snap16Dir)).sort().map(async (file) => [
        file, await readFile(join(snap16Dir, file), "utf-8"),
      ]),
    );
    expect(snap16After).toEqual(snap16Before);

    // Source lifecycle restored; active gone; old receipt PRESERVED superseded.
    const finalIndex = ChapterMetaSchema.array().parse(
      JSON.parse(await readFile(join(bookDir, "chapters/index.json"), "utf-8")),
    );
    expect(finalIndex.find((meta) => meta.number === SOURCE)?.status).toBe("approved");
    expect(await loadStateReview(bookDir, SOURCE)).toBeNull();
    const r16Final = await readReceipt(bookDir, SOURCE, OLD_RECEIPT_ID);
    expect(r16Final).toEqual({ ...r16Before, resolution: "superseded" });
    const newDiskReceipt = await readReceipt(bookDir, SOURCE, freshReviewId);
    expect(newDiskReceipt.resolution).toBe("confirmed-changes");

    // THE central invariant: tail 17–25 byte-identical to PRE-EDIT baseline,
    // and snapshots 1–25 remain immutable records.
    expect(await captureTail(bookDir, [...TAIL])).toEqual(tailBefore);
    for (let chapter = 1; chapter <= HEAD; chapter += 1) {
      const files = (await readdir(join(bookDir, "story/snapshots", String(chapter), "state"))).sort();
      expect(files.length).toBeGreaterThan(0);
    }

    // Derived sync produced a readable memory.db reflecting slot 26.
    const db = new MemoryDB(bookDir);
    try {
      // Slot facts use the literal shared subject "protagonist" (Task 11
      // describeCurrentStateSlot convention) — same as plan's pinned assert.
      const factsAtEffective = db.getFactsAt("protagonist", EFFECTIVE)
        .filter((fact) => fact.predicate === "mock_text");
      expect(factsAtEffective.map((fact) => fact.object)).toContain("mock_text");
      expect(factsAtEffective[0]?.validFromChapter).toBe(EFFECTIVE);
    } finally {
      db.close();
    }

    // ---- Task 5: the resolved historical review no longer blocks 26 -------
    await expect(assertCanAdvanceStory(bookDir, EFFECTIVE)).resolves.toBeUndefined();
  });

  it("(gate matrix) historical shells block ch26; resolving unblocks; resolved receipts alone never block", async () => {
    const bookDir = fixture.bookDir;

    await saveStateReviewShell(bookDir, {
      schemaVersion: 1, status: "rebuild_required",
      sourceChapter: SOURCE, createdAt: CREATED_AT, language: "vi", reason: "",
    });
    await expect(assertCanAdvanceStory(bookDir, EFFECTIVE)).rejects.toThrow(/Rebuild required/i);

    await saveStateReviewShell(bookDir, {
      schemaVersion: 1, status: "rebuild_failed",
      sourceChapter: SOURCE, createdAt: CREATED_AT, language: "vi", reason: "analyzer crashed",
    });
    await expect(assertCanAdvanceStory(bookDir, EFFECTIVE)).rejects.toThrow(/Rebuild failed/i);

    // Resolve via the REAL chain (compact: direct active publication is
    // fixture seeding; confirmation itself is production API).
    await publishActiveProposal(bookDir, {
      status: "active",
      schemaVersion: 1,
      sourceChapter: SOURCE,
      createdAt: CREATED_AT,
      language: "vi",
      reviewId: "11111111-2222-4333-8444-555555555555",
      effectiveChapter: EFFECTIVE,
      proseRevision: computeProseRevision(P16_OLD),
      baseCanonRevision: (await readStoryCanon(bookDir)).revision,
      reviewRevision: 1,
      items: [{
        id: "hist-zero-item",
        kind: "note",
        origin: "ai",
        title: "mock_text",
        proposal: { type: "none" },
        decision: "undecided",
      }],
    });
    const resolved = await confirmStateReview({
      bookDir, chapter: SOURCE, reviewId: "11111111-2222-4333-8444-555555555555",
      expectedReviewRevision: 1,
    });
    expect(resolved.status).toBe("resolved");
    await expect(assertCanAdvanceStory(bookDir, EFFECTIVE)).resolves.toBeUndefined();

    // Receipts alone never block: fresh book WITHOUT any runtime artifacts.
    const quiet = await createCanonBook({ chapterCount: HEAD, seedSnapshotsThrough: HEAD });
    try {
      await writeFileDirect(join(quiet.bookDir, "chapters/index.json"), JSON.stringify(
        ChapterMetaSchema.array().parse(
          Array.from({ length: HEAD }, (_, i) => i + 1).map((number) => ({
            number, title: `Chương ${number}mock_text`, status: "approved", wordCount: 100,
            createdAt: CREATED_AT, updatedAt: CREATED_AT,
          })),
        ), null, 2,
      ));
      await seedResolvedReceipt(quiet.bookDir, 3, "only-history-gen", {
        object: "mock_text", resolution: "confirmed-changes",
      });
      await expect(assertCanAdvanceStory(quiet.bookDir, EFFECTIVE)).resolves.toBeUndefined();
    } finally {
      await rm(quiet.root, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("(zero-effective historical) rejected correction still consumes slot 26 with confirmed-no-changes", async () => {
    const bookDir = fixture.bookDir;
    const tailBefore = await captureTail(bookDir, [...TAIL]);

    // Fixture seeding: an ACTIVE historical generation whose only semantic
    // item the human REJECTS (no evidence ⇒ plain Reject allowed).
    await publishActiveProposal(bookDir, {
      status: "active",
      schemaVersion: 1,
      sourceChapter: SOURCE,
      createdAt: CREATED_AT,
      language: "vi",
      reviewId: "99999999-8888-4777-8666-555555555555",
      effectiveChapter: EFFECTIVE,
      proseRevision: computeProseRevision(P16_OLD),
      baseCanonRevision: (await readStoryCanon(bookDir)).revision,
      reviewRevision: 1,
      items: [{
        id: "hist-rejected-fact",
        kind: "current-state-fact",
        origin: "ai",
        title: "Current-state update: mock_text",
        proposal: { type: "fact", change: { action: "set", subject: "mock_text", predicate: "mock_text", object: "mock_text" } },
        decision: "undecided",
      }],
    });
    await decideStateReviewItem({
      bookDir, chapter: SOURCE, itemId: "hist-rejected-fact",
      decision: "reject", expectedReviewRevision: 1,
    });

    const result = await confirmStateReview({
      bookDir, chapter: SOURCE, reviewId: "99999999-8888-4777-8666-555555555555",
      expectedReviewRevision: 2,
    });

    expect(result.status).toBe("resolved");
    expect(result.receipt.resolution).toBe("confirmed-no-changes");
    expect(result.receipt.sourceChapter).toBe(SOURCE);
    expect(result.receipt.effectiveChapter).toBe(EFFECTIVE);
    const manifest = StateManifestSchema.parse(JSON.parse(
      await readFile(join(bookDir, "story/state/manifest.json"), "utf-8"),
    ));
    expect(manifest.lastAppliedChapter).toBe(EFFECTIVE); // bookkeeping advances
    // DURABILITY of the forward-applied head: any later pure load (bootstrap
    // normalization) must keep the confirmed structured head and stay
    // consistent — the Task 13 integration defect this pins.
    const reloadedCanon = await readStoryCanon(bookDir);
    expect(reloadedCanon.manifest.lastAppliedChapter).toBe(EFFECTIVE);
    expect(reloadedCanon.revision).toBe(result.resultingCanonRevision);
    const liveState = CurrentStateStateSchema.parse(JSON.parse(
      await readFile(join(bookDir, "story/state/current_state.json"), "utf-8"),
    ));
    expect(liveState.facts.some((f) => f.object === "mock_text")).toBe(false); // rejected semantics absent
    const snapManifest = StateManifestSchema.parse(JSON.parse(
      await readFile(join(bookDir, `story/snapshots/${EFFECTIVE}/state/manifest.json`), "utf-8"),
    ));
    expect(snapManifest.lastAppliedChapter).toBe(EFFECTIVE);
    const index = ChapterMetaSchema.array().parse(
      JSON.parse(await readFile(join(bookDir, "chapters/index.json"), "utf-8")),
    );
    // Source chapter restored to approved — not just bookkeeping length.
    expect(index.find((meta) => meta.number === SOURCE)?.status).toBe("approved");
    expect(index.length).toBe(HEAD);
    expect(await loadStateReview(bookDir, SOURCE)).toBeNull();
    // Zero cascade on the tail.
    expect(await captureTail(bookDir, [...TAIL])).toEqual(tailBefore);
  });
});
