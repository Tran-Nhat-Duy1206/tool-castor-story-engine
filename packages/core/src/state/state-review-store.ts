import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import {
  CurrentStateStateSchema,
  ChapterSummariesStateSchema,
  HooksStateSchema,
  StateManifestSchema,
} from "../models/runtime-state.js";
import {
  ActiveStateReviewArtifact,
  ResolvedReviewReceiptSchema,
  StateReviewArtifactSchema,
  StateReviewError,
  type ResolvedReviewReceipt,
  type StateReviewArtifact,
  type StateReviewShellArtifact,
} from "../models/state-review.js";
import type { RuntimeStateSnapshot } from "./state-reducer.js";
import { validateRuntimeState } from "./state-validator.js";

/**
 * Task 3 — state review artifact + receipt store (+ pure live runtime-state
 * reader). Persistence is confined to `story/runtime/**`; NOTHING here ever
 * writes `story/state/**`, projections, snapshots, or memory.db.
 *
 * Read paths are PURE: no bootstrap, no healing, no Markdown fallback, no
 * manifest rewrite. Corrupt/missing-required input fails closed.
 */

// ---------------------------------------------------------------------------
// Frozen path layout (spec §13 / §23)
// ---------------------------------------------------------------------------

/** Active/shell artifact for a source chapter: story/runtime/chapter-NNNN.state-review.json */
export const ACTIVE_REVIEW_RELPATH = (chapter: number): string =>
  `story/runtime/chapter-${String(chapter).padStart(4, "0")}.state-review.json`;

/** Receipt directory for a SOURCE chapter: story/runtime/state-review-receipts/chapter-NNNN */
export const RECEIPTS_DIR = (chapter: number): string =>
  `story/runtime/state-review-receipts/chapter-${String(chapter).padStart(4, "0")}`;

/**
 * Receipt filenames are derived from caller-supplied reviewIds — restrict to
 * the same lowercase uuid-v4 shape the active-artifact schema enforces so a
 * hostile id can never traverse paths.
 */
function isSafeReviewId(reviewId: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(reviewId);
}

// ---------------------------------------------------------------------------
// Atomic single-file write (tmp sibling → rename over target, Windows-safe)
// ---------------------------------------------------------------------------

async function writeFileAtomic(
  bookDir: string,
  relativePath: string,
  content: string,
  renameFile: (from: string, to: string) => Promise<void> = rename,
): Promise<void> {
  const target = join(bookDir, relativePath);
  await mkdir(dirname(target), { recursive: true });
  const tmpPath = `${target}.tmp-${randomUUID()}`;
  try {
    await writeFile(tmpPath, content, "utf-8");
    await renameFile(tmpPath, target);
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function serializeJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

// ---------------------------------------------------------------------------
// Artifact load/save
// ---------------------------------------------------------------------------

/** Missing artifact ⇒ null; existing ⇒ schema-parsed; malformed ⇒ FAIL CLOSED. */
export async function loadStateReview(
  bookDir: string,
  chapter: number,
): Promise<StateReviewArtifact | null> {
  let raw: string;
  try {
    raw = await readFile(join(bookDir, ACTIVE_REVIEW_RELPATH(chapter)), "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return StateReviewArtifactSchema.parse(JSON.parse(raw));
}

/** Persist a NON-CONFIRMABLE workflow shell (rebuild_required | rebuild_failed). */
export async function saveStateReviewShell(
  bookDir: string,
  shell: StateReviewShellArtifact,
): Promise<void> {
  const parsed = StateReviewArtifactSchema.parse(shell);
  if (parsed.status !== "rebuild_required" && parsed.status !== "rebuild_failed") {
    throw new StateReviewError(
      "state_review_invalid_change",
      "saveStateReviewShell requires a rebuild_required/rebuild_failed shell",
    );
  }
  await writeFileAtomic(bookDir, ACTIVE_REVIEW_RELPATH(parsed.sourceChapter), serializeJson(parsed));
}

/** Persist an ACTIVE confirmable proposal (or its stale successor, same shape). */
export async function publishActiveProposal(
  bookDir: string,
  proposal: ActiveStateReviewArtifact,
): Promise<void> {
  const parsed = StateReviewArtifactSchema.parse(proposal);
  if (parsed.status !== "active" && parsed.status !== "stale") {
    throw new StateReviewError(
      "state_review_invalid_change",
      "publishActiveProposal requires an active/stale proposal",
    );
  }
  await writeFileAtomic(bookDir, ACTIVE_REVIEW_RELPATH(parsed.sourceChapter), serializeJson(parsed));
}

// ---------------------------------------------------------------------------
// reviewRevision CAS primitive
// ---------------------------------------------------------------------------

/**
 * Generation identity + concurrency/temporal anchors that a CAS mutation may
 * NEVER alter (spec §13): reviewId identifies the durable generation (and
 * later receipt idempotency); source/effective/prose/canon anchors bind the
 * proposal to its exact chapter, prose bytes and Canon revision. Only
 * review-workflow content (`items`, decisions) is mutable.
 */
const FROZEN_ACTIVE_FIELDS = [
  "schemaVersion",
  "reviewId",
  "sourceChapter",
  "effectiveChapter",
  "proseRevision",
  "baseCanonRevision",
  "createdAt",
  "language",
] as const;

function assertActiveGenerationUnchanged(
  before: ActiveStateReviewArtifact,
  after: ActiveStateReviewArtifact,
): void {
  for (const field of FROZEN_ACTIVE_FIELDS) {
    if (before[field] !== after[field]) {
      throw new StateReviewError(
        "state_review_invalid_change",
        `mutation attempted to change immutable field "${field}" of review ${before.reviewId}`,
      );
    }
  }
}

/**
 * Store-level compare-and-swap over `reviewRevision`.
 *
 * - missing artifact            ⇒ state_review_not_found
 * - shell or stale artifact     ⇒ state_review_stale
 * - revision mismatch           ⇒ state_review_edit_conflict (ZERO writes)
 * - success                     ⇒ store sets reviewRevision = expected + 1
 *   (the mutate callback NEVER chooses the revision), re-validates, and
 *   atomically replaces the file. No internal retry of stale revisions.
 *
 * Concurrency ownership stays with the CALLER's book lock; this primitive adds
 * no second lock layer. `deps.renameFile` exists solely for failure-injection
 * tests (same seam convention as commitAtomicFileSet).
 */
export async function mutateActiveProposal(params: {
  readonly bookDir: string;
  readonly chapter: number;
  readonly expectedReviewRevision: number;
  readonly mutate: (active: ActiveStateReviewArtifact) => ActiveStateReviewArtifact;
  readonly deps?: { readonly renameFile?: (from: string, to: string) => Promise<void> };
}): Promise<ActiveStateReviewArtifact> {
  const loaded = await loadStateReview(params.bookDir, params.chapter);
  if (!loaded) {
    throw new StateReviewError(
      "state_review_not_found",
      `no state review artifact for chapter ${params.chapter}`,
    );
  }
  if (loaded.status !== "active") {
    throw new StateReviewError(
      "state_review_stale",
      `chapter ${params.chapter} state review is not editable (status: ${loaded.status})`,
    );
  }
  if (loaded.reviewRevision !== params.expectedReviewRevision) {
    throw new StateReviewError(
      "state_review_edit_conflict",
      `expected reviewRevision ${params.expectedReviewRevision}, found ${loaded.reviewRevision}`,
    );
  }

  const mutated = params.mutate(loaded);
  // Fail closed BEFORE any filesystem write if the callback touched immutable
  // generation identity/anchors — never silently restore and continue.
  assertActiveGenerationUnchanged(loaded, mutated);
  const candidate = StateReviewArtifactSchema.parse({
    ...mutated,
    reviewRevision: params.expectedReviewRevision + 1,
  });
  if (candidate.status !== "active") {
    throw new StateReviewError(
      "state_review_invalid_change",
      "mutation attempted to demote an active proposal",
    );
  }
  await writeFileAtomic(
    params.bookDir,
    ACTIVE_REVIEW_RELPATH(params.chapter),
    serializeJson(candidate),
    params.deps?.renameFile,
  );
  return candidate;
}

// ---------------------------------------------------------------------------
// Receipt store
// ---------------------------------------------------------------------------

function receiptRelativePath(chapter: number, reviewId: string): string {
  return `${RECEIPTS_DIR(chapter)}/${reviewId}.json`;
}

/**
 * Look up one resolved receipt by its generation id. Missing ⇒ null; corrupt
 * content or an identity mismatch between filename/content/chapter FAILS
 * CLOSED rather than returning plausible-looking data.
 */
export async function findReceiptByReviewId(
  bookDir: string,
  chapter: number,
  reviewId: string,
): Promise<ResolvedReviewReceipt | null> {
  if (!isSafeReviewId(reviewId)) return null;
  let raw: string;
  try {
    raw = await readFile(join(bookDir, receiptRelativePath(chapter, reviewId)), "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const receipt = ResolvedReviewReceiptSchema.parse(JSON.parse(raw));
  if (receipt.reviewId !== reviewId || receipt.sourceChapter !== chapter) {
    throw new Error(
      `receipt identity mismatch under ${receiptRelativePath(chapter, reviewId)}`,
    );
  }
  return receipt;
}

/**
 * Deterministic receipt history for a chapter, sorted by resolvedAt ascending
 * with reviewId as tie-breaker. Missing directory ⇒ []; corrupt files throw.
 */
export async function listReceiptsForChapter(
  bookDir: string,
  chapter: number,
): Promise<ResolvedReviewReceipt[]> {
  let fileNames: string[];
  try {
    fileNames = await readdir(join(bookDir, RECEIPTS_DIR(chapter)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const receipts = await Promise.all(
    fileNames
      .filter((name) => name.endsWith(".json"))
      .map((name) => readFile(join(bookDir, RECEIPTS_DIR(chapter), name), "utf-8")),
  );
  return receipts
    .map((raw) => ResolvedReviewReceiptSchema.parse(JSON.parse(raw)))
    .sort((left, right) =>
      left.resolvedAt.localeCompare(right.resolvedAt) || left.reviewId.localeCompare(right.reviewId),
    );
}

/**
 * Durably record a resolved receipt (atomic single-file write). Receipts are
 * immutable history:
 * - byte-identical rewrite of the SAME content is an idempotent no-op;
 * - any DIFFERENT content under an existing reviewId refuses to overwrite.
 * Task 12 owns confirmation-level idempotency; this guard keeps the store from
 * casually mutating resolved history.
 */
export async function writeResolvedReceipt(
  bookDir: string,
  chapter: number,
  receipt: ResolvedReviewReceipt,
): Promise<string> {
  const parsed = ResolvedReviewReceiptSchema.parse(receipt);
  if (!isSafeReviewId(parsed.reviewId)) {
    throw new StateReviewError(
      "state_review_invalid_change",
      `reviewId is not a safe receipt filename: ${parsed.reviewId}`,
    );
  }
  if (parsed.sourceChapter !== chapter) {
    throw new StateReviewError(
      "state_review_invalid_change",
      `receipt sourceChapter ${parsed.sourceChapter} does not match directory chapter ${chapter}`,
    );
  }
  const relativePath = receiptRelativePath(chapter, parsed.reviewId);
  const content = serializeJson(parsed);
  const target = join(bookDir, relativePath);
  const existing = await readFile(target, "utf-8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (existing !== null) {
    if (existing === content) return relativePath;
    throw new Error(
      `refusing to overwrite already-resolved receipt ${relativePath} with different content`,
    );
  }
  await writeFileAtomic(bookDir, relativePath, content);
  return relativePath;
}

/**
 * PURE supersession builder (spec §23 lifecycle transition): reads current
 * receipts and returns serialized write entries flipping ONLY
 * `resolution: "superseded"` (+ optional `supersededBy`). The caller commits
 * these inside its own authoritative transaction — this function writes
 * NOTHING. Already-superseded receipts are left untouched and omitted.
 * All historical fields (anchors, proposals, decisions, effectiveChanges,
 * evidence, resolvedAt) are preserved byte-for-byte through the spread.
 */
export async function supersedeReceiptsForChapter(params: {
  readonly bookDir: string;
  readonly chapter: number;
  readonly supersededBy?: string;
}): Promise<Array<{ readonly relativePath: string; readonly content: string }>> {
  const receipts = await listReceiptsForChapter(params.bookDir, params.chapter);
  const entries: Array<{ relativePath: string; content: string }> = [];
  for (const receipt of receipts) {
    if (receipt.resolution === "superseded") continue;
    const next: ResolvedReviewReceipt = {
      ...receipt,
      resolution: "superseded",
      ...(params.supersededBy ? { supersededBy: params.supersededBy } : {}),
    };
    entries.push({
      relativePath: receiptRelativePath(params.chapter, receipt.reviewId),
      content: serializeJson(next),
    });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Pure live runtime-state reader (for PREPARE — plan blocker-6 freeze)
// ---------------------------------------------------------------------------

async function readStructuredFile<T>(
  path: string,
  label: string,
  schema: { parse(value: unknown): T },
): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (error) {
    throw new Error(`runtime state unreadable: ${label} (${String(error)})`);
  }
  try {
    return schema.parse(JSON.parse(raw));
  } catch (error) {
    throw new Error(`runtime state unreadable: ${label} (${String(error)})`);
  }
}

/**
 * PURE reader of the four canonical structured live-state files.
 *
 * Deliberately does NOT use `loadRuntimeStateSnapshot` (which runs
 * `bootstrapStructuredStateFromMarkdown` — a WRITING/healing loader) and has
 * NO Markdown fallback, NO mkdir, NO manifest normalization, NO snapshot
 * creation, NO memory.db access. Missing or corrupt structured canon throws
 * `runtime state unreadable: <file>` so PREPARE can never silently heal or
 * half-read Canon state. Validation mirrors the persisted-state contract via
 * `validateRuntimeState`.
 */
export async function readLiveRuntimeStateSnapshot(
  bookDir: string,
): Promise<RuntimeStateSnapshot> {
  const stateDir = join(bookDir, "story", "state");
  const manifest = await readStructuredFile(
    join(stateDir, "manifest.json"), "story/state/manifest.json", StateManifestSchema,
  );
  const currentState = await readStructuredFile(
    join(stateDir, "current_state.json"), "story/state/current_state.json", CurrentStateStateSchema,
  );
  const hooks = await readStructuredFile(
    join(stateDir, "hooks.json"), "story/state/hooks.json", HooksStateSchema,
  );
  const chapterSummaries = await readStructuredFile(
    join(stateDir, "chapter_summaries.json"), "story/state/chapter_summaries.json", ChapterSummariesStateSchema,
  );

  const issues = validateRuntimeState({ manifest, currentState, hooks, chapterSummaries });
  if (issues.length > 0) {
    throw new Error(
      `runtime state unreadable: story/state/* failed validation (${issues.map((issue) => issue.message).join("; ")})`,
    );
  }
  return { manifest, currentState, hooks, chapterSummaries };
}
