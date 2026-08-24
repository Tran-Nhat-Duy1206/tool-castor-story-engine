import type {
  ChapterSummariesState,
  CurrentStateFact,
  CurrentStateState,
  HooksState,
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
  language: "zh" | "en" = "zh",
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

function renderDependsOnCell(ids: ReadonlyArray<string>, language: "zh" | "en"): string {
  if (ids.length === 0) return language === "en" ? "none" : "无";
  return `[${ids.join(", ")}]`;
}

function renderCoreHookCell(isCore: boolean, language: "zh" | "en"): string {
  if (language === "en") return isCore ? "true" : "false";
  return isCore ? "是" : "否";
}

function renderHalfLifeCell(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "";
  return String(Math.trunc(value));
}

function renderPromotedCell(value: boolean | undefined, language: "zh" | "en"): string {
  if (value === undefined) return "";
  if (language === "en") return value ? "true" : "false";
  return value ? "是" : "否";
}

export function renderChapterSummariesProjection(
  state: ChapterSummariesState,
  language: "zh" | "en" = "zh",
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
 * Canonical slot keys for the six fixed current-state patch slots, shared by
 * the markdown renderer and the structured-state description used by Studio.
 * The alias lists are the single source of truth for which fact predicates
 * map to which slot — do not duplicate them elsewhere.
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

export const CURRENT_STATE_SLOT_DEFS: ReadonlyArray<CurrentStateSlotDef> = [
  { key: "currentLocation", aliases: ["Current Location", "当前位置"] },
  { key: "protagonistState", aliases: ["Protagonist State", "主角状态"] },
  { key: "currentGoal", aliases: ["Current Goal", "当前目标"] },
  { key: "currentConstraint", aliases: ["Current Constraint", "当前限制"] },
  { key: "currentAlliances", aliases: ["Current Alliances", "Current Relationships", "当前敌我"] },
  { key: "currentConflict", aliases: ["Current Conflict", "当前冲突"] },
];

const CURRENT_STATE_SLOT_LABELS: Record<"zh" | "en", Record<CurrentStateSlotKey, string>> = {
  zh: {
    currentLocation: "当前位置",
    protagonistState: "主角状态",
    currentGoal: "当前目标",
    currentConstraint: "当前限制",
    currentAlliances: "当前敌我",
    currentConflict: "当前冲突",
  },
  en: {
    currentLocation: "Current Location",
    protagonistState: "Protagonist State",
    currentGoal: "Current Goal",
    currentConstraint: "Current Constraint",
    currentAlliances: "Current Alliances",
    currentConflict: "Current Conflict",
  },
};

export function renderCurrentStateProjection(
  state: CurrentStateState,
  language: "zh" | "en" = "zh",
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
      title: "# 当前状态",
      tableHeader: "| 字段 | 值 |",
      labels: {
        chapter: "当前章节",
        ...CURRENT_STATE_SLOT_LABELS.zh,
      },
      placeholders: "（未设定）",
      additionalTitle: "## 其他状态",
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
  language: "zh" | "en" = "zh",
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
