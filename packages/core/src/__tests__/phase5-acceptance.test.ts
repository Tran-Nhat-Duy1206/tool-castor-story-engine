// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { StateManager } from "../state/manager.js";
import { createVersionStore, restoreVersionAsRevisionCandidate } from "../governance/versions.js";
import { writeUnitManifest, governedContentHash } from "../foundation/manifest.js";
import { openFoundationRevision, saveFoundationUnitDraft, approveFoundationUnit } from "../foundation/revision-service.js";
import { publishFoundation, handleExternalEdit } from "../foundation/publish.js";
import { generateArcPlanDraft, runArcPreflight, publishArcPlan } from "../planning/arc-pipeline.js";
import { loadPublishedArcPlan, restoreArcPlanAsRevisionDraft } from "../planning/arc-plan.js";
import { createAuthorization, confirmAuthorization, loadAuthorization, authorizationApplies } from "../governance/authorizations.js";
import { PipelineRunner } from "../pipeline/runner.js";
import { PlannerAgent } from "../agents/planner.js";
import { WriterAgent, type WriteChapterOutput } from "../agents/writer.js";
import { ContinuityAuditor } from "../agents/continuity.js";
import { ChapterAnalyzerAgent } from "../agents/chapter-analyzer.js";
import { StateValidatorAgent } from "../agents/state-validator.js";
import { ReviserAgent } from "../agents/reviser.js";
import { FoundationReviewerAgent } from "../agents/foundation-reviewer.js";
import { listExecutionAttempts } from "../execution/attempt-store.js";
import { loadExecutionSnapshot } from "../execution/snapshot.js";
import { evaluateArcCompletion, applyArcTransition } from "../planning/transition.js";
import { buildDetailedPlan, loadDetailedPlan } from "../planning/detailed-plan.js";
import { evaluatePlanningGate } from "../planning/gate.js";
import { generateLookahead } from "../planning/lookahead.js";
import { createCanonBook } from "./helpers/canon-fixture.js";
import { publishActiveProposal, loadStateReview } from "../state/state-review-store.js";
import { decideStateReviewItem } from "../state/state-review-service.js";
import { computeProseRevision } from "../utils/prose-revision.js";
import { readStoryCanon } from "../state/canon-service.js";
import { confirmStateReview } from "../state/state-review-finalize.js";

const ZERO_USAGE = { promptTokens: 0, completionTokens: 0, totalTokens: 0 } as const;
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
let root = "";
let bookDir = "";
const bookId = "phase5-accept";

function bookConfig(governance = { foundation: "legacy", planning: "legacy" }) {
  return { id: bookId, title: "Phase 5 acceptance", platform: "other", genre: "fantasy", status: "active", targetChapters: 30, chapterWordCount: 2000, language: "en", createdAt: "2026-08-27T00:00:00.000Z", updatedAt: "2026-08-27T00:00:00.000Z", governance };
}
function writerOutput(chapter = 1): WriteChapterOutput {
  const content = `Chapter ${chapter}\n\n${"The hero advances through the fortress with deliberate care. ".repeat(210)}`;
  return { chapterNumber: chapter, title: `Chapter ${chapter}`, content, wordCount: content.split(/\s+/).length, preWriteCheck: "", postSettlement: "", updatedState: "# State\n", updatedHooks: "# Hooks\n", updatedLedger: "# Ledger\n", updatedSubplots: "# Subplots\n", updatedEmotionalArcs: "# Arcs\n", updatedCharacterMatrix: "# Characters\n", chapterSummary: `| ${chapter} | Chapter ${chapter} | Hero | Enter | Calm | | | |`, postWriteErrors: [], postWriteWarnings: [], tokenUsage: ZERO_USAGE, runtimeStateDelta: { chapter, currentStatePatch: { currentGoal: "enter" }, hookOps: { upsert: [], mention: [], resolve: [], defer: [] }, newHookCandidates: [], subplotOps: [], emotionalArcOps: [], characterMatrixOps: [], notes: [] } };
}
async function setupBook(): Promise<void> {
  root = await mkdtemp(join(tmpdir(), "phase5-accept-"));
  const state = new StateManager(root);
  bookDir = state.bookDir(bookId);
  await state.saveBookConfig(bookId, bookConfig() as never);
  await mkdir(join(bookDir, "story", "outline"), { recursive: true });
  await mkdir(join(bookDir, "story", "state"), { recursive: true });
  await mkdir(join(bookDir, "chapters"), { recursive: true });
  await writeFile(join(bookDir, "story", "state", "manifest.json"), `${JSON.stringify({ schemaVersion: 2, language: "en", lastAppliedChapter: 0, projectionVersion: 1, migrationWarnings: [] }, null, 2)}\n`);
  await writeFile(join(bookDir, "story", "state", "current_state.json"), JSON.stringify({ schemaVersion: 1, chapter: 0, characters: {}, worldState: {}, activeThreads: [] }, null, 2));
  await writeFile(join(bookDir, "story", "state", "hooks.json"), JSON.stringify({ schemaVersion: 1, hooks: [] }, null, 2));
  await writeFile(join(bookDir, "story", "state", "chapter_summaries.json"), JSON.stringify({ schemaVersion: 1, summaries: [] }, null, 2));
  await writeFile(join(bookDir, "story", "story_bible.md"), "# Legacy foundation\n");
  await writeFile(join(bookDir, "story", "book_rules.md"), "# Legacy rules\n");
  const prose = "The city hides a shadow fortress.\n";
  await writeFile(join(bookDir, "story", "outline", "sf-world.md"), prose);
  await writeUnitManifest(bookDir, { unitId: "sf-world", kind: "story_frame", importance: "required", status: "draft", locator: { contentKind: "whole_file", sourceRelPath: "story/outline/sf-world.md" }, contentHash: governedContentHash(prose), contentRevision: 1, dependencies: [] });
}
async function publishFoundationV1(): Promise<void> {
  const { revisionId } = await openFoundationRevision(bookDir, ["sf-world"]);
  const prose = await readFile(join(bookDir, "story", "outline", "sf-world.md"), "utf8");
  await saveFoundationUnitDraft(bookDir, revisionId, "sf-world", prose);
  await approveFoundationUnit(bookDir, revisionId, "sf-world", "human-author");
  const result = await publishFoundation({ bookDir, revisionId, humanActor: "human-author", expectedBaseFoundationVersion: 0, expectedBaseCanonRevision: 0 });
  expect(result.status).toBe("published");
}
async function publishArcV1(): Promise<void> {
  const { draftId } = await generateArcPlanDraft(bookDir, "arc-1", 1, "Enter the fortress and expose its leader");
  expect(await loadPublishedArcPlan(bookDir, "arc-1")).toBeNull();
  const preflight = await runArcPreflight(bookDir, draftId);
  expect(preflight.outcome).toBe("preflight_pass");
  expect(await loadPublishedArcPlan(bookDir, "arc-1")).toBeNull();
  const published = await publishArcPlan({ bookDir, draftId, humanActor: "human-author", expectedFoundationVersion: 1, expectedCanonRevision: 0 });
  expect(published.version).toBe(1);
}
async function readyV2Book(): Promise<void> { await publishFoundationV1(); await publishArcV1(); }
function installAgentMocks(): void {
  vi.spyOn(PlannerAgent.prototype, "planChapter").mockImplementation(async (input) => { const memo = { chapter: input.chapterNumber, goal: "Enter fortress", isGoldenOpening: false, body: "### Narrative Directives\nEnter.\n\n### Character Directives\nHero acts.\n\n### Relationship Directives\nNone.\n\n### Pacing Directives\nTense.\n\n### Mystery Directives\nClue.\n\n### Continuity Directives\nConsistent.\n\n### Thematic Directives\nCourage.", threadRefs: [] as string[] }; return { intent: { chapter: input.chapterNumber, goal: "Enter fortress", mustKeep: [], mustAvoid: [], styleEmphasis: [] }, memo, intentMarkdown: memo.body, plannerInputs: [], runtimePath: "" }; });
  vi.spyOn(FoundationReviewerAgent.prototype, "review").mockResolvedValue({ passed: true, totalScore: 90, dimensions: [], overallFeedback: "clean" });
  vi.spyOn(StateValidatorAgent.prototype, "validate").mockResolvedValue({ warnings: [], passed: true });
  vi.spyOn(ReviserAgent.prototype, "reviseChapter").mockImplementation(async (_dir, content) => ({ revisedContent: content, wordCount: content.length, fixedIssues: [], tokenUsage: ZERO_USAGE }));
  vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockImplementation(async (input) => writerOutput(input.chapterNumber));
}
function runner(): PipelineRunner { return new PipelineRunner({ projectRoot: root, client: { provider: "openai", model: "mock-model", apiFormat: "chat", stream: false, defaults: { temperature: 0.7, maxTokens: 4096, thinkingBudget: 0 }, _piModel: { id: "mock-model", name: "mock-model" } } as never, model: "mock-model" }); }

beforeEach(async () => { await setupBook(); installAgentMocks(); });
afterEach(async () => { vi.restoreAllMocks(); if (root) await rm(root, { recursive: true, force: true }); });

describe("Scenario A — natural brief to governed Chapter 1 boundary", () => {
  it("candidate and approval are not Publish; Arc preflight is not Publish; draft does not settle Canon", async () => {
    const { revisionId } = await openFoundationRevision(bookDir, ["sf-world"]);
    const prose = await readFile(join(bookDir, "story", "outline", "sf-world.md"), "utf8");
    await saveFoundationUnitDraft(bookDir, revisionId, "sf-world", prose);
    expect(await createVersionStore(bookDir).readCurrentVersion("foundation", "foundation").catch(() => null)).toBeNull();
    await approveFoundationUnit(bookDir, revisionId, "sf-world", "human-author");
    expect(await createVersionStore(bookDir).readCurrentVersion("foundation", "foundation").catch(() => null)).toBeNull();
    await publishFoundation({ bookDir, revisionId, humanActor: "human-author", expectedBaseFoundationVersion: 0, expectedBaseCanonRevision: 0 });
    await publishArcV1();
    const writer = vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(writerOutput(1));
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue({ passed: true, issues: [], summary: "clean", overallScore: 95, tokenUsage: ZERO_USAGE });
    const result = await runner().writeNextChapter(bookId);
    expect(writer).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ chapterNumber: 1, status: "needs-state-review" });
    expect(JSON.parse(await readFile(join(bookDir, "story", "state", "manifest.json"), "utf8")).lastAppliedChapter).toBe(0);
    expect((await readdir(join(bookDir, "chapters"))).filter((p) => p.endsWith(".md"))).toHaveLength(1);
    let active = await loadStateReview(bookDir, 1);
    expect(active?.status).toBe("active");
    if (!active || active.status !== "active") throw new Error("active State Review missing");
    for (const item of active.items) {
      active = await decideStateReviewItem({ bookDir, chapter: 1, itemId: item.id, decision: "accept", expectedReviewRevision: active.reviewRevision });
    }
    await confirmStateReview({ bookDir, chapter: 1, reviewId: active.reviewId, expectedReviewRevision: active.reviewRevision });
    expect(JSON.parse(await readFile(join(bookDir, "story", "state", "manifest.json"), "utf8")).lastAppliedChapter).toBe(1);
    const chapter2 = await buildDetailedPlan(bookDir, 2, { currentArcId: "arc-1" });
    expect((await loadDetailedPlan(bookDir, chapter2.planId))?.bindings.canonRevision).toBe(1);
  });
});

describe("Scenario B — healthy SAFE chapter", () => {
  it("Gate → Context → Snapshot → Attempt → Writer runs once without plan approval or provider switch", async () => {
    await readyV2Book();
    const writer = vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(writerOutput(1));
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue({ passed: true, issues: [], summary: "clean", overallScore: 95, tokenUsage: ZERO_USAGE });
    const canonBefore = JSON.parse(await readFile(join(bookDir, "story", "state", "manifest.json"), "utf8"));
    const result = await runner().writeNextChapter(bookId);
    expect(result).toMatchObject({ chapterNumber: 1, status: "needs-state-review" });
    expect(writer).toHaveBeenCalledTimes(1);
    expect(writer.mock.calls[0]?.[0]).toMatchObject({ bookDir, chapterNumber: 1 });
    expect(JSON.parse(await readFile(join(bookDir, "story", "state", "manifest.json"), "utf8"))).toEqual(canonBefore);
    const attempts = await listExecutionAttempts(bookDir, 1);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.snapshotId).toBeTruthy();
  });
});

describe("Scenario C — AUTHOR_DECISION → trusted Authorization", () => {
  it("pending/raw ID cannot grant authority; Human confirmation activates; planning/write do not consume", async () => {
    await readyV2Book();
    const { planId } = await buildDetailedPlan(bookDir, 1, { currentArcId: "arc-1" });
    const semanticEvaluator = async () => ({ authorDecisions: ["identity_reveal" as const] });
    expect(await evaluatePlanningGate({ bookDir, planId }, { semanticEvaluator })).toEqual({ outcome: "author_decision", missing: ["identity_reveal"] });
    const pending = await createAuthorization(bookDir, { decisionKind: "identity_reveal", scope: { kind: "exact_chapter", chapterNumber: 1 }, consumption: "one_time" });
    expect(pending.lifecycle).toBe("pending");
    expect(() => authorizationApplies(pending as never, { chapterNumber: 1, currentArcId: "arc-1", canonRevision: 0 } as never)).toThrow(/active/i);
    expect(await evaluatePlanningGate({ bookDir, planId }, { semanticEvaluator })).toEqual({ outcome: "author_decision", missing: ["identity_reveal"] });
    await expect(confirmAuthorization(bookDir, pending.authorizationId, "   ")).rejects.toThrow(/humanActor/i);
    expect((await loadAuthorization(bookDir, pending.authorizationId))?.lifecycle).toBe("pending");
    const active = await confirmAuthorization(bookDir, pending.authorizationId, "human-author");
    expect(active).toMatchObject({ lifecycle: "active", confirmedBy: "human-author", decisionKind: "identity_reveal" });
    const refreshed = await buildDetailedPlan(bookDir, 1, { currentArcId: "arc-1" });
    expect(await evaluatePlanningGate({ bookDir, planId: refreshed.planId }, { semanticEvaluator })).toEqual({ outcome: "safe" });
    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(writerOutput(1));
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue({ passed: true, issues: [], summary: "clean", overallScore: 95, tokenUsage: ZERO_USAGE });
    await runner().writeNextChapter(bookId);
    expect((await loadAuthorization(bookDir, pending.authorizationId))?.lifecycle).toBe("active");
  });
});

describe("Phase 4 Final Confirm remains the sole Canon/consumption boundary", () => {
  it("fault-free Final Confirm atomically advances Canon and consumes validated one-time authority with provenance", async () => {
    const fixture = await createCanonBook({ chapterCount: 1 });
    try {
      const chapter = 2;
      const prose = "# 第2章 身份揭示\n\n主角在灯塔公开真实身份。\n";
      await writeFile(join(fixture.bookDir, "chapters", "0002_身份揭示.md"), prose);
      await writeFile(join(fixture.bookDir, "chapters", "index.json"), JSON.stringify([
        { number: 1, title: "第1章", status: "approved", wordCount: 10, createdAt: "2026-08-27T00:00:00.000Z", updatedAt: "2026-08-27T00:00:00.000Z", auditIssues: [], lengthWarnings: [] },
        { number: 2, title: "身份揭示", status: "needs-state-review", wordCount: 10, createdAt: "2026-08-27T00:00:00.000Z", updatedAt: "2026-08-27T00:00:00.000Z", auditIssues: [], lengthWarnings: [] },
      ], null, 2));
      const pending = await createAuthorization(fixture.bookDir, { decisionKind: "identity_reveal", scope: { kind: "exact_chapter", chapterNumber: 2 }, consumption: "one_time" });
      const active = await confirmAuthorization(fixture.bookDir, pending.authorizationId, "human-author");
      const canon = await readStoryCanon(fixture.bookDir);
      const reviewId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
      await publishActiveProposal(fixture.bookDir, {
        schemaVersion: 1, status: "active", reviewId, sourceChapter: 2, effectiveChapter: 2, language: "vi", createdAt: "2026-08-27T00:00:00.000Z", proseRevision: computeProseRevision(prose), baseCanonRevision: canon.revision, reviewRevision: 1,
        items: [{ id: "identity-fact", kind: "current-state-fact", origin: "ai", title: "Identity reveal", proposal: { type: "fact", change: { action: "set", subject: "主角", predicate: "当前位置", object: "北岸灯塔" } }, evidence: { claimedLevel: "explicit", verifiedLevel: "explicit", quote: "公开真实身份" }, decision: "accepted" }],
      });
      expect((await loadAuthorization(fixture.bookDir, active.authorizationId))?.lifecycle).toBe("active");
      expect((await readStoryCanon(fixture.bookDir)).manifest.lastAppliedChapter).toBe(1);
      const settled = await confirmStateReview({ bookDir: fixture.bookDir, chapter, reviewId, expectedReviewRevision: 1 });
      expect(settled.status).toBe("resolved");
      expect((await readStoryCanon(fixture.bookDir)).manifest.lastAppliedChapter).toBe(2);
      expect(await loadAuthorization(fixture.bookDir, active.authorizationId)).toMatchObject({ lifecycle: "consumed", consumedCanonRevision: 2, confirmedBy: "human-author", decisionKind: "identity_reveal" });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});

describe("Scenario D — mid-book Foundation revision", () => {
  it("draft remains non-authority; Human Publish advances atomically without historical rewrite", async () => {
    await readyV2Book();
    await writeFile(join(bookDir, "chapters", "0001.md"), "historical chapter\n");
    const chapterBefore = hash(await readFile(join(bookDir, "chapters", "0001.md")));
    const canonBefore = hash(await readFile(join(bookDir, "story", "state", "manifest.json")));
    const currentBefore = await createVersionStore(bookDir).readCurrentVersion("foundation", "foundation");
    const staleFuturePlan = await buildDetailedPlan(bookDir, 2, { currentArcId: "arc-1" });
    expect((await evaluatePlanningGate({ bookDir, planId: staleFuturePlan.planId })).outcome).toBe("safe");
    const { revisionId } = await openFoundationRevision(bookDir, ["sf-world"]);
    await saveFoundationUnitDraft(bookDir, revisionId, "sf-world", "Changed future direction.\n");
    expect((await createVersionStore(bookDir).readCurrentVersion("foundation", "foundation"))?.version).toBe(currentBefore?.version);
    await approveFoundationUnit(bookDir, revisionId, "sf-world", "human-author");
    await publishFoundation({ bookDir, revisionId, humanActor: "human-author", expectedBaseFoundationVersion: 1, expectedBaseCanonRevision: 0 });
    expect((await createVersionStore(bookDir).readCurrentVersion("foundation", "foundation"))?.version).toBe(2);
    const staleGate = await evaluatePlanningGate({ bookDir, planId: staleFuturePlan.planId });
    expect(staleGate.outcome).toBe("conflict");
    expect(hash(await readFile(join(bookDir, "chapters", "0001.md")))).toBe(chapterBefore);
    expect(hash(await readFile(join(bookDir, "story", "state", "manifest.json")))).toBe(canonBefore);
    await writeFile(join(bookDir, "story", "book_rules.md"), "legacy disagreement");
    expect((await createVersionStore(bookDir).readCurrentVersion("foundation", "foundation"))?.version).toBe(2);
  });
});

describe("Scenario E — PLAN_DEFECT fresh replan/snapshot", () => {
  it("creates three durable distinct attempts and stops after two automatic replans", async () => {
    await readyV2Book();
    let planningRound = 0;
    vi.spyOn(PlannerAgent.prototype, "planChapter").mockImplementation(async (input) => {
      planningRound += 1;
      const goal = `Enter fortress route ${planningRound}`;
      const body = `### Narrative Directives\n${goal}.\n\n### Character Directives\nHero acts.\n\n### Relationship Directives\nNone.\n\n### Pacing Directives\nTense.\n\n### Mystery Directives\nClue.\n\n### Continuity Directives\nConsistent.\n\n### Thematic Directives\nCourage.`;
      return { intent: { chapter: input.chapterNumber, goal, mustKeep: [], mustAvoid: [], styleEmphasis: [] }, memo: { chapter: input.chapterNumber, goal, isGoldenOpening: false, body, threadRefs: [] }, intentMarkdown: body, plannerInputs: [], runtimePath: "" };
    });
    const writer = vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(writerOutput(1));
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue({ passed: false, issues: [{ severity: "critical", category: "plan_defect", description: "wrong scene route", suggestion: "replan", repairScope: "structural" }], summary: "plan defect", overallScore: 40, tokenUsage: ZERO_USAGE });
    const canonBefore = JSON.parse(await readFile(join(bookDir, "story", "state", "manifest.json"), "utf8"));
    await expect(runner().writeNextChapter(bookId)).rejects.toThrow(/maximum 2 automatic replans/i);
    expect(writer).toHaveBeenCalledTimes(3);
    const attempts = await listExecutionAttempts(bookDir, 1);
    expect(attempts.map((a) => a.replanNumber)).toEqual([0, 1, 2]);
    expect(new Set(attempts.map((a) => a.snapshotId)).size).toBe(3);
    const snapshots = await Promise.all(attempts.map((a) => loadExecutionSnapshot(bookDir, a.snapshotId)));
    expect(new Set(snapshots.map((s) => s?.planId)).size).toBe(3);
    expect(new Set(snapshots.map((s) => s?.planHash)).size).toBe(3);
    expect(attempts.every((a) => a.status === "aborted_for_plan_defect")).toBe(true);
    expect(JSON.parse(await readFile(join(bookDir, "story", "state", "manifest.json"), "utf8"))).toEqual(canonBefore);
  });
});

describe("Scenario F and negative authority guarantees", () => {
  it("required Beat evidence controls readiness; transition requires a Human-Published next Arc and has one winner", async () => {
    await readyV2Book();
    expect(await evaluateArcCompletion(bookDir, "arc-1")).toEqual({ outcome: "not_ready" });
    const arc1 = await loadPublishedArcPlan(bookDir, "arc-1");
    expect(arc1).not.toBeNull();
    const facts = arc1!.snapshot.requiredBeats.map((beat) => ({ subject: beat.beatId, predicate: "satisfied", object: "true", validFromChapter: 1, validUntilChapter: null, sourceChapter: 1 }));
    await writeFile(join(bookDir, "story", "state", "current_state.json"), JSON.stringify({ schemaVersion: 1, chapter: 1, characters: {}, worldState: {}, activeThreads: [], facts }, null, 2));
    await writeFile(join(bookDir, "story", "state", "manifest.json"), JSON.stringify({ schemaVersion: 2, language: "en", lastAppliedChapter: 1, projectionVersion: 1, migrationWarnings: [] }, null, 2));
    expect(await evaluateArcCompletion(bookDir, "arc-1")).toEqual({ outcome: "ready_to_close", nextPublished: false, action: "prepare_next_before_transition" });
    expect(await applyArcTransition(bookDir, "arc-1")).toMatchObject({ status: "not_applicable", reason: "next Arc not published" });
    const { draftId } = await generateArcPlanDraft(bookDir, "arc-2", 1, "Continue only after Human Publish");
    expect((await runArcPreflight(bookDir, draftId)).outcome).toBe("preflight_pass");
    await publishArcPlan({ bookDir, draftId, humanActor: "human-author", expectedFoundationVersion: 1, expectedCanonRevision: 1 });
    const pending = await createAuthorization(bookDir, { decisionKind: "identity_reveal", scope: { kind: "exact_chapter", chapterNumber: 2 }, consumption: "one_time" });
    const active = await confirmAuthorization(bookDir, pending.authorizationId, "human-author");
    const canonBefore = hash(await readFile(join(bookDir, "story", "state", "current_state.json")));
    const foundationBefore = (await createVersionStore(bookDir).readCurrentVersion("foundation", "foundation"))?.version;
    expect(await evaluateArcCompletion(bookDir, "arc-1")).toEqual({ outcome: "ready_to_close", nextPublished: true, action: "auto_activate" });
    const results = await Promise.all([applyArcTransition(bookDir, "arc-1"), applyArcTransition(bookDir, "arc-1")]);
    expect(results.filter((r) => r.status === "closed_and_activated")).toHaveLength(1);
    expect(results.filter((r) => r.status === "not_applicable")).toHaveLength(1);
    expect(hash(await readFile(join(bookDir, "story", "state", "current_state.json")))).toBe(canonBefore);
    expect((await createVersionStore(bookDir).readCurrentVersion("foundation", "foundation"))?.version).toBe(foundationBefore);
    expect((await loadAuthorization(bookDir, active.authorizationId))?.lifecycle).toBe("active");
  });

  it("restore is candidate only; external edits are not silently adopted; Arc restore requires fresh preflight", async () => {
    await readyV2Book();
    const fBefore = await createVersionStore(bookDir).readCurrentVersion("foundation", "foundation");
    const restored = await restoreVersionAsRevisionCandidate(createVersionStore(bookDir), "foundation", "foundation", 1, 0);
    expect(restored).toMatchObject({ restoredFromVersion: 1, parentVersion: 1, status: "needs_review" });
    expect((await createVersionStore(bookDir).readCurrentVersion("foundation", "foundation"))?.version).toBe(fBefore?.version);
    await writeFile(join(bookDir, "story", "outline", "sf-world.md"), "external unreviewed content\n");
    const external = await handleExternalEdit(bookDir, "sf-world", "compare");
    expect(external).toMatchObject({ action: "compare", hasExternalEdit: true });
    expect((await createVersionStore(bookDir).readCurrentVersion("foundation", "foundation"))?.version).toBe(1);
    const draftId = await restoreArcPlanAsRevisionDraft(bookDir, "arc-1", 1);
    await expect(publishArcPlan({ bookDir, draftId: draftId.draftId, humanActor: "human-author", expectedFoundationVersion: 1, expectedCanonRevision: 0 })).rejects.toThrow(/preflight/i);
    expect((await loadPublishedArcPlan(bookDir, "arc-1"))?.version).toBe(1);
  });

  it("advisory Lookahead and semantic review cannot manufacture authority or deterministic conflict", async () => {
    await readyV2Book();
    const currentFoundation = await createVersionStore(bookDir).readCurrentVersion("foundation", "foundation");
    const currentArc = await loadPublishedArcPlan(bookDir, "arc-1");
    const lookahead = await generateLookahead(bookDir, 2, { currentArcId: "arc-1" });
    expect(lookahead.status).toBe("current");
    expect((await createVersionStore(bookDir).readCurrentVersion("foundation", "foundation"))?.version).toBe(currentFoundation?.version);
    expect((await loadPublishedArcPlan(bookDir, "arc-1"))?.version).toBe(currentArc?.version);
    const { planId } = await buildDetailedPlan(bookDir, 1, { currentArcId: "arc-1" });
    await expect(evaluatePlanningGate({ bookDir, planId }, { semanticEvaluator: async () => { throw new Error("semantic reviewer cannot emit deterministic conflict"); } })).rejects.toThrow(/semantic reviewer/i);
    expect((await createVersionStore(bookDir).readCurrentVersion("foundation", "foundation"))?.version).toBe(1);
    expect((await loadPublishedArcPlan(bookDir, "arc-1"))?.version).toBe(1);
  });

  it("governance mode mismatches invoke Writer zero times", async () => {
    await readyV2Book();
    const state = new StateManager(root);
    await state.saveBookConfig(bookId, bookConfig({ foundation: "v2", planning: "legacy" }) as never);
    const blockedWriter = vi.spyOn(WriterAgent.prototype, "writeChapter");
    await expect(runner().writeNextChapter(bookId)).rejects.toThrow(/transition state/i);
    expect(blockedWriter).not.toHaveBeenCalled();
    await state.saveBookConfig(bookId, bookConfig({ foundation: "legacy", planning: "v2" }) as never);
    await expect(runner().writeNextChapter(bookId)).rejects.toThrow(/invalid governance state/i);
    expect(blockedWriter).not.toHaveBeenCalled();
  });

  it("healthy legacy/legacy remains one-chapter-per-action and no Task 19 bypass exists", async () => {
    const writer = vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(writerOutput(1));
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue({ passed: true, issues: [], summary: "clean", overallScore: 95, tokenUsage: ZERO_USAGE });
    const result = await runner().writeNextChapter(bookId);
    expect(result.chapterNumber).toBe(1);
    expect(writer).toHaveBeenCalledTimes(1);
    expect((await readdir(join(bookDir, "chapters"))).filter((p) => p.endsWith(".md"))).toHaveLength(1);
    const authModule = await import("../governance/authorizations.js");
    expect("consumeAuthorization" in authModule).toBe(false);
    expect("markAuthorizationConsumed" in authModule).toBe(false);
  });
});
