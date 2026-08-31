import { analyzeChapterCadence } from "../utils/chapter-cadence.js";
import type { BookRules } from "../models/book-rules.js";
import type { GenreProfile } from "../models/genre-profile.js";

export interface PostWriteViolation {
  readonly rule: string;
  readonly severity: "error" | "warning";
  readonly description: string;
  readonly suggestion: string;
}

type SupportedLanguage = "vi" | "en";

interface ParagraphShape {
  readonly paragraphs: ReadonlyArray<string>;
  readonly shortThreshold: number;
  readonly shortParagraphs: ReadonlyArray<string>;
  readonly shortRatio: number;
  readonly averageLength: number;
  readonly maxConsecutiveShort: number;
}

const ENGLISH_AI_TELL_WORDS = [
  "delve", "tapestry", "testament", "intricate", "pivotal", "vibrant", "embark", "comprehensive", "nuanced",
];

const TITLE_STOP_WORDS = new Set([
  "and", "the", "but", "when", "while", "after", "before", "then", "they",
  "các", "của", "cho", "đang", "được", "không", "một", "những", "trong", "và", "với",
]);

export function normalizePostWriteSurface(
  content: string,
  _languageOverride?: SupportedLanguage,
): string {
  return content
    .split(/\r?\n/)
    .filter((line) => !/^\s*\[(?:polisher|writer|reviser|reviewer)-note\]\s*/i.test(line))
    .join("\n")
    .replace(/——+/g, "—")
    .trimEnd();
}

export function validatePostWrite(
  content: string,
  genreProfile: GenreProfile,
  bookRules: BookRules | null,
  languageOverride?: SupportedLanguage,
): ReadonlyArray<PostWriteViolation> {
  const language = languageOverride ?? genreProfile.language;
  const violations: PostWriteViolation[] = [];

  if (language === "en") {
    for (const word of ENGLISH_AI_TELL_WORDS) {
      const count = countWholeWords(content, word);
      if (count > Math.ceil(wordCount(content) / 500)) {
        violations.push({
          rule: "ai-tell-word-density",
          severity: "warning",
          description: `The word "${word}" appears ${count} times, above the density limit.`,
          suggestion: "Replace repeated AI-associated wording with specific, concrete language.",
        });
      }
    }
  }

  const chapterRefs = content.match(language === "vi" ? /\bChương\s+\d+\b/giu : /\bchapter\s+\d+\b/giu);
  if (chapterRefs?.length) {
    violations.push({
      rule: "chapter-number-reference",
      severity: "error",
      description: `Chapter text contains explicit chapter number references: ${[...new Set(chapterRefs)].map((item) => `"${item}"`).join(", ")}.`,
      suggestion: "Replace chapter numbers with natural references to events, places, or times.",
    });
  }

  const paragraphs = extractParagraphs(content);
  const longThreshold = language === "vi" ? 180 : 220;
  const longParagraphs = paragraphs.filter((paragraph) => wordCount(paragraph) > longThreshold);
  if (longParagraphs.length >= 2) {
    violations.push({
      rule: "paragraph-length",
      severity: "warning",
      description: `${longParagraphs.length} paragraphs exceed ${longThreshold} words.`,
      suggestion: "Split long paragraphs at an action, observation, or emotional turn.",
    });
  }
  violations.push(...detectParagraphShapeWarnings(content, language));

  const quotedLines = content.match(/["“][^"”]+["”]/gu) ?? [];
  const names = [...new Set(content.match(/\b\p{Lu}\p{Ll}{2,}\b/gu) ?? [])]
    .filter((name) => !TITLE_STOP_WORDS.has(name.toLocaleLowerCase(language)));
  if (names.length >= 2 && quotedLines.length < 2 && wordCount(content) >= 25) {
    violations.push({
      rule: "dialogue-pressure",
      severity: "warning",
      description: `A multi-character scene appears to contain almost no direct exchange (${names.slice(0, 3).join(", ")}).`,
      suggestion: "Add an exchange in which characters resist, withhold, or pressure each other directly.",
    });
  }

  const fatigueWords = bookRules?.fatigueWordsOverride?.length
    ? bookRules.fatigueWordsOverride
    : genreProfile.fatigueWords;
  for (const word of fatigueWords) {
    const count = countWholeWords(content, word);
    if (count > 1) {
      violations.push({
        rule: "fatigue-word",
        severity: "warning",
        description: `The fatigue term "${word}" appears ${count} times (maximum 1 per chapter).`,
        suggestion: "Vary the vocabulary or remove redundant occurrences.",
      });
    }
  }

  for (const prohibition of bookRules?.prohibitions ?? []) {
    if (wordCount(prohibition) > 0 && wordCount(prohibition) <= 12 && includesFolded(content, prohibition, language)) {
      violations.push({
        rule: "book-prohibition",
        severity: "error",
        description: `Found prohibited content: "${prohibition}".`,
        suggestion: "Remove or rewrite the prohibited content.",
      });
    }
  }

  const personViolation = detectNarrativePersonDrift(content, bookRules, language);
  if (personViolation) violations.push(personViolation);
  return violations;
}

function detectNarrativePersonDrift(
  content: string,
  bookRules: BookRules | null,
  language: SupportedLanguage,
): PostWriteViolation | null {
  if (bookRules?.narrativePerson !== "first") return null;
  const name = bookRules.protagonist?.name?.trim();
  if (!name || wordCount(content) < 150) return null;
  const pronoun = language === "vi" ? "tôi" : "I";
  const pronounCount = countWholeWords(content, pronoun);
  const nameCount = countWholeWords(content, name);
  if (pronounCount >= 6 || nameCount < 6 || nameCount <= pronounCount) return null;
  return {
    rule: "narrative-person",
    severity: "error",
    description: `The book is first person, but the chapter uses "${pronoun}" only ${pronounCount} times and names ${name} ${nameCount} times.`,
    suggestion: "Rewrite the narration from the protagonist's first-person viewpoint.",
  };
}

export function detectCrossChapterRepetition(
  currentContent: string,
  recentChaptersContent: string,
  language: SupportedLanguage = "vi",
): ReadonlyArray<PostWriteViolation> {
  if (wordCount(recentChaptersContent) < 20) return [];
  const words = tokenize(currentContent, language).filter((word) => word.length > 2);
  const recent = ` ${tokenize(recentChaptersContent, language).join(" ")} `;
  const counts = new Map<string, number>();
  for (let index = 0; index < words.length - 2; index++) {
    const phrase = words.slice(index, index + 3).join(" ");
    counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  }
  const repeats = [...counts].filter(([phrase, count]) => count >= 2 && recent.includes(` ${phrase} `));
  if (repeats.length < 3) return [];
  return [{
    rule: "cross-chapter-repetition",
    severity: "warning",
    description: `${repeats.length} repeated three-word phrases also occur in recent chapters: ${repeats.slice(0, 5).map(([phrase, count]) => `"${phrase}" (×${count})`).join(", ")}.`,
    suggestion: "Vary action verbs and descriptive phrases across chapters.",
  }];
}

export function detectParagraphLengthDrift(
  currentContent: string,
  recentChaptersContent: string,
  language: SupportedLanguage = "vi",
): ReadonlyArray<PostWriteViolation> {
  if (!recentChaptersContent.trim()) return [];
  const current = analyzeParagraphShape(currentContent, language);
  const recent = analyzeParagraphShape(recentChaptersContent, language);
  if (current.paragraphs.length < 4 || recent.paragraphs.length < 4 || recent.averageLength <= 0) return [];
  const shrinkRatio = current.averageLength / recent.averageLength;
  if (shrinkRatio >= 0.6 || current.shortRatio < 0.5 || current.shortRatio - recent.shortRatio < 0.25) return [];
  return [{
    rule: "paragraph-density-drift",
    severity: "warning",
    description: `Average paragraph length dropped from ${Math.round(recent.averageLength)} to ${Math.round(current.averageLength)} words (${Math.round((1 - shrinkRatio) * 100)}% shorter).`,
    suggestion: "Combine connected action, observation, and reaction beats into fuller paragraphs.",
  }];
}

export function detectParagraphShapeWarnings(
  content: string,
  language: SupportedLanguage = "vi",
): ReadonlyArray<PostWriteViolation> {
  const shape = analyzeParagraphShape(content, language);
  if (shape.paragraphs.length < 4) return [];
  const violations: PostWriteViolation[] = [];
  if (shape.shortParagraphs.length >= 4 && shape.shortRatio >= 0.6) {
    violations.push({
      rule: "paragraph-fragmentation",
      severity: "warning",
      description: `${shape.shortParagraphs.length} of ${shape.paragraphs.length} narrative paragraphs are shorter than ${shape.shortThreshold} words.`,
      suggestion: "Merge adjacent action, observation, and reaction beats.",
    });
  }
  if (shape.maxConsecutiveShort >= 3) {
    violations.push({
      rule: "consecutive-short-paragraphs",
      severity: "warning",
      description: `${shape.maxConsecutiveShort} short narrative paragraphs appear back to back.`,
      suggestion: "Fold connected beats into fuller paragraphs.",
    });
  }
  return violations;
}

function analyzeParagraphShape(content: string, language: SupportedLanguage): ParagraphShape {
  const paragraphs = extractParagraphs(content);
  const narrative = paragraphs.filter((paragraph) => !isDialogueParagraph(paragraph));
  const shortThreshold = language === "vi" ? 8 : 20;
  const shortParagraphs = narrative.filter((paragraph) => wordCount(paragraph) < shortThreshold);
  let maxConsecutiveShort = 0;
  let run = 0;
  for (const paragraph of narrative) {
    run = wordCount(paragraph) < shortThreshold ? run + 1 : 0;
    maxConsecutiveShort = Math.max(maxConsecutiveShort, run);
  }
  return {
    paragraphs,
    shortThreshold,
    shortParagraphs,
    shortRatio: narrative.length ? shortParagraphs.length / narrative.length : 0,
    averageLength: paragraphs.length ? paragraphs.reduce((sum, paragraph) => sum + wordCount(paragraph), 0) / paragraphs.length : 0,
    maxConsecutiveShort,
  };
}

function extractParagraphs(content: string): string[] {
  return content.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean)
    .filter((paragraph) => paragraph !== "---" && !paragraph.startsWith("#"));
}

function isDialogueParagraph(paragraph: string): boolean {
  return /^["“'‘—–-]/u.test(paragraph.trim());
}

export function detectDuplicateTitle(
  newTitle: string,
  existingTitles: ReadonlyArray<string>,
): ReadonlyArray<PostWriteViolation> {
  const title = newTitle.trim();
  if (!title) return [];
  const normalized = normalizeTitle(title);
  for (const existing of existingTitles) {
    const existingNormalized = normalizeTitle(existing);
    if (!existingNormalized) continue;
    if (title.toLocaleLowerCase() === existing.trim().toLocaleLowerCase()) {
      return [{ rule: "duplicate-title", severity: "warning", description: `Chapter title "${title}" exactly matches an existing title.`, suggestion: "Choose a distinct chapter title." }];
    }
    if (normalized === existingNormalized) {
      return [{ rule: "near-duplicate-title", severity: "warning", description: `Chapter title "${title}" is too similar to "${existing}".`, suggestion: "Choose a more distinct chapter title." }];
    }
  }
  return [];
}

export function resolveDuplicateTitle(
  newTitle: string,
  existingTitles: ReadonlyArray<string>,
  language: SupportedLanguage = "vi",
  options?: { readonly content?: string },
): { readonly title: string; readonly issues: ReadonlyArray<PostWriteViolation> } {
  const title = newTitle.trim();
  if (!title) return { title: newTitle, issues: [] };
  const issues = detectDuplicateTitle(title, existingTitles);
  if (issues.length) {
    const qualifier = extractTitleQualifier(title, existingTitles, options?.content, language);
    if (qualifier) {
      const candidate = `${title}: ${qualifier}`;
      if (!detectDuplicateTitle(candidate, existingTitles).length) return { title: candidate, issues };
    }
    for (let counter = 2; counter < 100; counter++) {
      const candidate = `${title} (${counter})`;
      if (!detectDuplicateTitle(candidate, existingTitles).length) return { title: candidate, issues };
    }
    return { title, issues };
  }
  const collapse = detectTitleCollapse(title, existingTitles, language);
  if (!collapse.length) return { title, issues: [] };
  const qualifier = extractTitleQualifier(title, existingTitles, options?.content, language);
  return { title: qualifier ?? title, issues: collapse };
}

function detectTitleCollapse(title: string, existingTitles: ReadonlyArray<string>, language: SupportedLanguage): ReadonlyArray<PostWriteViolation> {
  const recent = existingTitles.map((item) => item.trim()).filter(Boolean).slice(-3);
  if (recent.length < 3) return [];
  const pressure = analyzeChapterCadence({ language, rows: [...recent, title].map((item, index) => ({ chapter: index + 1, title: item, mood: "", chapterType: "" })) }).titlePressure;
  if (!pressure || pressure.pressure !== "high" || !tokenize(title, language).includes(pressure.repeatedToken.toLocaleLowerCase(language))) return [];
  return [{ rule: "title-collapse", severity: "warning", description: `Chapter title "${title}" repeats the recent "${pressure.repeatedToken}" title pattern.`, suggestion: "Rename it around a new image, action, consequence, or character focus." }];
}

function extractTitleQualifier(base: string, existing: ReadonlyArray<string>, content: string | undefined, language: SupportedLanguage): string | undefined {
  if (!content?.trim()) return undefined;
  const blocked = new Set(tokenize([base, ...existing].join(" "), language));
  const candidates = tokenize(content, language).filter((word) => word.length >= 4 && !blocked.has(word) && !TITLE_STOP_WORDS.has(word));
  if (!candidates.length) return undefined;
  const selected = [...new Set(candidates)].slice(0, 2);
  return language === "en" ? selected.map(capitalize).join(" ") : selected.join(" ");
}

function tokenize(text: string, language: SupportedLanguage): string[] {
  return (text.normalize("NFC").match(/[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu) ?? [])
    .map((word) => word.toLocaleLowerCase(language));
}

function wordCount(text: string): number { return tokenize(text, "vi").length; }
function countWholeWords(text: string, term: string): number {
  const haystack = tokenize(text, "vi");
  const needle = tokenize(term, "vi");
  if (!needle.length) return 0;
  let count = 0;
  for (let index = 0; index <= haystack.length - needle.length; index++) {
    if (needle.every((word, offset) => haystack[index + offset] === word)) count++;
  }
  return count;
}
function includesFolded(text: string, term: string, language: SupportedLanguage): boolean {
  return tokenize(text, language).join(" ").includes(tokenize(term, language).join(" "));
}
function normalizeTitle(title: string): string { return title.normalize("NFC").toLocaleLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, ""); }
function capitalize(word: string): string { return word ? `${word[0]!.toUpperCase()}${word.slice(1)}` : word; }
