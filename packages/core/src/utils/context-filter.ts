/**
 * Smart context filtering for Writer and Auditor prompts.
 *
 * Reduces noise by injecting only relevant parts of truth files.
 * Every filter falls back to the full input if filtering would empty it.
 */

import { DEFAULT_CHAPTER_CADENCE_WINDOW } from "./chapter-cadence.js";

export interface ContextCapOptions {
  readonly label: string;
  readonly maxChars: number;
  readonly headRatio?: number;
}

/**
 * Cap a large context block while keeping the durable setup at the beginning
 * and the latest tail. This prevents long-running books from sending full truth
 * files every chapter while still making the omission visible to the model.
 */
export function capContextBlock(content: string, options: ContextCapOptions): string {
  if (!content || isMissingContext(content)) return content;

  const maxChars = Math.floor(options.maxChars);
  if (maxChars <= 0) return "";
  if (content.length <= maxChars) return content;

  const omitted = content.length - maxChars;
  const note = `\n\n[Castor context budget: omitted about ${omitted} chars from ${options.label}; kept beginning and latest tail.]\n\n`;
  if (maxChars <= note.length + 2) {
    return content.slice(0, maxChars);
  }

  const keepChars = maxChars - note.length;
  const headRatio = clampRatio(options.headRatio ?? 0.45);
  const headChars = Math.max(1, Math.floor(keepChars * headRatio));
  const tailChars = Math.max(1, keepChars - headChars);

  return `${content.slice(0, headChars)}${note}${content.slice(-tailChars)}`;
}

/** Filter pending_hooks: remove resolved/closed hooks. */
export function filterHooks(hooks: string): string {
  if (!hooks || isMissingContext(hooks)) return hooks;
  return filterTableRows(hooks, (row) => {
    const lower = row.toLowerCase();
    return !lower.includes("đã giải quyết") && !lower.includes("đã đóng") && !lower.includes("resolved") && !lower.includes("closed");
  });
}

/** Filter chapter_summaries: keep only the most recent N chapters. */
export function filterSummaries(
  summaries: string,
  currentChapter: number,
  keepRecent = DEFAULT_CHAPTER_CADENCE_WINDOW,
): string {
  if (!summaries || isMissingContext(summaries)) return summaries;
  return filterTableRows(summaries, (row) => {
    const match = row.match(/\|\s*(\d+)\s*\|/);
    if (!match) return true;
    return parseInt(match[1]!, 10) > currentChapter - keepRecent;
  });
}

/** Filter subplot_board: remove closed/resolved subplots. */
export function filterSubplots(board: string): string {
  if (!board || isMissingContext(board)) return board;
  return filterTableRows(board, (row) => {
    const lower = row.toLowerCase();
    return !lower.includes("đã giải quyết") && !lower.includes("đã đóng") && !lower.includes("closed") && !lower.includes("resolved");
  });
}

/** Filter emotional_arcs: keep only the most recent N chapters. */
export function filterEmotionalArcs(
  arcs: string,
  currentChapter: number,
  keepRecent = DEFAULT_CHAPTER_CADENCE_WINDOW,
): string {
  if (!arcs || isMissingContext(arcs)) return arcs;
  return filterTableRows(arcs, (row) => {
    const match = row.match(/\|\s*(\d+)\s*\|/);
    if (!match) return true;
    return parseInt(match[1]!, 10) > currentChapter - keepRecent;
  });
}

/**
 * Filter character_matrix: keep only characters mentioned in the volume outline
 * current section + protagonist.
 */
export function filterCharacterMatrix(
  matrix: string,
  volumeOutline: string,
  protagonistName?: string,
): string {
  if (!matrix || isMissingContext(matrix)) return matrix;

  // Extract names from outline
  const names = extractNames(volumeOutline);
  if (protagonistName) names.add(protagonistName);
  if (names.size === 0) return matrix;

  // Split the character matrix into Markdown sections.
  const sections = matrix.split(/(?=^###)/m);
  const filtered = sections.map((section) => {
    const result = filterTableRows(section, (row) => {
      for (const name of names) {
        if (row.includes(name)) return true;
      }
      return false;
    });
    // Keep section even if no matching rows (preserve headers for structure)
    return result;
  });

  const result = filtered.join("\n");
  // Fallback: if filtering removed all data rows, return original
  const dataRowCount = result.split("\n").filter((l) => l.startsWith("|") && !l.includes("---") && !isHeaderRow(l)).length;
  return dataRowCount > 0 ? result : matrix;
}

/**
 * Extract Vietnamese or English capitalized name tokens from text.
 */
function extractNames(text: string): Set<string> {
  const names = new Set<string>();

  const nameRegex = /\b\p{Lu}[\p{L}\p{M}'’-]{1,}\b/gu;
  let match: RegExpExecArray | null;
  while ((match = nameRegex.exec(text)) !== null) names.add(match[0]);

  return names;
}

function isMissingContext(content: string): boolean {
  const normalized = content.trim().toLocaleLowerCase("vi");
  return normalized === "(file not created)" || normalized === "(tệp chưa được tạo)";
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0.45;
  return Math.min(0.8, Math.max(0.2, value));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isHeaderRow(line: string): boolean {
  // First data-like row in a table (contains column names)
  return /^\|\s*(Chương|Nhân vật|Tuyến phụ|hook_id|Chapter|Character|Subplot)/iu.test(line);
}

/**
 * Generic markdown table row filter.
 * Keeps header rows + separator rows + rows passing the predicate.
 * Falls back to original if filtering empties all data rows.
 */
function filterTableRows(content: string, predicate: (row: string) => boolean): string {
  const lines = content.split("\n");
  const nonTableLines: string[] = [];
  const headerLines: string[] = [];
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line.startsWith("|")) {
      nonTableLines.push(line);
    } else if (line.includes("---") || isHeaderRow(line)) {
      headerLines.push(line);
    } else {
      dataLines.push(line);
    }
  }

  const filtered = dataLines.filter(predicate);

  // Fallback: if no rows pass, return original
  if (filtered.length === 0 && dataLines.length > 0) {
    return content;
  }

  return [...nonTableLines, ...headerLines, ...filtered].join("\n");
}
