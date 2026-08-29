import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getFoundationOverview,
  getUnitManifests,
  getReadiness,
  getVersions,
  openRevision,
  loadRevision,
  saveRevision,
  approveUnit,
  needsRevision,
  reapproveStale,
  discardRevision,
  batchApprove,
  publishFoundation,
} from "../lib/foundation-api";
import { invalidateApiPaths } from "../hooks/use-api";
import {
  isApprovedReadOnly,
  getPublishedVsDraftMode,
  shouldShowDiffFirst,
  batchApproveEligible,
  getBlockingReasonsWithPublished,
  getUnitStatusLabel,
  getImportanceLabel,
  foundationCacheKey,
} from "./foundation-ui-state";
import type { FoundationUnitManifest, FoundationRevisionDraft } from "../lib/foundation-api";

interface FoundationPageProps {
  readonly bookId: string;
}

type Lang = "vi" | "en";
function pick(lang: Lang, vi: string, en: string): string {
  return lang === "vi" ? vi : en;
}

export function FoundationPage({ bookId }: FoundationPageProps) {
  const [lang, setLang] = useState<Lang>("vi");
  const [manifests, setManifests] = useState<FoundationUnitManifest[]>([]);
  const [readiness, setReadiness] = useState<{ blockingReasons: string[]; warnings: string[]; nextRecommendedAction: string | null } | null>(null);
  const [revision, setRevision] = useState<FoundationRevisionDraft | null>(null);
  const [versions, setVersions] = useState<{ versions: number[]; currentVersion?: number | null } | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revisionId, setRevisionId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState<string>("");
  const [selectedUnitIds, setSelectedUnitIds] = useState<ReadonlyArray<string>>([]);

  // bookId isolation key — switching books remounts via App's key prop, but also derive cache key here
  const cacheKey = useMemo(() => {
    try { return foundationCacheKey(bookId); } catch { return `foundation:invalid:${bookId}`; }
  }, [bookId]);

  const reload = useCallback(async () => {
    setLoading(true);
    setOverviewError(null);
    try {
      const [ov, man, ready, vers] = await Promise.all([
        getFoundationOverview(bookId).catch(() => null),
        getUnitManifests(bookId).catch(() => ({ manifests: [] as FoundationUnitManifest[] })),
        getReadiness(bookId).catch(() => null),
        getVersions(bookId).catch(() => ({ versions: [] as number[] })),
      ]);
      // Prefer manifests from /manifests, fallback to overview
      const m = (man as { manifests?: FoundationUnitManifest[] })?.manifests ?? (ov as { manifests?: FoundationUnitManifest[] } | null)?.manifests ?? [];
      setManifests(m as FoundationUnitManifest[]);
      if (ready) setReadiness(ready as unknown as typeof readiness);
      else if ((ov as unknown as { readiness?: typeof readiness } | null)?.readiness) setReadiness((ov as unknown as { readiness: typeof readiness }).readiness);
      setVersions(vers as typeof versions);
      // If we have a revisionId, try to load it; otherwise keep previous
      if (revisionId) {
        try {
          const rev = await loadRevision(bookId, revisionId);
          setRevision(rev);
        } catch {
          setRevision(null);
        }
      }
    } catch (e) {
      setOverviewError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [bookId, revisionId]);

  useEffect(() => { void reload(); }, [reload]);

  // Reset revision when bookId changes (key isolation)
  useEffect(() => {
    setRevision(null);
    setRevisionId(null);
    setSelectedUnitIds([]);
    setEditingUnitId(null);
    setMessage(null);
  }, [bookId]);

  const modeView = useMemo(() => getPublishedVsDraftMode(manifests, revision), [manifests, revision]);
  const blockingView = useMemo(() => getBlockingReasonsWithPublished(readiness as unknown as import("../lib/foundation-api").ReadinessReport, versions?.currentVersion ?? null), [readiness, versions]);
  const showDiffFirst = useMemo(() => shouldShowDiffFirst(revision, versions?.currentVersion ?? null), [revision, versions]);
  const eligible = useMemo(() => batchApproveEligible(revision ? revision.unitStates : manifests as unknown as Array<{ status: string; unitId: string }>), [revision, manifests]);
  const canBatchApprove = eligible.length > 0;

  const handleOpenRevision = async () => {
    if (busy) return;
    const unitIds = selectedUnitIds.length > 0 ? [...selectedUnitIds] : manifests.slice(0, 1).map((m) => m.unitId);
    if (unitIds.length === 0) {
      setMessage(pick(lang, "Không có đơn vị nào để sửa", "No units to revise"));
      return;
    }
    setBusy("open");
    setMessage(null);
    try {
      const res = await openRevision(bookId, { unitIds: unitIds as string[] });
      const newId = (res as { revisionId: string }).revisionId;
      setRevisionId(newId);
      const rev = await loadRevision(bookId, newId);
      setRevision(rev);
      setMessage(pick(lang, `Đã mở bản sửa ${newId}`, `Opened revision ${newId}`));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  };

  const handleSave = async (unitId: string) => {
    if (!revisionId || busy) return;
    setBusy(`save:${unitId}`);
    try {
      const unitState = revision?.unitStates.find((u: { unitId: string }) => u.unitId === unitId);
      await saveRevision(bookId, revisionId, unitId, { content: editingContent, expectedRevision: unitState?.contentRevision });
      const rev = await loadRevision(bookId, revisionId);
      setRevision(rev);
      setEditingUnitId(null);
      setMessage(pick(lang, `Đã lưu ${unitId}`, `Saved ${unitId}`));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  };

  const handleApprove = async (unitId: string) => {
    if (!revisionId || busy) return;
    setBusy(`approve:${unitId}`);
    try {
      const unitState = revision?.unitStates.find((u: { unitId: string }) => u.unitId === unitId);
      if (!unitState) throw new Error(`Unit ${unitId} not in revision`);
      await approveUnit(bookId, revisionId, unitId, { expectedRevision: unitState.contentRevision });
      const rev = await loadRevision(bookId, revisionId);
      setRevision(rev);
      await reload();
      setMessage(pick(lang, `Đã phê duyệt ${unitId}`, `Approved ${unitId}`));
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };

  const handleNeedsRevision = async (unitId: string) => {
    if (!revisionId || busy) return;
    setBusy(`needs:${unitId}`);
    try {
      await needsRevision(bookId, revisionId, unitId, { reason: "Human marked needs revision" });
      const rev = revisionId ? await loadRevision(bookId, revisionId).catch(() => null) : null;
      if (rev) setRevision(rev);
      else await reload();
      setMessage(pick(lang, `Đã đánh dấu cần sửa ${unitId}`, `Marked needs-revision ${unitId}`));
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };

  const handleReapproveStale = async (unitId: string) => {
    if (!revisionId || busy) return;
    setBusy(`reapprove:${unitId}`);
    try {
      const unitState = revision?.unitStates.find((u: { unitId: string }) => u.unitId === unitId);
      if (!unitState) throw new Error(`Unit ${unitId} not in revision`);
      await reapproveStale(bookId, revisionId, unitId, { expectedRevision: unitState.contentRevision });
      const rev = await loadRevision(bookId, revisionId);
      setRevision(rev);
      setMessage(pick(lang, `Đã phê duyệt lại bản lỗi thời ${unitId}`, `Re-approved stale ${unitId}`));
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };

  const handleDiscard = async () => {
    if (!revisionId || busy) return;
    setBusy("discard");
    try {
      await discardRevision(bookId, revisionId);
      setRevision(null);
      setRevisionId(null);
      setMessage(pick(lang, "Đã bỏ bản sửa", "Discarded revision"));
      await reload();
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };

  const handleBatchApprove = async () => {
    if (!revisionId || busy || !canBatchApprove) return;
    setBusy("batch");
    try {
      const unitIds = eligible.map((u) => (u as { unitId: string }).unitId);
      const res = await batchApprove(bookId, revisionId, { unitIds });
      const rev = await loadRevision(bookId, revisionId);
      setRevision(rev);
      setMessage(pick(lang, `Phê duyệt hàng loạt: ${(res as unknown as { approved?: string[] }).approved?.join(", ") || unitIds.join(", ")}`, `Batch approved: ${unitIds.join(", ")}`));
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };

  const handlePublish = async () => {
    if (!revisionId || busy) return;
    const currentVersion = versions?.currentVersion ?? 0;
    // Need baseCanonRevision — fallback to 0
    const baseCanonRevision = 0;
    setBusy("publish");
    try {
      const payload = { revisionId, expectedBaseFoundationVersion: currentVersion, expectedBaseCanonRevision: baseCanonRevision, humanActor: "studio-user" };
      const result = await publishFoundation(bookId, payload);
      if ((result as { status: string }).status === "published") {
        setMessage(pick(lang, `Xuất bản thành công v${(result as { version: number }).version}`, `Published v${(result as { version: number }).version}`));
        invalidateApiPaths([`/api/v1/books/${bookId}`, `/api/v1/books/${bookId}/foundation`, `/api/v1/books/${bookId}/foundation/manifests`]);
        await reload();
        // Reload revision to reflect published state
        if (revisionId) {
          try { const rev = await loadRevision(bookId, revisionId); setRevision(rev); } catch { setRevision(null); }
        }
      } else {
        setMessage(pick(lang, `Xuất bản trả về: ${(result as { status: string }).status}`, `Publish returned: ${(result as { status: string }).status}`));
      }
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };

  return (
    <div key={bookId} data-testid="foundation-page" data-cache-key={cacheKey} className="mx-auto w-full max-w-[1200px] space-y-6 p-6 fade-in">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{pick(lang, "Nền tảng", "Foundation")}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{pick(lang, "Bản chính thức đã xuất bản vs bản nháp sửa đổi — phân tách rõ ràng", "CURRENT PUBLISHED AUTHORITY vs REVISION DRAFT — clearly separated")} · bookId: <span className="font-mono">{bookId}</span></p>
          {blockingView.isReady !== blockingView.isPublished && (
            <p className="mt-1 text-xs text-amber-600">{pick(lang, "Lưu ý: sẵn sàng ≠ đã xuất bản — cần xuất bản rõ ràng để có hiệu lực", "Note: ready ≠ published — explicit publish required")}</p>
          )}
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

      {loading && <div className="py-8 text-center text-sm text-muted-foreground">{pick(lang, "Đang tải…", "Loading…")}</div>}
      {overviewError && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{overviewError}</div>}
      {message && <div role="status" className="rounded-xl border border-border/50 bg-card/50 p-3 text-sm text-foreground">{message}</div>}

      {/* Readiness / Blockers */}
      <section className="rounded-2xl border border-border/50 bg-card/50 p-4">
        <h2 className="text-sm font-semibold text-foreground">{pick(lang, "Kiểm tra độ sẵn sàng", "Readiness")}</h2>
        <div className="mt-2 text-xs">
          <div className="flex gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${blockingView.isReady ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20" : "bg-amber-500/10 text-amber-600 border border-amber-500/20"}`}>{blockingView.isReady ? pick(lang, "Sẵn sàng", "Ready") : pick(lang, "Chưa sẵn sàng", "Not Ready")}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${blockingView.isPublished ? "bg-sky-500/10 text-sky-600 border border-sky-500/20" : "bg-secondary/40 text-muted-foreground border border-border/50"}`}>{blockingView.isPublished ? pick(lang, "Đã xuất bản", "Published") : pick(lang, "Chưa xuất bản / phiên bản " + (versions?.currentVersion ?? 0), "Unpublished / v" + (versions?.currentVersion ?? 0))}</span>
          </div>
          {blockingView.blockers.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-muted-foreground">
              {blockingView.blockers.map((b, i) => <li key={i} className="break-words">{b}</li>)}
            </ul>
          )}
          {blockingView.warnings.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-amber-600">
              {blockingView.warnings.map((w, i) => <li key={i} className="break-words">{w}</li>)}
            </ul>
          )}
          {blockingView.nextAction && <p className="mt-2 text-muted-foreground">{pick(lang, "Đề xuất: ", "Next: ")} {blockingView.nextAction}</p>}
        </div>
      </section>

      {/* CURRENT PUBLISHED AUTHORITY vs REVISION DRAFT */}
      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-emerald-700">{pick(lang, "BẢN CHÍNH THỨC ĐÃ XUẤT BẢN", "CURRENT PUBLISHED AUTHORITY")}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{pick(lang, "Chế độ: ", "Mode: ")} {modeView.mode} {showDiffFirst ? pick(lang, "· ưu tiên xem khác biệt", "· diff first") : ""}</p>
          <div className="mt-3 space-y-2">
            {manifests.length === 0 && <p className="text-xs text-muted-foreground">{pick(lang, "Chưa có đơn vị nào được xuất bản", "No published units")}</p>}
            {manifests.map((m) => (
              <div key={m.unitId} className="rounded-xl border border-border/50 bg-background p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-foreground">{m.unitId}</span>
                  <span className="rounded-full border border-border/50 bg-secondary/40 px-2 py-0.5 text-[10px] text-muted-foreground">{getUnitStatusLabel(m.status, lang)}</span>
                  <span className="rounded-full border border-border/50 bg-secondary/30 px-2 py-0.5 text-[10px] text-muted-foreground">{getImportanceLabel(m.importance, lang)}</span>
                  <span className="text-[10px] text-muted-foreground">rev {m.contentRevision}</span>
                </div>
                {m.dependencies.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{pick(lang, "Phụ thuộc: ", "Dependencies: ")} {m.dependencies.map((d: { kind: string; targetUnitId: string }) => `${d.kind}→${d.targetUnitId}`).join(", ")}</p>}
                {/* Approved read-only */}
                {isApprovedReadOnly(m, revision) ? (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{pick(lang, "Chỉ đọc (đã phê duyệt)", "Read-only (approved)")}</span>
                    <button onClick={() => void handleOpenRevision()} disabled={!!busy} className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-50">{pick(lang, "Mở bản sửa", "Open Revision")}</button>
                  </div>
                ) : (
                  <label className="mt-2 flex items-center gap-1 text-xs">
                    <input type="checkbox" checked={selectedUnitIds.includes(m.unitId)} onChange={(e) => setSelectedUnitIds(e.target.checked ? [...selectedUnitIds, m.unitId] : selectedUnitIds.filter((id) => id !== m.unitId))} />
                    {pick(lang, "Chọn để sửa đổi", "Select for revision")}
                  </label>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-sky-500/30 bg-sky-500/5 p-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-sky-700">{pick(lang, "BẢN NHÁP SỬA ĐỔI", "REVISION DRAFT")}</h3>
          {!revision ? (
            <div className="mt-3">
              <p className="text-xs text-muted-foreground">{pick(lang, "Chưa có bản nháp sửa đổi. Chọn đơn vị rồi mở bản sửa.", "No revision draft. Select units and open a revision.")}</p>
              <button onClick={() => void handleOpenRevision()} disabled={!!busy} className="mt-3 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-sm disabled:opacity-50">{busy === "open" ? pick(lang, "Đang mở…", "Opening…") : pick(lang, "Mở bản sửa", "Open Revision")}</button>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <div className="rounded-xl bg-background p-3 text-xs">
                <div className="font-mono text-foreground">revision: {revision.revisionId}</div>
                <div className="text-muted-foreground">status: {revision.status} · baseFoundationVersion: {revision.baseFoundationVersion ?? "null"} · baseCanonRevision: {revision.baseCanonRevision}</div>
                {showDiffFirst && <div className="mt-1 text-sky-600">{pick(lang, "Ưu tiên chế độ xem khác biệt", "Diff view prioritized")}</div>}
              </div>

              {/* Findings / blockers inside revision */}
              {revision.unitStates.map((u: { unitId: string; state: string; contentHash: string; contentRevision: number; approvedRevision?: number }) => {
                const published = manifests.find((m: FoundationUnitManifest) => m.unitId === u.unitId);
                const isEditing = editingUnitId === u.unitId;
                const canEdit = !isApprovedReadOnly({ status: published?.status ?? u.state } as FoundationUnitManifest, null) || !!revision;
                return (
                  <div key={u.unitId} className="rounded-xl border border-border/50 bg-background p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold">{u.unitId}</span>
                      <span className="rounded-full border border-border/50 bg-secondary/40 px-2 py-0.5 text-[10px] text-muted-foreground">{u.state}</span>
                      <span className="text-[10px] text-muted-foreground">rev {u.contentRevision} {u.approvedRevision ? `approved ${u.approvedRevision}` : ""}</span>
                    </div>
                    {published && <p className="mt-1 text-xs text-muted-foreground">{pick(lang, "Đã xuất bản: ", "Published: ")} {published.status} rev {published.contentRevision} · {pick(lang, "Bản nháp: ", "Draft: ")} {u.state} rev {u.contentRevision}</p>}
                    {/* Diff placeholder */}
                    <div className="mt-2 rounded-lg bg-secondary/30 p-2 font-mono text-[11px] text-muted-foreground">
                      {pick(lang, "Khác biệt: ", "Diff: ")} {published ? `${published.contentHash.slice(0, 8)} → ${u.contentHash.slice(0, 8)}` : u.contentHash.slice(0, 12)}
                    </div>

                    {/* Edit area — approved unit not editable until revision exists handled via isApprovedReadOnly above */}
                    {canEdit && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {!isEditing ? (
                          <button onClick={() => { setEditingUnitId(u.unitId); setEditingContent(""); }} className="rounded-lg border border-border/50 px-2 py-1 text-xs text-muted-foreground hover:text-foreground">{pick(lang, "Chỉnh sửa", "Edit")}</button>
                        ) : (
                          <>
                            <textarea value={editingContent} onChange={(e) => setEditingContent(e.target.value)} placeholder={pick(lang, "Nhập nội dung mới…", "Enter new content…")} className="w-full rounded-lg border border-border/50 bg-background p-2 text-xs" rows={3} />
                            <button onClick={() => void handleSave(u.unitId)} disabled={!!busy} className="rounded-lg bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50">{pick(lang, "Lưu", "Save")}</button>
                            <button onClick={() => setEditingUnitId(null)} className="rounded-lg border border-border/50 px-3 py-1 text-xs text-muted-foreground">{pick(lang, "Hủy", "Cancel")}</button>
                          </>
                        )}
                      </div>
                    )}

                    <div className="mt-2 flex flex-wrap gap-2">
                      <button onClick={() => void handleApprove(u.unitId)} disabled={!!busy} className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-500/20 disabled:opacity-50">{pick(lang, "Phê duyệt", "Approve")}</button>
                      <button onClick={() => void handleNeedsRevision(u.unitId)} disabled={!!busy} className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-600 hover:bg-amber-500/20 disabled:opacity-50">{pick(lang, "Cần chỉnh sửa", "Needs Revision")}</button>
                      {u.state === "stale" && <button onClick={() => void handleReapproveStale(u.unitId)} disabled={!!busy} className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-600 hover:bg-sky-500/20 disabled:opacity-50">{pick(lang, "Phê duyệt lại bản lỗi thời", "Reapprove Stale")}</button>}
                    </div>
                  </div>
                );
              })}

              <div className="flex flex-wrap gap-2">
                <button onClick={() => void handleBatchApprove()} disabled={!canBatchApprove || !!busy} className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-2 text-xs font-bold text-primary hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed" title={canBatchApprove ? pick(lang, "Chỉ đơn vị an toàn/sạch", "Only safe/clean units") : pick(lang, "Không có đơn vị đủ điều kiện", "No eligible units")}>{pick(lang, "Phê duyệt hàng loạt", "Batch Approve")}{eligible.length ? ` (${eligible.length})` : ""}</button>
                <button onClick={() => void handleDiscard()} disabled={!!busy} className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2 text-xs font-bold text-destructive hover:bg-destructive/20 disabled:opacity-50">{pick(lang, "Bỏ bản sửa", "Discard")}</button>
                <button onClick={() => void handlePublish()} disabled={!!busy} className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-500 disabled:opacity-50">{busy === "publish" ? pick(lang, "Đang xuất bản…", "Publishing…") : pick(lang, "Xuất bản", "Publish")}</button>
              </div>
              <p className="text-[11px] text-muted-foreground">{pick(lang, "Xuất bản là thao tác tường minh; khi thành công sẽ làm mới bản chính thức đã xuất bản", "Publish is explicit; on success it invalidates cache and reloads published authority")}</p>
            </div>
          )}
        </div>
      </section>

      {/* Unit list extra details: required/optional, dependencies, findings, blockers */}
      <section className="rounded-2xl border border-border/50 bg-card/40 p-4">
        <h2 className="text-sm font-semibold text-foreground">{pick(lang, "Danh sách đơn vị", "Units")}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {manifests.map((m) => (
            <div key={`list-${m.unitId}`} className="rounded-xl border border-border/50 bg-background p-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-medium">{m.unitId}</span>
                <span className="text-[11px] text-muted-foreground">{m.kind}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                <span className="rounded-full bg-secondary/40 px-2 py-0.5 text-[10px]">{getImportanceLabel(m.importance, lang)}</span>
                <span className="rounded-full bg-secondary/40 px-2 py-0.5 text-[10px]">{getUnitStatusLabel(m.status, lang)}</span>
              </div>
              {m.dependencies.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{pick(lang, "Phụ thuộc: ", "Dependencies: ")} {m.dependencies.map((d: { targetUnitId: string }) => d.targetUnitId).join(", ")}</p>}
              <p className="mt-1 text-xs text-muted-foreground break-all">{pick(lang, "contentHash: ", "contentHash: ")} {m.contentHash.slice(0, 12)}</p>
            </div>
          ))}
        </div>
        {versions && versions.versions.length > 0 && (
          <div className="mt-4 rounded-xl border border-border/50 bg-secondary/20 p-3">
            <h3 className="text-xs font-medium text-foreground">{pick(lang, "Lịch sử phiên bản", "Version History")}</h3>
            <div className="mt-2 flex flex-wrap gap-1">
              {versions.versions.map((v: number) => (
                <span key={v} className={`rounded-full px-2 py-0.5 text-xs font-mono ${v === versions.currentVersion ? "bg-primary text-primary-foreground" : "bg-secondary/40 text-muted-foreground border border-border/50"}`}>v{v}</span>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default FoundationPage;
