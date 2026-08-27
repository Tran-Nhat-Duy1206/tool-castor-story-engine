import { z } from "zod";

// ===========================================================================
// Phase 5 — Governance domain contracts, capability markers, stable
// vocabularies (Task 1). ALL vocabularies are Core-owned: AI may select valid
// concrete links/values but can never invent new semantics.
// Every schema that later interfaces use as a TypeScript type exports its
// inferred type (repo convention: `export type X = z.infer<typeof XSchema>`).
// ===========================================================================

// ---------------------------------------------------------------------------
// Capability / version markers — explicit marker wins; absence => legacy.
// ---------------------------------------------------------------------------

export const FoundationGovernanceModeSchema = z.enum(["legacy", "v2"]);
export type FoundationGovernanceMode = z.infer<typeof FoundationGovernanceModeSchema>;

export const PlanningGovernanceModeSchema = z.enum(["legacy", "v2"]);
export type PlanningGovernanceMode = z.infer<typeof PlanningGovernanceModeSchema>;

export const GovernanceMarkersSchema = z.object({
  foundation: FoundationGovernanceModeSchema.default("legacy"),
  planning: PlanningGovernanceModeSchema.default("legacy"),
});
export type GovernanceMarkers = z.infer<typeof GovernanceMarkersSchema>;

/**
 * Effective governance mode for a book: absent markers mean legacy/legacy.
 * Unknown marker values FAIL CLOSED (throws) rather than silently degrading.
 * This helper never mutates persisted book config — later Tasks own marker
 * flips; Task 1 only resolves the effective mode deterministically.
 */
export function resolveGovernanceMarkers(book: {
  readonly governance?: Partial<GovernanceMarkers>;
}): GovernanceMarkers {
  return GovernanceMarkersSchema.parse(book.governance ?? {});
}

// ---------------------------------------------------------------------------
// Path-safe governance IDs — ANY id that can influence a filesystem location
// must validate through this helper (unitId, revisionId, candidateId, arcId,
// draftId, beatId, planId, lookaheadId, snapshotId, attemptId, directionId,
// authorizationId, and governed entity IDs inside dependency refs).
// Rejects path separators, dot traversal, absolute/drive paths, control
// characters, and unsafe empty/oversize values.
// ---------------------------------------------------------------------------

export const SafeGovernanceIdSchema = z
  .string()
  .min(1, "governance id must not be empty")
  .max(128, "governance id exceeds 128 characters")
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "governance id contains control characters")
  .refine(
    (value) => !value.includes("/") && !value.includes("\\"),
    "governance id must not contain path separators",
  )
  .refine(
    (value) => value !== "." && value !== ".." && !value.startsWith(".."),
    "governance id must not traverse parent directories",
  )
  .refine((value) => !/^[a-zA-Z]:/.test(value), "governance id must not be drive-prefixed")
  .refine(
    (value) => !value.startsWith("/") && !value.startsWith("\\"),
    "governance id must not be an absolute path",
  )
  .refine(
    (value) => !/[<>:"|?*]/.test(value),
    "governance id must not contain Windows-invalid filename characters",
  )
  .refine(
    (value) => !value.endsWith(" ") && !value.endsWith("."),
    "governance id must not end with a space or a dot",
  )
  .refine(
    (value) => !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i.test(value),
    "governance id must not be a reserved Windows device name",
  );
export type SafeGovernanceId = z.infer<typeof SafeGovernanceIdSchema>;

// ---------------------------------------------------------------------------
// Foundation vocabulary.
// ---------------------------------------------------------------------------

export const FoundationUnitKindSchema = z.enum([
  "story_frame", "character", "relationship_intent", "arc_direction",
  "book_rule", "foundation_hook", "timeline_anchor", "timeline_constraint",
]);
export type FoundationUnitKind = z.infer<typeof FoundationUnitKindSchema>;

export const FoundationUnitStatusSchema = z.enum([
  "missing", "draft", "needs_review", "approved", "needs_revision",
  "stale", "legacy_established",
]);
export type FoundationUnitStatus = z.infer<typeof FoundationUnitStatusSchema>;

export const ImportanceSchema = z.enum(["required", "optional"]);
export type Importance = z.infer<typeof ImportanceSchema>;

export const CharacterReasonSchema = z.enum([
  "protagonist", "co_protagonist", "core_conflict_participant",
  "primary_antagonist", "central_relationship", "arc_required",
  "supporting", "future_only", "minor",
]);
export type CharacterReason = z.infer<typeof CharacterReasonSchema>;

export const RelationshipTierSchema = z.enum(["central", "arc_relevant", "runtime_only"]);
export type RelationshipTier = z.infer<typeof RelationshipTierSchema>;

export const HookLifecycleStateSchema = z.enum([
  "proposed", "active", "advanced", "dormant", "ready_for_payoff",
  "resolved", "deferred", "abandoned",
]);
export type HookLifecycleState = z.infer<typeof HookLifecycleStateSchema>;

export const HookAuthorityLevelSchema = z.enum(["foundation_hook", "runtime_hook"]);
export type HookAuthorityLevel = z.infer<typeof HookAuthorityLevelSchema>;

export const TimelineConstraintKindSchema = z.enum(["hard", "soft", "target"]);
export type TimelineConstraintKind = z.infer<typeof TimelineConstraintKindSchema>;

export const BookRuleKindSchema = z.enum([
  "pov", "language", "style", "content_boundary", "world_invariant",
  "character_invariant", "relationship_constraint", "structure_constraint",
]);
export type BookRuleKind = z.infer<typeof BookRuleKindSchema>;

// ---------------------------------------------------------------------------
// Foundation dependency vocabulary — CORE-OWNED and finite; AI selects valid
// concrete links but can never invent dependency semantics.
// ---------------------------------------------------------------------------

export const FoundationDependencyKindSchema = z.enum([
  "requires_character", "references_book_rule", "uses_hook", "timeline_after",
  "relies_on_arc_direction", "relates_relationship", "extends_story_frame",
]);
export type FoundationDependencyKind = z.infer<typeof FoundationDependencyKindSchema>;

export const FoundationDependencyRefSchema = z.object({
  kind: FoundationDependencyKindSchema,
  targetUnitId: SafeGovernanceIdSchema,
  observedRevision: z.union([z.number(), z.string()]).optional(),
}).strict(); // nested persisted governance data fails closed — unknown keys never silently stripped
export type FoundationDependencyRef = z.infer<typeof FoundationDependencyRefSchema>;

// ---------------------------------------------------------------------------
// Human governance / Planning vocabulary.
// ---------------------------------------------------------------------------

export const AuthorizationScopeKindSchema = z.enum([
  "exact_chapter", "chapter_window", "arc", "condition", "from_arc",
]);
export type AuthorizationScopeKind = z.infer<typeof AuthorizationScopeKindSchema>;

export const AuthorizationConditionKindSchema = z.enum([
  "after_hook_advanced", "after_hook_resolved", "after_arc_started",
  "after_arc_climax", "after_chapter", "after_relationship_state", "after_fact_exists",
]);
export type AuthorizationConditionKind = z.infer<typeof AuthorizationConditionKindSchema>;

export const AuthorizationLifecycleSchema = z.enum([
  "pending", "active", "consumed", "expired", "cancelled",
]);
export type AuthorizationLifecycle = z.infer<typeof AuthorizationLifecycleSchema>;

export const AuthorizationConsumptionSchema = z.enum(["one_time", "reusable"]);
export type AuthorizationConsumption = z.infer<typeof AuthorizationConsumptionSchema>;

export const AuthorDecisionKindSchema = z.enum([
  "major_character_death", "identity_reveal", "relationship_commitment",
  "relationship_break", "major_goal_change", "major_alliance_change",
  "major_betrayal", "major_secret_reveal", "major_hook_resolution",
  "antagonist_role_change", "world_rule_exception", "major_timeline_jump",
  "arc_direction_change", "ending_direction_change",
]);
export type AuthorDecisionKind = z.infer<typeof AuthorDecisionKindSchema>;

export const HumanDirectionScopeKindSchema = z.enum([
  "exact_chapter", "chapter_window", "arc", "until_condition",
]);
export type HumanDirectionScopeKind = z.infer<typeof HumanDirectionScopeKindSchema>;

export const HumanDirectionLifecycleSchema = z.enum([
  "pending", "active", "satisfied", "unsatisfied", "expired", "superseded", "cancelled",
]);
export type HumanDirectionLifecycle = z.infer<typeof HumanDirectionLifecycleSchema>;

export const BeatCategorySchema = z.enum([
  "event", "fact_change", "hook_state", "relationship_change",
  "character_change", "goal_change", "knowledge_change", "pressure_change", "arc_turn",
]);
export type BeatCategory = z.infer<typeof BeatCategorySchema>;

export const BeatStatusSchema = z.enum([
  "pending", "in_progress", "satisfied", "blocked", "superseded",
]);
export type BeatStatus = z.infer<typeof BeatStatusSchema>;

export const LookaheadStatusSchema = z.enum(["current", "stale", "superseded", "consumed"]);
export type LookaheadStatus = z.infer<typeof LookaheadStatusSchema>;

export const FindingSeveritySchema = z.enum(["minor", "important", "blocking"]);
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;

export const RepairScopeSchema = z.enum(["local", "multi_unit", "author_decision"]);
export type RepairScope = z.infer<typeof RepairScopeSchema>;

export const CanonConflictKindSchema = z.enum(["future_safe", "uncertain", "canon_conflict"]);
export type CanonConflictKind = z.infer<typeof CanonConflictKindSchema>;

export const GateResultSchema = z.enum(["safe", "uncertain", "author_decision", "conflict"]);
export type GateResult = z.infer<typeof GateResultSchema>;

export const ArcCompletionOutcomeSchema = z.enum([
  "not_ready", "ready_to_close", "arc_completion_uncertain",
]);
export type ArcCompletionOutcome = z.infer<typeof ArcCompletionOutcomeSchema>;

export const AttemptDefectSchema = z.enum([
  "prose_defect", "plan_defect", "authority_defect", "canon_conflict",
]);
export type AttemptDefect = z.infer<typeof AttemptDefectSchema>;

// ---------------------------------------------------------------------------
// Typed dependency refs shared by Lookahead / Detailed Plan / Context (single
// vocabulary). RUNTIME-VALIDATED schema (zod discriminatedUnion) because these
// refs come from external/AI/file data. Each variant records the OBSERVED
// source state so selective revalidation can answer deterministically: "Has
// THIS declared dependency changed since I planned against it?" without
// staling on unrelated Canon changes.
// ---------------------------------------------------------------------------

export const PlanningDependencyRefSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("foundation_unit"),
    unitId: SafeGovernanceIdSchema,
    contentRevision: z.number(),
    approvedRevision: z.number(),
    foundationVersion: z.number(),
  }),
  z.object({
    kind: z.literal("canon_fact"),
    factKey: SafeGovernanceIdSchema,
    canonRevision: z.number(),
    evidenceRevision: z.string(),
  }),
  z.object({
    kind: z.literal("hook"),
    hookId: SafeGovernanceIdSchema,
    authority: HookAuthorityLevelSchema,
    observedLifecycleRevision: z.string(),
  }),
  z.object({
    kind: z.literal("relationship"),
    relationshipId: SafeGovernanceIdSchema,
    observedStateRevision: z.string(),
  }),
  z.object({
    kind: z.literal("timeline"),
    anchorId: SafeGovernanceIdSchema,
    observedRevision: z.string(),
  }),
  z.object({
    kind: z.literal("character_state"),
    characterId: SafeGovernanceIdSchema,
    observedStateRevision: z.string(),
  }),
  z.object({
    kind: z.literal("arc_beat"),
    beatId: SafeGovernanceIdSchema,
    observedEvidenceRevision: z.string(),
  }),
  z.object({
    kind: z.literal("human_direction"),
    directionId: SafeGovernanceIdSchema,
    lifecycleRevision: z.string(),
  }),
  z.object({
    kind: z.literal("authorization"),
    authorizationId: SafeGovernanceIdSchema,
    lifecycleRevision: z.string(),
    confirmedAt: z.string().optional(),
  }),
]);
export type PlanningDependencyRef = z.infer<typeof PlanningDependencyRefSchema>;

// ---------------------------------------------------------------------------
// Generic future-planning artifact kinds for the PlanningInvalidationRegistry
// (Task 12): Arc Publish (Task 13) invalidates these generically WITHOUT
// importing later Lookahead/Detailed Plan types.
// ---------------------------------------------------------------------------

export const PlanningArtifactKindSchema = z.enum(["lookahead", "detailed_plan"]);
export type PlanningArtifactKind = z.infer<typeof PlanningArtifactKindSchema>;
