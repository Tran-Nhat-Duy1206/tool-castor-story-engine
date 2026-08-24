import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ChapterSummariesStateSchema,
  CurrentStateStateSchema,
  HooksStateSchema,
  StateManifestSchema,
} from "../models/runtime-state.js";
import type { CanonEdit, CanonCommitRequest } from "../models/canon-edits.js";
import { validateRuntimeState, type RuntimeStateValidationIssue } from "./state-validator.js";
import { applyManualCurrentStateEdits, resolveFactPredicateKey } from "./state-reducer.js";
import { resolveDurableStoryProgress } from "./state-bootstrap.js";
import { renderCurrentStateProjection } from "./state-projections.js";
import { buildSnapshotFileSet, isSnapshotComplete } from "./snapshot-set.js";
import {
  invalidateDerivedMemory,
  rebuildCurrentStateFactHistory,
  rebuildNarrativeMemoryIndex,
} from "./memory-sync.js";
import { commitAtomicFileSet } from "../utils/atomic-file-set.js";
import type {
  ChapterSummariesState,
  CurrentStateState,
  HooksState,
  StateManifest,
} from "../models/runtime-state.js";

/**
 * Read-only Core boundary over the canonical structured runtime state
 * (`story/state/*.json`).
 *
 * This is the ONLY sanctioned entry point for non-pipeline consumers (Studio
 * server, tooling) that need to inspect canonical story state. It adds no
 * storage of its own: `story/state/*.json` remains the single Canon store,
 * and markdown projections stay derived views.
 *
 * PURITY CONTRACT — the READ path performs ZERO filesystem writes:
 * - no bootstrap from markdown projections
 * - no repair / regeneration / re-serialization of state files
 * - no mkdir, no file creation
 * A healthy canonical book is only ever opened for reading. Markdown
 * projections are NEVER used as fallback canon here; missing or invalid
 * structured state raises {@link CanonUnavailableError} instead. (The
 * pipeline's `loadRuntimeStateSnapshot` keeps its own bootstrap behavior;
 * this boundary deliberately does not share it.)
 *
 * The WRITE path lives in this same module by design (single semantic owner):
 * {@link commitCanonEdits} is the ONE sanctioned manual-mutation engine. All
 * preparation before its single `commitAtomicFileSet` call is in-memory —
 * there is no side-effecting pre-step, and snapshots join the SAME atomic
 * transaction as live Canon + projections.
 */

export interface StoryCanonView {
  readonly manifest: StateManifest;
  readonly currentState: CurrentStateState;
  readonly hooks: HooksState;
  readonly chapterSummaries: ChapterSummariesState;
  /** Deterministic fingerprint of the four documents (additive; computed, never stored). */
  readonly revision: string;
}

export const CANON_SECTIONS = ["manifest", "current_state", "hooks", "chapter_summaries"] as const;

export type CanonSection = (typeof CANON_SECTIONS)[number];

export function isCanonSection(value: string | undefined): value is CanonSection {
  return typeof value === "string" && (CANON_SECTIONS as ReadonlyArray<string>).includes(value);
}

export type CanonSectionValue =
  | StateManifest
  | CurrentStateState
  | HooksState
  | ChapterSummariesState;

export function readCanonSection(view: StoryCanonView, section: CanonSection): CanonSectionValue {
  switch (section) {
    case "manifest":
      return view.manifest;
    case "current_state":
      return view.currentState;
    case "hooks":
      return view.hooks;
    case "chapter_summaries":
      return view.chapterSummaries;
    default:
      throw new Error(`Unknown canon section: ${String(section)}`);
  }
}

/** One concrete reason why canonical structured state could not be read. */
export interface CanonIssue {
  /** Relative scope only: a bare state filename or a validator path. Never an absolute path. */
  readonly scope: string;
  readonly code:
    | "missing_canon_file"
    | "unreadable_canon_json"
    | "invalid_canon_schema"
    | "cross_file_invalid";
  readonly message: string;
}

/** Raised when a book exists but its canonical structured state cannot be safely read. */
export class CanonUnavailableError extends Error {
  readonly code = "canon_unavailable" as const;
  readonly issues: ReadonlyArray<CanonIssue>;

  constructor(issues: ReadonlyArray<CanonIssue>) {
    super(`Canonical structured state is unavailable: ${issues.map((issue) => issue.message).join("; ")}`);
    this.name = "CanonUnavailableError";
    this.issues = issues;
  }
}

/**
 * Raised when a commit arrives against a stale `expectedRevision`. Thrown
 * BEFORE any filesystem mutation — a conflicting save never touches disk.
 */
export class CanonConflictError extends Error {
  readonly code = "canon_conflict" as const;
  readonly currentRevision: string;

  constructor(currentRevision: string) {
    super(`Canon changed since it was loaded (current revision ${currentRevision}). Reload and re-apply the edit.`);
    this.name = "CanonConflictError";
    this.currentRevision = currentRevision;
  }
}

// --- P3A revision fingerprint + edit-local validation (T3A.4) ----------------

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = canonicalize(source[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Deterministic revision of the FOUR validated canonical documents.
 *
 * Recursively key-sorted serialization ⇒ independent of on-disk whitespace and
 * object-key ordering. Pure; no filesystem access. Sixteen hex characters.
 */
export function computeCanonRevision(snapshot: {
  readonly manifest: StateManifest;
  readonly currentState: CurrentStateState;
  readonly hooks: HooksState;
  readonly chapterSummaries: ChapterSummariesState;
}): string {
  const canonical = JSON.stringify(
    canonicalize({
      manifest: snapshot.manifest,
      currentState: snapshot.currentState,
      hooks: snapshot.hooks,
      chapterSummaries: snapshot.chapterSummaries,
    }),
  );
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

function factIdentity(fact: { readonly subject: string; readonly predicate: string }): string {
  return `${fact.subject}::${fact.predicate}`;
}

/**
 * EDIT-LOCAL validation for the manual mutation path ONLY (amended design §5).
 *
 * The GLOBAL `validateRuntimeState` stays untouched — legacy/bootstrap books
 * may legitimately carry structures these stricter invariants would reject,
 * and shared pipeline acceptance must not change in P3. Runs AFTER
 * `validateRuntimeState` on the mutated snapshot.
 */
export function validateCanonEditedState(
  before: StoryCanonView,
  after: {
    readonly manifest: StateManifest;
    readonly currentState: CurrentStateState;
    readonly hooks: HooksState;
    readonly chapterSummaries: ChapterSummariesState;
  },
  effectiveChapter: number,
): RuntimeStateValidationIssue[] {
  const issues: RuntimeStateValidationIssue[] = [];

  // Protected documents and position must be structurally untouched.
  const protectedChecks: Array<[string, unknown, unknown]> = [
    ["manifest", before.manifest, after.manifest],
    ["hooks", before.hooks, after.hooks],
    ["chapterSummaries", before.chapterSummaries, after.chapterSummaries],
  ];
  for (const [label, left, right] of protectedChecks) {
    if (JSON.stringify(canonicalize(left)) !== JSON.stringify(canonicalize(right))) {
      issues.push({
        code: "protected_document_mutated",
        message: `${label} must not change during a manual current-state edit`,
        path: label,
      });
    }
  }
  if (after.currentState.chapter !== before.currentState.chapter) {
    issues.push({
      code: "protected_document_mutated",
      message: "currentState.chapter must not change during a manual current-state edit",
      path: "currentState.chapter",
    });
  }

  // Temporal interval ordering.
  for (const fact of after.currentState.facts) {
    if (
      fact.validUntilChapter !== null
      && fact.validUntilChapter < fact.validFromChapter
    ) {
      issues.push({
        code: "invalid_fact_interval",
        message: `${factIdentity(fact)}: validUntilChapter ${fact.validUntilChapter} precedes validFromChapter ${fact.validFromChapter}`,
        path: "currentState.facts",
      });
    }
  }

  // At most one OPEN row per semantic key.
  const openKeys = new Map<string, string>();
  for (const fact of after.currentState.facts) {
    if (fact.validUntilChapter !== null) continue;
    const identity = factIdentity(fact);
    const previous = openKeys.get(identity);
    if (previous !== undefined) {
      issues.push({
        code: "duplicate_active_fact",
        message: `${identity}: more than one open fact after edit (${previous} and ${fact.object})`,
        path: "currentState.facts",
      });
      continue;
    }
    openKeys.set(identity, fact.object);
  }

  // Every NEW or CHANGED open row must be anchored at the effective chapter.
  const beforeRows = new Set(
    before.currentState.facts.map((f) => `${factIdentity(f)}|${f.object}|${f.validFromChapter}|${f.validUntilChapter}|${f.sourceChapter}`),
  );
  for (const fact of after.currentState.facts) {
    if (fact.validUntilChapter !== null) continue;
    const signature = `${factIdentity(fact)}|${fact.object}|${fact.validFromChapter}|${fact.validUntilChapter}|${fact.sourceChapter}`;
    if (beforeRows.has(signature)) continue;
    if (fact.validFromChapter !== effectiveChapter || fact.sourceChapter !== effectiveChapter) {
      issues.push({
        code: "effective_chapter_mismatch",
        message: `${factIdentity(fact)}: new/changed open row must anchor at effectiveChapter ${effectiveChapter} (got validFrom=${fact.validFromChapter}, source=${fact.sourceChapter})`,
        path: "currentState.facts",
      });
    }
  }

  return issues;
}

const CANON_STATE_SCHEMAS = {
  "manifest.json": StateManifestSchema,
  "current_state.json": CurrentStateStateSchema,
  "hooks.json": HooksStateSchema,
  "chapter_summaries.json": ChapterSummariesStateSchema,
} as const;

async function readCanonFile(
  stateDir: string,
  fileName: keyof typeof CANON_STATE_SCHEMAS,
): Promise<{ value: unknown } | { issue: CanonIssue }> {
  let raw: string;
  try {
    raw = await readFile(join(stateDir, fileName), "utf-8");
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    return {
      issue: {
        scope: fileName,
        code: missing ? "missing_canon_file" : "unreadable_canon_json",
        // Fixed copy only — raw IO error strings embed absolute paths.
        message: missing
          ? `${fileName}: canonical state file not found`
          : `${fileName}: canonical state file could not be read`,
      },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      issue: {
        scope: fileName,
        code: "unreadable_canon_json",
        message: `${fileName}: content is not valid JSON`,
      },
    };
  }

  const result = CANON_STATE_SCHEMAS[fileName].safeParse(parsed);
  if (!result.success) {
    return {
      issue: {
        scope: fileName,
        code: "invalid_canon_schema",
        message: `${fileName}: ${result.error.issues
          .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
          .join("; ")}`,
      },
    };
  }
  return { value: result.data };
}

/**
 * Load and validate the full canonical view for a book directory.
 *
 * PURE READ: reads exactly the four fixed canonical state files, parses them
 * against the runtime-state schemas and applies the existing cross-file
 * validator. Any problem throws {@link CanonUnavailableError} with
 * machine-readable issues (`code: "canon_unavailable"`); nothing is written,
 * created or repaired, and markdown projections are never consulted.
 */
export async function readStoryCanon(bookDir: string): Promise<StoryCanonView> {
  const stateDir = join(bookDir, "story", "state");

  const entries = await Promise.all(
    (Object.keys(CANON_STATE_SCHEMAS) as Array<keyof typeof CANON_STATE_SCHEMAS>).map(
      async (fileName) => ({ fileName, outcome: await readCanonFile(stateDir, fileName) }),
    ),
  );

  const issues: CanonIssue[] = [];
  const values = new Map<keyof typeof CANON_STATE_SCHEMAS, unknown>();
  for (const { fileName, outcome } of entries) {
    if ("issue" in outcome) {
      issues.push(outcome.issue);
    } else {
      values.set(fileName, outcome.value);
    }
  }

  if (issues.length === 0) {
    const snapshot = {
      manifest: values.get("manifest.json") as StateManifest,
      currentState: values.get("current_state.json") as CurrentStateState,
      hooks: values.get("hooks.json") as HooksState,
      chapterSummaries: values.get("chapter_summaries.json") as ChapterSummariesState,
    };
    for (const problem of validateRuntimeState(snapshot)) {
      issues.push({
        scope: problem.path || "(cross-file)",
        code: "cross_file_invalid",
        message: `${problem.code}: ${problem.message}`,
      });
    }
  }

  if (issues.length > 0) {
    throw new CanonUnavailableError(issues);
  }

  const view: StoryCanonView = {
    manifest: values.get("manifest.json") as StateManifest,
    currentState: values.get("current_state.json") as CurrentStateState,
    hooks: values.get("hooks.json") as HooksState,
    chapterSummaries: values.get("chapter_summaries.json") as ChapterSummariesState,
    revision: "",
  };
  // Computed AFTER assembly so the fingerprint covers exactly the returned view.
  return { ...view, revision: computeCanonRevision(view) };
}

// --- P3A manual-edit preview + commit engine (T3A.5) -------------------------

/** Edit-local or global validation rejected the requested edit set. */
export class CanonInvalidEditsError extends Error {
  readonly code = "invalid_canon_edits" as const;
  readonly issues: ReadonlyArray<RuntimeStateValidationIssue>;

  constructor(issues: ReadonlyArray<RuntimeStateValidationIssue>) {
    super(`Canon edits rejected: ${issues.map((issue) => `${issue.code}: ${issue.message}`).join("; ")}`);
    this.name = "CanonInvalidEditsError";
    this.issues = issues;
  }
}

export interface CanonCommitDeps {
  /**
   * Failure-injection seam for the atomic transaction's rename operations
   * (tests only). Production leaves this undefined so the real
   * `commitAtomicFileSet` default (`fs.rename`) is used.
   */
  readonly renameFile?: (from: string, to: string) => Promise<void>;
  readonly rebuildNarrativeMemoryIndex?: (bookDir: string) => Promise<void>;
  readonly rebuildCurrentStateFactHistory?: (bookDir: string, uptoChapter: number) => Promise<void>;
  readonly invalidateDerivedMemory?: typeof invalidateDerivedMemory;
}

export interface CanonEditPreview {
  /** The validated pre-edit view as read from disk. */
  readonly before: StoryCanonView;
  /** The in-memory post-edit documents (never persisted by preview). */
  readonly after: {
    readonly manifest: StateManifest;
    readonly currentState: CurrentStateState;
    readonly hooks: HooksState;
    readonly chapterSummaries: ChapterSummariesState;
  };
  /** `resolveDurableStoryProgress(bookDir) + 1` — the anchor for new facts. */
  readonly effectiveChapter: number;
  /** Empty when the commit would be accepted. */
  readonly issues: ReadonlyArray<RuntimeStateValidationIssue>;
  /** Human-readable semantic notes (e.g. how many active rows were replaced). */
  readonly warnings: ReadonlyArray<string>;
}

/**
 * PURE preview of a manual edit set. Reads canon + durable progress; applies
 * the edits in memory; validates globally AND edit-locally. Performs zero
 * filesystem mutations.
 */
export async function previewCanonEdits(
  bookDir: string,
  edits: ReadonlyArray<CanonEdit>,
): Promise<CanonEditPreview> {
  const before = await readStoryCanon(bookDir);
  const durable = await resolveDurableStoryProgress({ bookDir });
  const effectiveChapter = durable + 1;

  const after = applyManualCurrentStateEdits({
    snapshot: before,
    edits,
    effectiveChapter,
  });

  const warnings: string[] = [];
  let replacedCount = 0;
  for (const edit of edits) {
    if (edit.kind !== "setFact") continue;
    const hadActive = before.currentState.facts.some(
      (fact) =>
        fact.subject === edit.subject
        && resolveFactPredicateKey(fact.predicate) === resolveFactPredicateKey(edit.predicate),
    );
    if (hadActive) replacedCount += 1;
  }
  if (replacedCount > 0) {
    warnings.push(`${replacedCount} active fact row(s) replaced forward from chapter ${effectiveChapter}`);
  }

  const issues: RuntimeStateValidationIssue[] = [
    ...validateRuntimeState(after),
    ...validateCanonEditedState(before, after, effectiveChapter),
  ];

  return { before, after, effectiveChapter, issues, warnings };
}

export interface CanonCommitResult {
  /** Revision of the four documents AFTER the commit. */
  readonly revision: string;
  readonly appliedEdits: ReadonlyArray<CanonEdit>;
  readonly effectiveChapter: number;
  /** Non-fatal notes; the exact derived-memory warning string may appear here. */
  readonly warnings: ReadonlyArray<string>;
}

// --- P3.1 semantic no-op hardening -------------------------------------------
//
// Manual editing modifies AUTHOR-FACING CURRENT STORY MEANING; temporal
// provenance is not user input. A same-value setFact and a removal of an
// unasserted key are therefore SEMANTIC NO-OPS: zero filesystem writes,
// zero derived-memory synchronization, unchanged revision, no re-anchor.

interface ShadowAssertion {
  /** Active value of the single open row (meaningless when openRowCount > 1). */
  value: string;
  openRowCount: number;
}

function semanticKey(subject: string, predicate: string): string {
  return `${subject}::${resolveFactPredicateKey(predicate)}`;
}

/**
 * SEQUENTIAL no-op classification (P3.1).
 *
 * Classifies edits IN REQUEST ORDER against a lightweight shadow model of
 * OPEN/current facts keyed by `subject + resolveFactPredicateKey(predicate)`
 * — the reducer's own match semantics. Original-state classification is NOT
 * safe for ordered batches (`[set24,set23]`, `[remove,set23]`); each edit
 * must observe the shadow as mutated by preceding edits.
 *
 * Closed historical rows are invisible to meaning: a key with only closed
 * rows removes nothing. Ambiguity is conservative: a same-value setFact is
 * a no-op ONLY for exactly one open matching row — duplicate/conflicting
 * OPEN rows route through the normal validation path instead of silently
 * blessing malformed legacy state.
 *
 * Returns the EFFECTIVE edits in original relative order; dropped operations
 * provably cannot change what the remaining edits mean.
 */
function partitionSemanticNoopEdits(
  view: StoryCanonView,
  edits: ReadonlyArray<CanonEdit>,
): { effective: CanonEdit[] } {
  const shadow = new Map<string, ShadowAssertion>();
  for (const fact of view.currentState.facts) {
    if (fact.validUntilChapter !== null) continue;
    const key = semanticKey(fact.subject, fact.predicate);
    const prev = shadow.get(key);
    shadow.set(key, prev
      ? { value: fact.object, openRowCount: prev.openRowCount + 1 }
      : { value: fact.object, openRowCount: 1 });
  }

  const effective: CanonEdit[] = [];
  for (const edit of edits) {
    const key = semanticKey(edit.subject, edit.predicate);
    const entry = shadow.get(key);

    if (edit.kind === "removeFact") {
      if (!entry) continue; // no active assertion ⇒ semantic no-op
      effective.push(edit);
      shadow.delete(key);
      continue;
    }

    // setFact: no-op only for ONE unambiguous active assertion equal to the request.
    if (entry && entry.openRowCount === 1 && entry.value === edit.object) continue;
    effective.push(edit);
    shadow.set(key, { value: edit.object, openRowCount: 1 });
  }
  return { effective };
}

/**
 * Order-insensitive semantic fingerprint over the FOUR structured documents
 * (defense-in-depth behind sequential classification). Object keys are
 * canonicalized like the revision fingerprint; `currentState.facts` is
 * compared as an order-INsensitive multiset of canonical rows because fact
 * array order is non-semantic for THIS comparison only. Stored arrays are
 * never reordered by anything in this module.
 */
function semanticCanonFingerprint(snapshot: {
  manifest: StateManifest;
  currentState: CurrentStateState;
  hooks: HooksState;
  chapterSummaries: ChapterSummariesState;
}): string {
  return JSON.stringify({
    manifest: canonicalize(snapshot.manifest),
    hooks: canonicalize(snapshot.hooks),
    chapterSummaries: canonicalize(snapshot.chapterSummaries),
    currentStateChapter: snapshot.currentState.chapter,
    currentStateFacts: snapshot.currentState.facts
      .map((fact) => JSON.stringify(canonicalize(fact)))
      .sort(),
  });
}

/**
 * Commit a manual edit set as ONE atomic integrity transaction.
 *
 * Sequence (all preparation in-memory; ZERO side-effecting steps before the
 * transaction):
 *  1. read canon → stale `expectedRevision` ⇒ {@link CanonConflictError}
 *     BEFORE any filesystem mutation;
 *  1.5 P3.1 sequential semantic no-op filtering — same-value setFact /
 *     unasserted removeFact are author-meaning no-ops; ALL no-op ⇒ existing
 *     revision, `appliedEdits: []`, zero writes AND zero derived-memory work
 *     (no re-anchor, no bootstrap side effects); otherwise only EFFECTIVE
 *     edits (original relative order) continue;
 *  2. preview (durable+1 anchoring, reducer splice, global + edit-local
 *     validation) ⇒ any issue ⇒ {@link CanonInvalidEditsError};
 *  2.5 P3.1 defense-in-depth semantic fingerprint — meaning-preserving
 *     array-order-only churn persists nothing;
 *  3. ONE `commitAtomicFileSet({rootDir: bookDir})` covering:
 *     - live `story/state/current_state.json` (spliced per reducer convention)
 *     - regenerated `story/current_state.md` (renderCurrentStateProjection)
 *     - mirrors `story/snapshots/<N>/state/current_state.json`
 *       and `story/snapshots/<N>/current_state.md`
 *     - when the target snapshot is missing/incomplete: full reconstruction
 *       via `buildSnapshotFileSet`, overlaid INSIDE the same write set;
 *  4. derived memory rebuilds (extracted memory-sync fns); on failure the db
 *     is invalidated (deleted/quarantined); only if even invalidation fails
 *     does the exact honest warning surface — the commit itself still lands.
 *
 * LOCK OWNERSHIP: the caller holds `StateManager.acquireBookLock` across the
 * whole sequence (Studio server in P3B). Core adds no second lock here —
 * deliberately.
 */
export async function commitCanonEdits(
  bookDir: string,
  request: CanonCommitRequest,
  deps: CanonCommitDeps = {},
): Promise<CanonCommitResult> {
  // (1) optimistic concurrency — compare BEFORE anything else touches disk.
  const view = await readStoryCanon(bookDir);
  if (request.expectedRevision !== view.revision) {
    throw new CanonConflictError(view.revision);
  }

  // (1.5) P3.1 sequential semantic no-op filtering: operations that cannot
  // change author-facing current meaning (missing/unasserted removes,
  // same-value sets on unambiguous active state) are dropped BEFORE the
  // reducer so they cause zero writes, zero derived-memory work and zero
  // revision churn. All no-op ⇒ return the existing revision unchanged.
  const { effective } = partitionSemanticNoopEdits(view, request.edits);
  if (effective.length === 0) {
    return {
      revision: view.revision,
      appliedEdits: [],
      effectiveChapter: (await resolveDurableStoryProgress({ bookDir })) + 1,
      warnings: [],
    };
  }

  // (2) preview + validation (fresh durable read; caller holds the lock).
  const preview = await previewCanonEdits(bookDir, effective);
  if (preview.issues.length > 0) {
    throw new CanonInvalidEditsError(preview.issues);
  }

  // (2.5) P3.1 defense-in-depth: if the validated reduction changed nothing
  // semantically (meaning-preserving array-order churn only), persist
  // nothing and report the existing revision.
  if (
    semanticCanonFingerprint(preview.before) === semanticCanonFingerprint(preview.after)
  ) {
    return {
      revision: view.revision,
      appliedEdits: [],
      effectiveChapter: preview.effectiveChapter,
      warnings: [],
    };
  }

  const n = preview.effectiveChapter - 1;
  const snapshotBase = `story/snapshots/${n}`;
  const projectionMd = renderCurrentStateProjection(preview.after.currentState, view.manifest.language);
  const currentJson = JSON.stringify(preview.after.currentState, null, 2);

  const writes = new Map<string, string | Uint8Array>();
  writes.set("story/state/current_state.json", currentJson);
  writes.set("story/current_state.md", projectionMd);
  writes.set(`${snapshotBase}/state/current_state.json`, currentJson);
  writes.set(`${snapshotBase}/current_state.md`, projectionMd);

  // Missing/incomplete snapshot ⇒ full in-memory reconstruction overlaid in
  // the SAME transaction (the four explicit writes above win the overlay).
  if (!(await isSnapshotComplete(bookDir, n))) {
    for (const write of await buildSnapshotFileSet(bookDir, n)) {
      if (!writes.has(write.relativePath)) {
        writes.set(write.relativePath, write.content);
      }
    }
  }

  await commitAtomicFileSet({
    rootDir: bookDir,
    writes: [...writes.entries()].map(([relativePath, content]) => ({ relativePath, content })),
    ...(deps.renameFile ? { renameFile: deps.renameFile } : {}),
  });

  // (4) derived memory — failures must not roll back the committed truth.
  const warnings: string[] = [];
  try {
    await (deps.rebuildNarrativeMemoryIndex ?? rebuildNarrativeMemoryIndex)(bookDir);
    await (deps.rebuildCurrentStateFactHistory ?? rebuildCurrentStateFactHistory)(bookDir, n);
  } catch {
    const invalidation = await (deps.invalidateDerivedMemory ?? invalidateDerivedMemory)(bookDir);
    if (!invalidation.invalidated && invalidation.warning) {
      warnings.push(invalidation.warning);
    }
  }

  // The authoritative new revision is read back from DISK after the derived
  // memory phase: seed bootstrap may normalize the manifest (e.g. an inflated
  // lastAppliedChapter collapsing to durable progress), and the client must
  // receive exactly the fingerprint its NEXT save will be checked against.
  const finalView = await readStoryCanon(bookDir);

  return {
    revision: finalView.revision,
    appliedEdits: [...effective],
    effectiveChapter: preview.effectiveChapter,
    warnings,
  };
}
