import { useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  GitFork,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  NarrativeForecastSchema,
  type ForecastBranch,
  type ForecastRisk,
  type NarrativeForecast,
} from "@actalk/castor-core/forecast/schema";
import type { ToolExecution } from "../../store/chat/types";
import { tr } from "../../lib/app-language";

export type NarrativeForecastPreviewDetails =
  | {
      readonly kind: "forecast";
      readonly forecast: NarrativeForecast;
      readonly stale: boolean;
    }
  | {
      readonly kind: "selected";
      readonly branchId: string;
      readonly planPath: string;
      readonly stale: boolean;
    };

export interface NarrativeForecastPreviewProps {
  readonly exec: ToolExecution;
  readonly onSelectBranch?: (forecastId: string, branchId: string) => void | Promise<void>;
  readonly onRecheck?: (forecastId: string) => void | Promise<void>;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function getNarrativeForecastPreviewDetails(exec: ToolExecution): NarrativeForecastPreviewDetails | null {
  if (!["create_narrative_forecast", "get_narrative_forecast", "select_narrative_branch"].includes(exec.tool)) {
    return null;
  }
  const details = recordOf(exec.details);
  if (!details) return null;

  if (details.kind === "narrative_forecast_created" || details.kind === "narrative_forecast") {
    const parsed = NarrativeForecastSchema.safeParse(details.forecast);
    if (!parsed.success) return null;
    return {
      kind: "forecast",
      forecast: parsed.data,
      stale: details.stale === true || parsed.data.status === "stale",
    };
  }

  if (details.kind === "narrative_branch_selected") {
    const branchId = nonEmptyString(details.branchId);
    const planPath = nonEmptyString(details.planPath);
    if (!branchId || !planPath) return null;
    return { kind: "selected", branchId, planPath, stale: details.stale === true };
  }

  return null;
}

export function buildNarrativeForecastSelectionInstruction(
  forecastId: string,
  branchId: string,
  language: "vi" | "en",
): string {
  return language === "vi"
    ? `Hãy gọi select_narrative_branch để chọn nhánh ${branchId} của dự báo ${forecastId}. Chỉ lưu kế hoạch ứng viên; không sửa phần thân, dàn ý hay trạng thái chính thống.`
    : `Call select_narrative_branch for ${branchId} in forecast ${forecastId}. Save only the candidate plan; do not modify prose, outlines, or canonical state.`;
}

export function buildNarrativeForecastRecheckInstruction(
  forecastId: string,
  language: "vi" | "en",
): string {
  return language === "vi"
    ? `Hãy gọi get_narrative_forecast để kiểm tra lại xem dự báo ${forecastId} đã lỗi thời chưa.`
    : `Call get_narrative_forecast for forecast ${forecastId} and report whether it is stale.`;
}

const RISK_LABELS: Record<ForecastRisk["kind"], readonly [string, string]> = {
  continuity: ["Tính liên tục", "Continuity"],
  causality: ["Nhân quả", "Causality"],
  character: ["Nhân vật", "Character"],
};

function label(vi: boolean, values: readonly [string, string]): string {
  return vi ? values[0] : values[1];
}

function RiskPills({ risks, vi }: { risks: readonly ForecastRisk[]; vi: boolean }) {
  if (risks.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-2 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-300">
        <ShieldCheck size={11} />
        {vi ? "Không phát hiện rủi ro nghiêm trọng" : "No hard risks"}
      </span>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {risks.map((risk, index) => (
        <span
          key={`${risk.kind}-${index}`}
          title={risk.description}
          className="inline-flex items-center rounded-full border border-amber-500/25 bg-amber-500/8 px-2 py-0.5 text-[11px] text-amber-800 dark:text-amber-200"
        >
          {label(vi, RISK_LABELS[risk.kind])}
        </span>
      ))}
    </div>
  );
}

function ChangeList({ title, items }: { title: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70">{title}</div>
      <ul className="space-y-1 text-xs leading-5 text-muted-foreground">
        {items.map((item, index) => <li key={index}>· {item}</li>)}
      </ul>
    </div>
  );
}

function BranchCard({
  branch,
  forecastId,
  stale,
  vi,
  pending,
  onSelect,
}: {
  readonly branch: ForecastBranch;
  readonly forecastId: string;
  readonly stale: boolean;
  readonly vi: boolean;
  readonly pending: boolean;
  readonly onSelect?: (branchId: string) => void;
}) {
  return (
    <article className="relative flex min-w-0 flex-col rounded-xl border border-border/55 bg-background/70 p-3.5 shadow-[0_10px_30px_-24px_rgba(0,0,0,0.65)]">
      <div className="absolute -top-[19px] left-1/2 h-4 w-px -translate-x-1/2 bg-primary/35" />
      <div className="absolute -top-[22px] left-1/2 h-2 w-2 -translate-x-1/2 rounded-full border border-primary/50 bg-card" />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-[0.13em] text-primary/75">{branch.branchId}</div>
          <h4 className="mt-1 text-[15px] font-semibold leading-5 text-foreground">{branch.title}</h4>
        </div>
        <div className="shrink-0 rounded-lg border border-primary/20 bg-primary/5 px-2 py-1 text-right">
          <div className="text-[15px] font-semibold leading-none text-primary">{branch.intentAlignment.score}</div>
          <div className="mt-1 text-[9px] uppercase tracking-wide text-muted-foreground">{vi ? "Ý định" : "intent"}</div>
        </div>
      </div>

      <p className="mt-3 text-xs leading-5 text-muted-foreground">{branch.premise}</p>

      <ol className="mt-3 space-y-2 border-l border-primary/20 pl-3">
        {branch.beats.map((beat) => (
          <li key={`${branch.branchId}-${beat.chapter}`} className="relative text-xs leading-5 text-foreground/90">
            <span className="absolute -left-[15px] top-[7px] h-1.5 w-1.5 rounded-full bg-primary/65" />
            <span className="font-medium text-primary">{vi ? `Chương ${beat.chapter}` : `Ch. ${beat.chapter}`}</span>
            <span className="ml-1.5">{beat.summary}</span>
          </li>
        ))}
      </ol>

      <div className="mt-3"><RiskPills risks={branch.risks} vi={vi} /></div>

      <details className="group mt-3 border-t border-border/40 pt-2.5">
        <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
          <ChevronRight size={13} className="transition-transform group-open:rotate-90" />
          {vi ? "Quyết định, thay đổi của nhân vật và các điểm bất định" : "Decisions, changes, uncertainties"}
        </summary>
        <div className="mt-3 space-y-3">
          <ChangeList
            title={vi ? "Quyết định của nhân vật" : "Character decisions"}
            items={branch.characterDecisions.map((item) => `${item.character}：${item.decision}`)}
          />
          <ChangeList title={vi ? "Thay đổi nhân vật" : "Character changes"} items={branch.projectedChanges.characters} />
          <ChangeList title={vi ? "Thay đổi quan hệ" : "Relationship changes"} items={branch.projectedChanges.relationships} />
          <ChangeList title={vi ? "Thay đổi thế giới" : "World changes"} items={branch.projectedChanges.world} />
          <ChangeList title={vi ? "Thay đổi tiền để" : "Hook changes"} items={branch.projectedChanges.hooks} />
          <ChangeList title={vi ? "Điểm bất định" : "Uncertainties"} items={branch.uncertainties} />
          <p className="rounded-lg bg-muted/45 px-2.5 py-2 text-xs leading-5 text-muted-foreground">
            {branch.intentAlignment.rationale}
          </p>
        </div>
      </details>

      <button
        type="button"
        data-forecast-id={forecastId}
        data-branch-id={branch.branchId}
        disabled={stale || pending || !onSelect}
        onClick={() => onSelect?.(branch.branchId)}
        className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-primary/35 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:border-border/40 disabled:bg-muted/30 disabled:text-muted-foreground/60"
      >
        {pending ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
        {stale
          ? (vi ? "Dự báo lỗi thời, không thể chọn" : "Stale forecast")
          : (vi ? "Dùng nhánh này" : "Use this branch")}
      </button>
    </article>
  );
}

export function NarrativeForecastPreview({ exec, onSelectBranch, onRecheck }: NarrativeForecastPreviewProps) {
  const details = getNarrativeForecastPreviewDetails(exec);
  const [pendingBranch, setPendingBranch] = useState<string | null>(null);
  const [rechecking, setRechecking] = useState(false);
  if (!details) return null;

  if (details.kind === "selected") {
    return (
      <div className="mx-3 mb-3 mt-1 rounded-xl border border-primary/25 bg-primary/5 px-3.5 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-primary">
          <Check size={15} />
          {tr("Đã lưu nhánh ứng viên", "Candidate branch saved")}
        </div>
        <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
          {tr(
            `${details.branchId} đã được ghi vào kế hoạch ứng viên; phần thân, dàn ý và trạng thái chính thống không bị thay đổi.`,
            `${details.branchId} was written to the candidate plan; prose, outline, and canon were not modified.`,
          )}
        </p>
        {details.stale && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
            {tr("Dự báo này dựa trên bản chính thống cũ; hãy xác minh trước khi viết tiếp.", "This forecast is stale; verify it before writing.")}
          </p>
        )}
      </div>
    );
  }

  const { forecast, stale } = details;
  // Legacy "zh" forecasts fall back to the Vietnamese default UI locale.
  const vi = forecast.language !== "en";
  const selectBranch = async (branchId: string) => {
    if (!onSelectBranch || stale) return;
    setPendingBranch(branchId);
    try {
      await onSelectBranch(forecast.forecastId, branchId);
    } finally {
      setPendingBranch(null);
    }
  };
  const recheck = async () => {
    if (!onRecheck) return;
    setRechecking(true);
    try {
      await onRecheck(forecast.forecastId);
    } finally {
      setRechecking(false);
    }
  };

  return (
    <section className="mx-3 mb-3 mt-1 overflow-hidden rounded-2xl border border-primary/25 bg-[linear-gradient(145deg,hsl(var(--card))_0%,hsl(var(--muted)/0.32)_100%)]">
      <header className="border-b border-border/45 px-4 py-3.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-foreground">
                <GitFork size={16} className="text-primary" />
                {vi ? "Dự báo truyện đa nhánh" : "Narrative forecast"}
              </span>
              <span className="rounded-full border border-primary/20 bg-primary/8 px-2 py-0.5 text-[10px] font-medium tracking-wide text-primary">
                {vi ? "KHÔNG CHÍNH THỐNG" : "NON-CANONICAL"}
              </span>
              {stale && (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:text-amber-200">
                  <AlertTriangle size={11} />
                  {vi ? "Chính thống đã thay đổi" : "Canon changed"}
                </span>
              )}
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground/85">{forecast.divergence}</p>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span>{vi ? `Dựa trên sau chương ${forecast.baseChapter}` : `After chapter ${forecast.baseChapter}`}</span>
              <span>{vi ? `${forecast.branches.length} nhánh ứng viên` : `${forecast.branches.length} branches`}</span>
              <span>{vi ? `Dự báo trước khoảng ${forecast.horizon} chương` : `~${forecast.horizon} chapters ahead`}</span>
            </div>
          </div>
          {onRecheck && (
            <button
              type="button"
              onClick={() => { void recheck(); }}
              disabled={rechecking}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border/60 bg-background/60 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw size={12} className={rechecking ? "animate-spin" : ""} />
              {vi ? "Kiểm tra lại" : "Recheck"}
            </button>
          )}
        </div>
        {stale && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/8 px-3 py-2 text-xs leading-5 text-amber-900 dark:text-amber-100">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>{vi ? "Đầu vào chính thống đã thay đổi sau khi tạo. Hãy chạy dự báo lại trước khi chọn nhánh." : "Canonical inputs changed after generation. Regenerate before selecting a branch."}</span>
          </div>
        )}
      </header>

      <div className="relative px-4 pb-4 pt-7">
        <div className="pointer-events-none absolute left-8 right-8 top-[17px] h-px bg-gradient-to-r from-transparent via-primary/35 to-transparent" />
        <div className="pointer-events-none absolute left-1/2 top-[9px] -translate-x-1/2 text-primary/70">
          <Sparkles size={14} />
        </div>
        <div className="grid auto-cols-[minmax(17rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-1 [scrollbar-width:thin]">
          {forecast.branches.map((branch) => (
            <BranchCard
              key={branch.branchId}
              branch={branch}
              forecastId={forecast.forecastId}
              stale={stale}
              vi={vi}
              pending={pendingBranch === branch.branchId}
              onSelect={onSelectBranch ? (branchId) => { void selectBranch(branchId); } : undefined}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
