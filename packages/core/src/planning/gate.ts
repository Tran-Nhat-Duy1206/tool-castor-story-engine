import { z } from "zod";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AuthorDecisionKindSchema,
  SafeGovernanceIdSchema,
  type AuthorDecisionKind,
  type SafeGovernanceId,
} from "../governance/contracts.js";
import {
  loadDetailedPlan,
  type DetailedChapterPlanRecord,
} from "./detailed-plan.js";
import {
  createVersionStore,
  type FoundationPublishedSnapshot,
} from "../governance/versions.js";
import {
  readCurrentCanonRevision,
} from "../governance/conflicts.js";
import {
  authorizationApplies,
  directionApplies,
  loadAuthorization,
  loadHumanDirection,
  type ActiveAuthorization,
  type ActiveHumanDirection,
  type AuthorizationEvaluationContext,
} from "../governance/authorizations.js";
import { type ArcPlanSnapshot } from "./arc-plan.js";
import { computeProseRevision } from "../utils/prose-revision.js";

// ===========================================================================
// Phase 5 Task 16 — Planning Gate
//
// Trusted Gate API:
// The public caller supplies ONLY `bookDir` and `planId`.
// Core loads all trusted authority state itself — a forged in-memory plan
// or fake authorization array cannot influence the Gate.
//
// 5-Row Truth Table:
// 1. deterministic clean + semantic clean + sufficient authority -> SAFE
// 2. deterministic clean + semantic uncertain -> UNCERTAIN
// 3. deterministic clean + new major decision + missing authority -> AUTHOR_DECISION
// 4. hard deterministic violation -> CONFLICT
// 5. major decision already authorized in correct active scope -> SAFE (no re-ask)
//
// Invariants:
// - ONLY deterministic checks may produce CONFLICT.
// - Semantic reviewer MUST NEVER emit CONFLICT (enforced at runtime).
// - SAFE != Writer invocation (Task 16 never calls Writer).
// - Gate evaluation NEVER consumes Authorizations.
// ===========================================================================

export const PlanningGateInputSchema = z.object({
  bookDir: z.string().min(1),
  planId: SafeGovernanceIdSchema,
}).strict();

export type PlanningGateInput = z.infer<typeof PlanningGateInputSchema>;

export type PlanningGateResult =
  | { outcome: "safe" }
  | { outcome: "uncertain"; concerns: ReadonlyArray<string> }
  | { outcome: "author_decision"; missing: ReadonlyArray<AuthorDecisionKind> }
  | { outcome: "conflict"; evidence: ReadonlyArray<string> };

export interface PlanningGateOptions {
  readonly currentArcId?: string;
  readonly semanticEvaluator?: (plan: DetailedChapterPlanRecord) => Promise<{
    readonly uncertainConcerns?: ReadonlyArray<string>;
    readonly authorDecisions?: ReadonlyArray<AuthorDecisionKind>;
    readonly conflict?: never;
  }>;
}

export async function evaluatePlanningGate(
  input: PlanningGateInput,
  options?: PlanningGateOptions,
): Promise<PlanningGateResult> {
  const { bookDir, planId } = PlanningGateInputSchema.parse(input);
  const currentArcId = options?.currentArcId ?? "arc-1";

  // 1. Load exact persisted DetailedChapterPlanRecord
  const plan = await loadDetailedPlan(bookDir, planId);
  if (!plan) {
    return {
      outcome: "conflict",
      evidence: [`Detailed Chapter Plan "${planId}" not found in persisted governance store`],
    };
  }

  // 2. Validate exact planHash against persisted content
  const expectedHash = computeProseRevision(JSON.stringify({
    chapterNumber: plan.chapterNumber,
    intent: plan.intent,
    memo: plan.memo,
    bindings: plan.bindings,
  }));
  if (plan.planHash !== expectedHash) {
    return {
      outcome: "conflict",
      evidence: [`Plan hash mismatch: record has ${plan.planHash}, computed ${expectedHash}`],
    };
  }

  const deterministicEvidence: string[] = [];

  // 3. Foundation version validation
  const store = createVersionStore(bookDir);
  const currentFound = await store.readCurrentVersion<FoundationPublishedSnapshot>("foundation", "foundation").catch(() => null);
  const currentFoundVer = currentFound ? currentFound.version : 0;
  if (currentFoundVer !== plan.bindings.foundationVersion) {
    deterministicEvidence.push(
      `Foundation version mismatch: plan was generated against Foundation v${plan.bindings.foundationVersion}, but current published Foundation is v${currentFoundVer}`,
    );
  }

  // 4. Arc Plan version validation
  const currentArc = await store.readCurrentVersion<ArcPlanSnapshot>("arc_plan", currentArcId).catch(() => null);
  const currentArcVer = currentArc ? currentArc.version : 0;
  if (currentArcVer !== plan.bindings.arcPlanVersion) {
    deterministicEvidence.push(
      `Arc Plan version mismatch: plan was generated against Arc Plan v${plan.bindings.arcPlanVersion}, but current published Arc Plan is v${currentArcVer}`,
    );
  }

  // 5. Canon revision validation
  const currentCanonRev = await readCurrentCanonRevision(bookDir).catch(() => 0);
  if (currentCanonRev !== plan.bindings.canonRevision) {
    deterministicEvidence.push(
      `Canon revision mismatch: plan was generated against Canon revision ${plan.bindings.canonRevision}, but current Canon revision is ${currentCanonRev}`,
    );
  }

  // 6. Chapter sequence validation
  let lastAppliedChapter = 0;
  try {
    const rawManifest = await readFile(join(bookDir, "story", "state", "manifest.json"), "utf-8");
    const manifest = JSON.parse(rawManifest);
    if (typeof manifest.lastAppliedChapter === "number") {
      lastAppliedChapter = manifest.lastAppliedChapter;
    }
  } catch {
    // Ignore manifest read error
  }

  if (lastAppliedChapter > 0 && plan.chapterNumber > lastAppliedChapter + 1) {
    deterministicEvidence.push(
      `Chapter sequence violation: current last applied chapter is ${lastAppliedChapter}, but plan is for chapter ${plan.chapterNumber}`,
    );
  }

  const evalContext: AuthorizationEvaluationContext = {
    chapterNumber: plan.chapterNumber,
    currentArcId,
    canonRevision: currentCanonRev,
    hookStates: () => ({ lifecycleState: "active", lifecycleRevision: "1" }),
    relationshipStates: () => ({ state: "active", stateRevision: "1" }),
    factResolver: () => ({ exists: true, canonRevision: currentCanonRev }),
    arcState: () => ({ status: "started", revision: "1" }),
  };

  // 7. Human Direction validation
  for (const dirId of plan.bindings.humanDirectionIds) {
    const dir = await loadHumanDirection(bookDir, dirId);
    if (!dir) {
      deterministicEvidence.push(`Bound Human Direction "${dirId}" not found in governance store`);
      continue;
    }
    if (dir.lifecycle !== "active") {
      deterministicEvidence.push(`Bound Human Direction "${dirId}" is not active (lifecycle: ${dir.lifecycle})`);
      continue;
    }
    const applies = directionApplies(dir as any, evalContext);
    if (!applies) {
      deterministicEvidence.push(`Bound Human Direction "${dirId}" does not apply to chapter ${plan.chapterNumber}`);
    }
  }

  // 8. Authorization validity and scope validation
  const loadedActiveAuthorizations: Record<string, AuthorDecisionKind> = {};
  for (const authId of plan.bindings.authorizationIds) {
    const auth = await loadAuthorization(bookDir, authId);
    if (!auth) {
      deterministicEvidence.push(`Bound Authorization "${authId}" not found in governance store`);
      continue;
    }
    if (auth.lifecycle !== "active") {
      deterministicEvidence.push(`Bound Authorization "${authId}" is not active (lifecycle: ${auth.lifecycle})`);
      continue;
    }
    const applies = authorizationApplies(auth as any, evalContext);
    if (!applies) {
      deterministicEvidence.push(`Bound Authorization "${authId}" does not apply to chapter ${plan.chapterNumber}`);
      continue;
    }
    loadedActiveAuthorizations[auth.decisionKind] = auth.decisionKind;
  }

  // 9. Typed dependency observed-state validation
  for (const dep of plan.bindings.dependencyRefs) {
    if (dep.kind === "human_direction") {
      const dir = await loadHumanDirection(bookDir, dep.directionId);
      if (!dir || dir.lifecycle !== "active" || dir.lifecycleRevision !== dep.lifecycleRevision) {
        deterministicEvidence.push(`Direct dependency Human Direction "${dep.directionId}" observed state changed or is inactive`);
      }
    } else if (dep.kind === "authorization") {
      const auth = await loadAuthorization(bookDir, dep.authorizationId);
      if (!auth || auth.lifecycle !== "active" || auth.lifecycleRevision !== dep.lifecycleRevision) {
        deterministicEvidence.push(`Direct dependency Authorization "${dep.authorizationId}" observed state changed or is inactive`);
      }
    } else if (dep.kind === "foundation_unit") {
      if (dep.foundationVersion !== currentFoundVer) {
        deterministicEvidence.push(`Direct dependency Foundation unit "${dep.unitId}" foundation version mismatch`);
      }
    }
  }

  // If deterministic violations exist, return CONFLICT immediately
  if (deterministicEvidence.length > 0) {
    return {
      outcome: "conflict",
      evidence: deterministicEvidence,
    };
  }

  // 10. Semantic Layer and Author Decisions
  let semanticConcerns: string[] = [];
  let detectedDecisions: AuthorDecisionKind[] = [];

  if (options?.semanticEvaluator) {
    const semRes = await options.semanticEvaluator(plan);
    // Runtime enforcement: semantic reviewer must never emit conflict
    if ("conflict" in (semRes as any) && (semRes as any).conflict) {
      throw new Error("Semantic evaluator invariant violated: semantic review must NEVER emit kind: conflict.");
    }
    if (semRes.uncertainConcerns) {
      semanticConcerns = [...semRes.uncertainConcerns];
    }
    if (semRes.authorDecisions) {
      detectedDecisions = [...semRes.authorDecisions];
    }
  }

  // Check if detected major decisions are authorized in correct active scope
  const missingDecisions: AuthorDecisionKind[] = [];
  for (const dec of detectedDecisions) {
    if (!loadedActiveAuthorizations[dec]) {
      missingDecisions.push(dec);
    }
  }

  if (missingDecisions.length > 0) {
    return {
      outcome: "author_decision",
      missing: missingDecisions,
    };
  }

  if (semanticConcerns.length > 0) {
    return {
      outcome: "uncertain",
      concerns: semanticConcerns,
    };
  }

  return { outcome: "safe" };
}
