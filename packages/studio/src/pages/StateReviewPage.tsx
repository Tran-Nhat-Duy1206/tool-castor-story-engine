import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  FileWarning,
  History,
  Lock,
  Pencil,
  Plus,
  Quote,
  RefreshCw,
  ShieldAlert,
  Trash2,
  User,
  X,
} from "lucide-react";
import type {
  ActiveStateReviewArtifact,
  ResolvedReviewReceipt,
  ReviewItem,
  StateReviewArtifact,
} from "../lib/state-review-api";
import {
  confirmReview,
  deleteStateReviewUserItem,
  fetchStateReview,
  fetchStateReviewReceipts,
  postStateReviewDecision,
  postStateReviewEdit,
  postStateReviewRejectAll,
  postStateReviewRebuild,
  postStateReviewUserItem,
} from "../lib/state-review-api";
import { invalidateApiPaths } from "../hooks/use-api";
import {
  buildConfirmDispatch,
  buildDecisionDispatch,
  buildRejectAnywayDispatch,
  confirmEnabled,
  confirmOutcomeToUi,
  describeProposalChange,
  explicitRejectNeedsWarning,
  groupReviewItems,
  historicalBannerView,
  isZeroChangeReview,
  lifecycleOf,
  mutationOutcomeToUi,
  receiptChips,
  rebuildFailedBannerView,
  rejectAllUiPatch,
  reviewKindLabel,
  reviewProgress,
  type ConfirmOutcomeView,
  type MutationOutcomeView,
  type UiLanguage,
} from "./state-review-ui-state";

interface Nav {
  readonly toBook: (bookId: string) => void;
  readonly toChapter: (bookId: string, chapterNumber: number) => void;
}

interface StateReviewPageProps {
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly nav: Nav;
}

type DraftFields = Record<string, string>;

interface UserDraft {
  kind: "current-state-fact" | "hook-mention" | "hook-resolve" | "hook-defer" | "note";
  fields: DraftFields;
}

const USER_DRAFT_KINDS: ReadonlyArray<{ value: UserDraft["kind"]; vi: string; en: string }> = [
  { value: "current-state-fact", vi: "Sự kiện trạng thái hiện tại", en: "Current-state fact" },
  { value: "hook-mention", vi: "Nhắc đến tiền để", en: "Hook mention" },
  { value: "hook-resolve", vi: "Thu hồi tiền để", en: "Hook resolve" },
  { value: "hook-defer", vi: "Hoãn tiền để", en: "Hook defer" },
  { value: "note", vi: "Ghi chú", en: "Note" },
];

/** Client-side pre-validation for the user-add form (Core re-validates). */
function validateUserDraft(draft: UserDraft): string[] {
  const issues: string[] = [];
  const need = (field: string, labelVi: string, labelEn: string) => {
    if (!(draft.fields[field] ?? "").trim()) {
      issues.push(`${labelVi} không được để trống · ${labelEn} is required`);
    }
  };
  if (draft.kind === "current-state-fact") {
    need("subject", "Chủ thể", "Subject");
    need("predicate", "Vị từ", "Predicate");
    need("object", "Giá trị", "Value");
  } else if (draft.kind === "note") {
    need("text", "Nội dung ghi chú", "Note text");
  } else {
    need("hookId", "ID tiền để", "Hook ID");
  }
  return issues;
}

function buildUserChange(draft: UserDraft): unknown {
  switch (draft.kind) {
    case "current-state-fact":
      return {
        type: "fact",
        change: {
          action: "set",
          subject: draft.fields.subject?.trim(),
          predicate: draft.fields.predicate?.trim(),
          object: draft.fields.object?.trim(),
        },
      };
    case "note":
      // Frozen compat: a note's only legal payload is {type:"none"}; the
      // note TEXT travels in the required `title` field.
      return { type: "none" };
    default:
      return { type: "hook-op", op: draft.kind.replace("hook-", ""), hookId: draft.fields.hookId?.trim() ?? "" };
  }
}

/**
 * Human-governed State Review (design §26). The page renders the exact
 * persisted workflow states from the Task 14 GET contract and routes every
 * mutation through the Task 14 typed client with the currently observed
 * expectedReviewRevision. Core stays authoritative; this surface never makes
 * an automatic decision.
 */
export function StateReviewPage({ bookId, chapterNumber, nav }: StateReviewPageProps) {
  const [lang, setLang] = useState<UiLanguage>("vi");
  const vi = lang === "vi";
  const [review, setReview] = useState<StateReviewArtifact | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<ResolvedReviewReceipt[]>([]);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [mutationView, setMutationView] = useState<MutationOutcomeView | null>(null);
  const [confirmView, setConfirmView] = useState<ConfirmOutcomeView | null>(null);
  /** Item awaiting the §27 Reject Anyway modal (explicit human second step). */
  const [warningItem, setWarningItem] = useState<ReviewItem | null>(null);
  const [rejectAllArmed, setRejectAllArmed] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<DraftFields>({});
  const [userDraftOpen, setUserDraftOpen] = useState(false);
  const [userDraft, setUserDraft] = useState<UserDraft>({ kind: "current-state-fact", fields: {} });
  const [draftIssues, setDraftIssues] = useState<string[]>([]);

  const refetchReview = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [view, receiptList] = await Promise.all([
        fetchStateReview(bookId, chapterNumber),
        fetchStateReviewReceipts(bookId, chapterNumber).catch(() => ({ receipts: [] as ResolvedReviewReceipt[], bookId, chapter: chapterNumber })),
      ]);
      setReview(view.review);
      setReceipts(receiptList.receipts);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [bookId, chapterNumber]);

  useEffect(() => {
    void refetchReview();
  }, [refetchReview]);

  const lifecycle = lifecycleOf(review);
  const active = lifecycle === "active" || lifecycle === "stale"
    ? (review as ActiveStateReviewArtifact)
    : null;
  const progress = useMemo(() => (active ? reviewProgress(active.items) : { reviewedCount: 0, total: 0 }), [active]);
  const zeroChange = active ? isZeroChangeReview(active) : false;
  // A user-add draft blocks Final Confirm until it passes validation (plan:
  // confirmEnabled = all reviewed && no invalid user items).
  const draftInvalid = userDraftOpen && validateUserDraft(userDraft).length > 0;

  /** Adopt the authoritative artifact returned by a successful mutation. */
  const applyMutationOutcome = (outcome: Awaited<ReturnType<typeof postStateReviewDecision>>) => {
    const view = mutationOutcomeToUi(outcome, lang);
    setMutationView(view.tone === "success" ? null : view);
    if (view.tone === "explicit-warning-required") {
      const item = active?.items.find((entry: ReviewItem) => entry.id === view.itemId) ?? null;
      setWarningItem(item);
      return;
    }
    if (outcome.ok) {
      setReview(outcome.artifact); // authoritative response replaces local data
      setEditingItemId(null);
      setEditDraft({});
    } else if (view.refetchLatest) {
      // CAS conflict: load latest and DISCARD stale buffers — the human must
      // reassess against current state; nothing auto-overwrites server data.
      setEditingItemId(null);
      setEditDraft({});
      void refetchReview();
    }
  };

  const runItemAction = async (item: ReviewItem, dispatch: ReturnType<typeof buildDecisionDispatch>) => {
    if (pendingAction) return; // duplicate-click guard: one in-flight mutation at a time
    setPendingAction(item.id);
    setMutationView(null);
    try {
      const outcome = await postStateReviewDecision(bookId, chapterNumber, dispatch);
      applyMutationOutcome(outcome);
    } catch (e) {
      setMutationView(mutationOutcomeToUi({ ok: false, message: e instanceof Error ? e.message : String(e) }, lang));
    } finally {
      setPendingAction(null);
    }
  };

  const handleAccept = (item: ReviewItem) => {
    if (!active) return;
    void runItemAction(item, buildDecisionDispatch(item.id, "accept", active.reviewRevision));
  };

  const handleRejectClick = (item: ReviewItem) => {
    if (!active) return;
    // §27 friction: verified-explicit evidence demands the explicit modal —
    // NEVER send override silently.
    if (explicitRejectNeedsWarning(item)) {
      setWarningItem(item);
      return;
    }
    void runItemAction(item, buildDecisionDispatch(item.id, "reject", active.reviewRevision));
  };

  const handleRejectAnyway = () => {
    if (!active || !warningItem) return;
    const item = warningItem;
    setWarningItem(null);
    void runItemAction(item, buildRejectAnywayDispatch(item.id, active.reviewRevision));
  };

  const startEdit = (item: ReviewItem) => {
    setEditingItemId(item.id);
    setMutationView(null);
    const fields: DraftFields = {};
    const source = item.editedChange ?? item.proposal;
    fillDraftFields(fields, source as ProposalChangeLike);
    setEditDraft(fields);
  };

  const handleEditSave = async (item: ReviewItem) => {
    if (!active || pendingAction) return;
    setPendingAction(item.id);
    setMutationView(null);
    try {
      const editedChange = buildEditedChange(item.kind, editDraft);
      const outcome = await postStateReviewEdit(bookId, chapterNumber, {
        itemId: item.id,
        editedChange,
        expectedReviewRevision: active.reviewRevision,
      });
      // Edit + Save counts as decided — no second Accept required.
      applyMutationOutcome(outcome);
    } catch (e) {
      setMutationView(mutationOutcomeToUi({ ok: false, message: e instanceof Error ? e.message : String(e) }, lang));
    } finally {
      setPendingAction(null);
    }
  };

  const handleRemoveUserItem = async (item: ReviewItem) => {
    if (!active || pendingAction) return;
    setPendingAction(item.id);
    setMutationView(null);
    try {
      const outcome = await deleteStateReviewUserItem(bookId, chapterNumber, item.id, active.reviewRevision);
      applyMutationOutcome(outcome);
    } catch (e) {
      setMutationView(mutationOutcomeToUi({ ok: false, message: e instanceof Error ? e.message : String(e) }, lang));
    } finally {
      setPendingAction(null);
    }
  };

  const handleRejectAll = async (overrideExplicitWarning?: boolean) => {
    if (!active || pendingAction) return;
    setPendingAction("reject-all");
    setMutationView(null);
    try {
      const outcome = await postStateReviewRejectAll(bookId, chapterNumber, {
        expectedReviewRevision: active.reviewRevision,
        ...(overrideExplicitWarning ? { overrideExplicitWarning: true } : {}),
      });
      // §6 batch flow is owned by the pure model: an explicit-evidence
      // outcome ARMS the confirmation and it must STAY armed across this
      // lifecycle (review C1 — a finally-disarm here used to make the
      // friction dialog unreachable).
      const patch = rejectAllUiPatch({ armed: rejectAllArmed }, outcome, lang);
      const view = mutationOutcomeToUi(outcome, lang);
      setRejectAllArmed(patch.armed);
      setMutationView(view.tone === "success" ? null : view.tone === "explicit-warning-required" ? null : view);
      if (patch.adoptArtifact && outcome.ok) setReview(outcome.artifact);
      else if (patch.refetchLatest) {
        setEditingItemId(null);
        setEditDraft({});
        void refetchReview();
      }
    } catch (e) {
      setMutationView(mutationOutcomeToUi({ ok: false, message: e instanceof Error ? e.message : String(e) }, lang));
    } finally {
      setPendingAction(null);
    }
  };

  const handleAddUserItem = async () => {
    if (!active || pendingAction) return;
    const issues = validateUserDraft(userDraft);
    setDraftIssues(issues);
    if (issues.length > 0) return;
    setPendingAction("add-item");
    setMutationView(null);
    try {
      const outcome = await postStateReviewUserItem(bookId, chapterNumber, {
        kind: userDraft.kind,
        change: buildUserChange(userDraft),
        title: userTitleFor(userDraft, vi),
        expectedReviewRevision: active.reviewRevision,
      });
      applyMutationOutcome(outcome);
      if (outcome.ok) {
        setUserDraft({ kind: "current-state-fact", fields: {} });
        setUserDraftOpen(false);
        setDraftIssues([]);
      }
    } catch (e) {
      setMutationView(mutationOutcomeToUi({ ok: false, message: e instanceof Error ? e.message : String(e) }, lang));
    } finally {
      setPendingAction(null);
    }
  };

  const handleRebuild = async () => {
    if (pendingAction) return;
    setPendingAction("rebuild");
    setMutationView(null);
    setConfirmView(null);
    try {
      const outcome = await postStateReviewRebuild(bookId, chapterNumber);
      if (outcome.ok) {
        setReview(outcome.artifact); // fresh generation replaces the old one — no carry-over
      } else {
        setMutationView(mutationOutcomeToUi(outcome, lang));
        void refetchReview();
      }
    } catch (e) {
      setMutationView(mutationOutcomeToUi({ ok: false, message: e instanceof Error ? e.message : String(e) }, lang));
    } finally {
      setPendingAction(null);
    }
  };

  const handleConfirm = async () => {
    if (!active || pendingAction || !confirmEnabled(active.items, draftInvalid)) return;
    setPendingAction("confirm");
    setMutationView(null);
    try {
      // Exact Task 14 signature: confirm carries reviewId + observed revision.
      const dispatch = buildConfirmDispatch(active);
      const outcome = await confirmReview(bookId, chapterNumber, dispatch.reviewId, dispatch.expectedReviewRevision);
      const view = confirmOutcomeToUi(outcome, lang);
      setConfirmView(view);
      if (view.refreshChapter) {
        // Refresh the chapter index/status used across Studio so the badge
        // leaves needs-state-review immediately.
        invalidateApiPaths([`/api/v1/books/${bookId}`]);
      }
      await refetchReview();
    } catch (e) {
      setConfirmView(confirmOutcomeToUi({ ok: false, message: e instanceof Error ? e.message : String(e) }, lang));
    } finally {
      setPendingAction(null);
    }
  };

  const busy = pendingAction !== null;
  const canConfirm = active ? confirmEnabled(active.items, draftInvalid) : false;

  return (
    <div className="mx-auto w-full max-w-[1100px] space-y-6 fade-in" data-testid="state-review-page">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Brain size={20} />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">
              {vi ? "Soát lại trạng thái" : "State Review"}
              <span className="ml-3 rounded-full border border-border/60 bg-secondary/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                #{chapterNumber}
              </span>
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {vi
                ? "Bạn là người phán quyết cuối cùng: soát từng thay đổi trạng thái do AI đề xuất, hoặc thêm thay đổi của riêng bạn."
                : "You are the final authority: review each proposed state change, or add your own."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5 rounded-lg bg-muted/50 p-0.5">
            {(["vi", "en"] as const).map((value) => (
              <button
                key={value}
                onClick={() => setLang(value)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                  lang === value ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                }`}
              >
                {value === "vi" ? "VI" : "EN"}
              </button>
            ))}
          </div>
          <button
            onClick={() => void refetchReview()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : undefined} />
            {vi ? "Làm mới" : "Refresh"}
          </button>
          <button
            onClick={() => nav.toChapter(bookId, chapterNumber)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft size={13} />
            {vi ? "Quay lại chương" : "Back to chapter"}
          </button>
        </div>
      </header>

      {loading && !review && (
        <div className="py-16 text-center text-sm text-muted-foreground">
          {vi ? "Đang tải soát lại trạng thái…" : "Loading state review…"}
        </div>
      )}
      {loadError && (
        <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
          <AlertTriangle size={15} className="mr-2 inline" />
          {loadError}
        </div>
      )}

      {mutationView && <OutcomeBanner view={mutationView} vi={vi} onRefetch={() => void refetchReview()} />}

      {confirmView && (
        <ConfirmOutcomeBanner
          view={confirmView}
          vi={vi}
          onReload={() => { setConfirmView(null); void refetchReview(); }}
          onRetryAudit={() => { setConfirmView(null); void handleRebuild(); }}
        />
      )}

      {/* Lifecycle: none */}
      {!loading && !review && !loadError && (
        <div className="rounded-2xl border border-border/50 bg-card/50 p-8 text-center text-sm text-muted-foreground">
          {vi
            ? "Chương này không có việc soát lại trạng thái nào đang chờ."
            : "There is no pending state review for this chapter."}
        </div>
      )}

      {/* Lifecycle: shells */}
      {lifecycle === "rebuild_required" && (
        <ShellPanel
          tone="amber"
          icon={<History size={18} />}
          title={vi ? "Cần dựng lại bản soát lại" : "Rebuild required"}
          body={
            <>
              <p className="text-sm text-muted-foreground">
                {vi
                  ? "Phần thân chương đã thay đổi sau khi xuất bản, các đề xuất trạng thái cũ đã hết hiệu lực và cần được dựng lại từ phần thân mới nhất."
                  : "The chapter prose changed after publication, so the previous proposal is outdated and must be rebuilt from the latest text."}
              </p>
              {"reason" in (review as { reason?: string }) && (review as { reason?: string }).reason ? (
                <p className="mt-2 break-words text-xs text-muted-foreground">{(review as { reason?: string }).reason}</p>
              ) : null}
            </>
          }
        >
          <button
            onClick={() => void handleRebuild()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-sm transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
          >
            {pendingAction === "rebuild" ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground/20 border-t-primary-foreground" />
            ) : (
              <RefreshCw size={14} />
            )}
            {pendingAction === "rebuild"
              ? (vi ? "Đang dựng lại…" : "Rebuilding…")
              : (vi ? "Dựng lại bản soát lại" : "Rebuild State Review")}
          </button>
        </ShellPanel>
      )}

      {lifecycle === "rebuild_failed" && review?.status === "rebuild_failed" && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6" role="alert">
          <div className="flex items-center gap-2 text-sm font-medium text-destructive">
            <FileWarning size={16} />
            {vi ? "Dựng lại thất bại" : "Rebuild failed"}
          </div>
          <p className="mt-2 break-words text-xs text-muted-foreground">{rebuildFailedBannerView(review).reason}</p>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => void handleRebuild()}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-sm disabled:opacity-50"
            >
              {pendingAction === "rebuild" ? (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground/20 border-t-primary-foreground" />
              ) : (
                <RefreshCw size={14} />
              )}
              {vi ? "Thử kiểm tra lại (Retry Audit)" : "Retry Audit"}
            </button>
            <button
              onClick={() => nav.toChapter(bookId, chapterNumber)}
              className="inline-flex items-center gap-2 rounded-xl border border-border/50 px-4 py-2 text-xs font-bold text-muted-foreground hover:text-foreground"
            >
              <Pencil size={14} />
              {vi ? "Chỉnh sửa chương" : "Edit Chapter"}
            </button>
          </div>
        </div>
      )}

      {/* Lifecycle: stale */}
      {lifecycle === "stale" && active && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-6" role="alert">
            <div className="flex items-center gap-2 text-sm font-medium text-amber-600">
              <ShieldAlert size={16} />
              {vi ? "Đề xuất này đã lỗi thời (stale), không thể xác nhận" : "This proposal is stale and cannot be confirmed"}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {vi
                ? "Đầu vào của chương đã thay đổi sau khi đề xuất này được tạo. Hãy dựng lại để tạo đề xuất mới; các quyết định cũ sẽ không được giữ lại."
                : "Chapter inputs changed after this proposal was generated. Rebuild to create a fresh proposal; old decisions are not carried over."}
            </p>
            <button
              onClick={() => void handleRebuild()}
              disabled={busy}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-sm disabled:opacity-50"
            >
              <RefreshCw size={14} />
              {vi ? "Dựng lại bản soát lại" : "Rebuild State Review"}
            </button>
          </div>
          <ReadOnlyReview review={active} vi={vi} />
        </div>
      )}

      {/* Lifecycle: active */}
      {lifecycle === "active" && active && (
        <ActiveReviewSurface
          review={active}
          vi={vi}
          lang={lang}
          busy={busy}
          pendingAction={pendingAction}
          progress={progress}
          zeroChange={zeroChange}
          canConfirm={canConfirm}
          editingItemId={editingItemId}
          editDraft={editDraft}
          setEditDraft={setEditDraft}
          userDraftOpen={userDraftOpen}
          setUserDraftOpen={setUserDraftOpen}
          userDraft={userDraft}
          setUserDraft={setUserDraft}
          draftIssues={draftIssues}
          rejectAllArmed={rejectAllArmed}
          onAccept={handleAccept}
          onReject={handleRejectClick}
          onStartEdit={startEdit}
          onCancelEdit={() => { setEditingItemId(null); setEditDraft({}); }}
          onSaveEdit={(item) => void handleEditSave(item)}
          onRemoveUserItem={(item) => void handleRemoveUserItem(item)}
          onAddUserItem={() => void handleAddUserItem()}
          onConfirm={() => void handleConfirm()}
          onRejectAll={() => void handleRejectAll()}
          onRejectAllAnyway={() => void handleRejectAll(true)}
        />
      )}

      {/* Receipt history */}
      {receipts.length > 0 && (
        <section className="rounded-2xl border border-border/50 bg-card/50 p-4">
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            {vi ? "Lịch sử biên nhận xác nhận" : "Confirmation receipts"}
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {receiptChips(receipts).map((chip) => (
              <span
                key={chip.reviewId}
                title={`${chip.reviewId} · ${chip.resolvedAt}`}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium ${
                  chip.resolution === "superseded"
                    ? "border border-border/60 bg-secondary/40 text-muted-foreground line-through decoration-border"
                    : "border border-emerald-500/30 bg-emerald-500/5 text-emerald-600"
                }`}
              >
                {chip.resolution === "superseded" ? <X size={11} /> : <CheckCircle2 size={11} />}
                {chip.resolution === "superseded"
                  ? (vi ? "đã bị thay thế" : "superseded")
                  : chip.resolution === "confirmed-no-changes"
                    ? (vi ? "xác nhận không đổi" : "confirmed-no-changes")
                    : (vi ? "đã xác nhận" : "resolved")}
                <Clock size={10} className="opacity-60" />
                {chip.resolvedAt.slice(0, 16).replace("T", " ")}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* §27 explicit-rejection warning modal */}
      {warningItem && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reject-warning-title"
          aria-describedby="reject-warning-body"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
        >
          <div className="w-full max-w-md rounded-2xl border border-destructive/30 bg-background p-6 shadow-2xl">
            <div className="flex items-center gap-2 text-destructive">
              <ShieldAlert size={18} />
              <h2 id="reject-warning-title" className="text-base font-semibold">
                {vi ? "Từ chối thay đổi được phần văn bản trực tiếp chứng minh?" : "Reject a change directly supported by the text?"}
              </h2>
            </div>
            <p id="reject-warning-body" className="mt-3 text-sm text-muted-foreground">
              {vi
                ? "Thay đổi này có vẻ được phần văn bản chương trực tiếp chứng minh. Từ chối có thể khiến trạng thái chính thống mâu thuẫn với phần thân."
                : "This change appears to be directly supported by the chapter text. Rejecting it may cause Canon to disagree with the prose."}
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                onClick={() => setWarningItem(null)}
                className="rounded-xl border border-border/50 px-4 py-2 text-xs font-bold text-muted-foreground hover:text-foreground"
              >
                {vi ? "Hủy" : "Cancel"}
              </button>
              <button
                onClick={() => {
                  setWarningItem(null);
                  nav.toChapter(bookId, chapterNumber);
                }}
                className="rounded-xl border border-border/50 px-4 py-2 text-xs font-bold text-muted-foreground hover:text-foreground"
              >
                <Pencil size={12} className="mr-1 inline" />
                {vi ? "Chỉnh sửa chương" : "Edit Chapter"}
              </button>
              <button
                onClick={() => void handleRejectAnyway()}
                className="rounded-xl bg-destructive px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-destructive/90"
              >
                {vi ? "Vẫn từ chối" : "Reject Anyway"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* §6 batch friction confirmation */}
      {rejectAllArmed && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reject-all-warning-title"
          aria-describedby="reject-all-warning-body"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
        >
          <div className="w-full max-w-md rounded-2xl border border-destructive/30 bg-background p-6 shadow-2xl">
            <div className="flex items-center gap-2 text-destructive">
              <ShieldAlert size={18} />
              <h2 id="reject-all-warning-title" className="text-base font-semibold">
                {vi ? "Từ chối hàng loạt gồm cả các đề xuất được văn bản chứng minh trực tiếp" : "Batch reject includes text-supported proposals"}
              </h2>
            </div>
            <p id="reject-all-warning-body" className="mt-3 text-sm text-muted-foreground">
              {vi
                ? "Một số đề xuất của AI được phần văn bản chương chứng minh trực tiếp. Từ chối tất cả có thể khiến trạng thái chính thống mâu thuẫn với phần thân. Bạn chắc chắn muốn từ chối tất cả?"
                : "Some AI proposals appear directly supported by the chapter text. Rejecting all of them may cause Canon to disagree with the prose. Continue?"}
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                onClick={() => setRejectAllArmed(false)}
                className="rounded-xl border border-border/50 px-4 py-2 text-xs font-bold text-muted-foreground hover:text-foreground"
              >
                {vi ? "Hủy" : "Cancel"}
              </button>
              <button
                onClick={() => void handleRejectAll(true)}
                className="rounded-xl bg-destructive px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-destructive/90"
              >
                {vi ? "Vẫn từ chối tất cả" : "Reject All Anyway"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Active review surface
// ---------------------------------------------------------------------------

interface ActiveSurfaceProps {
  review: ActiveStateReviewArtifact;
  vi: boolean;
  lang: UiLanguage;
  busy: boolean;
  pendingAction: string | null;
  progress: { reviewedCount: number; total: number };
  zeroChange: boolean;
  canConfirm: boolean;
  editingItemId: string | null;
  editDraft: DraftFields;
  setEditDraft: (fields: DraftFields) => void;
  userDraftOpen: boolean;
  setUserDraftOpen: (open: boolean) => void;
  userDraft: UserDraft;
  setUserDraft: (draft: UserDraft) => void;
  draftIssues: string[];
  rejectAllArmed: boolean;
  onAccept: (item: ReviewItem) => void;
  onReject: (item: ReviewItem) => void;
  onStartEdit: (item: ReviewItem) => void;
  onCancelEdit: () => void;
  onSaveEdit: (item: ReviewItem) => void;
  onRemoveUserItem: (item: ReviewItem) => void;
  onAddUserItem: () => void;
  onConfirm: () => void;
  onRejectAll: () => void;
  onRejectAllAnyway: () => void;
}

function ActiveReviewSurface(props: ActiveSurfaceProps) {
  const {
    review, vi, lang, busy, pendingAction, progress, zeroChange, canConfirm,
    editingItemId, editDraft, setEditDraft, userDraftOpen, setUserDraftOpen,
    userDraft, setUserDraft, draftIssues, rejectAllArmed,
    onAccept, onReject, onStartEdit, onCancelEdit, onSaveEdit,
    onRemoveUserItem, onAddUserItem, onConfirm, onRejectAll, onRejectAllAnyway,
  } = props;
  const groups = groupReviewItems(review.items);
  const historical = historicalBannerView(review, review.effectiveChapter - 1);

  return (
    <div className="space-y-4" data-testid="state-review-active">
      {/* Identity / anchors */}
      <section className="grid grid-cols-2 gap-3 rounded-2xl border border-border/50 bg-card/50 p-4 sm:grid-cols-4">
        <Cell label={vi ? "Chương nguồn" : "Source chapter"} value={`#${review.sourceChapter}`} />
        <Cell label={vi ? "Ô hiệu lực" : "Effective slot"} value={`#${review.effectiveChapter}`} />
        <Cell label={vi ? "Phiên bản soát lại" : "Review revision"} value={`r${review.reviewRevision}`} />
        <Cell label={vi ? "ID lượt tạo" : "Generation"} value={review.reviewId.slice(0, 8)} />
      </section>

      {historical && (
        <div className="flex items-start gap-2 rounded-2xl border border-sky-500/30 bg-sky-500/5 p-4 text-sm text-sky-700 dark:text-sky-400" role="note">
          <History size={15} className="mt-0.5 shrink-0" />
          <span>
            {vi
              ? `Sửa đổi chương quá khứ — các thay đổi xác nhận tại đây sẽ ảnh hưởng Canon từ chương ${historical.effectiveChapter}. Các chương ${historical.sourceChapter + 1}–${historical.effectiveChapter - 1} cùng phần thân/lịch sử của chúng sẽ không bị viết lại.`
              : `Historical chapter correction — Changes confirmed here will affect Canon from Chapter ${historical.effectiveChapter} onward. Existing Chapters ${historical.sourceChapter + 1}–${historical.effectiveChapter - 1} and their prose/history will not be rewritten.`}
          </span>
        </div>
      )}

      {/* Progress + actions */}
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/50 bg-card/50 p-4">
        <div className="text-sm">
          <span className="font-semibold text-foreground">
            {vi ? `${progress.reviewedCount} / ${progress.total}` : `${progress.reviewedCount} / ${progress.total}`}
          </span>
          <span className="ml-1.5 text-muted-foreground">{vi ? "mục đã soát" : "reviewed"}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setUserDraftOpen(!userDraftOpen)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <Plus size={13} />
            {vi ? "Thêm thay đổi còn thiếu" : "Add Missing Change"}
          </button>
          {progress.total > 0 && (
            <button
              onClick={onRejectAll}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/30 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              <X size={13} />
              {vi ? "Từ chối tất cả đề xuất AI" : "Reject All AI"}
            </button>
          )}
          <button
            onClick={onConfirm}
            disabled={!canConfirm || busy}
            data-testid="final-confirm"
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm transition-all hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pendingAction === "confirm" ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <CheckCircle2 size={14} />
            )}
            {zeroChange
              ? (vi ? "Xác nhận không có thay đổi" : "Confirm No Changes")
              : (vi ? "Xác nhận cuối cùng" : "Final Confirm")}
          </button>
        </div>
      </section>

      {/* User add form */}
      {userDraftOpen && (
        <section className="rounded-2xl border border-primary/30 bg-primary/5 p-4" aria-label={vi ? "Thêm thay đổi trạng thái" : "Add state change"}>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="user-draft-kind">
              {vi ? "Kiểu" : "Kind"}
            </label>
            <select
              id="user-draft-kind"
              value={userDraft.kind}
              onChange={(e) => setUserDraft({ kind: e.target.value as UserDraft["kind"], fields: {} })}
              className="rounded-lg border border-border/60 bg-background px-2 py-1.5 text-xs"
            >
              {USER_DRAFT_KINDS.map((option) => (
                <option key={option.value} value={option.value}>
                  {vi ? option.vi : option.en}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {userDraft.kind === "current-state-fact" && (
              <>
                <LabeledInput id="ud-subject" label={vi ? "Chủ thể" : "Subject"} value={userDraft.fields.subject ?? ""} onChange={(v) => setUserDraft({ ...userDraft, fields: { ...userDraft.fields, subject: v } })} />
                <LabeledInput id="ud-predicate" label={vi ? "Vị từ" : "Predicate"} value={userDraft.fields.predicate ?? ""} onChange={(v) => setUserDraft({ ...userDraft, fields: { ...userDraft.fields, predicate: v } })} />
                <LabeledInput id="ud-object" label={vi ? "Giá trị" : "Value"} value={userDraft.fields.object ?? ""} onChange={(v) => setUserDraft({ ...userDraft, fields: { ...userDraft.fields, object: v } })} />
              </>
            )}
            {(userDraft.kind === "hook-mention" || userDraft.kind === "hook-resolve" || userDraft.kind === "hook-defer") && (
              <LabeledInput id="ud-hookid" label={vi ? "ID tiền để" : "Hook ID"} value={userDraft.fields.hookId ?? ""} onChange={(v) => setUserDraft({ ...userDraft, fields: { ...userDraft.fields, hookId: v } })} />
            )}
            {userDraft.kind === "note" && (
              <LabeledInput id="ud-text" label={vi ? "Nội dung ghi chú" : "Note"} value={userDraft.fields.text ?? ""} onChange={(v) => setUserDraft({ ...userDraft, fields: { ...userDraft.fields, text: v } })} />
            )}
          </div>
          {draftIssues.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-destructive">
              {draftIssues.map((issue) => <li key={issue}>{issue}</li>)}
            </ul>
          )}
          <div className="mt-3 flex gap-2">
            <button
              onClick={onAddUserItem}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-sm disabled:opacity-50"
            >
              {pendingAction === "add-item" ? (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground/20 border-t-primary-foreground" />
              ) : (
                <Plus size={13} />
              )}
              {vi ? "Lưu thay đổi" : "Save Change"}
            </button>
            <button
              onClick={() => setUserDraftOpen(false)}
              className="rounded-xl border border-border/50 px-4 py-2 text-xs font-bold text-muted-foreground hover:text-foreground"
            >
              {vi ? "Hủy" : "Cancel"}
            </button>
          </div>
        </section>
      )}

      {/* Zero-change layout switch (design §19) */}
      {zeroChange && (
        <div className="rounded-2xl border border-border/50 bg-card/50 p-6 text-sm text-muted-foreground" data-testid="zero-change-note">
          {vi ? "Không có thay đổi trạng thái nào được đề xuất." : "No proposed state changes."}
        </div>
      )}

      {/* Groups */}
      {groups.map((group) => (
        <section key={group.key} className="space-y-2">
          <h2 className="px-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">
            {vi ? group.vi : group.en}
            <span className="ml-2 font-normal normal-case tracking-normal">({group.items.length})</span>
          </h2>
          {group.items.length === 0 && (
            <p className="px-1 text-xs text-muted-foreground/60">{vi ? "(không có)" : "(none)"}</p>
          )}
          {group.items.map((item) => (
            <ReviewItemCard
              key={item.id}
              item={item}
              vi={vi}
              lang={lang}
              busy={busy}
              pending={pendingAction === item.id}
              editing={editingItemId === item.id}
              editDraft={editDraft}
              setEditDraft={setEditDraft}
              onAccept={() => onAccept(item)}
              onReject={() => onReject(item)}
              onStartEdit={() => onStartEdit(item)}
              onCancelEdit={onCancelEdit}
              onSaveEdit={() => onSaveEdit(item)}
              onRemove={() => onRemoveUserItem(item)}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Item card
// ---------------------------------------------------------------------------

function ReviewItemCard({
  item, vi, lang, busy, pending, editing, editDraft, setEditDraft,
  onAccept, onReject, onStartEdit, onCancelEdit, onSaveEdit, onRemove,
}: {
  item: ReviewItem;
  vi: boolean;
  lang: UiLanguage;
  busy: boolean;
  pending: boolean;
  editing: boolean;
  editDraft: DraftFields;
  setEditDraft: (fields: DraftFields) => void;
  onAccept: () => void;
  onReject: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onRemove: () => void;
}) {
  const isNote = item.kind === "note";
  const isUser = item.origin === "user";
  const decided = item.decision !== "undecided";
  const hookUpsert = item.kind === "hook-upsert";

  return (
    <article
      data-testid={`review-item-${item.id}`}
      className={`rounded-2xl border p-4 ${
        isNote
          ? "border-border/40 bg-muted/20"
          : decided
            ? "border-border/50 bg-card/70 opacity-90"
            : "border-primary/25 bg-card/80"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-border/60 bg-secondary/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          {reviewKindLabel(item.kind, lang)}
        </span>
        {isUser && (
          <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[10px] font-bold text-sky-600">
            <User size={10} />
            {vi ? "thêm thủ công" : "user"}
          </span>
        )}
        {item.evidence?.verifiedLevel === "explicit" && (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-600">
            <Quote size={10} />
            {vi ? "đã xác minh · văn bản chứng minh trực tiếp" : "verified · explicit"}
          </span>
        )}
        {item.evidence?.verifiedLevel === "inferred" && (
          <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-secondary/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {vi ? "bằng chứng suy diễn" : "inferred evidence"}
          </span>
        )}
        <DecisionBadge decision={item.decision} vi={vi} />
        {pending && (
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary/20 border-t-primary" aria-label={vi ? "đang xử lý" : "in progress"} />
        )}
      </div>

      <h3 className="mt-2 text-sm font-semibold text-foreground">{item.title}</h3>

      {/* Proposed vs effective meaning */}
      <div className="mt-2 space-y-1 text-sm">
        <p className="text-muted-foreground">
          <span className="mr-1.5 rounded bg-secondary/60 px-1.5 py-0.5 text-[10px] font-bold uppercase">{vi ? "đề xuất" : "proposal"}</span>
          {describeProposalChange(item.proposal, lang)}
        </p>
        {item.decision === "edited" && item.editedChange && (
          <p className="text-foreground">
            <span className="mr-1.5 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-primary">{vi ? "hiệu lực sau chỉnh sửa" : "effective (edited)"}</span>
            {describeProposalChange(item.editedChange, lang)}
          </p>
        )}
        {!isNote && item.evidence?.quote && (
          <p className="border-l-2 border-border/60 pl-2 text-xs italic text-muted-foreground">“{item.evidence.quote}”</p>
        )}
      </div>

      {/* Actions — Core permits re-deciding an active item, so decided AI
          items keep their affordances (review I1); CAS protects each call. */}
      {!isNote && !editing && (
        <div className="mt-3 flex flex-wrap gap-2">
          {!isUser && (
            <>
              <ActionButton onClick={onAccept} disabled={busy} tone="positive" label={vi ? "Chấp nhận" : "Accept"} icon={<Check size={12} />} />
              <ActionButton onClick={onStartEdit} disabled={busy} tone="neutral" label={vi ? "Chỉnh sửa" : "Edit"} icon={<Pencil size={12} />} />
              <ActionButton onClick={onReject} disabled={busy} tone="negative" label={vi ? "Từ chối" : "Reject"} icon={<X size={12} />} />
            </>
          )}
          {isUser && (
            <ActionButton onClick={onRemove} disabled={busy} tone="negative" label={vi ? "Xóa" : "Remove"} icon={<Trash2 size={12} />} />
          )}
          {decided && !isUser && (
            <span className="self-center text-[11px] text-muted-foreground">
              {vi ? "đã quyết định · có thể đổi quyết định" : "decided · you can change this decision"}
            </span>
          )}
        </div>
      )}
      {isNote && item.detail && (
        <p className="mt-2 text-sm text-foreground/90">{item.detail}</p>
      )}
      {isNote && (
        <p className="mt-2 text-[11px] text-muted-foreground/70">
          {vi ? "Ghi chú chỉ mang tính tham khảo — không ảnh hưởng độ hoàn thành và không cần quyết định." : "Notes are informational — they never block completion and need no decision."}
        </p>
      )}

      {/* Structured edit form (no raw JSON anywhere — design §26) */}
      {editing && (
        <div className="mt-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
          {hookUpsert ? (
            <p className="text-xs text-muted-foreground">
              {vi
                ? "Bản ghi tiền để đầy đủ chưa hỗ trợ chỉnh sửa theo trường: hãy chọn chấp nhận hoặc từ chối."
                : "Field-level editing is not available for full hook records yet — accept or reject instead."}
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-3">
              {editFieldsFor(item.kind).map((field) => (
                <LabeledInput
                  key={field.key}
                  id={`edit-${item.id}-${field.key}`}
                  label={vi ? field.vi : field.en}
                  value={editDraft[field.key] ?? ""}
                  onChange={(value) => setEditDraft({ ...editDraft, [field.key]: value })}
                />
              ))}
            </div>
          )}
          {!hookUpsert && (
            <div className="mt-3 flex gap-2">
              <button
                onClick={onSaveEdit}
                disabled={busy}
                className="rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-sm disabled:opacity-50"
              >
                {vi ? "Lưu & quyết định" : "Save & Decide"}
              </button>
              <button
                onClick={onCancelEdit}
                className="rounded-xl border border-border/50 px-4 py-2 text-xs font-bold text-muted-foreground hover:text-foreground"
              >
                {vi ? "Hủy" : "Cancel"}
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function DecisionBadge({ decision, vi }: { decision: ReviewItem["decision"]; vi: boolean }) {
  if (decision === "undecided") {
    return <span className="rounded-full bg-secondary/60 px-2 py-0.5 text-[10px] font-bold text-muted-foreground">{vi ? "chưa quyết" : "undecided"}</span>;
  }
  const map: Record<string, { vi: string; en: string; cls: string }> = {
    accepted: { vi: "đã chấp nhận", en: "accepted", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600" },
    edited: { vi: "đã chỉnh sửa", en: "edited", cls: "border-sky-500/40 bg-sky-500/10 text-sky-600" },
    rejected: { vi: "đã từ chối", en: "rejected", cls: "border-destructive/40 bg-destructive/10 text-destructive" },
  };
  const view = map[decision];
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${view.cls}`}>
      {vi ? view.vi : view.en}
    </span>
  );
}

function ActionButton({ onClick, disabled, tone, label, icon }: {
  onClick: () => void;
  disabled: boolean;
  tone: "positive" | "neutral" | "negative";
  label: string;
  icon: React.ReactNode;
}) {
  const tones = {
    positive: "border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10",
    neutral: "border-border/50 text-muted-foreground hover:text-foreground",
    negative: "border-destructive/30 text-destructive hover:bg-destructive/10",
  } as const;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-50 ${tones[tone]}`}
    >
      {icon}
      {label}
    </button>
  );
}

function LabeledInput({ id, label, value, onChange }: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label htmlFor={id} className="block text-xs text-muted-foreground">
      {label}
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-border/60 bg-background px-2 py-1.5 text-sm text-foreground focus:border-primary/40 focus:outline-none"
      />
    </label>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">{label}</div>
      <div className="mt-0.5 font-mono text-sm text-foreground">{value}</div>
    </div>
  );
}

/**
 * Final Confirm outcome (Task 12 semantics are load-bearing): resolved,
 * already_resolved and resolved-with-warnings are ALL successes — warnings
 * render visibly but never masquerade as failure and never auto-retry.
 */
function ConfirmOutcomeBanner({ view, vi, onReload, onRetryAudit }: {
  view: ConfirmOutcomeView;
  vi: boolean;
  onReload: () => void;
  onRetryAudit: () => void;
}) {
  const styles: Record<string, string> = {
    success: "border-emerald-500/40 bg-emerald-500/5 text-emerald-600",
    "warning-success": "border-amber-500/40 bg-amber-500/5 text-amber-600",
    "conflict-reload": "border-amber-500/40 bg-amber-500/5 text-amber-600",
    locked: "border-border/60 bg-secondary/30 text-foreground",
    error: "border-destructive/30 bg-destructive/5 text-destructive",
  };
  return (
    <div role="status" className={`rounded-2xl border p-5 text-sm ${styles[view.tone]}`}>
      <div className="flex items-center gap-2 font-medium">
        {view.tone === "success" && <CheckCircle2 size={15} />}
        {view.tone === "warning-success" && <AlertTriangle size={15} />}
        {(view.tone === "conflict-reload" || view.tone === "locked") && <Lock size={15} className="opacity-70" />}
        {view.tone === "error" && <AlertTriangle size={15} />}
        {view.tone === "success" && (
          vi ? "Đã xác nhận — chương ở trạng thái SẴN SÀNG (READY)" : "Confirmed — the chapter is READY"
        )}
        {view.tone === "warning-success" && (
          vi ? "Đã xác nhận (kèm cảnh báo) — chương ở trạng thái SẴN SÀNG (READY)" : "Confirmed (with warnings) — the chapter is READY"
        )}
        {view.tone === "conflict-reload" && (
          vi ? "Xác nhận bị từ chối: đề xuất này không còn là lượt tạo hiện tại" : "Confirm rejected: this proposal is no longer the current generation"
        )}
        {view.tone === "locked" && (
          vi ? "Sách đang bị khóa bởi tác vụ ghi; thử lại sau" : "The book is locked by a write task; retry shortly"
        )}
        {view.tone === "error" && (vi ? "Xác nhận thất bại" : "Confirm failed")}
      </div>
      {(view.tone === "success" || view.tone === "warning-success") && (
        <p className="mt-1.5 text-xs opacity-80">
          {vi
            ? "Giao dịch xác nhận chính thức đã hoàn tất; biên nhận đã được lưu."
            : "The authoritative confirmation transaction has committed; the receipt is saved."}
          {view.resultingCanonRevision ? ` · ${view.resultingCanonRevision}` : ""}
        </p>
      )}
      {view.warnings.map((warning) => (
        <p key={warning} className="mt-1.5 break-words text-xs opacity-90">
          <AlertTriangle size={11} className="mr-1 inline" />
          {warning}
        </p>
      ))}
      {view.message && view.tone !== "success" && view.tone !== "warning-success" && (
        <p className="mt-1.5 break-words text-xs opacity-70">{view.message}</p>
      )}
      {view.tone === "conflict-reload" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={onReload} className="rounded-lg border border-current/30 px-3 py-1.5 text-xs font-bold">
            {vi ? "Tải bản soát lại mới nhất" : "Reload latest review"}
          </button>
          {view.offerRebuildChoice && (
            <button onClick={onRetryAudit} className="rounded-lg border border-current/30 px-3 py-1.5 text-xs font-bold">
              {vi ? "Dựng lại bản soát lại" : "Rebuild State Review"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function OutcomeBanner({ view, vi, onRefetch }: { view: MutationOutcomeView; vi: boolean; onRefetch: () => void }) {
  const styles: Record<string, string> = {
    conflict: "border-amber-500/40 bg-amber-500/5 text-amber-600",
    locked: "border-border/60 bg-secondary/30 text-foreground",
    error: "border-destructive/30 bg-destructive/5 text-destructive",
  };
  return (
    <div role="alert" className={`rounded-2xl border p-4 text-sm ${styles[view.tone] ?? styles.error}`}>
      <div className="flex items-start gap-2">
        {view.tone === "locked" ? <Lock size={15} className="mt-0.5 shrink-0" /> : <AlertTriangle size={15} className="mt-0.5 shrink-0" />}
        <div className="min-w-0">
          {view.tone === "conflict" && (
            <p className="font-medium">
              {vi
                ? "Thao tác bị từ chối: bản soát lại đã được thao tác khác cập nhật. Đã tải phiên bản mới nhất; hãy đánh giá lại trên nội dung mới rồi thử lại."
                : "Rejected: the state review changed elsewhere. The latest version has been loaded — reassess before retrying. Nothing was overwritten."}
            </p>
          )}
          {view.tone === "locked" && (
            <p className="font-medium">
              {vi ? "Sách đang bị khóa bởi tác vụ ghi, có thể thử lại sau; đây không phải mất dữ liệu." : "The book is locked by a write task. You can retry shortly — this is not data loss."}
            </p>
          )}
          {view.tone === "error" && <p className="break-words">{view.message}</p>}
          {view.message && view.tone !== "error" && (
            <p className="mt-1 break-words text-xs opacity-70">{view.message}</p>
          )}
          {view.refetchLatest && (
            <button onClick={onRefetch} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-current/30 px-3 py-1.5 text-xs font-bold">
              <RefreshCw size={12} />
              {vi ? "Đã tải bản soát lại mới nhất" : "Reloaded latest review"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ShellPanel({ tone, icon, title, body, children }: {
  tone: "amber";
  icon: React.ReactNode;
  title: string;
  body: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-2xl border p-6 ${tone === "amber" ? "border-amber-500/40 bg-amber-500/5" : ""}`} role="status">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-600">
        {icon}
        {title}
      </div>
      <div className="mt-2">{body}</div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function ReadOnlyReview({ review, vi }: { review: ActiveStateReviewArtifact; vi: boolean }) {
  const groups = groupReviewItems(review.items);
  return (
    <section className="rounded-2xl border border-border/50 bg-card/40 p-4 opacity-75">
      <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
        {vi ? "Đề xuất lỗi thời (chỉ đọc)" : "Stale proposal (read-only)"}
      </h2>
      <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
        {groups.flatMap((group) =>
          group.items.map((item) => (
            <li key={item.id}>
              <ChevronUp size={10} className="mr-1 inline" />
              <span className="mr-1.5 rounded bg-secondary/60 px-1.5 py-0.5 text-[10px] font-bold uppercase">{reviewKindLabel(item.kind, vi ? "vi" : "en")}</span>
              {describeProposalChange(item.proposal, vi ? "vi" : "en")}
            </li>
          )),
        )}
        {review.items.length === 0 && <li>{vi ? "(đề xuất trống)" : "(empty proposal)"}</li>}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Edit-form helpers (structured fields only; Core validates authoritatively)
// ---------------------------------------------------------------------------

type ProposalChangeLike = ReviewItem["proposal"];

function fillDraftFields(fields: DraftFields, change: ProposalChangeLike): void {
  switch (change.type) {
    case "fact":
      fields.subject = change.change.subject;
      fields.predicate = change.change.predicate;
      fields.object = change.change.object ?? "";
      break;
    case "hook-op":
      fields.hookId = change.hookId;
      break;
    case "new-hook-candidate":
      fields.type = change.candidate.type;
      fields.expectedPayoff = change.candidate.expectedPayoff;
      fields.notes = change.candidate.notes;
      break;
    case "chapter-summary":
      for (const [key, value] of Object.entries(change.row)) {
        fields[key] = String(value ?? "");
      }
      break;
    default:
      break;
  }
}

function editFieldsFor(kind: ReviewItem["kind"]): ReadonlyArray<{ key: string; vi: string; en: string }> {
  switch (kind) {
    case "current-state-fact":
      return [
        { key: "subject", vi: "Chủ thể", en: "Subject" },
        { key: "predicate", vi: "Vị từ", en: "Predicate" },
        { key: "object", vi: "Giá trị", en: "Value" },
      ];
    case "hook-mention":
    case "hook-resolve":
    case "hook-defer":
      // The op is pinned by the item kind (frozen KIND_CHANGE_COMPAT); only
      // the target hook id is editable here.
      return [{ key: "hookId", vi: "ID tiền để", en: "Hook ID" }];
    case "new-hook-candidate":
      return [
        { key: "type", vi: "Kiểu", en: "Type" },
        { key: "expectedPayoff", vi: "Thu hồi dự kiến", en: "Expected payoff" },
        { key: "notes", vi: "Ghi chú", en: "Notes" },
      ];
    case "chapter-summary":
      return [
        { key: "title", vi: "Tiêu đề", en: "Title" },
        { key: "characters", vi: "Nhân vật", en: "Characters" },
        { key: "events", vi: "Sự kiện", en: "Events" },
        { key: "stateChanges", vi: "Thay đổi trạng thái", en: "State changes" },
        { key: "mood", vi: "Bầu không khí", en: "Mood" },
      ];
    default:
      // hook-upsert records and notes have no field-level editor in V1.
      return [];
  }
}

function buildEditedChange(kind: ReviewItem["kind"], draft: DraftFields): unknown {
  const trim = (key: string) => (draft[key] ?? "").trim();
  switch (kind) {
    case "current-state-fact":
      return {
        type: "fact",
        change: { action: "set", subject: trim("subject"), predicate: trim("predicate"), object: trim("object") },
      };
    case "hook-mention":
    case "hook-resolve":
    case "hook-defer":
      // Op is pinned to the item kind (frozen compat): mention/resolve/defer.
      return { type: "hook-op", op: kind.replace("hook-", "") as "mention" | "resolve" | "defer", hookId: trim("hookId") };
    case "new-hook-candidate":
      return {
        type: "new-hook-candidate",
        candidate: {
          type: trim("type"),
          expectedPayoff: trim("expectedPayoff"),
          notes: trim("notes"),
        },
      };
    case "chapter-summary":
      return {
        type: "chapter-summary",
        row: {
          chapter: Number.parseInt(draft.chapter ?? "", 10) || 1,
          title: trim("title"),
          characters: trim("characters"),
          events: trim("events"),
          stateChanges: trim("stateChanges"),
          hookActivity: trim("hookActivity"),
          mood: trim("mood"),
          chapterType: trim("chapterType"),
        },
      };
    default:
      // Notes and full hook records have no edit path in V1 (frozen compat:
      // a note's only legal payload is {type:"none"}).
      return { type: "none" };
  }
}

function userTitleFor(draft: UserDraft, vi: boolean): string {
  switch (draft.kind) {
    case "current-state-fact":
      return vi ? "Sự kiện trạng thái thêm thủ công" : "User-added state fact";
    case "note":
      // The note text IS the title (its change payload is frozen to none).
      return draft.fields.text?.trim() || (vi ? "Ghi chú thêm thủ công" : "User-added note");
    default:
      return vi
        ? `Thao tác tiền để thêm thủ công (${draft.kind.replace("hook-", "")})`
        : `User-added hook ${draft.kind.replace("hook-", "")}`;
  }
}
