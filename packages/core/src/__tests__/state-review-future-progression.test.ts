/**
 * Task 13 follow-up — FUTURE PROGRESSION after a historical correction.
 *
 * Pins the architectural separation that Phase 4 forward-governed corrections
 * create:
 *
 *   PROSE SOURCE CHAPTER  !=  SEMANTIC EFFECTIVE SLOT
 *
 * After a historical correction consumes semantic slot 26 (prose prefix stays
 * 25), normal writing MUST continue at prose chapter 26 whose semantics anchor
 * at effective slot 27:
 *
 *   - the governed/deferred Writer NEVER applies its source-oriented proposal
 *     delta against the LIVE runtime snapshot (Task 6/7 `deferStateApplication`
 *     contract — proposal material only);
 *   - governed publication derives `effectiveChapter` from the CONFIRMED
 *     SEMANTIC HEAD (same §20 rule as Task 10/11), not from the prose prefix;
 *   - Task 12 Final Confirm then applies source26 semantics at slot 27 with NO
 *     manual rebuild round-trip, writing snapshots/27 while the historical
 *     snapshots/26 stays byte-identical;
 *   - prose numbering never skips: the next durable chapter file is still 26.
 */
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PipelineRunner } from "../pipeline/runner.js";
import { StateManager } from "../state/manager.js";
import { PlannerAgent } from "../agents/planner.js";
import { FoundationReviewerAgent } from "../agents/foundation-reviewer.js";
import { WriterAgent, type WriteChapterOutput } from "../agents/writer.js";
import { ContinuityAuditor } from "../agents/continuity.js";
import { ReviserAgent } from "../agents/reviser.js";
import { ChapterAnalyzerAgent } from "../agents/chapter-analyzer.js";
import { StateValidatorAgent } from "../agents/state-validator.js";
import {
  ACTIVE_REVIEW_RELPATH,
  loadStateReview,
} from "../state/state-review-store.js";
import { confirmStateReview } from "../state/state-review-finalize.js";
import {
  decideStateReviewItem,
} from "../state/state-review-service.js";
import { readStoryCanon } from "../state/canon-service.js";
import { resolveEffectiveChapter } from "../state/state-review-temporal.js";
import { computeProseRevision } from "../utils/prose-revision.js";
import { StateManifestSchema } from "../models/runtime-state.js";
import { ChapterMetaSchema } from "../models/chapter.js";
import type { BookConfig } from "../models/book.js";
import type { RuntimeStateDelta } from "../models/runtime-state.js";

const ZERO_USAGE = { promptTokens: 0, completionTokens: 0, totalTokens: 0 } as const;
const HEAD = 25;
const SLOT = 26;
const NEXT_SLOT = 27;

const CLIENT = {
  provider: "openai",
  apiFormat: "chat" as const,
  stream: false,
  defaults: { temperature: 0.7, maxTokens: 4096, thinkingBudget: 0 },
};

function makeBook(now: string): BookConfig {
  return {
    id: "demo-canon-book",
    title: "mock_text",
    platform: "other",
    genre: "urban",
    language: "vi",
    status: "active",
    targetChapters: 100,
    chapterWordCount: 3000,
    createdAt: now,
    updatedAt: now,
  };
}

async function writeFileDirect(path: string, content: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content, "utf-8");
}

/** Source-oriented proposal delta for prose chapter 26 (chapter stays 26!). */
function sourceDelta26(): RuntimeStateDelta {
  return {
    chapter: SLOT,
    currentStatePatch: { currentGoal: "mock_text" },
    hookOps: { upsert: [], mention: [], resolve: [], defer: [] },
    newHookCandidates: [],
    chapterSummary: {
      chapter: SLOT, // source-truthful: Task 11 owns application-time retargeting
      title: "mock_text",
      characters: "mock_text",
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
}

const BODY_26 = "mock_text";

function stubWriterOutput26(overrides: Partial<WriteChapterOutput> = {}): WriteChapterOutput {
  return {
    chapterNumber: SLOT,
    title: "mock_text",
    content: BODY_26,
    wordCount: BODY_26.length,
    preWriteCheck: "",
    postSettlement: "",
    updatedState: "# mock_text\n\n- mock_text\n",
    updatedHooks: "# mock_text\n",
    updatedLedger: "# mock_text\n",
    updatedSubplots: "# mock_text\n",
    updatedEmotionalArcs: "# mock_text\n",
    updatedCharacterMatrix: "# mock_text\n",
    chapterSummary: "| 26 | mock_text | mock_text | mock_text | mock_text | | mock_text | mock_text |",
    postWriteErrors: [],
    postWriteWarnings: [],
    tokenUsage: ZERO_USAGE,
    ...overrides,
  };
}

interface PostCorrectionFixture {
  readonly root: string;
  readonly bookDir: string;
  readonly bookId: string;
}

/**
 * Head26 / prefix25 book: the EXACT durable shape Task 12 leaves behind after
 * confirming a historical correction (source16 → effective26):
 *   - prose files + approved index through 25 (NO chapter 26 prose);
 *   - structured Canon manifest/current_state agreeing at 26;
 *   - snapshots/26 mirroring the confirmed state (historical record);
 *   - a resolved receipt documenting the consumed slot.
 */
async function seedPostCorrectionBook(options?: { readonly semanticHead?: number }): Promise<PostCorrectionFixture> {
  const semanticHead = options?.semanticHead ?? SLOT;
  const root = await mkdtemp(join(tmpdir(), "castor-future-progression-"));
  const bookId = "demo-canon-book";
  const bookDir = join(root, "books", bookId);
  const storyDir = join(bookDir, "story");
  const now = "2026-08-24T00:00:00.000Z";

  await writeFileDirect(join(bookDir, "book.json"), JSON.stringify(makeBook(now)));
  // Durable prose prefix 1..25, distinct bytes per chapter.
  for (let chapter = 1; chapter <= HEAD; chapter += 1) {
    await writeFileDirect(
      join(bookDir, "chapters", `${String(chapter).padStart(4, "0")}_Chương ${chapter}mock_text.md`),
      `# Chương ${chapter}mock_text mock_text${chapter}\n\nChương ${chapter}mock_text từmock_text。\n`,
    );
  }
  const index = Array.from({ length: HEAD }, (_, i) => i + 1).map((number) => ({
    number,
    title: `Chương ${number}mock_text`,
    status: "approved",
    wordCount: 100 + number,
    createdAt: now,
    updatedAt: now,
  }));
  await writeFileDirect(
    join(bookDir, "chapters", "index.json"),
    JSON.stringify(ChapterMetaSchema.array().parse(index), null, 2),
  );

  // Structured Canon agreeing at the semantic head (bootstrap preservation).
  const manifest = {
    schemaVersion: 2, language: "vi", lastAppliedChapter: semanticHead,
    projectionVersion: 3, migrationWarnings: [] as string[],
  };
  const currentState = {
    chapter: semanticHead,
    facts: [{
      subject: "protagonist",
      predicate: "mock_text",
      object: "mock_text",
      validFromChapter: SLOT,
      validUntilChapter: null,
      sourceChapter: SLOT,
    }],
  };
  const canonDocs: Record<string, string> = {
    "manifest.json": JSON.stringify(manifest, null, 2),
    "current_state.json": JSON.stringify(currentState, null, 2),
    "hooks.json": JSON.stringify({ hooks: [] }, null, 2),
    "chapter_summaries.json": JSON.stringify({
      rows: [{
        chapter: SLOT, title: "mock_text", characters: "mock_text；mock_text",
        events: "mock_text", stateChanges: "mock_text→mock_text",
        hookActivity: "", mood: "mock_text", chapterType: "mock_text",
      }],
    }, null, 2),
  };
  for (const [name, content] of Object.entries(canonDocs)) {
    await writeFileDirect(join(storyDir, "state", name), content);
  }
  await writeFileDirect(join(storyDir, "current_state.md"), "# mock_text\n");
  await writeFileDirect(join(storyDir, "pending_hooks.md"), "# mock_text\n");
  await writeFileDirect(join(storyDir, "chapter_summaries.md"), "# mock_text\n");

  // Historical snapshot mirror for the consumed slot (immutability target).
  for (const [name, content] of Object.entries(canonDocs)) {
    await writeFileDirect(join(storyDir, "snapshots", String(SLOT), "state", name), content);
  }

  // Resolved receipt documenting the consumed historical slot.
  await writeFileDirect(
    join(storyDir, "runtime", "state-review-receipts", "chapter-0016", "historical-r16-slot26.json"),
    JSON.stringify({
      schemaVersion: 1,
      reviewId: "historical-r16-slot26",
      sourceChapter: 16,
      effectiveChapter: SLOT,
      proseRevision: "seeded",
      baseCanonRevision: "seeded-base",
      resultingCanonRevision: "seeded-result",
      proposals: [], decisions: [], effectiveChanges: [], evidence: [],
      resolvedAt: now,
      resolution: "confirmed-changes",
    }, null, 2),
  );

  // Warm up idempotent bootstrap rewrites so later tree captures are stable.
  const state = new StateManager(root);
  await state.getNextChapterNumber(bookId);
  await state.getNextChapterNumber(bookId);
  await readStoryCanon(bookDir);

  return { root, bookDir, bookId };
}

async function captureSlot26(bookDir: string) {
  const dir = join(bookDir, "story", "snapshots", String(SLOT), "state");
  return Promise.all((await readdir(dir)).sort().map(async (file) => [
    file, await readFile(join(dir, file), "utf-8"),
  ]));
}

async function captureTailProse(bookDir: string) {
  const entries: Array<[string, string]> = [];
  for (let chapter = 17; chapter <= HEAD; chapter += 1) {
    const padded = String(chapter).padStart(4, "0");
    const name = (await readdir(join(bookDir, "chapters")))
      .find((candidate) => candidate.startsWith(`${padded}_`) && candidate.endsWith(".md"))!;
    entries.push([name, await readFile(join(bookDir, "chapters", name), "utf-8")]);
  }
  return entries;
}

describe("future progression after a historical correction (Task 13 follow-up)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("(C-13.1) governed deferred settlement of prose 26 does NOT apply the proposal to live Canon head 26", async () => {
    const fixture = await seedPostCorrectionBook();
    try {
      const canonBefore = await readStoryCanon(fixture.bookDir);
      expect(canonBefore.manifest.lastAppliedChapter).toBe(SLOT); // semantic head leads

      const agent = new WriterAgent({
        client: CLIENT,
        model: "test-model",
        projectRoot: fixture.root,
      } as unknown as ConstructorParameters<typeof WriterAgent>[0]);
      // Deterministic settlement seam: source-oriented delta — exactly what
      // the real Settler emits as proposal material.
      const settleTarget = agent as unknown as {
        settle: (params: unknown) => Promise<unknown>;
      };
      vi.spyOn(settleTarget, "settle").mockResolvedValue({
        settlement: {
          runtimeStateDelta: sourceDelta26(),
          updatedState: "# mock_text\n\n- mock_text\n",
          updatedHooks: "# mock_text\n",
        },
        usage: ZERO_USAGE,
      });

      // The REAL governed settlement flow (same seam the pipeline re-settle
      // and the Task 10 public adapter drive) under the deferred contract.
      const output = await agent.settleChapterState({
        book: makeBook("2026-08-24T00:00:00.000Z"),
        bookDir: fixture.bookDir,
        chapterNumber: SLOT,
        title: "mock_text",
        content: BODY_26,
        deferStateApplication: true, // governed publication contract (Task 6/7)
      });

      // Proposal survives SOURCE-oriented and UNSPPLIED…
      expect(output.runtimeStateDelta?.chapter).toBe(SLOT);
      expect(output.runtimeStateDelta?.chapterSummary?.chapter).toBe(SLOT);
      // …NO candidate artifacts were built against the live snapshot…
      expect(output.runtimeStateSnapshot).toBeUndefined();
      // …and the live Canon was never touched.
      const canonAfter = await readStoryCanon(fixture.bookDir);
      expect(canonAfter.revision).toBe(canonBefore.revision);
      expect(canonAfter.manifest.lastAppliedChapter).toBe(SLOT);
    } finally {
      await rm(fixture.root, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("(Part C legacy) non-deferred settlement still applies a healthy chapter 26 at slot 26", async () => {
    // Healthy book: prose prefix 25 AND semantic head 25.
    const fixture = await seedPostCorrectionBook({ semanticHead: HEAD });
    try {
      const agent = new WriterAgent({
        client: CLIENT,
        model: "test-model",
        projectRoot: fixture.root,
      } as unknown as ConstructorParameters<typeof WriterAgent>[0]);
      const settleTarget = agent as unknown as {
        settle: (params: unknown) => Promise<unknown>;
      };
      vi.spyOn(settleTarget, "settle").mockResolvedValue({
        settlement: {
          runtimeStateDelta: { ...sourceDelta26(), chapterSummary: undefined },
          updatedState: "# mock_text\n\n- mock_text\n",
          updatedHooks: "# mock_text\n",
        },
        usage: ZERO_USAGE,
      });

      const output = await agent.settleChapterState({
        book: makeBook("2026-08-24T00:00:00.000Z"),
        bookDir: fixture.bookDir,
        chapterNumber: SLOT,
        title: "mock_text",
        content: BODY_26,
        // NO deferStateApplication ⇒ legacy behavior must be preserved.
      });

      expect(output.runtimeStateDelta?.chapter).toBe(SLOT);
      // Legacy live application produced candidate artifacts anchored at 26.
      expect(output.runtimeStateSnapshot?.manifest.lastAppliedChapter).toBe(SLOT);
    } finally {
      await rm(fixture.root, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("(Part F/L) ONE shared temporal rule: healthy, one correction, two corrections", () => {
    // Healthy: prose prefix 25, semantic head 25, next prose 26.
    expect(resolveEffectiveChapter(SLOT, HEAD)).toBe(SLOT);
    // One historical correction consumed slot 26 ⇒ head 26.
    expect(resolveEffectiveChapter(SLOT, SLOT)).toBe(NEXT_SLOT);
    // Two stacked corrections ⇒ head 27 — NO numeric head<=prefix+1 bound.
    expect(resolveEffectiveChapter(SLOT, SLOT + 1)).toBe(28);
  });

  it("(Parts G/H/I/J/K/L) governed publication anchors source26/effective27; direct confirm lands slot 27", async () => {
    const fixture = await seedPostCorrectionBook();
    try {
      const canonBefore = await readStoryCanon(fixture.bookDir);
      const slot26Before = await captureSlot26(fixture.bookDir);
      const tailBefore = await captureTailProse(fixture.bookDir);
      const capturedWriteInputs: Array<Parameters<WriterAgent["writeChapter"]>[0]> = [];

      const runner = new PipelineRunner({
        client: CLIENT,
        model: "test-model",
        projectRoot: fixture.root,
      } as unknown as ConstructorParameters<typeof PipelineRunner>[0]);

      vi.spyOn(PlannerAgent.prototype, "planChapter").mockImplementation(async (input) => ({
        intent: { chapter: input.chapterNumber, goal: "test goal", mustKeep: [], mustAvoid: [], styleEmphasis: [] },
        memo: {
          chapter: input.chapterNumber, goal: "test goal",
          isGoldenOpening: false, body: "", threadRefs: [] as string[],
        },
        intentMarkdown: "# Chapter Intent\n\n## Goal\ntest goal\n",
        plannerInputs: [],
        runtimePath: "",
      }));
      vi.spyOn(FoundationReviewerAgent.prototype, "review").mockResolvedValue({
        passed: true, totalScore: 85, dimensions: [], overallFeedback: "auto-pass",
      });
      vi.spyOn(StateValidatorAgent.prototype, "validate").mockResolvedValue({
        warnings: [], passed: true,
      });
      vi.spyOn(ReviserAgent.prototype, "reviseChapter").mockImplementation(
        async (_bookDir, chapterContent) => ({
          revisedContent: chapterContent,
          wordCount: chapterContent.length,
          fixedIssues: [],
          tokenUsage: ZERO_USAGE,
        }),
      );
      vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue({
        passed: true, issues: [], summary: "clean", overallScore: 95, tokenUsage: ZERO_USAGE,
      });
      const writerSpy = vi.spyOn(WriterAgent.prototype, "writeChapter").mockImplementation(
        async (input) => {
          capturedWriteInputs.push(input);
          return stubWriterOutput26({ runtimeStateDelta: sourceDelta26() });
        },
      );

      const result = await runner.writeNextChapter(fixture.bookId, BODY_26.length);

      // ---- Governed publication ------------------------------------------
      expect(result.status).toBe("needs-state-review");
      expect(writerSpy).toHaveBeenCalledTimes(1);
      // Part C (coverage pin): the REAL runner → writer.writeChapter governed
      // call carries the deferred contract — proposal material only.
      expect(capturedWriteInputs[0]?.deferStateApplication).toBe(true);

      // Part J: prose numbering does NOT skip — the durable chapter IS 26.
      const proseName = (await readdir(join(fixture.bookDir, "chapters")))
        .find((name) => name.startsWith("0026_"))!;
      const durableProse = await readFile(join(fixture.bookDir, "chapters", proseName), "utf-8");
      expect(durableProse).toContain(BODY_26);

      const index = ChapterMetaSchema.array().parse(JSON.parse(
        await readFile(join(fixture.bookDir, "chapters", "index.json"), "utf-8"),
      ));
      expect(index.map((meta) => meta.number)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, SLOT,
      ]);
      expect(index.find((meta) => meta.number === SLOT)?.status).toBe("needs-state-review");

      // Part G/I-13.2: publication anchors from the CONFIRMED SEMANTIC HEAD.
      const rawArtifact = JSON.parse(await readFile(
        join(fixture.bookDir, ACTIVE_REVIEW_RELPATH(SLOT)), "utf-8",
      ));
      expect(rawArtifact.status).toBe("active");
      expect(rawArtifact.sourceChapter).toBe(SLOT);
      expect(rawArtifact.effectiveChapter).toBe(NEXT_SLOT); // literal 27 — NOT derived from the helper under test's callers
      expect(rawArtifact.reviewRevision).toBe(1);
      expect(rawArtifact.baseCanonRevision).toBe(canonBefore.revision);

      // Part D: proposal layer remains source-oriented (row stays 26).
      const summaryItem = rawArtifact.items.find(
        (item: { kind: string }) => item.kind === "chapter-summary",
      );
      expect(summaryItem?.proposal?.row?.chapter).toBe(SLOT);

      // Live semantic head unchanged by generation; no snapshots/27 yet.
      const canonAfterPublish = await readStoryCanon(fixture.bookDir);
      expect(canonAfterPublish.revision).toBe(canonBefore.revision);
      expect(canonAfterPublish.manifest.lastAppliedChapter).toBe(SLOT);
      await expect(readFile(join(
        fixture.bookDir, "story", "snapshots", String(NEXT_SLOT), "state", "manifest.json",
      ), "utf-8")).rejects.toMatchObject({ code: "ENOENT" });

      // ---- Human review (real Task 8 CAS) ---------------------------------
      let revision = rawArtifact.reviewRevision as number;
      for (const item of rawArtifact.items) {
        await decideStateReviewItem({
          bookDir: fixture.bookDir, chapter: SLOT, itemId: item.id,
          decision: "accept", expectedReviewRevision: revision,
        });
        revision += 1;
      }
      expect(revision).toBe(rawArtifact.items.length + 1);

      // ---- Part H: DIRECT Final Confirm — no rebuild round-trip ----------
      const result12 = await confirmStateReview({
        bookDir: fixture.bookDir, chapter: SLOT, reviewId: rawArtifact.reviewId,
        expectedReviewRevision: revision,
      });
      expect(result12.status).toBe("resolved");
      expect(result12.warnings).toEqual([]);

      // Resulting semantic head is 27; receipt carries BOTH identities.
      const canonFinal = await readStoryCanon(fixture.bookDir);
      expect(canonFinal.manifest.lastAppliedChapter).toBe(NEXT_SLOT);
      expect(canonFinal.currentState.chapter).toBe(NEXT_SLOT);
      expect(result12.resultingCanonRevision).toBe(canonFinal.revision);
      expect(result12.receipt.sourceChapter).toBe(SLOT);
      expect(result12.receipt.effectiveChapter).toBe(NEXT_SLOT);
      const appliedSummary = result12.receipt.effectiveChanges.find(
        (change) => change.type === "chapter-summary",
      ) as { row: { chapter: number } };
      expect(appliedSummary.row.chapter).toBe(NEXT_SLOT); // applied layer 27

      // Part I: snapshots/27 exists; historical snapshots/26 byte-identical.
      const snap27 = StateManifestSchema.parse(JSON.parse(await readFile(
        join(fixture.bookDir, "story", "snapshots", String(NEXT_SLOT), "state", "manifest.json"), "utf-8",
      )));
      expect(snap27.lastAppliedChapter).toBe(NEXT_SLOT);
      expect(await captureSlot26(fixture.bookDir)).toEqual(slot26Before);

      // No cascade into tail prose.
      expect(await captureTailProse(fixture.bookDir)).toEqual(tailBefore);

      // Review artifact closed; index entry approved.
      expect(await loadStateReview(fixture.bookDir, SLOT)).toBeNull();
      const finalIndex = ChapterMetaSchema.array().parse(JSON.parse(
        await readFile(join(fixture.bookDir, "chapters", "index.json"), "utf-8"),
      ));
      expect(finalIndex.find((meta) => meta.number === SLOT)?.status).toBe("approved");
    } finally {
      await rm(fixture.root, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("(Task13 closure A) audit-REVISED prose re-settles DEFERRED and still publishes source26/effective27", async () => {
    // head26/prefix25. The audit cycle rewrites the draft, which strips the
    // initial settlement payload — the pipeline MUST re-settle the FINAL
    // revised prose through the DEFERRED contract (no live application of the
    // source delta against confirmed head 26) and still publish
    // source26/effective27 bound to the final prose.
    const fixture = await seedPostCorrectionBook();
    try {
      const canonBefore = await readStoryCanon(fixture.bookDir);
      const slot26Before = await captureSlot26(fixture.bookDir);
      const runner = new PipelineRunner({
        client: CLIENT,
        model: "test-model",
        projectRoot: fixture.root,
      } as unknown as ConstructorParameters<typeof PipelineRunner>[0]);

      vi.spyOn(PlannerAgent.prototype, "planChapter").mockImplementation(async (input) => ({
        intent: { chapter: input.chapterNumber, goal: "test goal", mustKeep: [], mustAvoid: [], styleEmphasis: [] },
        memo: {
          chapter: input.chapterNumber, goal: "test goal",
          isGoldenOpening: false, body: "", threadRefs: [] as string[],
        },
        intentMarkdown: "# Chapter Intent\n\n## Goal\ntest goal\n",
        plannerInputs: [],
        runtimePath: "",
      }));
      vi.spyOn(FoundationReviewerAgent.prototype, "review").mockResolvedValue({
        passed: true, totalScore: 85, dimensions: [], overallFeedback: "auto-pass",
      });
      vi.spyOn(StateValidatorAgent.prototype, "validate").mockResolvedValue({
        warnings: [], passed: true,
      });

      // Draft vs revised final prose — same byte length so the length budget
      // never interferes with the pass/fail branching under test.
      const DRAFT_26 = "mock_text";
      const REVISED_26 = "mock_text";
      expect(DRAFT_26.length).toBe(REVISED_26.length);

      vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockImplementation(
        async (_bookDir, content) => (content as string) === REVISED_26
          ? { passed: true, issues: [], summary: "revised-clean", overallScore: 92, tokenUsage: ZERO_USAGE }
          : {
              passed: false,
              issues: [{ severity: "warning", category: "style", description: "mock_text", suggestion: "mock_text" }],
              summary: "needs polish", overallScore: 40, tokenUsage: ZERO_USAGE,
            },
      );
      vi.spyOn(ReviserAgent.prototype, "reviseChapter").mockImplementation(
        async (_bookDir, _chapterContent) => ({
          revisedContent: REVISED_26,
          wordCount: REVISED_26.length,
          fixedIssues: [],
          tokenUsage: ZERO_USAGE,
        }),
      );
      // Prose rewrite strips the settlement payload in production
      // (buildPersistenceOutput re-analyzes); mirror that here.
      vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockImplementation(
        async (input) => stubWriterOutput26({
          title: "mock_text",
          content: input.chapterContent,
          wordCount: input.chapterContent.length,
        }),
      );

      // Initial governed draft carries NO proposal delta at all.
      const capturedWriteInputs: Array<Parameters<WriterAgent["writeChapter"]>[0]> = [];
      const writerSpy = vi.spyOn(WriterAgent.prototype, "writeChapter").mockImplementation(
        async (input) => {
          capturedWriteInputs.push(input);
          return stubWriterOutput26({ content: DRAFT_26, wordCount: DRAFT_26.length });
        },
      );
      // The REAL production Settler seam behind settleChapterState: emits the
      // source-oriented proposal for whatever FINAL prose it is handed.
      const settleInputs: Array<string> = [];
      const settleTarget = WriterAgent.prototype as unknown as {
        settle: (params: unknown) => Promise<unknown>;
      };
      const settleSpy = vi.spyOn(settleTarget, "settle").mockImplementation(async (params) => {
        const p = params as { content?: string };
        settleInputs.push(p.content ?? "");
        return {
          settlement: {
            runtimeStateDelta: sourceDelta26(),
            updatedState: "# mock_text\n\n- mock_text\n",
            updatedHooks: "# mock_text\n",
          },
          usage: ZERO_USAGE,
        };
      });

      const result = await runner.writeNextChapter(fixture.bookId, DRAFT_26.length);

      // Final-prose re-settlement ran exactly once over the REVISED bytes…
      expect(settleInputs).toEqual([REVISED_26]);
      expect(result.status).toBe("needs-state-review");
      expect(writerSpy).toHaveBeenCalledTimes(1);
      expect(capturedWriteInputs[0]?.deferStateApplication).toBe(true);
      expect(settleSpy).toHaveBeenCalledTimes(1);

      // …and stayed DEFERRED: live Canon untouched before human review.
      const canonAfterPublish = await readStoryCanon(fixture.bookDir);
      expect(canonAfterPublish.revision).toBe(canonBefore.revision);
      expect(canonAfterPublish.manifest.lastAppliedChapter).toBe(SLOT);
      await expect(readFile(join(
        fixture.bookDir, "story", "snapshots", String(NEXT_SLOT), "state", "manifest.json",
      ), "utf-8")).rejects.toMatchObject({ code: "ENOENT" });

      // ACTIVE review anchors source26/effective27 and binds the FINAL
      // DURABLE prose bytes (file content as persisted).
      const rawArtifact = JSON.parse(await readFile(
        join(fixture.bookDir, ACTIVE_REVIEW_RELPATH(SLOT)), "utf-8",
      ));
      expect(rawArtifact.status).toBe("active");
      expect(rawArtifact.sourceChapter).toBe(SLOT);
      expect(rawArtifact.effectiveChapter).toBe(NEXT_SLOT); // literal 27
      expect(rawArtifact.baseCanonRevision).toBe(canonBefore.revision);
      const durableProseName = (await readdir(join(fixture.bookDir, "chapters")))
        .find((name) => name.startsWith("0026_"))!;
      const durableProse = await readFile(join(fixture.bookDir, "chapters", durableProseName), "utf-8");
      expect(durableProse).toContain(REVISED_26);
      expect(rawArtifact.proseRevision).toBe(computeProseRevision(durableProse));

      // Human review then DIRECT confirm lands slot 27 — no rebuild detour.
      let revision = rawArtifact.reviewRevision as number;
      for (const item of rawArtifact.items) {
        await decideStateReviewItem({
          bookDir: fixture.bookDir, chapter: SLOT, itemId: item.id,
          decision: "accept", expectedReviewRevision: revision,
        });
        revision += 1;
      }
      const result12 = await confirmStateReview({
        bookDir: fixture.bookDir, chapter: SLOT, reviewId: rawArtifact.reviewId,
        expectedReviewRevision: revision,
      });
      expect(result12.status).toBe("resolved");
      expect(result12.warnings).toEqual([]);
      const canonFinal = await readStoryCanon(fixture.bookDir);
      expect(canonFinal.manifest.lastAppliedChapter).toBe(NEXT_SLOT);
      expect(canonFinal.currentState.chapter).toBe(NEXT_SLOT);
      expect(result12.resultingCanonRevision).toBe(canonFinal.revision);
      const snap27 = StateManifestSchema.parse(JSON.parse(await readFile(
        join(fixture.bookDir, "story", "snapshots", String(NEXT_SLOT), "state", "manifest.json"),
        "utf-8",
      )));
      expect(snap27.lastAppliedChapter).toBe(NEXT_SLOT);
      expect(await captureSlot26(fixture.bookDir)).toEqual(slot26Before);
    } finally {
      await rm(fixture.root, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("(Task13 closure B) audit-FAILED governed persistence keeps the proposal unapplied", async () => {
    // head26/prefix25, governed write emits a source delta26, audit fails ⇒
    // non-publishable persistence must NOT rebuild/apply the delta against
    // live head 26 ("delta chapter 26 goes backwards") and must not publish
    // any State Review artifact or advance any semantic snapshot.
    const fixture = await seedPostCorrectionBook();
    try {
      const canonBefore = await readStoryCanon(fixture.bookDir);
      const slot26Before = await captureSlot26(fixture.bookDir);
      const tailBefore = await captureTailProse(fixture.bookDir);
      const runner = new PipelineRunner({
        client: CLIENT,
        model: "test-model",
        projectRoot: fixture.root,
      } as unknown as ConstructorParameters<typeof PipelineRunner>[0]);

      vi.spyOn(PlannerAgent.prototype, "planChapter").mockImplementation(async (input) => ({
        intent: { chapter: input.chapterNumber, goal: "test goal", mustKeep: [], mustAvoid: [], styleEmphasis: [] },
        memo: {
          chapter: input.chapterNumber, goal: "test goal",
          isGoldenOpening: false, body: "", threadRefs: [] as string[],
        },
        intentMarkdown: "# Chapter Intent\n\n## Goal\ntest goal\n",
        plannerInputs: [],
        runtimePath: "",
      }));
      vi.spyOn(FoundationReviewerAgent.prototype, "review").mockResolvedValue({
        passed: true, totalScore: 85, dimensions: [], overallFeedback: "auto-pass",
      });
      vi.spyOn(StateValidatorAgent.prototype, "validate").mockResolvedValue({
        warnings: [], passed: true,
      });
      vi.spyOn(ReviserAgent.prototype, "reviseChapter").mockImplementation(
        async (_bookDir, chapterContent) => ({
          revisedContent: chapterContent,
          wordCount: chapterContent.length,
          fixedIssues: [],
          tokenUsage: ZERO_USAGE,
        }),
      );
      vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue({
        passed: false,
        issues: [{ severity: "critical", category: "continuity", description: "mock_text", suggestion: "mock_text" }],
        summary: "broken timeline", overallScore: 30, tokenUsage: ZERO_USAGE,
      });
      const capturedWriteInputs: Array<Parameters<WriterAgent["writeChapter"]>[0]> = [];
      vi.spyOn(WriterAgent.prototype, "writeChapter").mockImplementation(async (input) => {
        capturedWriteInputs.push(input);
        return stubWriterOutput26({ runtimeStateDelta: sourceDelta26() });
      });

      const result = await runner.writeNextChapter(fixture.bookId, BODY_26.length);

      // Existing Task7 policy preserved: failed audit stays non-publishable…
      expect(capturedWriteInputs[0]?.deferStateApplication).toBe(true);
      expect(result.status).toBe("audit-failed");
      // …the prose itself IS durable…
      const proseName = (await readdir(join(fixture.bookDir, "chapters")))
        .find((name) => name.startsWith("0026_"))!;
      expect(await readFile(join(fixture.bookDir, "chapters", proseName), "utf-8"))
        .toContain(BODY_26);
      const index = ChapterMetaSchema.array().parse(JSON.parse(
        await readFile(join(fixture.bookDir, "chapters", "index.json"), "utf-8"),
      ));
      expect(index.find((meta) => meta.number === SLOT)?.status).toBe("audit-failed");
      // …but NO semantic mutation happened anywhere:
      const canonAfter = await readStoryCanon(fixture.bookDir);
      expect(canonAfter.revision).toBe(canonBefore.revision);
      expect(canonAfter.manifest.lastAppliedChapter).toBe(SLOT);
      expect(await loadStateReview(fixture.bookDir, SLOT)).toBeNull();
      await expect(readFile(join(
        fixture.bookDir, "story", "snapshots", String(NEXT_SLOT), "state", "manifest.json",
      ), "utf-8")).rejects.toMatchObject({ code: "ENOENT" });
      expect(await captureSlot26(fixture.bookDir)).toEqual(slot26Before);
      expect(await captureTailProse(fixture.bookDir)).toEqual(tailBefore);
    } finally {
      await rm(fixture.root, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
