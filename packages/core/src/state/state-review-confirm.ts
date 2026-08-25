import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";import {
  RuntimeStateDeltaSchema,
  type ChapterSummaryRow,
  type HookRecord,
  type NewHookCandidate,
  type RuntimeStateDelta,
  type RuntimeStateLanguage,
} from "../models/runtime-state.js";
import { ChapterMetaSchema, type ChapterMeta } from "../models/chapter.js";
import {
  ResolvedReviewReceiptSchema,
  StateReviewError,
  resolveReviewItemEffectiveChange,
  type HumanDecisionRecord,
  type ProposalChange,
  type ResolvedReviewReceipt,
  type ReviewItem,
} from "../models/state-review.js";
import {
  ACTIVE_REVIEW_RELPATH,
  RECEIPTS_DIR,
  loadStateReview,
  readLiveRuntimeStateSnapshot,
} from "./state-review-store.js";
import { computeCanonRevision, readStoryCanon } from "./canon-service.js";
import { buildRuntimeStateArtifactsFromSnapshot } from "./runtime-state-store.js";
import { validateRuntimeState } from "./state-validator.js";
import { computeProseRevision } from "../utils/prose-revision.js";
import {
  CURRENT_STATE_SLOT_DEFS,
  currentStateSlotAliases,
  type CurrentStateSlotKey,
} from "./state-projections.js";
import { SNAPSHOT_STORY_FILE_NAMES } from "./snapshot-set.js";

/**
 * Task 11 — PURE Final-Confirm PREPARE (design §9.A; hardened plan Area G).
 *
 * Reads/revalidates the ACTIVE State Review, resolves human decisions through
 * the ONE Task 1 resolver, compiles them into the EXISTING RuntimeStateDelta
 * model, applies that delta to a LIVE Canon snapshot IN MEMORY ONLY via the
 * existing reducer entry point, validates the candidate runtime state, and
 * derives EVERY candidate artifact Task 12 will publish (the four structured
 * Canon documents, the three truth projections, the chapter snapshot mirror,
 * the approved index entry, the resolved receipt, and the active-artifact
 * deletion) — WITHOUT touching the filesystem.
 *
 * ZERO-WRITE GUARANTEE: success AND failure leave every byte on disk
 * untouched. This module performs pure reads exclusively; mutating loaders
 * are banned here BY CONTRACT and enforced by a dedicated static-import test.
 *
 * LOCK OWNERSHIP: caller-owned. PREPARE must run while the caller holds the
 * book mutation lock so its anchors stay valid until Task 12 commits the
 * returned candidate set inside that SAME lock.
 *
 * TEMPORAL CONTRACT: `params.durableHead` is the caller-resolved CURRENT
 * CONFIRMED Canon head — the `manifest.lastAppliedChapter` semantics fixed by
 * the Task 10 fix-up ("semantics applied through chapter N"), NEVER a raw
 * durable-file count. PREPARE cross-checks it against the live validated
 * snapshot and rejects any disagreement. A pending current chapter N over
 * confirmed N-1 stays effective N; historical sources anchor at confirmedHead
 * + 1; a head that reached the proposal's effectiveChapter is an APPLY-ZERO
 * conflict.
 *
 * ZERO-EFFECTIVE CONFIRMATIONS (fix-up): when every actionable item is
 * decided without story-meaning changes, PREPARE still compiles an op-less
 * RuntimeStateDelta at `active.effectiveChapter` and runs it through the same
 * reducer path — confirmation CONSUMES the effective temporal slot, so
 * manifest/current-state bookkeeping advances. Candidate canon, projections,
 * and snapshots are built from that advanced state; `zeroEffectiveChange` and
 * receipt resolution `confirmed-no-changes` remain SEMANTIC classifications.
 *
 * HISTORICAL SUMMARIES: summary proposals are SOURCE-chaptered (the row
 * describes the prose of `sourceChapter`). PREPARE validates source ownership,
 * then retargets ONLY the application-time row to `effectiveChapter`; the
 * original ReviewItem/proposal history is never mutated, and the applied
 * representation is what enters both the compiled delta and
 * `receipt.effectiveChanges` (design §23 "what actually entered the confirmed
 * delta").
 */

export interface PreparedStateReviewConfirm {
  /** Frozen three-layer + evidence receipt for the confirmed generation. */
  readonly receipt: ResolvedReviewReceipt;
  readonly receiptWrite: { relativePath: string; content: string };
  /** Complete candidate chapters/index.json with the reviewed chapter approved. */
  readonly indexWrite: { relativePath: string; content: string };
  /** Four structured Canon documents; EMPTY for zero-effective confirmations. */
  readonly canonWrites: ReadonlyArray<{ relativePath: string; content: string }>;
  /** Three truth-projection Markdown docs; EMPTY for zero-effective confirms. */
  readonly projectionWrites: ReadonlyArray<{ relativePath: string; content: string }>;
  /** Candidate `story/snapshots/<effectiveChapter>/` mirror; never on disk yet. */
  readonly snapshotWrites: ReadonlyArray<{ relativePath: string; content: string }>;
  /** Authoritative paths Task 12 must delete (the consumed active artifact). */
  readonly deletes: ReadonlyArray<string>;
  readonly resultingCanonRevision: string;
  readonly effectiveChapter: number;
  readonly zeroEffectiveChange: boolean;
}

interface CompiledConfirmation {
  readonly delta: RuntimeStateDelta;
  readonly zeroEffectiveChange: boolean;
  readonly proposals: ReadonlyArray<ProposalChange>;
  readonly decisions: ReadonlyArray<HumanDecisionRecord>;
  readonly effectiveChanges: ReadonlyArray<ProposalChange>;
}

function padChapter(chapter: number): string {
  return String(chapter).padStart(4, "0");
}

function resolveSlotKey(
  predicate: string,
  language: RuntimeStateLanguage,
): CurrentStateSlotKey | undefined {
  const normalized = predicate.trim().toLowerCase();
  for (const def of CURRENT_STATE_SLOT_DEFS) {
    if (currentStateSlotAliases(def.key, language).some((alias) => alias.toLowerCase() === normalized)) {
      return def.key;
    }
  }
  return undefined;
}

/**
 * The ONE compiler: effective changes → ONE schema-valid RuntimeStateDelta.
 * All-or-nothing — any uncompilable confirmed item aborts the whole prepare
 * with `state_review_invalid_change` and its itemId.
 */
function compileConfirmedDelta(params: {
  readonly items: ReadonlyArray<Parameters<typeof resolveReviewItemEffectiveChange>[0]>;
  readonly sourceChapter: number;
  readonly effectiveChapter: number;
  readonly language: RuntimeStateLanguage;
}): CompiledConfirmation {
  const patch = new Map<CurrentStateSlotKey, string>();
  const upserts = new Map<string, HookRecord>();
  const mentions = new Set<string>();
  const resolves = new Set<string>();
  const defers = new Set<string>();
  const candidates = new Map<string, NewHookCandidate>();
  let summaryRow: ChapterSummaryRow | undefined;

  const proposals: ProposalChange[] = [];
  const decisions: HumanDecisionRecord[] = [];
  const effectiveChanges: ProposalChange[] = [];

  for (const item of params.items) {
    proposals.push(item.proposal);
    decisions.push({
      itemId: item.id,
      decision: item.decision,
      ...(item.editedChange ? { editedChange: item.editedChange } : {}),
    });

    // Completeness gate: notes are informational/non-actionable; EVERY other
    // undecided item (AI or user) blocks Final Confirm. No implicit rejection.
    if (item.kind !== "note" && item.decision === "undecided") {
      throw new StateReviewError(
        "state_review_incomplete",
        `review item ${item.id} is still undecided`,
        item.id,
      );
    }

    // Layer-3 resolution via the ONLY resolver (Task 1). Rejected items keep
    // their audit history but contribute `{type:"none"}` — stale editedChange
    // payloads are never interpreted as effective semantics.
    const effective = resolveReviewItemEffectiveChange(item);
    effectiveChanges.push(effective);
    if (effective.type === "none") continue;

    switch (effective.type) {
      case "fact": {
        if (effective.change.action === "remove") {
          throw new StateReviewError(
            "state_review_invalid_change",
            `review item ${item.id} removes a current-state fact, which the existing RuntimeStateDelta reducer cannot represent`,
            item.id,
          );
        }
        const slotKey = resolveSlotKey(effective.change.predicate, params.language);
        if (!slotKey) {
          throw new StateReviewError(
            "state_review_invalid_change",
            `review item ${item.id} uses current-state predicate "${effective.change.predicate}" outside the shared slot vocabulary`,
            item.id,
          );
        }
        const existing = patch.get(slotKey);
        if (existing !== undefined && existing !== effective.change.object) {
          throw new StateReviewError(
            "state_review_invalid_change",
            `review item ${item.id} conflicts with another confirmed value for slot ${slotKey}`,
            item.id,
          );
        }
        if (effective.change.object === undefined) {
          throw new StateReviewError(
            "state_review_invalid_change",
            `review item ${item.id} sets a fact without an object value`,
            item.id,
          );
        }
        patch.set(slotKey, effective.change.object);
        break;
      }
      case "hook-upsert": {
        const existing = upserts.get(effective.hook.hookId);
        if (existing && JSON.stringify(existing) !== JSON.stringify(effective.hook)) {
          throw new StateReviewError(
            "state_review_invalid_change",
            `review item ${item.id} conflicts with another confirmed upsert of hook ${effective.hook.hookId}`,
            item.id,
          );
        }
        upserts.set(effective.hook.hookId, effective.hook);
        break;
      }
      case "hook-op": {
        const target =
          effective.op === "mention" ? mentions : effective.op === "resolve" ? resolves : defers;
        target.add(effective.hookId);
        break;
      }
      case "new-hook-candidate": {
        candidates.set(JSON.stringify(effective.candidate), effective.candidate);
        break;
      }
      case "chapter-summary": {
        // Historical rule (I-11.1): proposals are SOURCE-chaptered — the
        // summary describes the prose of `sourceChapter`. Validate source
        // ownership, then retarget ONLY the application-time row to the
        // effective slot the reducer requires. The original ReviewItem and
        // receipt proposal layer keep chapter = sourceChapter.
        if (effective.row.chapter !== params.sourceChapter) {
          throw new StateReviewError(
            "state_review_invalid_change",
            `review item ${item.id} summarizes chapter ${effective.row.chapter} but the reviewed source chapter is ${params.sourceChapter}`,
            item.id,
          );
        }
        const appliedRow: ChapterSummaryRow = { ...effective.row, chapter: params.effectiveChapter };
        if (summaryRow && JSON.stringify(summaryRow) !== JSON.stringify(appliedRow)) {
          throw new StateReviewError(
            "state_review_invalid_change",
            `review item ${item.id} conflicts with another confirmed chapter summary`,
            item.id,
          );
        }
        summaryRow = appliedRow;
        // Single-interpretation invariant: receipt.effectiveChanges records
        // what ACTUALLY entered the confirmed delta (design §23) — the
        // retargeted applied representation, not the raw source row.
        effectiveChanges[effectiveChanges.length - 1] = { type: "chapter-summary", row: appliedRow };
        break;
      }
      default:
        throw new StateReviewError(
          "state_review_invalid_change",
          `review item ${item.id} carries an unknown effective change type`,
          item.id,
        );
    }
  }

  const zeroEffectiveChange = effectiveChanges.every((change) => change.type === "none");
  const delta = RuntimeStateDeltaSchema.parse({
    chapter: params.effectiveChapter,
    ...(patch.size > 0 ? { currentStatePatch: Object.fromEntries(patch) } : {}),
    hookOps: {
      upsert: [...upserts.values()],
      mention: [...mentions],
      resolve: [...resolves],
      defer: [...defers],
    },
    ...(candidates.size > 0 ? { newHookCandidates: [...candidates.values()] } : {}),
    ...(summaryRow ? { chapterSummary: summaryRow } : {}),
  });

  return { delta, zeroEffectiveChange, proposals, decisions, effectiveChanges };
}

function collectEvidence(
  items: ReadonlyArray<{ readonly id: string; readonly evidence?: ReviewItem["evidence"] }>,
): ResolvedReviewReceipt["evidence"] {
  const entries: ResolvedReviewReceipt["evidence"] = [];
  for (const item of items) {
    if (item.evidence) entries.push({ itemId: item.id, evidence: item.evidence });
  }
  return entries;
}

/** Pure durable-prose reader: exactly one `${padded}_*.md`, raw bytes out. */
async function readLatestDurableChapterProse(bookDir: string, chapter: number): Promise<string> {
  const prefix = padChapter(chapter);
  const chaptersDir = join(bookDir, "chapters");
  let fileNames: string[];
  try {
    fileNames = await readdir(chaptersDir);
  } catch {
    throw new StateReviewError(
      "state_review_stale",
      `chapters directory is unreadable for chapter ${chapter}`,
    );
  }
  const matches = fileNames
    .filter((name) => name.startsWith(`${prefix}_`) && name.endsWith(".md"))
    .sort();
  if (matches.length === 0) {
    throw new StateReviewError(
      "state_review_stale",
      `no durable prose file for chapter ${chapter}`,
    );
  }
  if (matches.length > 1) {
    throw new StateReviewError(
      "state_review_stale",
      `ambiguous durable prose files for chapter ${chapter}`,
    );
  }
  try {
    return await readFile(join(chaptersDir, matches[0]!), "utf-8");
  } catch {
    throw new StateReviewError(
      "state_review_stale",
      `durable prose for chapter ${chapter} vanished`,
    );
  }
}

async function readCandidateIndexEntries(
  bookDir: string,
  chapter: number,
): Promise<ChapterMeta[]> {
  let raw: string;
  try {
    raw = await readFile(join(bookDir, "chapters", "index.json"), "utf-8");
  } catch {
    throw new StateReviewError("state_review_not_found", "chapters/index.json is missing");
  }
  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(raw);
  } catch {
    throw new StateReviewError("state_review_conflict", "chapters/index.json is not valid JSON");
  }
  if (!Array.isArray(parsedUnknown)) {
    throw new StateReviewError("state_review_conflict", "chapters/index.json must hold an array");
  }
  const result = ChapterMetaSchema.array().safeParse(parsedUnknown);
  if (!result.success) {
    throw new StateReviewError(
      "state_review_conflict",
      `chapters/index.json failed schema validation: ${result.error.issues[0]?.message ?? "unknown"}`,
    );
  }
  if (!result.data.some((entry) => entry.number === chapter)) {
    throw new StateReviewError(
      "state_review_not_found",
      `chapters/index.json has no entry for chapter ${chapter}`,
    );
  }
  return result.data;
}

/**
 * Compose the complete candidate `story/snapshots/<effectiveChapter>/` mirror:
 * unchanged story slots copied from live disk when present, the three truth
 * projections rendered from the CANDIDATE state, and the four candidate state
 * JSONs embedded under `state/`. Pure reads only — nothing lands on disk here.
 */
async function composeSnapshotWrites(params: {
  readonly bookDir: string;
  readonly effectiveChapter: number;
  readonly snapshot: {
    readonly manifest: unknown;
    readonly currentState: unknown;
    readonly hooks: unknown;
    readonly chapterSummaries: unknown;
  };
  readonly projections: {
    readonly currentStateMarkdown: string;
    readonly hooksMarkdown: string;
    readonly chapterSummariesMarkdown: string;
  };
}): Promise<Array<{ relativePath: string; content: string }>> {
  const prefix = `story/snapshots/${params.effectiveChapter}`;
  const writes: Array<{ relativePath: string; content: string }> = [];

  for (const name of SNAPSHOT_STORY_FILE_NAMES) {
    let content: string | undefined;
    if (name === "current_state.md") content = params.projections.currentStateMarkdown;
    else if (name === "pending_hooks.md") content = params.projections.hooksMarkdown;
    else if (name === "chapter_summaries.md") content = params.projections.chapterSummariesMarkdown;
    else {
      content = await readFile(join(params.bookDir, "story", name), "utf-8").catch(() => undefined);
    }
    if (content !== undefined) writes.push({ relativePath: `${prefix}/${name}`, content });
  }

  const stateDocs: Array<[string, unknown]> = [
    ["manifest.json", params.snapshot.manifest],
    ["current_state.json", params.snapshot.currentState],
    ["hooks.json", params.snapshot.hooks],
    ["chapter_summaries.json", params.snapshot.chapterSummaries],
  ];
  for (const [fileName, doc] of stateDocs) {
    writes.push({
      relativePath: `${prefix}/state/${fileName}`,
      content: JSON.stringify(doc, null, 2),
    });
  }

  return writes;
}

export async function prepareStateReviewConfirm(params: {
  readonly bookDir: string;
  readonly chapter: number;
  readonly expectedReviewRevision: number;
  readonly durableHead: number;
}): Promise<PreparedStateReviewConfirm> {
  // ---- 1. ACTIVE confirmable artifact ------------------------------------
  const loaded = await loadStateReview(params.bookDir, params.chapter);
  if (!loaded) {
    throw new StateReviewError(
      "state_review_not_found",
      `no state review artifact for chapter ${params.chapter}`,
    );
  }
  if (loaded.status === "stale") {
    throw new StateReviewError(
      "state_review_stale",
      `chapter ${params.chapter} state review is stale and must be rebuilt`,
    );
  }
  if (loaded.status !== "active") {
    throw new StateReviewError(
      "state_review_conflict",
      `chapter ${params.chapter} state review is a non-confirmable ${loaded.status} shell`,
    );
  }
  const active = loaded;

  // ---- 2. Optimistic-concurrency on the reviewed revision -----------------
  if (params.expectedReviewRevision !== active.reviewRevision) {
    throw new StateReviewError(
      "state_review_edit_conflict",
      `expected review revision ${params.expectedReviewRevision} but chapter ${params.chapter} review is at revision ${active.reviewRevision}`,
    );
  }

  // ---- 3. Prose anchor revalidation ---------------------------------------
  const durableProse = await readLatestDurableChapterProse(params.bookDir, params.chapter);
  const currentProseRevision = computeProseRevision(durableProse);
  if (currentProseRevision !== active.proseRevision) {
    throw new StateReviewError(
      "state_review_stale",
      `chapter ${params.chapter} prose changed since the proposal was generated`,
    );
  }

  // ---- 4. Canon anchor revalidation (ANY of the four documents) ----------
  const canon = await readStoryCanon(params.bookDir);
  if (canon.revision !== active.baseCanonRevision) {
    throw new StateReviewError(
      "state_review_conflict",
      `live Canon revision ${canon.revision} no longer matches the proposal base ${active.baseCanonRevision}; rebuild required`,
    );
  }

  // ---- 5. Temporal rules §20 against the CURRENT live confirmed head -----
  // The live validated snapshot is the authority; the caller-supplied
  // durableHead must AGREE with it (m-11.1 hardening), so a stale caller
  // number can never steer the temporal derivation.
  const liveSnapshot = await readLiveRuntimeStateSnapshot(params.bookDir);
  if (params.durableHead !== liveSnapshot.manifest.lastAppliedChapter) {
    throw new StateReviewError(
      "state_review_conflict",
      `caller durableHead ${params.durableHead} does not match the live confirmed head ${liveSnapshot.manifest.lastAppliedChapter}`,
    );
  }
  if (params.durableHead >= active.effectiveChapter) {
    throw new StateReviewError(
      "state_review_conflict",
      `confirmed Canon head ${params.durableHead} reached the proposal's effective chapter ${active.effectiveChapter}; the proposal must be rebuilt, not rebased`,
    );
  }
  const expectedEffective = active.sourceChapter <= params.durableHead
    ? params.durableHead + 1
    : active.sourceChapter;
  if (expectedEffective !== active.effectiveChapter) {
    throw new StateReviewError(
      "state_review_conflict",
      `proposal anchors source ${active.sourceChapter} / effective ${active.effectiveChapter}, but confirmed head ${params.durableHead} requires effective ${expectedEffective}`,
    );
  }

  // ---- 6+7. Completeness → compile ONE RuntimeStateDelta ------------------
  // Zero semantic effective changes STILL compile an op-less delta at the
  // effective chapter: confirming a review consumes that temporal slot, so
  // runtime bookkeeping (manifest/current-state progression) must advance.
  const compiled = compileConfirmedDelta({
    items: active.items,
    sourceChapter: active.sourceChapter,
    effectiveChapter: active.effectiveChapter,
    language: active.language,
  });

  // ---- 8. In-memory application over a PURE live snapshot ---------------
  // ALWAYS through the existing reducer path — including op-less deltas for
  // zero-effective confirmations, whose confirmation consumes the effective
  // temporal slot and must advance runtime bookkeeping.
  const resolvedAt = new Date().toISOString();

  let artifacts: ReturnType<typeof buildRuntimeStateArtifactsFromSnapshot>;
  try {
    artifacts = buildRuntimeStateArtifactsFromSnapshot({
      snapshot: liveSnapshot,
      delta: compiled.delta,
      language: active.language,
    });
    const issues = validateRuntimeState(artifacts.snapshot);
    if (issues.length > 0) {
      throw new Error(
        issues.map((issue) => `${issue.code}: ${issue.message}`).join("; "),
      );
    }
  } catch (error) {
    throw new StateReviewError(
      "state_review_invalid_change",
      `confirmed changes were rejected by the runtime engine: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const candidateSnapshot = artifacts.snapshot;
  const resultingCanonRevision = computeCanonRevision(candidateSnapshot);

  // ---- 9. Candidate authoritative material (ALL IN MEMORY) --------------
  const canonWrites = [
    { relativePath: "story/state/manifest.json", content: JSON.stringify(candidateSnapshot.manifest, null, 2) },
    { relativePath: "story/state/current_state.json", content: JSON.stringify(candidateSnapshot.currentState, null, 2) },
    { relativePath: "story/state/hooks.json", content: JSON.stringify(candidateSnapshot.hooks, null, 2) },
    { relativePath: "story/state/chapter_summaries.json", content: JSON.stringify(candidateSnapshot.chapterSummaries, null, 2) },
  ];

  const projectionWrites = [
    { relativePath: "story/current_state.md", content: artifacts.currentStateMarkdown },
    { relativePath: "story/pending_hooks.md", content: artifacts.hooksMarkdown },
    { relativePath: "story/chapter_summaries.md", content: artifacts.chapterSummariesMarkdown },
  ];

  const snapshotWrites = await composeSnapshotWrites({
    bookDir: params.bookDir,
    effectiveChapter: active.effectiveChapter,
    snapshot: candidateSnapshot,
    projections: {
      currentStateMarkdown: artifacts.currentStateMarkdown,
      hooksMarkdown: artifacts.hooksMarkdown,
      chapterSummariesMarkdown: artifacts.chapterSummariesMarkdown,
    },
  });

  const indexEntries = await readCandidateIndexEntries(params.bookDir, params.chapter);
  const candidateIndex = indexEntries.map((entry) =>
    entry.number === params.chapter
      ? { ...entry, status: "approved" as const, updatedAt: resolvedAt }
      : entry,
  );

  const receipt = ResolvedReviewReceiptSchema.parse({
    schemaVersion: 1,
    reviewId: active.reviewId,
    sourceChapter: active.sourceChapter,
    effectiveChapter: active.effectiveChapter,
    proseRevision: active.proseRevision,
    baseCanonRevision: active.baseCanonRevision,
    resultingCanonRevision,
    proposals: [...compiled.proposals],
    decisions: [...compiled.decisions],
    effectiveChanges: [...compiled.effectiveChanges],
    evidence: collectEvidence(active.items),
    resolvedAt,
    resolution: compiled.zeroEffectiveChange ? "confirmed-no-changes" : "confirmed-changes",
  });

  return {
    receipt,
    receiptWrite: {
      relativePath: `${RECEIPTS_DIR(params.chapter)}/${active.reviewId}.json`,
      content: JSON.stringify(receipt, null, 2),
    },
    indexWrite: {
      relativePath: "chapters/index.json",
      content: JSON.stringify(candidateIndex, null, 2),
    },
    canonWrites,
    projectionWrites,
    snapshotWrites,
    deletes: [ACTIVE_REVIEW_RELPATH(params.chapter)],
    resultingCanonRevision,
    effectiveChapter: active.effectiveChapter,
    zeroEffectiveChange: compiled.zeroEffectiveChange,
  };
}
