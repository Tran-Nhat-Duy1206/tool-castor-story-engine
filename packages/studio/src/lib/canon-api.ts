import { fetchJson } from "../hooks/use-api";

/**
 * Typed client for the read-only canonical Story State boundary
 * (`GET /api/v1/books/:id/canon`). The browser never sees filesystem paths —
 * only book ids — and there is deliberately no mutation method here.
 */

export type CanonSection = "manifest" | "current_state" | "hooks" | "chapter_summaries";

export const CANON_SECTION_VALUES: ReadonlyArray<CanonSection> = [
  "manifest",
  "current_state",
  "hooks",
  "chapter_summaries",
];

export interface StateManifestDto {
  schemaVersion: number;
  language: string;
  lastAppliedChapter: number;
  projectionVersion: number;
  migrationWarnings: string[];
}

export interface CurrentStateFactDto {
  subject: string;
  predicate: string;
  object: string;
  validFromChapter: number;
  validUntilChapter: number | null;
  sourceChapter: number;
}

export interface CurrentStateStateDto {
  chapter: number;
  facts: CurrentStateFactDto[];
}

export type HookStatusDto = "open" | "progressing" | "deferred" | "resolved";

export interface HookRecordDto {
  hookId: string;
  startChapter: number;
  type: string;
  status: HookStatusDto;
  lastAdvancedChapter: number;
  expectedPayoff?: string;
  payoffTiming?: string;
  notes?: string;
  dependsOn?: string[];
  paysOffInArc?: string;
  coreHook?: boolean;
  halfLifeChapters?: number;
  advancedCount?: number;
  promoted?: boolean;
}

export interface HooksStateDto {
  hooks: HookRecordDto[];
}

export interface ChapterSummaryRowDto {
  chapter: number;
  title: string;
  characters: string;
  events: string;
  stateChanges: string;
  hookActivity: string;
  mood: string;
  chapterType: string;
}

export interface ChapterSummariesStateDto {
  rows: ChapterSummaryRowDto[];
}

/** Core-computed slot view (mirrors `describeCurrentState` output). */
export interface CurrentStateSlotViewDto {
  key: string;
  label: string;
  value: string | null;
  selected: CurrentStateFactDto | null;
  superseded: CurrentStateFactDto[];
}

export interface CurrentStateDescriptionDto {
  chapter: number;
  slots: CurrentStateSlotViewDto[];
  additionalFacts: CurrentStateFactDto[];
}

/** Shape of `GET /api/v1/books/:id/canon` (no section). */
export interface StoryCanonViewDto {
  bookId: string;
  manifest: StateManifestDto;
  currentState: CurrentStateStateDto;
  hooks: HooksStateDto;
  chapterSummaries: ChapterSummariesStateDto;
  /** Display projection of currentState computed by Core; raw fields above remain authoritative. */
  description: CurrentStateDescriptionDto;
}

/** Shape of `GET /api/v1/books/:id/canon?section=…`. */
export interface StoryCanonSectionDto<TData = unknown> {
  bookId: string;
  section: CanonSection;
  data: TData;
}

export function buildCanonUrl(bookId: string, section?: CanonSection): string {
  if (!bookId || /[/\\]|\.\./.test(bookId)) {
    // Defense-in-depth: the server's membership check already blocks unknown
    // ids, but the client must never construct path-traversing URLs.
    throw new Error(`Invalid book id: "${bookId}"`);
  }
  const base = `/api/v1/books/${encodeURIComponent(bookId)}/canon`;
  return section ? `${base}?section=${section}` : base;
}

export function fetchCanon(
  bookId: string,
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<StoryCanonViewDto> {
  return fetchJson<StoryCanonViewDto>(buildCanonUrl(bookId), {}, deps);
}

export function fetchCanonSection<TData = unknown>(
  bookId: string,
  section: CanonSection,
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<StoryCanonSectionDto<TData>> {
  return fetchJson<StoryCanonSectionDto<TData>>(buildCanonUrl(bookId, section), {}, deps);
}
