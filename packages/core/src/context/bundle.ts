import { z } from "zod";
import {
  PlanningDependencyRefSchema,
  SafeGovernanceIdSchema,
  type PlanningDependencyRef,
  type SafeGovernanceId,
} from "../governance/contracts.js";
import {
  createVersionStore,
  type FoundationPublishedSnapshot,
} from "../governance/versions.js";
import {
  readCurrentCanonRevision,
} from "../governance/conflicts.js";
import {
  loadAuthorization,
  loadHumanDirection,
} from "../governance/authorizations.js";
import {
  loadDetailedPlan,
} from "../planning/detailed-plan.js";
import {
  loadArcPlanDraft,
  type ArcPlanSnapshot,
} from "../planning/arc-plan.js";

// ===========================================================================
// Phase 5 Task 17 — Context Bundle & Structured Provenance
//
// Structured Provenance replaces weak strings.
// Every section carries:
// - sourceType (from approved vocabulary)
// - sourceId
// - sourceRevision?
// - priority (0 = mandatory authority spine, 1..4 = compressible/trimmable)
// - selectionReason
// - representation (full | projected | summary | excerpt)
// - authoritative (boolean)
// ===========================================================================

export type ContextProfile = "planner_context" | "writer_context" | "reviewer_context";
export type ContextPriority = 0 | 1 | 2 | 3 | 4;
export type ContextRepresentation = "full" | "projected" | "summary" | "excerpt";

export const ContextSourceTypeSchema = z.enum([
  "foundation_unit",
  "arc_plan",
  "canon",
  "human_direction",
  "authorization",
  "book_rule",
  "hook",
  "relationship",
  "timeline",
  "character_state",
  "chapter_summary",
  "style_example",
  "semantic_memory",
]);

export type ContextSourceType = z.infer<typeof ContextSourceTypeSchema>;

export interface ContextSourceProvenance {
  readonly sourceType: ContextSourceType;
  readonly sourceId: string;
  readonly sourceRevision?: number | string;
  readonly priority: ContextPriority;
  readonly selectionReason: string;
  readonly representation: ContextRepresentation;
  readonly authoritative: boolean;
}

export interface BudgetOmission {
  readonly sourceId: string;
  readonly priority: ContextPriority;
  readonly reason: string; // e.g. "soft_trim" | "semantic_compression_unavailable" | "mandatory_fit_failure"
}

export type ContextSubject =
  | { readonly kind: "detailed_plan"; readonly planId: SafeGovernanceId; readonly planHash: string }
  | { readonly kind: "arc_draft"; readonly draftId: SafeGovernanceId; readonly draftHash: string }
  | { readonly kind: "review"; readonly chapterNumber: number };

export interface ContextSection extends ContextSourceProvenance {
  readonly content: string;
}

export interface ContextBundle {
  readonly bundleId: string;
  readonly profile: ContextProfile;
  readonly task: string;
  readonly subject: ContextSubject;
  readonly foundationVersion: number;
  readonly arcPlanVersion: number;
  readonly canonRevision: number;
  readonly dependencyRefs: ReadonlyArray<PlanningDependencyRef>;
  readonly sections: ReadonlyArray<ContextSection>;
  readonly budget: {
    readonly contextLimit: number;
    readonly reservedOutput: number;
    readonly estimatedInput: number;
  };
  readonly tokenEstimates: Record<string, number>;
  readonly compactions: ReadonlyArray<string>;
  readonly omittedDueToBudget: ReadonlyArray<BudgetOmission>;
}

export async function isBundleStale(
  bookDir: string,
  bundle: ContextBundle,
): Promise<boolean> {
  // 1. Validate subject identity
  if (bundle.subject.kind === "detailed_plan") {
    const plan = await loadDetailedPlan(bookDir, bundle.subject.planId);
    if (!plan || plan.planHash !== bundle.subject.planHash) {
      return true;
    }
  } else if (bundle.subject.kind === "arc_draft") {
    const draft = await loadArcPlanDraft(bookDir, bundle.subject.draftId);
    if (!draft || draft.draftHash !== bundle.subject.draftHash) {
      return true;
    }
  }

  // 2. Validate Foundation version
  const store = createVersionStore(bookDir);
  const currentFound = await store.readCurrentVersion<FoundationPublishedSnapshot>("foundation", "foundation").catch(() => null);
  const currentFoundVer = currentFound ? currentFound.version : 0;
  if (currentFoundVer !== bundle.foundationVersion) {
    return true;
  }

  // 3. Validate Arc Plan version
  const currentArc = await store.readCurrentVersion<ArcPlanSnapshot>("arc_plan", "arc-1").catch(() => null);
  const currentArcVer = currentArc ? currentArc.version : 0;
  if (currentArcVer !== bundle.arcPlanVersion) {
    return true;
  }

  // 4. Validate Canon revision
  const currentCanonRev = await readCurrentCanonRevision(bookDir).catch(() => 0);
  if (currentCanonRev !== bundle.canonRevision) {
    return true;
  }

  // 5. Validate typed dependency refs
  for (const dep of bundle.dependencyRefs) {
    if (dep.kind === "human_direction") {
      const dir = await loadHumanDirection(bookDir, dep.directionId);
      if (!dir || dir.lifecycle !== "active" || dir.lifecycleRevision !== dep.lifecycleRevision) {
        return true;
      }
    } else if (dep.kind === "authorization") {
      const auth = await loadAuthorization(bookDir, dep.authorizationId);
      if (!auth || auth.lifecycle !== "active" || auth.lifecycleRevision !== dep.lifecycleRevision) {
        return true;
      }
    } else if (dep.kind === "foundation_unit") {
      if (dep.foundationVersion !== currentFoundVer) {
        return true;
      }
    }
  }

  return false;
}
