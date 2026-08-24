import type {
  CanonCommitOutcome,
  CanonCommitRequestPayload,
  CanonEditPayload,
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

// --- T3B: manual-edit model layer (pure, UI-framework-free) ---

/**
 * The exact honest Core warning for a failed derived-memory invalidation.
 * The UI must NEVER hide this string when the server reports it.
 */
export const DERIVED_MEMORY_WARNING_TEXT =
  "derived memory invalidation failed; memory.db may be stale";

const trim = (value: string | undefined): string => (value ?? "").trim();

/** Author-facing semantic edit — temporal fields are server-owned, never sent. */
export function buildSetFactEdit(subject: string, predicate: string, object: string): CanonEditPayload {
  return { kind: "setFact", subject: trim(subject), predicate: trim(predicate), object: trim(object) };
}

export function buildRemoveFactEdit(subject: string, predicate: string): CanonEditPayload {
  const edit: { kind: "removeFact"; subject: string; predicate: string } = {
    kind: "removeFact",
    subject: trim(subject),
    predicate: trim(predicate),
  };
  return edit;
}

export function buildCommitRequest(
  edits: readonly CanonEditPayload[],
  expectedRevision: string,
): CanonCommitRequestPayload {
  return { edits: [...edits], expectedRevision };
}

/** Bilingual draft validation; empty list ⇒ ready to save. */
export function validateFactDraft(input: {
  readonly subject?: string;
  readonly predicate?: string;
  readonly object?: string;
}): string[] {
  const issues: string[] = [];
  if (!trim(input.subject)) issues.push("主体不能为空 · Subject is required");
  if (!trim(input.predicate)) issues.push("谓词不能为空 · Predicate is required");
  if (!trim(input.object)) issues.push("值不能为空 · Value is required");
  return issues;
}

export interface SaveOutcomeView {
  tone: "success" | "warning" | "conflict" | "locked" | "error";
  /** True when the canon save itself landed (success and success-with-warnings). */
  saved: boolean;
  title: string;
  detail: string;
  issues: string[];
  warnings: string[];
  /** Conflict UX: surface a refetch button; the buffer is discarded. */
  showRefetch: boolean;
  keepBuffer: boolean;
  currentRevision?: string;
}

function issueTexts(issues: ReadonlyArray<{ scope?: string; code?: string; message: string }>): string[] {
  return issues.map((issue) =>
    [issue.scope, issue.message].filter(Boolean).join(": "),
  );
}

/**
 * Pure presentation shaping for a mutation outcome (T3B conflict/warning UX).
 * A successful save with warnings stays SAVED — warnings render visibly but
 * never masquerade as failure; a conflict demands refetch + re-apply with no
 * silent retry.
 */
export function saveOutcomeToUi(outcome: CanonCommitOutcome, lang: UiLanguage): SaveOutcomeView {
  const zh = lang === "zh";
  switch (outcome.status) {
    case "success": {
      const hasWarnings = outcome.warnings.length > 0;
      return {
        tone: hasWarnings ? "warning" : "success",
        saved: true,
        title: hasWarnings
          ? zh ? "已保存（附警告）" : "Saved (with warnings)"
          : zh ? "已保存" : "Saved",
        detail: hasWarnings
          ? zh ? "规范状态已更新，但派生数据需要关注。" : "Canonical state updated, but derived data needs attention."
          : zh ? "规范状态已更新。" : "Canonical state updated.",
        issues: [],
        warnings: [...outcome.warnings],
        showRefetch: false,
        keepBuffer: false,
      };
    }
    case "canon_conflict":
      return {
        tone: "conflict",
        saved: false,
        title: zh ? "保存被拒绝：状态已过期" : "Save rejected: state is stale",
        detail:
          zh
            ? "故事状态已被其他操作更新。请刷新最新状态后重新应用你的修改。"
            : "The story state changed elsewhere. Refetch the latest state and re-apply your edit.",
        issues: [],
        warnings: [],
        showRefetch: true,
        keepBuffer: false,
        currentRevision: outcome.currentRevision,
      };
    case "book_write_locked":
      return {
        tone: "locked",
        saved: false,
        title: zh ? "书籍正被写入任务锁定" : "Book is locked by a write task",
        detail: outcome.message,
        issues: [],
        warnings: [],
        showRefetch: false,
        keepBuffer: true,
      };
    case "canon_unavailable":
      return {
        tone: "error",
        saved: false,
        title: zh ? "规范状态不可用" : "Canonical state unavailable",
        detail: outcome.message,
        issues: issueTexts(outcome.issues),
        warnings: [],
        showRefetch: false,
        keepBuffer: true,
      };
    case "invalid_request":
      return {
        tone: "error",
        saved: false,
        title: zh ? "编辑未通过校验" : "Edit failed validation",
        detail: outcome.message,
        issues: issueTexts(outcome.issues),
        warnings: [],
        showRefetch: false,
        keepBuffer: true,
      };
    case "unexpected":
      return {
        tone: "error",
        saved: false,
        title: zh ? "保存失败" : "Save failed",
        detail: outcome.message,
        issues: [],
        warnings: [],
        showRefetch: false,
        keepBuffer: true,
      };
  }
}
