/**
 * Task 12 — AUTHORITATIVE FINAL CONFIRM TRANSACTION.
 *
 * `confirmStateReview` is the mechanical publication + idempotency +
 * concurrency boundary for human-confirmed state reviews. It is deliberately
 * SEMANTICALLY DUMB: all interpretation (completeness, resolver semantics,
 * delta compilation, reducer application, candidate Canon/projections/
 * snapshots/index/receipt construction) belongs to
 * {@link prepareStateReviewConfirm} (Task 11), which this module invokes
 * EXACTLY ONCE per non-idempotent attempt.
 *
 * LOCK OWNERSHIP: this public entry point OWNS the book mutation lock exactly
 * once (Task 10 wrapper pattern). The same lock spans receipt-first lookup →
 * live head derivation → PREPARE → effective-slot collision validation → the
 * single {@link commitAtomicFileSet}. Callers (HTTP routes, CLI) must NOT wrap
 * it in a second acquire.
 *
 * ORDERING CONTRACT (all inside the lock):
 * 1. Receipt-first idempotency — a resolved receipt for the REQUESTED
 *    reviewId short-circuits to an `already_resolved` result with ZERO writes,
 *    ZERO revalidation and ZERO derived-sync reruns. A lost response after a
 *    successful confirmation therefore retries safely even though the active
 *    artifact no longer exists, and a stale `expectedReviewRevision` can never
 *    defeat idempotency.
 * 2. Active-artifact presence (`state_review_not_found` otherwise).
 * 3. Identity binding — requested reviewId must equal the ACTIVE generation's
 *    reviewId, or the confirm fails closed naming the superseding generation.
 * 4. PREPARE once, deriving `durableHead` from the CURRENT validated live
 *    snapshot (`manifest.lastAppliedChapter`, the confirmed-head semantics of
 *    the Task 10 fix-up) unless the caller explicitly overrides.
 * 5. I-11.2 effective-slot/snapshot collision guard — EVERY candidate
 *    snapshot output target must be ABSENT on disk while the lock is held.
 *    Any pre-existing material at the target that is not explained by the
 *    same resolved reviewId (complete set, partial set, corrupt leftovers) is
 *    a hard `state_review_conflict`: no overwrite, no merge, no repair.
 *    Same-review retries never reach here because step 1 returns first.
 * 6. ONE atomic transaction commits canon + projections + snapshots + receipt
 *    + index writes and removes the ACTIVE artifact in the same file set.
 * 7. Post-commit derived memory synchronization (P3 pattern). Derived failure
 *    NEVER rolls back authoritative state: the derived store is invalidated
 *    (quarantined when deletion fails) and an honest warning is surfaced in
 *    `warnings` instead.
 */
import { basename, dirname, join } from "node:path";
import { stat } from "node:fs/promises";
import { commitAtomicFileSet } from "../utils/atomic-file-set.js";
import { StateManager } from "./manager.js";
import {
  findReceiptByReviewId,
  loadStateReview,
  readLiveRuntimeStateSnapshot,
} from "./state-review-store.js";
import { prepareStateReviewConfirm } from "./state-review-confirm.js";
import {
  invalidateDerivedMemory,
  rebuildCurrentStateFactHistory,
  rebuildNarrativeMemoryIndex,
} from "./memory-sync.js";
import { StateReviewError, type ResolvedReviewReceipt } from "../models/state-review.js";

/** Typed result allowing callers to distinguish NEWLY CONFIRMED vs IDEMPOTENT. */
export interface ConfirmStateReviewResult {
  /** `"resolved"` = this call performed the authoritative commit; `"already_resolved"` = pure receipt hit. */
  readonly status: "resolved" | "already_resolved";
  readonly receipt: ResolvedReviewReceipt;
  readonly resultingCanonRevision: string;
  /** Non-empty only when the AUTHORITATIVE commit succeeded but derived sync degraded. */
  readonly warnings: ReadonlyArray<string>;
}

export interface ConfirmStateReviewParams {
  readonly bookDir: string;
  readonly chapter: number;
  /** REQUIRED — keys both idempotency (receipt lookup) and identity binding. */
  readonly reviewId: string;
  readonly expectedReviewRevision: number;
  /**
   * Optional explicit confirmed head override (tests). Production callers omit
   * it: the live validated snapshot's `manifest.lastAppliedChapter` is derived
   * under the lock, completing Task 11's caller/live equality defense.
   */
  readonly durableHead?: number;
  /** Failure-injection seam for the atomic rename primitive (tests only). */
  readonly deps?: { readonly renameFile?: (from: string, to: string) => Promise<void> };
}

export async function confirmStateReview(
  params: ConfirmStateReviewParams,
): Promise<ConfirmStateReviewResult> {
  const manager = new StateManager(dirname(params.bookDir));
  const release = await manager.acquireBookLock(basename(params.bookDir));
  try {
    // ---- 1/2. RECEIPT-FIRST IDEMPOTENCY (before ANY other validation) -----
    const resolved = await findReceiptByReviewId(
      params.bookDir,
      params.chapter,
      params.reviewId,
    );
    if (resolved) {
      return {
        status: "already_resolved",
        receipt: resolved,
        resultingCanonRevision: resolved.resultingCanonRevision,
        warnings: [],
      };
    }

    // ---- 3. Active artifact presence --------------------------------------
    const active = await loadStateReview(params.bookDir, params.chapter);
    if (!active || active.status !== "active") {
      throw new StateReviewError(
        "state_review_not_found",
        `no active state review for chapter ${params.chapter}; nothing to confirm`,
      );
    }

    // ---- 4. Identity binding (fail closed on stale generations) -----------
    if (active.reviewId !== params.reviewId) {
      throw new StateReviewError(
        "state_review_not_found",
        `requested review ${params.reviewId} does not match the active generation ${active.reviewId}; refusing to confirm a superseded proposal`,
      );
    }

    // ---- 5. PREPARE exactly once, under the LIVE confirmed head ------------
    const durableHead = params.durableHead
      ?? (await readLiveRuntimeStateSnapshot(params.bookDir)).manifest.lastAppliedChapter;
    const prepared = await prepareStateReviewConfirm({
      bookDir: params.bookDir,
      chapter: params.chapter,
      expectedReviewRevision: params.expectedReviewRevision,
      durableHead,
    });
    if (prepared.receipt.reviewId !== params.reviewId) {
      throw new StateReviewError(
        "state_review_not_found",
        `prepared receipt ${prepared.receipt.reviewId} does not match requested review ${params.reviewId}`,
      );
    }

    // ---- 5b. I-11.2 EFFECTIVE-SLOT / SNAPSHOT COLLISION GUARD --------------
    // Every candidate snapshot OUTPUT target must be absent. Pre-existing
    // material that the same resolved reviewId does NOT explain (complete or
    // partial sets, legacy/manual leftovers) fails closed — no overwrite, no
    // merge, no repair. Same-review retries returned at step 1.
    for (const write of prepared.snapshotWrites) {
      let occupied = false;
      try {
        await stat(join(params.bookDir, write.relativePath));
        occupied = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (occupied) {
        throw new StateReviewError(
          "state_review_conflict",
          `effective snapshot target ${write.relativePath} already exists; effective slot ${prepared.effectiveChapter} is already committed and must not be overwritten`,
        );
      }
    }

    // ---- 6. ONE authoritative transaction ---------------------------------
    await commitAtomicFileSet({
      rootDir: params.bookDir,
      writes: [
        ...prepared.canonWrites,
        ...prepared.projectionWrites,
        ...prepared.snapshotWrites,
        prepared.receiptWrite,
        prepared.indexWrite,
      ],
      deletes: [prepared.deletes[0]!],
      ...(params.deps?.renameFile ? { renameFile: params.deps.renameFile } : {}),
    });

    // ---- 7. POST-COMMIT derived synchronization (never authoritative) ------
    const warnings: string[] = [];
    try {
      await rebuildNarrativeMemoryIndex(params.bookDir);
      await rebuildCurrentStateFactHistory(params.bookDir, prepared.effectiveChapter - 1);
    } catch {
      const invalidation = await invalidateDerivedMemory(params.bookDir);
      if (invalidation.strategy === "failed" && invalidation.warning) {
        warnings.push(invalidation.warning);
      }
    }

    return {
      status: "resolved",
      receipt: prepared.receipt,
      resultingCanonRevision: prepared.resultingCanonRevision,
      warnings,
    };
  } finally {
    await release();
  }
}
