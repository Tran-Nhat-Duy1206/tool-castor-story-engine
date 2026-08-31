import {
  CADENCE_PRESSURE_THRESHOLDS,
  CADENCE_WINDOW_DEFAULTS,
  resolveCadencePressure,
} from "./cadence-policy.js";

export interface CadenceSummaryRow {
  readonly chapter: number;
  readonly title: string;
  readonly mood: string;
  readonly chapterType: string;
}

export interface SceneCadencePressure {
  readonly pressure: "medium" | "high";
  readonly repeatedType: string;
  readonly streak: number;
}

export interface MoodCadencePressure {
  readonly pressure: "medium" | "high";
  readonly highTensionStreak: number;
  readonly recentMoods: ReadonlyArray<string>;
}

export interface TitleCadencePressure {
  readonly pressure: "medium" | "high";
  readonly repeatedToken: string;
  readonly count: number;
  readonly recentTitles: ReadonlyArray<string>;
}

export interface ChapterCadenceAnalysis {
  readonly scenePressure?: SceneCadencePressure;
  readonly moodPressure?: MoodCadencePressure;
  readonly titlePressure?: TitleCadencePressure;
}

export const DEFAULT_CHAPTER_CADENCE_WINDOW = CADENCE_WINDOW_DEFAULTS.summaryLookback;

const HIGH_TENSION_KEYWORDS = [
  "căng thẳng", "lạnh lùng", "áp bức", "ngột ngạt", "u ám", "nặng nề", "nghiêm trọng",
  "dồn dập", "nguy cơ", "đối đầu", "sát ý", "tuyệt vọng", "hiểm nguy", "đe dọa",
  "tense", "cold", "oppressive", "grim", "ominous", "dark",
  "bleak", "hostile", "threatening", "heavy", "suffocating",
];

const ENGLISH_STOP_WORDS = new Set([
  "the", "and", "with", "from", "into", "after", "before",
  "over", "under", "this", "that", "your", "their",
]);

const VI_STOP_WORDS = new Set([
  "trong", "ngoài", "những", "người", "chiếc", "cuộc", "nhưng", "không", "thành", "được",
]);

export function analyzeChapterCadence(params: {
  readonly rows: ReadonlyArray<CadenceSummaryRow>;
  readonly language: "vi" | "en";
}): ChapterCadenceAnalysis {
  const recentRows = [...params.rows]
    .sort((left, right) => left.chapter - right.chapter)
    .slice(-CADENCE_WINDOW_DEFAULTS.summaryLookback);

  return {
    scenePressure: analyzeScenePressure(recentRows),
    moodPressure: analyzeMoodPressure(recentRows),
    titlePressure: analyzeTitlePressure(recentRows, params.language),
  };
}

export function isHighTensionMood(mood: string): boolean {
  const lowerMood = mood.toLowerCase();
  return HIGH_TENSION_KEYWORDS.some((keyword) => lowerMood.includes(keyword));
}

function analyzeScenePressure(
  rows: ReadonlyArray<CadenceSummaryRow>,
): SceneCadencePressure | undefined {
  const types = rows
    .map((row) => row.chapterType.trim())
    .filter((value) => isMeaningfulValue(value));
  if (types.length < 2) {
    return undefined;
  }

  const repeatedType = types.at(-1);
  if (!repeatedType) {
    return undefined;
  }

  let streak = 0;
  for (const type of [...types].reverse()) {
    if (type.toLowerCase() !== repeatedType.toLowerCase()) {
      break;
    }
    streak += 1;
  }

  const pressure = resolveCadencePressure({
    count: streak,
    total: types.length,
    highThreshold: CADENCE_PRESSURE_THRESHOLDS.scene.highCount,
    mediumThreshold: CADENCE_PRESSURE_THRESHOLDS.scene.mediumCount,
    mediumWindowFloor: CADENCE_PRESSURE_THRESHOLDS.scene.mediumWindowFloor,
  });
  if (pressure) {
    return { pressure, repeatedType, streak };
  }
  return undefined;
}

function analyzeMoodPressure(
  rows: ReadonlyArray<CadenceSummaryRow>,
): MoodCadencePressure | undefined {
  const moods = rows
    .map((row) => row.mood.trim())
    .filter((value) => isMeaningfulValue(value));
  if (moods.length < 2) {
    return undefined;
  }

  const recentMoods: string[] = [];
  let highTensionStreak = 0;
  for (const mood of [...moods].reverse()) {
    if (!isHighTensionMood(mood)) {
      break;
    }
    recentMoods.unshift(mood);
    highTensionStreak += 1;
  }

  const pressure = resolveCadencePressure({
    count: highTensionStreak,
    total: moods.length,
    highThreshold: CADENCE_PRESSURE_THRESHOLDS.mood.highCount,
    mediumThreshold: CADENCE_PRESSURE_THRESHOLDS.mood.mediumCount,
    mediumWindowFloor: CADENCE_PRESSURE_THRESHOLDS.mood.mediumWindowFloor,
  });
  if (pressure) {
    return { pressure, highTensionStreak, recentMoods };
  }
  return undefined;
}

function analyzeTitlePressure(
  rows: ReadonlyArray<CadenceSummaryRow>,
  language: "vi" | "en",
): TitleCadencePressure | undefined {
  const titles = rows
    .map((row) => row.title.trim())
    .filter((value) => isMeaningfulValue(value));
  if (titles.length < 2) {
    return undefined;
  }

  const counts = new Map<string, number>();
  for (const title of titles) {
    for (const token of extractTitleTokens(title, language)) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }

  const repeated = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || right[0].length - left[0].length || left[0].localeCompare(right[0]))
    .find((entry) => entry[1] >= CADENCE_PRESSURE_THRESHOLDS.title.minimumRepeatedCount);
  if (!repeated) {
    return undefined;
  }

  const [repeatedToken, count] = repeated;
  const pressure = resolveCadencePressure({
    count,
    total: titles.length,
    highThreshold: CADENCE_PRESSURE_THRESHOLDS.title.highCount,
    mediumThreshold: CADENCE_PRESSURE_THRESHOLDS.title.mediumCount,
    mediumWindowFloor: CADENCE_PRESSURE_THRESHOLDS.title.mediumWindowFloor,
  });
  if (pressure) {
    return { pressure, repeatedToken, count, recentTitles: titles };
  }
  return undefined;
}

function extractTitleTokens(title: string, language: "vi" | "en"): string[] {
  const words = title.match(/[\p{L}]{4,}/gu) ?? [];
  const stopWords = language === "en" ? ENGLISH_STOP_WORDS : VI_STOP_WORDS;
  return [...new Set(
    words
      .map((word) => word.toLowerCase())
      .filter((word) => !stopWords.has(word)),
  )];
}

// ── Helpers ────────────────────────────────────────────────────

function isMeaningfulValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  return normalized !== "none" && normalized !== "(none)" && normalized !== "không";
}
