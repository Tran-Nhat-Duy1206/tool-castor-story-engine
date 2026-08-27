import { z } from "zod";
import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { SafeGovernanceIdSchema, type SafeGovernanceId } from "../governance/contracts.js";
import {
  readRevisionUnitDraft,
  readCurrentCanonRevision,
  revisionDraftContentRelPath,
  revisionDraftStateRelPath,
  loadHumanResolution,
  isResolutionStillValid,
} from "../governance/conflicts.js";
import {
  governedContentHash,
  readUnitManifests,
  extractGovernedContent,
} from "./manifest.js";
import { reviewFoundationRevision } from "./review.js";
import { createVersionStore, type FoundationPublishedSnapshot } from "../governance/versions.js";
import { commitAtomicFileSet, type AtomicFileWrite } from "../utils/atomic-file-set.js";

// ===========================================================================
// Task 8 — Foundation revision/review service (Human approval state transitions).
//
// This module manages Foundation Revision Draft workspaces and explicit Human
// approval state transitions.
//
// RISK POLICIES & BOUNDARIES:
// 1. AI CANNOT APPROVE: AI repair output moves content to needs_review;
//    only explicit Human calls (approveFoundationUnit, reapproveStaleFoundationUnit,
//    approveFoundationUnitsBatch) produce Human approval transitions.
// 2. TRUSTED HUMAN APPROVAL: The Human caller supplies WHAT to approve;
//    Core verifies contentRevision, contentHash, review findings, dependencies,
//    and stale status from trusted persisted state. Callers cannot fabricate state.
// 3. EXPLICIT HUMAN PROVENANCE: Every approval binds approvedRevision,
//    approvedAt, and approvedBy from the explicit humanActor (no implicit/system fallback).
// 4. CONTENT ISOLATION & IMMUTABILITY: Working draft prose lives strictly inside
//    story/revisions/<revisionId>/; Published Foundation Markdown remains byte-identical
//    and production-readable until Task 9 Publish. Two concurrent revisions hold
//    isolated content.
// 5. NO PROSE IN JSON: draft.gov.json carries governance metadata, hashes,
//    and approval records only — NEVER creative prose.
// ===========================================================================

export const FoundationRevisionStatusSchema = z.enum(["open", "needs_review", "reviewed", "discarded"]);
export type FoundationRevisionStatus = z.infer<typeof FoundationRevisionStatusSchema>;

export const FoundationUnitDraftStateSchema = z.enum(["draft", "needs_review", "approved", "stale"]);
export type FoundationUnitDraftState = z.infer<typeof FoundationUnitDraftStateSchema>;

export const FoundationUnitStateEntrySchema = z.object({
  unitId: SafeGovernanceIdSchema,
  contentRevision: z.number().int().min(1),
  approvedRevision: z.number().int().min(1).optional(),
  contentHash: z.string().min(1),
  state: FoundationUnitDraftStateSchema,
}).strict();
export type FoundationUnitStateEntry = z.infer<typeof FoundationUnitStateEntrySchema>;

export const FoundationApprovalRecordSchema = z.object({
  unitId: SafeGovernanceIdSchema,
  approvedRevision: z.number().int().min(1),
  approvedBy: z.string().min(1),
  approvedAt: z.string().datetime(),
}).strict();
export type FoundationApprovalRecord = z.infer<typeof FoundationApprovalRecordSchema>;

export const FoundationRevisionDraftSchema = z.object({
  revisionId: SafeGovernanceIdSchema,
  baseFoundationVersion: z.number().int().min(1).nullable(),
  baseCanonRevision: z.number().int().min(0),
  status: FoundationRevisionStatusSchema,
  unitStates: z.array(FoundationUnitStateEntrySchema),
  approvalRecords: z.array(FoundationApprovalRecordSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  restoredFromVersion: z.number().int().min(1).optional(),
}).strict();
export type FoundationRevisionDraft = z.infer<typeof FoundationRevisionDraftSchema>;

function validateHumanActor(actor: string): string {
  const parsed = z.string().min(1, "humanActor must not be empty").parse(actor).trim();
  const lower = parsed.toLowerCase();
  if (["system", "ai", "llm", "auto", "automated", "bot"].includes(lower)) {
    throw new Error(`Approval requires an explicit Human actor, not AI or system: "${actor}"`);
  }
  return parsed;
}

async function findInitialUnitContent(bookDir: string, unitId: string): Promise<string> {
  try {
    const manifests = await readUnitManifests(bookDir);
    const manifest = manifests.get(unitId);
    if (manifest) {
      return await extractGovernedContent(bookDir, manifest.locator);
    }
  } catch {
    // Ignore extraction failure; fallback to outline or default
  }

  // Fallback: check story/foundation/<unitId>.md or story/outline/<unitId>.md
  for (const candidate of [
    join(bookDir, "story", "foundation", `${unitId}.md`),
    join(bookDir, "story", "outline", `${unitId}.md`),
  ]) {
    try {
      return await readFile(candidate, "utf-8");
    } catch {
      // not found
    }
  }
  return "";
}

export async function openFoundationRevision(
  bookDir: string,
  unitIds: ReadonlyArray<SafeGovernanceId>,
): Promise<{ revisionId: string }> {
  if (unitIds.length === 0) {
    throw new Error("unitIds must not be empty when opening a Foundation revision");
  }
  const safeUnitIds = unitIds.map((id) => SafeGovernanceIdSchema.parse(id));
  if (new Set(safeUnitIds).size !== safeUnitIds.length) {
    throw new Error("Duplicate unitIds found in revision request");
  }

  const store = createVersionStore(bookDir);
  const currentVersion = await store.readCurrentVersion<FoundationPublishedSnapshot>("foundation", "foundation");
  const baseFoundationVersion = currentVersion !== null ? currentVersion.version : null;
  const baseCanonRevision = await readCurrentCanonRevision(bookDir);

  const revisionId = SafeGovernanceIdSchema.parse(`rev-${randomUUID()}`);
  const now = new Date().toISOString();

  const writes: AtomicFileWrite[] = [];
  const unitStates: FoundationUnitStateEntry[] = [];

  for (const unitId of safeUnitIds) {
    const initialContent = await findInitialUnitContent(bookDir, unitId);
    const contentHash = governedContentHash(initialContent);
    unitStates.push({
      unitId,
      contentRevision: 1,
      contentHash,
      state: "draft",
    });
    writes.push({
      relativePath: revisionDraftContentRelPath(revisionId, unitId),
      content: initialContent,
    });
  }

  const draft: FoundationRevisionDraft = {
    revisionId,
    baseFoundationVersion,
    baseCanonRevision,
    status: "open",
    unitStates,
    approvalRecords: [],
    createdAt: now,
    updatedAt: now,
  };

  writes.push({
    relativePath: revisionDraftStateRelPath(revisionId),
    content: `${JSON.stringify(draft, null, 2)}\n`,
  });

  await commitAtomicFileSet({ rootDir: bookDir, writes });
  return { revisionId };
}

export async function loadFoundationRevision(
  bookDir: string,
  revisionId: string,
): Promise<FoundationRevisionDraft> {
  const safeRevision = SafeGovernanceIdSchema.parse(revisionId);
  const path = join(bookDir, revisionDraftStateRelPath(safeRevision));
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Foundation revision "${safeRevision}" does not exist`);
    }
    throw error;
  }
  const parsed = JSON.parse(raw) as unknown;
  const draft = FoundationRevisionDraftSchema.parse(parsed);
  if (draft.revisionId !== safeRevision) {
    throw new Error(`Revision ID mismatch: expected "${safeRevision}", found "${draft.revisionId}"`);
  }
  return draft;
}

export async function saveFoundationUnitDraft(
  bookDir: string,
  revisionId: string,
  unitId: string,
  content: string,
): Promise<void> {
  const safeRevision = SafeGovernanceIdSchema.parse(revisionId);
  const safeUnit = SafeGovernanceIdSchema.parse(unitId);

  const draft = await loadFoundationRevision(bookDir, safeRevision);
  if (draft.status === "discarded") {
    throw new Error(`Cannot edit discarded revision "${safeRevision}"`);
  }

  const unitIndex = draft.unitStates.findIndex((u) => u.unitId === safeUnit);
  if (unitIndex < 0) {
    throw new Error(`Unit "${safeUnit}" is not part of revision "${safeRevision}"`);
  }

  const currentUnit = draft.unitStates[unitIndex]!;
  const newHash = governedContentHash(content);
  const contentChanged = newHash !== currentUnit.contentHash;

  const nextContentRevision = contentChanged ? currentUnit.contentRevision + 1 : currentUnit.contentRevision;

  const updatedUnit: FoundationUnitStateEntry = {
    ...currentUnit,
    contentRevision: nextContentRevision,
    contentHash: newHash,
    state: "needs_review",
    approvedRevision: undefined,
  };

  const updatedUnitStates = [...draft.unitStates];
  updatedUnitStates[unitIndex] = updatedUnit;

  // Invalidate any existing approval record for this unit
  const updatedApprovalRecords = draft.approvalRecords.filter((r) => r.unitId !== safeUnit);

  const now = new Date().toISOString();
  const updatedDraft: FoundationRevisionDraft = {
    ...draft,
    status: "needs_review",
    unitStates: updatedUnitStates,
    approvalRecords: updatedApprovalRecords,
    updatedAt: now,
  };

  const writes: AtomicFileWrite[] = [
    {
      relativePath: revisionDraftContentRelPath(safeRevision, safeUnit),
      content,
    },
    {
      relativePath: revisionDraftStateRelPath(safeRevision),
      content: `${JSON.stringify(updatedDraft, null, 2)}\n`,
    },
  ];

  await commitAtomicFileSet({ rootDir: bookDir, writes });
}

async function checkTask6Resolution(
  bookDir: string,
  revisionId: string,
  unitId: string,
  resolutionId?: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  // Check if findings exist under story/governance/findings/<revisionId>/ for this unit
  const findingsDir = join(bookDir, "story", "governance", "findings", revisionId);
  let hasUnitFindings = false;
  try {
    const entries = await readdir(findingsDir);
    for (const entry of entries) {
      if (!entry.endsWith(".gov.json")) continue;
      const raw = await readFile(join(findingsDir, entry), "utf-8");
      const parsed = JSON.parse(raw) as { unitId?: string };
      if (parsed.unitId === unitId) {
        hasUnitFindings = true;
        break;
      }
    }
  } catch {
    // No findings dir
  }

  if (hasUnitFindings && !resolutionId) {
    return {
      ok: false,
      reason: `Unit "${unitId}" has conflict findings; Task 6 Human Resolution is required for stale reapproval`,
    };
  }

  if (resolutionId) {
    const resolution = await loadHumanResolution(bookDir, resolutionId);
    if (!resolution) {
      return { ok: false, reason: `Human resolution "${resolutionId}" not found` };
    }
    if (resolution.revisionId !== revisionId || resolution.unitId !== unitId) {
      return {
        ok: false,
        reason: `Human resolution "${resolutionId}" does not match revision "${revisionId}" and unit "${unitId}"`,
      };
    }
    if (resolution.choice !== "compatible") {
      return {
        ok: false,
        reason: `Human resolution "${resolutionId}" choice is "${resolution.choice}", not "compatible"`,
      };
    }
    const valid = await isResolutionStillValid(bookDir, resolutionId);
    if (!valid) {
      return { ok: false, reason: `Human resolution "${resolutionId}" is no longer valid (stale or changed)` };
    }
  }

  return { ok: true };
}

async function evaluateUnitApprovalEligibility(
  bookDir: string,
  draft: FoundationRevisionDraft,
  unitId: string,
  isReapproval: boolean,
  resolutionId?: string,
): Promise<{ ok: true; unitState: FoundationUnitStateEntry } | { ok: false; reason: string }> {
  const unitState = draft.unitStates.find((u) => u.unitId === unitId);
  if (!unitState) {
    return { ok: false, reason: `Unit "${unitId}" not found in revision "${draft.revisionId}"` };
  }

  if (draft.status === "discarded") {
    return { ok: false, reason: `Revision "${draft.revisionId}" is discarded` };
  }

  if (!isReapproval && unitState.state === "stale") {
    return {
      ok: false,
      reason: `Unit "${unitId}" is stale; ordinary approval is rejected. Use reapproveStaleFoundationUnit.`,
    };
  }

  if (isReapproval && unitState.state !== "stale") {
    return {
      ok: false,
      reason: `Unit "${unitId}" is in state "${unitState.state}", not stale.`,
    };
  }

  const content = await readRevisionUnitDraft(bookDir, draft.revisionId, unitId);
  if (content === null) {
    return { ok: false, reason: `Draft content file missing for unit "${unitId}" (inconsistent workspace)` };
  }

  const currentHash = governedContentHash(content);
  if (currentHash !== unitState.contentHash) {
    return {
      ok: false,
      reason: `Draft content hash mismatch for unit "${unitId}": state hash "${unitState.contentHash}" != actual content hash "${currentHash}" (inconsistent workspace)`,
    };
  }

  // Check review findings: unresolved findings block approval
  const reviewFindings = await reviewFoundationRevision(bookDir, draft.revisionId);
  const unitFindings = reviewFindings.filter((f) => f.unitId === unitId);
  if (unitFindings.length > 0) {
    return {
      ok: false,
      reason: `Unit "${unitId}" has unresolved review findings: ${unitFindings.map((f) => f.findingId).join(", ")}`,
    };
  }

  if (isReapproval) {
    const resCheck = await checkTask6Resolution(bookDir, draft.revisionId, unitId, resolutionId);
    if (!resCheck.ok) return resCheck;
  }

  return { ok: true, unitState };
}

export async function approveFoundationUnit(
  bookDir: string,
  revisionId: string,
  unitId: string,
  humanActor: string,
): Promise<void> {
  const validHuman = validateHumanActor(humanActor);
  const safeRevision = SafeGovernanceIdSchema.parse(revisionId);
  const safeUnit = SafeGovernanceIdSchema.parse(unitId);

  const draft = await loadFoundationRevision(bookDir, safeRevision);
  const eligibility = await evaluateUnitApprovalEligibility(bookDir, draft, safeUnit, false);
  if (!eligibility.ok) {
    throw new Error(eligibility.reason);
  }

  const unitIndex = draft.unitStates.findIndex((u) => u.unitId === safeUnit);
  const unit = draft.unitStates[unitIndex]!;
  const approvedRevision = unit.contentRevision;

  const updatedUnit: FoundationUnitStateEntry = {
    ...unit,
    state: "approved",
    approvedRevision,
  };

  const updatedUnitStates = [...draft.unitStates];
  updatedUnitStates[unitIndex] = updatedUnit;

  const now = new Date().toISOString();
  const filteredApprovals = draft.approvalRecords.filter((r) => r.unitId !== safeUnit);
  filteredApprovals.push({
    unitId: safeUnit,
    approvedRevision,
    approvedBy: validHuman,
    approvedAt: now,
  });

  const allApproved = updatedUnitStates.every((u) => u.state === "approved");
  const updatedDraft: FoundationRevisionDraft = {
    ...draft,
    status: allApproved ? "reviewed" : "needs_review",
    unitStates: updatedUnitStates,
    approvalRecords: filteredApprovals,
    updatedAt: now,
  };

  await commitAtomicFileSet({
    rootDir: bookDir,
    writes: [
      {
        relativePath: revisionDraftStateRelPath(safeRevision),
        content: `${JSON.stringify(updatedDraft, null, 2)}\n`,
      },
    ],
  });
}

export async function reapproveStaleFoundationUnit(
  bookDir: string,
  revisionId: string,
  unitId: string,
  humanActor: string,
  resolutionId?: string,
): Promise<void> {
  const validHuman = validateHumanActor(humanActor);
  const safeRevision = SafeGovernanceIdSchema.parse(revisionId);
  const safeUnit = SafeGovernanceIdSchema.parse(unitId);

  const draft = await loadFoundationRevision(bookDir, safeRevision);
  const eligibility = await evaluateUnitApprovalEligibility(bookDir, draft, safeUnit, true, resolutionId);
  if (!eligibility.ok) {
    throw new Error(eligibility.reason);
  }

  const unitIndex = draft.unitStates.findIndex((u) => u.unitId === safeUnit);
  const unit = draft.unitStates[unitIndex]!;
  const approvedRevision = unit.contentRevision;

  const updatedUnit: FoundationUnitStateEntry = {
    ...unit,
    state: "approved",
    approvedRevision,
  };

  const updatedUnitStates = [...draft.unitStates];
  updatedUnitStates[unitIndex] = updatedUnit;

  const now = new Date().toISOString();
  const filteredApprovals = draft.approvalRecords.filter((r) => r.unitId !== safeUnit);
  filteredApprovals.push({
    unitId: safeUnit,
    approvedRevision,
    approvedBy: validHuman,
    approvedAt: now,
  });

  const allApproved = updatedUnitStates.every((u) => u.state === "approved");
  const updatedDraft: FoundationRevisionDraft = {
    ...draft,
    status: allApproved ? "reviewed" : "needs_review",
    unitStates: updatedUnitStates,
    approvalRecords: filteredApprovals,
    updatedAt: now,
  };

  await commitAtomicFileSet({
    rootDir: bookDir,
    writes: [
      {
        relativePath: revisionDraftStateRelPath(safeRevision),
        content: `${JSON.stringify(updatedDraft, null, 2)}\n`,
      },
    ],
  });
}

export async function markFoundationUnitNeedsRevision(
  bookDir: string,
  revisionId: string,
  unitId: string,
  reason: string,
): Promise<void> {
  const safeRevision = SafeGovernanceIdSchema.parse(revisionId);
  const safeUnit = SafeGovernanceIdSchema.parse(unitId);

  const draft = await loadFoundationRevision(bookDir, safeRevision);
  const unitIndex = draft.unitStates.findIndex((u) => u.unitId === safeUnit);
  if (unitIndex < 0) {
    throw new Error(`Unit "${safeUnit}" not found in revision "${safeRevision}"`);
  }

  const unit = draft.unitStates[unitIndex]!;
  const nextState: FoundationUnitDraftState = /stale/i.test(reason) ? "stale" : "needs_review";

  const updatedUnit: FoundationUnitStateEntry = {
    ...unit,
    state: nextState,
    approvedRevision: undefined,
  };

  const updatedUnitStates = [...draft.unitStates];
  updatedUnitStates[unitIndex] = updatedUnit;

  const filteredApprovals = draft.approvalRecords.filter((r) => r.unitId !== safeUnit);

  const now = new Date().toISOString();
  const updatedDraft: FoundationRevisionDraft = {
    ...draft,
    status: "needs_review",
    unitStates: updatedUnitStates,
    approvalRecords: filteredApprovals,
    updatedAt: now,
  };

  await commitAtomicFileSet({
    rootDir: bookDir,
    writes: [
      {
        relativePath: revisionDraftStateRelPath(safeRevision),
        content: `${JSON.stringify(updatedDraft, null, 2)}\n`,
      },
    ],
  });
}

export async function approveFoundationUnitsBatch(
  bookDir: string,
  revisionId: string,
  unitIds: ReadonlyArray<SafeGovernanceId>,
  humanActor: string,
): Promise<{
  approved: ReadonlyArray<string>;
  rejected: ReadonlyArray<{ unitId: string; reason: string }>;
}> {
  const validHuman = validateHumanActor(humanActor);
  const safeRevision = SafeGovernanceIdSchema.parse(revisionId);
  const draft = await loadFoundationRevision(bookDir, safeRevision);

  const approved: string[] = [];
  const rejected: Array<{ unitId: string; reason: string }> = [];

  const updatedUnitStates = [...draft.unitStates];
  let updatedApprovalRecords = [...draft.approvalRecords];
  const now = new Date().toISOString();

  for (const rawUnitId of unitIds) {
    let safeUnit: string;
    try {
      safeUnit = SafeGovernanceIdSchema.parse(rawUnitId);
    } catch (e) {
      rejected.push({ unitId: String(rawUnitId), reason: (e as Error).message });
      continue;
    }

    const eligibility = await evaluateUnitApprovalEligibility(bookDir, draft, safeUnit, false);
    if (!eligibility.ok) {
      rejected.push({ unitId: safeUnit, reason: eligibility.reason });
      continue;
    }

    const unitIndex = updatedUnitStates.findIndex((u) => u.unitId === safeUnit);
    const unit = updatedUnitStates[unitIndex]!;
    const approvedRevision = unit.contentRevision;

    updatedUnitStates[unitIndex] = {
      ...unit,
      state: "approved",
      approvedRevision,
    };

    updatedApprovalRecords = updatedApprovalRecords.filter((r) => r.unitId !== safeUnit);
    updatedApprovalRecords.push({
      unitId: safeUnit,
      approvedRevision,
      approvedBy: validHuman,
      approvedAt: now,
    });

    approved.push(safeUnit);
  }

  if (approved.length > 0) {
    const allApproved = updatedUnitStates.every((u) => u.state === "approved");
    const updatedDraft: FoundationRevisionDraft = {
      ...draft,
      status: allApproved ? "reviewed" : "needs_review",
      unitStates: updatedUnitStates,
      approvalRecords: updatedApprovalRecords,
      updatedAt: now,
    };

    await commitAtomicFileSet({
      rootDir: bookDir,
      writes: [
        {
          relativePath: revisionDraftStateRelPath(safeRevision),
          content: `${JSON.stringify(updatedDraft, null, 2)}\n`,
        },
      ],
    });
  }

  return { approved, rejected };
}

export async function discardFoundationRevision(
  bookDir: string,
  revisionId: string,
): Promise<void> {
  const safeRevision = SafeGovernanceIdSchema.parse(revisionId);
  const dir = join(bookDir, "story", "revisions", safeRevision);

  try {
    await readFile(join(dir, "draft.gov.json"), "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Revision "${safeRevision}" does not exist`);
    }
    throw error;
  }

  await rm(dir, { recursive: true, force: true });
}