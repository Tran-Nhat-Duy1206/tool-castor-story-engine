import type { FanficMode } from "../models/book.js";

export interface FanficDimensionConfig {
  readonly activeIds: ReadonlyArray<number>;
  readonly severityOverrides: ReadonlyMap<number, "critical" | "warning" | "info">;
  readonly deactivatedIds: ReadonlyArray<number>;
  readonly notes: ReadonlyMap<number, string>;
}

// Fanfic-specific audit dimensions (34-37)
export const FANFIC_DIMENSIONS: ReadonlyArray<{
  readonly id: number;
  readonly name: string;
  readonly baseNote: string;
}> = [
  {
    id: 34,
    name: "Character fidelity",
    baseNote: "Check if character catchphrases, speaking style, and behavioral patterns match fanfic_canon.md character profiles. Deviations must be situationally motivated.",
  },
  {
    id: 35,
    name: "World rules compliance",
    baseNote: "Check if chapter content violates world rules in fanfic_canon.md (geography, power systems, faction relations).",
  },
  {
    id: 36,
    name: "Relationship dynamics",
    baseNote: "Check if character interactions are plausible and align with key relationships in fanfic_canon.md.",
  },
  {
    id: 37,
    name: "Canon event consistency",
    baseNote: "Check if chapter contradicts key event timeline in fanfic_canon.md.",
  },
];

// Mode → dimension severity mapping
const SEVERITY_MAP: Record<FanficMode, Record<number, "critical" | "warning" | "info">> = {
  canon: { 34: "critical", 35: "critical", 36: "warning", 37: "critical" },
  au:    { 34: "critical", 35: "info",     36: "warning", 37: "info" },
  ooc:   { 34: "info",     35: "warning",  36: "warning", 37: "info" },
  cp:    { 34: "warning",  35: "warning",  36: "critical", 37: "info" },
};

// Spinoff dims (28-31) are deactivated in fanfic mode — they're for same-author spinoffs
const SPINOFF_DIMS = [28, 29, 30, 31];

// OOC mode relaxes the built-in OOC check (dim 1)
const OOC_DIM = 1;

export function getFanficDimensionConfig(
  mode: FanficMode,
  _allowedDeviations: ReadonlyArray<string> = [],
): FanficDimensionConfig {
  const severityMap = SEVERITY_MAP[mode];
  const severityOverrides = new Map<number, "critical" | "warning" | "info">();
  const notes = new Map<number, string>();

  for (const dim of FANFIC_DIMENSIONS) {
    severityOverrides.set(dim.id, severityMap[dim.id]!);

    const severity = severityMap[dim.id]!;
    const severityLabel = severity === "critical" ? "(Strict check)"
      : severity === "info" ? "(Record only, non-blocking)"
      : "(Warning level)";
    notes.set(dim.id, `${dim.baseNote} ${severityLabel}`);
  }

  // OOC mode relaxes the built-in OOC check
  if (mode === "ooc") {
    severityOverrides.set(OOC_DIM, "info");
    notes.set(OOC_DIM, "Under OOC mode characters may deviate from core personality; this dimension records without failing. Evaluate deviation against fanfic_canon.md.");
  }

  // Canon mode strengthens the built-in OOC check
  if (mode === "canon") {
    notes.set(OOC_DIM, "Canon fanfiction: characters must strictly adhere to core persona and behaviors in fanfic_canon.md.");
  }

  return {
    activeIds: FANFIC_DIMENSIONS.map((d) => d.id),
    severityOverrides,
    deactivatedIds: SPINOFF_DIMS,
    notes,
  };
}
