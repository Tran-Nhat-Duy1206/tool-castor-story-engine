import { describe, expect, it } from "vitest";
import {
  ArcCompletionOutcomeSchema,
  AttemptDefectSchema,
  AuthorizationConditionKindSchema,
  AuthorizationConsumptionSchema,
  AuthorizationLifecycleSchema,
  AuthorizationScopeKindSchema,
  AuthorDecisionKindSchema,
  BeatCategorySchema,
  BeatStatusSchema,
  BookRuleKindSchema,
  CanonConflictKindSchema,
  CharacterReasonSchema,
  FoundationDependencyKindSchema,
  FoundationDependencyRefSchema,
  FoundationGovernanceModeSchema,
  FoundationUnitKindSchema,
  FoundationUnitStatusSchema,
  FindingSeveritySchema,
  GateResultSchema,
  GovernanceMarkersSchema,
  HookAuthorityLevelSchema,
  HookLifecycleStateSchema,
  HumanDirectionLifecycleSchema,
  HumanDirectionScopeKindSchema,
  ImportanceSchema,
  LookaheadStatusSchema,
  PlanningArtifactKindSchema,
  PlanningDependencyRefSchema,
  PlanningGovernanceModeSchema,
  RelationshipTierSchema,
  RepairScopeSchema,
  SafeGovernanceIdSchema,
  TimelineConstraintKindSchema,
  resolveGovernanceMarkers,
} from "../governance/contracts.js";
import { BookConfigSchema } from "../models/book.js";

// ---------------------------------------------------------------------------
// 1. Every canonical enum member parses; 2. unknown enum values reject.
// ---------------------------------------------------------------------------

const canonicalEnumCases: ReadonlyArray<readonly [name: string, schema: { safeParse(v: unknown): { success: boolean } }, members: ReadonlyArray<string>]> = [
  ["FoundationGovernanceModeSchema", FoundationGovernanceModeSchema, ["legacy", "v2"]],
  ["PlanningGovernanceModeSchema", PlanningGovernanceModeSchema, ["legacy", "v2"]],
  ["FoundationUnitKindSchema", FoundationUnitKindSchema, [
    "story_frame", "character", "relationship_intent", "arc_direction",
    "book_rule", "foundation_hook", "timeline_anchor", "timeline_constraint",
  ]],
  ["FoundationUnitStatusSchema", FoundationUnitStatusSchema, [
    "missing", "draft", "needs_review", "approved", "needs_revision", "stale", "legacy_established",
  ]],
  ["ImportanceSchema", ImportanceSchema, ["required", "optional"]],
  ["CharacterReasonSchema", CharacterReasonSchema, [
    "protagonist", "co_protagonist", "core_conflict_participant",
    "primary_antagonist", "central_relationship", "arc_required",
    "supporting", "future_only", "minor",
  ]],
  ["RelationshipTierSchema", RelationshipTierSchema, ["central", "arc_relevant", "runtime_only"]],
  ["HookLifecycleStateSchema", HookLifecycleStateSchema, [
    "proposed", "active", "advanced", "dormant", "ready_for_payoff",
    "resolved", "deferred", "abandoned",
  ]],
  ["HookAuthorityLevelSchema", HookAuthorityLevelSchema, ["foundation_hook", "runtime_hook"]],
  ["TimelineConstraintKindSchema", TimelineConstraintKindSchema, ["hard", "soft", "target"]],
  ["BookRuleKindSchema", BookRuleKindSchema, [
    "pov", "language", "style", "content_boundary", "world_invariant",
    "character_invariant", "relationship_constraint", "structure_constraint",
  ]],
  ["AuthorizationScopeKindSchema", AuthorizationScopeKindSchema, [
    "exact_chapter", "chapter_window", "arc", "condition", "from_arc",
  ]],
  ["AuthorizationConditionKindSchema", AuthorizationConditionKindSchema, [
    "after_hook_advanced", "after_hook_resolved", "after_arc_started",
    "after_arc_climax", "after_chapter", "after_relationship_state", "after_fact_exists",
  ]],
  ["AuthorizationLifecycleSchema", AuthorizationLifecycleSchema, [
    "pending", "active", "consumed", "expired", "cancelled",
  ]],
  ["AuthorizationConsumptionSchema", AuthorizationConsumptionSchema, ["one_time", "reusable"]],
  ["AuthorDecisionKindSchema", AuthorDecisionKindSchema, [
    "major_character_death", "identity_reveal", "relationship_commitment",
    "relationship_break", "major_goal_change", "major_alliance_change",
    "major_betrayal", "major_secret_reveal", "major_hook_resolution",
    "antagonist_role_change", "world_rule_exception", "major_timeline_jump",
    "arc_direction_change", "ending_direction_change",
  ]],
  ["HumanDirectionScopeKindSchema", HumanDirectionScopeKindSchema, [
    "exact_chapter", "chapter_window", "arc", "until_condition",
  ]],
  ["HumanDirectionLifecycleSchema", HumanDirectionLifecycleSchema, [
    "pending", "active", "satisfied", "unsatisfied", "expired", "superseded", "cancelled",
  ]],
  ["BeatCategorySchema", BeatCategorySchema, [
    "event", "fact_change", "hook_state", "relationship_change",
    "character_change", "goal_change", "knowledge_change", "pressure_change", "arc_turn",
  ]],
  ["BeatStatusSchema", BeatStatusSchema, ["pending", "in_progress", "satisfied", "blocked", "superseded"]],
  ["LookaheadStatusSchema", LookaheadStatusSchema, ["current", "stale", "superseded", "consumed"]],
  ["FindingSeveritySchema", FindingSeveritySchema, ["minor", "important", "blocking"]],
  ["RepairScopeSchema", RepairScopeSchema, ["local", "multi_unit", "author_decision"]],
  ["CanonConflictKindSchema", CanonConflictKindSchema, ["future_safe", "uncertain", "canon_conflict"]],
  ["GateResultSchema", GateResultSchema, ["safe", "uncertain", "author_decision", "conflict"]],
  ["ArcCompletionOutcomeSchema", ArcCompletionOutcomeSchema, ["not_ready", "ready_to_close", "arc_completion_uncertain"]],
  ["AttemptDefectSchema", AttemptDefectSchema, ["prose_defect", "plan_defect", "authority_defect", "canon_conflict"]],
  ["FoundationDependencyKindSchema", FoundationDependencyKindSchema, [
    "requires_character", "references_book_rule", "uses_hook", "timeline_after",
    "relies_on_arc_direction", "relates_relationship", "extends_story_frame",
  ]],
  ["PlanningArtifactKindSchema", PlanningArtifactKindSchema, ["lookahead", "detailed_plan"]],
];

for (const [name, schema, members] of canonicalEnumCases) {
  describe(`${name}`, () => {
    it("parses every canonical member", () => {
      for (const member of members) {
        expect(schema.safeParse(member).success, `${name} should accept "${member}"`).toBe(true);
      }
    });
    it("rejects unknown values", () => {
      expect(schema.safeParse("invented_value").success).toBe(false);
      expect(schema.safeParse("").success).toBe(false);
      expect(schema.safeParse(123).success).toBe(false);
    });
  });
}

// ---------------------------------------------------------------------------
// 3–6. Governance markers: defaults, explicit v2, legacy BookConfig, fail-closed.
// ---------------------------------------------------------------------------

describe("GovernanceMarkersSchema", () => {
  it("defaults to legacy/legacy when absent", () => {
    expect(GovernanceMarkersSchema.parse({})).toEqual({ foundation: "legacy", planning: "legacy" });
    expect(GovernanceMarkersSchema.parse({ foundation: "v2" })).toEqual({ foundation: "v2", planning: "legacy" });
  });

  it("parses explicit v2 markers", () => {
    expect(GovernanceMarkersSchema.parse({ foundation: "v2", planning: "v2" }))
      .toEqual({ foundation: "v2", planning: "v2" });
  });

  it("fails closed on unknown marker values", () => {
    expect(GovernanceMarkersSchema.safeParse({ foundation: "v3" } as never).success).toBe(false);
    expect(GovernanceMarkersSchema.safeParse({ planning: "beta" } as never).success).toBe(false);
  });
});

describe("BookConfigSchema additive governance field", () => {
  const legacyBook = {
    id: "legacy-book",
    title: "Legacy Book",
    platform: "tomato",
    genre: "xuanhuan",
    status: "active",
    targetChapters: 10,
    chapterWordCount: 3000,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("parses an old book WITHOUT governance unchanged", () => {
    const parsed = BookConfigSchema.parse(legacyBook);
    expect(parsed.governance).toBeUndefined();
  });

  it("parses a book with explicit v2 governance markers", () => {
    const parsed = BookConfigSchema.parse({ ...legacyBook, governance: { foundation: "v2", planning: "v2" } });
    expect(parsed.governance).toEqual({ foundation: "v2", planning: "v2" });
  });

  it("fails closed on an unknown governance marker", () => {
    expect(BookConfigSchema.safeParse({ ...legacyBook, governance: { foundation: "v3" } as never }).success).toBe(false);
  });

  it("resolveGovernanceMarkers: absent means legacy/legacy; explicit v2 wins; unknown fails closed", () => {
    expect(resolveGovernanceMarkers({})).toEqual({ foundation: "legacy", planning: "legacy" });
    expect(resolveGovernanceMarkers({ governance: { foundation: "v2" } }))
      .toEqual({ foundation: "v2", planning: "legacy" });
    // Unknown marker value must fail closed at runtime; the literal is cast
    // because TypeScript already rejects "v3" statically.
    expect(() => resolveGovernanceMarkers({ governance: { foundation: "v3" } as never })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 7–8. PlanningDependencyRefSchema: every variant parses; malformed/unknown reject.
// ---------------------------------------------------------------------------

describe("PlanningDependencyRefSchema", () => {
  const canonicalVariants = [
    { kind: "foundation_unit", unitId: "unit-theme", contentRevision: 3, approvedRevision: 3, foundationVersion: 2 },
    { kind: "canon_fact", factKey: "fact-alive", canonRevision: 7, evidenceRevision: "ev-1" },
    { kind: "hook", hookId: "hook-mentor", authority: "foundation_hook", observedLifecycleRevision: "lr-4" },
    { kind: "relationship", relationshipId: "rel-liuyue", observedStateRevision: "sr-2" },
    { kind: "timeline", anchorId: "anchor-1", observedRevision: "r-9" },
    { kind: "character_state", characterId: "char-protagonist", observedStateRevision: "cs-5" },
    { kind: "arc_beat", beatId: "beat-climax", observedEvidenceRevision: "be-3" },
    { kind: "human_direction", directionId: "dir-1", lifecycleRevision: "lr-1" },
    { kind: "authorization", authorizationId: "auth-1", lifecycleRevision: "lr-2", confirmedAt: "2026-08-27T00:00:00.000Z" },
  ] as const;

  it("parses every approved variant", () => {
    for (const variant of canonicalVariants) {
      expect(PlanningDependencyRefSchema.safeParse(variant).success, `variant ${variant.kind}`).toBe(true);
    }
  });

  it("rejects malformed and unknown variants at runtime", () => {
    expect(PlanningDependencyRefSchema.safeParse({ kind: "invented_kind", unitId: "u" }).success).toBe(false);
    expect(PlanningDependencyRefSchema.safeParse({ kind: "foundation_unit", unitId: "u" }).success).toBe(false); // missing revisions
    expect(PlanningDependencyRefSchema.safeParse({ kind: "hook", hookId: "h", authority: "unknown_level", observedLifecycleRevision: "x" }).success).toBe(false);
    expect(PlanningDependencyRefSchema.safeParse({ kind: "foundation_unit", unitId: "a/b", contentRevision: 1, approvedRevision: 1, foundationVersion: 1 }).success).toBe(false); // unsafe id
    expect(PlanningDependencyRefSchema.safeParse("not-an-object").success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 9. FoundationDependencyRefSchema rejects invented semantics.
// ---------------------------------------------------------------------------

describe("FoundationDependencyRefSchema", () => {
  it("parses canonical kinds and rejects invented ones", () => {
    expect(FoundationDependencyRefSchema.safeParse({ kind: "requires_character", targetUnitId: "char-protagonist" }).success).toBe(true);
    expect(FoundationDependencyRefSchema.safeParse({ kind: "invented_kind", targetUnitId: "char-x" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 10–11. SafeGovernanceIdSchema rejects unsafe values, accepts safe values.
// ---------------------------------------------------------------------------

describe("SafeGovernanceIdSchema", () => {
  const unsafe = [
    "a/b",
    "a\\b",
    "..",
    "../x",
    "..\\x",
    "/abs/path",
    "\\abs\\path",
    "C:drive",
    "c:drive",
    "with\u0000nul",
    "with\u0001control",
    "",
    "a".repeat(129),
  ] as const;

  it("rejects unsafe governance ids", () => {
    for (const value of unsafe) {
      expect(SafeGovernanceIdSchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
    }
  });

  it("accepts safe governance ids", () => {
    for (const value of ["unit-theme", "char-1", "auth-1", "plan-a", "x".repeat(128)]) {
      expect(SafeGovernanceIdSchema.safeParse(value).success, value).toBe(true);
    }
  });

  it("governed IDs inside dependency schemas use the validated contract", () => {
    // An unsafe targetUnitId must fail FoundationDependencyRefSchema too.
    expect(FoundationDependencyRefSchema.safeParse({ kind: "uses_hook", targetUnitId: "../../etc" }).success).toBe(false);
  });
});
