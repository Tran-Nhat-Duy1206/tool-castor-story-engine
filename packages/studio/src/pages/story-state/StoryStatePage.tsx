import { useMemo, useState } from "react";
import { AlertTriangle, Brain, BookLock, CheckCircle2, FileText, Pencil, Plus, RefreshCw, Save, Trash2, X } from "lucide-react";
import { useApi } from "../../hooks/use-api";
import type { CanonCommitOutcome, StoryCanonViewDto } from "../../lib/canon-api";
import { postCanonCommit } from "../../lib/canon-api";
import {
  additionalFactRows,
  buildCommitRequest,
  buildRemoveFactEdit,
  buildSetFactEdit,
  hookRows,
  manifestSummary,
  resolveCanonRequestUrl,
  saveOutcomeToUi,
  slotRows,
  validateFactDraft,
  type SaveOutcomeView,
  type UiLanguage,
} from "./story-state-model";

interface StoryStatePageProps {
  readonly bookId: string;
}

type TabKey = "current-state" | "hooks" | "summaries";

/**
 * Canonical structured runtime state surface (`story/state/*.json`).
 * Data arrives through the Core read boundary (`GET /api/v1/books/:id/canon`)
 * and mutations go through the lock-owning Studio commit route — never raw
 * JSON editing. The Current State tab offers ONE-confirmation manual editing
 * (T3B.2): Save posts the commit directly; there is no preview dialog and no
 * second Confirm step. Hooks and chapter summaries stay read-only here.
 */
export function StoryStatePage({ bookId }: StoryStatePageProps) {
  const [lang, setLang] = useState<UiLanguage>("zh");
  const [tab, setTab] = useState<TabKey>("current-state");
  // Hooks must run unconditionally: URL resolution never throws here, and
  // useApi("") is an inert no-op, so hook order stays stable even for
  // malformed book ids (the error renders after all hooks have run).
  const request = useMemo(() => resolveCanonRequestUrl(bookId), [bookId]);
  const { data, loading, error, refetch } = useApi<StoryCanonViewDto>(request.url ?? "");

  if (request.error) {
    return <ErrorCard message={request.error} lang={lang} />;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Brain size={20} />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">
              故事状态 · Story State
              <span className="ml-3 inline-flex items-center gap-1 rounded-full border border-border/60 bg-secondary/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                <BookLock size={11} />
                手动编辑 · Manual editing
              </span>
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              InkOS 对故事的当前权威认知（canonical structured state）· What InkOS currently believes about your story
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5 rounded-lg bg-muted/50 p-0.5">
            {(["zh", "en"] as const).map((value) => (
              <button
                key={value}
                onClick={() => setLang(value)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                  lang === value ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                }`}
              >
                {value === "zh" ? "中" : "EN"}
              </button>
            ))}
          </div>
          <button
            onClick={() => void refetch()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <RefreshCw size={13} />
            刷新 · Refresh
          </button>
        </div>
      </header>

      {loading && !data && (
        <div className="py-16 text-center text-sm text-muted-foreground">加载故事状态… · Loading story state…</div>
      )}
      {error && <ErrorCard message={error} lang={lang} />}
      {data && <CanonBody data={data} tab={tab} setTab={setTab} lang={lang} bookId={bookId} refetch={() => void refetch()} />}
    </div>
  );
}

function ErrorCard({ message, lang }: { message: string; lang: UiLanguage }) {
  return (
    <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6">
      <div className="flex items-center gap-2 text-sm font-medium text-destructive">
        <AlertTriangle size={15} />
        {lang === "zh" ? "无法读取规范状态" : "Failed to read canonical state"}
      </div>
      <p className="mt-2 break-all text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

function CanonBody({
  data,
  tab,
  setTab,
  lang,
  bookId,
  refetch,
}: {
  data: StoryCanonViewDto;
  tab: TabKey;
  setTab: (tab: TabKey) => void;
  lang: UiLanguage;
  bookId: string;
  refetch: () => void;
}) {
  const summary = manifestSummary(data);
  const tabs: Array<{ key: TabKey; zh: string; en: string }> = [
    { key: "current-state", zh: "当前状态", en: "Current State" },
    { key: "hooks", zh: "伏笔池", en: "Hooks" },
    { key: "summaries", zh: "章节摘要", en: "Chapter Summaries" },
  ];

  return (
    <>
      <section className="grid grid-cols-2 gap-3 rounded-2xl border border-border/50 bg-card/50 p-4 sm:grid-cols-4">
        <ManifestCell label={lang === "zh" ? "最新应用章节" : "Last applied chapter"} value={`#${summary.lastAppliedChapter}`} />
        <ManifestCell label={lang === "zh" ? "模式语言" : "Manifest language"} value={summary.language} />
        <ManifestCell label={lang === "zh" ? "投影版本" : "Projection version"} value={`v${summary.projectionVersion}`} />
        <ManifestCell label={lang === "zh" ? "Schema 版本" : "Schema version"} value={`v${summary.schemaVersion}`} />
        {summary.warningCount > 0 && (
          <div className="col-span-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-600 sm:col-span-4">
            <AlertTriangle size={12} className="mr-1 inline" />
            迁移警告 · Migration warnings ({summary.warningCount}): {summary.warnings.join("；")}
          </div>
        )}
      </section>

      <nav className="flex gap-1 rounded-xl bg-muted/40 p-1">
        {tabs.map((entry) => (
          <button
            key={entry.key}
            onClick={() => setTab(entry.key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === entry.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {lang === "zh" ? entry.zh : entry.en}
          </button>
        ))}
      </nav>

      {tab === "current-state" && <CurrentStateTab data={data} lang={lang} bookId={bookId} refetch={refetch} />}
      {tab === "hooks" && <HooksTab data={data} lang={lang} />}
      {tab === "summaries" && <SummariesTab data={data} lang={lang} />}
    </>
  );
}

// --- T3B.2: one-confirmation current-state editor ---

interface EditBuffer {
  readonly mode: "edit-fact" | "add-fact";
  subject: string;
  predicate: string;
  object: string;
}

function OutcomeBanner({
  outcome,
  lang,
  onRefetch,
  onDismiss,
}: {
  outcome: SaveOutcomeView;
  lang: UiLanguage;
  onRefetch: () => void;
  onDismiss: () => void;
}) {
  const toneClass =
    outcome.tone === "success"
      ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700"
      : outcome.tone === "warning"
        ? "border-amber-500/40 bg-amber-500/5 text-amber-600"
        : outcome.tone === "conflict"
          ? "border-orange-500/40 bg-orange-500/5 text-orange-600"
          : outcome.tone === "locked"
            ? "border-sky-500/30 bg-sky-500/5 text-sky-700"
            : "border-destructive/30 bg-destructive/5 text-destructive";
  return (
    <div className={`rounded-xl border p-4 text-sm ${toneClass}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium">
          {outcome.tone === "success" || outcome.tone === "warning" ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
          {outcome.title}
        </div>
        <div className="flex items-center gap-2">
          {outcome.showRefetch && (
            <button
              onClick={onRefetch}
              className="inline-flex items-center gap-1 rounded-lg border border-current/30 px-2.5 py-1 text-xs font-medium hover:bg-background/60"
            >
              <RefreshCw size={12} />
              {lang === "zh" ? "刷新最新状态（需重新应用修改）" : "Refetch latest (re-apply your edit)"}
            </button>
          )}
          <button
            onClick={onDismiss}
            aria-label={lang === "zh" ? "关闭提示" : "Dismiss"}
            className="rounded-lg px-1.5 py-1 text-xs hover:bg-background/60"
          >
            <X size={13} />
          </button>
        </div>
      </div>
      <p className="mt-1.5 break-all text-xs opacity-90">{outcome.detail}</p>
      {outcome.currentRevision && (
        <p className="mt-1 font-mono text-[11px] opacity-80">
          {lang === "zh" ? "服务器当前版本：" : "Server revision: "}
          {outcome.currentRevision}
        </p>
      )}
      {outcome.warnings.length > 0 && (
        <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs">
          {outcome.warnings.map((warning, index) => (
            <li key={index} className="break-all">{warning}</li>
          ))}
        </ul>
      )}
      {outcome.issues.length > 0 && (
        <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs">
          {outcome.issues.map((issue, index) => (
            <li key={index} className="break-all">{issue}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CurrentStateTab({
  data,
  lang,
  bookId,
  refetch,
}: {
  data: StoryCanonViewDto;
  lang: UiLanguage;
  bookId: string;
  refetch: () => void;
}) {
  const slots = slotRows(data.description.slots, lang);
  const additional = additionalFactRows(data.description.additionalFacts, lang);
  const supersededLabel = lang === "zh" ? "历史区间" : "superseded";

  const [buffer, setBuffer] = useState<EditBuffer | null>(null);
  const [draftIssues, setDraftIssues] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [outcomeView, setOutcomeView] = useState<SaveOutcomeView | null>(null);

  // Editing requires the retained revision fingerprint (T3B stale-revision UX).
  const editable = typeof data.revision === "string" && data.revision.length > 0;

  const handleOutcome = (outcome: CanonCommitOutcome): void => {
    const view = saveOutcomeToUi(outcome, lang);
    if (view.saved) {
      // Server-authoritative replace: drop any edit buffer, refetch fresh
      // canon (new revision), keep the banner as feedback.
      setBuffer(null);
      setDraftIssues([]);
      setOutcomeView(view);
      refetch();
    } else if (!view.keepBuffer) {
      // Conflict: discard the buffer — the user must re-apply after refetch.
      setBuffer(null);
      setDraftIssues([]);
      setOutcomeView(view);
    } else {
      setOutcomeView(view);
    }
  };

  const commit = async (edits: Parameters<typeof buildCommitRequest>[0]): Promise<void> => {
    if (saving || !editable) return;
    setSaving(true);
    try {
      const outcome = await postCanonCommit(bookId, buildCommitRequest(edits, data.revision!));
      handleOutcome(outcome);
    } finally {
      setSaving(false);
    }
  };

  const startEditFact = (subject: string, predicate: string, object: string): void => {
    setOutcomeView(null);
    setDraftIssues([]);
    setBuffer({ mode: "edit-fact", subject, predicate, object });
  };
  const startAddFact = (): void => {
    setOutcomeView(null);
    setDraftIssues([]);
    setBuffer({ mode: "add-fact", subject: "", predicate: "", object: "" });
  };
  const cancelEdit = (): void => {
    setBuffer(null);
    setDraftIssues([]);
  };

  const saveBuffer = async (): Promise<void> => {
    if (!buffer) return;
    const issues = validateFactDraft(buffer);
    setDraftIssues(issues);
    if (issues.length > 0) return; // inline validation only — never a second confirmation gate
    await commit([buildSetFactEdit(buffer.subject, buffer.predicate, buffer.object)]);
  };

  const removeFact = async (subject: string, predicate: string): Promise<void> => {
    await commit([buildRemoveFactEdit(subject, predicate)]);
  };

  const actionButtonClass =
    "inline-flex items-center gap-1 rounded-md border border-border/50 px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="space-y-6">
      {!editable && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-600">
          {lang === "zh"
            ? "当前视图缺少版本指纹，编辑已禁用。请刷新页面获取最新状态。"
            : "This view lacks a revision fingerprint; editing is disabled. Refresh to load the latest state."}
        </div>
      )}

      {outcomeView && (
        <OutcomeBanner
          outcome={outcomeView}
          lang={lang}
          onRefetch={() => {
            setOutcomeView(null);
            refetch();
          }}
          onDismiss={() => setOutcomeView(null)}
        />
      )}

      {buffer && (
        <section className="rounded-xl border border-border/50 bg-card/60 p-4">
          <h3 className="mb-3 text-sm font-semibold text-foreground">
            {buffer.mode === "add-fact"
              ? lang === "zh" ? "新增状态事实" : "Add fact"
              : lang === "zh" ? `编辑事实：${buffer.subject} · ${buffer.predicate}` : `Edit fact: ${buffer.subject} · ${buffer.predicate}`}
          </h3>
          <div className="grid gap-3 sm:grid-cols-3">
            {buffer.mode === "add-fact" ? (
              <>
                <label className="text-xs text-muted-foreground">
                  {lang === "zh" ? "主体 · Subject" : "Subject"}
                  <input
                    value={buffer.subject}
                    onChange={(e) => setBuffer({ ...buffer, subject: e.target.value })}
                    disabled={saving}
                    className="mt-1 w-full rounded-lg border border-border/50 bg-background px-2 py-1.5 text-sm text-foreground"
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  {lang === "zh" ? "谓词 · Predicate" : "Predicate"}
                  <input
                    value={buffer.predicate}
                    onChange={(e) => setBuffer({ ...buffer, predicate: e.target.value })}
                    disabled={saving}
                    className="mt-1 w-full rounded-lg border border-border/50 bg-background px-2 py-1.5 text-sm text-foreground"
                  />
                </label>
              </>
            ) : (
              <>
                <div className="text-xs text-muted-foreground">
                  {lang === "zh" ? "主体 · Subject" : "Subject"}
                  <div className="mt-1 rounded-lg bg-secondary/30 px-2 py-1.5 text-sm text-foreground">{buffer.subject}</div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {lang === "zh" ? "谓词 · Predicate" : "Predicate"}
                  <div className="mt-1 rounded-lg bg-secondary/30 px-2 py-1.5 text-sm text-foreground">{buffer.predicate}</div>
                </div>
              </>
            )}
            <label className="text-xs text-muted-foreground">
              {lang === "zh" ? "值 · Value" : "Value"}
              <input
                value={buffer.object}
                onChange={(e) => setBuffer({ ...buffer, object: e.target.value })}
                disabled={saving}
                className="mt-1 w-full rounded-lg border border-border/50 bg-background px-2 py-1.5 text-sm text-foreground"
              />
            </label>
          </div>
          {draftIssues.length > 0 && (
            <ul className="mt-2 list-inside list-disc text-xs text-destructive">
              {draftIssues.map((issue, index) => (
                <li key={index}>{issue}</li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex items-center gap-2">
            {/* Save IS the one and only user confirmation (T3B.2 BINDING). */}
            <button
              onClick={() => void saveBuffer()}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              <Save size={12} />
              {saving
                ? lang === "zh" ? "保存中…" : "Saving…"
                : lang === "zh" ? "保存" : "Save"}
            </button>
            <button
              onClick={cancelEdit}
              disabled={saving}
              className="rounded-lg border border-border/50 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {lang === "zh" ? "取消" : "Cancel"}
            </button>
            <span className="text-[11px] text-muted-foreground">
              {lang === "zh" ? "点击「保存」即直接提交，无二次确认。" : "Save submits directly — no second confirmation."}
            </span>
          </div>
        </section>
      )}

      <table className="w-full border-collapse overflow-hidden rounded-xl text-sm">
        <thead>
          <tr className="bg-secondary/40 text-left text-xs text-muted-foreground">
            <th className="px-4 py-2.5 font-medium">{lang === "zh" ? "槽位" : "Slot"}</th>
            <th className="px-4 py-2.5 font-medium">{lang === "zh" ? "值" : "Value"}</th>
            <th className="px-4 py-2.5 font-medium">{lang === "zh" ? "主体" : "Subject"}</th>
            <th className="px-4 py-2.5 font-medium">{lang === "zh" ? "生效范围" : "Validity"}</th>
            <th className="px-4 py-2.5 font-medium">{lang === "zh" ? "操作" : "Actions"}</th>
          </tr>
        </thead>
        <tbody>
          {slots.map((slot) => (
            <tr key={slot.key} className="border-t border-border/40">
              <td className="px-4 py-2.5 font-medium text-foreground">
                {slot.label}
                {slot.supersededCount > 0 && (
                  <span className="ml-2 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600">
                    +{slot.supersededCount} {supersededLabel}
                  </span>
                )}
              </td>
              <td className="max-w-[22rem] break-words px-4 py-2.5 text-foreground">
                {slot.value ?? <span className="text-muted-foreground/60">{lang === "zh" ? "（未设定）" : "(not set)"}</span>}
              </td>
              <td className="px-4 py-2.5 text-muted-foreground">{slot.selectedSubject ?? "—"}</td>
              <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-muted-foreground">{slot.validity ?? "—"}</td>
              <td className="px-4 py-2.5">
                {slot.selectedSubject && slot.value != null && (
                  <button
                    onClick={() => startEditFact(slot.selectedSubject!, slot.label, slot.value!)}
                    disabled={!editable || saving}
                    className={actionButtonClass}
                  >
                    <Pencil size={11} />
                    {lang === "zh" ? "编辑" : "Edit"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <FileText size={14} />
            {lang === "zh" ? `其他状态事实（${additional.length}）` : `Additional facts (${additional.length})`}
          </h3>
          <button
            onClick={startAddFact}
            disabled={!editable || saving}
            className={actionButtonClass}
          >
            <Plus size={11} />
            {lang === "zh" ? "新增事实" : "Add fact"}
          </button>
        </div>
        {additional.length === 0 ? (
          <p className="rounded-xl bg-card/40 p-4 text-xs text-muted-foreground">
            {lang === "zh" ? "暂无其他状态事实。" : "No additional facts recorded."}
          </p>
        ) : (
          <table className="w-full border-collapse overflow-hidden rounded-xl text-sm">
            <thead>
              <tr className="bg-secondary/40 text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">{lang === "zh" ? "主体" : "Subject"}</th>
                <th className="px-4 py-2 font-medium">{lang === "zh" ? "谓词" : "Predicate"}</th>
                <th className="px-4 py-2 font-medium">{lang === "zh" ? "值" : "Object"}</th>
                <th className="px-4 py-2 font-medium">{lang === "zh" ? "生效" : "Valid"}</th>
                <th className="px-4 py-2 font-medium">{lang === "zh" ? "来源章" : "Src ch."}</th>
                <th className="px-4 py-2 font-medium">{lang === "zh" ? "操作" : "Actions"}</th>
              </tr>
            </thead>
            <tbody>
              {additional.map((fact, index) => (
                <tr key={`${fact.subject}:${fact.predicate}:${index}`} className="border-t border-border/40">
                  <td className="px-4 py-2 text-foreground">{fact.subject}</td>
                  <td className="px-4 py-2 text-foreground">{fact.predicate}</td>
                  <td className="max-w-[24rem] break-words px-4 py-2 text-muted-foreground">{fact.object}</td>
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-muted-foreground">
                    {fact.validity}
                    {fact.validUntilChapter !== null && (
                      <span className="ml-1.5 rounded bg-amber-500/10 px-1 py-0.5 text-[10px] text-amber-600">
                        {supersededLabel}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">#{fact.sourceChapter}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => startEditFact(fact.subject, fact.predicate, fact.object)}
                        disabled={!editable || saving}
                        className={actionButtonClass}
                      >
                        <Pencil size={11} />
                        {lang === "zh" ? "编辑" : "Edit"}
                      </button>
                      <button
                        onClick={() => void removeFact(fact.subject, fact.predicate)}
                        disabled={!editable || saving}
                        title={lang === "zh" ? "删除该事实（立即提交）" : "Remove fact (commits immediately)"}
                        className={actionButtonClass}
                      >
                        <Trash2 size={11} />
                        {lang === "zh" ? "删除" : "Remove"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function ManifestCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-secondary/30 p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}


function HooksTab({ data, lang }: { data: StoryCanonViewDto; lang: UiLanguage }) {
  const rows = hookRows(data.hooks.hooks);
  const headers: Array<[string, string]> = [
    ["hook_id", "hook_id"],
    [lang === "zh" ? "起始章" : "Start", "start"],
    [lang === "zh" ? "类型" : "Type", "type"],
    [lang === "zh" ? "状态" : "Status", "status"],
    [lang === "zh" ? "最近推进" : "Advanced", "adv."],
    [lang === "zh" ? "预期回收" : "Expected payoff", "payoff"],
    [lang === "zh" ? "节奏" : "Timing", "timing"],
    [lang === "zh" ? "上游依赖" : "Depends on", "deps"],
    [lang === "zh" ? "回收卷" : "Arc", "arc"],
    [lang === "zh" ? "核心" : "Core", "core"],
    [lang === "zh" ? "半衰期" : "Half-life", "half-life"],
    [lang === "zh" ? "推进次数" : "Advances", "count"],
    [lang === "zh" ? "升级" : "Promoted", "prom."],
    [lang === "zh" ? "备注" : "Notes", "notes"],
  ];

  if (rows.length === 0) {
    return (
      <p className="rounded-xl bg-card/40 p-4 text-xs text-muted-foreground">
        {lang === "zh" ? "伏笔池为空。" : "No hooks recorded."}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl">
      <table className="w-full min-w-[64rem] border-collapse text-sm">
        <thead>
          <tr className="bg-secondary/40 text-left text-xs text-muted-foreground">
            {headers.map(([label]) => (
              <th key={label} className="px-3 py-2 font-medium">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.hookId} className="border-t border-border/40 align-top">
              <td className="px-3 py-2 font-mono text-xs text-foreground">{row.hookId}</td>
              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">#{row.startChapter}</td>
              <td className="px-3 py-2 text-muted-foreground">{row.type}</td>
              <td className="px-3 py-2 text-foreground">{row.status}</td>
              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">#{row.lastAdvancedChapter}</td>
              <td className="max-w-[12rem] break-words px-3 py-2 text-muted-foreground">{row.expectedPayoff || "—"}</td>
              <td className="px-3 py-2 text-muted-foreground">{row.payoffTiming || "—"}</td>
              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{row.dependsOnText}</td>
              <td className="px-3 py-2 text-muted-foreground">{row.paysOffInArc || "—"}</td>
              <td className="px-3 py-2">{row.coreHook ? <Badge tone="primary">{lang === "zh" ? "核心" : "core"}</Badge> : ""}</td>
              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{row.halfLifeChapters}</td>
              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{row.advancedCount}</td>
              <td className="px-3 py-2">{row.promoted ? <Badge tone="primary">{lang === "zh" ? "已升级" : "promoted"}</Badge> : ""}</td>
              <td className="max-w-[14rem] break-words px-3 py-2 text-xs text-muted-foreground">{row.notes || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SummariesTab({ data, lang }: { data: StoryCanonViewDto; lang: UiLanguage }) {
  const rows = [...data.chapterSummaries.rows].sort((left, right) => left.chapter - right.chapter);
  if (rows.length === 0) {
    return (
      <p className="rounded-xl bg-card/40 p-4 text-xs text-muted-foreground">
        {lang === "zh" ? "暂无章节摘要。" : "No chapter summaries recorded."}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl">
      <table className="w-full min-w-[52rem] border-collapse text-sm">
        <thead>
          <tr className="bg-secondary/40 text-left text-xs text-muted-foreground">
            <th className="px-3 py-2 font-medium">#</th>
            <th className="px-3 py-2 font-medium">{lang === "zh" ? "标题" : "Title"}</th>
            <th className="px-3 py-2 font-medium">{lang === "zh" ? "人物" : "Characters"}</th>
            <th className="px-3 py-2 font-medium">{lang === "zh" ? "关键事件" : "Events"}</th>
            <th className="px-3 py-2 font-medium">{lang === "zh" ? "状态变化" : "State changes"}</th>
            <th className="px-3 py-2 font-medium">{lang === "zh" ? "伏笔动态" : "Hook activity"}</th>
            <th className="px-3 py-2 font-medium">{lang === "zh" ? "情绪" : "Mood"}</th>
            <th className="px-3 py-2 font-medium">{lang === "zh" ? "类型" : "Type"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.chapter} className="border-t border-border/40 align-top">
              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">#{row.chapter}</td>
              <td className="px-3 py-2 font-medium text-foreground">{row.title}</td>
              <td className="max-w-[10rem] break-words px-3 py-2 text-muted-foreground">{row.characters || "—"}</td>
              <td className="max-w-[18rem] break-words px-3 py-2 text-muted-foreground">{row.events || "—"}</td>
              <td className="max-w-[14rem] break-words px-3 py-2 text-muted-foreground">{row.stateChanges || "—"}</td>
              <td className="max-w-[12rem] break-words px-3 py-2 text-muted-foreground">{row.hookActivity || "—"}</td>
              <td className="px-3 py-2 text-muted-foreground">{row.mood || "—"}</td>
              <td className="px-3 py-2 text-muted-foreground">{row.chapterType || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "primary" }) {
  return (
    <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
      {children}
    </span>
  );
}
