import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PipelineRunner } from "../pipeline/runner.js";
import { StateManager } from "../state/manager.js";
import { PlannerAgent } from "../agents/planner.js";
import { WriterAgent, type WriteChapterOutput } from "../agents/writer.js";
import { ContinuityAuditor, type AuditResult } from "../agents/continuity.js";
import { ChapterAnalyzerAgent } from "../agents/chapter-analyzer.js";
import { StateValidatorAgent } from "../agents/state-validator.js";
import { ReviserAgent } from "../agents/reviser.js";
import { FoundationReviewerAgent } from "../agents/foundation-reviewer.js";
import { createVersionStore, type FoundationPublishedSnapshot } from "../governance/versions.js";
import { commitAtomicFileSet } from "../utils/atomic-file-set.js";
import { type ArcPlanSnapshot } from "../planning/arc-plan.js";
import { loadExecutionSnapshot } from "../execution/snapshot.js";
import { loadExecutionAttempt, listExecutionAttempts } from "../execution/attempt-store.js";
import { loadDetailedPlan } from "../planning/detailed-plan.js";
import { loadAuthorization, type AuthorizationRecord } from "../governance/authorizations.js";
import * as planningGateModule from "../planning/gate.js";
import * as contextBundleModule from "../context/bundle.js";
import * as snapshotModule from "../execution/snapshot.js";
import type { BookConfig } from "../models/book.js";

let root = "";
let state: StateManager;
let bookDir = "";
const bookId = "demo-book";
const canonPath = () => join(bookDir, "story", "state", "manifest.json");

const ZERO_USAGE = { promptTokens: 0, completionTokens: 0, totalTokens: 0 } as const;

function sampleBookConfig(overrides: Partial<BookConfig> = {}): BookConfig {
  return {
    id: bookId,
    title: "Demo Book",
    platform: "other",
    genre: "fantasy",
    status: "active",
    targetChapters: 30,
    chapterWordCount: 2000,
    language: "en",
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
    governance: { foundation: "v2", planning: "v2" },
    ...overrides,
  };
}

function sampleProse(chapter = 1): string {
  return `Chapter ${chapter} Draft\n\nHero entered the shadow fortress silently, avoiding guards.`;
}

function sampleOutput(chapter = 1, overrides: Partial<WriteChapterOutput> = {}): WriteChapterOutput {
  const prose = sampleProse(chapter);
  return {
    chapterNumber: chapter,
    title: `Infiltration ${chapter}`,
    content: prose,
    wordCount: prose.split(/\s+/).length,
    preWriteCheck: "",
    postSettlement: "",
    updatedState: "# Current State\n",
    updatedHooks: "# Pending Hooks\n",
    updatedLedger: "# Particle Ledger\n",
    updatedSubplots: "# Subplots\n",
    updatedEmotionalArcs: "# Emotional Arcs\n",
    updatedCharacterMatrix: "# Character Matrix\n",
    chapterSummary: `| ${chapter} | Infiltration ${chapter} | Hero | Infiltrate | Focused | | Quiet | Shadow |`,
    postWriteErrors: [],
    postWriteWarnings: [],
    tokenUsage: ZERO_USAGE,
    runtimeStateDelta: {
      chapter,
      currentStatePatch: { currentGoal: "Infiltrate the fortress" },
      hookOps: { upsert: [], mention: [], resolve: [], defer: [] },
      newHookCandidates: [],
      subplotOps: [],
      emotionalArcOps: [],
      characterMatrixOps: [],
      notes: [],
    },
    ...overrides,
  };
}

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
    goal: "Defeat shadow syndicate",
    requiredBeats: [
      { beatId: "beat-infiltrate", category: "event", importance: "required", description: "Infiltrate cellar" },
    ],
    optionalBeats: [],
    relationshipMovements: [],
    hookMovements: [],
    timing: {},
    authorizations: [],
    dependencies: [],
    changedBeats: ["beat-infiltrate"],
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

async function seedActiveAuthorization(authId = "auth-1"): Promise<void> {
  const dir = join(bookDir, "story", "governance", "authorizations");
  await mkdir(dir, { recursive: true });
  const record: AuthorizationRecord = {
    authorizationId: authId,
    decisionKind: "major_secret_reveal",
    scope: { kind: "exact_chapter", chapterNumber: 1 },
    lifecycle: "active",
    lifecycleRevision: "1",
    consumption: "one_time",
    createdAt: new Date().toISOString(),
    confirmedAt: new Date().toISOString(),
    confirmedBy: "human-author",
  };
  await writeFile(join(dir, `${authId}.gov.json`), JSON.stringify(record, null, 2), "utf-8");
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "inkos-writer-gate-"));
  state = new StateManager(root);
  bookDir = state.bookDir(bookId);
  await state.saveBookConfig(bookId, sampleBookConfig());
  await mkdir(join(bookDir, "story", "state"), { recursive: true });
  await mkdir(join(bookDir, "story", "governance"), { recursive: true });
  await mkdir(join(bookDir, "chapters"), { recursive: true });

  await writeFile(join(bookDir, "story", "state", "current_state.json"), JSON.stringify({
    schemaVersion: 1,
    chapter: 0,
    characters: {},
    worldState: {},
    activeThreads: [],
  }, null, 2), "utf-8");

  await writeFile(join(bookDir, "story", "state", "hooks.json"), JSON.stringify({
    schemaVersion: 1,
    hooks: [],
  }, null, 2), "utf-8");

  await writeFile(join(bookDir, "story", "state", "chapter_summaries.json"), JSON.stringify({
    schemaVersion: 1,
    summaries: [],
  }, null, 2), "utf-8");

  await writeFile(canonPath(), `${JSON.stringify({
    schemaVersion: 2,
    language: "en",
    lastAppliedChapter: 0,
    projectionVersion: 1,
    migrationWarnings: [],
  }, null, 2)}\n`, "utf-8");

  await seedFoundation(1);
  await seedPublishedArc("arc-1", 1);
  await seedActiveAuthorization("auth-1");

  vi.spyOn(PlannerAgent.prototype, "planChapter").mockImplementation(async (input) => {
    const memo = {
      chapter: input.chapterNumber,
      goal: "Infiltrate fortress",
      isGoldenOpening: false,
      body: "### Narrative Directives\nInfiltrate fortress.\n\n### Character Directives\nHero moves quietly.\n\n### Relationship Directives\nTrust.\n\n### Pacing Directives\nSuspense.\n\n### Mystery Directives\nHooks.\n\n### Continuity Directives\nConsistent.\n\n### Thematic Directives\nTheme.",
      threadRefs: [] as string[],
    };
    return {
      intent: {
        chapter: input.chapterNumber,
        goal: "Infiltrate fortress",
        mustKeep: [],
        mustAvoid: [],
        styleEmphasis: [],
      },
      memo,
      intentMarkdown: memo.body,
      plannerInputs: [],
      runtimePath: "",
    };
  });

  vi.spyOn(FoundationReviewerAgent.prototype, "review").mockResolvedValue({
    passed: true,
    totalScore: 90,
    dimensions: [],
    overallFeedback: "clean",
  });

  vi.spyOn(StateValidatorAgent.prototype, "validate").mockResolvedValue({
    warnings: [],
    passed: true,
  });

  vi.spyOn(ReviserAgent.prototype, "reviseChapter").mockImplementation(async (_bookDir, content) => ({
    revisedContent: content,
    wordCount: content.length,
    fixedIssues: [],
    tokenUsage: ZERO_USAGE,
  }));

  vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockImplementation(async (input) => ({
    chapterNumber: input.chapterNumber,
    title: input.chapterTitle ?? "Infiltration 1",
    content: input.chapterContent,
    wordCount: input.chapterContent.length,
    preWriteCheck: "",
    postSettlement: "",
    updatedState: "# Current State\n",
    updatedHooks: "# Pending Hooks\n",
    updatedLedger: "# Particle Ledger\n",
    updatedSubplots: "# Subplots\n",
    updatedEmotionalArcs: "# Emotional Arcs\n",
    updatedCharacterMatrix: "# Character Matrix\n",
    chapterSummary: `| ${input.chapterNumber} | Infiltration | Hero | Infiltrate | Focused | | Quiet | Shadow |`,
    postWriteErrors: [],
    postWriteWarnings: [],
    tokenUsage: ZERO_USAGE,
    runtimeStateDelta: {
      chapter: input.chapterNumber,
      currentStatePatch: { currentGoal: "Infiltrate the fortress" },
      hookOps: { upsert: [], mention: [], resolve: [], defer: [] },
      newHookCandidates: [],
      subplotOps: [],
      emotionalArcOps: [],
      characterMatrixOps: [],
      notes: [],
    },
  }));
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (root) await rm(root, { recursive: true, force: true });
});

function createRunner(overrides: Partial<ConstructorParameters<typeof PipelineRunner>[0]> = {}): PipelineRunner {
  return new PipelineRunner({
    projectRoot: root,
    client: {
      provider: "openai",
      model: "mock-model",
      apiFormat: "chat",
      stream: false,
      defaults: { temperature: 0.7, maxTokens: 4096, thinkingBudget: 0 },
      _piModel: { id: "mock-model", name: "mock-model" } as any,
    } as any,
    model: "mock-model",
    ...overrides,
  });
}

describe("Task 19 — Governance Mode Matrix", () => {
  it("legacy/legacy uses existing legacy write workflow without V2 planning gate", async () => {
    await state.saveBookConfig(bookId, sampleBookConfig({
      governance: { foundation: "legacy", planning: "legacy" },
    }));

    const writerSpy = vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(sampleOutput(1));
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue({
      passed: true,
      issues: [],
      summary: "Clean",
      overallScore: 90,
      tokenUsage: ZERO_USAGE,
    });

    const runner = createRunner();
    const result = await runner.writeNextChapter(bookId);

    expect(writerSpy).toHaveBeenCalledTimes(1);
    expect(result.chapterNumber).toBe(1);
  });

  it("v2/legacy transition state blocks writing with actionable readiness error (Writer=0)", async () => {
    await state.saveBookConfig(bookId, sampleBookConfig({
      governance: { foundation: "v2", planning: "legacy" },
    }));

    const writerSpy = vi.spyOn(WriterAgent.prototype, "writeChapter");
    const runner = createRunner();

    await expect(runner.writeNextChapter(bookId)).rejects.toThrow(/transition state/i);
    expect(writerSpy).not.toHaveBeenCalled();
  });

  it("legacy/v2 invalid state fails closed (Writer=0)", async () => {
    await state.saveBookConfig(bookId, sampleBookConfig({
      governance: { foundation: "legacy", planning: "v2" },
    }));

    const writerSpy = vi.spyOn(WriterAgent.prototype, "writeChapter");
    const runner = createRunner();

    await expect(runner.writeNextChapter(bookId)).rejects.toThrow(/invalid governance state/i);
    expect(writerSpy).not.toHaveBeenCalled();
  });

  it("v2/v2 uses full Phase 5 write chain and executes successfully when safe", async () => {
    const writerSpy = vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(sampleOutput(1));
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue({
      passed: true,
      issues: [],
      summary: "Clean",
      overallScore: 92,
      tokenUsage: ZERO_USAGE,
    });

    const runner = createRunner();
    const result = await runner.writeNextChapter(bookId);

    expect(writerSpy).toHaveBeenCalledTimes(1);
    expect(result.chapterNumber).toBe(1);
  });
});

describe("Task 19 — Planning Gate and Zero-Writer Conditions", () => {
  it("blocks and ensures Writer=0 when Planning Gate outcome is conflict", async () => {
    const writerSpy = vi.spyOn(WriterAgent.prototype, "writeChapter");
    vi.spyOn(planningGateModule, "evaluatePlanningGate").mockResolvedValue({
      outcome: "conflict",
      evidence: ["Hard conflict with book rules"],
    });

    const runner = createRunner();
    await expect(runner.writeNextChapter(bookId)).rejects.toThrow(/Planning Gate blocked execution: outcome="conflict"/);
    expect(writerSpy).not.toHaveBeenCalled();
  });

  it("blocks and ensures Writer=0 when Planning Gate outcome is author_decision", async () => {
    const writerSpy = vi.spyOn(WriterAgent.prototype, "writeChapter");
    vi.spyOn(planningGateModule, "evaluatePlanningGate").mockResolvedValue({
      outcome: "author_decision",
      missing: ["major_character_death"],
    });

    const runner = createRunner();
    await expect(runner.writeNextChapter(bookId)).rejects.toThrow(/Planning Gate blocked execution: outcome="author_decision"/);
    expect(writerSpy).not.toHaveBeenCalled();
  });

  it("blocks and ensures Writer=0 when Planning Gate outcome is uncertain", async () => {
    const writerSpy = vi.spyOn(WriterAgent.prototype, "writeChapter");
    vi.spyOn(planningGateModule, "evaluatePlanningGate").mockResolvedValue({
      outcome: "uncertain",
      concerns: ["Ambiguity requires human clarification"],
    });

    const runner = createRunner();
    await expect(runner.writeNextChapter(bookId)).rejects.toThrow(/Planning Gate blocked execution: outcome="uncertain"/);
    expect(writerSpy).not.toHaveBeenCalled();
  });

  it("blocks and ensures Writer=0 when ContextBundle is stale", async () => {
    const writerSpy = vi.spyOn(WriterAgent.prototype, "writeChapter");
    vi.spyOn(contextBundleModule, "isBundleStale").mockResolvedValue(true);

    const runner = createRunner();
    await expect(runner.writeNextChapter(bookId)).rejects.toThrow(/ContextBundle is stale before execution snapshot freeze/);
    expect(writerSpy).not.toHaveBeenCalled();
  });

  it("blocks and ensures Writer=0 when execution snapshot freeze fails", async () => {
    const writerSpy = vi.spyOn(WriterAgent.prototype, "writeChapter");
    vi.spyOn(snapshotModule, "freezeExecutionSnapshotUnderLock").mockResolvedValue({
      status: "execution_prepare_failed",
      reason: "Mock snapshot prepare error",
    });

    const runner = createRunner();
    await expect(runner.writeNextChapter(bookId)).rejects.toThrow(/Execution snapshot freeze failed: Mock snapshot prepare error/);
    expect(writerSpy).not.toHaveBeenCalled();
  });
});

describe("Task 19 — Execution Attempt Ordering and Lifecycle", () => {
  it("creates durable Execution Attempt in RUNNING state BEFORE Writer is called", async () => {
    let attemptStateAtWriterCall: string | undefined;
    let attemptSnapshotIdAtWriterCall: string | undefined;

    const writerSpy = vi.spyOn(WriterAgent.prototype, "writeChapter").mockImplementation(async () => {
      const attempts = await listExecutionAttempts(bookDir, 1);
      if (attempts.length > 0) {
        attemptStateAtWriterCall = attempts[0].status;
        attemptSnapshotIdAtWriterCall = attempts[0].snapshotId;
      }
      return sampleOutput(1);
    });

    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue({
      passed: true,
      issues: [],
      summary: "Clean",
      overallScore: 95,
      tokenUsage: ZERO_USAGE,
    });

    const runner = createRunner();
    await runner.writeNextChapter(bookId);

    expect(writerSpy).toHaveBeenCalledTimes(1);
    expect(attemptStateAtWriterCall).toBe("running");
    expect(attemptSnapshotIdAtWriterCall).toBeDefined();

    const finalAttempts = await listExecutionAttempts(bookDir, 1);
    expect(finalAttempts.length).toBe(1);
    expect(finalAttempts[0].status).toBe("drafted");
  });

  it("handles provider failure durably: Attempt=FAILED, Snapshot immutable, Canon unchanged", async () => {
    const writerSpy = vi.spyOn(WriterAgent.prototype, "writeChapter").mockRejectedValue(
      new Error("Provider connection timeout"),
    );

    const canonBefore = JSON.parse(await readFile(canonPath(), "utf-8"));
    const runner = createRunner();

    await expect(runner.writeNextChapter(bookId)).rejects.toThrow(/Provider connection timeout/);
    expect(writerSpy).toHaveBeenCalledTimes(1);

    const attempts = await listExecutionAttempts(bookDir, 1);
    expect(attempts.length).toBe(1);
    expect(attempts[0].status).toBe("failed");
    expect(attempts[0].providerFailure?.message).toContain("Provider connection timeout");

    // Snapshot remains immutable
    const snapshot = await loadExecutionSnapshot(bookDir, attempts[0].snapshotId);
    expect(snapshot).toBeDefined();

    // Canon unchanged
    expect(JSON.parse(await readFile(canonPath(), "utf-8"))).toEqual(canonBefore);

    // Authorization unconsumed
    const auth = await loadAuthorization(bookDir, "auth-1");
    expect(auth?.lifecycle).toBe("active");
  });
});

describe("Task 19 — PLAN_DEFECT Orchestration and Replan Boundary", () => {
  it("orchestrates PLAN_DEFECT: aborts initial attempt (replanNumber=0), replans (replanNumber=1), and produces chapter", async () => {
    let callCount = 0;
    const writerSpy = vi.spyOn(WriterAgent.prototype, "writeChapter").mockImplementation(async () => {
      callCount++;
      return sampleOutput(1, { title: `Draft ${callCount}` });
    });

    let auditCount = 0;
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockImplementation(async () => {
      auditCount++;
      if (auditCount === 1) {
        // First audit detects plan defect!
        return {
          passed: false,
          issues: [{
            severity: "critical",
            category: "plan_defect",
            description: "Scene contradicted major beat requirement",
            suggestion: "Replan scene order",
            repairScope: "structural",
          }],
          summary: "Plan defect in scene order",
          overallScore: 60,
          tokenUsage: ZERO_USAGE,
        };
      }
      // Second audit passes
      return {
        passed: true,
        issues: [],
        summary: "Clean",
        overallScore: 92,
        tokenUsage: ZERO_USAGE,
      };
    });

    const runner = createRunner();
    const result = await runner.writeNextChapter(bookId);

    expect(writerSpy).toHaveBeenCalledTimes(2);
    expect(result.chapterNumber).toBe(1);

    const attempts = await listExecutionAttempts(bookDir, 1);
    expect(attempts.length).toBe(2);

    // Attempt 0 (initial) is aborted for plan defect
    expect(attempts[0].replanNumber).toBe(0);
    expect(attempts[0].status).toBe("aborted_for_plan_defect");

    // Attempt 1 (replan 1) is drafted
    expect(attempts[1].replanNumber).toBe(1);
    expect(attempts[1].status).toBe("drafted");

    // Snapshot 0 and Snapshot 1 are distinct and immutable
    expect(attempts[0].snapshotId).not.toBe(attempts[1].snapshotId);
  });

  it("stops to Human when third consecutive attempt produces PLAN_DEFECT (max 2 replans)", async () => {
    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(sampleOutput(1));
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue({
      passed: false,
      issues: [{
        severity: "critical",
        category: "plan_defect",
        description: "Contradicts arc climax beat",
        suggestion: "Restructure plan",
        repairScope: "structural",
      }],
      summary: "Persistent plan defect",
      overallScore: 50,
      tokenUsage: ZERO_USAGE,
    });

    const runner = createRunner();
    await expect(runner.writeNextChapter(bookId)).rejects.toThrow(/Exhausted maximum 2 automatic replans/i);

    const attempts = await listExecutionAttempts(bookDir, 1);
    // Initial (0) + Replan 1 (1) + Replan 2 (2) = 3 attempts total
    expect(attempts.length).toBe(3);
    expect(attempts[0].replanNumber).toBe(0);
    expect(attempts[1].replanNumber).toBe(1);
    expect(attempts[2].replanNumber).toBe(2);

    // No 4th attempt exists
    expect(attempts.some((a) => a.replanNumber >= 3)).toBe(false);
  });

  it("orchestrates two consecutive PLAN_DEFECTs and succeeds on Replan #2 (replanNumber=2)", async () => {
    let callCount = 0;
    const writerSpy = vi.spyOn(WriterAgent.prototype, "writeChapter").mockImplementation(async () => {
      callCount++;
      return sampleOutput(1, { title: `Draft Round ${callCount}` });
    });

    let auditCount = 0;
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockImplementation(async () => {
      auditCount++;
      if (auditCount <= 2) {
        // First and second audits detect plan defects
        return {
          passed: false,
          issues: [{
            severity: "critical",
            category: "plan_defect",
            description: `Plan defect in round ${auditCount}`,
            suggestion: "Restructure",
            repairScope: "structural",
          }],
          summary: `Defect ${auditCount}`,
          overallScore: 60,
          tokenUsage: ZERO_USAGE,
        };
      }
      // Third audit passes
      return {
        passed: true,
        issues: [],
        summary: "Clean",
        overallScore: 94,
        tokenUsage: ZERO_USAGE,
      };
    });

    const runner = createRunner();
    const result = await runner.writeNextChapter(bookId);

    expect(writerSpy).toHaveBeenCalledTimes(3);
    expect(result.chapterNumber).toBe(1);

    const attempts = await listExecutionAttempts(bookDir, 1);
    expect(attempts.length).toBe(3);
    expect(attempts[0].replanNumber).toBe(0);
    expect(attempts[0].status).toBe("aborted_for_plan_defect");
    expect(attempts[1].replanNumber).toBe(1);
    expect(attempts[1].status).toBe("aborted_for_plan_defect");
    expect(attempts[2].replanNumber).toBe(2);
    expect(attempts[2].status).toBe("drafted");
  });
});

describe("Task 19 — Canon and Authorization Boundaries", () => {
  it("successful draft does not mutate Canon or consume authorizations", async () => {
    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(sampleOutput(1));
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue({
      passed: true,
      issues: [],
      summary: "Clean",
      overallScore: 95,
      tokenUsage: ZERO_USAGE,
    });

    const currentStateBefore = await readFile(join(bookDir, "story", "state", "current_state.json"), "utf-8");
    const hooksBefore = await readFile(join(bookDir, "story", "state", "hooks.json"), "utf-8");
    const summariesBefore = await readFile(join(bookDir, "story", "state", "chapter_summaries.json"), "utf-8");

    const runner = createRunner();
    await runner.writeNextChapter(bookId);

    // Structured Canon untouched
    expect(await readFile(join(bookDir, "story", "state", "current_state.json"), "utf-8")).toBe(currentStateBefore);
    expect(await readFile(join(bookDir, "story", "state", "hooks.json"), "utf-8")).toBe(hooksBefore);
    expect(await readFile(join(bookDir, "story", "state", "chapter_summaries.json"), "utf-8")).toBe(summariesBefore);

    // Authorization unconsumed
    const auth = await loadAuthorization(bookDir, "auth-1");
    expect(auth?.lifecycle).toBe("active");
    expect(auth?.consumedAt).toBeUndefined();
  });
});

