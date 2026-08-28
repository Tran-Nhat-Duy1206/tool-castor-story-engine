import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type ContextBundle,
  type ContextProfile,
  type ContextSection,
  type ContextSubject,
} from "./bundle.js";
import {
  applyBudgetPolicy,
  estimateTokens,
} from "./budget.js";
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
// Phase 5 Task 17 — Context Composer
//
// Assembles structured production context:
// - P0 authority spine (hard Canon, Book Rules, active Directions,
//   active Authorizations, Foundation invariants, Arc plan)
// - Subject identity binding (proves exact persisted plan/draft)
// - Strict False Memory & Draft Leakage exclusion:
//   - rejected/failed/aborted Writer attempts are excluded
//   - unpublished Foundation / Arc drafts are excluded from production writer context
// - Budget governance: output reserved first, zero LLM calls on budget overflow
// ===========================================================================

export interface ComposeContextRequest {
  readonly bookDir: string;
  readonly profile: ContextProfile;
  readonly subject: ContextSubject;
  readonly contextLimit?: number;
  readonly reservedOutput?: number;
  readonly customSections?: ReadonlyArray<ContextSection>;
}

export async function composeContext(
  request: ComposeContextRequest,
): Promise<ContextBundle> {
  const { bookDir, profile, subject } = request;
  const contextLimit = request.contextLimit ?? 8000;
  const reservedOutput = request.reservedOutput ?? 2000;

  // 1. Load trusted Foundation, Arc, and Canon versions
  const store = createVersionStore(bookDir);
  const currentFound = await store.readCurrentVersion<FoundationPublishedSnapshot>("foundation", "foundation").catch(() => null);
  const foundationVersion = currentFound ? currentFound.version : 0;

  const currentArc = await store.readCurrentVersion<ArcPlanSnapshot>("arc_plan", "arc-1").catch(() => null);
  const arcPlanVersion = currentArc ? currentArc.version : 0;

  const canonRevision = await readCurrentCanonRevision(bookDir).catch(() => 0);

  const sections: ContextSection[] = [];
  const dependencyRefs = [];

  // 2. Load Hard Canon & Book Rules (P0)
  try {
    const rawManifest = await readFile(join(bookDir, "story", "state", "manifest.json"), "utf-8");
    sections.push({
      sourceType: "canon",
      sourceId: "canon-manifest",
      sourceRevision: canonRevision,
      priority: 0,
      selectionReason: "Mandatory Canon Manifest",
      representation: "full",
      authoritative: true,
      content: rawManifest,
    });
  } catch {
    // Ignore if not found
  }

  try {
    const rawBook = await readFile(join(bookDir, "book.json"), "utf-8");
    sections.push({
      sourceType: "book_rule",
      sourceId: "book-config-rules",
      priority: 0,
      selectionReason: "Mandatory Book Rules",
      representation: "full",
      authoritative: true,
      content: rawBook,
    });
  } catch {
    // Ignore if not found
  }

  // 3. Load exact Subject
  if (subject.kind === "detailed_plan") {
    const plan = await loadDetailedPlan(bookDir, subject.planId);
    if (!plan) {
      throw new Error(`Cannot compose context for detailed plan "${subject.planId}": plan not found`);
    }
    if (plan.planHash !== subject.planHash) {
      throw new Error(`Cannot compose context for detailed plan "${subject.planId}": planHash mismatch`);
    }

    // Include plan dependency refs
    dependencyRefs.push(...plan.bindings.dependencyRefs);

    // Add active human directions (P0)
    for (const dirId of plan.bindings.humanDirectionIds) {
      const dir = await loadHumanDirection(bookDir, dirId);
      if (dir && dir.lifecycle === "active") {
        sections.push({
          sourceType: "human_direction",
          sourceId: dir.directionId,
          sourceRevision: dir.lifecycleRevision,
          priority: 0,
          selectionReason: "Active Human Direction",
          representation: "full",
          authoritative: true,
          content: dir.text,
        });
      }
    }

    // Add active authorizations (P0)
    for (const authId of plan.bindings.authorizationIds) {
      const auth = await loadAuthorization(bookDir, authId);
      if (auth && auth.lifecycle === "active") {
        sections.push({
          sourceType: "authorization",
          sourceId: auth.authorizationId,
          sourceRevision: auth.lifecycleRevision,
          priority: 0,
          selectionReason: "Active Scoped Authorization",
          representation: "full",
          authoritative: true,
          content: `Authorized decision: ${auth.decisionKind} for scope ${JSON.stringify(auth.scope)}`,
        });
      }
    }

    // Plan memo and intent
    sections.push({
      sourceType: "canon",
      sourceId: "plan-intent",
      priority: 0,
      selectionReason: "Detailed Plan Intent",
      representation: "full",
      authoritative: true,
      content: JSON.stringify(plan.intent),
    });
    sections.push({
      sourceType: "canon",
      sourceId: "plan-memo",
      priority: 0,
      selectionReason: "Detailed Plan Memo",
      representation: "full",
      authoritative: true,
      content: plan.memo.body,
    });
  } else if (subject.kind === "arc_draft") {
    const draft = await loadArcPlanDraft(bookDir, subject.draftId);
    if (!draft) {
      throw new Error(`Cannot compose context for arc draft "${subject.draftId}": draft not found`);
    }
    if (draft.draftHash !== subject.draftHash) {
      throw new Error(`Cannot compose context for arc draft "${subject.draftId}": draftHash mismatch`);
    }
    sections.push({
      sourceType: "arc_plan",
      sourceId: draft.draftId,
      priority: 0,
      selectionReason: "Arc Plan Draft",
      representation: "full",
      authoritative: true,
      content: JSON.stringify(draft.snapshot),
    });
  }

  // 4. Filter and include custom sections (False Memory & Draft exclusion)
  if (request.customSections) {
    for (const sec of request.customSections) {
      const lowerId = sec.sourceId.toLowerCase();
      const lowerReason = sec.selectionReason.toLowerCase();
      // Exclude false memories (rejected/aborted/failed attempts)
      if (
        lowerId.includes("rejected") ||
        lowerId.includes("aborted") ||
        lowerId.includes("failed") ||
        lowerReason.includes("rejected") ||
        lowerReason.includes("aborted") ||
        lowerReason.includes("failed")
      ) {
        continue;
      }
      // Exclude unpublished drafts from production writer context
      if (profile === "writer_context") {
        if (
          (sec.sourceType === "foundation_unit" || sec.sourceType === "arc_plan") &&
          !sec.authoritative
        ) {
          continue;
        }
      }
      sections.push(sec);
    }
  }

  // 5. Initial token estimation
  const tokenEstimates: Record<string, number> = {};
  let totalInput = 0;
  for (const s of sections) {
    const tokens = estimateTokens(s.content);
    tokenEstimates[s.sourceId] = tokens;
    totalInput += tokens;
  }

  const initialBundle: ContextBundle = {
    bundleId: `bundle-${randomUUID()}`,
    profile,
    task: profile === "writer_context" ? "chapter_prose" : "planning_review",
    subject,
    foundationVersion,
    arcPlanVersion,
    canonRevision,
    dependencyRefs,
    sections,
    budget: {
      contextLimit,
      reservedOutput,
      estimatedInput: totalInput,
    },
    tokenEstimates,
    compactions: [],
    omittedDueToBudget: [],
  };

  // 6. Apply Budget Policy
  const budgetResult = await applyBudgetPolicy(initialBundle);
  if (budgetResult.status === "context_budget_exceeded") {
    throw new Error("CONTEXT_BUDGET_EXCEEDED: mandatory context exceeds available budget");
  }

  return budgetResult.bundle;
}
