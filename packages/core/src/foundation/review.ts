import { z } from "zod";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  FindingSeveritySchema,
  RepairScopeSchema,
  SafeGovernanceIdSchema,
  type FindingSeverity,
  type RepairScope,
} from "../governance/contracts.js";
import {
  ConflictEvidenceSchema,
  FoundationRevisionStateSchema,
  readRevisionUnitDraft,
  readVerifiedRevisionUnitState,
  revisionDraftContentRelPath,
  revisionDraftStateRelPath,
} from "../governance/conflicts.js";
import { governedContentHash } from "./manifest.js";
import { commitAtomicFileSet, type AtomicFileWrite } from "../utils/atomic-file-set.js";

// ===========================================================================
// Task 7 — revision-scoped Foundation findings + bounded LOCAL repair.
//
// This module is the deterministic Core policy/persistence boundary around AI
// reviewer/repair proposals. It does NOT invoke an LLM itself (Task 10 wires
// agents): proposed findings are persisted through saveFoundationReviewFinding,
// then Core validates their finite category/severity/scope vocabulary and exact
// revisionId+unitId+contentRevision+contentHash binding before returning or
// applying them.
//
// Safe executable LOCAL repair contract: the persisted finding's exact
// `evidence` excerpt is replaced once by its `suggestedAction`. Core refuses
// ambiguous/missing excerpts, stale or caller-fabricated findings, approved-
// shaped state, MULTI_UNIT, AUTHOR_DECISION, BLOCKING, and rounds >2. Writes are
// confined to the requested revision workspace and committed as one atomic file
// set. Published Foundation, Canon, markers, siblings, and other revisions are
// never write targets.
//
// Repair never verifies itself. applyBoundedFoundationRepair persists a
// pending-verification record; verifyFoundationRepairs is a later invocation
// that re-reads the exact current draft and independently checks the repair.
// AI never creates approval/approvedRevision/Human approval records and never
// publishes; Tasks 8/9 exclusively own those authority transitions.
// ===========================================================================

export const FoundationFindingCategorySchema = z.enum([
  "story_core",
  "character",
  "relationship",
  "world",
  "structure",
  "pacing_feasibility",
  "hook",
  "timeline",
  "book_rule",
  "dependency",
  "internal_consistency",
  "author_intent_alignment",
]);
export type FoundationFindingCategory = z.infer<typeof FoundationFindingCategorySchema>;

export const FoundationFindingSchema = z.object({
  findingId: SafeGovernanceIdSchema,
  revisionId: SafeGovernanceIdSchema,
  unitId: SafeGovernanceIdSchema,
  contentRevision: z.number().int().min(1),
  contentHash: z.string().min(1),
  category: FoundationFindingCategorySchema,
  severity: FindingSeveritySchema,
  repairScope: RepairScopeSchema,
  evidence: z.string().min(1).max(4096),
  suggestedAction: z.string().min(1).max(4096),
}).strict();
export type FoundationFinding = z.infer<typeof FoundationFindingSchema>;

export type RepairOutcome =
  | { readonly status: "repaired"; readonly round: number }
  | { readonly status: "needs_human_direction"; readonly round: number; readonly remaining: ReadonlyArray<FoundationFinding> }
  | { readonly status: "clean" };

// Task 7 superset record at the SAME location Task 6 reads. Task 6's tolerant
// read view sees the required structured `evidence` array; Task 7 maps the
// human-facing diagnostic string through `findingEvidence`.
const FoundationReviewFindingRecordSchema = z.object({
  recordKind: z.literal("foundation_review"),
  findingId: SafeGovernanceIdSchema,
  revisionId: SafeGovernanceIdSchema,
  unitId: SafeGovernanceIdSchema,
  contentRevision: z.number().int().min(1),
  contentHash: z.string().min(1),
  evidence: z.array(ConflictEvidenceSchema).min(1),
  createdAt: z.string().datetime(),
  category: FoundationFindingCategorySchema,
  severity: FindingSeveritySchema,
  repairScope: RepairScopeSchema,
  findingEvidence: z.string().min(1).max(4096),
  suggestedAction: z.string().min(1).max(4096),
}).strict();
type FoundationReviewFindingRecord = z.infer<typeof FoundationReviewFindingRecordSchema>;

const RepairEntrySchema = z.object({
  findingId: SafeGovernanceIdSchema,
  unitId: SafeGovernanceIdSchema,
  evidence: z.string().min(1).max(4096),
  suggestedAction: z.string().min(1).max(4096),
  afterContentRevision: z.number().int().min(1),
  afterContentHash: z.string().min(1),
}).strict();

const RepairInvocationRecordSchema = z.object({
  recordKind: z.literal("foundation_repair"),
  revisionId: SafeGovernanceIdSchema,
  round: z.number().int().min(1).max(2),
  status: z.enum(["pending_verification", "verified"]),
  targetUnitIds: z.array(SafeGovernanceIdSchema),
  sourceFindingIds: z.array(SafeGovernanceIdSchema),
  importantFindingIds: z.array(SafeGovernanceIdSchema),
  repairs: z.array(RepairEntrySchema),
  remainingFindingIds: z.array(SafeGovernanceIdSchema),
}).strict();
type RepairInvocationRecord = z.infer<typeof RepairInvocationRecordSchema>;

function findingRelPath(revisionId: string, findingId: string): string {
  return `story/governance/findings/${SafeGovernanceIdSchema.parse(revisionId)}/${SafeGovernanceIdSchema.parse(findingId)}.gov.json`;
}

function repairRelPath(revisionId: string, round: number): string {
  const safeRevision = SafeGovernanceIdSchema.parse(revisionId);
  if (!Number.isInteger(round) || round < 1) throw new Error(`repair round must be a positive integer: ${round}`);
  return `story/revisions/${safeRevision}/repair-round-${round}.gov.json`;
}

async function loadRepairRecordIfPresent(bookDir: string, revisionId: string, round: 1 | 2): Promise<RepairInvocationRecord | null> {
  try {
    const raw = await readFile(join(bookDir, repairRelPath(revisionId, round)), "utf-8");
    return RepairInvocationRecordSchema.parse(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function toRecord(finding: FoundationFinding, createdAt = new Date().toISOString()): FoundationReviewFindingRecord {
  const validated = FoundationFindingSchema.parse(finding);
  return FoundationReviewFindingRecordSchema.parse({
    recordKind: "foundation_review",
    findingId: validated.findingId,
    revisionId: validated.revisionId,
    unitId: validated.unitId,
    contentRevision: validated.contentRevision,
    contentHash: validated.contentHash,
    evidence: [{ source: "foundation-reviewer", detail: validated.evidence }],
    createdAt,
    category: validated.category,
    severity: validated.severity,
    repairScope: validated.repairScope,
    findingEvidence: validated.evidence,
    suggestedAction: validated.suggestedAction,
  });
}

function fromRecord(record: FoundationReviewFindingRecord): FoundationFinding {
  return FoundationFindingSchema.parse({
    findingId: record.findingId,
    revisionId: record.revisionId,
    unitId: record.unitId,
    contentRevision: record.contentRevision,
    contentHash: record.contentHash,
    category: record.category,
    severity: record.severity,
    repairScope: record.repairScope,
    evidence: record.findingEvidence,
    suggestedAction: record.suggestedAction,
  });
}

export async function saveFoundationReviewFinding(bookDir: string, finding: FoundationFinding): Promise<void> {
  const record = toRecord(finding);
  await commitAtomicFileSet({
    rootDir: bookDir,
    writes: [{ relativePath: findingRelPath(record.revisionId, record.findingId), content: `${JSON.stringify(record, null, 2)}\n` }],
  });
}

async function loadReviewFindingRecord(bookDir: string, revisionId: string, findingId: string): Promise<FoundationReviewFindingRecord> {
  const raw = await readFile(join(bookDir, findingRelPath(revisionId, findingId)), "utf-8");
  return FoundationReviewFindingRecordSchema.parse(JSON.parse(raw));
}

async function loadRevisionStateRaw(bookDir: string, revisionId: string): Promise<{
  readonly view: z.infer<typeof FoundationRevisionStateSchema>;
  readonly raw: { revisionId: string; unitStates: Array<Record<string, unknown>>; [key: string]: unknown };
}> {
  const safeRevision = SafeGovernanceIdSchema.parse(revisionId);
  const rawText = await readFile(join(bookDir, revisionDraftStateRelPath(safeRevision)), "utf-8");
  const parsed = JSON.parse(rawText) as unknown;
  const view = FoundationRevisionStateSchema.parse(parsed);
  if (view.revisionId !== safeRevision) throw new Error(`Revision state mismatch: expected ${safeRevision}, got ${view.revisionId}`);
  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { unitStates?: unknown }).unitStates)) {
    throw new Error(`Revision ${safeRevision} state is corrupt`);
  }
  return { view, raw: parsed as { revisionId: string; unitStates: Array<Record<string, unknown>>; [key: string]: unknown } };
}

function sameFinding(left: FoundationFinding, right: FoundationFinding): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function loadTrustedCallerFinding(bookDir: string, revisionId: string, caller: FoundationFinding): Promise<FoundationFinding> {
  const validated = FoundationFindingSchema.parse(caller);
  if (validated.revisionId !== revisionId) throw new Error(`Finding ${validated.findingId} belongs to revision ${validated.revisionId}, not ${revisionId}`);
  const persisted = fromRecord(await loadReviewFindingRecord(bookDir, revisionId, validated.findingId));
  if (!sameFinding(validated, persisted)) throw new Error(`Finding ${validated.findingId} does not match trusted persisted state`);
  return persisted;
}

async function assertCurrentBinding(bookDir: string, finding: FoundationFinding): Promise<void> {
  const current = await readVerifiedRevisionUnitState(bookDir, finding.revisionId, finding.unitId);
  if (!current || current.contentRevision !== finding.contentRevision || current.contentHash !== finding.contentHash) {
    throw new Error(`Finding ${finding.findingId} is stale — revision draft content changed; require new review`);
  }
}

export async function reviewFoundationRevision(bookDir: string, revisionId: string): Promise<ReadonlyArray<FoundationFinding>> {
  const safeRevision = SafeGovernanceIdSchema.parse(revisionId);
  const { view } = await loadRevisionStateRaw(bookDir, safeRevision);
  const currentByUnit = new Map<string, { contentRevision: number; contentHash: string }>();
  for (const unit of view.unitStates) {
    const verified = await readVerifiedRevisionUnitState(bookDir, safeRevision, unit.unitId);
    if (!verified) throw new Error(`Revision ${safeRevision} unit ${unit.unitId} has no verifiable state`);
    currentByUnit.set(unit.unitId, verified);
  }

  const dir = join(bookDir, "story", "governance", "findings", safeRevision);
  const entries = await readdir(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [] as string[];
    throw error;
  });
  const findings: FoundationFinding[] = [];
  for (const entry of entries.filter((name) => name.endsWith(".gov.json")).sort()) {
    const raw = JSON.parse(await readFile(join(dir, entry), "utf-8")) as { recordKind?: unknown };
    if (raw.recordKind !== "foundation_review") continue; // Task 6 conflict-only finding
    const record = FoundationReviewFindingRecordSchema.parse(raw);
    if (record.revisionId !== safeRevision) throw new Error(`Finding ${record.findingId} revision binding mismatch`);
    const current = currentByUnit.get(record.unitId);
    if (!current) throw new Error(`Finding ${record.findingId} targets a unit absent from revision ${safeRevision}`);
    if (current.contentRevision !== record.contentRevision || current.contentHash !== record.contentHash) continue; // stale result is never returned as current review
    findings.push(fromRecord(record));
  }
  return findings;
}

function countOccurrences(content: string, excerpt: string): number {
  let count = 0;
  let offset = 0;
  while (true) {
    const found = content.indexOf(excerpt, offset);
    if (found < 0) return count;
    count += 1;
    offset = found + excerpt.length;
  }
}

function autoRepairable(finding: FoundationFinding): boolean {
  return finding.repairScope === "local" && (finding.severity === "minor" || finding.severity === "important");
}

export async function applyBoundedFoundationRepair(
  bookDir: string,
  revisionId: string,
  targetUnitIds: ReadonlyArray<string>,
  findings: ReadonlyArray<FoundationFinding>,
  round: number,
): Promise<RepairOutcome> {
  const safeRevision = SafeGovernanceIdSchema.parse(revisionId);
  if (!Number.isInteger(round) || round < 1) throw new Error(`repair round must be a positive integer: ${round}`);
  const targets = [...new Set(targetUnitIds.map((id) => SafeGovernanceIdSchema.parse(id)))];
  const validatedFindings = findings.map((item) => FoundationFindingSchema.parse(item));
  if (validatedFindings.length === 0) return { status: "clean" };
  if (round > 2) return { status: "needs_human_direction", round, remaining: validatedFindings };
  const round1 = await loadRepairRecordIfPresent(bookDir, safeRevision, 1);
  const round2 = await loadRepairRecordIfPresent(bookDir, safeRevision, 2);
  const currentRecord = round === 1 ? round1 : round2;
  if (currentRecord) {
    throw new Error(`Repair round ${round} for revision ${safeRevision} was already used; no hidden retry is allowed`);
  }
  // Round 2 is legal only after a SEPARATE successful verification invocation
  // completed round 1. This prevents repair from self-certifying or skipping
  // the mandatory targeted re-review between semantic rounds.
  if (round === 2 && (!round1 || round1.status !== "verified")) {
    throw new Error(`Repair round 2 requires separately verified round 1 for revision ${safeRevision}`);
  }
  if (round === 1 && round2) {
    throw new Error(`Repair rounds cannot run out of order for revision ${safeRevision}`);
  }
  const callerIds = validatedFindings.map((item) => item.findingId);
  if (new Set(callerIds).size !== callerIds.length) throw new Error("Repair findings contain duplicate findingIds");

  const trusted: FoundationFinding[] = [];
  for (const caller of validatedFindings) {
    const persisted = await loadTrustedCallerFinding(bookDir, safeRevision, caller);
    if (!targets.includes(persisted.unitId)) throw new Error(`Finding ${persisted.findingId} targets ${persisted.unitId}, outside requested LOCAL targets`);
    await assertCurrentBinding(bookDir, persisted);
    trusted.push(persisted);
  }

  // Caller subset is NOT authority. Before modifying any target unit, require
  // the supplied trusted set to cover every CURRENT persisted Task 7 finding
  // on that unit. Otherwise a selected LOCAL edit could stale-clear an omitted
  // BLOCKING/MULTI_UNIT/AUTHOR_DECISION finding from the current review view.
  const currentReview = await reviewFoundationRevision(bookDir, safeRevision);
  const trustedIds = new Set(trusted.map((item) => item.findingId));
  const omitted = currentReview.filter((item) => targets.includes(item.unitId) && !trustedIds.has(item.findingId));
  if (omitted.length > 0) {
    throw new Error(`Repair request omitted current findings for target units: ${omitted.map((item) => item.findingId).join(", ")}`);
  }

  const { raw: stateRaw } = await loadRevisionStateRaw(bookDir, safeRevision);
  const byUnit = new Map<string, FoundationFinding[]>();
  for (const item of trusted) {
    const list = byUnit.get(item.unitId) ?? [];
    list.push(item);
    byUnit.set(item.unitId, list);
  }

  const writes: AtomicFileWrite[] = [];
  const repairedEntries: Array<z.infer<typeof RepairEntrySchema>> = [];
  const remaining: FoundationFinding[] = [];

  for (const [unitId, unitFindings] of byUnit) {
    const rawUnitState = stateRaw.unitStates.find((entry) => entry.unitId === unitId);
    if (!rawUnitState) throw new Error(`Revision ${safeRevision} missing raw state for ${unitId}`);
    const approvedShaped = rawUnitState.state === "approved" || rawUnitState.approvedRevision !== undefined;
    const hasHumanRoutedFinding = unitFindings.some((item) => !autoRepairable(item));
    // A Human-routed finding blocks ALL automatic edits on the same unit. This
    // prevents a LOCAL edit from staling/erasing an unresolved BLOCKING,
    // MULTI_UNIT, or AUTHOR_DECISION finding bound to that content.
    if (approvedShaped || hasHumanRoutedFinding) {
      remaining.push(...unitFindings);
      continue;
    }
    const currentState = await readVerifiedRevisionUnitState(bookDir, safeRevision, unitId);
    const original = await readRevisionUnitDraft(bookDir, safeRevision, unitId);
    if (!currentState || original === null) throw new Error(`Revision ${safeRevision}/${unitId} is not repairable`);
    // Preflight the ENTIRE unit patch before modifying anything: every excerpt
    // must be unique in the original content and every replacement distinct.
    // If one proposal is ambiguous, none of the unit's findings are repaired.
    if (unitFindings.some((item) => item.suggestedAction === item.evidence || countOccurrences(original, item.evidence) !== 1)) {
      remaining.push(...unitFindings);
      continue;
    }
    let updated = original;
    for (const item of unitFindings) updated = updated.replace(item.evidence, () => item.suggestedAction);
    if (
      updated === original
      || unitFindings.some((item) => countOccurrences(updated, item.evidence) !== 0 || !updated.includes(item.suggestedAction))
    ) {
      remaining.push(...unitFindings);
      continue;
    }
    const applied = unitFindings;
    const afterContentRevision = currentState.contentRevision + 1;
    const afterContentHash = governedContentHash(updated);
    rawUnitState.contentRevision = afterContentRevision;
    rawUnitState.contentHash = afterContentHash;
    if (typeof rawUnitState.state === "string") rawUnitState.state = "needs_review";
    writes.push({ relativePath: revisionDraftContentRelPath(safeRevision, unitId), content: updated });
    for (const item of applied) {
      repairedEntries.push({
        findingId: item.findingId,
        unitId,
        evidence: item.evidence,
        suggestedAction: item.suggestedAction,
        afterContentRevision,
        afterContentHash,
      });
    }
  }

  if (repairedEntries.length === 0) {
    return { status: "needs_human_direction", round, remaining };
  }

  const repairRecord: RepairInvocationRecord = {
    recordKind: "foundation_repair",
    revisionId: safeRevision,
    round,
    status: "pending_verification",
    targetUnitIds: targets,
    sourceFindingIds: trusted.map((item) => item.findingId),
    importantFindingIds: trusted.filter((item) => item.severity === "important" && repairedEntries.some((entry) => entry.findingId === item.findingId)).map((item) => item.findingId),
    repairs: repairedEntries,
    remainingFindingIds: remaining.map((item) => item.findingId),
  };
  writes.push({ relativePath: revisionDraftStateRelPath(safeRevision), content: `${JSON.stringify(stateRaw, null, 2)}\n` });
  writes.push({ relativePath: repairRelPath(safeRevision, round), content: `${JSON.stringify(repairRecord, null, 2)}\n` });
  await commitAtomicFileSet({ rootDir: bookDir, writes });

  if (remaining.length > 0) return { status: "needs_human_direction", round, remaining };
  return { status: "repaired", round };
}

export async function verifyFoundationRepairs(
  bookDir: string,
  revisionId: string,
  targetUnitIds: ReadonlyArray<string>,
  findings: ReadonlyArray<FoundationFinding>,
  round: number,
): Promise<ReadonlyArray<FoundationFinding>> {
  const safeRevision = SafeGovernanceIdSchema.parse(revisionId);
  const targets = [...new Set(targetUnitIds.map((id) => SafeGovernanceIdSchema.parse(id)))];
  const raw = await readFile(join(bookDir, repairRelPath(safeRevision, round)), "utf-8");
  const record = RepairInvocationRecordSchema.parse(JSON.parse(raw));
  if (record.status !== "pending_verification") throw new Error(`Repair round ${round} has no pending separate verification`);
  if (JSON.stringify(record.targetUnitIds) !== JSON.stringify(targets)) throw new Error("Verification target set does not match repair invocation");

  const trusted: FoundationFinding[] = [];
  for (const caller of findings) trusted.push(await loadTrustedCallerFinding(bookDir, safeRevision, caller));
  if (JSON.stringify(record.sourceFindingIds) !== JSON.stringify(trusted.map((item) => item.findingId))) {
    throw new Error("Verification findings do not match repair invocation");
  }

  const remaining: FoundationFinding[] = [];
  const writes: AtomicFileWrite[] = [];
  let allRepairsVerified = true;
  for (const item of trusted) {
    const repair = record.repairs.find((entry) => entry.findingId === item.findingId);
    if (!repair) {
      const current = await readVerifiedRevisionUnitState(bookDir, safeRevision, item.unitId);
      if (!current) throw new Error(`Cannot verify ${item.findingId}: current draft unavailable`);
      if (current.contentRevision === item.contentRevision && current.contentHash === item.contentHash) {
        remaining.push(item);
      } else if (record.repairs.some((entry) => entry.unitId === item.unitId)) {
        // Another LOCAL finding changed the same unit in this invocation. The
        // unresolved finding remains blocking/human-routed, but must be rebound
        // to the current verified draft rather than silently dropped or treated
        // as an external stale-finding error.
        const rebound: FoundationFinding = {
          ...item,
          findingId: randomUUID(),
          contentRevision: current.contentRevision,
          contentHash: current.contentHash,
        };
        remaining.push(rebound);
        const persisted = toRecord(rebound);
        writes.push({ relativePath: findingRelPath(safeRevision, rebound.findingId), content: `${JSON.stringify(persisted, null, 2)}\n` });
      } else {
        throw new Error(`Finding ${item.findingId} is stale during verification`);
      }
      continue;
    }
    const current = await readVerifiedRevisionUnitState(bookDir, safeRevision, item.unitId);
    const content = await readRevisionUnitDraft(bookDir, safeRevision, item.unitId);
    if (!current || content === null) throw new Error(`Cannot verify ${item.findingId}: current draft unavailable`);
    // Verification certifies the EXACT output produced by apply, not merely the
    // presence/absence of two strings. Any intervening edit (even one retaining
    // the suggestion) changes the revision/hash and must fail/rebound.
    const exactBinding =
      current.contentRevision === repair.afterContentRevision
      && current.contentHash === repair.afterContentHash;
    const fixed =
      exactBinding
      && countOccurrences(content, repair.evidence) === 0
      && content.includes(repair.suggestedAction);
    if (!fixed) {
      allRepairsVerified = false;
      const rebound: FoundationFinding = {
        ...item,
        findingId: randomUUID(),
        contentRevision: current.contentRevision,
        contentHash: current.contentHash,
      };
      remaining.push(rebound);
      const persisted = toRecord(rebound);
      writes.push({ relativePath: findingRelPath(safeRevision, rebound.findingId), content: `${JSON.stringify(persisted, null, 2)}\n` });
    }
  }

  const verified: RepairInvocationRecord = {
    ...record,
    // A binding mismatch or incomplete fix means the exact repaired output was
    // not verified; keep round pending so round 2 cannot proceed from unverified state.
    status: allRepairsVerified ? "verified" : "pending_verification",
    remainingFindingIds: remaining.map((item) => item.findingId),
  };
  writes.push({ relativePath: repairRelPath(safeRevision, round), content: `${JSON.stringify(verified, null, 2)}\n` });
  await commitAtomicFileSet({ rootDir: bookDir, writes });
  return remaining;
}

// Explicit type re-exports keep the policy vocabulary tied to Core-owned T1 schemas.
export type { FindingSeverity, RepairScope };
