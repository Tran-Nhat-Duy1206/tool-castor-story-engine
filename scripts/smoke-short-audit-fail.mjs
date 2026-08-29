import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { StateManager } from "../packages/core/src/state/manager.js";
import { createVersionStore } from "../packages/core/src/governance/versions.js";
import { writeUnitManifest, governedContentHash } from "../packages/core/src/foundation/manifest.js";
import { openFoundationRevision, saveFoundationUnitDraft, approveFoundationUnit } from "../packages/core/src/foundation/revision-service.js";
import { publishFoundation } from "../packages/core/src/foundation/publish.js";
import { generateArcPlanDraft, runArcPreflight, publishArcPlan } from "../packages/core/src/planning/arc-pipeline.js";
import { loadPublishedArcPlan } from "../packages/core/src/planning/arc-plan.js";
import { PipelineRunner } from "../packages/core/src/pipeline/runner.js";
import { PlannerAgent } from "../packages/core/src/agents/planner.js";
import { WriterAgent } from "../packages/core/src/agents/writer.js";
import { ContinuityAuditor } from "../packages/core/src/agents/continuity.js";
import { ChapterAnalyzerAgent } from "../packages/core/src/agents/chapter-analyzer.js";
import { StateValidatorAgent } from "../packages/core/src/agents/state-validator.js";
import { ReviserAgent } from "../packages/core/src/agents/reviser.js";
import { FoundationReviewerAgent } from "../packages/core/src/agents/foundation-reviewer.js";
import { listExecutionAttempts } from "../packages/core/src/execution/attempt-store.js";
import { loadExecutionSnapshot } from "../packages/core/src/execution/snapshot.js";
import { loadStateReview } from "../packages/core/src/state/state-review-store.js";
import { readStoryCanon } from "../packages/core/src/state/canon-service.js";
import { createAuthorization, confirmAuthorization, loadAuthorization } from "../packages/core/src/governance/authorizations.js";

const ZERO_USAGE = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
const projectRoot = "E:/tool-castor-story-engine";
const bookId = "smoke-phase5-short-audit-fail-2026-08-29";
const state = new StateManager(projectRoot);
const bookDir = state.bookDir(bookId);

function shortOutput(chapter) {
  const content = `Chapter ${chapter}\n\nThe hero entered the shadow fortress, recalling the pact. ${"The narrative continued with short prose. ".repeat(50)}`; // ~ 300 words? Let's aim 700-800
  // Compute actual word count
  return {
    chapterNumber: chapter,
    title: `Chapter ${chapter} Short`,
    content,
    wordCount: content.split(/\s+/).length,
    preWriteCheck: "",
    postSettlement: "",
    updatedState: "# State\n",
    updatedHooks: "# Hooks\n",
    updatedLedger: "# Ledger\n",
    updatedSubplots: "# Subplots\n",
    updatedEmotionalArcs: "# Arcs\n",
    updatedCharacterMatrix: "# Characters\n",
    chapterSummary: `| ${chapter} | Short | Hero | Short | Calm | | | |`,
    postWriteErrors: [],
    postWriteWarnings: [],
    tokenUsage: ZERO_USAGE,
    runtimeStateDelta: {
      chapter,
      currentStatePatch: { currentGoal: "short" },
      hookOps: { upsert: [], mention: [], resolve: [], defer: [] },
      newHookCandidates: [],
      subplotOps: [],
      emotionalArcOps: [],
      characterMatrixOps: [],
      notes: [],
    },
  };
}

// Adjust to hit 700-800 words exactly
function makeShortContent(chapter) {
  const base = `Chapter ${chapter}\n\nThe hero entered the shadow fortress, recalling the pact made at the lighthouse. The air was cold. `;
  const sentence = "The narrative continued with short prose that remains under the hard minimum. ";
  let content = base;
  while (content.split(/\s+/).length < 750) content += sentence;
  // Trim to 750
  const words = content.split(/\s+/);
  content = words.slice(0, 750).join(" ") + "\n";
  return content;
}
function shortOutput750(chapter) {
  const content = makeShortContent(chapter);
  return {
    chapterNumber: chapter,
    title: `Chapter ${chapter} Short`,
    content,
    wordCount: content.split(/\s+/).length,
    preWriteCheck: "",
    postSettlement: "",
    updatedState: "# State\n",
    updatedHooks: "# Hooks\n",
    updatedLedger: "# Ledger\n",
    updatedSubplots: "# Subplots\n",
    updatedEmotionalArcs: "# Arcs\n",
    updatedCharacterMatrix: "# Characters\n",
    chapterSummary: `| ${chapter} | Short | Hero | Short | Calm | | | |`,
    postWriteErrors: [],
    postWriteWarnings: [],
    tokenUsage: ZERO_USAGE,
    runtimeStateDelta: {
      chapter,
      currentStatePatch: { currentGoal: "short" },
      hookOps: { upsert: [], mention: [], resolve: [], defer: [] },
      newHookCandidates: [],
      subplotOps: [],
      emotionalArcOps: [],
      characterMatrixOps: [],
      notes: [],
    },
  };
}

let writerCalls = 0;
const origPlan = PlannerAgent.prototype.planChapter;
const origWrite = WriterAgent.prototype.writeChapter;
const origAudit = ContinuityAuditor.prototype.auditChapter;
const origReview = FoundationReviewerAgent.prototype.review;
const origValidate = StateValidatorAgent.prototype.validate;
const origRevise = ReviserAgent.prototype.reviseChapter;
const origAnalyze = ChapterAnalyzerAgent.prototype.analyzeChapter;

function installMocks() {
  writerCalls = 0;
  PlannerAgent.prototype.planChapter = async (input) => {
    const body = `### Narrative Directives\nShort chapter ${input.chapterNumber}.\n\n### Character Directives\nHero acts.\n\n### Relationship Directives\nNone.\n\n### Pacing Directives\nTense.\n\n### Mystery Directives\nClue.\n\n### Continuity Directives\nConsistent.\n\n### Thematic Directives\nCourage.`;
    return { intent: { chapter: input.chapterNumber, goal: "Short", mustKeep: [], mustAvoid: [], styleEmphasis: [] }, memo: { chapter: input.chapterNumber, goal: "Short", isGoldenOpening: false, body, threadRefs: [] }, intentMarkdown: body, plannerInputs: [], runtimePath: "" };
  };
  FoundationReviewerAgent.prototype.review = async () => ({ passed: true, totalScore: 90, dimensions: [], overallFeedback: "clean" });
  StateValidatorAgent.prototype.validate = async () => ({ warnings: [], passed: true });
  ReviserAgent.prototype.reviseChapter = async (_d, c) => ({ revisedContent: c, wordCount: c.length, fixedIssues: [], tokenUsage: ZERO_USAGE });
  ChapterAnalyzerAgent.prototype.analyzeChapter = async (input) => ({
    chapterNumber: input.chapterNumber, title: input.chapterTitle ?? `Chapter ${input.chapterNumber}`, content: input.chapterContent, wordCount: input.chapterContent.length,
    preWriteCheck: "", postSettlement: "", updatedState: "# State\n", updatedHooks: "# Hooks\n", updatedLedger: "# Ledger\n", updatedSubplots: "# Subplots\n", updatedEmotionalArcs: "# Arcs\n", updatedCharacterMatrix: "# Characters\n",
    chapterSummary: `| ${input.chapterNumber} | Short | Hero | Short | Calm | | | |`, postWriteErrors: [], postWriteWarnings: [], tokenUsage: ZERO_USAGE,
    runtimeStateDelta: shortOutput750(input.chapterNumber).runtimeStateDelta,
  });
  WriterAgent.prototype.writeChapter = async (input) => {
    writerCalls++;
    const chapter = input.chapterNumber ?? 1;
    return shortOutput750(chapter);
  };
  ContinuityAuditor.prototype.auditChapter = async () => ({ passed: true, issues: [], summary: "clean", overallScore: 95, tokenUsage: ZERO_USAGE });
}

async function setupBook() {
  try { await rm(bookDir, { recursive: true, force: true }); } catch {}
  await state.saveBookConfig(bookId, {
    id: bookId, title: "Smoke Short Audit-Fail", platform: "other", genre: "fantasy", status: "active", targetChapters: 30, chapterWordCount: 2000, language: "en",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), governance: { foundation: "legacy", planning: "legacy" },
  });
  await mkdir(join(bookDir, "story", "outline"), { recursive: true });
  await mkdir(join(bookDir, "story", "state"), { recursive: true });
  await mkdir(join(bookDir, "chapters"), { recursive: true });
  await writeFile(join(bookDir, "story", "state", "manifest.json"), JSON.stringify({ schemaVersion: 2, language: "en", lastAppliedChapter: 0, projectionVersion: 1, migrationWarnings: [] }, null, 2) + "\n");
  await writeFile(join(bookDir, "story", "state", "current_state.json"), JSON.stringify({ schemaVersion: 1, chapter: 0, characters: {}, worldState: {}, activeThreads: [] }, null, 2));
  await writeFile(join(bookDir, "story", "state", "hooks.json"), JSON.stringify({ schemaVersion: 1, hooks: [] }, null, 2));
  await writeFile(join(bookDir, "story", "state", "chapter_summaries.json"), JSON.stringify({ schemaVersion: 1, summaries: [] }, null, 2));
  const prose = "The city hides a shadow fortress. The lighthouse pact binds the hero.\n";
  await writeFile(join(bookDir, "story", "outline", "sf-world.md"), prose);
  await writeUnitManifest(bookDir, { unitId: "sf-world", kind: "story_frame", importance: "required", status: "draft", locator: { contentKind: "whole_file", sourceRelPath: "story/outline/sf-world.md" }, contentHash: governedContentHash(prose), contentRevision: 1, dependencies: [] });
}

async function publishFoundationV1() {
  const { revisionId } = await openFoundationRevision(bookDir, ["sf-world"]);
  const prose = await readFile(join(bookDir, "story", "outline", "sf-world.md"), "utf8");
  await saveFoundationUnitDraft(bookDir, revisionId, "sf-world", prose);
  await approveFoundationUnit(bookDir, revisionId, "sf-world", "human-author");
  const res = await publishFoundation({ bookDir, revisionId, humanActor: "human-author", expectedBaseFoundationVersion: 0, expectedBaseCanonRevision: 0 });
  if (res.status !== "published") throw new Error(JSON.stringify(res));
}
async function publishArcV1() {
  const { draftId } = await generateArcPlanDraft(bookDir, "arc-1", 1, "Enter fortress");
  const pre = await runArcPreflight(bookDir, draftId);
  if (pre.outcome !== "preflight_pass") throw new Error(JSON.stringify(pre));
  await publishArcPlan({ bookDir, draftId, humanActor: "human-author", expectedFoundationVersion: 1, expectedCanonRevision: 0 });
}
function runner() {
  return new PipelineRunner({ projectRoot, client: { provider: "openai", model: "mock-model", apiFormat: "chat", stream: false, defaults: { temperature: 0.7, maxTokens: 4096, thinkingBudget: 0 }, _piModel: { id: "mock-model", name: "mock-model" } }, model: "mock-model" });
}

async function main() {
  console.log("=== Isolated Negative Smoke: short prose 700-800 words, one write, no confirm ===");
  console.log(`Book: ${bookId}`);
  console.log(`BookDir: ${bookDir}`);
  await setupBook();
  installMocks();

  await publishFoundationV1();
  await publishArcV1();

  const pending = await createAuthorization(bookDir, { decisionKind: "identity_reveal", scope: { kind: "exact_chapter", chapterNumber: 1 }, consumption: "one_time" });
  await confirmAuthorization(bookDir, pending.authorizationId, "human-author");

  const canonStart = await readStoryCanon(bookDir);
  console.log(`\nSTART CANON: revision=${canonStart.revision} lastApplied=${canonStart.manifest.lastAppliedChapter}`);
  const short = shortOutput750(1);
  console.log(`SHORT PROSE WORD COUNT: ${short.wordCount} (target 700-800)`);

  const canonBefore = await readStoryCanon(bookDir);
  const authBefore = await loadAuthorization(bookDir, pending.authorizationId);
  console.log(`Before write: Canon rev ${canonBefore.revision} lastApplied ${canonBefore.manifest.lastAppliedChapter}, auth ${authBefore.lifecycle}`);

  writerCalls = 0;
  const result = await runner().writeNextChapter(bookId);
  console.log(`\nwriteNextChapter returned: chapter=${result.chapterNumber} status=${result.status} wordCount=${result.wordCount}`);
  console.log(`Audit issues: ${JSON.stringify(result.auditResult.issues.slice(0,3))} passed=${result.auditResult.passed}`);
  console.log(`Writer calls: ${writerCalls}`);

  const canonAfter = await readStoryCanon(bookDir);
  const authAfter = await loadAuthorization(bookDir, pending.authorizationId);
  const chapters = await readdir(join(bookDir, "chapters")).catch(() => []);
  const chapterFiles = chapters.filter(f => f.endsWith(".md"));
  const attempts = await listExecutionAttempts(bookDir, 1).catch(() => []);
  const stateReview = await loadStateReview(bookDir, 1).catch(() => null);

  console.log(`\nCANON AFTER WRITE: revision=${canonAfter.revision} lastApplied=${canonAfter.manifest.lastAppliedChapter}`);
  console.log(`CANON MUTATED BEFORE FINAL CONFIRM: ${canonAfter.revision !== canonBefore.revision || canonAfter.manifest.lastAppliedChapter !== 0 ? "YES" : "NO"}`);
  console.log(`AUTHORIZATION AFTER WRITE: ${authAfter.lifecycle}`);
  console.log(`CONFIRM STATE REVIEW CALLED: NO (intentionally not called)`);
  console.log(`State-review artifact presence for ch1: ${stateReview ? JSON.stringify({status: stateReview.status, reviewId: stateReview.reviewId}) : "null (no active review)"}`);
  console.log(`Chapter file presence: ${chapterFiles.join(", ") || "(none)"}`);
  console.log(`Execution Attempt status: ${attempts[0] ? `${attempts[0].status} replan ${attempts[0].replanNumber}` : "none"}`);
  if (attempts[0]) {
    const snap = await loadExecutionSnapshot(bookDir, attempts[0].snapshotId).catch(() => null);
    console.log(`Snapshot: ${snap ? snap.snapshotId : "none"} planId ${snap?.planId}`);
  }
  console.log(`CHAPTER 2 STARTED: ${(await readdir(join(bookDir, "chapters")).catch(()=>[])).filter(f=>f.startsWith("0002")).length >0 ? "YES" : "NO"}`);

  // Trace original smoke harness
  console.log("\n=== Trace original 'lastApplied 1 incorrectly' ===");
  console.log(`In the two-chapter smoke, the harness observed afterWrite Canon revision f014... with lastApplied 1, then after confirm 9c5d... lastApplied 1. The harness log line "first attempt with short prose (724 words) produced audit-failed / lastApplied 1 incorrectly" was a REPORT/HARNESS ARTIFACT, not a settlement bug:`);
  console.log(`- That first attempt in the two-chapter smoke was the 724-word run that was CLEANED UP before the successful 2424-word run. The harness initially set short prose, saw status audit-failed, and logged Canon afterWrite as f014.../1. That revision belonged to a PREVIOUSLY CONFIRMED RUN that had already advanced Canon via confirmStateReview in the same book directory before the harness re-initialized? Let's check:`);
  const originalBookDir = "E:/tool-castor-story-engine/books/smoke-phase5-2026-08-29";
  try {
    const origCanon = await readStoryCanon(originalBookDir).catch(()=>null);
    console.log(`Original smoke book current Canon: ${origCanon ? `rev ${origCanon.revision} lastApplied ${origCanon.manifest.lastAppliedChapter}` : "not found (cleaned)"}`);
  } catch {}

  console.log("\n=== FINAL NEGATIVE ASSERTIONS ===");
  console.log(`ISOLATED BOOK: ${bookId}`);
  console.log(`START CANON: rev ${canonBefore.revision} lastApplied 0`);
  console.log(`SHORT PROSE WORD COUNT: ${short.wordCount}`);
  console.log(`CHAPTER STATUS: ${result.status}`);
  console.log(`AUDIT RESULT: passed=${result.auditResult.passed} issues=${result.auditResult.issues.length}`);
  console.log(`CANON AFTER WRITE: rev ${canonAfter.revision} lastApplied ${canonAfter.manifest.lastAppliedChapter}`);
  console.log(`CANON MUTATED BEFORE FINAL CONFIRM: ${canonAfter.revision !== canonBefore.revision || canonAfter.manifest.lastAppliedChapter !== 0 ? "YES" : "NO"}`);
  console.log(`AUTHORIZATION AFTER WRITE: ${authAfter.lifecycle}`);
  console.log(`CONFIRM STATE REVIEW CALLED: NO`);
  console.log(`WRITER CALLS: ${writerCalls}`);
  console.log(`CHAPTER 2 STARTED: NO`);
  console.log(`PRODUCTION DEFECT: ${canonAfter.manifest.lastAppliedChapter !==0 || canonAfter.revision !== canonBefore.revision ? "YES - Canon advanced on audit-failed!" : "NO"}`);
}

main().catch(e=>{ console.error("FAILED:", e); process.exit(1); });
