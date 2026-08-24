import { z } from "zod";
import {
  ChapterSummaryRowSchema,
  HookRecordSchema,
  NewHookCandidateSchema,
  RuntimeStateLanguageSchema,
} from "./runtime-state.js";

/**
 * Phase 4 state-review domain model (spec:
 * docs/superpowers/specs/2026-08-24-human-governed-post-chapter-state-review-design.md).
 *
 * Pure schemas + pure helpers ONLY — no filesystem access, no reducer logic,
 * no Canon mutation. Persistence lives in later tasks (state-review-store).
 *
 * Three separately-typed semantic layers (plan blocker-7 freeze):
 *   1. proposal   — the AI/user proposed semantic change (`ProposalChangeSchema`)
 *   2. decision   — the frozen human decision record (`HumanDecisionRecordSchema`)
 *   3. effective  — what confirmation will apply, resolved by the ONE resolver
 *      `resolveReviewItemEffectiveChange`.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** Workflow lifecycle discriminant shared by shells and proposals. */
export const StateReviewWorkflowStatusSchema = z.enum([
  "active",
  "stale",
  "rebuild_required",
  "rebuild_failed",
]);
export type StateReviewWorkflowStatus = z.infer<typeof StateReviewWorkflowStatusSchema>;

export const ReviewItemKindSchema = z.enum([
  "current-state-fact",
  "hook-upsert",
  "hook-mention",
  "hook-resolve",
  "hook-defer",
  "new-hook-candidate",
  "chapter-summary",
  "note",
]);
export type ReviewItemKind = z.infer<typeof ReviewItemKindSchema>;

export const ReviewOriginSchema = z.enum(["ai", "user"]);
export type ReviewOrigin = z.infer<typeof ReviewOriginSchema>;

export const EvidenceLevelSchema = z.enum(["explicit", "inferred"]);
export type EvidenceLevel = z.infer<typeof EvidenceLevelSchema>;

export const ReviewDecisionKindSchema = z.enum([
  "undecided",
  "accepted",
  "edited",
  "rejected",
]);
export type ReviewDecisionKind = z.infer<typeof ReviewDecisionKindSchema>;

// ---------------------------------------------------------------------------
// Layer 1/3 payload: AI/user proposal AND final effective change (typed)
// ---------------------------------------------------------------------------

const FactChangeSchema = z
  .object({
    action: z.enum(["set", "remove"]),
    subject: z.string().min(1),
    predicate: z.string().min(1),
    object: z.string().optional(), // required iff action === "set" (refined below)
  })
  .superRefine((change, ctx) => {
    if (change.action === "set" && !change.object) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "fact set change requires an object value",
        path: ["object"],
      });
    }
  });

/**
 * The typed semantic payload carried by review items and receipts.
 * Reuses the REAL Core schemas for hooks/candidates/summaries — never a bare
 * z.unknown() where semantics matter. `{type:"none"}` is the explicit
 * no-applicable-change marker produced by rejected/rejected-by-default items.
 */
export const ProposalChangeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("fact"), change: FactChangeSchema }),
  z.object({ type: z.literal("hook-upsert"), hook: HookRecordSchema }),
  z.object({
    type: z.literal("hook-op"),
    op: z.enum(["mention", "resolve", "defer"]),
    hookId: z.string().min(1),
  }),
  z.object({ type: z.literal("new-hook-candidate"), candidate: NewHookCandidateSchema }),
  z.object({ type: z.literal("chapter-summary"), row: ChapterSummaryRowSchema }),
  z.object({ type: z.literal("none") }),
]);
export type ProposalChange = z.infer<typeof ProposalChangeSchema>;

// ---------------------------------------------------------------------------
// Layer 2: human decision record (receipts freeze these)
// ---------------------------------------------------------------------------

export const HumanDecisionRecordSchema = z.object({
  itemId: z.string().min(1),
  decision: ReviewDecisionKindSchema,
  editedChange: ProposalChangeSchema.optional(),
});
export type HumanDecisionRecord = z.infer<typeof HumanDecisionRecordSchema>;

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export const ReviewEvidenceSchema = z.object({
  claimedLevel: EvidenceLevelSchema,
  verifiedLevel: EvidenceLevelSchema,
  // Present iff verifiedLevel === "explicit"; producers guarantee this pairing.
  quote: z.string().max(200).optional(),
});
export type ReviewEvidence = z.infer<typeof ReviewEvidenceSchema>;

// ---------------------------------------------------------------------------
// Review item envelope
// ---------------------------------------------------------------------------

export const ReviewItemSchema = z.object({
  id: z.string().min(1),
  kind: ReviewItemKindSchema,
  origin: ReviewOriginSchema,
  title: z.string().min(1),
  detail: z.string().optional(),
  /** REQUIRED typed layer-1 payload (AI proposal for ai origin; user layer for user origin). */
  proposal: ProposalChangeSchema,
  evidence: ReviewEvidenceSchema.optional(),
  decision: ReviewDecisionKindSchema.default("undecided"),
  editedChange: ProposalChangeSchema.optional(),
});
export type ReviewItem = z.infer<typeof ReviewItemSchema>;

// ---------------------------------------------------------------------------
// Layer 3 resolver: the ONE place an effective change is decided
// ---------------------------------------------------------------------------

const NO_CHANGE: ProposalChange = { type: "none" };

/**
 * Resolve what a decided review item contributes to the confirmed delta.
 *
 * - accepted            => item.proposal            (AI or user)
 * - edited              => item.editedChange        (required; absence is a defect ⇒ typed error)
 * - rejected            => none
 * - accepted user       => item.proposal
 * - note kind           => none (regardless of decision)
 * - undecided           => none (undecided actionable AI items NEVER become applicable changes)
 */
export function resolveReviewItemEffectiveChange(item: ReviewItem): ProposalChange {
  if (item.kind === "note") return NO_CHANGE;
  switch (item.decision) {
    case "accepted":
      return item.proposal;
    case "edited":
      if (!item.editedChange) {
        throw new StateReviewError(
          "state_review_invalid_change",
          `edited review item ${item.id} is missing its editedChange`,
          item.id,
        );
      }
      return item.editedChange;
    case "rejected":
      return NO_CHANGE;
    case "undecided":
      return NO_CHANGE;
  }
}

// ---------------------------------------------------------------------------
// Workflow artifacts: NON-CONFIRMABLE shells vs ACTIVE confirmable proposal
// ---------------------------------------------------------------------------

const ShellBaseFields = {
  schemaVersion: z.literal(1),
  sourceChapter: z.number().int().min(1),
  createdAt: z.string().datetime(),
  language: RuntimeStateLanguageSchema,
};

/**
 * Discriminated union so a shell CANNOT carry anchors/items and an ACTIVE
 * variant CANNOT omit them. `stale` keeps active-shaped anchors but remains
 * NON-CONFIRMABLE via its status discriminant.
 */
export const StateReviewArtifactSchema = z.discriminatedUnion("status", [
  z.object({
    ...ShellBaseFields,
    status: z.literal("rebuild_required"),
    reason: z.string().default(""),
  }),
  z.object({
    ...ShellBaseFields,
    status: z.literal("rebuild_failed"),
    reason: z.string().min(1),
  }),
  z.object({
    ...ShellBaseFields,
    status: z.enum(["active", "stale"]),
    reviewId: z.string().regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    ), // uuid v4, lowercase
    effectiveChapter: z.number().int().min(1),
    proseRevision: z.string().regex(/^[0-9a-f]{16}$/),
    baseCanonRevision: z.string().regex(/^[0-9a-f]{16}$/),
    reviewRevision: z.number().int().min(1),
    items: z.array(ReviewItemSchema),
  }),
]);
export type StateReviewArtifact = z.infer<typeof StateReviewArtifactSchema>;

export type RebuildRequiredShellArtifact = Extract<
  StateReviewArtifact,
  { status: "rebuild_required" }
>;
export type RebuildFailedShellArtifact = Extract<
  StateReviewArtifact,
  { status: "rebuild_failed" }
>;
export type StateReviewShellArtifact =
  | RebuildRequiredShellArtifact
  | RebuildFailedShellArtifact;
export type ActiveStateReviewArtifact = Extract<
  StateReviewArtifact,
  { status: "active" | "stale" }
>;

// ---------------------------------------------------------------------------
// Resolved receipt: three frozen layers, stored separately
// ---------------------------------------------------------------------------

export const ResolvedReviewReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  reviewId: z.string().min(1),
  sourceChapter: z.number().int().min(1),
  effectiveChapter: z.number().int().min(1),
  proseRevision: z.string(),
  baseCanonRevision: z.string(),
  resultingCanonRevision: z.string(),
  /** Frozen layer 1: AI/user proposals, item-aligned. */
  proposals: z.array(ProposalChangeSchema),
  /** Frozen layer 2: human decisions. */
  decisions: z.array(HumanDecisionRecordSchema),
  /** Frozen layer 3: resolved effective changes (resolver outputs), item-aligned. */
  effectiveChanges: z.array(ProposalChangeSchema),
  /**
   * OPTIONAL audit-only provider payload. NOTHING semantic may read this —
   * the compiler consumes only the three typed layers above.
   */
  rawProviderDelta: z.unknown().optional(),
  resolvedAt: z.string().datetime(),
  resolution: z.enum(["confirmed-no-changes", "confirmed-changes", "superseded"]),
  supersededBy: z.string().optional(),
});
export type ResolvedReviewReceipt = z.infer<typeof ResolvedReviewReceiptSchema>;

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

export const STATE_REVIEW_ERROR_CODES = [
  "state_review_not_found",
  "state_review_stale",
  "state_review_conflict",
  "state_review_edit_conflict",
  "state_review_incomplete",
  "state_review_invalid_change",
  "state_review_rebuild_failed",
  "state_review_already_resolved",
  "state_review_write_locked",
] as const;
export type StateReviewErrorCode = (typeof STATE_REVIEW_ERROR_CODES)[number];

export class StateReviewError extends Error {
  readonly code: StateReviewErrorCode;
  readonly itemId?: string;

  constructor(code: StateReviewErrorCode, message: string, itemId?: string) {
    super(message);
    this.name = "StateReviewError";
    this.code = code;
    this.itemId = itemId;
  }
}

// ---------------------------------------------------------------------------
// Stable ReviewItem IDs (deterministic within a generation; NOT reviewId)
// ---------------------------------------------------------------------------

/** 8-hex FNV-1a over UTF-8 bytes. Used ONLY for ReviewItem identity. */
export function fnv1a8(input: string): string {
  let hash = 0x811c9dc5;
  const bytes = Buffer.from(input, "utf-8");
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Deterministic ReviewItem id: identical kind/index/payload => identical id.
 * Array position alone is never identity — the payload hash participates.
 * Distinct concept from the per-generation `reviewId` uuid.
 */
export function stateReviewItemId(kind: string, opIndex: number, payload: unknown): string {
  return `${kind}:${opIndex}:${fnv1a8(JSON.stringify(payload))}`;
}
