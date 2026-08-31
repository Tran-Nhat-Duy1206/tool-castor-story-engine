import type { AuditIssue } from "../agents/continuity.js";
import type { HookRecord, RuntimeStateDelta } from "../models/runtime-state.js";
import { classifyHookDisposition, collectStaleHookDebt } from "./hook-governance.js";
import { describeHookLifecycle, localizeHookPayoffTiming, normalizeStoredHookStatus } from "./hook-lifecycle.js";
import { HOOK_HEALTH_DEFAULTS } from "./hook-policy.js";

export function analyzeHookHealth(params: {
  readonly language: "vi" | "en";
  readonly chapterNumber: number;
  readonly targetChapters?: number;
  readonly hooks: ReadonlyArray<HookRecord>;
  readonly delta?: Pick<RuntimeStateDelta, "chapter" | "hookOps">;
  readonly existingHookIds?: ReadonlyArray<string>;
  readonly maxActiveHooks?: number;
  readonly staleAfterChapters?: number;
  readonly noAdvanceWindow?: number;
  readonly newHookBurstThreshold?: number;
}): AuditIssue[] {
  const maxActiveHooks = params.maxActiveHooks ?? HOOK_HEALTH_DEFAULTS.maxActiveHooks;
  const staleAfterChapters = params.staleAfterChapters ?? HOOK_HEALTH_DEFAULTS.staleAfterChapters;
  const noAdvanceWindow = params.noAdvanceWindow ?? HOOK_HEALTH_DEFAULTS.noAdvanceWindow;
  const newHookBurstThreshold = params.newHookBurstThreshold ?? HOOK_HEALTH_DEFAULTS.newHookBurstThreshold;
  const issues: AuditIssue[] = [];

  const activeHooks = params.hooks.filter((hook) => {
    const status = normalizeStoredHookStatus(hook.status);
    return status !== "resolved" && status !== "deferred";
  });
  const lifecycleEntries = activeHooks.map((hook) => ({
    hook,
    lifecycle: describeHookLifecycle({
      payoffTiming: hook.payoffTiming,
      expectedPayoff: hook.expectedPayoff,
      notes: hook.notes,
      startChapter: hook.startChapter,
      lastAdvancedChapter: hook.lastAdvancedChapter,
      status: hook.status,
      chapterNumber: params.chapterNumber,
      targetChapters: params.targetChapters,
    }),
  }));

  if (activeHooks.length > maxActiveHooks) {
    issues.push(warning(
      params.language,
      params.language === "en"
        ? `There are ${activeHooks.length} active hooks, above the recommended cap of ${maxActiveHooks}.`
        : `Hiện có ${activeHooks.length} manh mối/phục bút đang hoạt động, vượt quá mức khuyến nghị ${maxActiveHooks}.`,
      params.language === "en"
        ? "Prefer advancing, resolving, or deferring existing debt before opening more hooks."
        : "Ưu tiên thúc đẩy, giải quyết hoặc tạm hoãn các manh mối hiện có trước khi mở thêm manh mối mới.",
    ));
  }

  const staleHookIds = new Set(collectStaleHookDebt({
    hooks: activeHooks,
    chapterNumber: params.chapterNumber,
    targetChapters: params.targetChapters,
    staleAfterChapters,
  }).map((hook) => hook.hookId));
  const pressuredHooks = lifecycleEntries.filter(({ hook, lifecycle }) =>
    staleHookIds.has(hook.hookId)
    || lifecycle.readyToResolve
    || lifecycle.overdue,
  );
  const unresolvedPressure = pressuredHooks.filter(({ hook }) => {
    if (!params.delta) {
      return true;
    }

    const disposition = classifyHookDisposition({
      hookId: hook.hookId,
      delta: params.delta,
    });
    return disposition === "none" || disposition === "mention";
  });
  if (unresolvedPressure.length > 0) {
    issues.push(warning(
      params.language,
      buildPressureDescription({
        language: params.language,
        entries: unresolvedPressure,
        mentionsCurrentChapter: Boolean(params.delta),
      }),
      params.language === "en"
        ? "Move one pressured hook with a real payoff, escalation, or explicit defer before opening adjacent debt."
        : "Hãy thúc đẩy, thu hồi hoặc tạm hoãn rõ ràng ít nhất một manh mối đang chịu áp lực trước khi tạo thêm nợ manh mối tương tự.",
    ));
  } else {
    const latestRealAdvance = activeHooks.reduce(
      (max, hook) => Math.max(max, hook.lastAdvancedChapter),
      0,
    );
    if (
      params.noAdvanceWindow !== undefined
      && activeHooks.length > 0
      && params.chapterNumber - latestRealAdvance >= noAdvanceWindow
    ) {
      issues.push(warning(
        params.language,
        params.language === "en"
          ? `No real hook advancement has landed for ${params.chapterNumber - latestRealAdvance} chapters.`
          : `Đã liên tiếp ${params.chapterNumber - latestRealAdvance} chương không có tiến triển manh mối thực tế nào.`,
        params.language === "en"
          ? "Schedule one old hook for real movement instead of opening parallel restatements."
          : "Chương tiếp theo nên ưu tiên tiến triển thực tế cho một manh mối cũ thay vì chỉ lặp lại.",
      ));
    }
  }

  if (params.delta) {
    const existingHookIds = new Set(params.existingHookIds ?? []);
    const resultingHookIds = new Set(params.hooks.map((hook) => hook.hookId));
    const newHookIds = params.delta.hookOps.upsert
      .map((hook) => hook.hookId)
      .filter((hookId) => !existingHookIds.has(hookId) && resultingHookIds.has(hookId));

    if (newHookIds.length >= newHookBurstThreshold && params.delta.hookOps.resolve.length === 0) {
      issues.push(warning(
        params.language,
        params.language === "en"
          ? `Opened ${newHookIds.length} new hooks without resolving any older debt.`
          : `Chương này đã mở thêm ${newHookIds.length} manh mối mới nhưng chưa giải quyết manh mối cũ nào.`,
        params.language === "en"
          ? "Keep the hook table from ballooning by pairing new openings with old payoffs."
          : "Kiểm soát số lượng manh mối, cố gắng giải quyết manh mối cũ khi mở manh mối mới.",
      ));
    }
  }

  return issues;
}

function buildPressureDescription(params: {
  readonly language: "vi" | "en";
  readonly entries: ReadonlyArray<{
    readonly hook: HookRecord;
    readonly lifecycle: ReturnType<typeof describeHookLifecycle>;
  }>;
  readonly mentionsCurrentChapter: boolean;
}): string {
  const summarized = params.entries
    .slice(0, 3)
    .map(({ hook, lifecycle }) => {
      const timing = localizeHookPayoffTiming(lifecycle.timing, params.language);
      const pressure = localizePressureLabel(lifecycle, params.language);
      return `${hook.hookId} (${timing}, ${pressure})`;
    });
  const suffix = params.entries.length > summarized.length
    ? params.language === "en"
      ? `, +${params.entries.length - summarized.length} more`
      : `, +${params.entries.length - summarized.length} khác`
    : "";

  if (params.language === "en") {
    return params.mentionsCurrentChapter
      ? `Hooks are already under payoff pressure but this chapter left them untouched: ${summarized.join(", ")}${suffix}.`
      : `Hooks are already under payoff pressure without recent movement: ${summarized.join(", ")}${suffix}.`;
  }

  return params.mentionsCurrentChapter
    ? `Các manh mối này đang chịu áp lực thu hồi/tiến triển nhưng chương này chưa xử lý: ${summarized.join(", ")}${suffix}.`
    : `Các manh mối này đang chịu áp lực thu hồi/tiến triển nhưng gần đây chưa có tiến triển thực tế: ${summarized.join(", ")}${suffix}.`;
}

function localizePressureLabel(
  lifecycle: ReturnType<typeof describeHookLifecycle>,
  language: "vi" | "en",
): string {
  if (lifecycle.overdue) {
    return language === "en" ? "overdue" : "quá hạn";
  }
  if (lifecycle.readyToResolve) {
    return language === "en" ? "ready to pay off" : "có thể thu hồi";
  }
  return language === "en" ? "stale" : "tồn đọng";
}

function warning(
  language: "vi" | "en",
  description: string,
  suggestion: string,
): AuditIssue {
  return {
    severity: "warning",
    category: language === "en" ? "Hook Debt" : "Nợ manh mối",
    description,
    suggestion,
  };
}
