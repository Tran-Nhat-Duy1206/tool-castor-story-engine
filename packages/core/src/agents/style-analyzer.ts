/**
 * Style fingerprint analysis — pure text analysis (no LLM).
 * Extracts statistical features from reference text to build a StyleProfile.
 */

import type { StyleProfile } from "../models/style-profile.js";

// Common rhetorical patterns in Chinese fiction
const RHETORICAL_PATTERNS: ReadonlyArray<{ readonly name: string; readonly regex: RegExp }> = [
  { name: "比喻(像/如/仿佛)", regex: /[像如仿佛似](?:是|同|一般|一样)/g },
  { name: "排比", regex: /[，。；]([^，。；]{2,6})[，。；]\1/g },
  { name: "反问", regex: /难道|怎么可能|岂不是|何尝不/g },
  { name: "夸张", regex: /天崩地裂|惊天动地|翻天覆地|震耳欲聋/g },
  { name: "拟人", regex: /[风雨雪月花树草石](?:在|像|仿佛).*?(?:笑|哭|叹|呻|吟|怒|舞)/g },
  { name: "短句节奏", regex: /[。！？][^。！？]{1,8}[。！？]/g },
];

// Common rhetorical patterns in English fiction
const EN_RHETORICAL_PATTERNS: ReadonlyArray<{ readonly name: string; readonly regex: RegExp }> = [
  { name: "simile (like/as if)", regex: /\b(?:like a|like an|as if|as though)\b/gi },
  { name: "rhetorical question", regex: /\b(?:how could|why would|what if|wasn't it|isn't it|could it be)\b[^.!?]*\?/gi },
  { name: "tricolon", regex: /\b\w+,\s+\w+,\s+and\s+\w+\b/gi },
  { name: "short punchy rhythm", regex: /[.!?]\s+[A-Z][^.!?]{1,24}[.!?]/g },
];

/**
 * Analyze a reference text and extract its style profile.
 * The returned profile can be serialized to style_profile.json.
 */
export function analyzeStyle(
  text: string,
  sourceName?: string,
  language: "vi" | "en" = "vi",
): StyleProfile {
  const isEn = language === "en";

  const sentences = text
    .split(isEn ? /[.!?\n]+/ : /[。！？\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  // Measure length in the language's native unit: words for English, characters for Chinese.
  const measure = (s: string): number =>
    isEn ? (s.match(/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?/g)?.length ?? 0) : s.replace(/\s+/g, "").length;

  // Sentence length stats
  const sentenceLengths = sentences.map(measure);
  const avgSentenceLength = sentenceLengths.length > 0
    ? sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length
    : 0;
  const sentenceLengthStdDev = sentenceLengths.length > 1
    ? Math.sqrt(
        sentenceLengths.reduce((sum, l) => sum + (l - avgSentenceLength) ** 2, 0) /
          sentenceLengths.length,
      )
    : 0;

  // Paragraph length stats
  const paragraphLengths = paragraphs.map(measure);
  const avgParagraphLength = paragraphLengths.length > 0
    ? paragraphLengths.reduce((a, b) => a + b, 0) / paragraphLengths.length
    : 0;
  const minParagraph = paragraphLengths.length > 0 ? Math.min(...paragraphLengths) : 0;
  const maxParagraph = paragraphLengths.length > 0 ? Math.max(...paragraphLengths) : 0;

  // Vocabulary diversity (TTR — Type-Token Ratio): word-level for English, character-level for Chinese.
  let vocabularyDiversity: number;
  if (isEn) {
    const words = text.toLowerCase().match(/[a-z0-9]+(?:'[a-z0-9]+)?/g) ?? [];
    vocabularyDiversity = words.length > 0 ? new Set(words).size / words.length : 0;
  } else {
    const chars = text.replace(/[\s\n\r，。！？、：；""''（）【】《》\d]/g, "");
    vocabularyDiversity = chars.length > 0 ? new Set(chars).size / chars.length : 0;
  }

  // Top sentence opening patterns: first word for English, first 2 chars for Chinese.
  const openingCounts: Record<string, number> = {};
  for (const s of sentences) {
    const key = isEn
      ? (s.match(/[A-Za-z']+/)?.[0]?.toLowerCase() ?? "")
      : (s.length >= 2 ? s.slice(0, 2) : "");
    if (key) openingCounts[key] = (openingCounts[key] ?? 0) + 1;
  }
  const topPatterns = Object.entries(openingCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .filter(([, count]) => count >= 3)
    .map(([pattern, count]) => (isEn ? `${pattern}… (${count})` : `${pattern}...(${count}次)`));

  // Rhetorical features
  const rhetoricalPatterns = isEn ? EN_RHETORICAL_PATTERNS : RHETORICAL_PATTERNS;
  const rhetoricalFeatures: string[] = [];
  for (const { name, regex } of rhetoricalPatterns) {
    const matches = text.match(regex);
    if (matches && matches.length >= 2) {
      rhetoricalFeatures.push(isEn ? `${name} (${matches.length})` : `${name}(${matches.length}处)`);
    }
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
