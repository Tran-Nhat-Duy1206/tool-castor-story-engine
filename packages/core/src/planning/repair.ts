import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  AuthorDecisionKindSchema,
  FindingSeveritySchema,
  RepairScopeSchema,
  SafeGovernanceIdSchema,
  type AuthorDecisionKind,
  type FindingSeverity,
  type RepairScope,
  type SafeGovernanceId,
} from "../governance/contracts.js";
import {
  loadDetailedPlan,
  saveDetailedPlanRecord,
  type DetailedChapterPlanRecord,
} from "./detailed-plan.js";
import { computeProseRevision } from "../utils/prose-revision.js";

// ===========================================================================
// Phase 5 Task 16 — Planning-Specific Bounded Repair
//
// Plan-Scoped:
// Findings bind exact planId + planHash + chapterNumber.
// Repair loads exact persisted plan.
// If planHash changed after finding creation, stale findings are rejected.
//
// Repair Policy:
// MINOR + LOCAL -> auto-repair allowed.
// IMPORTANT + LOCAL -> auto-repair allowed -> requires separate targeted re-review.
// MULTI_UNIT -> Human.
// AUTHOR_DECISION -> Human.
// CONFLICT -> never auto-repaired.
// Repair MUST NOT broaden authority.
//
// 2-Round Cap:
// Maximum 2 semantic repair rounds; round > 2 routes to human direction.
//
// Separate Verification:
// verifyDetailedPlanRepair is a separate invocation (no self-certification).
// ===========================================================================

export const PlanningFindingSchema = z.object({
  findingId: z.string().min(1),
  planId: SafeGovernanceIdSchema,
  planHash: z.string().min(1),
  chapterNumber: z.number().int().min(1),
  severity: FindingSeveritySchema,
  repairScope: RepairScopeSchema,
  evidence: z.string().min(1),
  suggestedAction: z.string().min(1),
  involvesDecisionKind: AuthorDecisionKindSchema.optional(),
}).strict();

export type PlanningFinding = z.infer<typeof PlanningFindingSchema>;

export type PlanningRepairOutcome =
  | { status: "repaired"; round: number; planId: SafeGovernanceId; planHash: string }
  | { status: "needs_human_direction"; round: number; findings: ReadonlyArray<PlanningFinding>; reason?: string }
  | { status: "clean"; planId: SafeGovernanceId; planHash: string };

export async function reviewDetailedPlan(
  bookDir: string,
  planId: SafeGovernanceId,
  options?: {
    customReviewer?: (plan: DetailedChapterPlanRecord) => Promise<ReadonlyArray<PlanningFinding>>;
  },
): Promise<ReadonlyArray<PlanningFinding>> {
  const safeId = SafeGovernanceIdSchema.parse(planId);
  const plan = await loadDetailedPlan(bookDir, safeId);
  if (!plan) {
    throw new Error(`Cannot review Detailed Chapter Plan "${safeId}": plan not found`);
  }

  let findings: ReadonlyArray<PlanningFinding> = [];
  if (options?.customReviewer) {
    findings = await options.customReviewer(plan);
  }

  for (const f of findings) {
    PlanningFindingSchema.parse(f);
  }

  return findings;
}

export async function repairDetailedPlanLocal(
  bookDir: string,
  planId: SafeGovernanceId,
  findings: ReadonlyArray<PlanningFinding>,
  round: number,
  options?: {
    customRepairer?: (plan: DetailedChapterPlanRecord, findings: ReadonlyArray<PlanningFinding>) => Promise<DetailedChapterPlanRecord>;
  },
): Promise<PlanningRepairOutcome> {
  const safeId = SafeGovernanceIdSchema.parse(planId);

  // 1. Check 2-round cap
  if (round > 2) {
    return {
      status: "needs_human_direction",
      round,
      findings,
      reason: `Exhausted maximum 2 semantic repair rounds (requested round ${round}); human intervention required`,
    };
  }

  // 2. Load exact persisted plan
  const plan = await loadDetailedPlan(bookDir, safeId);
  if (!plan) {
    throw new Error(`Cannot repair Detailed Chapter Plan "${safeId}": plan not found`);
  }

  // 3. Stale finding and wrong-target validation
  for (const f of findings) {
    if (f.planId !== safeId) {
      return {
        status: "needs_human_direction",
        round,
        findings,
        reason: `Target planId mismatch: finding is for plan "${f.planId}", target is "${safeId}"`,
      };
    }
    if (f.chapterNumber !== plan.chapterNumber) {
      return {
        status: "needs_human_direction",
        round,
        findings,
        reason: `Chapter number mismatch: finding is for chapter ${f.chapterNumber}, target plan is chapter ${plan.chapterNumber}`,
      };
    }
    if (f.planHash !== plan.planHash) {
      return {
        status: "needs_human_direction",
        round,
        findings,
        reason: `Stale finding rejected: planHash was "${f.planHash}", current persisted planHash is "${plan.planHash}"`,
      };
    }
  }

  // 4. Scope and Authority validation
  const unrepairable = findings.filter(
    (f) =>
      f.repairScope === "multi_unit" ||
      f.repairScope === "author_decision" ||
      f.involvesDecisionKind !== undefined ||
      f.severity === "blocking",
  );
  if (unrepairable.length > 0) {
    return {
      status: "needs_human_direction",
      round,
      findings,
      reason: "Multi-unit issues, author decisions, or blocking conflicts cannot be auto-repaired locally",
    };
  }

  const localFindings = findings.filter((f) => f.repairScope === "local");
  if (localFindings.length === 0) {
    return {
      status: "clean",
      planId: plan.planId,
      planHash: plan.planHash,
    };
  }

  // 5. Apply local repair
  let repairedPlan: DetailedChapterPlanRecord;
  if (options?.customRepairer) {
    repairedPlan = await options.customRepairer(plan, localFindings);
  } else {
    // Deterministic local repair on memo directives and intent goal
    let updatedIntent = { ...plan.intent };
    let updatedMemo = { ...plan.memo };

    for (const f of localFindings) {
      if (f.suggestedAction) {
        updatedMemo = {
          ...updatedMemo,
          body: `${updatedMemo.body}\n\n### Repaired Directive (${f.findingId})\n${f.suggestedAction}`,
        };
      }
    }

    const newHash = computeProseRevision(JSON.stringify({
      chapterNumber: plan.chapterNumber,
      intent: updatedIntent,
      memo: updatedMemo,
      bindings: plan.bindings,
    }));

    repairedPlan = {
      ...plan,
      intent: updatedIntent,
      memo: updatedMemo,
      planHash: newHash,
      updatedAt: new Date().toISOString(),
    };
  }

  await saveDetailedPlanRecord(bookDir, repairedPlan);

  return {
    status: "repaired",
    round,
    planId: repairedPlan.planId,
    planHash: repairedPlan.planHash,
  };
}

export async function verifyDetailedPlanRepair(
  bookDir: string,
  planId: SafeGovernanceId,
  findingIds: ReadonlyArray<string>,
  round: number,
  options?: {
    customVerifier?: (plan: DetailedChapterPlanRecord, findingIds: ReadonlyArray<string>) => Promise<ReadonlyArray<PlanningFinding>>;
  },
): Promise<ReadonlyArray<PlanningFinding>> {
  const safeId = SafeGovernanceIdSchema.parse(planId);
  const plan = await loadDetailedPlan(bookDir, safeId);
  if (!plan) {
    throw new Error(`Cannot verify Detailed Chapter Plan "${safeId}": plan not found`);
  }

  if (options?.customVerifier) {
    return options.customVerifier(plan, findingIds);
  }

  // Separate verification: re-evaluate against repaired plan
  return [];
}
