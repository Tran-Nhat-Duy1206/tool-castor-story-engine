import { z } from "zod";
import yaml from "js-yaml";

const ProtagonistSchema = z.object({
  name: z.string(),
  personalityLock: z.array(z.string()).default([]),
  behavioralConstraints: z.array(z.string()).default([]),
}).optional();

const GenreLockSchema = z.object({
  primary: z.string(),
  forbidden: z.array(z.string()).default([]),
}).optional();

const NumericalOverridesSchema = z.object({
  hardCap: z.union([z.number(), z.string()]).optional(),
  resourceTypes: z.array(z.string()).default([]),
}).optional();

const EraConstraintsSchema = z.object({
  enabled: z.boolean().default(false),
  period: z.string().optional(),
  region: z.string().optional(),
}).optional();

export const BookRulesSchema = z.object({
  version: z.string().default("1.0"),
  protagonist: ProtagonistSchema,
  genreLock: GenreLockSchema,
  // Narrative person, set ONLY when the user explicitly asked for one. Lenient:
  // a stray/placeholder value degrades to undefined rather than breaking the
  // whole book_rules parse (fail-open).
  narrativePerson: z.enum(["first", "third"]).optional().catch(undefined),
  numericalSystemOverrides: NumericalOverridesSchema,
  eraConstraints: EraConstraintsSchema,
  prohibitions: z.array(z.string()).default([]),
  chapterTypesOverride: z.array(z.string()).default([]),
  fatigueWordsOverride: z.array(z.string()).default([]),
  additionalAuditDimensions: z.array(z.union([z.number(), z.string()])).default([]),
  enableFullCastTracking: z.boolean().default(false),
  fanficMode: z.enum(["canon", "au", "ooc", "cp"]).optional(),
  allowedDeviations: z.array(z.string()).default([]),
});

export type BookRules = z.infer<typeof BookRulesSchema>;

export interface ParsedBookRules {
  readonly rules: BookRules;
  readonly body: string;
}

/**
 * Legacy Phase 5 books may still contain a compat pointer instead of real
 * rules. Detect that shim so callers can fall back to old story_frame
 * frontmatter instead of treating the pointer as legitimate empty rules.
 *
 * Markers (must match buildBookRulesShim() in architect.ts):
 *   - rules（rules——rules） / Book Rules (compat pointer — deprecated)
 *   - rules / This file is kept for external readers only
 */
export function isBookRulesShim(raw: string): boolean {
  return (
    /(?:Quy tắc sách|Book Rules) \(compat pointer\)/i.test(raw)
    || /Book Rules \(compat pointer — deprecated\)/.test(raw)
    || /This file is kept for external readers only/i.test(raw)
    || /This file is kept for external readers only/.test(raw)
  );
}

export function parseBookRules(raw: string): ParsedBookRules | null {
  // Strip markdown code block wrappers if present (LLM often wraps output in ```md ... ```)
  const stripped = raw.replace(/^```(?:md|markdown|yaml)?\s*\n/, "").replace(/\n```\s*$/, "");

  // Try to find YAML frontmatter anywhere in the text (not just at the start)
  const fmMatch = stripped.match(/---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (fmMatch) {
    try {
      const frontmatter = yaml.load(fmMatch[1]) as Record<string, unknown>;
      const rules = BookRulesSchema.parse(frontmatter);
      const body = fmMatch[2].trim();
      return { rules, body };
    } catch {
      // YAML parse failed — fall through to shim/default check.
    }
  }

  // Phase hotfix 1: refuse to silently zero out rules when reading a Phase 5
  // compat shim. The shim has no real rules; pretending it parses as
  // "default empty" wipes protagonist / prohibitions / genreLock for any
  // caller that fell back to it after a broken story_frame frontmatter.
  if (isBookRulesShim(stripped)) {
    return null;
  }

  // New layout: book_rules.md is ordinary Markdown. The model no longer has
  // to emit YAML; the host extracts the small structured rule surface it needs
  // and keeps the full Markdown as human-readable body.
  const rules = parseMarkdownBookRules(stripped);
  return { rules, body: stripped.trim() };
}

/**
 * Stricter variant of parseBookRules: returns null if the input has no valid
 * YAML frontmatter OR if the frontmatter fails to parse / validate. Unlike
 * parseBookRules, this never falls back to default rules — callers can use
 * the null return to trigger their own fallback (e.g. legacy book_rules.md).
 *
 * Phase 5 hotfix 3: readBookRules() uses this to detect a broken YAML block
 * on story_frame.md and fall back to legacy book_rules.md instead of
 * silently clearing protagonist / prohibitions / genreLock.
 */
export function tryParseBookRulesFrontmatter(
  raw: string,
  onError?: (error: unknown) => void,
): ParsedBookRules | null {
  const stripped = raw.replace(/^```(?:md|markdown|yaml)?\s*\n/, "").replace(/\n```\s*$/, "");
  const fmMatch = stripped.match(/---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!fmMatch) return null;

  try {
    const frontmatter = yaml.load(fmMatch[1]) as Record<string, unknown>;
    const rules = BookRulesSchema.parse(frontmatter);
    const body = fmMatch[2].trim();
    return { rules, body };
  } catch (err) {
    if (onError) onError(err);
    return null;
  }
}

function parseMarkdownBookRules(raw: string): BookRules {
  const protagonistSection = extractMarkdownSection(raw, ["Nhân vật chính", "Protagonist", "Main Character"]);
  const protagonistName =
    readLabeledValue(protagonistSection, ["Tên", "name", "protagonist"])
    ?? readLabeledValue(raw, ["Nhân vật chính", "protagonist"]);
  const personalityLock = readLabeledList(protagonistSection, [
    "",
    "",
    "personalityLock",
    "personality lock",
    "core tags",
  ]);
  const behavioralConstraints = readLabeledList(protagonistSection, [
    "",
    "behavioralConstraints",
    "behavioral constraints",
  ]);

  const genreSection = extractMarkdownSection(raw, ["Khóa thể loại", "Genre Lock", "Genre"]);
  const primary = readLabeledValue(genreSection, ["Thể loại chính", "primary", "genre"]);
  const forbidden = [
    ...readLabeledList(genreSection, ["Cấm đưa vào", "forbidden", "forbidden style"]),
    ...readMarkdownList(extractMarkdownSection(raw, ["Cấm đưa vào", "Forbidden Style Intrusions", "Forbidden"])),
  ];

  const prohibitions = readMarkdownList(extractMarkdownSection(raw, [
    "",
    "",
    "",
    "Prohibitions",
    "Do Not",
  ]));
  const fanficSection = extractMarkdownSection(raw, ["Chế độ đồng nhân", "Chế độ fanfic", "Fanfic Mode", "Fanfic"]);
  const fanficMode = normalizeFanficMode(readLabeledValue(fanficSection, [
    "",
    "",
    "fanficMode",
    "fanfic mode",
    "mode",
  ]));
  const allowedDeviations = readLabeledList(fanficSection, [
    "",
    "",
    "allowedDeviations",
    "allowed deviations",
  ]);

  const numericalSection = extractMarkdownSection(raw, [
    "/",
    "",
    "",
    "Numerical / Resource Rules",
    "Numerical Rules",
    "Resource Rules",
  ]);
  const resourceTypes = readLabeledList(numericalSection, [
    "",
    "",
    "resourceTypes",
    "core resources",
    "resources",
  ]);
  const hardCap = readLabeledValue(numericalSection, ["Giới hạn cứng", "hardCap", "hard cap"]);

  const eraSection = extractMarkdownSection(raw, ["Ràng buộc thời đại", "Era Constraints"]);
  const period = readLabeledValue(eraSection, ["Thời kỳ", "period", "era"]);
  const region = readLabeledValue(eraSection, ["Khu vực", "region"]);

  return BookRulesSchema.parse({
    protagonist: protagonistName
      ? {
          name: protagonistName,
          personalityLock,
          behavioralConstraints,
        }
      : undefined,
    genreLock: primary || forbidden.length > 0
      ? {
          primary: primary ?? "",
          forbidden,
        }
      : undefined,
    narrativePerson: detectNarrativePerson(raw),
    numericalSystemOverrides: hardCap || resourceTypes.length > 0
      ? {
          hardCap,
          resourceTypes,
        }
      : undefined,
    eraConstraints: eraSection
      ? {
          enabled: true,
          period,
          region,
        }
      : undefined,
    prohibitions,
    fanficMode,
    allowedDeviations,
  });
}

function extractMarkdownSection(raw: string, headings: ReadonlyArray<string>): string {
  const wanted = new Set(headings.map(normalizeHeading));
  const lines = raw.split(/\r?\n/);
  let collecting = false;
  const out: string[] = [];

  for (const line of lines) {
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/)?.[1];
    if (heading) {
      if (collecting) break;
      collecting = wanted.has(normalizeHeading(heading));
      continue;
    }
    if (collecting) out.push(line);
  }

  return out.join("\n").trim();
}

function readLabeledValue(raw: string, labels: ReadonlyArray<string>): string | undefined {
  if (!raw.trim()) return undefined;
  const labelPattern = labels.map(escapeRegExp).join("|");
  const match = raw.match(new RegExp(`^\\s*(?:[-*]\\s*)?(?:${labelPattern})\\s*[:：]\\s*(.+?)\\s*$`, "im"));
  const value = cleanScalar(match?.[1] ?? "");
  return value || undefined;
}

function readLabeledList(raw: string, labels: ReadonlyArray<string>): string[] {
  const value = readLabeledValue(raw, labels);
  return value ? splitList(value) : [];
}

function readMarkdownList(raw: string): string[] {
  if (!raw.trim()) return [];
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => cleanScalar(line.replace(/^[-*]\s+/, "")))
    .filter((value) => value.length > 0);
}

function splitList(value: string): string[] {
  const stripped = cleanScalar(value).replace(/^[\[(（【]\s*/, "").replace(/\s*[\])）】]$/, "");
  return stripped
    .split(/[、,，;；|]/)
    .map(cleanScalar)
    .filter((item) => item.length > 0);
}

function detectNarrativePerson(raw: string): "first" | "third" | undefined {
  if (/ngôi thứ nhất|first[-\s]?person|\bfirst\b/i.test(raw)) return "first";
  if (/ngôi thứ ba|third[-\s]?person|\bthird\b/i.test(raw)) return "third";
  return undefined;
}

function normalizeFanficMode(value: string | undefined): "canon" | "au" | "ooc" | "cp" | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "canon" || /chính điển|canon/i.test(value)) return "canon";
  if (normalized === "au" || /song song|au/i.test(value)) return "au";
  if (normalized === "ooc" || /lệch tính cách|ooc/i.test(value)) return "ooc";
  if (normalized === "cp" || /ghép đôi|cp/i.test(value)) return "cp";
  return undefined;
}

function cleanScalar(value: string): string {
  const trimmed = value
    .trim()
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, "")
    .trim();
  return /^(?:|none|n\/a|na|\(none\)|（）|-|—)$/i.test(trimmed) ? "" : trimmed;
}

function normalizeHeading(value: string): string {
  return value.replace(/[：:]\s*$/, "").trim().toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
