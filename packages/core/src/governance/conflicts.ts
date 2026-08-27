import { z } from "zod";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { SafeGovernanceIdSchema } from "./contracts.js";
import { StateManifestSchema } from "../models/runtime-state.js";
import { bootstrapFoundation } from "../foundation/bootstrap.js";
import {
  extractGovernedContent,
  governedContentHash,
  type FoundationContentLocator,
} from "../foundation/manifest.js";

// ===========================================================================
// Task 6 — Revision-scoped two-layer Canon conflict classification + trusted
// Human Resolution Record.
//
// AUTHORITY DISCIPLINE
// - Layer 1 (deterministic Core) may return future_safe, uncertain, or a hard
//   canon_conflict backed by deterministic Core evidence.
// - Layer 2 (semantic AI) may return ONLY future_safe | uncertain. It can
//   NEVER create canon_conflict — a hard Canon conflict requires deterministic
//   Core evidence. The Core default semantic pass also never downgrades a
//   deterministic canon_conflict into future_safe.
// - EVERY operation is revision-scoped: classification reads the EXACT
//   Revision Draft (story/revisions/<revisionId>/<unitId>.md). Published
//   Foundation vN is read-only context ONLY — it is never the target draft.
// - resolveFoundationUncertainty is TRUSTED: the caller names only
//   revisionId + findingId + choice + humanActor. Core loads the persisted
//   finding itself (evidence, contentRevision/contentHash, unitId) and the
//   current Canon revision; a stale finding (draft content changed since it
//   was computed) is REJECTED and requires re-review.
// - Task 6 never modifies Canon, never publishes Foundation, never switches
//   authority, never flips markers, never invalidates dependencies
//   transactionally, and creates NO Task 9 transaction machinery.
//
// NO SHADOW PROSE: conflict/resolution JSON is governance/evidence metadata.
// Evidence may carry concise factual/reference detail required to explain the
// conflict, never duplicated Foundation creative prose.
//
// PERSISTENCE CONVENTIONS (Phase 5 revision workspace — Tasks 7/8 build on
// these; Task 8's saveFoundationUnitDraft writes the same working root and its
// FoundationRevisionDraft record supersets FoundationRevisionStateSchema):
//   story/revisions/<revisionId>/<unitId>.md       revision-scoped working Markdown
//   story/revisions/<revisionId>/draft.gov.json    per-revision unit state (superset by T8)
//   story/governance/findings/<revisionId>/<findingId>.gov.json   persisted findings (T7 superset)
//   story/governance/resolutions/<resolutionId>.gov.json          durable Human Resolution Records
// ===========================================================================

// ---------------------------------------------------------------------------
// Conflict evidence / result vocabularies
// ---------------------------------------------------------------------------

export const ConflictEvidenceSchema = z.object({
  source: z.string().min(1).max(128),
  detail: z.string().min(1).max(4096),
}).strict();
export type ConflictEvidence = z.infer<typeof ConflictEvidenceSchema>;

export const FoundationConflictResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("future_safe"),
    evidence: z.array(ConflictEvidenceSchema),
  }).strict(),
  z.object({
    kind: z.literal("uncertain"),
    evidence: z.array(ConflictEvidenceSchema),
    semanticConcern: z.string().min(1),
  }).strict(),
  z.object({
    kind: z.literal("canon_conflict"),
    evidence: z.array(ConflictEvidenceSchema),
    canonRevision: z.number().int().min(0),
  }).strict(),
]);
export type FoundationConflictResult = z.infer<typeof FoundationConflictResultSchema>;

// ---------------------------------------------------------------------------
// Revision workspace — the revision-scoped working content contract.
// ---------------------------------------------------------------------------

export function revisionDraftContentRelPath(revisionId: string, unitId: string): string {
  const safeRevision = SafeGovernanceIdSchema.parse(revisionId);
  const safeUnit = SafeGovernanceIdSchema.parse(unitId);
  return `story/revisions/${safeRevision}/${safeUnit}.md`;
}

export function revisionDraftStateRelPath(revisionId: string): string {
  const safeRevision = SafeGovernanceIdSchema.parse(revisionId);
  return `story/revisions/${safeRevision}/draft.gov.json`;
}

/**
 * Minimal per-revision unit state — the revision-scoped identity the conflict
 * classifiers and findings bind. Task 8's FoundationRevisionDraft supersets
 * this record at the SAME file path (story/revisions/<id>/draft.gov.json) and
 * adds per-entry fields (approvedRevision, state) to each unitStates element.
 * This is the Task 6 READ VIEW: it strictly validates the required fields and
 * tolerates (strips) the Task 8 superset keys — the outer .strip() does NOT
 * propagate into array elements, so the ELEMENT schema must be strip-mode too.
 * Governance metadata only.
 */
export const RevisionUnitStateSchema = z.object({
  unitId: SafeGovernanceIdSchema,
  contentRevision: z.number().int().min(1),
  contentHash: z.string().min(1),
}).strip();
export type RevisionUnitState = z.infer<typeof RevisionUnitStateSchema>;

export const FoundationRevisionStateSchema = z.object({
  revisionId: SafeGovernanceIdSchema,
  unitStates: z.array(RevisionUnitStateSchema),
}).strip();
export type FoundationRevisionState = z.infer<typeof FoundationRevisionStateSchema>;

/** Raw revision draft Markdown for a unit; null when the draft does not exist. */
export async function readRevisionUnitDraft(
  bookDir: string,
  revisionId: string,
  unitId: string,
): Promise<string | null> {
  try {
    return await readFile(join(bookDir, revisionDraftContentRelPath(revisionId, unitId)), "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * VERIFIED revision unit state: loads the persisted per-revision unit state and
 * cross-checks its contentHash against a recompute over the ACTUAL draft file.
 * A missing draft file, a missing state entry, or a state/file hash mismatch
 * means the workspace is inconsistent → fail closed (throws). Classification
 * and resolution validity depend on this — a finding is only resolvable when
 * the persisted state provably matches the exact current draft content.
 */
export async function readVerifiedRevisionUnitState(
  bookDir: string,
  revisionId: string,
  unitId: string,
): Promise<RevisionUnitState | null> {
  const safeRevision = SafeGovernanceIdSchema.parse(revisionId);
  const safeUnit = SafeGovernanceIdSchema.parse(unitId);
  let raw: string;
  try {
    raw = await readFile(join(bookDir, revisionDraftStateRelPath(safeRevision)), "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const state = FoundationRevisionStateSchema.parse(JSON.parse(raw));
  if (state.revisionId !== safeRevision) {
    throw new Error(`Revision state record revisionId mismatch for ${safeRevision}: ${state.revisionId}`);
  }
  const unitState = state.unitStates.find((entry) => entry.unitId === safeUnit);
  if (!unitState) return null;
  const draftRaw = await readRevisionUnitDraft(bookDir, safeRevision, safeUnit);
  if (draftRaw === null) {
    throw new Error(`Revision ${safeRevision} unit ${safeUnit}: draft file missing while revision state exists (inconsistent workspace)`);
  }
  if (unitState.contentHash !== governedContentHash(draftRaw)) {
    throw new Error(
      `Revision ${safeRevision} unit ${safeUnit}: revision state contentHash does not match the actual draft content (inconsistent workspace)`,
    );
  }
  return unitState;
}

// ---------------------------------------------------------------------------
// Current Canon revision (read-only). Numeric convention: the Phase 5 Canon
// anchor is story/state/manifest.json lastAppliedChapter (0 when no Canon yet),
// matching Tasks 3/5.
// ---------------------------------------------------------------------------

export async function readCurrentCanonRevision(bookDir: string): Promise<number> {
  try {
    const raw = await readFile(join(bookDir, "story", "state", "manifest.json"), "utf-8");
    return StateManifestSchema.parse(JSON.parse(raw)).lastAppliedChapter;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Published Foundation baseline (read-only context). Uses the existing
// bootstrap: legacy books parse their Markdown into legacy_established units;
// V2 books load the persisted manifests. NEVER the target draft.
// ---------------------------------------------------------------------------

async function readPublishedUnitContent(
  bookDir: string,
  unitId: string,
): Promise<{ content: string; locator: FoundationContentLocator } | null> {
  const { units } = await bootstrapFoundation(bookDir);
  const manifest = units.find((unit) => unit.unitId === unitId);
  if (!manifest) return null;
  return {
    content: await extractGovernedContent(bookDir, manifest.locator),
    locator: manifest.locator,
  };
}

// ---------------------------------------------------------------------------
// Shared draft-vs-published analysis (used by BOTH classifiers so the
// deterministic conditions are evaluated identically).
// ---------------------------------------------------------------------------

interface DraftAnalysis {
  readonly draftContent: string;
  readonly publishedContent: string;
  readonly contractError: string | null;
}

async function analyzeDraftVsPublished(
  bookDir: string,
  revisionId: string,
  unitId: string,
): Promise<DraftAnalysis> {
  const draftRaw = await readRevisionUnitDraft(bookDir, revisionId, unitId);
  if (draftRaw === null) {
    throw new Error(
      `Cannot classify ${revisionId}/${unitId}: revision draft content missing `
      + `(revision isolation — never classify against Published Foundation or another revision).`,
    );
  }
  const published = await readPublishedUnitContent(bookDir, unitId);
  if (!published) {
    throw new Error(`Cannot classify ${revisionId}/${unitId}: no published Foundation baseline for the unit.`);
  }
  // Extract the governed content FROM THE DRAFT FILE using the unit's locator
  // (draft file path replaces the published source path). Contract violations
  // (e.g. story-frame section count) throw here — a deterministic condition.
  let draftContent: string;
  let contractError: string | null = null;
  try {
    draftContent = await extractGovernedContent(bookDir, {
      ...published.locator,
      sourceRelPath: revisionDraftContentRelPath(revisionId, unitId),
    });
  } catch (error) {
    contractError = error instanceof Error ? error.message : String(error);
    draftContent = "";
  }
  return { draftContent, publishedContent: published.content, contractError };
}

// ---------------------------------------------------------------------------
// Layer 1 — deterministic Core classifier.
// ---------------------------------------------------------------------------

/**
 * Deterministic Core classification (revision-scoped). Rules:
 * - draft violates the governed-content contract            → canon_conflict
 * - draft would remove/empty published governed content     → canon_conflict
 * - draft governed content identical to published           → future_safe
 * - otherwise (content changed, structure intact)           → uncertain
 *   (deterministic evidence that requires semantic review).
 */
export async function classifyCanonConflictDeterministic(
  bookDir: string,
  revisionId: string,
  unitId: string,
): Promise<FoundationConflictResult> {
  const analysis = await analyzeDraftVsPublished(bookDir, revisionId, unitId);
  if (analysis.contractError !== null) {
    return {
      kind: "canon_conflict",
      evidence: [{
        source: "governed-content-contract",
        detail: `draft for ${unitId} violates the governed-content contract: ${analysis.contractError}`,
      }],
      canonRevision: await readCurrentCanonRevision(bookDir),
    };
  }
  if (analysis.draftContent === analysis.publishedContent) {
    return {
      kind: "future_safe",
      evidence: [{
        source: "published-content-equality",
        detail: `draft governed content for ${unitId} is identical to the current published Foundation content`,
      }],
    };
  }
  if (analysis.publishedContent !== "" && analysis.draftContent === "") {
    return {
      kind: "canon_conflict",
      evidence: [{
        source: "published-content-removal",
        detail: `draft would remove or empty the published governed content for ${unitId}`,
      }],
      canonRevision: await readCurrentCanonRevision(bookDir),
    };
  }
  return {
    kind: "uncertain",
    evidence: [{
      source: "draft-content-change",
      detail: `draft governed content for ${unitId} differs from the current published Foundation content; deterministic layer cannot rule out a Canon conflict`,
    }],
    semanticConcern: "draft content changed vs published Foundation; requires semantic review",
  };
}

// ---------------------------------------------------------------------------
// Layer 2 — semantic classifier. AUTHORITY-LIMITED: may return ONLY
// future_safe | uncertain. The type itself forbids canon_conflict; the runtime
// guard below doubles the guarantee. The Core default semantic pass is the
// fail-safe fallback until the AI semantic pass is wired: it never fabricates
// a future_safe for changed content and never downgrades a deterministic
// canon_conflict into future_safe.
// ---------------------------------------------------------------------------

export async function classifyCanonConflictSemantic(
  bookDir: string,
  revisionId: string,
  unitId: string,
): Promise<Extract<FoundationConflictResult, { kind: "uncertain" | "future_safe" }>> {
  const analysis = await analyzeDraftVsPublished(bookDir, revisionId, unitId);
  if (analysis.contractError === null && analysis.draftContent === analysis.publishedContent) {
    return {
      kind: "future_safe",
      evidence: [{
        source: "published-content-equality",
        detail: `draft governed content for ${unitId} is identical to the current published Foundation content`,
      }],
    };
  }
  // Deterministic conflict conditions are NOT downgraded: the semantic layer
  // can only report uncertainty about them, never future_safe, never
  // canon_conflict (semantic suspicion alone cannot create a hard conflict).
  const semanticConcern =
    analysis.contractError !== null
      ? `deterministic Core identified a governed-content contract violation (${analysis.contractError}); semantic layer cannot confirm future_safe`
      : analysis.publishedContent !== "" && analysis.draftContent === ""
        ? "deterministic Core identified removal of published governed content; semantic layer cannot confirm future_safe"
        : "draft content differs from current published Foundation; semantic review required";
  const result: Extract<FoundationConflictResult, { kind: "uncertain" | "future_safe" }> = {
    kind: "uncertain",
    evidence: analysis.contractError !== null
      ? [{
          source: "governed-content-contract",
          detail: `draft for ${unitId} violates the governed-content contract: ${analysis.contractError}`,
        }]
      : analysis.publishedContent !== "" && analysis.draftContent === ""
        ? [{
            source: "published-content-removal",
            detail: `draft would remove or empty the published governed content for ${unitId}`,
          }]
        : [{
            source: "draft-content-change",
            detail: `draft governed content for ${unitId} differs from the current published Foundation content`,
          }],
    semanticConcern,
  };
  // Hard runtime guard — the semantic layer can NEVER emit canon_conflict
  // (the type already forbids it; this defends a future widened return type).
  if ((result as FoundationConflictResult).kind === "canon_conflict") {
    throw new Error("semantic classifier attempted to create canon_conflict — authority violation");
  }
  return result;
}

// ---------------------------------------------------------------------------
// Persisted Foundation finding — the minimal persisted finding contract Task 6
// requires (resolution loads it; stale-finding rejection verifies it). The
// approved Task 6 resolution contract binds `evidence: ReadonlyArray<ConflictEvidence>`,
// so the persisted finding MUST carry the classifier evidence array. Task 7
// supersets this record (category/severity/repairScope/suggestedAction) at the
// SAME storage location — this is NOT a competing finding architecture.
//
// WRITE (strict): Task 6 persists exactly the minimal fields; Task 7's own
// reviewer writes its superset records through its own schema/author. READ
// (tolerant view): loadFoundationFinding strips Task 7 superset keys while
// strictly validating every Task 6-required field, so superset records remain
// resolvable and corrupt/unsafe records still fail closed.
// ---------------------------------------------------------------------------

export const PersistedFoundationFindingSchema = z.object({
  findingId: SafeGovernanceIdSchema,
  revisionId: SafeGovernanceIdSchema,
  unitId: SafeGovernanceIdSchema,
  contentRevision: z.number().int().min(1),
  contentHash: z.string().min(1),
  evidence: z.array(ConflictEvidenceSchema),
  createdAt: z.string().datetime(),
}).strict();
export type PersistedFoundationFinding = z.infer<typeof PersistedFoundationFindingSchema>;

function findingRoot(bookDir: string, revisionId: string): string {
  const safeRevision = SafeGovernanceIdSchema.parse(revisionId);
  return join(bookDir, "story", "governance", "findings", safeRevision);
}

function findingPath(bookDir: string, revisionId: string, findingId: string): string {
  const safeFinding = SafeGovernanceIdSchema.parse(findingId);
  return join(findingRoot(bookDir, revisionId), `${safeFinding}.gov.json`);
}

async function writeFileAtomic(target: string, content: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const tmpPath = `${target}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, content, "utf-8");
  try {
    await rename(tmpPath, target);
  } catch (error) {
    await rm(tmpPath, { force: true });
    throw error;
  }
}

/**
 * Persist one validated finding (Task 6 minimal writer — the resolution tests
 * seed through it; Task 7's reviewer persists its superset records through its
 * own writer at the same location). Single-file atomic write — NOT a Task 9
 * transaction.
 */
export async function saveFoundationFinding(bookDir: string, finding: PersistedFoundationFinding): Promise<void> {
  const validated = PersistedFoundationFindingSchema.parse(finding);
  await writeFileAtomic(findingPath(bookDir, validated.revisionId, validated.findingId), `${JSON.stringify(validated, null, 2)}\n`);
}

/**
 * Load a persisted finding. Tolerant READ VIEW: every Task 6-required field is
 * strictly validated (fail closed on corrupt/unsafe data); Task 7 superset
 * keys are stripped so superset records remain readable here. Null when the
 * record is missing, throws when it is corrupt or path-unsafe.
 */
export async function loadFoundationFinding(
  bookDir: string,
  revisionId: string,
  findingId: string,
): Promise<PersistedFoundationFinding | null> {
  try {
    const raw = await readFile(findingPath(bookDir, revisionId, findingId), "utf-8");
    return PersistedFoundationFindingSchema.strip().parse(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Human Resolution Record — durable governance state. Binds: resolutionId,
// revisionId, unitId, findingId, exact finding evidence, current Canon
// revision, resolver (explicit humanActor), choice. The caller supplies NONE
// of the authoritative fields — Core constructs every binding from verified
// persisted state.
// ---------------------------------------------------------------------------

export const HumanResolutionChoiceSchema = z.enum(["compatible", "revise"]);
export type HumanResolutionChoice = z.infer<typeof HumanResolutionChoiceSchema>;

export const HumanResolutionRecordSchema = z.object({
  resolutionId: SafeGovernanceIdSchema,
  revisionId: SafeGovernanceIdSchema,
  unitId: SafeGovernanceIdSchema,
  findingId: SafeGovernanceIdSchema,
  evidence: z.array(ConflictEvidenceSchema),
  canonRevision: z.number().int().min(0),
  resolver: z.string().min(1),
  choice: HumanResolutionChoiceSchema,
}).strict();
export type HumanResolutionRecord = z.infer<typeof HumanResolutionRecordSchema>;

function resolutionRoot(bookDir: string): string {
  return join(bookDir, "story", "governance", "resolutions");
}

function resolutionPath(bookDir: string, resolutionId: string): string {
  const safe = SafeGovernanceIdSchema.parse(resolutionId);
  return join(resolutionRoot(bookDir), `${safe}.gov.json`);
}

/** Load a durable resolution record; null when missing, throws when corrupt. */
export async function loadHumanResolution(bookDir: string, resolutionId: string): Promise<HumanResolutionRecord | null> {
  try {
    const raw = await readFile(resolutionPath(bookDir, resolutionId), "utf-8");
    return HumanResolutionRecordSchema.parse(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Trusted Human resolution of an UNCERTAIN finding. The caller names ONLY the
 * real finding, the choice, and the Human actor. Core:
 *   1. loads the exact persisted finding (evidence, contentRevision/contentHash, unitId);
 *   2. verifies the finding is NOT stale — the persisted finding must still
 *      match the exact current revision state it was computed against
 *      (draft contentRevision/contentHash unchanged); otherwise REJECT and
 *      require re-review — an old finding is never rebound to new content;
 *   3. loads the CURRENT Canon revision;
 *   4. constructs and persists the HumanResolutionRecord ITSELF.
 * A resolution records a Human decision — it does NOT change Canon or
 * Foundation authority. Persistence is a single-file atomic write (the
 * TransactionCoordinator is Task 9 and is NOT used here).
 */
export async function resolveFoundationUncertainty(input: {
  bookDir: string;
  revisionId: string;
  findingId: string;
  choice: "compatible" | "revise";
  humanActor: string;
}): Promise<HumanResolutionRecord> {
  const bookDir = input.bookDir; // real filesystem path — never a governance id
  const revisionId = SafeGovernanceIdSchema.parse(input.revisionId);
  const findingId = SafeGovernanceIdSchema.parse(input.findingId);
  const choice = HumanResolutionChoiceSchema.parse(input.choice);
  const humanActor = z.string().min(1).parse(input.humanActor);

  const finding = await loadFoundationFinding(bookDir, revisionId, findingId);
  if (!finding) {
    throw new Error(`Cannot resolve uncertainty: persisted finding ${findingId} for revision ${revisionId} does not exist.`);
  }
  if (finding.revisionId !== revisionId) {
    throw new Error(`Cannot resolve uncertainty: finding ${findingId} is bound to revision ${finding.revisionId}, not ${revisionId}.`);
  }

  // STALE-FINDING REJECTION — verify the persisted finding still matches the
  // exact current revision state it was computed against.
  const unitState = await readVerifiedRevisionUnitState(bookDir, revisionId, finding.unitId);
  if (!unitState) {
    throw new Error(
      `Cannot resolve uncertainty: revision ${revisionId} unit ${finding.unitId} has no verifiable revision state (revision missing/discarded).`,
    );
  }
  if (unitState.contentRevision !== finding.contentRevision || unitState.contentHash !== finding.contentHash) {
    throw new Error(
      `Cannot resolve uncertainty: finding ${findingId} is STALE — draft content for ${finding.unitId} changed `
      + `since the finding was computed (contentRevision ${finding.contentRevision}→${unitState.contentRevision}). `
      + `Require re-review; an old finding is never rebound to new content.`,
    );
  }

  const record: HumanResolutionRecord = {
    resolutionId: randomUUID(), // hyphens only — SafeGovernanceId-safe
    revisionId,
    unitId: finding.unitId,
    findingId,
    evidence: finding.evidence,
    canonRevision: await readCurrentCanonRevision(bookDir),
    resolver: humanActor,
    choice,
  };
  await writeFileAtomic(resolutionPath(bookDir, record.resolutionId), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

/**
 * Resolution validity — FAILS CLOSED. Returns false when ANY binding authority
 * changed: bound revision/draft content changed, the bound finding or its
 * evidence changed, the finding no longer matches the current revision state,
 * the Canon revision changed, or the persisted resolution is corrupt/missing.
 */
export async function isResolutionStillValid(bookDir: string, resolutionId: string): Promise<boolean> {
  let resolution: HumanResolutionRecord;
  try {
    const loaded = await loadHumanResolution(bookDir, resolutionId);
    if (!loaded) return false;
    resolution = loaded;
  } catch {
    return false; // corrupt/missing resolution → fail closed
  }

  try {
    // 1. The bound finding must still exist with the SAME binding + evidence.
    const finding = await loadFoundationFinding(bookDir, resolution.revisionId, resolution.findingId);
    if (!finding) return false;
    if (
      finding.revisionId !== resolution.revisionId
      || finding.unitId !== resolution.unitId
      || finding.findingId !== resolution.findingId
    ) {
      return false;
    }
    if (JSON.stringify(finding.evidence) !== JSON.stringify(resolution.evidence)) {
      return false; // finding/evidence changed
    }

    // 2. The finding must still match the exact current revision state.
    const unitState = await readVerifiedRevisionUnitState(bookDir, resolution.revisionId, resolution.unitId);
    if (!unitState) return false;
    if (unitState.contentRevision !== finding.contentRevision || unitState.contentHash !== finding.contentHash) {
      return false; // bound revision draft changed
    }

    // 3. Canon must be unchanged.
    if ((await readCurrentCanonRevision(bookDir)) !== resolution.canonRevision) {
      return false;
    }
    return true;
  } catch {
    return false; // any inconsistency → fail closed
  }
}
