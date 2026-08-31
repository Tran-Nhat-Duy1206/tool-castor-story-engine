import type { GenreProfile } from "../models/genre-profile.js";

export interface SettlementOutput {
  readonly postSettlement: string;
  readonly updatedState: string;
  readonly updatedLedger: string;
  readonly updatedHooks: string;
  readonly chapterSummary: string;
  readonly updatedSubplots: string;
  readonly updatedEmotionalArcs: string;
  readonly updatedCharacterMatrix: string;
}

export function parseSettlementOutput(
  content: string,
  genreProfile: GenreProfile,
): SettlementOutput {
  const extract = (tag: string): string => {
    const regex = new RegExp(
      `=== ${tag} ===\\s*([\\s\\S]*?)(?==== [A-Z_]+ ===|$)`,
    );
    const match = content.match(regex);
    return match?.[1]?.trim() ?? "";
  };

  return {
    postSettlement: extract("POST_SETTLEMENT"),
    updatedState: extract("UPDATED_STATE") || "(state card not updated)",
    updatedLedger: genreProfile.numericalSystem
      ? (extract("UPDATED_LEDGER") || "(ledger not updated)")
      : "",
    updatedHooks: extract("UPDATED_HOOKS") || "(hook pool not updated)",
    chapterSummary: extract("CHAPTER_SUMMARY"),
    updatedSubplots: extract("UPDATED_SUBPLOTS"),
    updatedEmotionalArcs: extract("UPDATED_EMOTIONAL_ARCS"),
    updatedCharacterMatrix: extract("UPDATED_CHARACTER_MATRIX"),
  };
}
