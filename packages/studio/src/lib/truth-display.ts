// Pure helpers for presenting a book's "truth" files in the sidebar as
// reader-facing content instead of raw structured/engineering text. Non-coder
// authors should never see YAML frontmatter, generator scaffolding, or
// deprecated compat-pointer prose — these helpers translate the on-disk format
// into friendly cards and clean prose. Display labels follow the app language
// (getAppLanguage / tr); the default stays "vi" so existing behavior and
// tests are unchanged.

import { getAppLanguage, tr } from "./app-language";

export interface TruthFrontmatter {
  readonly protagonist?: { readonly name?: string; readonly personalityLock?: ReadonlyArray<string> };
  readonly genreLock?: { readonly primary?: string };
  readonly eraConstraints?: { readonly enabled?: boolean; readonly period?: string; readonly region?: string };
  readonly prohibitions?: ReadonlyArray<string>;
  readonly fanficMode?: "canon" | "au" | "ooc" | "cp";
}

export interface DisplayCard {
  readonly label: string;
  readonly values: ReadonlyArray<string>;
}

const FANFIC_LABELS: Record<string, { readonly vi: string; readonly en: string }> = {
  canon: { vi: "Bám theo nguyên tác", en: "Canon-compliant" },
  au: { vi: "Thế giới song song (AU)", en: "Alternate Universe" },
  ooc: { vi: "Nhân vật lệch chuẩn (OOC)", en: "OOC" },
  cp: { vi: "Theo cặp đôi (CP)", en: "Pairing (CP)" },
};

// Turn the structured frontmatter of story_frame.md into a few reader-friendly
// cards. Only story-meaningful fields surface; engineering/tuning fields
// (audit dimensions, fatigue words, numeric overrides, version) are omitted on
// purpose so the reader sees story facts, not generator config.
export function frontmatterToCards(fm: TruthFrontmatter | null | undefined): ReadonlyArray<DisplayCard> {
  if (!fm) return [];
  const cards: DisplayCard[] = [];
  const name = fm.protagonist?.name?.trim();
  if (name) cards.push({ label: tr("Nhân vật chính", "Protagonist"), values: [name] });
  const genre = fm.genreLock?.primary?.trim();
  if (genre) cards.push({ label: tr("Thể loại", "Genre"), values: [genre] });
  const era = fm.eraConstraints;
  if (era?.enabled) {
    const eraValues = [era.period, era.region]
      .map((v) => v?.trim())
      .filter((v): v is string => Boolean(v));
    if (eraValues.length > 0) cards.push({ label: tr("Bối cảnh thời đại", "Era"), values: eraValues });
  }
  const prohibitions = (fm.prohibitions ?? []).map((p) => p.trim()).filter(Boolean);
  if (prohibitions.length > 0) cards.push({ label: tr("Giới hạn cứng", "Hard Lines"), values: prohibitions });
  if (fm.fanficMode) {
    const fanficLabel = FANFIC_LABELS[fm.fanficMode];
    cards.push({
      label: tr("Chế độ fanfic", "Fanfic Mode"),
      values: [fanficLabel ? tr(fanficLabel.vi, fanficLabel.en) : fm.fanficMode],
    });
  }
  return cards;
}

// Drop the architect's structural delimiters that occasionally survive into a
// file body (=== SECTION: x ===, ---ROLE---, ---CONTENT---). These are
// scaffolding for the generator, never meaningful to a reader. Plain markdown
// horizontal rules (---) are left untouched.
export function stripStructuralMarkers(text: string): string {
  if (!text) return "";
  return text
    .split("\n")
    .filter(
      (line) =>
        !/^\s*===\s*SECTION:.*===\s*$/.test(line) && !/^\s*---(?:ROLE|CONTENT)---\s*$/.test(line),
    )
    .join("\n")
    .trim();
}

// The architect plans the outline with an "OKR recursive" method, so the
// generated story_frame / volume_map prose carries management jargon
// Truth display formatting.
// content wearing engineering clothes — relabel it to plain Chinese for the
// reader. Only touches Chinese documents so an English book's prose is left
// intact (no zh labels spliced into English text). In the English UI the
// relabeling is skipped entirely — English readers should not have "Key
// Results" rewritten into Chinese labels. Display-only; raw file is unchanged.
export function relabelOkrJargon(text: string): string {
  if (getAppLanguage() === "en") return text;
  if (!text || !/[-]/.test(text)) return text;
  return text
    .replace(/\s*OKR\s*[（(]\s*Objective\s*\+\s*Key\s*Results\s*[）)]/gi, "")
    .replace(/\bKR\s*(\d+)/gi, "$1")
    .replace(/Key\s*Results?/gi, "")
    .replace(/\bOKR\b/gi, "")
    .replace(/\s?Objective\b/g, "")
    .replace(/\bKR\b/gi, "");
}

// First non-empty prose paragraph of a body, for an at-a-glance overview. A
// leading markdown heading on the paragraph is dropped so the glance is prose.
export function firstParagraph(text: string): string {
  const stripped = stripStructuralMarkers(text);
  for (const chunk of stripped.split(/\n{2,}/)) {
    const withoutHeading = chunk.replace(/^\s*#{1,6}\s+[^\n]*\n?/, "").trim();
    if (withoutHeading) return withoutHeading;
  }
  return "";
}

export interface RoleRef {
  readonly path: string;
  readonly name: string;
  readonly tier: "major" | "minor";
}

// Parse a roles/<tier>/<name>.md truth path (major or minor dirs) into a
// character reference. Returns null for any non-role path.
export function roleFromPath(path: string): RoleRef | null {
  const m = path.match(/^roles\/(major|minor|Nhân vật chính|Nhân vật phụ)\/(.+)\.md$/);
  if (!m) return null;
  const tier = m[1] === "major" || m[1] === "Nhân vật chính" ? "major" : "minor";
  return { path, name: m[2], tier };
}

// Friendly labels + display order for foundation truth files, covering both the
// Phase 5 outline/* layout and the pre-Phase-5 flat layout. Character files
// (roles/*, character_matrix.md) are intentionally absent — they belong to the
// character roster, not the foundation list. Files absent from this map are not
// shown in the foundation list. This vi map is the registry of which files
// qualify; use foundationFileLabel() for the language-aware display label.
export const FOUNDATION_FILE_LABELS: Record<string, string> = {
  "outline/story_frame.md": "Nền tảng truyện",
  "outline/volume_map.md": "Kế hoạch tập",
  "current_state.md": "Trạng thái hiện tại",
  "pending_hooks.md": "Kho tiền đề",
  "emotional_arcs.md": "Cung cảm xúc",
  "subplot_board.md": "Tiến độ nhánh phụ",
  // Pre-Phase-5 flat layout — only reached for old books; new books tag these
  // (story_bible.md / book_rules.md) as legacy and they are filtered out.
  "story_bible.md": "Cài đặt thế giới quan",
  "volume_outline.md": "Kế hoạch tập",
  "book_rules.md": "Quy tắc tự sự",
};

const FOUNDATION_FILE_LABELS_EN: Record<string, string> = {
  "outline/story_frame.md": "Story Foundation",
  "outline/volume_map.md": "Volume Map",
  "current_state.md": "Current State",
  "pending_hooks.md": "Hook Pool",
  "emotional_arcs.md": "Emotional Arcs",
  "subplot_board.md": "Subplot Board",
  "story_bible.md": "World Bible",
  "volume_outline.md": "Volume Map",
  "book_rules.md": "Narrative Rules",
};

// Language-aware display label for a foundation truth file. Returns undefined
// for files that are not part of the foundation list (same qualification as
// FOUNDATION_FILE_LABELS).
export function foundationFileLabel(name: string): string | undefined {
  const vi = FOUNDATION_FILE_LABELS[name];
  if (vi === undefined) return undefined;
  return getAppLanguage() === "en" ? FOUNDATION_FILE_LABELS_EN[name] ?? vi : vi;
}

// --- current_state.md ---------------------------------------------------

// At book creation current_state.md holds only an engineering seed note
// (referencing the consolidator / roles/*.Current_State / pending_hooks startChapter=0)
// that means nothing to a reader. The consolidator later APPENDS real state
// after each chapter, so we strip the seed note and report whether any real
// runtime state exists yet.
export function presentCurrentState(content: string): { readonly isEmpty: boolean; readonly body: string } {
  const body = content
    .split("\n")
    .filter((line) => !/Seeded at book creation|Khởi tạo khi tạo sách||consolidator/.test(line))
    .join("\n")
    .trim();
  // After dropping the seed note, is there any real state text beyond the heading?
  const meaningful = body
    .replace(/^#{1,6}\s+.*$/gm, "")
    .replace(/^>\s*$/gm, "")
    .trim();
  return { isEmpty: meaningful.length === 0, body };
}

// --- emotional_arcs.md (and other runtime tables) -----------------------

// A markdown table seeded with only its header row (no data) reads as "empty"
// to a user. emotional_arcs.md is seeded this way at book creation and filled
// per-chapter during writing, so we detect the header-only state to show a
// friendly empty message instead of a blank table.
export function hasTableRows(md: string): boolean {
  const rows = md
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|") && !/^\|\s*-{2,}/.test(l));
  // rows = header + data rows (the | --- | separator is excluded); >1 ⇒ has data.
  return rows.length > 1;
}

// --- pending_hooks.md ----------------------------------------------------

export interface PendingHook {
  readonly id: string;
  readonly type: string; // Loại manh mối
  readonly content: string; // Ghi chú / nội dung
  readonly payoff: string; // Tập thu hồi
  readonly core: boolean; // Cốt lõi
  readonly promoted?: boolean; // Nâng cấp
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

// pending_hooks.md is a tracking table. Only a few columns are
// reader-facing; parse the table by header name (robust to column reordering)
// and keep the meaningful ones so the UI can render browsable cards instead of
// an unreadable wide table.
export function parsePendingHooks(md: string): ReadonlyArray<PendingHook> {
  const rows = md.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("|"));
  if (rows.length < 2) return [];
  const header = splitTableRow(rows[0]);
  const colOf = (...names: string[]) => header.findIndex((h) => names.map((n) => n.toLowerCase()).includes(h.toLowerCase()));
  const idIdx = colOf("hook_id", "hookId", "id");
  const typeIdx = colOf("type", "loại", "thể loại", "");
  const payoffIdx = colOf("payoff", "payoff_arc", "tập thu hồi", "thu hồi", "");
  const coreIdx = colOf("core", "cốt lõi", "chính", "");
  const promotedIdx = colOf("promoted", "nâng cấp", "");
  const contentIdx = colOf("notes", "ghi chú", "nội dung", "");

  return rows
    .slice(1)
    .filter((line) => !/^\|\s*-{2,}/.test(line)) // drop the | --- | --- | separator
    .map(splitTableRow)
    .filter((cells) => cells.length === header.length)
    .map((cells) => ({
      id: idIdx >= 0 ? cells[idIdx] : "",
      type: typeIdx >= 0 ? cells[typeIdx] : "",
      content: contentIdx >= 0 ? cells[contentIdx] : "",
      payoff: payoffIdx >= 0 ? cells[payoffIdx] : "",
      core: coreIdx >= 0 && (cells[coreIdx] === "true" || cells[coreIdx] === "yes" || cells[coreIdx] === "có" || cells[coreIdx] === ""),
      promoted: promotedIdx >= 0 ? parsePromotedCell(cells[promotedIdx]) : undefined,
    }))
    .filter((hook) => hook.content.length > 0 || hook.id.length > 0);
}

function parsePromotedCell(cell: string | undefined): boolean | undefined {
  const normalized = (cell ?? "").trim().toLowerCase();
  if (!normalized) return undefined;
  if (/^(true|yes|y|có|co|1|✓|✔|promoted|nâng cấp|đã nâng cấp|core||)$/i.test(normalized)) return true;
  if (/^(false|no|n|không|khong|seed|0|✗|✘|chưa nâng cấp||)$/i.test(normalized)) return false;
  return undefined;
}

export const FOUNDATION_FILE_ORDER: ReadonlyArray<string> = [
  "outline/story_frame.md",
  "outline/volume_map.md",
  "story_bible.md",
  "volume_outline.md",
  "book_rules.md",
  "current_state.md",
  "pending_hooks.md",
  "emotional_arcs.md",
  "subplot_board.md",
];
