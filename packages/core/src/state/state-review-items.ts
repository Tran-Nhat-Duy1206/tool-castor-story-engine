import type {
  ChapterSummaryRow,
  CurrentStatePatch,
  HookRecord,
  NewHookCandidate,
  RuntimeStateDelta,
  RuntimeStateLanguage,
} from "../models/runtime-state.js";
import {
  stateReviewItemId,
  type ProposalChange,
  type ReviewEvidence,
  type ReviewItem,
} from "../models/state-review.js";
import { evidenceQuoteVerified } from "../utils/prose-revision.js";
import {
  CURRENT_STATE_SLOT_DEFS,
  describeCurrentStateSlot,
} from "./state-projections.js";

/**
 * Task 4 — PURE RuntimeStateDelta → State Review items converter (Phase 4).
 *
 * This module DESCRIBES what the existing reducer would apply; it never
 * applies anything. No filesystem, no persistence, no Canon access, no book
 * lock, no snapshot writes, and no second state engine: the reducer's
 * application entry point remains the ONLY application path (consumed later
 * by the confirmation flow).
 */

/** Exact bound prose + book language for deterministic evidence verification. */
export interface BuildReviewItemsContext {
  readonly chapterContent: string;
  readonly language: RuntimeStateLanguage;
}

const QUOTE_MAX_LENGTH = 200;

// ---------------------------------------------------------------------------
// Deterministic evidence assignment (Task 2 verifier ONLY — no fuzzy search)
// ---------------------------------------------------------------------------

/**
 * Core owns both claim and verification at capture time (the Settler delta
 * carries no provider evidence claim), so claimedLevel mirrors verifiedLevel:
 * a deterministic normalized-substring hit is explicit with the bounded
 * semantic text as its quote; everything else stays honestly inferred with NO
 * fabricated quote. Empty/whitespace-only semantic text carries no evidence.
 */
function assignEvidence(semanticText: string | undefined, prose: string): ReviewEvidence | undefined {
  if (!semanticText || semanticText.trim().length === 0) return undefined;
  if (!evidenceQuoteVerified(semanticText, prose)) {
    return { claimedLevel: "inferred", verifiedLevel: "inferred" };
  }
  return {
    claimedLevel: "explicit",
    verifiedLevel: "explicit",
    quote: semanticText.slice(0, QUOTE_MAX_LENGTH),
  };
}

function hookEvidenceText(record: Pick<HookRecord, "expectedPayoff" | "notes">): string {
  return [record.expectedPayoff, record.notes]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(" ");
}

// ---------------------------------------------------------------------------
// Converter
// ---------------------------------------------------------------------------

export function buildStateReviewItems(
  delta: RuntimeStateDelta,
  ctx: BuildReviewItemsContext,
): ReviewItem[] {
  const items: ReviewItem[] = [];

  // ---- current-state facts: one item per PRESENT slot in canonical order ----
  let factIndex = 0;
  for (const def of CURRENT_STATE_SLOT_DEFS) {
    const value = delta.currentStatePatch?.[def.key as keyof CurrentStatePatch];
    if (value === undefined) continue;
    const described = describeCurrentStateSlot(def.key, ctx.language);
    const change: ProposalChange = {
      type: "fact",
      change: { action: "set", subject: described.subject, predicate: described.predicate, object: value },
    };
    items.push({
      id: stateReviewItemId("current-state-fact", factIndex, change.change),
      kind: "current-state-fact",
      origin: "ai",
      title: `Current-state update: ${described.predicate}`,
      detail: value,
      proposal: change,
      evidence: assignEvidence(value, ctx.chapterContent),
      decision: "undecided",
    });
    factIndex += 1;
  }

  // ---- hook operations over the REAL HookOps vocabulary ----
  let upsertIndex = 0;
  for (const hook of delta.hookOps.upsert as HookRecord[]) {
    const proposal: ProposalChange = { type: "hook-upsert", hook };
    items.push({
      id: stateReviewItemId("hook-upsert", upsertIndex, proposal),
      kind: "hook-upsert",
      origin: "ai",
      title: `Hook upsert: ${hook.hookId}`,
      detail: `${hook.type} / ${hook.status}`,
      proposal,
      evidence: assignEvidence(hookEvidenceText(hook), ctx.chapterContent),
      decision: "undecided",
    });
    upsertIndex += 1;
  }

  const hookOpKinds = [
    ["mention", "hook-mention"],
    ["resolve", "hook-resolve"],
    ["defer", "hook-defer"],
  ] as const;
  for (const [opField, reviewKind] of hookOpKinds) {
    let opIndex = 0;
    for (const hookId of delta.hookOps[opField]) {
      const proposal: ProposalChange = { type: "hook-op", op: opField, hookId };
      items.push({
        // Payload-sensitive id: identical hookIds still hash their op+id pair.
        id: stateReviewItemId(reviewKind, opIndex, proposal),
        kind: reviewKind,
        origin: "ai",
        title: `Hook ${opField}: ${hookId}`,
        proposal,
        decision: "undecided",
      });
      opIndex += 1;
    }
  }

  // ---- new-hook candidates: proposals only, never promotion ----
  let candidateIndex = 0;
  for (const candidate of delta.newHookCandidates as NewHookCandidate[]) {
    const proposal: ProposalChange = { type: "new-hook-candidate", candidate };
    items.push({
      id: stateReviewItemId("new-hook-candidate", candidateIndex, proposal),
      kind: "new-hook-candidate",
      origin: "ai",
      title: `New hook candidate: ${candidate.type}`,
      detail: candidate.notes,
      proposal,
      evidence: assignEvidence(hookEvidenceText(candidate), ctx.chapterContent),
      decision: "undecided",
    });
    candidateIndex += 1;
  }

  // ---- chapter summary over the real ChapterSummaryRow ----
  if (delta.chapterSummary) {
    const row = delta.chapterSummary as ChapterSummaryRow;
    const proposal: ProposalChange = { type: "chapter-summary", row };
    items.push({
      id: stateReviewItemId("chapter-summary", 0, proposal),
      kind: "chapter-summary",
      origin: "ai",
      title: `Chapter summary: ch ${row.chapter} ${row.title}`,
      detail: row.events,
      proposal,
      evidence: assignEvidence(row.events, ctx.chapterContent),
      decision: "undecided",
    });
  }

  // ---- unsupported loose remnants + free-form notes ⇒ ONE non-mutable note ----
  const unsupportedGroups = [
    ["subplotOps", delta.subplotOps],
    ["emotionalArcOps", delta.emotionalArcOps],
    ["characterMatrixOps", delta.characterMatrixOps],
  ] as const;
  const hasUnsupported = unsupportedGroups.some(([, ops]) => ops.length > 0);
  if (hasUnsupported || delta.notes.length > 0) {
    const sections: string[] = [];
    for (const [label, ops] of unsupportedGroups) {
      if (ops.length > 0) {
        sections.push(`${label}: ${ops.length} unsupported op(s) (not applied by V1 engine)`);
      }
    }
    for (const note of delta.notes) {
      sections.push(`note: ${note}`);
    }
    const payload = {
      subplotOps: delta.subplotOps,
      emotionalArcOps: delta.emotionalArcOps,
      characterMatrixOps: delta.characterMatrixOps,
      notes: delta.notes,
    };
    items.push({
      id: stateReviewItemId("note", 0, payload),
      kind: "note",
      origin: "ai",
      title: "Unsupported or informational delta content",
      detail: sections.join("\n"),
      proposal: { type: "none" },
      decision: "undecided",
    });
  }

  return items;
}
