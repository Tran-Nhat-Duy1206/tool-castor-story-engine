/**
 * Structural AI-tell detection — pure rule-based analysis (no LLM).
 *
 * Detects patterns common in AI-generated Vietnamese and English prose:
 * - dim 20: Paragraph length uniformity (low variance)
 * - dim 21: Filler/hedge word density
 * - dim 22: Formulaic transition patterns
 * - dim 23: List-like structure (consecutive same-prefix sentences)
 */

export interface AITellIssue {
  readonly severity: "warning" | "info";
  readonly category: string;
  readonly description: string;
  readonly suggestion: string;
}

export interface AITellResult {
  readonly issues: ReadonlyArray<AITellIssue>;
}

type AITellLanguage = "vi" | "en";

const HEDGE_WORDS: Record<AITellLanguage, ReadonlyArray<string>> = {
  vi: ["có vẻ", "có lẽ", "có thể", "dường như", "ở một mức độ nào đó", "ở một khía cạnh nào đó", "theo một nghĩa nào đó"],
  en: ["seems", "seemed", "perhaps", "maybe", "apparently", "in some ways", "to some extent"],
};

const TRANSITION_WORDS: Record<AITellLanguage, ReadonlyArray<string>> = {
  vi: ["tuy nhiên", "thế nhưng", "trong khi đó", "mặt khác", "dù vậy", "dù thế", "nhưng đáng chú ý là"],
  en: ["however", "meanwhile", "on the other hand", "nevertheless", "even so", "still"],
};

/**
 * Analyze text content for structural AI-tell patterns.
 * Returns issues that can be merged into audit results.
 */
export function analyzeAITells(content: string, language: AITellLanguage = "vi"): AITellResult {
  const issues: AITellIssue[] = [];
  const joiner = ", ";

  const paragraphs = content
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  // dim 20: Paragraph length uniformity (needs ≥3 paragraphs)
  if (paragraphs.length >= 3) {
    const paragraphLengths = paragraphs.map((p) => p.length);
    const mean = paragraphLengths.reduce((a, b) => a + b, 0) / paragraphLengths.length;
    if (mean > 0) {
      const variance = paragraphLengths.reduce((sum, l) => sum + (l - mean) ** 2, 0) / paragraphLengths.length;
      const stdDev = Math.sqrt(variance);
      const cv = stdDev / mean;
      if (cv < 0.15) {
        issues.push({
          severity: "warning",
          category: "Paragraph uniformity",
          description: `Paragraph-length coefficient of variation is only ${cv.toFixed(3)} (threshold <0.15), which suggests unnaturally uniform paragraph sizing`,
          suggestion: "Increase paragraph-length contrast: use shorter beats for impact and longer blocks for immersive detail",
        });
      }
    }
  }

  // dim 21: Hedge word density
  const totalWords = countWords(content);
  if (totalWords > 0) {
    let hedgeCount = 0;
    for (const word of HEDGE_WORDS[language]) {
      const regex = new RegExp(escapeRegExp(word), "giu");
      const matches = content.match(regex);
      hedgeCount += matches?.length ?? 0;
    }
    const hedgeDensity = hedgeCount / (totalWords / 1000);
    if (hedgeDensity > 3) {
      issues.push({
        severity: "warning",
        category: "Hedge density",
        description: `Hedge-word density is ${hedgeDensity.toFixed(1)} per 1k words (threshold >3), making the prose sound overly tentative`,
        suggestion: "Replace hedges with firmer narration: remove vague qualifiers and use concrete detail instead",
      });
    }
  }

  // dim 22: Formulaic transition repetition
  const transitionCounts: Record<string, number> = {};
  for (const word of TRANSITION_WORDS[language]) {
    const regex = new RegExp(escapeRegExp(word), "giu");
    const matches = content.match(regex);
    const count = matches?.length ?? 0;
    if (count > 0) {
      transitionCounts[word.toLocaleLowerCase(language)] = count;
    }
  }
  const repeatedTransitions = Object.entries(transitionCounts)
    .filter(([, count]) => count >= 3);
  if (repeatedTransitions.length > 0) {
    const detail = repeatedTransitions
      .map(([word, count]) => `"${word}"×${count}`)
      .join(joiner);
    issues.push({
      severity: "warning",
      category: "Formulaic transitions",
      description: `Transition words repeat too often: ${detail}. Reusing the same transition pattern 3+ times creates a formulaic AI texture`,
      suggestion: "Let scenes pivot through action, timing, or viewpoint shifts instead of repeating the same transitions",
    });
  }

  // dim 23: List-like structure (consecutive sentences with same prefix pattern)
  const sentences = content
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);

  if (sentences.length >= 3) {
    let consecutiveSamePrefix = 1;
    let maxConsecutive = 1;
    for (let i = 1; i < sentences.length; i++) {
      const prevPrefix = sentences[i - 1]!.split(/\s+/u)[0]?.toLocaleLowerCase(language) ?? "";
      const currPrefix = sentences[i]!.split(/\s+/u)[0]?.toLocaleLowerCase(language) ?? "";
      if (prevPrefix === currPrefix) {
        consecutiveSamePrefix++;
        maxConsecutive = Math.max(maxConsecutive, consecutiveSamePrefix);
      } else {
        consecutiveSamePrefix = 1;
      }
    }
    if (maxConsecutive >= 3) {
      issues.push({
        severity: "info",
        category: "List-like structure",
        description: `Detected ${maxConsecutive} consecutive sentences with the same opening pattern, creating a list-like generated cadence`,
        suggestion: "Vary how sentences open: change subject, timing, or action entry to break the list effect",
      });
    }
  }

  return { issues };
}

function countWords(content: string): number {
  return content.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
