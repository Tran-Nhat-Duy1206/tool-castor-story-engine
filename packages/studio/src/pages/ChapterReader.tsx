import { useEffect, useState } from "react";
import { fetchJson, useApi, postApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { ChapterWorkspacePanel } from "../components/ChapterWorkspacePanel";
import { fetchStateReview, postStateReviewRebuild } from "../lib/state-review-api";
import type { StateReviewArtifact } from "../lib/state-review-api";
import {
  ChevronLeft,
  Check,
  X,
  List,
  RotateCcw,
  BookOpen,
  Brain,
  CheckCircle2,
  XCircle,
  Hash,
  Type,
  Clock,
  Pencil,
  Save,
  Eye,
  FileWarning,
  RefreshCw,
} from "lucide-react";

interface ChapterData {
  readonly chapterNumber: number;
  readonly filename: string;
  readonly content: string;
}

interface Nav {
  toBook: (id: string) => void;
  toDashboard: () => void;
  toStateReview?: (bookId: string, chapterNumber: number) => void;
}

export function ChapterReader({ bookId, chapterNumber, nav, theme, t }: {
  bookId: string;
  chapterNumber: number;
  nav: Nav;
  theme: Theme;
  t: TFunction;
}) {
  const c = useColors(theme);
  const { data, loading, error, refetch } = useApi<ChapterData>(
    `/books/${bookId}/chapters/${chapterNumber}`,
  );
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [workspaceRevision, setWorkspaceRevision] = useState(0);

  // --- Task 15: State Review visibility on the chapter page ---------------
  // The authoritative workflow state comes from the Task 14 GET contract —
  // never inferred from the index status alone.
  const bookIndex = useApi<{ chapters?: ReadonlyArray<{ number: number; status: string }> }>(
    `/books/${bookId}`,
  );
  const chapterStatus = bookIndex.data?.chapters?.find((entry) => entry.number === chapterNumber)?.status;
  const needsStateReview = chapterStatus === "needs-state-review";
  const [reviewArtifact, setReviewArtifact] = useState<StateReviewArtifact | null>(null);
  const [rebuildPending, setRebuildPending] = useState(false);
  const refreshReviewArtifact = () => {
    if (!needsStateReview) {
      setReviewArtifact(null);
      return;
    }
    void fetchStateReview(bookId, chapterNumber)
      .then((view) => setReviewArtifact(view.review))
      .catch(() => setReviewArtifact(null));
  };
  useEffect(refreshReviewArtifact, [bookId, chapterNumber, needsStateReview]);
  useEffect(() => {
    const handler = () => {
      bookIndex.refetch();
      refreshReviewArtifact();
    };
    window.addEventListener("inkos:api-invalidate", handler);
    return () => window.removeEventListener("inkos:api-invalidate", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, chapterNumber, needsStateReview]);

  const handleRetryAudit = async () => {
    if (rebuildPending) return;
    setRebuildPending(true);
    try {
      const outcome = await postStateReviewRebuild(bookId, chapterNumber);
      if (outcome.ok) setReviewArtifact(outcome.artifact);
      else refreshReviewArtifact();
      bookIndex.refetch();
    } catch {
      refreshReviewArtifact();
    } finally {
      setRebuildPending(false);
    }
  };
  // ------------------------------------------------------------------------

  const handleStartEdit = () => {
    if (!data) return;
    setEditContent(data.content);
    setEditing(true);
  };

  const handleCancelEdit = () => {
    setEditing(false);
    setEditContent("");
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetchJson(`/books/${bookId}/chapters/${chapterNumber}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });
      setEditing(false);
      refetch();
      setWorkspaceRevision((revision) => revision + 1);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) return (
    <div className="flex flex-col items-center justify-center py-32 space-y-4">
      <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
      <span className="text-sm text-muted-foreground">{t("reader.openingManuscript")}</span>
    </div>
  );

  if (error) return <div className="text-destructive p-8 bg-destructive/5 rounded-xl border border-destructive/20">Error: {error}</div>;
  if (!data) return null;

  // Split markdown content into title and body
  const lines = data.content.split("\n");
  const titleLine = lines.find((l) => l.startsWith("# "));
  const title = titleLine?.replace(/^#\s*/, "") ?? `Chapter ${chapterNumber}`;
  const body = lines
    .filter((l) => l !== titleLine)
    .join("\n")
    .trim();

  const handleApprove = async () => {
    try {
      await postApi(`/books/${bookId}/chapters/${chapterNumber}/approve`);
      nav.toBook(bookId);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Approve failed");
    }
  };

  const handleReject = async () => {
    try {
      await postApi(`/books/${bookId}/chapters/${chapterNumber}/reject`);
      nav.toBook(bookId);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Reject failed");
    }
  };

  const paragraphs = body.split(/\n\n+/).filter(Boolean);

  return (
    <div className="w-full space-y-10 fade-in">
      {/* Navigation & Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <nav className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
          <button
            onClick={nav.toDashboard}
            className="hover:text-primary transition-colors flex items-center gap-1"
          >
            {t("bread.books")}
          </button>
          <span className="text-border">/</span>
          <button
            onClick={() => nav.toBook(bookId)}
            className="hover:text-primary transition-colors truncate max-w-[120px]"
          >
            {bookId}
          </button>
          <span className="text-border">/</span>
          <span className="text-foreground flex items-center gap-1">
            <Hash size={12} />
            {chapterNumber}
          </span>
        </nav>

        <div className="flex gap-2">
          <button
            onClick={() => nav.toBook(bookId)}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-secondary text-muted-foreground rounded-xl hover:text-foreground hover:bg-secondary/80 transition-all border border-border/50"
          >
            <List size={14} />
            {t("reader.backToList")}
          </button>

          {/* Edit / Preview toggle */}
          {editing ? (
            <>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-primary text-primary-foreground rounded-xl hover:scale-105 active:scale-95 transition-all shadow-sm disabled:opacity-50"
              >
                {saving ? <div className="w-3.5 h-3.5 border-2 border-primary-foreground/20 border-t-primary-foreground rounded-full animate-spin" /> : <Save size={14} />}
                {saving ? t("book.saving") : t("book.save")}
              </button>
              <button
                onClick={handleCancelEdit}
                className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-secondary text-muted-foreground rounded-xl hover:text-foreground transition-all border border-border/50"
              >
                <Eye size={14} />
                {t("reader.preview")}
              </button>
            </>
          ) : (
            <button
              onClick={handleStartEdit}
              className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-secondary text-muted-foreground rounded-xl hover:text-primary hover:bg-primary/10 transition-all border border-border/50"
            >
              <Pencil size={14} />
              {t("reader.edit")}
            </button>
          )}

          <button
            onClick={handleApprove}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-emerald-500/10 text-emerald-600 rounded-xl hover:bg-emerald-500 hover:text-white transition-all border border-emerald-500/20 shadow-sm"
          >
            <CheckCircle2 size={14} />
            {t("reader.approve")}
          </button>
          <button
            onClick={handleReject}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-destructive/10 text-destructive rounded-xl hover:bg-destructive hover:text-white transition-all border border-destructive/20 shadow-sm"
          >
            <XCircle size={14} />
            {t("reader.reject")}
          </button>
        </div>
      </div>

      {/* Task 15: rebuild-failed banner (Retry Audit / Review State) */}
      {needsStateReview && reviewArtifact?.status === "rebuild_failed" && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5" role="alert">
          <div className="flex items-center gap-2 text-sm font-medium text-destructive">
            <FileWarning size={15} />
            状态复核重建失败 · State review rebuild failed
          </div>
          {reviewArtifact.reason && (
            <p className="mt-1.5 break-words text-xs text-muted-foreground">{reviewArtifact.reason}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => void handleRetryAudit()}
              disabled={rebuildPending}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-sm disabled:opacity-50"
            >
              {rebuildPending ? (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground/20 border-t-primary-foreground" />
              ) : (
                <RefreshCw size={13} />
              )}
              重试审计 · Retry Audit
            </button>
            {nav.toStateReview && (
              <button
                onClick={() => nav.toStateReview?.(bookId, chapterNumber)}
                className="inline-flex items-center gap-2 rounded-xl border border-border/50 px-4 py-2 text-xs font-bold text-muted-foreground hover:text-foreground"
              >
                查看详情 · Details
              </button>
            )}
          </div>
        </div>
      )}

      {/* Task 15: needs-state-review badge + entry point (design §26) */}
      {needsStateReview && reviewArtifact?.status !== "rebuild_failed" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-600">
            <Brain size={16} />
            需要人工状态复核 · State Review Required
          </div>
          {reviewArtifact?.status === "rebuild_required" || reviewArtifact?.status === "stale" ? (
            <button
              onClick={() => void handleRetryAudit()}
              disabled={rebuildPending}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-sm disabled:opacity-50"
            >
              <RefreshCw size={13} />
              重建状态复核 · Rebuild State Review
            </button>
          ) : null}
          {nav.toStateReview && (
            <button
              onClick={() => nav.toStateReview?.(bookId, chapterNumber)}
              data-testid="open-state-review"
              className="inline-flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs font-bold text-amber-600 hover:bg-amber-500 hover:text-white transition-all"
            >
              审阅状态修改 · Review State Changes
            </button>
          )}
        </div>
      )}

      <ChapterWorkspacePanel
        key={`${chapterNumber}-${workspaceRevision}`}
        bookId={bookId}
        chapterNumber={chapterNumber}
        t={t}
        onChapterChanged={refetch}
        onChapterDeleted={() => nav.toBook(bookId)}
      />

      {/* Manuscript Sheet */}
      <div className="paper-sheet rounded-2xl p-8 md:p-16 lg:p-24 shadow-2xl shadow-primary/5 min-h-[80vh] relative overflow-hidden">
        {/* Physical Paper Details */}
        <div className="absolute top-0 left-8 w-px h-full bg-primary/5 hidden md:block" />
        <div className="absolute top-0 right-8 w-px h-full bg-primary/5 hidden md:block" />

        <header className="mb-16 text-center">
          <div className="flex items-center justify-center gap-2 text-muted-foreground/30 mb-8 select-none">
            <div className="h-px w-12 bg-border/40" />
            <BookOpen size={20} />
            <div className="h-px w-12 bg-border/40" />
          </div>
          <h1 className="text-4xl md:text-5xl font-serif font-medium italic text-foreground tracking-tight leading-tight">
            {title}
          </h1>
          <div className="mt-8 flex items-center justify-center gap-4 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60">
            <span>{t("reader.manuscriptPage")}</span>
            <span className="text-border">·</span>
            <span>{chapterNumber.toString().padStart(2, '0')}</span>
          </div>
        </header>

        {editing ? (
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-full min-h-[60vh] bg-transparent font-serif text-lg leading-[1.8] text-foreground/90 focus:outline-none resize-none border border-border/30 rounded-lg p-6 focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-all"
            autoFocus
          />
        ) : (
          <article className="prose prose-zinc dark:prose-invert max-w-none">
            {paragraphs.map((para, i) => (
              <p key={i} className="font-serif text-lg md:text-xl leading-[1.8] text-foreground/90 mb-8 first-letter:text-2xl first-letter:font-bold first-letter:text-primary/40">
                {para}
              </p>
            ))}
          </article>
        )}

        <footer className="mt-24 pt-12 border-t border-border/20 flex flex-col items-center gap-6 text-center">
          <div className="flex items-center gap-4 text-xs font-medium text-muted-foreground">
             <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary/50">
               <Type size={14} className="text-primary/60" />
               <span>{body.length.toLocaleString()} {t("reader.characters")}</span>
             </div>
             <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary/50">
               <Clock size={14} className="text-primary/60" />
               <span>{Math.ceil(body.length / 500)} {t("reader.minRead")}</span>
             </div>
          </div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground/40 font-bold">{t("reader.endOfChapter")}</p>
        </footer>
      </div>

      {/* Footer Navigation */}
      <div className="flex justify-between items-center py-8">
        {chapterNumber > 1 ? (
          <button
            onClick={() => nav.toBook(bookId)}
            className="flex items-center gap-2 text-sm font-bold text-muted-foreground hover:text-primary transition-all group"
          >
            <RotateCcw size={16} className="group-hover:-rotate-45 transition-transform" />
            {t("reader.chapterList")}
          </button>
        ) : (
          <div />
        )}
      </div>
    </div>
  );
}
