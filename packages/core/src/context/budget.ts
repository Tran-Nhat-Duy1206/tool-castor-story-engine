import {
  type BudgetOmission,
  type ContextBundle,
  type ContextSection,
} from "./bundle.js";

// ===========================================================================
// Phase 5 Task 17 — Context Budget Governance
//
// Rules:
// 1. Reserve output tokens before allocating input budget.
// 2. Authority before relevance: P0 mandatory authority spine is never omitted
//    and never semantically compressed.
// 3. Compression Allowlist: Semantic compression is forbidden for hard Canon
//    facts, Book Rules, Human Directions, Authorization scopes, and
//    Foundation invariants.
// 4. Budget order:
//    - deterministic projection
//    - trim soft context (P4 -> P1)
//    - semantic compression for allowlisted soft sources
//    - context_budget_exceeded
// 5. Zero LLM calls on budget failure; no automatic model/provider switch.
// ===========================================================================

export type BudgetResult =
  | { readonly status: "ok"; readonly bundle: ContextBundle }
  | { readonly status: "context_budget_exceeded" };

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

const FORBIDDEN_COMPRESSION_SOURCE_TYPES = new Set([
  "canon",
  "book_rule",
  "human_direction",
  "authorization",
  "foundation_unit",
  "arc_plan",
]);

export async function applyBudgetPolicy(
  bundle: ContextBundle,
): Promise<BudgetResult> {
  const availableInput = bundle.budget.contextLimit - bundle.budget.reservedOutput;
  if (availableInput <= 0) {
    return { status: "context_budget_exceeded" };
  }

  let currentSections = [...bundle.sections];
  const omitted: BudgetOmission[] = [...bundle.omittedDueToBudget];
  const compactions: string[] = [...bundle.compactions];

  const calculateTotal = (sections: ContextSection[]) => {
    let sum = 0;
    for (const s of sections) {
      sum += estimateTokens(s.content);
    }
    return sum;
  };

  let total = calculateTotal(currentSections);
  if (total <= availableInput) {
    const tokenEstimates: Record<string, number> = {};
    for (const s of currentSections) {
      tokenEstimates[s.sourceId] = estimateTokens(s.content);
    }
    return {
      status: "ok",
      bundle: {
        ...bundle,
        sections: currentSections,
        budget: { ...bundle.budget, estimatedInput: total },
        tokenEstimates,
        compactions,
        omittedDueToBudget: omitted,
      },
    };
  }

  // 1. Trim soft/redundant context (Priority 4 down to 1)
  for (let p = 4; p >= 1; p--) {
    const toRemoveIndices: number[] = [];
    for (let i = currentSections.length - 1; i >= 0; i--) {
      const sec = currentSections[i];
      if (sec.priority === p && !sec.authoritative) {
        toRemoveIndices.push(i);
        omitted.push({
          sourceId: sec.sourceId,
          priority: sec.priority,
          reason: "soft_trim",
        });
      }
    }

    currentSections = currentSections.filter((_, idx) => !toRemoveIndices.includes(idx));
    total = calculateTotal(currentSections);
    if (total <= availableInput) {
      const tokenEstimates: Record<string, number> = {};
      for (const s of currentSections) {
        tokenEstimates[s.sourceId] = estimateTokens(s.content);
      }
      return {
        status: "ok",
        bundle: {
          ...bundle,
          sections: currentSections,
          budget: { ...bundle.budget, estimatedInput: total },
          tokenEstimates,
          compactions,
          omittedDueToBudget: omitted,
        },
      };
    }
  }

  // 2. Semantic compression for allowlisted soft sources
  const allowlistedCompressionSources = new Set([
    "style_example",
    "semantic_memory",
    "chapter_summary",
  ]);

  currentSections = currentSections.map((sec) => {
    if (
      sec.priority >= 1 &&
      allowlistedCompressionSources.has(sec.sourceType) &&
      !FORBIDDEN_COMPRESSION_SOURCE_TYPES.has(sec.sourceType)
    ) {
      compactions.push(sec.sourceId);
      const halfLen = Math.floor(sec.content.length / 2);
      return {
        ...sec,
        representation: "summary" as const,
        content: `${sec.content.slice(0, halfLen)}... [summarized]`,
      };
    }
    return sec;
  });

  total = calculateTotal(currentSections);
  if (total <= availableInput) {
    const tokenEstimates: Record<string, number> = {};
    for (const s of currentSections) {
      tokenEstimates[s.sourceId] = estimateTokens(s.content);
    }
    return {
      status: "ok",
      bundle: {
        ...bundle,
        sections: currentSections,
        budget: { ...bundle.budget, estimatedInput: total },
        tokenEstimates,
        compactions,
        omittedDueToBudget: omitted,
      },
    };
  }

  // 3. Mandatory P0 failure
  omitted.push({
    sourceId: "mandatory_authority_spine",
    priority: 0,
    reason: "mandatory_fit_failure",
  });

  return { status: "context_budget_exceeded" };
}
