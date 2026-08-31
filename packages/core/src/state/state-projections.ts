import type {
  ChapterSummariesState,
  CurrentStateFact,
  CurrentStateState,
  HooksState,
  RuntimeStateLanguage,
} from "../models/runtime-state.js";
import {
  localizeHookPayoffTiming,
  resolveHookPayoffTiming,
} from "../utils/hook-lifecycle.js";
import {
  computeHookDiagnostics,
  renderHookDiagnosticMarker,
} from "../utils/hook-stale-detection.js";

export function renderHooksProjection(
  state: HooksState,
  language: "vi" | "en" = "vi",
  options?: { readonly currentChapter?: number },
): string {
  const title = language === "en" ? "# Pending Hooks" : "# 伏笔池";
  // Phase 7 + hotfixes 1 & 2: depends_on / pays_off_in_arc / core_hook / half_life / promoted
  // are visible columns, so writer and reviewer both see the causal chain, planned payoff arc,
  // stale threshold, and promotion flag. stale / blocked diagnostic flags are appended to the
  // status cell.
  const headers = language === "en"
    ? [
      "| hook_id | start_chapter | type | status | last_advanced_chapter | expected_payoff | payoff_timing | depends_on | pays_off_in_arc | core_hook | half_life | promoted | notes |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    : [
      "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 回收节奏 | 上游依赖 | 回收卷 | 核心 | 半衰期 | 升级 | 备注 |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ];

  const currentChapter = options?.currentChapter;
  const diagnostics = typeof currentChapter === "number"
    ? computeHookDiagnostics({ hooks: state.hooks, currentChapter })
    : null;

  const rows = [...state.hooks]
    .sort((left, right) => (
      left.startChapter - right.startChapter
      || left.lastAdvancedChapter - right.lastAdvancedChapter
      || left.hookId.localeCompare(right.hookId)
    ))
    .map((hook) => {
      const diag = diagnostics?.get(hook.hookId);
      const marker = diag ? renderHookDiagnosticMarker(diag, language) : "";
      const statusCell = marker
        ? `${hook.status} (${marker})`
        : hook.status;
      return `| ${
        [
          hook.hookId,
          hook.startChapter,
          hook.type,
          statusCell,
          hook.lastAdvancedChapter,
          hook.expectedPayoff,
          localizeHookPayoffTiming(resolveHookPayoffTiming(hook), language),
          renderDependsOnCell(hook.dependsOn ?? [], language),
          hook.paysOffInArc ?? "",
          renderCoreHookCell(hook.coreHook === true, language),
          renderHalfLifeCell(hook.halfLifeChapters),
          renderPromotedCell(hook.promoted, language),
          hook.notes,
        ].map(escapeTableCell).join(" | ")
      } |`;
    });

  return [title, "", ...headers, ...rows, ""].join("\n");
}

function renderDependsOnCell(ids: ReadonlyArray<string>, language: "vi" | "en"): string {
  if (ids.length === 0) return language === "en" ? "none" : "无";
  return `[${ids.join(", ")}]`;
}

function renderCoreHookCell(isCore: boolean, language: "vi" | "en"): string {
  if (language === "en") return isCore ? "true" : "false";
  return isCore ? "是" : "否";
}

function renderHalfLifeCell(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "";
  return String(Math.trunc(value));
}

function renderPromotedCell(value: boolean | undefined, language: "vi" | "en"): string {
  if (value === undefined) return "";
  if (language === "en") return value ? "true" : "false";
  return value ? "是" : "否";
}

export function renderChapterSummariesProjection(
  state: ChapterSummariesState,
  language: "vi" | "en" = "vi",
): string {
  const title = language === "en" ? "# Chapter Summaries" : "# 章节摘要";
  const headers = language === "en"
    ? [
      "| Chapter | Title | Characters | Key Events | State Changes | Hook Activity | Mood | Chapter Type |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    : [
      "| 章节 | 标题 | 出场人物 | 关键事件 | 状态变化 | 伏笔动态 | 情绪基调 | 章节类型 |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ];

  const rows = [...state.rows]
    .sort((left, right) => left.chapter - right.chapter)
    .map((summary) => `| ${
      [
        summary.chapter,
        summary.title,
        summary.characters,
        summary.events,
        summary.stateChanges,
        summary.hookActivity,
        summary.mood,
        summary.chapterType,
      ].map(escapeTableCell).join(" | ")
    } |`);

  return [title, "", ...headers, ...rows, ""].join("\n");
}

/**
 * THE single alias table for the six fixed current-state slots (Phase 4
 * blocker-7): language-ordered lists whose FIRST entry is the canonical
 * predicate the reducer persists and the State Review converter proposes.
 * Every other vocabulary (slot defs below, display labels, reducer patch
 * application, review items) is derived from or routed through this table —
 * no duplicate slot→predicate mapping may exist elsewhere.
 */
const CURRENT_STATE_SLOT_ALIASES: Readonly<Record<
  RuntimeStateLanguage,
  Readonly<Record<CurrentStateSlotKey, ReadonlyArray<string>>>
>> = {
  vi: {
    currentLocation: ["Vị trí hiện tại", "Current Location", "当前位置"],
    protagonistState: ["Trạng thái nhân vật chính", "Protagonist State", "主角状态"],
    currentGoal: ["Mục tiêu hiện tại", "Current Goal", "当前目标"],
    currentConstraint: ["Ràng buộc hiện tại", "Current Constraint", "当前限制"],
    currentAlliances: ["Quan hệ hiện tại", "Current Alliances", "Current Relationships", "当前敌我"],
    currentConflict: ["Xung đột hiện tại", "Current Conflict", "当前冲突"],
  },
  en: {
    currentLocation: ["Current Location", "Vị trí hiện tại", "当前位置"],
    protagonistState: ["Protagonist State", "Trạng thái nhân vật chính", "主角状态"],
    currentGoal: ["Current Goal", "Mục tiêu hiện tại", "当前目标"],
    currentConstraint: ["Current Constraint", "Ràng buộc hiện tại", "当前限制"],
    currentAlliances: ["Current Alliances", "Current Relationships", "Quan hệ hiện tại", "当前敌我"],
    currentConflict: ["Current Conflict", "Xung đột hiện tại", "当前冲突"],
  },
};

/** Ordered aliases for one slot under one book language (first = canonical predicate). */
export function currentStateSlotAliases(
  slot: CurrentStateSlotKey,
  language: RuntimeStateLanguage,
): ReadonlyArray<string> {
  return CURRENT_STATE_SLOT_ALIASES[language][slot];
}

/**
 * Phase 4 shared semantic description of a patch slot: the exact subject and
 * predicate `applyCurrentStatePatch` persists for it, consumed verbatim by the
 * RuntimeStateDelta → ReviewItem converter so review cards can never disagree
 * with what the engine would write.
 */
export function describeCurrentStateSlot(
  slot: CurrentStateSlotKey,
  language: RuntimeStateLanguage,
): { readonly subject: "protagonist"; readonly predicate: string } {
  return { subject: "protagonist", predicate: CURRENT_STATE_SLOT_ALIASES[language][slot][0]! };
}

/**
 * Canonical slot keys for the six fixed current-state patch slots, shared by
 * the markdown renderer and the structured-state description used by Studio.
 * Derived from the single alias table above; do not duplicate them elsewhere.
 */
export type CurrentStateSlotKey =
  | "currentLocation"
  | "protagonistState"
  | "currentGoal"
  | "currentConstraint"
  | "currentAlliances"
  | "currentConflict";

export interface CurrentStateSlotDef {
  readonly key: CurrentStateSlotKey;
  readonly aliases: ReadonlyArray<string>;
}

export const CURRENT_STATE_SLOT_DEFS: ReadonlyArray<CurrentStateSlotDef> =
  (Object.keys(CURRENT_STATE_SLOT_ALIASES.en) as CurrentStateSlotKey[]).map((key) => ({
    key,
    aliases: CURRENT_STATE_SLOT_ALIASES.en[key]!,
  }));

const CURRENT_STATE_SLOT_LABELS: Record<"vi" | "en", Record<CurrentStateSlotKey, string>> = {
  vi: Object.fromEntries(
    (Object.keys(CURRENT_STATE_SLOT_ALIASES.vi) as CurrentStateSlotKey[]).map((key) => [
      key,
      CURRENT_STATE_SLOT_ALIASES.vi[key]![0],
    ]),
  ) as Record<CurrentStateSlotKey, string>,
  en: Object.fromEntries(
    (Object.keys(CURRENT_STATE_SLOT_ALIASES.en) as CurrentStateSlotKey[]).map((key) => [
      key,
      CURRENT_STATE_SLOT_ALIASES.en[key]![0],
    ]),
  ) as Record<CurrentStateSlotKey, string>,
};

export function renderCurrentStateProjection(
  state: CurrentStateState,
  language: "vi" | "en" = "vi",
): string {
  const layout = language === "en"
    ? {
      title: "# Current State",
      tableHeader: "| Field | Value |",
      labels: {
        chapter: "Current Chapter",
        ...CURRENT_STATE_SLOT_LABELS.en,
      },
      placeholders: "(not set)",
      additionalTitle: "## Additional State",
    }
    : {
      title: "# Trạng thái hiện tại",
      tableHeader: "| Trường | Giá trị |",
      labels: {
        chapter: "Chương hiện tại",
        ...CURRENT_STATE_SLOT_LABELS.vi,
      },
      placeholders: "(chưa thiết lập)",
      additionalTitle: "## Trạng thái bổ sung",
    };

  const slots = CURRENT_STATE_SLOT_DEFS.map((def) => ({
    label: layout.labels[def.key],
    aliases: def.aliases,
  }));

  const knownPredicates = new Set(
    slots.flatMap((slot) => slot.aliases.map(normalizePredicate)),
  );
  const lines = [
    layout.title,
    "",
    layout.tableHeader,
    "| --- | --- |",
    `| ${layout.labels.chapter} | ${escapeTableCell(state.chapter)} |`,
    ...slots.map((slot) => {
      const value = findFactValue(state, slot.aliases) ?? layout.placeholders;
      return `| ${slot.label} | ${escapeTableCell(value)} |`;
    }),
  ];

  const additionalFacts = [...state.facts]
    .filter((fact) => !knownPredicates.has(normalizePredicate(fact.predicate)))
    .sort((left, right) => compareAdditionalFacts(left.predicate, right.predicate));

  if (additionalFacts.length === 0) {
    return [...lines, ""].join("\n");
  }

  return [
    ...lines,
    "",
    layout.additionalTitle,
    ...additionalFacts.map((fact) => renderAdditionalFact(fact.predicate, fact.object)),
    "",
  ].join("\n");
}

function findFactValue(
  state: CurrentStateState,
  aliases: ReadonlyArray<string>,
): string | undefined {
  const aliasSet = new Set(aliases.map(normalizePredicate));
  return state.facts.find((fact) => aliasSet.has(normalizePredicate(fact.predicate)))?.object;
}

function renderAdditionalFact(predicate: string, object: string): string {
  if (/^note_\d+$/i.test(predicate)) {
    return `- ${object}`;
  }
  return `- ${predicate}: ${object}`;
}

function compareAdditionalFacts(left: string, right: string): number {
  const leftNote = left.match(/^note_(\d+)$/i);
  const rightNote = right.match(/^note_(\d+)$/i);
  if (leftNote && rightNote) {
    return Number.parseInt(leftNote[1] ?? "0", 10) - Number.parseInt(rightNote[1] ?? "0", 10);
  }
  if (leftNote) return -1;
  if (rightNote) return 1;
  return left.localeCompare(right);
}

function normalizePredicate(value: string): string {
  return value.trim().toLowerCase();
}

function escapeTableCell(value: string | number): string {
  return String(value).replace(/\|/g, "\\|").trim();
}

/**
 * Structured, display-oriented description of the current state. This is the
 * read-side companion to {@link renderCurrentStateProjection}: same slot
 * definitions, same alias matching, same additional-fact filter and ordering —
 * but it keeps fact identity (subject, validity intervals, source chapter)
 * instead of collapsing everything into table cells.
 *
 * Selection note: when several facts share a slot predicate (e.g. a closed
 * historical interval plus an open one), this prefers the OPEN interval so
 * viewers surface live canon, and reports the remaining matches as
 * `superseded`. The markdown renderer keeps its historical first-match
 * behavior; that display-only divergence is intentional.
 */
export interface CurrentStateSlotView {
  readonly key: CurrentStateSlotKey;
  readonly label: string;
  /** Value of the selected (open-preferred) fact; null when the slot is unset. */
  readonly value: string | null;
  readonly selected: CurrentStateFact | null;
  /** Other facts sharing the slot predicate — closed history is kept visible. */
  readonly superseded: ReadonlyArray<CurrentStateFact>;
}

export interface CurrentStateDescription {
  readonly chapter: number;
  readonly slots: ReadonlyArray<CurrentStateSlotView>;
  /** Every non-slot fact, in the renderer's additional-fact order. */
  readonly additionalFacts: ReadonlyArray<CurrentStateFact>;
}

export function describeCurrentState(
  state: CurrentStateState,
  language: "vi" | "en" = "vi",
): CurrentStateDescription {
  const labels = CURRENT_STATE_SLOT_LABELS[language];
  const knownPredicates = new Set(
    CURRENT_STATE_SLOT_DEFS.flatMap((def) => def.aliases.map(normalizePredicate)),
  );

  const slots = CURRENT_STATE_SLOT_DEFS.map((def) => {
    const aliasSet = new Set(def.aliases.map(normalizePredicate));
    const matches = state.facts.filter((fact) => aliasSet.has(normalizePredicate(fact.predicate)));
    const selected = matches.find((fact) => fact.validUntilChapter === null) ?? matches[0] ?? null;
    return {
      key: def.key,
      label: labels[def.key],
      value: selected?.object ?? null,
      selected,
      superseded: matches.filter((fact) => fact !== selected),
    };
  });

  const additionalFacts = [...state.facts]
    .filter((fact) => !knownPredicates.has(normalizePredicate(fact.predicate)))
    .sort((left, right) => compareAdditionalFacts(left.predicate, right.predicate));

  return {
    chapter: state.chapter,
    slots,
    additionalFacts,
  };
}
