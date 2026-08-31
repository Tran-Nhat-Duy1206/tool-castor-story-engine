import { describe, expect, it } from "vitest";
import type {
  ActiveStateReviewArtifact,
  ResolvedReviewReceipt,
  ReviewItem,
} from "../lib/state-review-api";
import {
  buildConfirmDispatch,
  buildDecisionDispatch,
  buildRejectAnywayDispatch,
  confirmEnabled,
  confirmOutcomeToUi,
  describeProposalChange,
  explicitRejectNeedsWarning,
  groupReviewItems,
  historicalBannerView,
  isExplicitEvidenceWarningRequired,
  isReviewComplete,
  isZeroChangeReview,
  lifecycleOf,
  mutationOutcomeToUi,
  receiptChips,
  rebuildFailedBannerView,
  rejectAllUiPatch,
  reviewProgress,
  reviewKindLabel,
} from "./state-review-ui-state";

const factItem = (overrides: Partial<ReviewItem> = {}): ReviewItem => ({
  id: "item-fact",
  kind: "current-state-fact",
  origin: "ai",
  title: "Current-state update: mock_val",
  proposal: { type: "fact", change: { action: "set", subject: "mock_val", predicate: "mock_val", object: "mock_val" } },
  evidence: { claimedLevel: "explicit", verifiedLevel: "explicit", quote: "mock_val" },
  decision: "undecided",
  ...overrides,
});

const hookItem = (overrides: Partial<ReviewItem> = {}): ReviewItem => ({
  id: "item-hook",
  kind: "hook-upsert",
  origin: "ai",
  title: "Hook update: mock_val",
  proposal: {
    type: "hook-upsert",
    hook: {
      hookId: "hook-lighthouse",
      startChapter: 13,
      type: "core_mystery",
      status: "progressing",
      lastAdvancedChapter: 13,
      expectedPayoff: "mock_val",
      notes: "mock_val",
    },
  },
  decision: "undecided",
  ...overrides,
});

const candidateItem = (overrides: Partial<ReviewItem> = {}): ReviewItem => ({
  id: "item-candidate",
  kind: "new-hook-candidate",
  origin: "ai",
  title: "New hook candidate: mock_val",
  proposal: {
    type: "new-hook-candidate",
    candidate: {
      type: "core_mystery",
      expectedPayoff: "mock_val",
      notes: "Chương 13mock_val",
    },
  },
  decision: "undecided",
  ...overrides,
});

const opItem = (overrides: Partial<ReviewItem> = {}): ReviewItem => ({
  id: "item-op",
  kind: "hook-resolve",
  origin: "ai",
  title: "Hook resolve: mock_val",
  proposal: { type: "hook-op", op: "resolve", hookId: "hook-ledger" },
  decision: "undecided",
  ...overrides,
});

const summaryItem = (overrides: Partial<ReviewItem> = {}): ReviewItem => ({
  id: "item-summary",
  kind: "chapter-summary",
  origin: "ai",
  title: "Chapter summary: ch 13 mock_val",
  proposal: {
    type: "chapter-summary",
    row: {
      chapter: 13,
      title: "mock_val",
      characters: "mock_val；mock_val",
      events: "mock_val",
      stateChanges: "mock_val→mock_val",
      hookActivity: "",
      mood: "mock_val",
      chapterType: "mock_val",
    },
  },
  decision: "undecided",
  ...overrides,
});

const noteItem = (overrides: Partial<ReviewItem> = {}): ReviewItem => ({
  id: "item-note",
  kind: "note",
  origin: "ai",
  title: "Reviewer note",
  // A note's ONLY legal payload is {type:"none"} (frozen KIND_CHANGE_COMPAT);
  // its text travels in `detail`.
  proposal: { type: "none" },
  detail: "mock_val",
  decision: "undecided",
  ...overrides,
});

const userFactItem = (overrides: Partial<ReviewItem> = {}): ReviewItem =>
  factItem({ id: "item-user", origin: "user", decision: "accepted", ...overrides });

const activeReview = (items: ReviewItem[], overrides: Partial<ActiveStateReviewArtifact> = {}): ActiveStateReviewArtifact => ({
  status: "active",
  schemaVersion: 1,
  sourceChapter: 16,
  createdAt: "2026-08-24T00:00:00.000Z",
  language: "vi",
  reviewId: "3f2504e0-4f89-41d3-9a0c-0305e82c3303",
  effectiveChapter: 26,
  proseRevision: "0123456789abcdef",
  baseCanonRevision: "fedcba9876543210",
  reviewRevision: 7,
  items,
  ...overrides,
});

describe("groupReviewItems (design §26 domain groups)", () => {
  it("routes every V1 kind into its meaning group and user origin into User Added", () => {
    const groups = groupReviewItems([
      factItem(),
      hookItem(),
      candidateItem(),
      opItem(),
      summaryItem(),
      noteItem(),
      userFactItem(),
    ]);
    const byKey = new Map(groups.map((group) => [group.key, group.items.map((item) => item.id)]));
    expect(byKey.get("current-state")).toEqual(["item-fact"]);
    expect(byKey.get("hooks-subplots")).toEqual(["item-hook", "item-candidate", "item-op"]);
    expect(byKey.get("chapter-summary")).toEqual(["item-summary"]);
    expect(byKey.get("user-added")).toEqual(["item-user"]);
    expect(byKey.get("notes")).toEqual(["item-note"]);
  });

  it("keeps empty groups present so section headers stay stable", () => {
    const keys = groupReviewItems([factItem()]).map((group) => group.key);
    expect(keys).toEqual(["current-state", "hooks-subplots", "chapter-summary", "notes", "user-added"]);
  });
});

describe("reviewKindLabel + describeProposalChange", () => {
  it("labels every V1 kind bilingually without inventing families", () => {
    expect(reviewKindLabel("current-state-fact", "en")).toMatch(/fact/i);
    expect(reviewKindLabel("new-hook-candidate", "vi")).toBeTruthy();
    expect(reviewKindLabel("note", "en")).toMatch(/note/i);
  });

  it("summarizes typed changes readably and falls back deterministically", () => {
    expect(describeProposalChange(factItem().proposal, "en")).toContain("mock_val");
    expect(describeProposalChange(factItem().proposal, "en")).toContain("mock_val");
    expect(describeProposalChange(opItem().proposal, "en")).toContain("hook-ledger");
    expect(describeProposalChange({ type: "none" }, "vi")).toBeTruthy();
    // Unknown future shape must never crash the page.
    expect(describeProposalChange({ type: "time-travel" } as never, "en")).toContain("time-travel");
  });
});

describe("reviewProgress / isReviewComplete (notes never block)", () => {
  it("counts only actionable AI + user items; notes are excluded from total", () => {
    const progress = reviewProgress([
      factItem({ decision: "accepted" }),
      hookItem(), // undecided
      noteItem(), // must not count
      userFactItem(), // auto-reviewed
    ]);
    expect(progress).toEqual({ reviewedCount: 2, total: 3 });
    expect(isReviewComplete([
      factItem({ decision: "accepted" }),
      noteItem(),
      userFactItem(),
    ])).toBe(true);
    expect(isReviewComplete([hookItem()])).toBe(false);
  });

  it("gates Final Confirm on completeness and invalid user drafts", () => {
    const complete = [factItem({ decision: "edited", editedChange: factItem().proposal }), userFactItem()];
    expect(confirmEnabled(complete, false)).toBe(true);
    expect(confirmEnabled(complete, true)).toBe(false); // invalid in-progress user form blocks
    expect(confirmEnabled([summaryItem()], false)).toBe(false);
  });
});

describe("buildConfirmDispatch — Final Confirm always carries the loaded reviewId", () => {
  it("sends reviewId + currently observed expectedReviewRevision", () => {
    const review = activeReview([factItem({ decision: "accepted" })]);
    expect(buildConfirmDispatch(review)).toEqual({
      reviewId: "3f2504e0-4f89-41d3-9a0c-0305e82c3303",
      expectedReviewRevision: 7,
    });
  });
});

describe("decision dispatches", () => {
  it("accept/reject carry itemId, decision and the observed revision — no override by default", () => {
    expect(buildDecisionDispatch("item-a", "accept", 4)).toEqual({
      itemId: "item-a",
      decision: "accept",
      expectedReviewRevision: 4,
    });
    expect("overrideExplicitWarning" in buildDecisionDispatch("item-a", "reject", 4)).toBe(false);
  });

  it("the Reject Anyway dispatch carries overrideExplicitWarning:true explicitly", () => {
    expect(buildDecisionDispatch("item-a", "reject", 4, { overrideExplicitWarning: true })).toEqual({
      itemId: "item-a",
      decision: "reject",
      expectedReviewRevision: 4,
      overrideExplicitWarning: true,
    });
    expect(buildRejectAnywayDispatch("item-a", 4)).toEqual({
      itemId: "item-a",
      decision: "reject",
      expectedReviewRevision: 4,
      overrideExplicitWarning: true,
    });
  });

  it("flags exactly verified-explicit evidence as needing the warning modal", () => {
    expect(explicitRejectNeedsWarning(factItem())).toBe(true);
    expect(explicitRejectNeedsWarning(factItem({
      evidence: { claimedLevel: "explicit", verifiedLevel: "inferred" },
    }))).toBe(false);
    expect(explicitRejectNeedsWarning(hookItem())).toBe(false);
    expect(explicitRejectNeedsWarning(factItem({ decision: "rejected" }))).toBe(true);
  });

  it("detects the frozen Core explicit-evidence marker on mapped failures", () => {
    const blocked = mutationOutcomeToUi({
      ok: false,
      code: "state_review_invalid_change",
      itemId: "item-fact",
      message:
        "explicit-evidence-warning-required: item has verified explicit prose evidence; pass overrideExplicitWarning to Reject Anyway",
    }, "en");
    expect(isExplicitEvidenceWarningRequired(blocked)).toBe(true);
    expect(blocked.tone).toBe("explicit-warning-required");
    expect(blocked.itemId).toBe("item-fact");
  });
});

describe("rejectAllUiPatch — §6 batch flow (review C1 regression)", () => {
  const frictionOutcome = {
    ok: false as const,
    code: "state_review_invalid_change",
    itemId: "item-fact",
    message:
      "explicit-evidence-warning-required: batch includes verified explicit AI proposals; pass overrideExplicitWarning to Reject Anyway",
  };

  it("an explicit-evidence outcome ARMS the dialog and it STAYS armed (never disarmed by the request lifecycle)", () => {
    // C1 regression pin: previously the page's `finally` block reset the
    // armed flag after the arming branch returned, making the §6 dialog
    // unreachable whenever a verified-explicit item existed.
    const patch = rejectAllUiPatch({ armed: false }, frictionOutcome, "vi");
    expect(patch.armed).toBe(true);
    expect(patch.adoptArtifact).toBe(false);
    expect(patch.refetchLatest).toBe(false);
  });

  it("a successful batch keeps nothing armed and adopts the authoritative artifact", () => {
    const patch = rejectAllUiPatch(
      { armed: true },
      { ok: true, artifact: activeReview([]) },
      "en",
    );
    expect(patch).toEqual({ armed: false, adoptArtifact: true, refetchLatest: false });
  });

  it("a CAS conflict disarms without adopting and demands a refetch", () => {
    const patch = rejectAllUiPatch(
      { armed: true },
      { ok: false, code: "state_review_edit_conflict", message: "moved" },
      "en",
    );
    expect(patch).toEqual({ armed: false, adoptArtifact: false, refetchLatest: true });
  });
});

describe("mutationOutcomeToUi — CAS conflicts refresh, locks stay retryable", () => {
  it("maps edit_conflict to a conflict that demands refetch and forbids silent retries", () => {
    const view = mutationOutcomeToUi({
      ok: false,
      code: "state_review_edit_conflict",
      message: "revision moved",
    }, "vi");
    expect(view.tone).toBe("conflict");
    expect(view.refetchLatest).toBe(true);
    expect(view.autoRetry).toBe(false);
  });

  it("maps book_write_locked to a retryable non-destructive state", () => {
    const view = mutationOutcomeToUi({ ok: false, code: "book_write_locked", message: "busy" }, "en");
    expect(view.tone).toBe("locked");
    expect(view.retryable).toBe(true);
    expect(view.refetchLatest).toBe(false);
  });

  it("success tells the caller to adopt the authoritative artifact", () => {
    const view = mutationOutcomeToUi(
      { ok: true, artifact: activeReview([]) },
      "en",
    );
    expect(view.tone).toBe("success");
    expect(view.refetchLatest).toBe(true);
  });
});

describe("confirmOutcomeToUi — resolved-with-warnings stays SUCCESS", () => {
  const receipt: ResolvedReviewReceipt = {
    schemaVersion: 1,
    reviewId: "3f2504e0-4f89-41d3-9a0c-0305e82c3303",
    sourceChapter: 16,
    effectiveChapter: 26,
    proseRevision: "0123456789abcdef",
    baseCanonRevision: "fedcba9876543210",
    resultingCanonRevision: "1111222233334444",
    proposals: [],
    decisions: [],
    effectiveChanges: [],
    evidence: [],
    resolvedAt: "2026-08-24T01:00:00.000Z",
    resolution: "confirmed-changes",
  };

  it("resolved without warnings is plain success and leaves the active state", () => {
    const view = confirmOutcomeToUi({ ok: true, status: "resolved", receipt, resultingCanonRevision: "x", warnings: [] }, "vi");
    expect(view.tone).toBe("success");
    expect(view.refreshChapter).toBe(true);
    expect(view.leaveActiveState).toBe(true);
  });

  it("resolved WITH warnings is still success — never an error, never retried", () => {
    const view = confirmOutcomeToUi(
      { ok: true, status: "resolved", receipt, resultingCanonRevision: "x", warnings: ["derived memory invalidation failed"] },
      "en",
    );
    expect(view.tone).toBe("warning-success");
    expect(view.success).toBe(true);
    expect(view.warnings).toContain("derived memory invalidation failed");
    expect(view.refreshChapter).toBe(true);
  });

  it("already_resolved is idempotent success, not failure", () => {
    const view = confirmOutcomeToUi({ ok: true, status: "already_resolved", receipt, resultingCanonRevision: "x", warnings: [] }, "vi");
    expect(view.tone).toBe("success");
    expect(view.success).toBe(true);
    expect(view.leaveActiveState).toBe(true);
  });

  it("superseded-generation not_found demands reload/rebuild choice without auto-shift", () => {
    const view = confirmOutcomeToUi({ ok: false, code: "state_review_not_found", message: "superseded" }, "en");
    expect(view.tone).toBe("conflict-reload");
    expect(view.refreshChapter).toBe(false);
    expect(view.offerRebuildChoice).toBe(true);
  });

  it("lock conflicts during confirm remain retryable", () => {
    expect(confirmOutcomeToUi({ ok: false, code: "book_write_locked", message: "busy" }, "vi").tone).toBe("locked");
  });
});

describe("zero-change layout switch", () => {
  it("activates only for ACTIVE reviews with zero actionable items — notes do not count", () => {
    expect(isZeroChangeReview(activeReview([]))).toBe(true);
    expect(isZeroChangeReview(activeReview([noteItem()]))).toBe(true);
    expect(isZeroChangeReview(activeReview([factItem()]))).toBe(false);
  });
});

describe("banner selectors", () => {
  it("historical banner shows when the correction lands beyond the source chapter", () => {
    const review = activeReview([factItem({ decision: "accepted" })]);
    const banner = historicalBannerView(review, 25);
    expect(banner).not.toBeNull();
    expect(banner?.effectiveChapter).toBe(26);
    expect(banner?.sourceChapter).toBe(16);

    // Same-chapter pending review (healthy flow) never shows the banner.
    const current = activeReview([factItem()], { sourceChapter: 26, effectiveChapter: 26 });
    expect(historicalBannerView(current, 25)).toBeNull();
  });

  it("rebuild_failed banner exposes the sanitized reason plus Retry Audit / Edit Chapter", () => {
    const view = rebuildFailedBannerView({
      status: "rebuild_failed",
      schemaVersion: 1,
      sourceChapter: 13,
      createdAt: "2026-08-24T00:00:00.000Z",
      language: "vi",
      reason: "injected analyzer outage",
    });
    expect(view.reason).toBe("injected analyzer outage");
    expect(view.actions).toEqual(["retry-audit", "edit-chapter"]);
  });
});

describe("lifecycleOf + receipt chips", () => {
  it("maps GET absence and each persisted workflow status", () => {
    expect(lifecycleOf(null)).toBe("none");
    expect(lifecycleOf(activeReview([]))).toBe("active");
    expect(lifecycleOf(activeReview([], { status: "stale" } as never))).toBe("stale");
    expect(lifecycleOf({
      status: "rebuild_required", schemaVersion: 1, sourceChapter: 13,
      createdAt: "2026-08-24T00:00:00.000Z", language: "vi", reason: "",
    })).toBe("rebuild_required");
    expect(lifecycleOf({
      status: "rebuild_failed", schemaVersion: 1, sourceChapter: 13,
      createdAt: "2026-08-24T00:00:00.000Z", language: "vi", reason: "x",
    })).toBe("rebuild_failed");
  });

  it("chips receipts as resolved or superseded with their timestamps", () => {
    const base = {
      schemaVersion: 1 as const,
      sourceChapter: 13,
      effectiveChapter: 13,
      proseRevision: "0123456789abcdef",
      baseCanonRevision: "fedcba9876543210",
      resultingCanonRevision: "1111222233334444",
      proposals: [],
      decisions: [],
      effectiveChanges: [],
      evidence: [],
    };
    const chips = receiptChips([
      { ...base, reviewId: "3f2504e0-4f89-41d3-9a0c-0305e82c3303", resolvedAt: "2026-08-24T01:00:00.000Z", resolution: "confirmed-changes" },
      { ...base, reviewId: "3f2504e0-4f89-41d3-9a0c-0305e82c3304", resolvedAt: "2026-08-24T02:00:00.000Z", resolution: "superseded" },
      { ...base, reviewId: "3f2504e0-4f89-41d3-9a0c-0305e82c3305", resolvedAt: "2026-08-24T03:00:00.000Z", resolution: "confirmed-no-changes" },
    ] as ResolvedReviewReceipt[]);
    expect(chips.map((chip) => chip.resolution)).toEqual(["confirmed-changes", "superseded", "confirmed-no-changes"]);
    expect(chips.every((chip) => chip.resolvedAt.includes("2026-08-24"))).toBe(true);
  });
});
