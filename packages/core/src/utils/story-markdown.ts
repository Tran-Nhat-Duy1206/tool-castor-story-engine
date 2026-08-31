import type { Fact, StoredHook, StoredSummary } from "../state/memory-db.js";
import {
  localizeHookPayoffTiming,
  normalizeStoredHookStatus,
  normalizeHookPayoffTiming,
  resolveHookPayoffTiming,
} from "./hook-lifecycle.js";

/**
 * Runtime markdown is canonical Vietnamese (with proper diacritics) or English.
 * Machine-facing identifiers remain stable English labels such as hook_id.
 */

export function renderSummarySnapshot(
  summaries: ReadonlyArray<StoredSummary>,
  language: "vi" | "en" = "vi",
): string {
  if (summaries.length === 0) return "- none";

  const headers = language === "en"
    ? [
      "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    : [
      // New Vietnamese headers — proper diacritics, not ViText/ASCII
      "| Chương | Tiêu đề | Nhân vật | Sự kiện chính | Thay đổi trạng thái | Hoạt động gợi mở | Tông cảm xúc | Loại chương |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ];

  return [
    ...headers,
    ...summaries.map((summary) => [
      summary.chapter,
      summary.title,
      summary.characters,
      summary.events,
      summary.stateChanges,
      summary.hookActivity,
      summary.mood,
      summary.chapterType,
    ].map(escapeTableCell).join(" | ")).map((row) => `| ${row} |`),
  ].join("\n");
}

export function renderHookSnapshot(
  hooks: ReadonlyArray<StoredHook>,
  language: "vi" | "en" = "vi",
): string {
  if (hooks.length === 0) return "- none";

  const headers = language === "en"
    ? [
      "| hook_id | start_chapter | type | status | last_advanced | expected_payoff | payoff_timing | depends_on | pays_off_in_arc | core_hook | half_life | promoted | notes |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    : [
      // Vietnamese headers with diacritics
      "| hook_id | Chương bắt đầu | Loại | Trạng thái | Lần thúc đẩy gần nhất | Thu hoạch dự kiến | Nhịp thu hoạch | Phụ thuộc | Thu hoạch trong mạch truyện | Cốt lõi | Bán rã | Thăng cấp | Ghi chú |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ];

  return [
    ...headers,
    ...hooks.map((hook) => [
      hook.hookId,
      hook.startChapter,
      hook.type,
      hook.status,
      hook.lastAdvancedChapter,
      hook.expectedPayoff,
      localizeHookPayoffTiming(resolveHookPayoffTiming(hook), language),
      renderDependsOnCell(hook.dependsOn ?? [], language),
      hook.paysOffInArc ?? "",
      renderCoreHookCell(hook.coreHook === true, language),
      renderHalfLifeCell(hook.halfLifeChapters),
      renderPromotedCell(hook.promoted, language),
      hook.notes,
    ].map((cell) => escapeTableCell(String(cell))).join(" | ")).map((row) => `| ${row} |`),
  ].join("\n");
}

function renderHalfLifeCell(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "";
  return String(Math.trunc(value));
}

function renderPromotedCell(value: boolean | undefined, language: "vi" | "en"): string {
  if (value === undefined) return "";
  if (language === "en") return value ? "true" : "false";
  return value ? "có" : "không";
}

function renderDependsOnCell(ids: ReadonlyArray<string>, language: "vi" | "en"): string {
  if (ids.length === 0) return language === "en" ? "none" : "không";
  return `[${ids.join(", ")}]`;
}

function renderCoreHookCell(isCore: boolean, language: "vi" | "en"): string {
  if (language === "en") return isCore ? "true" : "false";
  return isCore ? "có" : "không";
}

export function parseChapterSummariesMarkdown(markdown: string): StoredSummary[] {
  const rows = parseMarkdownTableRows(markdown)
    .filter((row) => /^\d+$/.test(row[0] ?? ""));

  return rows.map((row) => ({
    chapter: parseInt(row[0]!, 10),
    title: row[1] ?? "",
    characters: row[2] ?? "",
    events: row[3] ?? "",
    stateChanges: row[4] ?? "",
    hookActivity: row[5] ?? "",
    mood: row[6] ?? "",
    chapterType: row[7] ?? "",
  }));
}

export function parsePendingHooksMarkdown(markdown: string): StoredHook[] {
  const tableRows = parseMarkdownTableRows(markdown)
    .filter((row) => (row[0] ?? "").toLowerCase() !== "hook_id");

  if (tableRows.length > 0) {
    return tableRows
      .filter((row) => normalizeHookId(row[0]).length > 0)
      .map((row) => parsePendingHookRow(row));
  }

  return markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
    .map((line) => line.replace(/^-\s*/, ""))
    .filter(Boolean)
    .map((line, index) => ({
      hookId: `hook-${index + 1}`,
      startChapter: 0,
      type: "unspecified",
      status: "open",
      lastAdvancedChapter: 0,
      expectedPayoff: "",
      payoffTiming: undefined,
      notes: line,
    }));
}

export function parseCurrentStateFacts(
  markdown: string,
  fallbackChapter: number,
): Fact[] {
  const tableRows = parseMarkdownTableRows(markdown);
  const fieldValueRows = tableRows
    .filter((row) => row.length >= 2)
    .filter((row) => !isStateTableHeaderRow(row));

  if (fieldValueRows.length > 0) {
    const chapterFromTable = fieldValueRows.find((row) => isCurrentChapterLabel(row[0] ?? ""));
    const stateChapter = parseInteger(chapterFromTable?.[1]) || fallbackChapter;

    return fieldValueRows
      .filter((row) => !isCurrentChapterLabel(row[0] ?? ""))
      .flatMap((row): Fact[] => {
        const label = (row[0] ?? "").trim();
        const value = (row[1] ?? "").trim();
        if (!label || !value) return [];

        return [{
          subject: inferFactSubject(label),
          predicate: label,
          object: value,
          validFromChapter: stateChapter,
          validUntilChapter: null,
          sourceChapter: stateChapter,
        }];
      });
  }

  const bulletFacts = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
    .map((line) => line.replace(/^-\s*/, ""))
    .filter(Boolean);

  return bulletFacts.map((line, index) => ({
    subject: "current_state",
    predicate: `note_${index + 1}`,
    object: line,
    validFromChapter: fallbackChapter,
    validUntilChapter: null,
    sourceChapter: fallbackChapter,
  }));
}

export function parseMarkdownTableRows(markdown: string): string[][] {
  return markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"))
    .filter((line) => !line.includes("---"))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => cells.some(Boolean));
}

export function isStateTableHeaderRow(row: ReadonlyArray<string>): boolean {
  const first = (row[0] ?? "").trim().toLowerCase();
  const second = (row[1] ?? "").trim().toLowerCase();
  return (
    (first === "trường" && second === "giá trị") ||
    (first === "field" && second === "value")
  );
}

export function isCurrentChapterLabel(label: string): boolean {
  return /^(?:chương hiện tại|current chapter)$/i.test(label.trim());
}

export function inferFactSubject(label: string): string {
  if (/^(?:current location|vị trí hiện tại)$/i.test(label)) return "protagonist";
  if (/^(?:protagonist state|trạng thái nhân vật chính)$/i.test(label)) return "protagonist";
  if (/^(?:current goal|mục tiêu hiện tại)$/i.test(label)) return "protagonist";
  if (/^(?:current constraint|ràng buộc hiện tại)$/i.test(label)) return "protagonist";
  if (/^(?:current alliances|current relationships|quan hệ hiện tại|đồng minh.*đối địch)$/i.test(label)) return "protagonist";
  if (/^(?:current conflict|xung đột hiện tại)$/i.test(label)) return "protagonist";
  return "current_state";
}

export function parseInteger(value: string | undefined): number {
  if (!value) return 0;
  const match = value.match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

/**
 * Strict integer parse — only accepts cells that are purely numeric
 * (after stripping markdown formatting). Returns 0 for cells containing
 * prose like "Nền văn minh số 141" to prevent narrative numbers from being
 * mistaken for chapter/progress values.
 */
function parseStrictChapterInteger(value: string | undefined): number {
  if (!value) return 0;
  const stripped = normalizeHookId(value);
  return /^\d+$/.test(stripped) ? parseInt(stripped, 10) : 0;
}

export function normalizeHookId(value: string | undefined): string {
  let normalized = (value ?? "").trim();
  let previous = "";
  while (normalized && normalized !== previous) {
    previous = normalized;
    normalized = normalized
      .replace(/^\[(.+?)\]\([^)]+\)$/u, "$1")
      .replace(/^\*\*(.+)\*\*$/u, "$1")
      .replace(/^__(.+)__$/u, "$1")
      .replace(/^\*(.+)\*$/u, "$1")
      .replace(/^_(.+)_$/u, "$1")
      .replace(/^`(.+)`$/u, "$1")
      .replace(/^~~(.+)~~$/u, "$1")
      .trim();
  }
  normalized = normalized
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .trim();
  return /[\p{L}\p{N}]/u.test(normalized) ? normalized : "";
}

function parsePendingHookRow(row: ReadonlyArray<string | undefined>): StoredHook {
  // Row shapes by length:
  //   7 (legacy pre-timing): id, ch, type, status, last_adv, expected, notes
  //   8 (Phase 5/6):          id, ch, type, status, last_adv, expected, timing, notes
  //  11 (Phase 7 ledger):     ... + depends_on, pays_off_in_arc, core_hook, notes
  //  12 (Phase 7 hotfix 1):   ... + depends_on, pays_off_in_arc, core_hook, half_life, notes
  //  13 (Phase 7 hotfix 2):   ... + depends_on, pays_off_in_arc, core_hook, half_life, promoted, notes
  //  additional trailing columns (e.g. stale/blocked diagnostic columns) are
  //  allowed — the parser skips past them to the notes column.
  const phase7Promoted = row.length >= 13;
  const phase7HalfLife = row.length === 12;
  const phase7Compact = row.length === 11;
  const phase7 = phase7Promoted || phase7HalfLife || phase7Compact;
  const legacyShape = row.length < 8;
  const payoffTiming = legacyShape ? undefined : normalizeHookPayoffTiming(row[6]);
  const notes = phase7Promoted
    ? (row[12] ?? "")
    : phase7HalfLife
      ? (row[11] ?? "")
      : phase7Compact
        ? (row[10] ?? "")
        : legacyShape
          ? (row[6] ?? "")
          : (row[7] ?? "");

  const base = {
    hookId: normalizeHookId(row[0]),
    startChapter: parseStrictChapterInteger(row[1]),
    type: row[2] ?? "",
    status: normalizeStoredHookStatus(row[3] ?? "open"),
    lastAdvancedChapter: parseStrictChapterInteger(row[4]),
    expectedPayoff: row[5] ?? "",
    payoffTiming,
    notes,
  };

  if (!phase7) return base;

  return {
    ...base,
    dependsOn: parseDependsOn(row[7] ?? ""),
    paysOffInArc: (row[8] ?? "").trim(),
    coreHook: parseBooleanCell(row[9]),
    halfLifeChapters: (phase7HalfLife || phase7Promoted) ? parseOptionalInt(row[10]) : undefined,
    promoted: phase7Promoted ? parseOptionalBooleanCell(row[11]) : undefined,
  };
}

function parseOptionalBooleanCell(cell: string | undefined): boolean | undefined {
  const normalized = (cell ?? "").trim();
  if (!normalized) return undefined;
  const lower = normalized.toLowerCase();
  if (/^(true|yes|y|core|1|✓|✔|promoted|có)$/.test(lower)) return true;
  if (/^(false|no|n|seed|0|✗|✘|không)$/.test(lower)) return false;
  return undefined;
}

function parseDependsOn(cell: string): ReadonlyArray<string> {
  const trimmed = cell.trim();
  if (!trimmed) return [];
  const lower = trimmed.toLowerCase();
  if (lower === "none" || lower === "n/a" || lower === "-" || lower === "không") return [];

  // Accept [H01, H02] or H01, H02 or H01/H02.
  const stripped = trimmed.replace(/^[\[\(]\s*/, "").replace(/\s*[\]\)]$/, "");
  return stripped
    .split(/[,\/]+/)
    .map((item) => normalizeHookId(item))
    .filter((item) => item.length > 0);
}

function parseBooleanCell(cell: string | undefined): boolean {
  const normalized = (cell ?? "").trim().toLowerCase();
  if (!normalized) return false;
  return /^(true|yes|y|core|1|✓|✔|có)$/.test(normalized);
}

function parseOptionalInt(cell: string | undefined): number | undefined {
  const normalized = (cell ?? "").trim();
  if (!normalized) return undefined;
  const match = normalized.match(/\d+/);
  if (!match) return undefined;
  const value = parseInt(match[0], 10);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function escapeTableCell(value: string | number): string {
  return String(value).replace(/\|/g, "\\|").trim();
}
