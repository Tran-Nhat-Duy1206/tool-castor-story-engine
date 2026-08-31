/**
 * Phase 9-3: hard gate that a chapter draft actually acts on the hook ledger
 * the planner declared in the memo's "## Sổ hook chương này" / "## Hook ledger for
 * this chapter" section.
 *
 * The planner commits, per chapter, to:
 *   - advance: <hook_id> "name" → state-change
 *   - resolve: <hook_id> "name" → action
 *
 * The validator parses those two lists and checks that every committed hook
 * has observable evidence in the draft. "Evidence" means the draft mentions
 * at least one keyword from the ledger line's descriptor (hook name, key
 * noun, etc.). We deliberately do NOT require the draft to repeat the raw
 * hook_id like "H007" — writers don't embed IDs in prose.
 */

export interface HookLedgerViolation {
  readonly severity: "critical" | "warning";
  readonly category: string;
  readonly description: string;
  readonly suggestion: string;
}

export interface HookLedgerEntry {
  readonly id: string;
  /** Raw text of the ledger line after the hook_id. */
  readonly descriptor: string;
  /** 2+ char CJK sequences and 3+ letter ASCII words extracted from descriptor. */
  readonly keywords: ReadonlyArray<string>;
}

export interface HookLedger {
  readonly open: ReadonlyArray<HookLedgerEntry>;
  readonly advance: ReadonlyArray<HookLedgerEntry>;
  readonly resolve: ReadonlyArray<HookLedgerEntry>;
  readonly defer: ReadonlyArray<HookLedgerEntry>;
  // Core narrative engine processing.
  readonly newOpenCount: number;
}

const LEDGER_HEADING_PATTERNS = [
  /^#{2,3}\s*(?:Sổ\s+hook\s+chương\s+này|Hook\s+ledger\s+for\s+this\s+chapter)\s*$/im,
];

const SUBSECTION_KEYS: ReadonlyArray<keyof HookLedger> = ["open", "advance", "resolve", "defer"];

/**
 * Tokens that look like hook_ids but are placeholders meaning "no hooks in
 * this slot". Writers sometimes emit "- none" or "- không" under an empty slot
 * instead of leaving it blank.
 */
const PLACEHOLDER_TOKENS = /^(không|khong|none|nil|null|tạm\s+không|n\/a|na|n-a|tbd|todo|chờ)$/i;

/** Subsection heading words that must not be parsed as hook_ids. */
const SUBSECTION_WORDS = /^(open|advance|resolve|defer|new)$/i;

export function parseHookLedger(memoBody: string): HookLedger {
  const section = extractLedgerSection(memoBody);
  if (!section) {
    return { open: [], advance: [], resolve: [], defer: [], newOpenCount: 0 };
  }

  type Subsection = "open" | "advance" | "resolve" | "defer";
  const result: Record<Subsection, HookLedgerEntry[]> = {
    open: [],
    advance: [],
    resolve: [],
    defer: [],
  };
  let newOpenCount = 0;

  let current: Subsection | null = null;
  for (const rawLine of section.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    const subHeadingMatch = line.match(/^(open|advance|resolve|defer)\s*[:：]?\s*$/i);
    if (subHeadingMatch) {
      current = subHeadingMatch[1]!.toLowerCase() as Subsection;
      continue;
    }

    if (!current) continue;
    if (!line.startsWith("-")) continue;

    // `[new]` placeholder lines have no hook_id but still count as a new hook
    // opened (reveal 1 seed 1 floor check). extractLedgerEntry filters them out for
    // advance/resolve evidence matching; we tally them separately here.
    const cleaned = line.replace(/^-+\s*/, "").trim();
    if (current === "open" && /^\[new\]/i.test(cleaned)) {
      newOpenCount += 1;
      continue;
    }

    const entry = extractLedgerEntry(line);
    if (entry) result[current].push(entry);
  }

  return { ...result, newOpenCount };
}

/**
 * Enforce: every hook declared under advance / resolve must have observable
 * evidence in the draft text. We do NOT validate `open` (new hooks don't have
 * a pre-existing id/descriptor to echo) or `defer` (deferred = deliberately
 * not touched).
 *
 * Additionally enforces the "reveal 1 seed 1" hard floor: whenever a chapter
 * resolves one or more hooks, it must open at least as many new hooks in the
 * same memo to preserve forward narrative tension.
 */
export function validateHookLedger(
  memoBody: string,
  draftContent: string,
): ReadonlyArray<HookLedgerViolation> {
  const ledger = parseHookLedger(memoBody);
  const violations: HookLedgerViolation[] = [];

  // Evidence check for everything the memo committed to land in prose.
  const committed = dedupeById([...ledger.advance, ...ledger.resolve]);
  for (const entry of committed) {
    if (!draftEchoesEntry(draftContent, entry)) {
      violations.push({
        severity: "warning",
        category: "Hook Ledger Semantic Review",
        description: `Memo declared advance/resolve for hook ${entry.id}, but keyword check found no corresponding landing in the draft`,
        suggestion: `Verify whether the draft advanced ${entry.id} via action, dialogue, object, or state change; if not, add specific scenes. If already advanced, this warning may be ignored`,
      });
    }
  }

  // "Reveal 1 seed 1" hard floor: when anything was resolved, at least the same
  // number of new hooks must have been opened.
  const resolvedCount = ledger.resolve.length;
  const openedCount = ledger.open.length + ledger.newOpenCount;
  if (resolvedCount > 0 && openedCount < resolvedCount) {
    violations.push({
      severity: "critical",
      category: "Hook Ledger Balance Violation (Reveal 1 Seed 1)",
      description: `This chapter resolved ${resolvedCount} hook(s), but only opened ${openedCount} new hook(s). Resolving without seeding drains forward story pull.`,
      suggestion: `In the memo open section, seed at least ${resolvedCount - openedCount} new hook(s) related to the resolved events.`,
    });
  }

  return violations;
}

function extractLedgerSection(memoBody: string): string | undefined {
  for (const pattern of LEDGER_HEADING_PATTERNS) {
    const match = memoBody.match(pattern);
    if (!match || match.index === undefined) continue;
    const start = match.index + match[0].length;
    const rest = memoBody.slice(start);
    const nextHeading = rest.match(/\n#{2,3}\s/);
    const end = nextHeading ? nextHeading.index ?? rest.length : rest.length;
    return rest.slice(0, end);
  }
  return undefined;
}

function extractLedgerEntry(line: string): HookLedgerEntry | undefined {
  const cleaned = line.replace(/^-+\s*/, "").trim();
  if (cleaned.startsWith("[new]") || cleaned.startsWith("[NEW]")) return undefined;

  // Reject whole-line placeholders first — "- none", "- n/a" etc.
  const firstWord = cleaned.split(/\s+/)[0] ?? "";
  if (PLACEHOLDER_TOKENS.test(firstWord)) return undefined;

  const idMatch = cleaned.match(/^([A-Za-z0-9_\-]{1,20})/);
  if (!idMatch) return undefined;

  const candidate = idMatch[1]!;
  if (SUBSECTION_WORDS.test(candidate)) return undefined;
  if (PLACEHOLDER_TOKENS.test(candidate)) return undefined;

  const descriptor = cleaned.slice(candidate.length).trim();
  return { id: candidate, descriptor, keywords: extractKeywords(descriptor) };
}

/**
 * Extract content-matching tokens from a ledger line's descriptor.
 *
 * Priority 1: quoted hook name — `H007 "name" → ...` — this is the most
 * informative token the planner attached, and it's what the writer should
 * echo.
 *
 * Priority 2: if no quoted name, fall back to the descriptor text UP TO the
 * first state-transition arrow (→ or ->).
 */
function extractKeywords(descriptor: string): ReadonlyArray<string> {
  if (!descriptor) return [];

  // Try the quoted-name anchor first — matches "..." or "..." quotes.
  const quotedMatch = descriptor.match(/["“]([^"”\n]+)["”]/);
  const source = quotedMatch ? quotedMatch[1]! : descriptor.split(/[→]|->/, 1)[0]!;

  const words = (source.match(/[\p{L}\p{N}]{3,}/gu) ?? []).map((w) => w.toLowerCase());
  return dedupeStrings(words.filter((tok) => !ASCII_STOPWORDS.has(tok)));
}

const ASCII_STOPWORDS = new Set([
  "and", "the", "for", "with", "from", "that", "into", "then",
  "open", "close", "advance", "resolve", "defer", "new",
  "planted", "pressured", "near", "payoff", "ready", "stale",
]);

function draftEchoesEntry(draft: string, entry: HookLedgerEntry): boolean {
  if (entry.keywords.length > 0) {
    const draftLower = draft.toLowerCase();
    return entry.keywords.some((kw) => {
      // ASCII keywords are already lowercased; CJK keywords case doesn't matter.
      return /^[a-z]/.test(kw) ? draftLower.includes(kw) : draft.includes(kw);
    });
  }
  // Bare-id ledger line with no descriptor — fall back to ID match.
  if (/^[A-Za-z0-9_-]+$/.test(entry.id)) {
    return new RegExp(`\\b${escapeRegex(entry.id)}\\b`).test(draft);
  }
  return draft.includes(entry.id);
}

function dedupeById(entries: ReadonlyArray<HookLedgerEntry>): HookLedgerEntry[] {
  const seen = new Set<string>();
  const result: HookLedgerEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    result.push(entry);
  }
  return result;
}

function dedupeStrings(values: ReadonlyArray<string>): string[] {
  return [...new Set(values)];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const INTERNAL = {
  SUBSECTION_KEYS,
  extractLedgerSection,
  extractLedgerEntry,
  extractKeywords,
};
