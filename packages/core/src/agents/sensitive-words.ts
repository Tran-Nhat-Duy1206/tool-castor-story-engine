// Sensitive-term detection for Vietnamese and English prose (no LLM).

import type { AuditIssue } from "./continuity.js";

export interface SensitiveWordMatch {
  readonly word: string;
  readonly count: number;
  readonly severity: "block" | "warn";
}

export interface SensitiveWordResult {
  readonly issues: ReadonlyArray<AuditIssue>;
  readonly found: ReadonlyArray<SensitiveWordMatch>;
}

type SensitiveWordLanguage = "vi" | "en";

interface WordListEntry {
  readonly words: ReadonlyArray<string>;
  readonly severity: "block" | "warn";
  readonly label: string;
}

const WORD_LISTS: Readonly<Record<SensitiveWordLanguage, ReadonlyArray<WordListEntry>>> = {
  vi: [
    {
      severity: "warn",
      label: "sexually explicit terms",
      words: ["quan hệ tình dục", "giao cấu", "khẩu giao", "thủ dâm", "dương vật", "âm đạo", "cưỡng hiếp", "hiếp dâm"],
    },
    {
      severity: "warn",
      label: "extreme violence terms",
      words: ["phanh thây", "chặt xác", "móc mắt", "lột da", "mổ bụng", "tra tấn đến chết"],
    },
  ],
  en: [
    {
      severity: "warn",
      label: "sexually explicit terms",
      words: ["sexual intercourse", "oral sex", "anal sex", "masturbation", "penis", "vagina", "rape", "gang rape"],
    },
    {
      severity: "warn",
      label: "extreme violence terms",
      words: ["dismemberment", "dismembered", "gouged eyes", "skinned alive", "disembowelment", "tortured to death"],
    },
  ],
};

export function analyzeSensitiveWords(
  content: string,
  customWords?: ReadonlyArray<string>,
  language: SensitiveWordLanguage = "vi",
): SensitiveWordResult {
  const found: SensitiveWordMatch[] = [];
  const issues: AuditIssue[] = [];

  for (const list of WORD_LISTS[language]) {
    const matches = scanWords(content, list.words, list.severity);
    if (matches.length === 0) continue;
    found.push(...matches);
    const wordSummary = matches.map((match) => `"${match.word}"×${match.count}`).join(", ");
    issues.push({
      severity: list.severity === "block" ? "critical" : "warning",
      category: "Sensitive terms",
      description: `Detected ${list.label}: ${wordSummary}`,
      suggestion: list.severity === "block"
        ? "Remove or replace these blocked terms before publication."
        : `Replace or soften these ${list.label} to reduce moderation risk.`,
    });
  }

  if (customWords && customWords.length > 0) {
    const customMatches = scanWords(content, customWords, "warn");
    if (customMatches.length > 0) {
      found.push(...customMatches);
      const wordSummary = customMatches.map((match) => `"${match.word}"×${match.count}`).join(", ");
      issues.push({
        severity: "warning",
        category: "Sensitive terms",
        description: `Detected custom sensitive term(s): ${wordSummary}`,
        suggestion: "Replace or remove these terms according to project rules.",
      });
    }
  }

  return { issues, found };
}

function scanWords(
  content: string,
  words: ReadonlyArray<string>,
  severity: "block" | "warn",
): ReadonlyArray<SensitiveWordMatch> {
  const matches: SensitiveWordMatch[] = [];
  for (const word of words) {
    const regex = new RegExp(escapeRegExp(word), "giu");
    const hits = content.match(regex);
    if (hits?.length) matches.push({ word, count: hits.length, severity });
  }
  return matches;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
