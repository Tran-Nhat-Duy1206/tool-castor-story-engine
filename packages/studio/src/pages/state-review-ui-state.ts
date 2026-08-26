/**
 * Task 15 — pure UI state model for the human-governed State Review page.
 *
 * Framework-free and side-effect-free (Studio convention: every page pairs a
 * `*-ui-state.ts` model with unit tests, mirroring story-state-model.ts).
 * Everything here shapes Task 14 typed-client DTOs for display; it NEVER
 * invents semantics — Core remains the sole authority on decisions, revisions
 * and lifecycle. No React, no fetch, no Core runtime import (type-only).
 */
import type {
  ActiveStateReviewArtifact,
  ProposalChange,
  ResolvedReviewReceipt,
  ReviewItem,
  StateReviewArtifact,
} from "../lib/state-review-api";
import type {
  StateReviewConfirmOutcome,
  StateReviewMutationOutcome,
} from "../lib/state-review-api";

export type UiLanguage = "zh" | "en";

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** The exact persisted workflow states Core supports (+ absence per GET). */
export type StateReviewLifecycle =
  | "none"
  | "active"
  | "stale"
  | "rebuild_required"
  | "rebuild_failed";

export function lifecycleOf(review: StateReviewArtifact | null): StateReviewLifecycle {
  if (!review) return "none";
  return review.status;
}

// ---------------------------------------------------------------------------
// Kind labels + change summaries (design §26: meaning, never raw JSON)
// ---------------------------------------------------------------------------

const KIND_LABELS: Record<ReviewItem["kind"], { zh: string; en: string }> = {
  "current-state-fact": { zh: "当前状态事实", en: "Current-state fact" },
  "hook-upsert": { zh: "伏笔更新", en: "Hook update" },
  "hook-mention": { zh: "伏笔提及", en: "Hook mention" },
  "hook-resolve": { zh: "伏笔回收", en: "Hook resolve" },
  "hook-defer": { zh: "伏笔推迟", en: "Hook defer" },
  "new-hook-candidate": { zh: "新伏笔候选", en: "New hook candidate" },
  "chapter-summary": { zh: "章节摘要", en: "Chapter summary" },
  note: { zh: "备注", en: "Note" },
};

export function reviewKindLabel(kind: ReviewItem["kind"], lang: UiLanguage): string {
  return KIND_LABELS[kind][lang];
}

function joinNonEmpty(parts: ReadonlyArray<string>): string {
  return parts.filter((part) => part.trim() !== "").join(" · ");
}

/**
 * Readable one-line summary of a typed proposal/effective change.
 * Deterministic field order; unknown future shapes degrade to a labeled
 * type marker instead of crashing or dumping raw JSON structures.
 */
export function describeProposalChange(change: ProposalChange, lang: UiLanguage): string {
  const zh = lang === "zh";
  switch (change.type) {
    case "fact": {
      if (change.change.action === "remove") {
        return zh
          ? `移除事实：${change.change.subject}·${change.change.predicate}`
          : `Remove fact: ${change.change.subject} · ${change.change.predicate}`;
      }
      return joinNonEmpty([
        zh ? "设定事实" : "Set fact",
        `${change.change.subject}·${change.change.predicate}`,
        change.change.object ?? "",
      ]);
    }
    case "hook-upsert":
      return joinNonEmpty([
        zh ? "更新伏笔" : "Update hook",
        change.hook.hookId,
        change.hook.status,
        typeof change.hook.expectedPayoff === "string" ? change.hook.expectedPayoff : "",
      ]);
    case "hook-op":
      return joinNonEmpty([
        zh ? `伏笔操作：${change.op}` : `Hook ${change.op}`,
        change.hookId,
      ]);
    case "new-hook-candidate":
      return joinNonEmpty([
        zh ? "新伏笔候选" : "New hook candidate",
        change.candidate.type,
        change.candidate.expectedPayoff,
        change.candidate.notes,
      ]);
    case "chapter-summary":
      return joinNonEmpty([
        zh ? `第${change.row.chapter}章摘要` : `Ch.${change.row.chapter} summary`,
        change.row.title,
        change.row.events,
      ]);
    case "none":
      return zh ? "无语义变更" : "No semantic change";
    default:
      // Deterministic fallback for shapes this V1 build does not know.
      return `${(change as { type?: string }).type ?? "unknown"}`;
  }
}

// ---------------------------------------------------------------------------
// Domain groups (design §26)
// ---------------------------------------------------------------------------

export type StateReviewGroupKey =
  | "current-state"
  | "hooks-subplots"
  | "chapter-summary"
  | "notes"
  | "user-added";

export interface StateReviewGroupDto {
  key: StateReviewGroupKey;
  zh: string;
  en: string;
  items: ReviewItem[];
}

const HOOK_KINDS: ReadonlyArray<ReviewItem["kind"]> = [
  "hook-upsert",
  "hook-mention",
  "hook-resolve",
  "hook-defer",
  "new-hook-candidate",
];

const GROUP_ORDER: ReadonlyArray<{ key: StateReviewGroupKey; zh: string; en: string }> = [
  { key: "current-state", zh: "当前状态", en: "Current State" },
  { key: "hooks-subplots", zh: "伏笔 / 支线", en: "Hooks / Subplots" },
  { key: "chapter-summary", zh: "章节摘要", en: "Chapter Summary" },
  { key: "notes", zh: "备注", en: "Notes" },
  { key: "user-added", zh: "手动添加的修改", en: "User Added Changes" },
];

/**
 * Route items into the §26 meaning groups. User origin ALWAYS wins (its own
 * section); notes render informationally in their own non-actionable group;
 * hook families + candidates share Hooks/Subplots.
 */
export function groupReviewItems(items: ReadonlyArray<ReviewItem>): StateReviewGroupDto[] {
  const buckets = new Map<StateReviewGroupKey, ReviewItem[]>(GROUP_ORDER.map((g) => [g.key, []]));
  for (const item of items) {
    const key: StateReviewGroupKey =
      item.origin === "user"
        ? "user-added"
        : item.kind === "note"
          ? "notes"
          : item.kind === "current-state-fact"
            ? "current-state"
            : HOOK_KINDS.includes(item.kind)
              ? "hooks-subplots"
              : "chapter-summary"; // chapter-summary is the remaining V1 kind
    buckets.get(key)!.push(item);
  }
  return GROUP_ORDER.map((meta) => ({ ...meta, items: buckets.get(meta.key)! }));
}

// ---------------------------------------------------------------------------
// Progress + completeness (display only — Core stays authoritative)
// ---------------------------------------------------------------------------

/** Actionable = every AI item except notes (user items are auto-reviewed). */
export function actionableItems(items: ReadonlyArray<ReviewItem>): ReviewItem[] {
  return items.filter((item) => !(item.origin === "ai" && item.kind === "note"));
}

export function reviewProgress(items: ReadonlyArray<ReviewItem>): {
  reviewedCount: number;
  total: number;
} {
  const actionable = actionableItems(items);
  const reviewedCount = actionable.filter(
    (item) => item.origin === "user" || item.decision !== "undecided",
  ).length;
  return { reviewedCount, total: actionable.length };
}

export function isReviewComplete(items: ReadonlyArray<ReviewItem>): boolean {
  const { reviewedCount, total } = reviewProgress(items);
  return total > 0 ? reviewedCount === total : true;
}

/**
 * Final Confirm button gate: every actionable item decided AND no invalid
 * user-add draft pending. Display-only — Core re-validates authoritatively.
 */
export function confirmEnabled(items: ReadonlyArray<ReviewItem>, hasInvalidUserDraft: boolean): boolean {
  return !hasInvalidUserDraft && isReviewComplete(items);
}

// ---------------------------------------------------------------------------
// Dispatch payload builders (single place that owns wire shapes)
// ---------------------------------------------------------------------------

export interface ConfirmDispatch {
  readonly reviewId: string;
  readonly expectedReviewRevision: number;
}

/**
 * Final Confirm ALWAYS sends the loaded artifact's reviewId — never confirm
 * by chapter alone (Task 12 identity binding).
 */
export function buildConfirmDispatch(review: ActiveStateReviewArtifact): ConfirmDispatch {
  return { reviewId: review.reviewId, expectedReviewRevision: review.reviewRevision };
}

export interface DecisionDispatch {
  readonly itemId: string;
  readonly decision: "accept" | "reject";
  readonly expectedReviewRevision: number;
  readonly overrideExplicitWarning?: true;
}

export function buildDecisionDispatch(
  itemId: string,
  decision: "accept" | "reject",
  expectedReviewRevision: number,
  options?: { readonly overrideExplicitWarning?: boolean },
): DecisionDispatch {
  return options?.overrideExplicitWarning === true
    ? { itemId, decision, expectedReviewRevision, overrideExplicitWarning: true }
    : { itemId, decision, expectedReviewRevision };
}

/** The explicit second action after the §27 warning modal. */
export function buildRejectAnywayDispatch(itemId: string, expectedReviewRevision: number): DecisionDispatch {
  return buildDecisionDispatch(itemId, "reject", expectedReviewRevision, { overrideExplicitWarning: true });
}

/**
 * Verified-explicit evidence requires the strong rejection friction (§27).
 * Once rejected the item is decided; the modal still guards any RE-reject
 * click because Core repeats the friction until the override is persisted —
 * matching "Final Confirm does NOT repeat the warning" only AFTER persist.
 */
export function explicitRejectNeedsWarning(item: ReviewItem): boolean {
  return item.evidence?.verifiedLevel === "explicit";
}

// ---------------------------------------------------------------------------
// Zero-change layout switch (design §19)
// ---------------------------------------------------------------------------

/**
 * Zero-change ACTIVE review: no actionable proposals at all (notes are not
 * proposals). Still requires an EXPLICIT "Confirm No Changes".
 */
export function isZeroChangeReview(review: ActiveStateReviewArtifact): boolean {
  return actionableItems(review.items).length === 0;
}

// ---------------------------------------------------------------------------
// Banners
// ---------------------------------------------------------------------------

export interface HistoricalBannerView {
  readonly sourceChapter: number;
  readonly effectiveChapter: number;
}

/**
 * Historical correction banner (design §28): visible when the confirmed
 * effect lands at a slot BEYOND the reviewed source chapter. `head` comes
 * from workspace data (manifest.lastAppliedChapter).
 */
export function historicalBannerView(
  review: ActiveStateReviewArtifact,
  head: number,
): HistoricalBannerView | null {
  void head; // kept in the signature: callers pass workspace data; slot math below uses anchors only
  if (review.effectiveChapter > review.sourceChapter) {
    return { sourceChapter: review.sourceChapter, effectiveChapter: review.effectiveChapter };
  }
  return null;
}

export interface RebuildFailedBannerView {
  readonly reason: string;
  readonly actions: ReadonlyArray<"retry-audit" | "edit-chapter">;
}

export function rebuildFailedBannerView(shell: Extract<StateReviewArtifact, { status: "rebuild_failed" }>): RebuildFailedBannerView {
  return { reason: shell.reason, actions: ["retry-audit", "edit-chapter"] };
}

// ---------------------------------------------------------------------------
// Receipt chips
// ---------------------------------------------------------------------------

export interface ReceiptChipDto {
  readonly reviewId: string;
  readonly resolution: ResolvedReviewReceipt["resolution"];
  readonly resolvedAt: string;
}

export function receiptChips(receipts: ReadonlyArray<ResolvedReviewReceipt>): ReceiptChipDto[] {
  return receipts.map((receipt) => ({
    reviewId: receipt.reviewId,
    resolution: receipt.resolution,
    resolvedAt: receipt.resolvedAt,
  }));
}

// ---------------------------------------------------------------------------
// Mutation outcome → UI view
// ---------------------------------------------------------------------------

/** Frozen Core message marker for the §27 friction (never parse more than this). */
const EXPLICIT_EVIDENCE_MARKER = "explicit-evidence-warning-required";

export type MutationTone =
  | "success"
  | "conflict"
  | "locked"
  | "explicit-warning-required"
  | "error";

export interface MutationOutcomeView {
  readonly tone: MutationTone;
  readonly success: boolean;
  /** CAS conflicts ⇒ refetch the authoritative artifact; never auto-retry. */
  readonly refetchLatest: boolean;
  /** Lock contention is retryable by the human, never by automation. */
  readonly retryable: boolean;
  readonly autoRetry: false;
  readonly itemId?: string;
  readonly message: string;
}

export function isExplicitEvidenceWarningRequired(view: MutationOutcomeView): boolean {
  return view.tone === "explicit-warning-required";
}

export function mutationOutcomeToUi(
  outcome: StateReviewMutationOutcome,
  _lang: UiLanguage,
): MutationOutcomeView {
  void _lang; // server messages are already bilingual-sanitized; reserved for future copy
  if (outcome.ok) {
    return {
      tone: "success",
      success: true,
      refetchLatest: true, // adopt the authoritative artifact from the response
      retryable: false,
      autoRetry: false,
      message: "",
    };
  }
  if (outcome.code === "state_review_invalid_change" && outcome.message.includes(EXPLICIT_EVIDENCE_MARKER)) {
    return {
      tone: "explicit-warning-required",
      success: false,
      refetchLatest: false,
      retryable: false,
      autoRetry: false,
      ...(outcome.itemId !== undefined ? { itemId: outcome.itemId } : {}),
      message: outcome.message,
    };
  }
  if (outcome.code === "state_review_edit_conflict") {
    return {
      tone: "conflict",
      success: false,
      refetchLatest: true,
      retryable: false,
      autoRetry: false,
      ...(outcome.itemId !== undefined ? { itemId: outcome.itemId } : {}),
      message: outcome.message,
    };
  }
  if (outcome.code === "book_write_locked") {
    return {
      tone: "locked",
      success: false,
      refetchLatest: false,
      retryable: true,
      autoRetry: false,
      message: outcome.message,
    };
  }
  return {
    tone: "error",
    success: false,
    refetchLatest: false,
    retryable: false,
    autoRetry: false,
    ...(outcome.itemId !== undefined ? { itemId: outcome.itemId } : {}),
    message: outcome.message,
  };
}

// ---------------------------------------------------------------------------
// Confirm outcome → UI view (Task 12 semantics are load-bearing)
// ---------------------------------------------------------------------------

export type ConfirmTone =
  | "success"
  | "warning-success"
  | "conflict-reload"
  | "locked"
  | "error";

export interface ConfirmOutcomeView {
  readonly tone: ConfirmTone;
  /** resolved AND already_resolved AND warnings variants are ALL successes. */
  readonly success: boolean;
  /** Leave/deactivate the active review surface (artifact is gone or stale). */
  readonly leaveActiveState: boolean;
  /** Refresh the chapter index/status so the badge leaves needs-state-review. */
  readonly refreshChapter: boolean;
  /** Superseded generation: offer explicit Reload / Retry-Audit choices. */
  readonly offerRebuildChoice: boolean;
  readonly warnings: ReadonlyArray<string>;
  readonly resultingCanonRevision?: string;
  readonly message: string;
}

export function confirmOutcomeToUi(
  outcome: StateReviewConfirmOutcome,
  _lang: UiLanguage,
): ConfirmOutcomeView {
  void _lang;
  if (outcome.ok) {
    const hasWarnings = outcome.warnings.length > 0;
    return {
      tone: hasWarnings ? "warning-success" : "success",
      success: true,
      leaveActiveState: true,
      refreshChapter: true,
      offerRebuildChoice: false,
      warnings: [...outcome.warnings],
      resultingCanonRevision: outcome.resultingCanonRevision,
      message: "",
    };
  }
  if (outcome.code === "book_write_locked") {
    return {
      tone: "locked",
      success: false,
      leaveActiveState: false,
      refreshChapter: false,
      offerRebuildChoice: false,
      warnings: [],
      message: outcome.message,
    };
  }
  if (
    outcome.code === "state_review_not_found"
    || outcome.code === "state_review_stale"
    || outcome.code === "state_review_conflict"
    || outcome.code === "state_review_edit_conflict"
  ) {
    return {
      tone: "conflict-reload",
      success: false,
      leaveActiveState: false,
      refreshChapter: false,
      offerRebuildChoice: true,
      warnings: [],
      message: outcome.message,
    };
  }
  return {
    tone: "error",
    success: false,
    leaveActiveState: false,
    refreshChapter: false,
    offerRebuildChoice: false,
    warnings: [],
    message: outcome.message,
  };
}
