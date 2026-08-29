import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PipelineRunner } from "../pipeline/runner.js";
import { StateManager } from "../state/manager.js";
import * as atomicFileSetModule from "../utils/atomic-file-set.js";
import { PlannerAgent } from "../agents/planner.js";
import { FoundationReviewerAgent } from "../agents/foundation-reviewer.js";
import { WriterAgent } from "../agents/writer.js";
import { ContinuityAuditor } from "../agents/continuity.js";
import { ReviserAgent } from "../agents/reviser.js";
import { ChapterAnalyzerAgent } from "../agents/chapter-analyzer.js";
import { StateValidatorAgent } from "../agents/state-validator.js";
import { ChapterStatusSchema } from "../models/chapter.js";
import { StateReviewArtifactSchema, StateReviewError, type ActiveStateReviewArtifact } from "../models/state-review.js";
import { ACTIVE_REVIEW_RELPATH } from "../state/state-review-store.js";
import { readStoryCanon } from "../state/canon-service.js";
import { computeProseRevision } from "../utils/prose-revision.js";
import { buildStateReviewItems } from "../state/state-review-items.js";
import { captureBookMetadata } from "./helpers/canon-fixture.js";
import type { BookConfig } from "../models/book.js";
import type { AuditResult } from "../agents/continuity.js";
import type { WriteChapterOutput } from "../agents/writer.js";

// ---------------------------------------------------------------------------
// Capture/failure-injection seam over the REAL commitAtomicFileSet (same
// convention as writer.deferred-save.test.ts): records every invocation,
// delegates to the actual implementation unless a rename injection is armed.
// ---------------------------------------------------------------------------

const seam = vi.hoisted(() => ({
  renameInjection: undefined as undefined | ((from: string, to: string) => Promise<void>),
  invocations: [] as Array<atomicFileSetModule.AtomicFileSet>,
}));

vi.mock("../utils/atomic-file-set.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/atomic-file-set.js")>();
  return {
    ...actual,
    async commitAtomicFileSet(input: atomicFileSetModule.AtomicFileSet) {
      seam.invocations.push(input);
      return actual.commitAtomicFileSet({
        ...input,
        ...(seam.renameInjection ? { renameFile: seam.renameInjection } : {}),
      });
    },
  };
});

const ZERO_USAGE = { promptTokens: 0, completionTokens: 0, totalTokens: 0 } as const;

function passingAudit(): AuditResult {
  return { passed: true, issues: [], summary: "clean", overallScore: 95, tokenUsage: ZERO_USAGE };
}

const CHAPTER_BODY = "林秋在雨夜重新核对了账本的真实去向";

function gatedDelta(chapter = 1) {
  return {
    chapter,
    currentStatePatch: { currentGoal: "PROPOSED-GOAL-B" },
    hookOps: { upsert: [], mention: [], resolve: [], defer: [] },
    newHookCandidates: [],
    subplotOps: [],
    emotionalArcOps: [],
    characterMatrixOps: [],
    notes: [],
  };
}

function zeroProposalDelta(chapter = 1) {
  return {
    chapter,
    hookOps: { upsert: [], mention: [], resolve: [], defer: [] },
    newHookCandidates: [],
    subplotOps: [],
    emotionalArcOps: [],
    characterMatrixOps: [],
    notes: [],
  };
}

function stubOutput(overrides: Partial<WriteChapterOutput> = {}): WriteChapterOutput {
  return {
    chapterNumber: 1,
    title: "雨夜提案",
    content: CHAPTER_BODY,
    wordCount: CHAPTER_BODY.length,
    preWriteCheck: "",
    postSettlement: "",
    updatedState: "# 当前状态\n\n- PROPOSED-STATE-B\n",
    updatedHooks: "# 伏笔池\n",
    updatedLedger: "# 粒子账本\n",
    updatedSubplots: "# 支线进度\n",
    updatedEmotionalArcs: "# 情感弧线\n",
    updatedCharacterMatrix: "# 角色矩阵\n",
    chapterSummary: "| 1 | 雨夜提案 | 林秋 | 核对账本 | 起疑 | | 平静 | 调查 |",
    postWriteErrors: [],
    postWriteWarnings: [],
    tokenUsage: ZERO_USAGE,
    ...overrides,
  };
}

function expectActive(artifact: ReturnType<typeof StateReviewArtifactSchema.parse>): ActiveStateReviewArtifact {
  if (artifact.status !== "active") throw new Error(`expected active artifact, got ${artifact.status}`);
  return artifact;
}

function normalizePaths(input: atomicFileSetModule.AtomicFileSet): string[] {
  return input.writes.map((entry) => entry.relativePath.replace(/\\/g, "/"));
}

/** Hash+size view of a whole-tree capture: content identity without mtimes
 * (idempotent bootstrap rewrites may legitimately touch timestamps).
 * `exclude` carves out derived telemetry paths from the comparison. */
function contentFingerprint(
  metadata: Record<string, { readonly sha256: string; readonly size: number }>,
  exclude?: (key: string) => boolean,
) {
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([key]) => !exclude?.(key.replace(/\\/g, "/")))
      .map(([key, value]) => [key, `${value.size}:${value.sha256}`]),
  );
}

async function createGatedFixture() {
  const root = await mkdtemp(join(tmpdir(), "castor-gated-test-"));
  const state = new StateManager(root);
  const bookId = "test-book";
  const now = "2026-03-19T00:00:00.000Z";
  const book: BookConfig = {
    id: bookId,
    title: "Test Book",
    platform: "tomato",
    genre: "xuanhuan",
    language: "zh",
    status: "active",
    targetChapters: 10,
    chapterWordCount: 3000,
    createdAt: now,
    updatedAt: now,
  };
  await state.saveBookConfig(bookId, book);
  const bookDir = state.bookDir(bookId);

  // Empty-but-valid v2 structured Canon A (nothing applied yet).
  const stateDir = join(bookDir, "story", "state");
  await mkdir(stateDir, { recursive: true });
  await mkdir(join(bookDir, "chapters"), { recursive: true });
  const canonA: Record<string, string> = {
    "manifest.json": JSON.stringify({
      schemaVersion: 2, language: "zh", lastAppliedChapter: 0, projectionVersion: 1, migrationWarnings: [],
    }, null, 2),
    "current_state.json": JSON.stringify({ chapter: 0, facts: [] }, null, 2),
    "hooks.json": JSON.stringify({ hooks: [] }, null, 2),
    "chapter_summaries.json": JSON.stringify({ rows: [] }, null, 2),
  };
  for (const [name, content] of Object.entries(canonA)) {
    await writeFile(join(stateDir, name), content, "utf-8");
  }
  const projectionSeeds = new Map<string, string>([
    // No trailing newline: persistAuditDriftGuidance sanitizes current_state.md
    // with trimEnd(), and a no-op must remain a no-op byte-for-byte.
    ["current_state.md", "# 当前状态"],
    ["pending_hooks.md", "# 伏笔池"],
  ]);
  for (const [name, content] of projectionSeeds) {
    await writeFile(join(bookDir, "story", name), content, "utf-8");
  }

  const runner = new PipelineRunner({
    client: {
      provider: "openai",
      apiFormat: "chat",
      stream: false,
      defaults: { temperature: 0.7, maxTokens: 4096, thinkingBudget: 0 },
    } as ConstructorParameters<typeof PipelineRunner>[0]["client"],
    model: "test-model",
    projectRoot: root,
  });

  // Warm up every idempotent bootstrap side effect (control documents,
  // structured-state bootstrap manifest normalization) so later whole-tree
  // captures are stable. The second call converges normalized rewrites.
  await state.ensureControlDocuments(bookId);
  await state.getNextChapterNumber(bookId);
  await state.getNextChapterNumber(bookId);
  // Fail fast if the seeded Canon is not valid for pure reads.
  await readStoryCanon(bookDir);

  seam.invocations.length = 0;
  seam.renameInjection = undefined;
  return { root, runner, state, bookId, bookDir };
}

describe("PipelineRunner gated Phase 4 publication", () => {
  beforeEach(() => {
    vi.spyOn(PlannerAgent.prototype, "planChapter").mockImplementation(async (input) => {
      const memo = {
        chapter: input.chapterNumber,
        goal: "test goal",
        isGoldenOpening: false,
        body: "",
        threadRefs: [] as string[],
      };
      return {
        intent: { chapter: input.chapterNumber, goal: "test goal", mustKeep: [], mustAvoid: [], styleEmphasis: [] },
        memo,
        intentMarkdown: "# Chapter Intent\n\n## Goal\ntest goal\n",
        plannerInputs: [],
        runtimePath: "",
      };
    });
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
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(passingAudit());
    vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockImplementation(async (input) => ({
      chapterNumber: input.chapterNumber,
      title: input.chapterTitle ?? "雨夜提案",
      content: input.chapterContent,
      wordCount: input.chapterContent.length,
      preWriteCheck: "",
      postSettlement: "",
      updatedState: "# 当前状态\n\n- PROPOSED-STATE-B\n",
      updatedHooks: "# 伏笔池\n",
      updatedLedger: "# 粒子账本\n",
      updatedSubplots: "# 支线进度\n",
      updatedEmotionalArcs: "# 情感弧线\n",
      updatedCharacterMatrix: "# 角色矩阵\n",
      chapterSummary: "| 1 | 雨夜提案 | 林秋 | 核对账本 | 起疑 | | 平静 | 调查 |",
      postWriteErrors: [],
      postWriteWarnings: [],
      tokenUsage: ZERO_USAGE,
      runtimeStateDelta: gatedDelta(input.chapterNumber),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ChapterStatusSchema accepts needs-state-review alongside legacy statuses", () => {
    expect(ChapterStatusSchema.safeParse("needs-state-review").success).toBe(true);
    expect(ChapterStatusSchema.safeParse("ready-for-review").success).toBe(true);
    expect(ChapterStatusSchema.safeParse("approved").success).toBe(true);
  });

  it("gated generation publishes prose + active review + gated index in ONE atomic set while Canon stays at A", async () => {
    const { root, runner, bookId, bookDir } = await createGatedFixture();
    const canonBefore = await readStoryCanon(bookDir);
    const canonJsonBefore = await readFile(join(bookDir, "story", "state", "current_state.json"), "utf-8");
    const stateProjectionBefore = await readFile(join(bookDir, "story", "current_state.md"), "utf-8");
    const hooksProjectionBefore = await readFile(join(bookDir, "story", "pending_hooks.md"), "utf-8");
    const summariesJsonBefore = await readFile(join(bookDir, "story", "state", "chapter_summaries.json"), "utf-8");
    const writeSpy = vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      stubOutput({ runtimeStateDelta: gatedDelta() }),
    );
    const writerSaveSpy = vi.spyOn(WriterAgent.prototype, "saveChapter");
    const saveIndexSpy = vi.spyOn(StateManager.prototype, "saveChapterIndex");
    const snapshotSpy = vi.spyOn(StateManager.prototype, "snapshotState");

    try {
      const result = await runner.writeNextChapter(bookId, CHAPTER_BODY.length);

      expect(result.status).toBe("needs-state-review");
      expect(writeSpy).toHaveBeenCalledTimes(1);

      // Prose persisted exactly once at the canonical path.
      const durableProse = await readFile(join(bookDir, "chapters", "0001_雨夜提案.md"), "utf-8");
      expect(durableProse).toContain(CHAPTER_BODY);

      // Index on disk is gated IMMEDIATELY after the single commit.
      const savedIndex = JSON.parse(
        await readFile(join(bookDir, "chapters", "index.json"), "utf-8"),
      ) as Array<{ number: number; status: string }>;
      expect(savedIndex).toHaveLength(1);
      expect(savedIndex[0]).toMatchObject({ number: 1, status: "needs-state-review" });

      // Active artifact exists, parses, and anchors correctly.
      const artifact = expectActive(StateReviewArtifactSchema.parse(
        JSON.parse(await readFile(join(bookDir, ACTIVE_REVIEW_RELPATH(1)), "utf-8")),
      ));
      expect(artifact.sourceChapter).toBe(1);
      expect(artifact.effectiveChapter).toBe(1);
      expect(artifact.reviewRevision).toBe(1);
      expect(artifact.language).toBe("zh");
      expect(artifact.reviewId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(artifact.proseRevision).toBe(computeProseRevision(durableProse));
      expect(artifact.baseCanonRevision).toBe(canonBefore.revision);
      expect(artifact.items).toEqual(
        buildStateReviewItems(gatedDelta(), { chapterContent: durableProse, language: "zh" }),
      );
      expect(artifact.items.length).toBeGreaterThan(0);
      for (const item of artifact.items) {
        expect(item.origin).toBe("ai");
        expect(item.decision).toBe("undecided");
      }

      // Canon A untouched — byte-level, structured JSON AND projections.
      expect(await readFile(join(bookDir, "story", "state", "current_state.json"), "utf-8"))
        .toBe(canonJsonBefore);
      expect(canonJsonBefore).not.toContain("PROPOSED-GOAL-B");
      expect(await readFile(join(bookDir, "story", "state", "chapter_summaries.json"), "utf-8"))
        .toBe(summariesJsonBefore);
      expect(await readFile(join(bookDir, "story", "current_state.md"), "utf-8"))
        .toBe(stateProjectionBefore);
      expect(await readFile(join(bookDir, "story", "pending_hooks.md"), "utf-8"))
        .toBe(hooksProjectionBefore);
      const canonAfter = await readStoryCanon(bookDir);
      expect(canonAfter.revision).toBe(canonBefore.revision);

      // Exactly ONE authoritative WRITER transaction carrying all three
      // payloads; unrelated runner telemetry may use its own commits.
      const writerCommits = seam.invocations.filter((invocation) =>
        normalizePaths(invocation).some((path) => path.startsWith("chapters/")));
      expect(writerCommits).toHaveLength(1);
      const paths = normalizePaths(writerCommits[0]!);
      expect(paths).toContain("chapters/0001_雨夜提案.md");
      expect(paths).toContain("chapters/index.json");
      expect(paths).toContain(ACTIVE_REVIEW_RELPATH(1));

      // No second index write; no proposed-state snapshot; Writer got the
      // deferred trio through its Task 6 options (m-A caller invariant).
      expect(saveIndexSpy).not.toHaveBeenCalled();
      expect(snapshotSpy).not.toHaveBeenCalled();
      await expect(stat(join(bookDir, "story", "snapshots"))).rejects.toMatchObject({ code: "ENOENT" });
      expect(writerSaveSpy).toHaveBeenCalledTimes(1);
      const options = writerSaveSpy.mock.calls[0]![4];
      expect(options?.deferStateApplication).toBe(true);
      expect(options?.stateReviewJson).toBeDefined();
      expect(options?.updatedChapterIndexJson).toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("baseCanonRevision equals the live Canon revision immediately before publication", async () => {
    const { root, runner, bookId, bookDir } = await createGatedFixture();
    const before = await readStoryCanon(bookDir);
    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      stubOutput({ runtimeStateDelta: gatedDelta() }),
    );
    try {
      await runner.writeNextChapter(bookId, CHAPTER_BODY.length);
      const after = await readStoryCanon(bookDir);
      const artifact = expectActive(StateReviewArtifactSchema.parse(
        JSON.parse(await readFile(join(bookDir, ACTIVE_REVIEW_RELPATH(1)), "utf-8")),
      ));
      expect(artifact.baseCanonRevision).toBe(before.revision);
      expect(after.revision).toBe(before.revision);
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("zero-proposal Settler output STILL produces an active zero-item review and stays gated", async () => {
    const { root, runner, bookId, bookDir } = await createGatedFixture();
    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      stubOutput({
        runtimeStateDelta: zeroProposalDelta(),
        updatedState: "# 当前状态\n",
        chapterSummary: "| 1 | 雨夜提案 | 林秋 | 核对账本 | 无变化 | | 平静 | 调查 |",
      }),
    );
    vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockImplementation(async (input) => ({
      chapterNumber: input.chapterNumber,
      title: input.chapterTitle ?? "雨夜提案",
      content: input.chapterContent,
      wordCount: input.chapterContent.length,
      preWriteCheck: "",
      postSettlement: "",
      updatedState: "# 当前状态\n",
      updatedHooks: "# 伏笔池\n",
      updatedLedger: "# 粒子账本\n",
      updatedSubplots: "# 支线进度\n",
      updatedEmotionalArcs: "# 情感弧线\n",
      updatedCharacterMatrix: "# 角色矩阵\n",
      chapterSummary: "| 1 | 雨夜提案 | 林秋 | 核对账本 | 无变化 | | 平静 | 调查 |",
      postWriteErrors: [],
      postWriteWarnings: [],
      tokenUsage: ZERO_USAGE,
      runtimeStateDelta: zeroProposalDelta(),
    }));
    try {
      const result = await runner.writeNextChapter(bookId, CHAPTER_BODY.length);
      expect(result.status).toBe("needs-state-review");
      const savedIndex = JSON.parse(
        await readFile(join(bookDir, "chapters", "index.json"), "utf-8"),
      ) as Array<{ status: string }>;
      expect(savedIndex[0]!.status).toBe("needs-state-review");
      const artifact = expectActive(StateReviewArtifactSchema.parse(
        JSON.parse(await readFile(join(bookDir, ACTIVE_REVIEW_RELPATH(1)), "utf-8")),
      ));
      expect(artifact.items).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("blocked advancement prevents ANY generation work: gate precedes Writer/planner and leaves the tree untouched", async () => {
    const { root, runner, state, bookId, bookDir } = await createGatedFixture();
    await writeFile(
      join(bookDir, "chapters", "index.json"),
      JSON.stringify([{
        number: 1, title: "旧档与新伤", status: "ready-for-review", wordCount: 100,
        createdAt: "2026-03-19T00:00:00.000Z", updatedAt: "2026-03-19T00:00:00.000Z",
        auditIssues: [], lengthWarnings: [],
      }], null, 2),
      "utf-8",
    );
    await writeFile(join(bookDir, "chapters", "0001_旧档与新伤.md"), "# 第1章 旧档与新伤\n\n正文。", "utf-8");
    // Re-converge idempotent bootstrap state (manifest.lastAppliedChapter now
    // reflects the seeded durable chapter file) BEFORE capturing the baseline.
    await state.getNextChapterNumber(bookId);
    await state.getNextChapterNumber(bookId);
    const before = await captureBookMetadata(root);
    const writeSpy = vi.spyOn(WriterAgent.prototype, "writeChapter");
    const plannerSpy = vi.spyOn(PlannerAgent.prototype, "planChapter");

    try {
      await expect(runner.writeNextChapter(bookId)).rejects.toThrow(StateReviewError);
      await expect(runner.writeNextChapter(bookId)).rejects.toThrow(/State Review/);
      expect(writeSpy).not.toHaveBeenCalled();
      expect(plannerSpy).not.toHaveBeenCalled();
      // Derived run-telemetry (chapter-N.run.json) is written by the runner's
      // own bookkeeping BEFORE the gate; it is not authoritative state.
      const runTelemetry = (key: string) =>
        /\/story\/runtime\/chapter-\d+\.run\.json$/.test(key) || key === "books/test-book/story/memory.db";
      const afterFp = contentFingerprint(await captureBookMetadata(root), runTelemetry);
      const beforeFp = contentFingerprint(before, runTelemetry);
      expect(afterFp).toEqual(beforeFp);
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("after publishing chapter N as needs-state-review, normal N+1 advancement is BLOCKED by N's review", async () => {
    const { root, runner, bookId, bookDir } = await createGatedFixture();
    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      stubOutput({ runtimeStateDelta: gatedDelta() }),
    );
    try {
      await runner.writeNextChapter(bookId, CHAPTER_BODY.length);
      const artifactBefore = await readFile(join(bookDir, ACTIVE_REVIEW_RELPATH(1)), "utf-8");
      const indexBefore = await readFile(join(bookDir, "chapters", "index.json"), "utf-8");

      await expect(runner.writeNextChapter(bookId, CHAPTER_BODY.length)).rejects.toThrow(StateReviewError);

      // Nothing moved: artifact, gated index, and no second prose file.
      expect(await readFile(join(bookDir, ACTIVE_REVIEW_RELPATH(1)), "utf-8")).toBe(artifactBefore);
      expect(await readFile(join(bookDir, "chapters", "index.json"), "utf-8")).toBe(indexBefore);
      const chapterFiles = (await readdir(join(bookDir, "chapters"))).filter((f) => f.endsWith(".md"));
      expect(chapterFiles).toEqual(["0001_雨夜提案.md"]);
      expect(vi.mocked(WriterAgent.prototype.writeChapter).mock.calls).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("mid-set rename failure during gated publication leaks NOTHING and preserves old state", async () => {
    const { root, runner, bookId, bookDir } = await createGatedFixture();
    // Old authoritative index exists BEFORE publication.
    await writeFile(join(bookDir, "chapters", "index.json"), "[]", "utf-8");
    const before = await captureBookMetadata(root);

    let renameCalls = 0;
    seam.renameInjection = async (from: string, to: string) => {
      renameCalls += 1;
      if (renameCalls === 2) throw new Error("injected mid-set rename failure");
      await (await import("node:fs/promises")).rename(from, to);
    };
    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      stubOutput({ runtimeStateDelta: gatedDelta() }),
    );

    try {
      await expect(runner.writeNextChapter(bookId, CHAPTER_BODY.length))
        .rejects.toThrow(/injected mid-set rename failure/);
      expect(renameCalls).toBeGreaterThanOrEqual(2);
      // Content identity outside derived runtime working files (governed-plan
      // artifacts are legitimate pre-commit telemetry); the State Review
      // artifact absence is asserted explicitly below.
      const runtimeWorkingFiles = (key: string) =>
        key.includes("/story/runtime/") || key === "books/test-book/story/memory.db";
      const afterFp = contentFingerprint(await captureBookMetadata(root), runtimeWorkingFiles);
      const beforeFp = contentFingerprint(before, runtimeWorkingFiles);
      expect(afterFp).toEqual(beforeFp);
      const residue = (await readdir(bookDir)).filter((name) => name.startsWith(".castor-file-txn-"));
      expect(residue).toEqual([]);
      await expect(readFile(join(bookDir, ACTIVE_REVIEW_RELPATH(1)), "utf-8"))
        .rejects.toMatchObject({ code: "ENOENT" });
      expect(JSON.parse(await readFile(join(bookDir, "chapters", "index.json"), "utf-8"))).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("governed passed-audit chapter with MISSING Settler delta FAILS CLOSED before any authoritative write", async () => {
    const { root, runner, bookId, bookDir } = await createGatedFixture();
    const canonJsonBefore = await readFile(join(bookDir, "story", "state", "current_state.json"), "utf-8");
    const projectionBefore = await readFile(join(bookDir, "story", "current_state.md"), "utf-8");
    // NO runtimeStateDelta anywhere: governed run cannot build a proposal.
    const writeSpy = vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(stubOutput());
    const writerSaveSpy = vi.spyOn(WriterAgent.prototype, "saveChapter");
    const saveIndexSpy = vi.spyOn(StateManager.prototype, "saveChapterIndex");
    const snapshotSpy = vi.spyOn(StateManager.prototype, "snapshotState");

    try {
      await expect(runner.writeNextChapter(bookId, CHAPTER_BODY.length))
        .rejects.toThrow(/state review proposal/i);

      // Fail closed: zero authoritative or derived state mutation.
      expect(writeSpy).toHaveBeenCalledTimes(1);
      expect(writerSaveSpy).not.toHaveBeenCalled();
      expect(saveIndexSpy).not.toHaveBeenCalled();
      expect(snapshotSpy).not.toHaveBeenCalled();
      await expect(readFile(join(bookDir, ACTIVE_REVIEW_RELPATH(1)), "utf-8"))
        .rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(join(bookDir, "chapters", "index.json"), "utf-8"))
        .rejects.toMatchObject({ code: "ENOENT" });
      await expect(stat(join(bookDir, "story", "snapshots"))).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(join(bookDir, "story", "state", "current_state.json"), "utf-8"))
        .toBe(canonJsonBefore);
      expect(await readFile(join(bookDir, "story", "current_state.md"), "utf-8"))
        .toBe(projectionBefore);
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("audit-REVISED prose re-settles the FINAL content into gated State Review publication (C-1)", async () => {
    const { root, runner, bookId, bookDir } = await createGatedFixture();
    const P1 = "林秋在雨夜核对了账本";
    const P2 = "林秋在黎明烧毁了账本";
    const canonJsonBefore = await readFile(join(bookDir, "story", "state", "current_state.json"), "utf-8");
    const projectionBefore = await readFile(join(bookDir, "story", "current_state.md"), "utf-8");
    const hooksProjectionBefore = await readFile(join(bookDir, "story", "pending_hooks.md"), "utf-8");

    // P1 carries the STALE proposal (Paris). The revision changes the story so
    // a stale D1 would be detectable. The analyzer mock mirrors the REAL
    // parser contract: it produces truth-file markdown but NO delta field.
    const staleDelta = { ...gatedDelta(), currentStatePatch: { currentGoal: "前往巴黎核对账本" } };
    const finalDelta = { ...gatedDelta(), currentStatePatch: { currentGoal: "留守伦敦追查遗嘱" } };
    const writeSpy = vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      stubOutput({ content: P1, wordCount: P1.length, runtimeStateDelta: staleDelta }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter")
      .mockResolvedValueOnce({
        passed: false,
        issues: [{ severity: "critical", category: "continuity", description: "rewrite the ending", suggestion: "revise" }],
        summary: "needs revision",
        overallScore: 40,
        tokenUsage: ZERO_USAGE,
      })
      .mockResolvedValue(passingAudit());
    vi.spyOn(ReviserAgent.prototype, "reviseChapter").mockResolvedValue({
      revisedContent: P2,
      wordCount: P2.length,
      fixedIssues: ["rewrote the ending"],
      tokenUsage: ZERO_USAGE,
    });
    vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockImplementation(async (input) => ({
      chapterNumber: input.chapterNumber,
      title: input.chapterTitle ?? "雨夜提案",
      content: input.chapterContent,
      wordCount: input.chapterContent.length,
      preWriteCheck: "",
      postSettlement: "",
      updatedState: "# 当前状态\n\n- PROPOSED-STATE-B\n",
      updatedHooks: "# 伏笔池\n",
      updatedLedger: "# 粒子账本\n",
      updatedSubplots: "# 支线进度\n",
      updatedEmotionalArcs: "# 情感弧线\n",
      updatedCharacterMatrix: "# 角色矩阵\n",
      chapterSummary: "| 1 | 雨夜提案 | 林秋 | 烧毁账本 | 起疑 | | 平静 | 调查 |",
      postWriteErrors: [],
      postWriteWarnings: [],
      tokenUsage: ZERO_USAGE,
    }));
    const settleSpy = vi.spyOn(WriterAgent.prototype, "settleChapterState").mockResolvedValue(
      stubOutput({ content: P2, wordCount: P2.length, runtimeStateDelta: finalDelta }),
    );
    const writerSaveSpy = vi.spyOn(WriterAgent.prototype, "saveChapter");
    const saveIndexSpy = vi.spyOn(StateManager.prototype, "saveChapterIndex");
    const snapshotSpy = vi.spyOn(StateManager.prototype, "snapshotState");

    try {
      const result = await runner.writeNextChapter(bookId, P2.length);

      expect(result.status).toBe("needs-state-review");

      // FINAL prose P2 is what is durable — never P1.
      const durableProse = await readFile(join(bookDir, "chapters", "0001_雨夜提案.md"), "utf-8");
      expect(durableProse).toContain(P2);
      expect(durableProse).not.toContain(P1.replace("。", ""));

      // The re-settlement ran against EXACTLY the final publishable content.
      expect(settleSpy).toHaveBeenCalledTimes(1);
      expect(settleSpy.mock.calls[0]![0].content).toBe(P2);

      // Anchors bind to P2's bytes and D2's semantics — London, not Paris.
      const artifact = expectActive(StateReviewArtifactSchema.parse(
        JSON.parse(await readFile(join(bookDir, ACTIVE_REVIEW_RELPATH(1)), "utf-8")),
      ));
      expect(artifact.proseRevision).toBe(computeProseRevision(durableProse));
      expect(artifact.items).toEqual(
        buildStateReviewItems(finalDelta, { chapterContent: durableProse, language: "zh" }),
      );
      expect(JSON.stringify(artifact.items)).toContain("留守伦敦追查遗嘱");
      expect(JSON.stringify(artifact.items)).not.toContain("前往巴黎核对账本");

      // Canon A untouched; projections untouched; no proposed snapshot.
      expect(await readFile(join(bookDir, "story", "state", "current_state.json"), "utf-8"))
        .toBe(canonJsonBefore);
      expect(await readFile(join(bookDir, "story", "current_state.md"), "utf-8"))
        .toBe(projectionBefore);
      expect(await readFile(join(bookDir, "story", "pending_hooks.md"), "utf-8"))
        .toBe(hooksProjectionBefore);
      expect(saveIndexSpy).not.toHaveBeenCalled();
      expect(snapshotSpy).not.toHaveBeenCalled();

      // One atomic writer commit carrying all three payloads, deferred mode on.
      const writerCommits = seam.invocations.filter((invocation) =>
        normalizePaths(invocation).some((path) => path.startsWith("chapters/")));
      expect(writerCommits).toHaveLength(1);
      const paths = normalizePaths(writerCommits[0]!);
      expect(paths).toContain("chapters/0001_雨夜提案.md");
      expect(paths).toContain("chapters/index.json");
      expect(paths).toContain(ACTIVE_REVIEW_RELPATH(1));
      const options = writerSaveSpy.mock.calls[0]![4];
      expect(options?.deferStateApplication).toBe(true);
      expect(options?.stateReviewJson).toBeDefined();
      expect(options?.updatedChapterIndexJson).toBeDefined();
      void writeSpy;
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("governed passed-audit chapter with an INVALID Settler delta FAILS CLOSED (no legacy application)", async () => {
    const { root, runner, bookId, bookDir } = await createGatedFixture();
    const canonJsonBefore = await readFile(join(bookDir, "story", "state", "current_state.json"), "utf-8");
    const projectionBefore = await readFile(join(bookDir, "story", "current_state.md"), "utf-8");
    // Deliberately SCHEMA-INVALID delta: hookOps.upsert must be an array.
    const malformedDelta = {
      chapter: 1,
      currentStatePatch: { currentGoal: "PROPOSED-GOAL-B" },
      hookOps: { upsert: "natural-language numeric drift", resolve: [], defer: [] },
      newHookCandidates: [],
      notes: [],
    };
    const writeSpy = vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      stubOutput({ runtimeStateDelta: malformedDelta as unknown as WriteChapterOutput["runtimeStateDelta"] }),
    );
    const writerSaveSpy = vi.spyOn(WriterAgent.prototype, "saveChapter");
    const saveIndexSpy = vi.spyOn(StateManager.prototype, "saveChapterIndex");
    const snapshotSpy = vi.spyOn(StateManager.prototype, "snapshotState");

    try {
      await expect(runner.writeNextChapter(bookId, CHAPTER_BODY.length))
        .rejects.toThrow(/state review proposal/i);

      expect(writeSpy).toHaveBeenCalledTimes(1);
      expect(writerSaveSpy).not.toHaveBeenCalled();
      expect(saveIndexSpy).not.toHaveBeenCalled();
      expect(snapshotSpy).not.toHaveBeenCalled();
      await expect(readFile(join(bookDir, ACTIVE_REVIEW_RELPATH(1)), "utf-8"))
        .rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(join(bookDir, "chapters", "index.json"), "utf-8"))
        .rejects.toMatchObject({ code: "ENOENT" });
      await expect(stat(join(bookDir, "story", "snapshots"))).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(join(bookDir, "story", "state", "current_state.json"), "utf-8"))
        .toBe(canonJsonBefore);
      expect(await readFile(join(bookDir, "story", "current_state.md"), "utf-8"))
        .toBe(projectionBefore);
      // No prose leaked either.
      const chapterFiles = (await readdir(join(bookDir, "chapters"))).filter((f) => f.endsWith(".md"));
      expect(chapterFiles).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
