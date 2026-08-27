import { z } from "zod";
import {
  type BeatRef,
  BeatRefSchema,
} from "./arc-plan.js";

export {
  type BeatRef,
  BeatRefSchema,
};
import { readCurrentCanonRevision } from "../governance/conflicts.js";

// ===========================================================================
// Phase 5 Task 12 — Major Beat Model & Canon Evidence Evaluation
//
// Major Beats represent the structural narrative beats of an Arc Plan.
//
// INVARIANT: Beat progress comes from CANON EVIDENCE, never from Planning's
// own prediction. Planner predictions cannot mark a beat satisfied.
//
// INVARIANT: REQUIRED Beats cannot be silently superseded.
//
// INVARIANT: Semantic uncertainty mid-Arc keeps the beat `in_progress`.
// ===========================================================================

export const BeatEvidenceResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("satisfied"),
    evidence: z.string().min(1),
    verifiedAtCanonRevision: z.number().int().min(0),
  }).strict(),
  z.object({
    status: z.literal("in_progress"),
    reason: z.string().min(1),
  }).strict(),
  z.object({
    status: z.literal("blocked"),
    reason: z.string().min(1),
  }).strict(),
  z.object({
    status: z.literal("superseded"),
    reason: z.string().min(1),
    supersededBy: z.string().optional(),
  }).strict(),
]);

export type BeatEvidenceResult = z.infer<typeof BeatEvidenceResultSchema>;

export const BeatEvaluationEvidenceSchema = z.object({
  canonRevision: z.number().int().min(0),
  source: z.enum(["canon_evidence", "planner_prediction"]),
  evidenceConfidence: z.enum(["certain", "uncertain"]),
  matchingFacts: z.array(z.string()).optional(),
  matchingEvents: z.array(z.string()).optional(),
  action: z.enum(["evaluate", "supersede"]).optional(),
  supersededReason: z.string().optional(),
  supersededBy: z.string().optional(),
}).strict();

export type BeatEvaluationEvidence = z.infer<typeof BeatEvaluationEvidenceSchema>;

export function evaluateBeatState(
  beat: BeatRef,
  evidence: BeatEvaluationEvidence,
): BeatEvidenceResult {
  const validBeat = BeatRefSchema.parse(beat);
  const validEvidence = BeatEvaluationEvidenceSchema.parse(evidence);

  if (validEvidence.action === "supersede") {
    if (validBeat.importance === "required") {
      throw new Error(
        `REQUIRED Beat "${validBeat.beatId}" cannot be silently superseded: required beats cannot be superseded without an explicit architectural decision.`,
      );
    }
    return {
      status: "superseded",
      reason: validEvidence.supersededReason ?? "Optional beat superseded by narrative development",
      ...(validEvidence.supersededBy ? { supersededBy: validEvidence.supersededBy } : {}),
    };
  }

  // Planner prediction alone CANNOT advance or satisfy a beat
  if (validEvidence.source === "planner_prediction") {
    return {
      status: "in_progress",
      reason: "planner_prediction_cannot_satisfy_beat: actual Canon evidence is required to advance a beat.",
    };
  }

  // Mid-arc semantic uncertainty must remain in_progress
  if (validEvidence.evidenceConfidence === "uncertain") {
    return {
      status: "in_progress",
      reason: "semantic_uncertainty_in_progress: Canon evidence is semantically ambiguous; beat stays in_progress.",
    };
  }

  const matchingText = [
    ...(validEvidence.matchingFacts ?? []),
    ...(validEvidence.matchingEvents ?? []),
  ].join("; ");

  if (matchingText.trim().length > 0) {
    return {
      status: "satisfied",
      evidence: matchingText,
      verifiedAtCanonRevision: validEvidence.canonRevision,
    };
  }

  return {
    status: "in_progress",
    reason: "no_matching_evidence_found: beat has not yet been observed in Canon.",
  };
}

export async function evaluateBeatFromCanon(
  bookDir: string,
  beat: BeatRef,
  evidence?: Partial<BeatEvaluationEvidence>,
): Promise<BeatEvidenceResult> {
  const currentCanonRev = await readCurrentCanonRevision(bookDir).catch(() => 0);
  const fullEvidence: BeatEvaluationEvidence = {
    canonRevision: evidence?.canonRevision ?? currentCanonRev,
    source: evidence?.source ?? "canon_evidence",
    evidenceConfidence: evidence?.evidenceConfidence ?? "certain",
    matchingFacts: evidence?.matchingFacts,
    matchingEvents: evidence?.matchingEvents,
    action: evidence?.action ?? "evaluate",
    supersededReason: evidence?.supersededReason,
    supersededBy: evidence?.supersededBy,
  };

  return evaluateBeatState(beat, fullEvidence);
}
