import { describe, expect, it } from "vitest";
import {
  ChapterSummaryRowSchema,
  HookRecordSchema,
  NewHookCandidateSchema,
  RuntimeStateLanguageSchema,
} from "../models/runtime-state.js";
import {
  ProposalChangeSchema,
  ResolvedReviewReceiptSchema,
  ReviewItemKindSchema,
  ReviewItemSchema,
  ReviewOriginSchema,
  StateReviewArtifactSchema,
  StateReviewError,
  fnv1a8,
  resolveReviewItemEffectiveChange,
  stateReviewItemId,
  type ReviewItem,
} from "../models/state-review.js";

const CREATED_AT = "2026-08-24T00:00:00.000Z";
const REVIEW_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"; // uuid v4 shaped
const REVISION_16HEX = "0123456789abcdef";

function factProposal(object: string) {
  return {
    type: "fact",
    change: { action: "set", subject: "protagonist", predicate: "current-location", object },
  } as const;
}

function factItem(overrides: Partial<ReviewItem> = {}): ReviewItem {
  // Parse through the real schema so field defaults (decision => "undecided")
  // behave exactly as they do for production items.
  return ReviewItemSchema.parse({
    id: "current-state-fact:0:test",
    kind: "current-state-fact",
    origin: "ai",
    title: "Location change",
    proposal: factProposal("east-city-flat"),
    ...overrides,
  }) as ReviewItem;
}

function activeProposal(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    status: "active",
    reviewId: REVIEW_ID,
    sourceChapter: 13,
    effectiveChapter: 14,
    proseRevision: REVISION_16HEX,
    baseCanonRevision: "fedcba9876543210",
    reviewRevision: 1,
    items: [factItem()],
    createdAt: CREATED_AT,
    language: "zh",
    ...overrides,
  };
}

describe("state review workflow shells", () => {
  it("parses a rebuild_required shell without any active-only anchors or items", () => {
    const parsed = StateReviewArtifactSchema.parse({
      schemaVersion: 1,
      status: "rebuild_required",
      sourceChapter: 13,
      createdAt: CREATED_AT,
      language: "zh",
    });
    expect(parsed.status).toBe("rebuild_required");
    expect(parsed).not.toHaveProperty("reviewId");
    expect(parsed).not.toHaveProperty("items");
    expect(parsed).not.toHaveProperty("proseRevision");
    expect(parsed).toMatchObject({ sourceChapter: 13, reason: "" });
  });

  it("parses a rebuild_failed shell without any active-only anchors or items", () => {
    const parsed = StateReviewArtifactSchema.parse({
      schemaVersion: 1,
      status: "rebuild_failed",
      sourceChapter: 16,
      createdAt: CREATED_AT,
      language: "en",
      reason: "analyzer returned unparseable output",
    });
    expect(parsed.status).toBe("rebuild_failed");
    expect(parsed).not.toHaveProperty("effectiveChapter");
    expect(parsed).toMatchObject({ reason: "analyzer returned unparseable output" });
  });

  it("rejects a rebuild_failed shell with an empty reason", () => {
    expect(() =>
      StateReviewArtifactSchema.parse({
        schemaVersion: 1,
        status: "rebuild_failed",
        sourceChapter: 16,
        createdAt: CREATED_AT,
        language: "zh",
      }),
    ).toThrow();
  });
});

describe("active confirmable proposals", () => {
  it("accepts a complete active proposal", () => {
    const parsed = StateReviewArtifactSchema.parse(activeProposal());
    expect(parsed).toMatchObject({ status: "active", reviewRevision: 1 });
  });

  it.each(["reviewId", "sourceChapter", "effectiveChapter", "proseRevision", "baseCanonRevision", "reviewRevision", "items"] as const)(
    "rejects an active proposal missing %s",
    (missingField) => {
      const broken = activeProposal();
      delete broken[missingField];
      expect(() => StateReviewArtifactSchema.parse(broken)).toThrow();
    },
  );

  it("keeps stale proposals anchor-bearing but distinct from confirmable active", () => {
    const parsed = StateReviewArtifactSchema.parse(activeProposal({ status: "stale" }));
    expect(parsed.status).toBe("stale");
    expect(parsed).toHaveProperty("proseRevision");
  });

  it("rejects anchors that do not match their fixed shapes", () => {
    expect(() =>
      StateReviewArtifactSchema.parse(activeProposal({ proseRevision: "short" })),
    ).toThrow();
    expect(() =>
      StateReviewArtifactSchema.parse(activeProposal({ reviewId: "not-a-uuid" })),
    ).toThrow();
    expect(() =>
      StateReviewArtifactSchema.parse(activeProposal({ effectiveChapter: 0 })),
    ).toThrow();
  });
});

describe("review items", () => {
  it("defaults the decision of an undecided actionable AI item to undecided", () => {
    const parsed = ReviewItemSchema.parse(factItem());
    expect(parsed.decision).toBe("undecided");
  });

  it("rejects unknown review item kinds", () => {
    expect(() => ReviewItemKindSchema.parse("relationship-graph")).toThrow();
    expect(() => ReviewItemSchema.parse(factItem({ kind: "relationship-graph" as never }))).toThrow();
  });

  it("rejects invalid origins such as manual", () => {
    expect(() => ReviewOriginSchema.parse("manual")).toThrow();
    expect(() => ReviewItemSchema.parse(factItem({ origin: "manual" as never }))).toThrow();
  });

  it("rejects a fact set proposal without an object and accepts one with it", () => {
    expect(() =>
      ProposalChangeSchema.parse({
        type: "fact",
        change: { action: "set", subject: "protagonist", predicate: "current-location" },
      }),
    ).toThrow();
    expect(ProposalChangeSchema.parse(factProposal("harbor"))).toMatchObject({
      type: "fact",
      change: { action: "set", object: "harbor" },
    });
  });

  it("enforces the real HookRecordSchema for hook-upsert proposals", () => {
    const validHook = HookRecordSchema.parse({
      hookId: "hook-1",
      startChapter: 1,
      type: "foreshadow",
      status: "open",
      lastAdvancedChapter: 1,
    });
    expect(() =>
      ProposalChangeSchema.parse({ type: "hook-upsert", hook: validHook }),
    ).not.toThrow();
    expect(() =>
      ProposalChangeSchema.parse({
        type: "hook-upsert",
        hook: { ...validHook, status: "cancelled" },
      }),
    ).toThrow();
    expect(() =>
      ProposalChangeSchema.parse({ type: "hook-upsert", hook: { hookId: "" } }),
    ).toThrow();
  });

  it("enforces the real NewHookCandidateSchema for candidate proposals", () => {
    const candidate = NewHookCandidateSchema.parse({ type: "mystery" });
    expect(() =>
      ProposalChangeSchema.parse({ type: "new-hook-candidate", candidate }),
    ).not.toThrow();
    expect(() =>
      ProposalChangeSchema.parse({
        type: "new-hook-candidate",
        candidate: { type: "mystery", payoffTiming: "whenever" },
      }),
    ).toThrow();
  });

  it("enforces the real ChapterSummaryRowSchema for summary proposals", () => {
    const row = ChapterSummaryRowSchema.parse({ chapter: 13, title: "夜航" });
    expect(() =>
      ProposalChangeSchema.parse({ type: "chapter-summary", row }),
    ).not.toThrow();
    expect(() =>
      ProposalChangeSchema.parse({ type: "chapter-summary", row: { title: "缺章节号" } }),
    ).toThrow();
  });
});

describe("resolveReviewItemEffectiveChange", () => {
  it("accepted AI item resolves to its proposal", () => {
    const item = factItem({ decision: "accepted" });
    expect(resolveReviewItemEffectiveChange(item)).toEqual(item.proposal);
  });

  it("edited item resolves to the human editedChange, never the original proposal", () => {
    const edited = factProposal("harbor-watchtower");
    const item = factItem({ decision: "edited", editedChange: edited });
    const resolved = resolveReviewItemEffectiveChange(item);
    expect(resolved).toEqual(edited);
    expect(resolved).not.toEqual(item.proposal);
  });

  it("edited item without an editedChange throws state_review_invalid_change carrying the itemId", () => {
    try {
      resolveReviewItemEffectiveChange(factItem({ decision: "edited" }));
      throw new Error("expected resolveReviewItemEffectiveChange to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(StateReviewError);
      expect((error as StateReviewError).code).toBe("state_review_invalid_change");
      expect((error as StateReviewError).itemId).toBe("current-state-fact:0:test");
    }
  });

  it("rejected actionable AI item resolves to no change", () => {
    const item = factItem({ decision: "rejected" });
    expect(resolveReviewItemEffectiveChange(item)).toEqual({ type: "none" });
  });

  it("undecided actionable AI item resolves to no applicable change", () => {
    const item = factItem();
    expect(item.decision).toBe("undecided");
    expect(resolveReviewItemEffectiveChange(item)).toEqual({ type: "none" });
  });

  it("accepted user item resolves to its own proposal", () => {
    const item = factItem({ origin: "user", decision: "accepted" });
    expect(resolveReviewItemEffectiveChange(item)).toEqual(item.proposal);
  });

  it("note items never resolve into an applicable change regardless of decision", () => {
    for (const decision of ["accepted", "rejected", "undecided"] as const) {
      const item = factItem({ kind: "note", decision });
      expect(resolveReviewItemEffectiveChange(item)).toEqual({ type: "none" });
    }
  });
});

describe("stable review item ids", () => {
  it("produces the same id for identical kind/index/payload", () => {
    const payload = { op: "mention", hookId: "hook-1" };
    expect(stateReviewItemId("hook-mention", 2, payload))
      .toBe(stateReviewItemId("hook-mention", 2, payload));
  });

  it("changes the id when the payload content changes", () => {
    expect(stateReviewItemId("hook-mention", 2, { hookId: "hook-1" }))
      .not.toBe(stateReviewItemId("hook-mention", 2, { hookId: "hook-2" }));
  });

  it("changes the id when the index changes even for identical payloads", () => {
    const payload = { hookId: "hook-1" };
    expect(stateReviewItemId("hook-upsert", 0, payload))
      .not.toBe(stateReviewItemId("hook-upsert", 1, payload));
  });

  it("emits the exact kind:index:hash8 shape", () => {
    expect(stateReviewItemId("current-state-fact", 0, { object: "east-city-flat" }))
      .toMatch(/^current-state-fact:0:[0-9a-f]{8}$/);
  });

  it("keeps item ids a separate concept from the reviewId uuid", () => {
    const itemId = stateReviewItemId("chapter-summary", 0, { chapter: 13 });
    expect(itemId).not.toBe(REVIEW_ID);
    expect(itemId.startsWith(REVIEW_ID)).toBe(false);
  });

  it("stays deterministic and payload-sensitive for non-ASCII (CJK) payloads", () => {
    const a = stateReviewItemId("current-state-fact", 0, {
      subject: "protagonist",
      predicate: "location",
      object: "东城公寓",
    });
    const b = stateReviewItemId("current-state-fact", 0, {
      subject: "protagonist",
      predicate: "location",
      object: "东城公寓",
    });
    const c = stateReviewItemId("current-state-fact", 0, {
      subject: "protagonist",
      predicate: "location",
      object: "西城公寓",
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^current-state-fact:0:[0-9a-f]{8}$/);
    expect(c).toMatch(/^current-state-fact:0:[0-9a-f]{8}$/);
  });
});

describe("fnv1a8", () => {
  it("is deterministic and emits eight lowercase hex characters", () => {
    const first = fnv1a8("state-review");
    expect(first).toBe(fnv1a8("state-review"));
    expect(first).toMatch(/^[0-9a-f]{8}$/);
  });

  it("differs when a single character changes", () => {
    expect(fnv1a8("state-review")).not.toBe(fnv1a8("state-reviews"));
  });

  it("is deterministic for non-ASCII (CJK) input", () => {
    expect(fnv1a8("状态审查")).toMatch(/^[0-9a-f]{8}$/);
    expect(fnv1a8("状态审查")).toBe(fnv1a8("状态审查"));
  });

  it("distinguishes visually similar non-ASCII strings", () => {
    expect(fnv1a8("状态审查")).not.toBe(fnv1a8("状态審查"));
  });
});

describe("resolved receipts freeze the three typed layers separately", () => {
  function receiptBase() {
    return {
      schemaVersion: 1,
      reviewId: REVIEW_ID,
      sourceChapter: 13,
      effectiveChapter: 14,
      proseRevision: REVISION_16HEX,
      baseCanonRevision: "fedcba9876543210",
      resultingCanonRevision: "0000000000000001",
      proposals: [factProposal("east-city-flat")],
      decisions: [{ itemId: "current-state-fact:0:test", decision: "accepted" }],
      effectiveChanges: [factProposal("east-city-flat")],
      evidence: [],
      resolvedAt: CREATED_AT,
      resolution: "confirmed-changes",
    };
  }

  it("accepts typed proposal/decision/effective layers and rejects untyped garbage", () => {
    const receipt = receiptBase();
    expect(() => ResolvedReviewReceiptSchema.parse(receipt)).not.toThrow();
    expect(() =>
      ResolvedReviewReceiptSchema.parse({
        ...receipt,
        proposals: [{ anythingGoes: true }],
      }),
    ).toThrow();
  });

  it("keeps rawProviderDelta optional and audit-only", () => {
    const base = { ...receiptBase(), proposals: [], decisions: [], effectiveChanges: [], resolution: "confirmed-no-changes" };
    expect(ResolvedReviewReceiptSchema.parse(base).rawProviderDelta).toBeUndefined();
    expect(
      ResolvedReviewReceiptSchema.parse({ ...base, rawProviderDelta: { provider: "stub", nested: [1] } })
        .rawProviderDelta,
    ).toEqual({ provider: "stub", nested: [1] });
  });
});

describe("receipt evidence preservation (spec §7/§23)", () => {
  function receiptBase() {
    return {
      schemaVersion: 1,
      reviewId: REVIEW_ID,
      sourceChapter: 13,
      effectiveChapter: 14,
      proseRevision: REVISION_16HEX,
      baseCanonRevision: "fedcba9876543210",
      resultingCanonRevision: "0000000000000001",
      proposals: [],
      decisions: [],
      effectiveChanges: [],
      evidence: [] as Array<{ itemId: string; evidence: Record<string, unknown> }>,
      resolvedAt: CREATED_AT,
      resolution: "confirmed-no-changes" as const,
    };
  }

  it("retains per-item evidence metadata exactly instead of stripping it", () => {
    const entry = {
      itemId: "current-state-fact:0:test",
      evidence: {
        claimedLevel: "explicit",
        verifiedLevel: "explicit",
        quote: "他推开了临街的木门。",
      },
    };
    const parsed = ResolvedReviewReceiptSchema.parse({ ...receiptBase(), evidence: [entry] });
    expect(parsed.evidence).toEqual([entry]);
  });

  it("rejects a receipt missing the required evidence field", () => {
    const { evidence: _omitted, ...broken } = receiptBase();
    expect(() => ResolvedReviewReceiptSchema.parse(broken)).toThrow();
  });

  it("accepts an empty evidence array for zero-change reviews", () => {
    const parsed = ResolvedReviewReceiptSchema.parse(receiptBase());
    expect(parsed.evidence).toEqual([]);
  });

  it("rejects malformed evidence entries through ReviewEvidenceSchema", () => {
    expect(() =>
      ResolvedReviewReceiptSchema.parse({
        ...receiptBase(),
        evidence: [
          { itemId: "current-state-fact:0:test", evidence: { claimedLevel: "explicit", verifiedLevel: "obvious" } },
        ],
      }),
    ).toThrow();
    expect(() =>
      ResolvedReviewReceiptSchema.parse({
        ...receiptBase(),
        evidence: [{ evidence: { claimedLevel: "inferred", verifiedLevel: "inferred" } }],
      }),
    ).toThrow();
  });
});

describe("language reuse and error surface", () => {
  it("reuses the canonical RuntimeStateLanguageSchema instead of a local union", () => {
    expect(RuntimeStateLanguageSchema.options).toContain("zh");
    expect(RuntimeStateLanguageSchema.options).toContain("en");
    expect(() =>
      StateReviewArtifactSchema.parse(activeProposal({ language: "fr" })),
    ).toThrow();
    expect(() =>
      StateReviewArtifactSchema.parse({
        schemaVersion: 1,
        status: "rebuild_required",
        sourceChapter: 13,
        createdAt: CREATED_AT,
        language: "jp",
      }),
    ).toThrow();
  });

  it("exposes typed error codes through StateReviewError", () => {
    const error = new StateReviewError(
      "state_review_not_found",
      "no state review for chapter 404",
      "current-state-fact:0:x",
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("StateReviewError");
    expect(error.code).toBe("state_review_not_found");
    expect(error.itemId).toBe("current-state-fact:0:x");
  });
});
