// Style fingerprint analysis for Vietnamese and English prose (no LLM).

import type { StyleProfile } from "../models/style-profile.js";

const VI_RHETORICAL_PATTERNS: ReadonlyArray<{ readonly name: string; readonly regex: RegExp }> = [
  { name: "so sánh", regex: /\b(?:như|tựa như|giống như|dường như)\b/giu },
  { name: "câu hỏi tu từ", regex: /\b(?:làm sao|tại sao|chẳng lẽ|há chẳng)\b[^.!?]*\?/giu },
  { name: "nhịp câu ngắn", regex: /[.!?]\s+[\p{Lu}][^.!?]{1,40}[.!?]/gu },
];

const EN_RHETORICAL_PATTERNS: ReadonlyArray<{ readonly name: string; readonly regex: RegExp }> = [
  { name: "simile (like/as if)", regex: /\b(?:like a|like an|as if|as though)\b/gi },
  { name: "rhetorical question", regex: /\b(?:how could|why would|what if|wasn't it|isn't it|could it be)\b[^.!?]*\?/gi },
  { name: "tricolon", regex: /\b\w+,\s+\w+,\s+and\s+\w+\b/gi },
  { name: "short punchy rhythm", regex: /[.!?]\s+[A-Z][^.!?]{1,24}[.!?]/g },
];

export function analyzeStyle(
  text: string,
  sourceName?: string,
  language: "vi" | "en" = "vi",
): StyleProfile {
  const locale = language === "vi" ? "vi" : "en";
  const sentences = text.split(/[.!?\n]+/u).map((value) => value.trim()).filter(Boolean);
  const paragraphs = text.split(/\n\s*\n/u).map((value) => value.trim()).filter(Boolean);
  const measure = (value: string): number => tokenize(value, locale).length;

  const sentenceLengths = sentences.map(measure);
  const avgSentenceLength = average(sentenceLengths);
  const sentenceLengthStdDev = sentenceLengths.length > 1
    ? Math.sqrt(sentenceLengths.reduce((sum, length) => sum + (length - avgSentenceLength) ** 2, 0) / sentenceLengths.length)
    : 0;

  const paragraphLengths = paragraphs.map(measure);
  const avgParagraphLength = average(paragraphLengths);
  const minParagraph = paragraphLengths.length > 0 ? Math.min(...paragraphLengths) : 0;
  const maxParagraph = paragraphLengths.length > 0 ? Math.max(...paragraphLengths) : 0;

  const words = tokenize(text, locale).map((word) => word.toLocaleLowerCase(locale));
  const vocabularyDiversity = words.length > 0 ? new Set(words).size / words.length : 0;

  const openingCounts: Record<string, number> = {};
  for (const sentence of sentences) {
    const key = tokenize(sentence, locale)[0]?.toLocaleLowerCase(locale) ?? "";
    if (key) openingCounts[key] = (openingCounts[key] ?? 0) + 1;
  }
  const topPatterns = Object.entries(openingCounts)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .filter(([, count]) => count >= 3)
    .map(([pattern, count]) => `${pattern}… (${count})`);

  const rhetoricalFeatures: string[] = [];
  for (const { name, regex } of language === "en" ? EN_RHETORICAL_PATTERNS : VI_RHETORICAL_PATTERNS) {
    const count = text.match(regex)?.length ?? 0;
    if (count >= 2) rhetoricalFeatures.push(`${name} (${count})`);
  }

  return {
    avgSentenceLength: Math.round(avgSentenceLength * 10) / 10,
    sentenceLengthStdDev: Math.round(sentenceLengthStdDev * 10) / 10,
    avgParagraphLength: Math.round(avgParagraphLength),
    paragraphLengthRange: { min: minParagraph, max: maxParagraph },
    vocabularyDiversity: Math.round(vocabularyDiversity * 1000) / 1000,
    topPatterns,
    rhetoricalFeatures,
    sourceName,
    analyzedAt: new Date().toISOString(),
  };
}

function tokenize(text: string, locale: "vi" | "en"): string[] {
  return text.toLocaleLowerCase(locale).match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
}

function average(values: ReadonlyArray<number>): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
