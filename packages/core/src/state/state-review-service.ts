import {
  ProposalChangeSchema,
  StateReviewError,
  stateReviewItemId,
  type ActiveStateReviewArtifact,
  type ProposalChange,
  type ReviewItem,
  type ReviewItemKind,
} from "../models/state-review.js";
import { mutateActiveProposal } from "./state-review-store.js";

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
