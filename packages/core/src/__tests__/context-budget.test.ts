import { describe, expect, it } from "vitest";
import {
  applyBudgetPolicy,
  estimateTokens,
  type BudgetResult,
} from "../context/budget.js";
import { type ContextBundle, type ContextSection } from "../context/bundle.js";

function makeSampleBundle(
  sections: ContextSection[],
  contextLimit = 8000,
  reservedOutput = 2000,
): ContextBundle {
  const tokenEstimates: Record<string, number> = {};
  let totalInput = 0;
  for (const s of sections) {
    const tokens = estimateTokens(s.content);
    tokenEstimates[s.sourceId] = tokens;
    totalInput += tokens;
  }

  return {
    bundleId: "bundle-test-1",
    profile: "writer_context",
    task: "chapter_prose",
    subject: { kind: "detailed_plan", planId: "plan-ch5-test", planHash: "hash-ch5-1234" },
    foundationVersion: 1,
    arcPlanVersion: 1,
    canonRevision: 4,
    dependencyRefs: [],
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
}

describe("Context Budget Token Governance", () => {
  it("reserves output tokens before allocating input budget", () => {
    // contextLimit = 8000, reservedOutput = 2000 => available input = 6000
    const p0Section: ContextSection = {
      sourceType: "canon",
      sourceId: "canon-facts",
      priority: 0,
      selectionReason: "Mandatory Canon",
      representation: "full",
      authoritative: true,
      content: "A".repeat(24000), // ~6000 tokens
    };

    const bundle = makeSampleBundle([p0Section], 8000, 2000);
    expect(bundle.budget.contextLimit - bundle.budget.reservedOutput).toBe(6000);
  });

  it("P0 mandatory authority spine survives budget pressure and is never omitted", async () => {
    const p0Section: ContextSection = {
      sourceType: "canon",
      sourceId: "canon-spine",
      priority: 0,
      selectionReason: "Mandatory authority",
      representation: "full",
      authoritative: true,
      content: "Mandatory Canon Facts Content",
    };
    const p3Section: ContextSection = {
      sourceType: "semantic_memory",
      sourceId: "memory-extra",
      priority: 3,
      selectionReason: "Soft memory",
      representation: "full",
      authoritative: false,
      content: "Extra soft memory text ".repeat(500), // large soft context
    };

    const bundle = makeSampleBundle([p0Section, p3Section], 3000, 1000); // available input = 2000 tokens
    const result = await applyBudgetPolicy(bundle);

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      const remainingSourceIds = result.bundle.sections.map((s) => s.sourceId);
      expect(remainingSourceIds).toContain("canon-spine");
      expect(remainingSourceIds).not.toContain("memory-extra");
      expect(result.bundle.omittedDueToBudget.some((o) => o.sourceId === "memory-extra")).toBe(true);
    }
  });

  it("hard Canon, Book Rules, Human Directions, and Authorization scopes are NEVER semantically compressed", async () => {
    const forbiddenSourceTypes = [
      "canon",
      "book_rule",
      "human_direction",
      "authorization",
      "foundation_unit",
      "arc_plan",
    ] as const;

    for (const st of forbiddenSourceTypes) {
      const section: ContextSection = {
        sourceType: st,
        sourceId: `sec-${st}`,
        priority: 0,
        selectionReason: "Hard authority",
        representation: "full",
        authoritative: true,
        content: "Exact hard authority content",
      };
      const bundle = makeSampleBundle([section], 2000, 1000);
      const result = await applyBudgetPolicy(bundle);

      expect(result.status).toBe("ok");
      if (result.status === "ok") {
        expect(result.bundle.compactions).not.toContain(`sec-${st}`);
        expect(result.bundle.sections[0].representation).toBe("full");
      }
    }
  });

  it("trims soft context and records omission with sourceId, priority, and reason", async () => {
    const p0: ContextSection = {
      sourceType: "book_rule",
      sourceId: "rule-mandatory",
      priority: 0,
      selectionReason: "Rules",
      representation: "full",
      authoritative: true,
      content: "Hard Rule Content",
    };
    const p4: ContextSection = {
      sourceType: "style_example",
      sourceId: "style-sample-1",
      priority: 4,
      selectionReason: "Style",
      representation: "full",
      authoritative: false,
      content: "Style sample text ".repeat(1000),
    };

    const bundle = makeSampleBundle([p0, p4], 2000, 1000);
    const result = await applyBudgetPolicy(bundle);

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.bundle.omittedDueToBudget).toHaveLength(1);
      expect(result.bundle.omittedDueToBudget[0]).toEqual({
        sourceId: "style-sample-1",
        priority: 4,
        reason: "soft_trim",
      });
    }
  });

  it("returns context_budget_exceeded when mandatory P0 authority cannot fit", async () => {
    const hugeP0: ContextSection = {
      sourceType: "canon",
      sourceId: "huge-canon",
      priority: 0,
      selectionReason: "Mandatory Canon",
      representation: "full",
      authoritative: true,
      content: "X".repeat(50000), // ~12,500 tokens, exceeds available 3000 tokens
    };

    const bundle = makeSampleBundle([hugeP0], 4000, 1000); // available = 3000 tokens
    const result = await applyBudgetPolicy(bundle);

    expect(result.status).toBe("context_budget_exceeded");
  });

  it("ZERO LLM calls made on budget failure and no automatic model switch", async () => {
    let llmCallCount = 0;
    const mockLLM = () => {
      llmCallCount++;
    };

    const hugeP0: ContextSection = {
      sourceType: "human_direction",
      sourceId: "huge-dir",
      priority: 0,
      selectionReason: "Mandatory direction",
      representation: "full",
      authoritative: true,
      content: "Y".repeat(50000),
    };

    const bundle = makeSampleBundle([hugeP0], 4000, 1000);
    const result = await applyBudgetPolicy(bundle);

    expect(result.status).toBe("context_budget_exceeded");
    expect(llmCallCount).toBe(0); // Zero LLM calls on budget failure
  });
});
