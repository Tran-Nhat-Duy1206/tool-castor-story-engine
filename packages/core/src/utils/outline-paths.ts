// Core narrative engine processing.

import { readFile, readdir, access } from "node:fs/promises";
import { join } from "node:path";

/**
 * Detect whether a book uses the Phase 5 new layout (outline/story_frame.md
 * exists on disk). If yes, story_bible.md / book_rules.md are compat shims.
 * If no, those files ARE the authoritative source.
 */
export async function isNewLayoutBook(bookDir: string): Promise<boolean> {
  try {
    await access(join(bookDir, "story", "outline", "story_frame.md"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a book's architect foundation is fully written on disk. A long
 * architect run (especially on a stronger model) can outlive the in-memory
 * create-status tracking — or the server can restart mid-run — leaving the
 * status endpoint with no entry. Checking disk lets create-status answer
 * "ready" truthfully instead of an ambiguous 404 that reads as "failed".
 *
 * "Complete" mirrors the five sections the architect must emit
 * (story_frame / volume_map / book_rules / pending_hooks / roles); a half-built
 * book that is missing any of these is NOT ready.
 */
export async function isBookFoundationComplete(bookDir: string): Promise<boolean> {
  const required = [
    join(bookDir, "book.json"),
    join(bookDir, "story", "outline", "story_frame.md"),
    join(bookDir, "story", "outline", "volume_map.md"),
    join(bookDir, "story", "book_rules.md"),
    join(bookDir, "story", "pending_hooks.md"),
  ];
  for (const path of required) {
    try {
      await access(path);
    } catch {
      return false;
    }
  }
  // Roles must exist via EITHER source the runtime actually reads: a character
  // sheet under the new roles/<tier>/ dir, OR the legacy character_matrix.md
  // (readCharacterContext falls back to it). The architect routinely persists
  // roles to character_matrix.md, so requiring the roles/ dir alone falsely
  // reported a complete book as "missing".
  for (const tier of ["major", "minor", "", ""]) {
    try {
      const entries = await readdir(join(bookDir, "story", "roles", tier));
      if (entries.some((file) => file.endsWith(".md"))) return true;
    } catch {
      // Try the next directory.
    }
  }
  try {
    const matrix = await readFile(join(bookDir, "story", "character_matrix.md"), "utf-8");
    if (hasLegacyCharacterMatrixRoles(matrix)) return true;
  } catch {
    // No legacy matrix either.
  }
  return false;
}

function hasLegacyCharacterMatrixRoles(content: string): boolean {
  const normalized = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.includes(""))
    .filter((line) => !line.includes("story/roles/"))
    .filter((line) => !/^\(?(?:none||Chưa có|không)\)?$/i.test(line));

  return normalized.some((line) => {
    const match = /^#{2,}\s+(.+)$/.exec(line);
    if (!match) return false;
    const title = match[1].trim().replace(/[*`#]/g, "");
    return !/^(||major roles?|minor roles?|characters?|nhân vật chính|nhân vật phụ|bảng nhân vật)$/i.test(title);
  });
}

async function readOr(path: string, fallback: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return fallback;
  }
}

/** Read story_frame.md, falling back to legacy story_bible.md. */
export async function readStoryFrame(
  bookDir: string,
  fallbackPlaceholder: string = "",
): Promise<string> {
  const newPath = join(bookDir, "story", "outline", "story_frame.md");
  const legacyPath = join(bookDir, "story", "story_bible.md");

  const newContent = await readOr(newPath, "");
  if (newContent.trim()) return newContent;

  return readOr(legacyPath, fallbackPlaceholder);
}

/** Read volume_map.md, falling back to legacy volume_outline.md. */
export async function readVolumeMap(
  bookDir: string,
  fallbackPlaceholder: string = "",
): Promise<string> {
  const newPath = join(bookDir, "story", "outline", "volume_map.md");
  const legacyPath = join(bookDir, "story", "volume_outline.md");

  const newContent = await readOr(newPath, "");
  if (newContent.trim()) return newContent;

  return readOr(legacyPath, fallbackPlaceholder);
}

/** Read the rhythm principles file (en or vi variant). */
export async function readRhythmPrinciples(bookDir: string): Promise<string> {
  const enPath = join(bookDir, "story", "outline", "rhythm_principles.md");
  const zhPath = join(bookDir, "story", "outline", ".md");

  const en = await readOr(enPath, "");
  if (en.trim()) return en;
  return readOr(zhPath, "");
}

export interface RoleCard {
  readonly tier: "major" | "minor";
  readonly name: string;
  readonly content: string;
}

/**
 * Read the roles/ directory. Returns [] when no roles are present (e.g. old
 * books still on character_matrix.md).
 */
export async function readRoleCards(bookDir: string): Promise<ReadonlyArray<RoleCard>> {
  const rolesRoot = join(bookDir, "story", "roles");
  const majorDirEn = join(rolesRoot, "major");
  const minorDirEn = join(rolesRoot, "minor");
  const majorDirZh = join(rolesRoot, "");
  const minorDirZh = join(rolesRoot, "");

  const cards: RoleCard[] = [];
  await Promise.all([
    collectRoleDir(majorDirEn, "major", cards),
    collectRoleDir(minorDirEn, "minor", cards),
    collectRoleDir(majorDirZh, "major", cards),
    collectRoleDir(minorDirZh, "minor", cards),
  ]);
  return cards;
}

async function collectRoleDir(
  dir: string,
  tier: "major" | "minor",
  out: RoleCard[],
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  const reads = entries
    .filter((entry) => entry.endsWith(".md"))
    .map(async (entry) => {
      const content = await readOr(join(dir, entry), "");
      if (!content.trim()) return;
      out.push({
        tier,
        name: entry.replace(/\.md$/, ""),
        content,
      });
    });
  await Promise.all(reads);
}

/**
 * Render role cards in a format compatible with downstream consumers that
 * previously expected character_matrix.md prose. When no role cards exist,
 * returns the legacy character_matrix.md content or the placeholder.
 */
export async function readCharacterContext(
  bookDir: string,
  fallbackPlaceholder: string = "",
): Promise<string> {
  const cards = await readRoleCards(bookDir);
  if (cards.length > 0) {
    const groups: Record<"major" | "minor", RoleCard[]> = { major: [], minor: [] };
    for (const card of cards) groups[card.tier].push(card);

    const render = (tierCards: RoleCard[], heading: string): string => {
      if (tierCards.length === 0) return "";
      const sections = tierCards.map((card) => `### ${card.name}\n\n${card.content.trim()}`);
      return `## ${heading}\n\n${sections.join("\n\n")}`;
    };

    const blocks = [
      render(groups.major, "Major Characters / Nhân vật chính"),
      render(groups.minor, "Minor Characters / Nhân vật phụ"),
    ].filter(Boolean);

    return blocks.join("\n\n");
  }

  // Fallback: legacy character_matrix.md (may itself be a shim pointer).
  const legacyPath = join(bookDir, "story", "character_matrix.md");
  return readOr(legacyPath, fallbackPlaceholder);
}

// ---------------------------------------------------------------------------
// Phase 5 consolidation: current_state.md initial fallback
// ---------------------------------------------------------------------------

/**
 * Marker substring emitted by architect.writeFoundationFiles when seeding
 * current_state.md. Its presence is how readers detect "nothing real yet".
 */
const CURRENT_STATE_SEED_MARKERS = [
  "Seeded at book creation",
  "Khởi tạo khi tạo sách",
  "",
];

export function isCurrentStateSeedPlaceholder(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return true;
  // Heuristic: short file AND contains one of the seed markers.
  if (trimmed.length > 600) return false;
  return CURRENT_STATE_SEED_MARKERS.some((marker) => trimmed.includes(marker));
}

function extractCurrentStateFromRole(content: string): string | null {
  const pattern = /^##\s*(?:Current[_\s]?State|Trạng[_\s]?thái[_\s]?hiện[_\s]?tại|)[^\n]*$/im;
  const match = content.match(pattern);
  if (!match || match.index === undefined) return null;
  const after = content.slice(match.index + match[0].length);
  // Cut at next `## ` heading (same or higher level).
  const nextHeading = after.search(/^##\s/m);
  const raw = nextHeading >= 0 ? after.slice(0, nextHeading) : after;
  const text = raw.trim();
  return text.length > 0 ? text : null;
}

function extractSeedHooksFromPendingHooks(raw: string): string[] {
  if (!raw.trim()) return [];
  const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
  const seedRows: string[] = [];
  for (const line of lines) {
    if (!line.startsWith("|")) continue;
    if (/^\|\s*-/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 2) continue;
    if (cells[0]?.toLowerCase() === "hook_id" || cells[0] === "hookId") continue;
    const startCh = Number.parseInt(cells[1] ?? "", 10);
    if (!Number.isFinite(startCh) || startCh !== 0) continue;
    // cells[2] type, cells[5] expected payoff, last cell notes
    const notes = cells[cells.length - 1] ?? "";
    const summary = [cells[0], cells[2], notes].filter(Boolean).join(" · ");
    if (summary) seedRows.push(summary);
  }
  return seedRows;
}

/**
 * Read current_state.md; when the file is only a seed placeholder (chapter 0,
 * before consolidator has appended anything), derive an initial-state block
 * from roles/*.Current_State + pending_hooks startChapter=0 rows so callers
 * still have substantive content to feed into writer / analyzer prompts.
 */
export async function readCurrentStateWithFallback(
  bookDir: string,
  fallbackPlaceholder: string = "",
): Promise<string> {
  const storyDir = join(bookDir, "story");
  const currentStatePath = join(storyDir, "current_state.md");
  const raw = await readOr(currentStatePath, "");

  if (!isCurrentStateSeedPlaceholder(raw)) {
    return raw;
  }

  const [cards, pendingHooks] = await Promise.all([
    readRoleCards(bookDir),
    readOr(join(storyDir, "pending_hooks.md"), ""),
  ]);

  const roleLines = cards
    .map((card) => {
      const state = extractCurrentStateFromRole(card.content);
      if (!state) return null;
      const tierLabel = card.tier === "major" ? "Chính" : "Phụ";
      return `- ${card.name} (${tierLabel}): ${state.replace(/\s+/g, " ")}`;
    })
    .filter((line): line is string => line !== null);

  const hookLines = extractSeedHooksFromPendingHooks(pendingHooks);

  if (roleLines.length === 0 && hookLines.length === 0) {
    return raw.trim() ? raw : fallbackPlaceholder;
  }

  const parts: string[] = ["# Initial State (Chapter 0 / Khởi tạo)"];
  if (roleLines.length > 0) {
    parts.push("\n## Character Initial Positions / Tình trạng ban đầu nhân vật");
    parts.push(...roleLines);
  }
  if (hookLines.length > 0) {
    parts.push("\n## Seed Hooks / Manh mối khởi tạo (startChapter = 0)");
    parts.push(...hookLines.map((line) => `- ${line}`));
  }
  return parts.join("\n");
}
