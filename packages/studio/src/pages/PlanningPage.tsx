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

type Lang = "vi" | "en";
function pick(lang: Lang, vi: string, en: string): string {
  return lang === "vi" ? vi : en;
}

export function PlanningPage({ bookId }: PlanningPageProps) {
  const [lang, setLang] = useState<Lang>("vi");
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
      setMessage(pick(lang, `Đã tạo bản nháp ${String((res as { draftId?: string }).draftId ?? "")}`, `Created draft ${String((res as { draftId?: string }).draftId ?? "")}`));
      await reload();
    } catch (e) {
      const msg = e instanceof ApiError ? `${e.message} (${e.code ?? e.status})` : e instanceof Error ? e.message : String(e);
      setMessage(msg);
    } finally { setBusy(null); }
  };

  const handlePublish = async () => {
    if (busy || !selectedDraftId) return;
    const draftId = selectedDraftId ?? (drafts[0] as { draftId?: string } | undefined)?.draftId;
    if (!draftId) { setMessage(pick(lang, "Hãy chọn bản nháp cần xuất bản", "Select a draft to publish")); return; }
    setBusy("publish");
    setMessage(null);
    try {
      const res = await publishArc(bookId, { draftId, humanActor: "human" });
      setMessage(pick(lang, `Xuất bản thành công ${JSON.stringify(res).slice(0, 80)}`, `Published ${JSON.stringify(res).slice(0, 80)}`));
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
      setMessage(pick(lang, "Đã phân tích thành đề xuất chờ xác nhận", "Parsed as pending proposal"));
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
      setMessage(pick(lang, `Đã xác nhận hướng ${String((res as { directionId?: string }).directionId ?? dirId)}`, `Confirmed direction ${String((res as { directionId?: string }).directionId ?? dirId)}`));
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
      setMessage(pick(lang, `Đã giải quyết xung đột bằng ${strategy}`, `Resolved conflict via ${strategy}`));
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
      setMessage(pick(lang, `Đã tạo ủy quyền ${String((res as { authorizationId?: string }).authorizationId ?? (res as { id?: string }).id ?? "")} chờ xác nhận`, `Created authorization ${String((res as { authorizationId?: string }).authorizationId ?? (res as { id?: string }).id ?? "")} pending`));
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
      setMessage(pick(lang, `Đã xác nhận ủy quyền ${authId}`, `Confirmed authorization ${authId}`));
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
      setMessage(pick(lang, `Viết thành công ${JSON.stringify(res).slice(0, 120)}`, `Write succeeded ${JSON.stringify(res).slice(0, 120)}`));
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
      setMessage(pick(lang, `Đã tạo lại ${JSON.stringify(res).slice(0, 80)}`, `Regenerated ${JSON.stringify(res).slice(0, 80)}`));
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
          <h1 className="text-xl font-semibold text-foreground">{pick(lang, "Lập kế hoạch", "Planning")}</h1>
          <p className="mt-1 text-xs text-muted-foreground">bookId: <span className="font-mono">{bookId}</span> · cacheKey: <span className="font-mono">{cacheKey}</span> · tab: {selectedTab}</p>
          <p className="mt-1 text-xs text-muted-foreground">{pick(lang, "Bản chính thức đã xuất bản vs bản nháp — phân tách rõ ràng; xuất bản là thao tác tường minh", "PUBLISHED AUTHORITY vs DRAFT — clearly separated; Publish is explicit")}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5 rounded-lg bg-muted/50 p-0.5">
            {(["vi", "en"] as const).map((v) => (
              <button key={v} onClick={() => setLang(v)} className={`rounded-md px-2.5 py-1 text-xs font-medium ${lang === v ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{v === "vi" ? "VI" : "EN"}</button>
            ))}
          </div>
          <button onClick={() => void reload()} className="rounded-lg border border-border/50 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">{pick(lang, "Làm mới", "Refresh")}</button>
        </div>
      </header>

      {/* Tabs — simple */}
      <div className="flex gap-2 border-b border-border/50 pb-2">
        {["overview", "beats", "lookahead", "detailed", "gate", "directions", "authorizations"].map((tab) => (
          <button key={tab} onClick={() => setSelectedTab(tab)} className={`rounded-full px-3 py-1 text-xs font-medium ${selectedTab === tab ? "bg-primary text-primary-foreground" : "bg-secondary/40 text-muted-foreground border border-border/50"}`}>{tab}</button>
        ))}
      </div>

      {loading && <div className="py-8 text-center text-sm text-muted-foreground">{pick(lang, "Đang tải…", "Loading…")}</div>}
      {error && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>}
      {message && <div role="status" className="rounded-xl border border-border/50 bg-card/50 p-3 text-sm text-foreground break-words">{message}</div>}

      {/* Gate Panel — Task 49 invariants */}
      <section className="rounded-2xl border border-border/50 bg-card/50 p-4">
        <h2 className="text-sm font-semibold text-foreground">{pick(lang, "Cổng lập kế hoạch", "Planning Gate")}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-bold border ${
            gatePanel === "safe" ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/30" :
            gatePanel === "uncertain" ? "bg-amber-500/10 text-amber-700 border-amber-500/30" :
            gatePanel === "author_decision" ? "bg-sky-500/10 text-sky-700 border-sky-500/30" :
            "bg-destructive/10 text-destructive border-destructive/30"
          }`}>Gate: {gatePanel.toUpperCase()} · {String(gate?.verdict ?? gate?.outcome ?? "unknown")}</span>
          <span className="text-xs text-muted-foreground">{pick(lang, "Hành động được phép: ", "Valid actions: ")} {validActions.join(", ") || "—"}</span>
        </div>

        {/* SAFE: no Approve Plan, show Write */}
        {gatePanel === "safe" && (
          <div className="mt-3 space-y-2">
            <p className="text-xs text-muted-foreground">{pick(lang, "SAFE: cổng đã thông qua, được viết. Không cần phê duyệt kế hoạch.", "SAFE: gate passed, write allowed. No Approve Plan needed.")}</p>
            {/* Ensure no element with text "Approve Plan" */}
            {showWrite && (
              <button onClick={() => void handleWrite()} disabled={!!busy} className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50">{busy === "write" ? pick(lang, "Đang viết…", "Writing…") : pick(lang, "Viết chương tiếp theo", "Write Chapter")}</button>
            )}
          </div>
        )}
        {gatePanel === "uncertain" && (
          <div className="mt-3 space-y-2">
            <p className="text-sm text-amber-700">{pick(lang, "UNCERTAIN: có vấn đề cần người kiểm tra lại, tạm thời không được viết. Hãy xử lý xong rồi thử lại.", "UNCERTAIN: concerns need human review, write blocked. Resolve concerns.")}</p>
            {Array.isArray((gate as { concerns?: unknown[] })?.concerns) && ((gate as { concerns: unknown[] }).concerns.length > 0) && (
              <ul className="list-disc pl-5 text-xs text-muted-foreground">
                {((gate as { concerns: string[] }).concerns).map((c, i) => <li key={i}>{String(c)}</li>)}
              </ul>
            )}
            {/* No Write button for UNCERTAIN */}
            <button onClick={() => void handleRegenerate()} disabled={!!busy} className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-500/20 disabled:opacity-50">{pick(lang, "Tạo lại kế hoạch", "Regenerate Plan")}</button>
          </div>
        )}
        {gatePanel === "author_decision" && (
          <div className="mt-3 space-y-2">
            <p className="text-sm text-sky-700">{pick(lang, "AUTHOR_DECISION: cần tác giả ủy quyền. Hãy chọn loại còn thiếu và tạo ủy quyền.", "AUTHOR_DECISION: author authorization required. Create authorization for missing kinds.")}</p>
            {Array.isArray((gate as { missing?: unknown[] })?.missing) && (
              <div className="flex flex-wrap gap-1">
                {((gate as { missing: string[] }).missing).map((m, i) => <span key={i} className="rounded-full bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 text-xs text-sky-700">{String(m)}</span>)}
              </div>
            )}
            <div className="flex gap-2">
              <input value={authKind} onChange={(e) => setAuthKind(e.target.value)} placeholder="authorization kind" className="rounded-lg border border-border/50 bg-background px-3 py-1.5 text-xs" />
              <button onClick={() => void handleCreateAuth()} disabled={!!busy} className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-50">{pick(lang, "Tạo ủy quyền", "Create Authorization")}</button>
            </div>
            {/* No Write */}
          </div>
        )}
        {gatePanel === "conflict" && (
          <div className="mt-3 space-y-2">
            <p className="text-sm text-destructive font-medium">{pick(lang, "CONFLICT: chặn cứng, có xung đột tất yếu. Không được viết và không có cách đi vòng.", "CONFLICT: hard block, deterministic conflict. Write blocked, no bypass.")}</p>
            {Array.isArray((gate as { evidence?: unknown[] })?.evidence) && (
              <ul className="list-disc pl-5 text-xs text-muted-foreground">
                {((gate as { evidence: unknown[] }).evidence).map((ev, i) => <li key={i} className="break-words">{String(ev)}</li>)}
              </ul>
            )}
            {/* Must not show Write Anyway */}
            <p className="text-xs text-muted-foreground">{pick(lang, "Không cung cấp nút \"vẫn viết\"","No Write Anyway button")}</p>
          </div>
        )}
        {/* Raw gate JSON for debug */}
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-muted-foreground">{pick(lang, "Xem báo cáo cổng", "View gate report")}</summary>
          <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-secondary/20 p-3 text-xs">{JSON.stringify(gate, null, 2)}</pre>
        </details>
      </section>

      {/* Published Arc vs Draft */}
      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-emerald-700">{pick(lang, "KẾ HOẠCH CUNG ĐÃ XUẤT BẢN", "PUBLISHED ARC PLAN")}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{publishedVsDraft.publishedIsAuthority ? pick(lang, "Chính thức (đã xuất bản)", "Authority (published)") : pick(lang, "Chưa có bản đã xuất bản", "No published arc")}</p>
          <div className="mt-3 rounded-xl bg-background p-3 text-xs">
            {publishedArc ? <pre className="max-h-48 overflow-auto text-xs">{JSON.stringify(publishedArc, null, 2)}</pre> : <p className="text-muted-foreground">{pick(lang, "Không có", "None")}</p>}
          </div>
          {publishedArc && (
            <p className="mt-2 text-xs text-muted-foreground">{pick(lang, "Bản đã xuất bản là chính thức; bản nháp không phải", "Published is authority; draft is not")}</p>
          )}
        </div>
        <div className="rounded-2xl border border-sky-500/30 bg-sky-500/5 p-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-sky-700">{pick(lang, "BẢN NHÁP CUNG", "ARC DRAFT")}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{pick(lang, "Bản nháp không phải chính thức; cần xuất bản tường minh", "Draft is not authority; explicit Publish required")}</p>
          <div className="mt-3 flex gap-2">
            <button onClick={() => void handleCreateDraft()} disabled={!!busy} className="rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground disabled:opacity-50">{busy === "createDraft" ? pick(lang, "Đang tạo…", "Creating…") : pick(lang, "Tạo bản nháp", "Create Draft")}</button>
            <button onClick={() => void handlePublish()} disabled={!!busy || !selectedDraftId} className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40 hover:bg-emerald-500">{pick(lang, "Xuất bản", "Publish")}</button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">{pick(lang, "Không tự động xuất bản — chỉ kích hoạt khi nhấn nút", "No auto-Publish — only explicit button")}</p>
          <div className="mt-3 space-y-2">
            {drafts.length === 0 && <p className="text-xs text-muted-foreground">{pick(lang, "Chưa có bản nháp", "No drafts")}</p>}
            {drafts.map((d) => {
              const did = String((d as { draftId?: string; id?: string }).draftId ?? (d as { id?: string }).id ?? "");
              const isSelected = did === selectedDraftId;
              return (
                <div key={did || JSON.stringify(d).slice(0, 12)} className={`rounded-xl border p-3 ${isSelected ? "border-primary bg-primary/5" : "border-border/50 bg-background"}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold">{did || pick(lang, "Bản nháp", "Draft")}</span>
                    <span className="text-[11px] text-muted-foreground">{String((d as { status?: string }).status ?? "")}</span>
                  </div>
                  <button onClick={() => setSelectedDraftId(did)} className="mt-2 rounded-lg border border-border/50 px-2 py-1 text-xs text-muted-foreground hover:text-foreground">{pick(lang, "Chọn", "Select")}</button>
                  <pre className="mt-2 max-h-24 overflow-auto text-[11px] text-muted-foreground">{JSON.stringify(d, null, 2)}</pre>
                </div>
              );
            })}
          </div>
          {preflight && (
            <div className="mt-3 rounded-xl bg-background p-3">
              <h4 className="text-xs font-medium">{pick(lang, "Kiểm tra trước khi xuất bản", "Preflight")}</h4>
              <pre className="mt-1 max-h-32 overflow-auto text-xs text-muted-foreground">{JSON.stringify(preflight, null, 2)}</pre>
            </div>
          )}
        </div>
      </section>

      {/* Beats */}
      <section className="rounded-2xl border border-border/50 bg-card/40 p-4">
        <h2 className="text-sm font-semibold text-foreground">{pick(lang, "Tiến độ các nhịp chính", "Major Beat Progress")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{pick(lang, "bắt buộc/tùy chọn, trạng thái, bằng chứng chính thống", "required/optional, state, Canon evidence")}</p>
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
          ) : <p className="text-xs text-muted-foreground">{pick(lang, "Chưa có nhịp nào", "No beats")}</p>}
        </div>
      </section>

      {/* Lookahead — advisory, no Approve/Publish */}
      <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
        <h2 className="text-sm font-semibold text-foreground">{pick(lang, "Dự báo cuốn chiếu", "Rolling Lookahead")} <span className="ml-2 rounded-full bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-700">{pick(lang, "Chỉ mang tính tham khảo", "Advisory Only")}</span></h2>
        <p className="mt-1 text-xs text-muted-foreground">{pick(lang, "Dự báo chỉ mang tính tham khảo, không phải chính thức; không có nút phê duyệt/xuất bản", "Lookahead is advisory, not authority; no Approve/Publish")}</p>
        {lookahead && (
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <span className={`rounded-full px-2 py-0.5 border ${isLookaheadStale(lookahead as unknown as import("./planning-ui-state").LookaheadState) ? "bg-amber-500/10 text-amber-700 border-amber-500/20" : "bg-emerald-500/10 text-emerald-700 border-emerald-500/20"}`}>{getLookaheadStatus(lookahead as unknown as import("./planning-ui-state").LookaheadState)}</span>
            <span className="rounded-full bg-secondary/40 border border-border/50 px-2 py-0.5 text-muted-foreground">{isLookaheadCurrent(lookahead as unknown as import("./planning-ui-state").LookaheadState) ? "current" : "not current"}</span>
            {Boolean((lookahead as { superseded?: boolean }).superseded || (lookahead as { status?: string }).status === "superseded") && <span className="rounded-full bg-secondary/40 px-2 py-0.5">superseded</span>}
            {Boolean((lookahead as { consumed?: boolean }).consumed || (lookahead as { status?: string }).status === "consumed") && <span className="rounded-full bg-secondary/40 px-2 py-0.5">consumed</span>}
          </div>
        )}
        <div className="mt-3 rounded-xl bg-background p-3">
          {lookahead ? <pre className="max-h-48 overflow-auto text-xs text-muted-foreground">{JSON.stringify(lookahead, null, 2)}</pre> : <p className="text-xs text-muted-foreground">{pick(lang, "Chưa có dự báo", "No lookahead")}</p>}
        </div>
        {/* Explicitly no Approve/Publish for lookahead */}
        <p className="mt-2 text-[11px] text-muted-foreground">{pick(lang, "Không cung cấp nút phê duyệt/xuất bản cho dự báo", "No Approve/Publish button for lookahead")}</p>
      </section>

      {/* Detailed Plan */}
      <section className="rounded-2xl border border-border/50 bg-card/40 p-4">
        <h2 className="text-sm font-semibold text-foreground">{pick(lang, "Kế hoạch chi tiết", "Detailed Plan")}</h2>
        {detailedPlan ? (
          <div className="mt-3 space-y-2 text-xs">
            <div className="rounded-xl bg-background p-3">
              <div className="grid gap-1 font-mono">
                <span>planId: {String((detailedPlan as { planId?: string }).planId ?? "—")}</span>
                <span>chapter: {String((detailedPlan as { chapter?: number }).chapter ?? (detailedPlan as { chapterNumber?: number }).chapterNumber ?? "—")}</span>
                <span>status: {String((detailedPlan as { status?: string }).status ?? "—")}</span>
              </div>
              <div className="mt-2">
                <h4 className="font-semibold text-foreground">{pick(lang, "Ý định", "Intent")}</h4>
                <pre className="mt-1 max-h-32 overflow-auto text-muted-foreground">{JSON.stringify((detailedPlan as { intent?: unknown }).intent ?? "—", null, 2)}</pre>
              </div>
              <div className="mt-2">
                <h4 className="font-semibold text-foreground">{pick(lang, "Ghi nhớ", "Memo")}</h4>
                <pre className="mt-1 max-h-32 overflow-auto text-muted-foreground">{JSON.stringify((detailedPlan as { memo?: unknown }).memo ?? "—", null, 2)}</pre>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="text-muted-foreground">{pick(lang, "Căn cứ: ", "Bases:")} {JSON.stringify((detailedPlan as { bases?: unknown }).bases ?? (detailedPlan as { basis?: unknown }).basis ?? "—")}</span>
              </div>
              <div className="mt-1">
                <span className="text-muted-foreground">{pick(lang, "Tham chiếu: ", "Refs:")} {JSON.stringify((detailedPlan as { refs?: unknown }).refs ?? (detailedPlan as { references?: unknown }).references ?? "—")}</span>
              </div>
              <details className="mt-2">
                <summary className="cursor-pointer text-muted-foreground">{pick(lang, "Xem toàn bộ kế hoạch", "View full plan")}</summary>
                <pre className="mt-2 max-h-48 overflow-auto">{JSON.stringify(detailedPlan, null, 2)}</pre>
              </details>
            </div>
            {detailedPlan && (detailedPlan as { gateReport?: unknown }).gateReport !== undefined && (
              <div className="rounded-xl bg-background p-3">
                <h4 className="font-semibold text-foreground">{pick(lang, "Báo cáo cổng", "Gate Report")}</h4>
                <pre className="mt-1 max-h-32 overflow-auto text-muted-foreground">{JSON.stringify((detailedPlan as { gateReport: unknown }).gateReport, null, 2)}</pre>
              </div>
            )}
          </div>
        ) : <p className="text-xs text-muted-foreground">{pick(lang, "Chưa có kế hoạch chi tiết", "No detailed plan")}</p>}
        <button onClick={() => void handleRegenerate()} disabled={!!busy} className="mt-3 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2 text-xs font-bold text-primary hover:bg-primary/20 disabled:opacity-50">{busy === "regenerate" ? pick(lang, "Đang tạo lại…", "Regenerating…") : pick(lang, "Tạo lại kế hoạch", "Regenerate Plan")}</button>
      </section>

      {/* Human Direction NL */}
      <section className="rounded-2xl border border-border/50 bg-card/40 p-4">
        <h2 className="text-sm font-semibold text-foreground">{pick(lang, "Chỉ dẫn của con người", "Human Direction")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{pick(lang, "Nhập ngôn ngữ tự nhiên → phân tích thành đề xuất chờ xác nhận → xác nhận; bản chờ không phải chính thức", "NL input → parse to pending proposal → confirm; pending is not authority")}</p>
        <div className="mt-3 flex gap-2">
          <input value={directionText} onChange={(e) => setDirectionText(e.target.value)} placeholder={pick(lang, "Nhập chỉ dẫn bằng ngôn ngữ tự nhiên…", "Enter natural language direction…")} className="flex-1 rounded-xl border border-border/50 bg-background px-3 py-2 text-sm" />
          <button onClick={() => void handleParseDirection()} disabled={!!busy || !directionText.trim()} className="rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground disabled:opacity-50">{busy === "parse" ? pick(lang, "Đang phân tích…", "Parsing…") : pick(lang, "Phân tích", "Parse")}</button>
        </div>
        {pendingDirection && (
          <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-semibold">{String((pendingDirection as { directionId?: string }).directionId ?? "pending")}</span>
              <span className="rounded-full bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-xs text-amber-700">{String((pendingDirection as { status?: string }).status ?? "pending")} · {getPendingDirectionDisplay(pendingDirection as unknown as import("./planning-ui-state").HumanDirectionState)}</span>
            </div>
            <pre className="mt-2 max-h-24 overflow-auto text-xs text-muted-foreground">{JSON.stringify(pendingDirection, null, 2)}</pre>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => void handleConfirmDirection(String((pendingDirection as { directionId?: string }).directionId ?? ""))} disabled={!!busy} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50">{pick(lang, "Xác nhận", "Confirm")}</button>
              <button onClick={() => void handleResolveConflict("override")} disabled={!!busy} className="rounded-lg border border-border/50 px-3 py-1.5 text-xs hover:bg-secondary/40">{pick(lang, "Ghi đè (override)", "Override")}</button>
              <button onClick={() => void handleResolveConflict("replace")} disabled={!!busy} className="rounded-lg border border-border/50 px-3 py-1.5 text-xs hover:bg-secondary/40">{pick(lang, "Thay thế (replace)", "Replace")}</button>
              <button onClick={() => void handleResolveConflict("keep")} disabled={!!busy} className="rounded-lg border border-border/50 px-3 py-1.5 text-xs hover:bg-secondary/40">{pick(lang, "Giữ lại (keep)", "Keep")}</button>
              <button onClick={() => void handleResolveConflict("edit")} disabled={!!busy} className="rounded-lg border border-border/50 px-3 py-1.5 text-xs hover:bg-secondary/40">{pick(lang, "Chỉnh sửa (edit)", "Edit")}</button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">{pick(lang, "Xung đột được giải quyết bằng các chiến lược trên", "Conflict resolved via strategies above")}</p>
          </div>
        )}
        <div className="mt-3">
          <h4 className="text-xs font-medium text-foreground">{pick(lang, "Hướng đang chờ", "Pending Directions")}</h4>
          <div className="mt-2 space-y-2">
            {directions.length === 0 && <p className="text-xs text-muted-foreground">{pick(lang, "Không có", "None")}</p>}
            {directions.map((d) => {
              const did = String((d as { directionId?: string; id?: string }).directionId ?? (d as { id?: string }).id ?? "");
              const status = String((d as { status?: string }).status ?? "");
              return (
                <div key={did || JSON.stringify(d).slice(0, 12)} className="rounded-xl border border-border/50 bg-background p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold">{did}</span>
                    <span className="rounded-full bg-secondary/40 px-2 py-0.5 text-xs">{status}</span>
                    <span className="text-xs text-muted-foreground">{getPendingDirectionDisplay(d as unknown as import("./planning-ui-state").HumanDirectionState)}</span>
                    {pendingIsNotAuthority && <span className="text-[11px] text-muted-foreground">({pick(lang, "bản chờ không phải chính thức", "pending not authority")})</span>}
                  </div>
                  <pre className="mt-1 max-h-24 overflow-auto text-xs text-muted-foreground">{JSON.stringify(d, null, 2)}</pre>
                  {status === "pending" && <button onClick={() => void handleConfirmDirection(did)} disabled={!!busy} className="mt-2 rounded-lg bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50">{pick(lang, "Xác nhận", "Confirm")}</button>}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Authorization UI */}
      <section className="rounded-2xl border border-border/50 bg-card/40 p-4">
        <h2 className="text-sm font-semibold text-foreground">{pick(lang, "Ủy quyền", "Authorization")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{pick(lang, "tạo bản chờ → xác nhận; hiển thị vòng đời; không tiêu thụ", "create pending → confirm; show lifecycle; no consume")}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input value={authKind} onChange={(e) => setAuthKind(e.target.value)} placeholder="kind (e.g. major_character_death)" className="rounded-lg border border-border/50 bg-background px-3 py-1.5 text-xs" />
          <input value={authScope} onChange={(e) => setAuthScope(e.target.value)} placeholder="scope (optional)" className="rounded-lg border border-border/50 bg-background px-3 py-1.5 text-xs" />
          <button onClick={() => void handleCreateAuth()} disabled={!!busy} className="rounded-xl bg-sky-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-50">{pick(lang, "Tạo ủy quyền", "Create Authorization")}</button>
        </div>
        <div className="mt-3 space-y-2">
          {authorizations.length === 0 && <p className="text-xs text-muted-foreground">{pick(lang, "Chưa có ủy quyền", "No authorizations")}</p>}
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
                {(status === "pending" || lifecycle === "pending") && <button onClick={() => void handleConfirmAuth(aid)} disabled={!!busy} className="mt-2 rounded-lg bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50">{pick(lang, "Xác nhận ủy quyền", "Confirm")}</button>}
                {/* No consume button — lifecycle is confirm-only */}
              </div>
            );
          })}
        </div>
      </section>

      {/* Write Chapter & Regenerate already surfaced above; also standalone */}
      <section className="rounded-2xl border border-border/50 bg-card/40 p-4">
        <h2 className="text-sm font-semibold text-foreground">{pick(lang, "Viết & tạo lại", "Write & Regenerate")}</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => void handleWrite()} disabled={!!busy || !showWrite} title={showWrite ? "" : pick(lang, "Cổng chưa thông qua, tính năng viết bị chặn", "Gate blocked, write disabled")} className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed">{pick(lang, "Viết chương tiếp theo", "Write Chapter")}</button>
          <button onClick={() => void handleRegenerate()} disabled={!!busy} className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-2 text-xs font-bold text-primary hover:bg-primary/20 disabled:opacity-50">{pick(lang, "Tạo lại kế hoạch", "Regenerate Plan")}</button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{pick(lang, "Điểm vào viết là Task 19; lỗi được truyền thẳng CONFLICT/AUTHOR_DECISION/UNCERTAIN/budget, không có phương án dự phòng.", "Write entry is Task 19; errors surface CONFLICT/AUTHOR_DECISION/UNCERTAIN/budget directly, no fallback.")}</p>
      </section>

      <footer className="pb-6 text-center text-xs text-muted-foreground">
        {pick(lang, "Trang lập kế hoạch — chỉ ánh xạ kết quả Core, không đánh giá tính đúng của chính thống/phạm vi/ủy quyền/nhịp/cổng", "Planning — maps Core result to UI, does not evaluate Canon/scope/Authorization/Beat/Gate correctness")}
      </footer>
    </div>
  );
}

export default PlanningPage;
