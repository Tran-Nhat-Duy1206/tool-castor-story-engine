import {
  mkdir, readFile, readdir,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  ProposalChangeSchema,
  StateReviewArtifactSchema,
  StateReviewError,
  stateReviewItemId,
  type ActiveStateReviewArtifact,
  type ProposalChange,
  type ReviewItem,
  type ReviewItemKind,
  type StateReviewShellArtifact,
} from "../models/state-review.js";
import type { ChapterMeta } from "../models/chapter.js";
import type { RuntimeStateDelta, RuntimeStateLanguage } from "../models/runtime-state.js";
import { buildStateReviewItems } from "./state-review-items.js";
import {
  ACTIVE_REVIEW_RELPATH,
  loadStateReview,
  publishActiveProposal,
  readLiveRuntimeStateSnapshot,
  saveStateReviewShell,
  supersedeReceiptsForChapter,
} from "./state-review-store.js";
import { readStoryCanon } from "./canon-service.js";
import { computeProseRevision } from "../utils/prose-revision.js";
import { mutateActiveProposal } from "./state-review-store.js";
import { resolveEffectiveChapter } from "./state-review-temporal.js";

/**
 * Task 8 — human State Review DECISION mutations (Phase 4).
 *
 * Every mutation goes through the Task 3 CAS primitive `mutateActiveProposal`
 * with a caller-mandated `expectedReviewRevision`; the store owns conflict /
 * stale / missing semantics, sets reviewRevision = expected + 1 itself, and
 * atomically replaces ONLY
 * `story/runtime/chapter-NNNN.state-review.json`.
 *
 * Layer discipline (spec §7, plan blocker-7):
 * - AI-owned layers (id/kind/origin/proposal/evidence) are NEVER rewritten.
 *   Accept keeps the proposal; Edit stores the human variant in the decision
 *   layer (`editedChange`) NEXT TO the preserved proposal; Reject retains both.
 * - There is NO reducer application here and no second derived truth: the
 *   effective change is ALWAYS resolved PURELY by
 *   `resolveReviewItemEffectiveChange`.
 *
 * Kind↔payload compatibility IS owned by this module (Task 8 plan): an edited
 * or user-authored change must match the item's review kind against the REAL
 * Task 1 `ProposalChange` discriminants, else `state_review_invalid_change`
 * with ZERO writes. This does not retroactively re-validate Task 4 converter
 * output, which constructs these pairs by construction.
 */

/** Optional failure-injection seam (same convention as mutateActiveProposal). */
export interface StateReviewMutationDeps {
  readonly renameFile?: (from: string, to: string) => Promise<void>;
}

function casDeps(deps?: StateReviewMutationDeps): { readonly renameFile?: (from: string, to: string) => Promise<void> } {
  return deps?.renameFile ? { renameFile: deps.renameFile } : {};
}

type CasMutation = Parameters<typeof mutateActiveProposal>[0]["mutate"];

// ---------------------------------------------------------------------------
// Kind ↔ payload compatibility (pure)
// ---------------------------------------------------------------------------

const KIND_CHANGE_COMPAT: Record<ReviewItemKind, (change: ProposalChange) => boolean> = {
  "current-state-fact": (change) => change.type === "fact",
  "hook-upsert": (change) => change.type === "hook-upsert",
  "hook-mention": (change) => change.type === "hook-op" && change.op === "mention",
  "hook-resolve": (change) => change.type === "hook-op" && change.op === "resolve",
  "hook-defer": (change) => change.type === "hook-op" && change.op === "defer",
  "new-hook-candidate": (change) => change.type === "new-hook-candidate",
  "chapter-summary": (change) => change.type === "chapter-summary",
  // A note's only legal payload stays `{type:"none"}` — it can never become a
  // semantic mutation through any human edit path.
  "note": (change) => change.type === "none",
};

function parseTypedChange(change: unknown, itemId: string | undefined, label: string): ProposalChange {
  const parsed = ProposalChangeSchema.safeParse(change);
  if (!parsed.success) {
    throw new StateReviewError(
      "state_review_invalid_change",
      `${label} is not a valid ProposalChange: ${parsed.error.issues[0]?.message ?? "unknown"}`,
      itemId,
    );
  }
  return parsed.data;
}

function assertKindChangeCompatible(kind: ReviewItemKind, change: ProposalChange, itemId?: string): void {
  if (!KIND_CHANGE_COMPAT[kind](change)) {
    throw new StateReviewError(
      "state_review_invalid_change",
      `review item kind "${kind}" cannot carry a "${change.type}" change`,
      itemId,
    );
  }
}

// ---------------------------------------------------------------------------
// Item lookup inside a CAS callback (zero-write on miss: the throw happens
// BEFORE the store performs its atomic replacement).
// ---------------------------------------------------------------------------

function requireItem(items: ReadonlyArray<ReviewItem>, itemId: string): ReviewItem {
  const item = items.find((entry) => entry.id === itemId);
  if (!item) {
    throw new StateReviewError(
      "state_review_not_found",
      `no state review item ${itemId}`,
      itemId,
    );
  }
  return item;
}

function replaceItem(active: ActiveStateReviewArtifact, next: ReviewItem): ActiveStateReviewArtifact {
  return {
    ...active,
    items: active.items.map((item) => (item.id === next.id ? next : item)),
  };
}

/**
 * Frozen-design verified-explicit friction (spec §6): rejecting a
 * prose-supported verified-explicit AI proposal requires one explicit override
 * flag ("Reject Anyway"). Determination uses ONLY the already-verified Task 4
 * evidence metadata — no AI rerun, no fuzzy logic. The error carries the
 * machine-readable marker so Studio can render the warning.
 */
function assertExplicitRejectionAllowed(
  item: ReviewItem,
  overrideExplicitWarning: boolean,
): void {
  if (
    !overrideExplicitWarning
    && item.evidence?.verifiedLevel === "explicit"
  ) {
    throw new StateReviewError(
      "state_review_invalid_change",
      "explicit-evidence-warning-required: item has verified explicit prose "
        + "evidence; pass overrideExplicitWarning to Reject Anyway",
      item.id,
    );
  }
}

// ---------------------------------------------------------------------------
// Public decision APIs
// ---------------------------------------------------------------------------

export async function decideStateReviewItem(params: {
  readonly bookDir: string;
  readonly chapter: number;
  readonly itemId: string;
  readonly decision: "accept" | "reject";
  readonly expectedReviewRevision: number;
  readonly overrideExplicitWarning?: boolean;
  readonly deps?: StateReviewMutationDeps;
}): Promise<ActiveStateReviewArtifact> {
  const casMutation: CasMutation = (active) => {
    const item = requireItem(active.items, params.itemId);
    if (params.decision === "reject") {
      assertExplicitRejectionAllowed(item, params.overrideExplicitWarning ?? false);
    }
    return replaceItem(active, {
      ...item,
      // Decision layer ONLY: proposal/evidence/editedChange are preserved as-is.
      decision: params.decision === "accept" ? "accepted" : "rejected",
    });
  };
  return mutateActiveProposal({
    bookDir: params.bookDir,
    chapter: params.chapter,
    expectedReviewRevision: params.expectedReviewRevision,
    mutate: casMutation,
    deps: casDeps(params.deps),
  });
}

export async function editStateReviewItem(params: {
  readonly bookDir: string;
  readonly chapter: number;
  readonly itemId: string;
  readonly expectedReviewRevision: number;
  readonly editedChange: ProposalChange;
  readonly deps?: StateReviewMutationDeps;
}): Promise<ActiveStateReviewArtifact> {
  const casMutation: CasMutation = (active) => {
    const item = requireItem(active.items, params.itemId);
    // Validate the typed semantic shape FIRST, then kind/payload compat.
    const typed = parseTypedChange(params.editedChange, item.id, `edited change for ${item.id}`);
    assertKindChangeCompatible(item.kind, typed, item.id);
    return replaceItem(active, {
      ...item,
      // Immediately reviewed; the immutable AI/user proposal stays untouched.
      decision: "edited",
      editedChange: typed,
    });
  };
  return mutateActiveProposal({
    bookDir: params.bookDir,
    chapter: params.chapter,
    expectedReviewRevision: params.expectedReviewRevision,
    mutate: casMutation,
    deps: casDeps(params.deps),
  });
}

export async function addUserStateReviewItem(params: {
  readonly bookDir: string;
  readonly chapter: number;
  readonly expectedReviewRevision: number;
  readonly kind: ReviewItemKind;
  readonly change: ProposalChange;
  readonly title: string;
  readonly deps?: StateReviewMutationDeps;
}): Promise<ActiveStateReviewArtifact> {
  const casMutation: CasMutation = (active) => {
    const typed = parseTypedChange(params.change, undefined, "added user change");
    assertKindChangeCompatible(params.kind, typed);
    // Pinned ID scheme (plan Task 8): stateReviewItemId("user", seq, payload),
    // made collision-free within THIS artifact by bumping the sequence until
    // unused; the id is then stable for the lifetime of the generation.
    let seq = active.items.filter((entry) => entry.origin === "user").length;
    let id = stateReviewItemId("user", seq, typed);
    while (active.items.some((entry) => entry.id === id)) {
      seq += 1;
      id = stateReviewItemId("user", seq, typed);
    }
    const item: ReviewItem = {
      id,
      kind: params.kind,
      origin: "user",
      title: params.title,
      proposal: typed,
      // User additions are complete authoring acts: immediately decided.
      decision: "accepted",
    };
    return { ...active, items: [...active.items, item] };
  };
  return mutateActiveProposal({
    bookDir: params.bookDir,
    chapter: params.chapter,
    expectedReviewRevision: params.expectedReviewRevision,
    mutate: casMutation,
    deps: casDeps(params.deps),
  });
}

export async function removeUserStateReviewItem(params: {
  readonly bookDir: string;
  readonly chapter: number;
  readonly itemId: string;
  readonly expectedReviewRevision: number;
  readonly deps?: StateReviewMutationDeps;
}): Promise<ActiveStateReviewArtifact> {
  const casMutation: CasMutation = (active) => {
    const item = requireItem(active.items, params.itemId);
    if (item.origin !== "user") {
      // AI proposals are historical/audit records: Reject them instead.
      throw new StateReviewError(
        "state_review_invalid_change",
        `only user-added items can be removed; item ${item.id} has origin "${item.origin}"`,
        item.id,
      );
    }
    return { ...active, items: active.items.filter((entry) => entry.id !== item.id) };
  };
  return mutateActiveProposal({
    bookDir: params.bookDir,
    chapter: params.chapter,
    expectedReviewRevision: params.expectedReviewRevision,
    mutate: casMutation,
    deps: casDeps(params.deps),
  });
}

export async function rejectAllAiItems(params: {
  readonly bookDir: string;
  readonly chapter: number;
  readonly expectedReviewRevision: number;
  readonly overrideExplicitWarning?: boolean;
  readonly deps?: StateReviewMutationDeps;
}): Promise<ActiveStateReviewArtifact> {
  const casMutation: CasMutation = (active) => {
    // Batch scope: actionable AI items only — notes stay informational and
    // user-added items are never silently rejected or deleted.
    const targets = active.items.filter((entry) => entry.origin === "ai" && entry.kind !== "note");
    const flippingExplicit = targets.find((entry) =>
      entry.decision !== "rejected"
      && entry.evidence?.verifiedLevel === "explicit"
    );
    if (flippingExplicit && !(params.overrideExplicitWarning ?? false)) {
      throw new StateReviewError(
        "state_review_invalid_change",
        "explicit-evidence-warning-required: batch includes verified explicit "
          + "AI proposals; pass overrideExplicitWarning to Reject Anyway",
        flippingExplicit.id,
      );
    }
    return {
      ...active,
      items: active.items.map((entry) =>
        entry.origin === "ai" && entry.kind !== "note"
          ? { ...entry, decision: "rejected" as const }
          : entry
      ),
    };
  };
  return mutateActiveProposal({
    bookDir: params.bookDir,
    chapter: params.chapter,
    expectedReviewRevision: params.expectedReviewRevision,
    mutate: casMutation,
    deps: casDeps(params.deps),
  });
}

/**
 * Task 9 — state-relevant prose-save invalidation (PURE orchestration input).
 *
 * Durable chapter prose is about to change, so the old State Review meaning is
 * no longer confirmable. This function performs ONLY reads + pure string
 * assembly and hands the caller the exact entries to commit in ONE
 * `commitAtomicFileSet` together with the new prose and the updated chapter
 * index:
 *
 * - `shellWrite` replaces (create-or-replace) the chapter's review artifact
 *   with a NON-CONFIRMABLE `rebuild_required` shell carrying only the shell
 *   schema fields — no reviewId, no reviewRevision, no items, no active-only
 *   anchors. All prior AI/user decisions die with the old proposal; Task 3
 *   refuses shell mutation, so nothing stale stays confirmable.
 * - `receiptWrites` are the PURE Task 3 supersession entries flipping this
 *   chapter's currently resolved receipts to `resolution:"superseded"`
 *   (already-superseded history untouched). No fresh reviewId exists here, so
 *   `supersededBy` is deliberately NOT set.
 * - `indexEntryUpdate` flips the edited chapter's lifecycle status to
 *   needs-state-review (+updatedAt) and nothing else.
 *
 * Fail-closed: a corrupt existing ACTIVE artifact or corrupt receipt history
 * throws before any transaction inputs exist. Canon, projections, snapshots,
 * later chapters and receipt semantic payloads are never touched by design.
 */
export async function handleStateRelevantProseSave(params: {
  readonly bookDir: string;
  readonly chapter: number;
  readonly language: RuntimeStateLanguage;
}): Promise<{
  readonly indexEntryUpdate: (entry: ChapterMeta) => ChapterMeta;
  readonly shellWrite: { relativePath: string; content: string };
  readonly receiptWrites: ReadonlyArray<{ relativePath: string; content: string }>;
}> {
  // Fail closed on a corrupt artifact BEFORE building any replacement input;
  // a missing artifact is fine (fresh invalidation for legacy/first edits).
  await loadStateReview(params.bookDir, params.chapter);

  const createdAt = new Date().toISOString();
  const parsedShell = StateReviewArtifactSchema.safeParse({
    schemaVersion: 1,
    status: "rebuild_required",
    sourceChapter: params.chapter,
    createdAt,
    language: params.language,
    reason: "",
  });
  if (!parsedShell.success || parsedShell.data.status !== "rebuild_required") {
    throw new StateReviewError(
      "state_review_invalid_change",
      `failed to construct rebuild_required shell for chapter ${params.chapter}`
        + `${parsedShell.success ? "" : `: ${parsedShell.error.issues[0]?.message ?? "unknown"}`}`,
    );
  }
  return {
    indexEntryUpdate: (entry: ChapterMeta): ChapterMeta =>
      entry.number === params.chapter
        ? { ...entry, status: "needs-state-review", updatedAt: createdAt }
        : entry,
    shellWrite: {
      relativePath: ACTIVE_REVIEW_RELPATH(params.chapter),
      content: JSON.stringify(parsedShell.data, null, 2),
    },
    receiptWrites: await supersedeReceiptsForChapter({
      bookDir: params.bookDir,
      chapter: params.chapter,
    }),
  };
}

/** Latest DURABLE chapter prose, read fresh from disk on every rebuild
 * attempt (frozen rule: Retry Audit runs from latest saved prose). */
async function readLatestDurableChapterProse(bookDir: string, chapter: number): Promise<string> {
  const chaptersDir = join(bookDir, "chapters");
  const padded = String(chapter).padStart(4, "0");
  let entries: string[];
  try {
    entries = await readdir(chaptersDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new StateReviewError(
        "state_review_not_found",
        `chapter ${chapter} prose not found: no chapters directory`,
      );
    }
    throw error;
  }
  const fileName = entries.find((name) => name.startsWith(`${padded}_`) && name.endsWith(".md"));
  if (!fileName) {
    throw new StateReviewError("state_review_not_found", `chapter ${chapter} prose file not found`);
  }
  return readFile(join(chaptersDir, fileName), "utf-8");
}

function sanitizeRebuildFailureReason(error: unknown): string {
  const raw = typeof error === "object" && error !== null && "message" in error
    ? String((error as { message?: unknown }).message ?? "")
    : String(error ?? "");
  const trimmed = raw.trim().replace(/\s+/g, " ").slice(0, 300);
  return trimmed.length > 0 ? trimmed : "unknown rebuild failure";
}

/**
 * Task 10 — rebuild a FRESH ACTIVE State Review from LATEST durable inputs.
 *
 * Frozen semantics (plan Task 10):
 * - Authorized ONLY from `rebuild_required` / `rebuild_failed` shells. An
 *   ACTIVE artifact ⇒ `state_review_already_resolved`, `stale` ⇒
 *   `state_review_stale`, missing artifact ⇒ `state_review_not_found` — all
 *   with ZERO writes.
 * - Inputs are read fresh from disk EVERY attempt: durable chapter bytes ⇒
 *   `proseRevision`, pure `readStoryCanon` ⇒ `baseCanonRevision`, and the
 *   temporal anchor follows design §20 using the CONFIRMED Canon head
 *   (`manifest.lastAppliedChapter` via the pure
 *   `readLiveRuntimeStateSnapshot`): `source <= confirmedHead` ⇒
 *   `effectiveChapter = confirmedHead + 1` (historical / READY-head
 *   corrections), otherwise `effectiveChapter = source` (a pending current
 *   chapter N over confirmed N-1 anchors at N, NOT N+1 — durable file counts
 *   are never used as proof of confirmed semantics). Nothing is reused from
 *   the destroyed proposal, its decisions, or any receipt.
 * - `analyze()` is the ONLY AI seam (production wires the real chapter
 *   analyzer via a thin adapter; tests inject fakes). An analyze THROW
 *   durably converts the shell to `rebuild_failed` (reason = sanitized
 *   original message) and raises
 *   `StateReviewError("state_review_rebuild_failed")`; prose/Canon/index are
 *   untouched by that conversion. Precondition/read failures fail closed
 *   BEFORE any write and do NOT touch the shell.
 * - On success: brand-new `reviewId = randomUUID()` per generation,
 *   `reviewRevision = 1`, items built EXCLUSIVELY by Task 4
 *   `buildStateReviewItems` (all undecided, origin "ai"; zero items remain
 *   valid) — NO decision carry-forward of any kind. Item IDs stay Task 4
 *   deterministic: generation identity comes solely from the fresh reviewId.
 * - Publication uses only the Task 3 atomic store seams. A publication
 *   failure propagates WITHOUT writing anything — the prior shell remains,
 *   never a falsely successful active proposal.
 *
 * Caller owns the book lock (same convention as Task 9): anchor reads →
 * analysis → publication must not race other mutations.
 */
export async function rebuildStateReview(params: {
  readonly bookDir: string;
  readonly chapter: number;
  readonly language: RuntimeStateLanguage;
  readonly analyze: (input: { readonly chapterContent: string }) => Promise<RuntimeStateDelta>;
}): Promise<{ readonly artifact: ActiveStateReviewArtifact }> {
  // ---- Authorization (zero-write fail-closed preconditions) ---------------
  const existing = await loadStateReview(params.bookDir, params.chapter);
  if (!existing) {
    throw new StateReviewError(
      "state_review_not_found",
      `no state review artifact for chapter ${params.chapter}`,
    );
  }
  if (existing.status === "active") {
    throw new StateReviewError(
      "state_review_already_resolved",
      `chapter ${params.chapter} already has an active state review`,
    );
  }
  if (existing.status === "stale") {
    throw new StateReviewError(
      "state_review_stale",
      `chapter ${params.chapter} review artifact is stale`,
    );
  }
  // remaining statuses: rebuild_required | rebuild_failed shells

  // ---- Fresh durable inputs (latest prose + latest live Canon + head) -----
  const durableProse = await readLatestDurableChapterProse(params.bookDir, params.chapter);
  const proseRevision = computeProseRevision(durableProse);
  const canonView = await readStoryCanon(params.bookDir);
  // Design §20: anchor by CONFIRMED Canon head — never by durable file counts,
  // which include the unresolved pending chapter itself.
  const confirmedHead = (await readLiveRuntimeStateSnapshot(params.bookDir)).manifest.lastAppliedChapter;
  const effectiveChapter = resolveEffectiveChapter(params.chapter, confirmedHead);

  // ---- Analysis (the single AI seam; failure ⇒ durable rebuild_failed) ----
  let delta: RuntimeStateDelta;
  try {
    delta = await params.analyze({ chapterContent: durableProse });
  } catch (error) {
    const reason = sanitizeRebuildFailureReason(error);
    await saveStateReviewShell(params.bookDir, {
      schemaVersion: 1,
      status: "rebuild_failed",
      sourceChapter: params.chapter,
      createdAt: new Date().toISOString(),
      language: params.language,
      reason,
    });
    throw new StateReviewError("state_review_rebuild_failed", reason);
  }

  // ---- Fresh generation: Task-4 items only, no decision carry-forward -----
  const parsedArtifact = StateReviewArtifactSchema.safeParse({
    schemaVersion: 1,
    status: "active",
    reviewId: randomUUID(),
    sourceChapter: params.chapter,
    effectiveChapter,
    createdAt: new Date().toISOString(),
    language: params.language,
    proseRevision,
    baseCanonRevision: canonView.revision,
    reviewRevision: 1,
    items: buildStateReviewItems(delta, {
      chapterContent: durableProse,
      language: params.language,
    }),
  });
  if (!parsedArtifact.success || parsedArtifact.data.status !== "active") {
    throw new StateReviewError(
      "state_review_invalid_change",
      "rebuilt proposal failed active-artifact validation"
        + `${parsedArtifact.success ? "" : `: ${parsedArtifact.error.issues[0]?.message ?? "unknown"}`}`,
    );
  }
  await publishActiveProposal(params.bookDir, parsedArtifact.data);
  return { artifact: parsedArtifact.data };
}
