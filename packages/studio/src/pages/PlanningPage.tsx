import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getPublishedArc,
  getArcDrafts,
  createArcDraft,
  getArcPreflight,
  publishArc,
  getBeats,
  getLookahead,
  getDetailedPlan,
  getGateReport,
  parseDirection,
  getPendingDirections,
  confirmDirection,
  resolveDirectionConflict,
  createAuthorization,
  confirmAuthorization,
  listAuthorizations,
  writeChapter,
  regeneratePlan,
  ApiError,
} from "../lib/planning-api";
import {
  planningCacheKey,
  getGatePanel,
  getValidActions,
  shouldShowWriteButton,
  hasNoApproveForSafe,
  hasNoWriteAnyway,
  lookaheadIsAdvisory,
  pendingIsNotAuthority,
  getPendingDirectionDisplay,
  isLookaheadStale,
  isLookaheadCurrent,
  getLookaheadStatus,
  isPublishedVsDraft,
} from "./planning-ui-state";

interface PlanningPageProps {
  readonly bookId: string;
}

type Lang = "zh" | "en";
function pick(lang: Lang, zh: string, en: string): string {
  return lang === "zh" ? zh : en;
}

export function PlanningPage({ bookId }: PlanningPageProps) {
  const [lang, setLang] = useState<Lang>("zh");
  const cacheKey = useMemo(() => {
    try { return planningCacheKey(bookId); } catch { return `planning:invalid:${bookId}`; }
  }, [bookId]);

  // Data states
  const [publishedArc, setPublishedArc] = useState<Record<string, unknown> | null>(null);
  const [drafts, setDrafts] = useState<Array<Record<string, unknown>>>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<Record<string, unknown> | null>(null);
  const [beats, setBeats] = useState<Record<string, unknown> | null>(null);
  const [lookahead, setLookahead] = useState<Record<string, unknown> | null>(null);
  const [detailedPlan, setDetailedPlan] = useState<Record<string, unknown> | null>(null);
  const [gate, setGate] = useState<Record<string, unknown> | null>(null);
  const [directions, setDirections] = useState<Array<Record<string, unknown>>>([]);
  const [authorizations, setAuthorizations] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // Direction input
  const [directionText, setDirectionText] = useState("");
  const [pendingDirection, setPendingDirection] = useState<Record<string, unknown> | null>(null);

  // Authorization form
  const [authKind, setAuthKind] = useState("major_character_death");
  const [authScope, setAuthScope] = useState("");

  // Selected tab — purely presentational
  const [selectedTab, setSelectedTab] = useState("overview");

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pub, dr, bt, lh, dp, gt, dirs, auths] = await Promise.all([
        getPublishedArc(bookId).catch(() => null),
        getArcDrafts(bookId).catch(() => ({ drafts: [] as unknown[] })),
        getBeats(bookId).catch(() => null),
        getLookahead(bookId).catch(() => null),
        getDetailedPlan(bookId).catch(() => null),
        getGateReport(bookId).catch(() => null),
        getPendingDirections(bookId).catch(() => ({ items: [] as unknown[] })),
        listAuthorizations(bookId).catch(() => ({ items: [] as unknown[] })),
      ]);
      setPublishedArc(pub as Record<string, unknown> | null);
      const draftList = (dr as { drafts?: unknown[]; items?: unknown[] } | null)?.drafts ?? (dr as { items?: unknown[] } | null)?.items ?? (Array.isArray(dr) ? dr as unknown[] : []);
      setDrafts((draftList as unknown[]) as Array<Record<string, unknown>>);
      setBeats(bt as Record<string, unknown> | null);
      setLookahead(lh as Record<string, unknown> | null);
      setDetailedPlan(dp as Record<string, unknown> | null);
      setGate(gt as Record<string, unknown> | null);
      const dirItems = (dirs as { items?: unknown[]; directions?: unknown[] } | null)?.items ?? (dirs as { directions?: unknown[] } | null)?.directions ?? (Array.isArray(dirs) ? dirs as unknown[] : []);
      setDirections((dirItems as unknown[]) as Array<Record<string, unknown>>);
      const authItems = (auths as { items?: unknown[] } | null)?.items ?? (Array.isArray(auths) ? auths as unknown[] : []);
      setAuthorizations((authItems as unknown[]) as Array<Record<string, unknown>>);
      // preflight for selected draft
      if (selectedDraftId) {
        try { const pf = await getArcPreflight(bookId, selectedDraftId); setPreflight(pf as Record<string, unknown>); } catch { setPreflight(null); }
      } else {
        try { const pf = await getArcPreflight(bookId); setPreflight(pf as Record<string, unknown>); } catch { setPreflight(null); }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, [bookId, selectedDraftId]);

  useEffect(() => { void reload(); }, [reload]);

  // Reset on bookId change (key isolation, but also clear)
  useEffect(() => {
    setSelectedDraftId(null);
    setPendingDirection(null);
    setDirectionText("");
    setMessage(null);
    setError(null);
  }, [bookId]);

  // Derived UI via planning-ui-state helpers — never evaluate Canon correctness
  const gatePanel = useMemo(() => {
    if (!gate) return "conflict" as const;
    try { return getGatePanel(gate as unknown as import("./planning-ui-state").PlanningGateReport); } catch { return "conflict" as const; }
  }, [gate]);
  const validActions = useMemo(() => {
    if (!gate) return [] as string[];
    try { return getValidActions(gate as unknown as import("./planning-ui-state").PlanningGateReport); } catch { return []; }
  }, [gate]);
  const showWrite = useMemo(() => {
    if (!gate) return false;
    try { return shouldShowWriteButton(gate as unknown as import("./planning-ui-state").PlanningGateReport); } catch { return false; }
  }, [gate]);
  const publishedVsDraft = useMemo(() => {
    try { return isPublishedVsDraft({ bookId, publishedArc, draftArc: drafts[0] ?? null, gate: (gate ?? { verdict: "conflict" }) as unknown as import("./planning-ui-state").PlanningGateReport, selectedTab } as unknown as import("./planning-ui-state").PlanningOverview); } catch { return { publishedIsAuthority: Boolean(publishedArc), draftIsAuthority: false }; }
  }, [bookId, publishedArc, drafts, gate, selectedTab]);

  // Handlers

  const handleCreateDraft = async () => {
    if (busy) return;
    setBusy("createDraft");
    setMessage(null);
    try {
      const res = await createArcDraft(bookId, {});
      setMessage(pick(lang, `已创建草稿 ${String((res as { draftId?: string }).draftId ?? "")}`, `Created draft ${String((res as { draftId?: string }).draftId ?? "")}`));
      await reload();
    } catch (e) {
      const msg = e instanceof ApiError ? `${e.message} (${e.code ?? e.status})` : e instanceof Error ? e.message : String(e);
      setMessage(msg);
    } finally { setBusy(null); }
  };

  const handlePublish = async () => {
    if (busy || !selectedDraftId) return;
    const draftId = selectedDraftId ?? (drafts[0] as { draftId?: string } | undefined)?.draftId;
    if (!draftId) { setMessage(pick(lang, "请选择要发布的草稿", "Select a draft to publish")); return; }
    setBusy("publish");
    setMessage(null);
    try {
      const res = await publishArc(bookId, { draftId, humanActor: "human" });
      setMessage(pick(lang, `发布成功 ${JSON.stringify(res).slice(0, 80)}`, `Published ${JSON.stringify(res).slice(0, 80)}`));
      await reload();
    } catch (e) {
      const msg = e instanceof ApiError ? `${e.message} (${e.code ?? e.status})` : e instanceof Error ? e.message : String(e);
      setMessage(msg);
    } finally { setBusy(null); }
  };

  const handleParseDirection = async () => {
    if (busy || !directionText.trim()) return;
    setBusy("parse");
    setMessage(null);
    try {
      const res = await parseDirection(bookId, { text: directionText.trim() });
      setPendingDirection(res as Record<string, unknown>);
      setMessage(pick(lang, "已解析为待确认提案", "Parsed as pending proposal"));
      await reload();
    } catch (e) {
      const msg = e instanceof ApiError ? `${e.message} (${e.code ?? e.status})` : e instanceof Error ? e.message : String(e);
      setMessage(msg);
    } finally { setBusy(null); }
  };

  const handleConfirmDirection = async (dirId: string) => {
    if (busy) return;
    setBusy(`confirm:${dirId}`);
    setMessage(null);
    try {
      const res = await confirmDirection(bookId, dirId, { humanActor: "human" });
      setMessage(pick(lang, `已确认方向 ${String((res as { directionId?: string }).directionId ?? dirId)}`, `Confirmed direction ${String((res as { directionId?: string }).directionId ?? dirId)}`));
      setPendingDirection(null);
      setDirectionText("");
      await reload();
    } catch (e) {
      const msg = e instanceof ApiError ? `${e.message} (${e.code ?? e.status})` : e instanceof Error ? e.message : String(e);
      setMessage(msg);
    } finally { setBusy(null); }
  };

  const handleResolveConflict = async (strategy: string) => {
    if (busy || !pendingDirection) return;
    const dirId = String((pendingDirection as { directionId?: string }).directionId ?? "");
    setBusy("resolve");
    try {
      await resolveDirectionConflict(bookId, { directionId: dirId, resolution: strategy, strategy });
      setMessage(pick(lang, `已通过 ${strategy} 解决冲突`, `Resolved conflict via ${strategy}`));
      setPendingDirection(null);
      await reload();
    } catch (e) {
      const msg = e instanceof ApiError ? `${e.message} (${e.code ?? e.status})` : e instanceof Error ? e.message : String(e);
      setMessage(msg);
    } finally { setBusy(null); }
  };

  const handleCreateAuth = async () => {
    if (busy) return;
    setBusy("createAuth");
    try {
      const res = await createAuthorization(bookId, { kind: authKind, scope: authScope || undefined, humanActor: "human" });
      setMessage(pick(lang, `已创建授权 ${String((res as { authorizationId?: string }).authorizationId ?? (res as { id?: string }).id ?? "")} 待确认`, `Created authorization ${String((res as { authorizationId?: string }).authorizationId ?? (res as { id?: string }).id ?? "")} pending`));
      await reload();
    } catch (e) {
      const msg = e instanceof ApiError ? `${e.message} (${e.code ?? e.status})` : e instanceof Error ? e.message : String(e);
      setMessage(msg);
    } finally { setBusy(null); }
  };

  const handleConfirmAuth = async (authId: string) => {
    if (busy) return;
    setBusy(`confirmAuth:${authId}`);
    try {
      await confirmAuthorization(bookId, authId, { humanActor: "human" });
      setMessage(pick(lang, `已确认授权 ${authId}`, `Confirmed authorization ${authId}`));
      await reload();
    } catch (e) {
      const msg = e instanceof ApiError ? `${e.message} (${e.code ?? e.status})` : e instanceof Error ? e.message : String(e);
      setMessage(msg);
    } finally { setBusy(null); }
  };

  const handleWrite = async () => {
    if (busy) return;
    setBusy("write");
    setMessage(null);
    try {
      const res = await writeChapter(bookId, {});
      setMessage(pick(lang, `写作成功 ${JSON.stringify(res).slice(0, 120)}`, `Write succeeded ${JSON.stringify(res).slice(0, 120)}`));
      await reload();
    } catch (e) {
      // Surface CONFLICT / AUTHOR_DECISION / UNCERTAIN / budget errors, no fallback
      const msg = e instanceof ApiError ? `${e.message} [${e.code ?? e.status}]` : e instanceof Error ? e.message : String(e);
      setMessage(msg);
    } finally { setBusy(null); }
  };

  const handleRegenerate = async () => {
    if (busy) return;
    setBusy("regenerate");
    try {
      const res = await regeneratePlan(bookId, {});
      setMessage(pick(lang, `已重新生成 ${JSON.stringify(res).slice(0, 80)}`, `Regenerated ${JSON.stringify(res).slice(0, 80)}`));
      await reload();
    } catch (e) {
      const msg = e instanceof ApiError ? `${e.message} (${e.code ?? e.status})` : e instanceof Error ? e.message : String(e);
      setMessage(msg);
    } finally { setBusy(null); }
  };

  // Use booleans to satisfy hasNoApproveForSafe etc. invariants in UI
  void hasNoApproveForSafe;
  void hasNoWriteAnyway;
  void lookaheadIsAdvisory;
  void pendingIsNotAuthority;

  return (
    <div key={bookId} data-testid="planning-page" data-cache-key={cacheKey} className="mx-auto w-full max-w-[1200px] space-y-6 p-6 fade-in">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{pick(lang, "规划 · Planning", "Planning")}</h1>
          <p className="mt-1 text-xs text-muted-foreground">bookId: <span className="font-mono">{bookId}</span> · cacheKey: <span className="font-mono">{cacheKey}</span> · tab: {selectedTab}</p>
          <p className="mt-1 text-xs text-muted-foreground">{pick(lang, "已发布权威 vs 草稿 — 明确区分；发布需显式操作", "PUBLISHED AUTHORITY vs DRAFT — clearly separated; Publish is explicit")}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5 rounded-lg bg-muted/50 p-0.5">
            {(["zh", "en"] as const).map((v) => (
              <button key={v} onClick={() => setLang(v)} className={`rounded-md px-2.5 py-1 text-xs font-medium ${lang === v ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{v === "zh" ? "中" : "EN"}</button>
            ))}
          </div>
          <button onClick={() => void reload()} className="rounded-lg border border-border/50 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">{pick(lang, "刷新", "Refresh")}</button>
        </div>
      </header>

      {/* Tabs — simple */}
      <div className="flex gap-2 border-b border-border/50 pb-2">
        {["overview", "beats", "lookahead", "detailed", "gate", "directions", "authorizations"].map((tab) => (
          <button key={tab} onClick={() => setSelectedTab(tab)} className={`rounded-full px-3 py-1 text-xs font-medium ${selectedTab === tab ? "bg-primary text-primary-foreground" : "bg-secondary/40 text-muted-foreground border border-border/50"}`}>{tab}</button>
        ))}
      </div>

      {loading && <div className="py-8 text-center text-sm text-muted-foreground">{pick(lang, "加载中…", "Loading…")}</div>}
      {error && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>}
      {message && <div role="status" className="rounded-xl border border-border/50 bg-card/50 p-3 text-sm text-foreground break-words">{message}</div>}

      {/* Gate Panel — Task 49 invariants */}
      <section className="rounded-2xl border border-border/50 bg-card/50 p-4">
        <h2 className="text-sm font-semibold text-foreground">{pick(lang, "规划门禁 · Planning Gate", "Planning Gate")}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-bold border ${
            gatePanel === "safe" ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/30" :
            gatePanel === "uncertain" ? "bg-amber-500/10 text-amber-700 border-amber-500/30" :
            gatePanel === "author_decision" ? "bg-sky-500/10 text-sky-700 border-sky-500/30" :
            "bg-destructive/10 text-destructive border-destructive/30"
          }`}>Gate: {gatePanel.toUpperCase()} · {String(gate?.verdict ?? gate?.outcome ?? "unknown")}</span>
          <span className="text-xs text-muted-foreground">{pick(lang, "允许动作：", "Valid actions: ")} {validActions.join(", ") || "—"}</span>
        </div>

        {/* SAFE: no Approve Plan, show Write */}
        {gatePanel === "safe" && (
          <div className="mt-3 space-y-2">
            <p className="text-xs text-muted-foreground">{pick(lang, "SAFE：门禁通过，可写作。无需批准计划。", "SAFE: gate passed, write allowed. No Approve Plan needed.")}</p>
            {/* Ensure no element with text "Approve Plan" */}
            {showWrite && (
              <button onClick={() => void handleWrite()} disabled={!!busy} className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50">{busy === "write" ? pick(lang, "写作中…", "Writing…") : pick(lang, "写作下一章 · Write Chapter", "Write Chapter")}</button>
            )}
          </div>
        )}
        {gatePanel === "uncertain" && (
          <div className="mt-3 space-y-2">
            <p className="text-sm text-amber-700">{pick(lang, "UNCERTAIN：存在需人工复核的顾虑，暂不可写作。请解决顾虑后重试。", "UNCERTAIN: concerns need human review, write blocked. Resolve concerns.")}</p>
            {Array.isArray((gate as { concerns?: unknown[] })?.concerns) && ((gate as { concerns: unknown[] }).concerns.length > 0) && (
              <ul className="list-disc pl-5 text-xs text-muted-foreground">
                {((gate as { concerns: string[] }).concerns).map((c, i) => <li key={i}>{String(c)}</li>)}
              </ul>
            )}
            {/* No Write button for UNCERTAIN */}
            <button onClick={() => void handleRegenerate()} disabled={!!busy} className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-500/20 disabled:opacity-50">{pick(lang, "重新生成计划 · Regenerate", "Regenerate Plan")}</button>
          </div>
        )}
        {gatePanel === "author_decision" && (
          <div className="mt-3 space-y-2">
            <p className="text-sm text-sky-700">{pick(lang, "AUTHOR_DECISION：需要作者授权。请选择缺失类型并创建授权。", "AUTHOR_DECISION: author authorization required. Create authorization for missing kinds.")}</p>
            {Array.isArray((gate as { missing?: unknown[] })?.missing) && (
              <div className="flex flex-wrap gap-1">
                {((gate as { missing: string[] }).missing).map((m, i) => <span key={i} className="rounded-full bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 text-xs text-sky-700">{String(m)}</span>)}
              </div>
            )}
            <div className="flex gap-2">
              <input value={authKind} onChange={(e) => setAuthKind(e.target.value)} placeholder="authorization kind" className="rounded-lg border border-border/50 bg-background px-3 py-1.5 text-xs" />
              <button onClick={() => void handleCreateAuth()} disabled={!!busy} className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-50">{pick(lang, "创建授权 · Create Authorization", "Create Authorization")}</button>
            </div>
            {/* No Write */}
          </div>
        )}
        {gatePanel === "conflict" && (
          <div className="mt-3 space-y-2">
            <p className="text-sm text-destructive font-medium">{pick(lang, "CONFLICT：硬性阻断，存在确定性冲突。不可写作，亦无绕过。", "CONFLICT: hard block, deterministic conflict. Write blocked, no bypass.")}</p>
            {Array.isArray((gate as { evidence?: unknown[] })?.evidence) && (
              <ul className="list-disc pl-5 text-xs text-muted-foreground">
                {((gate as { evidence: unknown[] }).evidence).map((ev, i) => <li key={i} className="break-words">{String(ev)}</li>)}
              </ul>
            )}
            {/* Must not show Write Anyway */}
            <p className="text-xs text-muted-foreground">{pick(lang, "不提供“仍要写作”按钮", "No Write Anyway button")}</p>
          </div>
        )}
        {/* Raw gate JSON for debug */}
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-muted-foreground">{pick(lang, "查看门禁详情", "View gate report")}</summary>
          <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-secondary/20 p-3 text-xs">{JSON.stringify(gate, null, 2)}</pre>
        </details>
      </section>

      {/* Published Arc vs Draft */}
      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-emerald-700">{pick(lang, "已发布弧计划 · PUBLISHED ARC PLAN", "PUBLISHED ARC PLAN")}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{publishedVsDraft.publishedIsAuthority ? pick(lang, "权威（已发布）", "Authority (published)") : pick(lang, "暂无已发布", "No published arc")}</p>
          <div className="mt-3 rounded-xl bg-background p-3 text-xs">
            {publishedArc ? <pre className="max-h-48 overflow-auto text-xs">{JSON.stringify(publishedArc, null, 2)}</pre> : <p className="text-muted-foreground">{pick(lang, "暂无", "None")}</p>}
          </div>
          {publishedArc && (
            <p className="mt-2 text-xs text-muted-foreground">{pick(lang, "已发布为权威，草稿非权威", "Published is authority; draft is not")}</p>
          )}
        </div>
        <div className="rounded-2xl border border-sky-500/30 bg-sky-500/5 p-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-sky-700">{pick(lang, "弧草稿 · ARC DRAFT", "ARC DRAFT")}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{pick(lang, "草稿非权威，需显式发布", "Draft is not authority; explicit Publish required")}</p>
          <div className="mt-3 flex gap-2">
            <button onClick={() => void handleCreateDraft()} disabled={!!busy} className="rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground disabled:opacity-50">{busy === "createDraft" ? pick(lang, "创建中…", "Creating…") : pick(lang, "创建草稿", "Create Draft")}</button>
            <button onClick={() => void handlePublish()} disabled={!!busy || !selectedDraftId} className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40 hover:bg-emerald-500">{pick(lang, "发布 · Publish", "Publish")}</button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">{pick(lang, "不会自动发布 — 仅点击发布按钮触发", "No auto-Publish — only explicit button")}</p>
          <div className="mt-3 space-y-2">
            {drafts.length === 0 && <p className="text-xs text-muted-foreground">{pick(lang, "暂无草稿", "No drafts")}</p>}
            {drafts.map((d) => {
              const did = String((d as { draftId?: string; id?: string }).draftId ?? (d as { id?: string }).id ?? "");
              const isSelected = did === selectedDraftId;
              return (
                <div key={did || JSON.stringify(d).slice(0, 12)} className={`rounded-xl border p-3 ${isSelected ? "border-primary bg-primary/5" : "border-border/50 bg-background"}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold">{did || pick(lang, "草稿", "Draft")}</span>
                    <span className="text-[11px] text-muted-foreground">{String((d as { status?: string }).status ?? "")}</span>
                  </div>
                  <button onClick={() => setSelectedDraftId(did)} className="mt-2 rounded-lg border border-border/50 px-2 py-1 text-xs text-muted-foreground hover:text-foreground">{pick(lang, "选中", "Select")}</button>
                  <pre className="mt-2 max-h-24 overflow-auto text-[11px] text-muted-foreground">{JSON.stringify(d, null, 2)}</pre>
                </div>
              );
            })}
          </div>
          {preflight && (
            <div className="mt-3 rounded-xl bg-background p-3">
              <h4 className="text-xs font-medium">{pick(lang, "发布前检查 · Preflight", "Preflight")}</h4>
              <pre className="mt-1 max-h-32 overflow-auto text-xs text-muted-foreground">{JSON.stringify(preflight, null, 2)}</pre>
            </div>
          )}
        </div>
      </section>

      {/* Beats */}
      <section className="rounded-2xl border border-border/50 bg-card/40 p-4">
        <h2 className="text-sm font-semibold text-foreground">{pick(lang, "重大节拍进度 · Major Beat Progress", "Major Beat Progress")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{pick(lang, "必填/可选、状态、正史证据", "required/optional, state, Canon evidence")}</p>
        <div className="mt-3">
          {beats ? (
            <div className="space-y-3">
              {Array.isArray((beats as { beats?: unknown[] }).beats) && ((beats as { beats: Array<Record<string, unknown>> }).beats).map((b, i) => (
                <div key={i} className="rounded-xl border border-border/50 bg-background p-3">
                  <div className="flex flex-wrap gap-2">
                    <span className="font-mono text-xs font-semibold">{String((b as { beatId?: string }).beatId ?? `beat-${i}`)}</span>
                    <span className="rounded-full bg-secondary/40 px-2 py-0.5 text-[10px]">{String((b as { importance?: string }).importance ?? (b as { required?: boolean }).required ? "required" : "optional")}</span>
                    <span className="rounded-full border border-border/50 px-2 py-0.5 text-[10px] text-muted-foreground">{String((b as { state?: string }).state ?? (b as { status?: string }).status ?? "")}</span>
                  </div>
                  {(b as { evidence?: unknown }).evidence !== undefined && <pre className="mt-1 text-xs text-muted-foreground break-words">{JSON.stringify((b as { evidence: unknown }).evidence, null, 2)}</pre>}
                  <pre className="mt-1 text-xs text-muted-foreground break-words">{JSON.stringify(b, null, 2)}</pre>
                </div>
              ))}
              {!Array.isArray((beats as { beats?: unknown[] }).beats) && <pre className="max-h-48 overflow-auto text-xs text-muted-foreground">{JSON.stringify(beats, null, 2)}</pre>}
            </div>
          ) : <p className="text-xs text-muted-foreground">{pick(lang, "暂无节拍", "No beats")}</p>}
        </div>
      </section>

      {/* Lookahead — advisory, no Approve/Publish */}
      <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
        <h2 className="text-sm font-semibold text-foreground">{pick(lang, "滚动前瞻 · Rolling Lookahead", "Rolling Lookahead")} <span className="ml-2 rounded-full bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-700">{pick(lang, "仅建议", "Advisory Only")}</span></h2>
        <p className="mt-1 text-xs text-muted-foreground">{pick(lang, "前瞻为建议性，非权威；无批准/发布按钮", "Lookahead is advisory, not authority; no Approve/Publish")}</p>
        {lookahead && (
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <span className={`rounded-full px-2 py-0.5 border ${isLookaheadStale(lookahead as unknown as import("./planning-ui-state").LookaheadState) ? "bg-amber-500/10 text-amber-700 border-amber-500/20" : "bg-emerald-500/10 text-emerald-700 border-emerald-500/20"}`}>{getLookaheadStatus(lookahead as unknown as import("./planning-ui-state").LookaheadState)}</span>
            <span className="rounded-full bg-secondary/40 border border-border/50 px-2 py-0.5 text-muted-foreground">{isLookaheadCurrent(lookahead as unknown as import("./planning-ui-state").LookaheadState) ? "current" : "not current"}</span>
            {Boolean((lookahead as { superseded?: boolean }).superseded || (lookahead as { status?: string }).status === "superseded") && <span className="rounded-full bg-secondary/40 px-2 py-0.5">superseded</span>}
            {Boolean((lookahead as { consumed?: boolean }).consumed || (lookahead as { status?: string }).status === "consumed") && <span className="rounded-full bg-secondary/40 px-2 py-0.5">consumed</span>}
          </div>
        )}
        <div className="mt-3 rounded-xl bg-background p-3">
          {lookahead ? <pre className="max-h-48 overflow-auto text-xs text-muted-foreground">{JSON.stringify(lookahead, null, 2)}</pre> : <p className="text-xs text-muted-foreground">{pick(lang, "暂无前瞻", "No lookahead")}</p>}
        </div>
        {/* Explicitly no Approve/Publish for lookahead */}
        <p className="mt-2 text-[11px] text-muted-foreground">{pick(lang, "不提供批准/发布前瞻的按钮", "No Approve/Publish button for lookahead")}</p>
      </section>

      {/* Detailed Plan */}
      <section className="rounded-2xl border border-border/50 bg-card/40 p-4">
        <h2 className="text-sm font-semibold text-foreground">{pick(lang, "详细计划 · Detailed Plan", "Detailed Plan")}</h2>
        {detailedPlan ? (
          <div className="mt-3 space-y-2 text-xs">
            <div className="rounded-xl bg-background p-3">
              <div className="grid gap-1 font-mono">
                <span>planId: {String((detailedPlan as { planId?: string }).planId ?? "—")}</span>
                <span>chapter: {String((detailedPlan as { chapter?: number }).chapter ?? (detailedPlan as { chapterNumber?: number }).chapterNumber ?? "—")}</span>
                <span>status: {String((detailedPlan as { status?: string }).status ?? "—")}</span>
              </div>
              <div className="mt-2">
                <h4 className="font-semibold text-foreground">{pick(lang, "意图 · Intent", "Intent")}</h4>
                <pre className="mt-1 max-h-32 overflow-auto text-muted-foreground">{JSON.stringify((detailedPlan as { intent?: unknown }).intent ?? "—", null, 2)}</pre>
              </div>
              <div className="mt-2">
                <h4 className="font-semibold text-foreground">{pick(lang, "备忘 · Memo", "Memo")}</h4>
                <pre className="mt-1 max-h-32 overflow-auto text-muted-foreground">{JSON.stringify((detailedPlan as { memo?: unknown }).memo ?? "—", null, 2)}</pre>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="text-muted-foreground">{pick(lang, "依据 · Bases：", "Bases:")} {JSON.stringify((detailedPlan as { bases?: unknown }).bases ?? (detailedPlan as { basis?: unknown }).basis ?? "—")}</span>
              </div>
              <div className="mt-1">
                <span className="text-muted-foreground">{pick(lang, "引用 · Refs：", "Refs:")} {JSON.stringify((detailedPlan as { refs?: unknown }).refs ?? (detailedPlan as { references?: unknown }).references ?? "—")}</span>
              </div>
              <details className="mt-2">
                <summary className="cursor-pointer text-muted-foreground">{pick(lang, "查看完整计划", "View full plan")}</summary>
                <pre className="mt-2 max-h-48 overflow-auto">{JSON.stringify(detailedPlan, null, 2)}</pre>
              </details>
            </div>
            {detailedPlan && (detailedPlan as { gateReport?: unknown }).gateReport !== undefined && (
              <div className="rounded-xl bg-background p-3">
                <h4 className="font-semibold text-foreground">{pick(lang, "门禁报告 · Gate Report", "Gate Report")}</h4>
                <pre className="mt-1 max-h-32 overflow-auto text-muted-foreground">{JSON.stringify((detailedPlan as { gateReport: unknown }).gateReport, null, 2)}</pre>
              </div>
            )}
          </div>
        ) : <p className="text-xs text-muted-foreground">{pick(lang, "暂无详细计划", "No detailed plan")}</p>}
        <button onClick={() => void handleRegenerate()} disabled={!!busy} className="mt-3 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2 text-xs font-bold text-primary hover:bg-primary/20 disabled:opacity-50">{busy === "regenerate" ? pick(lang, "重新生成中…", "Regenerating…") : pick(lang, "重新生成计划 · Regenerate", "Regenerate Plan")}</button>
      </section>

      {/* Human Direction NL */}
      <section className="rounded-2xl border border-border/50 bg-card/40 p-4">
        <h2 className="text-sm font-semibold text-foreground">{pick(lang, "人类指令 · Human Direction", "Human Direction")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{pick(lang, "自然语言输入 → 解析为待确认提案 → 确认； pending 非权威", "NL input → parse to pending proposal → confirm; pending is not authority")}</p>
        <div className="mt-3 flex gap-2">
          <input value={directionText} onChange={(e) => setDirectionText(e.target.value)} placeholder={pick(lang, "输入自然语言指令…", "Enter natural language direction…")} className="flex-1 rounded-xl border border-border/50 bg-background px-3 py-2 text-sm" />
          <button onClick={() => void handleParseDirection()} disabled={!!busy || !directionText.trim()} className="rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground disabled:opacity-50">{busy === "parse" ? pick(lang, "解析中…", "Parsing…") : pick(lang, "解析 · Parse", "Parse")}</button>
        </div>
        {pendingDirection && (
          <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-semibold">{String((pendingDirection as { directionId?: string }).directionId ?? "pending")}</span>
              <span className="rounded-full bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-xs text-amber-700">{String((pendingDirection as { status?: string }).status ?? "pending")} · {getPendingDirectionDisplay(pendingDirection as unknown as import("./planning-ui-state").HumanDirectionState)}</span>
            </div>
            <pre className="mt-2 max-h-24 overflow-auto text-xs text-muted-foreground">{JSON.stringify(pendingDirection, null, 2)}</pre>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => void handleConfirmDirection(String((pendingDirection as { directionId?: string }).directionId ?? ""))} disabled={!!busy} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50">{pick(lang, "确认 · Confirm", "Confirm")}</button>
              <button onClick={() => void handleResolveConflict("override")} disabled={!!busy} className="rounded-lg border border-border/50 px-3 py-1.5 text-xs hover:bg-secondary/40">{pick(lang, "覆盖 override", "Override")}</button>
              <button onClick={() => void handleResolveConflict("replace")} disabled={!!busy} className="rounded-lg border border-border/50 px-3 py-1.5 text-xs hover:bg-secondary/40">{pick(lang, "替换 replace", "Replace")}</button>
              <button onClick={() => void handleResolveConflict("keep")} disabled={!!busy} className="rounded-lg border border-border/50 px-3 py-1.5 text-xs hover:bg-secondary/40">{pick(lang, "保留 keep", "Keep")}</button>
              <button onClick={() => void handleResolveConflict("edit")} disabled={!!busy} className="rounded-lg border border-border/50 px-3 py-1.5 text-xs hover:bg-secondary/40">{pick(lang, "编辑 edit", "Edit")}</button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">{pick(lang, "冲突通过上述策略解决", "Conflict resolved via strategies above")}</p>
          </div>
        )}
        <div className="mt-3">
          <h4 className="text-xs font-medium text-foreground">{pick(lang, "待定方向 · Pending Directions", "Pending Directions")}</h4>
          <div className="mt-2 space-y-2">
            {directions.length === 0 && <p className="text-xs text-muted-foreground">{pick(lang, "暂无", "None")}</p>}
            {directions.map((d) => {
              const did = String((d as { directionId?: string; id?: string }).directionId ?? (d as { id?: string }).id ?? "");
              const status = String((d as { status?: string }).status ?? "");
              return (
                <div key={did || JSON.stringify(d).slice(0, 12)} className="rounded-xl border border-border/50 bg-background p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold">{did}</span>
                    <span className="rounded-full bg-secondary/40 px-2 py-0.5 text-xs">{status}</span>
                    <span className="text-xs text-muted-foreground">{getPendingDirectionDisplay(d as unknown as import("./planning-ui-state").HumanDirectionState)}</span>
                    {pendingIsNotAuthority && <span className="text-[11px] text-muted-foreground">({pick(lang, "pending 非权威", "pending not authority")})</span>}
                  </div>
                  <pre className="mt-1 max-h-24 overflow-auto text-xs text-muted-foreground">{JSON.stringify(d, null, 2)}</pre>
                  {status === "pending" && <button onClick={() => void handleConfirmDirection(did)} disabled={!!busy} className="mt-2 rounded-lg bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50">{pick(lang, "确认", "Confirm")}</button>}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Authorization UI */}
      <section className="rounded-2xl border border-border/50 bg-card/40 p-4">
        <h2 className="text-sm font-semibold text-foreground">{pick(lang, "授权 · Authorization", "Authorization")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{pick(lang, "创建 pending → 确认；展示生命周期；无消费", "create pending → confirm; show lifecycle; no consume")}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input value={authKind} onChange={(e) => setAuthKind(e.target.value)} placeholder="kind (e.g. major_character_death)" className="rounded-lg border border-border/50 bg-background px-3 py-1.5 text-xs" />
          <input value={authScope} onChange={(e) => setAuthScope(e.target.value)} placeholder="scope (optional)" className="rounded-lg border border-border/50 bg-background px-3 py-1.5 text-xs" />
          <button onClick={() => void handleCreateAuth()} disabled={!!busy} className="rounded-xl bg-sky-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-50">{pick(lang, "创建授权", "Create Authorization")}</button>
        </div>
        <div className="mt-3 space-y-2">
          {authorizations.length === 0 && <p className="text-xs text-muted-foreground">{pick(lang, "暂无授权", "No authorizations")}</p>}
          {authorizations.map((a) => {
            const aid = String((a as { authorizationId?: string; id?: string }).authorizationId ?? (a as { id?: string }).id ?? "");
            const status = String((a as { status?: string }).status ?? (a as { lifecycle?: string }).lifecycle ?? "");
            const lifecycle = String((a as { lifecycle?: string }).lifecycle ?? status);
            return (
              <div key={aid || JSON.stringify(a).slice(0, 12)} className="rounded-xl border border-border/50 bg-background p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-semibold">{aid}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs border ${status === "confirmed" || lifecycle === "active" ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/20" : "bg-amber-500/10 text-amber-700 border-amber-500/20"}`}>{status || lifecycle}</span>
                  <span className="text-xs text-muted-foreground">lifecycle: {lifecycle}</span>
                  <span className="text-xs text-muted-foreground">kind: {String((a as { kind?: string }).kind ?? "—")}</span>
                </div>
                <pre className="mt-1 max-h-24 overflow-auto text-xs text-muted-foreground">{JSON.stringify(a, null, 2)}</pre>
                {(status === "pending" || lifecycle === "pending") && <button onClick={() => void handleConfirmAuth(aid)} disabled={!!busy} className="mt-2 rounded-lg bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50">{pick(lang, "确认授权 · Confirm", "Confirm")}</button>}
                {/* No consume button — lifecycle is confirm-only */}
              </div>
            );
          })}
        </div>
      </section>

      {/* Write Chapter & Regenerate already surfaced above; also standalone */}
      <section className="rounded-2xl border border-border/50 bg-card/40 p-4">
        <h2 className="text-sm font-semibold text-foreground">{pick(lang, "写作与再生 · Write & Regenerate", "Write & Regenerate")}</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => void handleWrite()} disabled={!!busy || !showWrite} title={showWrite ? "" : pick(lang, "门禁未通过，写作被阻断", "Gate blocked, write disabled")} className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed">{pick(lang, "写作下一章 · Write Chapter", "Write Chapter")}</button>
          <button onClick={() => void handleRegenerate()} disabled={!!busy} className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-2 text-xs font-bold text-primary hover:bg-primary/20 disabled:opacity-50">{pick(lang, "重新生成计划", "Regenerate Plan")}</button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{pick(lang, "写作入口为 Task 19；错误直接透传 CONFLICT/AUTHOR_DECISION/UNCERTAIN/budget，无回退。", "Write entry is Task 19; errors surface CONFLICT/AUTHOR_DECISION/UNCERTAIN/budget directly, no fallback.")}</p>
      </section>

      <footer className="pb-6 text-center text-xs text-muted-foreground">
        {pick(lang, "规划页 — 纯映射 Core 结果，不评估正史/范围/授权/节拍/门禁正确性", "Planning — maps Core result to UI, does not evaluate Canon/scope/Authorization/Beat/Gate correctness")}
      </footer>
    </div>
  );
}

export default PlanningPage;
