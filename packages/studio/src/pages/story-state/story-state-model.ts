import type {
  ChapterSummariesStateDto,
  CurrentStateFactDto,
  CurrentStateSlotViewDto,
  HookRecordDto,
  StoryCanonViewDto,
} from "../../lib/canon-api";
import { buildCanonUrl } from "../../lib/canon-api";

export type UiLanguage = "zh" | "en";

/**
 * Resolves the canon fetch URL without throwing, so the page can keep a
 * stable React hook order across renders regardless of book-id validity.
 */
export function resolveCanonRequestUrl(bookId: string): { url?: string; error?: string } {
  try {
    return { url: buildCanonUrl(bookId) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Pure display shaping for the read-only Story State page. Everything here is
 * a lossless view over the canonical DTOs — no domain invention, no defaults
 * that could hide data.
 */

export function formatValidityInterval(fact: CurrentStateFactDto, lang: UiLanguage): string {
  const closed = fact.validUntilChapter !== null && fact.validUntilChapter !== undefined;
  if (closed) {
    return lang === "zh"
      ? `第${fact.validFromChapter}–${fact.validUntilChapter}章`
      : `ch.${fact.validFromChapter}–${fact.validUntilChapter}`;
  }
  return lang === "zh" ? `第${fact.validFromChapter}章 起` : `from ch.${fact.validFromChapter}`;
}

export interface SlotRowDto {
  key: string;
  label: string;
  value: string | null;
  supersededCount: number;
  /** Validity of the selected fact; null when the slot is unset. */
  validity: string | null;
  selectedSubject: string | null;
  sourceChapter: number | null;
}

export function slotRows(slots: ReadonlyArray<CurrentStateSlotViewDto>, lang: UiLanguage): SlotRowDto[] {
  return slots.map((slot) => ({
    key: slot.key,
    label: slot.label,
    value: slot.value,
    supersededCount: slot.superseded.length,
    validity: slot.selected ? formatValidityInterval(slot.selected, lang) : null,
    selectedSubject: slot.selected?.subject ?? null,
    sourceChapter: slot.selected?.sourceChapter ?? null,
  }));
}

export interface AdditionalFactRowDto extends CurrentStateFactDto {
  validity: string;
}

export function additionalFactRows(
  facts: ReadonlyArray<CurrentStateFactDto>,
  lang: UiLanguage,
): AdditionalFactRowDto[] {
  return facts.map((fact) => ({ ...fact, validity: formatValidityInterval(fact, lang) }));
}

export interface HookRowDto {
  hookId: string;
  startChapter: number;
  type: string;
  status: HookRecordDto["status"];
  lastAdvancedChapter: number;
  expectedPayoff: string;
  payoffTiming: string;
  dependsOnText: string;
  paysOffInArc: string;
  coreHook: boolean;
  halfLifeChapters: number | "";
  advancedCount: number | "";
  promoted: boolean;
  notes: string;
}

export function hookRows(hooks: ReadonlyArray<HookRecordDto>): HookRowDto[] {
  return [...hooks]
    .sort((left, right) =>
      left.startChapter - right.startChapter || left.hookId.localeCompare(right.hookId))
    .map((hook) => ({
      hookId: hook.hookId,
      startChapter: hook.startChapter,
      type: hook.type,
      status: hook.status,
      lastAdvancedChapter: hook.lastAdvancedChapter,
      expectedPayoff: hook.expectedPayoff ?? "",
      payoffTiming: hook.payoffTiming ?? "",
      dependsOnText: hook.dependsOn && hook.dependsOn.length > 0 ? `[${hook.dependsOn.join(", ")}]` : "—",
      paysOffInArc: hook.paysOffInArc ?? "",
      coreHook: hook.coreHook === true,
      halfLifeChapters: typeof hook.halfLifeChapters === "number" ? hook.halfLifeChapters : "",
      advancedCount: typeof hook.advancedCount === "number" ? hook.advancedCount : "",
      promoted: hook.promoted === true,
      notes: hook.notes ?? "",
    }));
}

export interface ManifestSummaryDto {
  schemaVersion: number;
  language: string;
  lastAppliedChapter: number;
  projectionVersion: number;
  warningCount: number;
  warnings: string[];
}

export function manifestSummary(view: StoryCanonViewDto): ManifestSummaryDto {
  return {
    schemaVersion: view.manifest.schemaVersion,
    language: view.manifest.language,
    lastAppliedChapter: view.manifest.lastAppliedChapter,
    projectionVersion: view.manifest.projectionVersion,
    warningCount: view.manifest.migrationWarnings.length,
    warnings: [...view.manifest.migrationWarnings],
  };
}
