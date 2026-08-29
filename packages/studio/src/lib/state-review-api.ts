/**
 * Task 14 — typed client for the Phase 4 State Review HTTP boundary.
 *
 * SEMANTIC CONTRACT: Core-owned. The artifact/receipt types below are
 * TYPE-ONLY derivations from `@actalk/castor-core` (erased at build time — the
 * browser bundle never pulls in Core). Every mutation returns a discriminated
 * outcome; callers MUST branch on `ok` — `edit_conflict` (stale CAS revision)
 * is a first-class state, never a blind-retry exception.
 *
 * CONFIRM CARRIES THE REVIEWID: the loaded artifact's `reviewId` is the
 * identity binding for Task 12's idempotent transaction. The client therefore
 * exposes `confirmReview(bookId, chapter, reviewId, expectedReviewRevision)`
 * and refuses to send a confirm without one.
 */
import type {
  ActiveStateReviewArtifact,
  ResolvedReviewReceipt,
  StateReviewArtifact,
} from "@actalk/castor-core";

/** Browser-safe type surface for pages/models (erased at build time). */
export type {
  ActiveStateReviewArtifact,
  ProposalChange,
  ResolvedReviewReceipt,
  ReviewItem,
  ReviewItemKind,
  StateReviewArtifact,
} from "@actalk/castor-core";

export type StateReviewViewDto = StateReviewArtifact;

export interface StateReviewViewResponseDto {
  bookId: string;
  chapter: number;
  review: StateReviewArtifact | null;
}

export interface StateReviewReceiptsResponseDto {
  bookId: string;
  chapter: number;
  receipts: ResolvedReviewReceipt[];
}

/** Active-artifact shape returned by every successful mutation. */
export interface StateReviewMutationResultDto {
  ok: true;
  artifact: ActiveStateReviewArtifact;
}

export interface StateReviewConfirmSuccessDto {
  ok: true;
  status: "resolved" | "already_resolved";
  receipt: ResolvedReviewReceipt;
  resultingCanonRevision: string;
  warnings: string[];
}

/** `{ok:false,…}` branch — mirrors the frozen route error mapping. */
export interface StateReviewFailureDto {
  ok: false;
  /** Core `StateReviewErrorCode` when mapped; transport codes otherwise. */
  code?: string;
  itemId?: string;
  message: string;
}

export type StateReviewMutationOutcome =
  | StateReviewMutationResultDto
  | StateReviewFailureDto;

export type StateReviewConfirmOutcome =
  | StateReviewConfirmSuccessDto
  | StateReviewFailureDto;

function stateReviewBase(bookId: string, chapter: number): string {
  assertValidBookId(bookId);
  return `/api/v1/books/${encodeURIComponent(bookId)}/chapters/${chapter}/state-review`;
}

function assertValidBookId(bookId: string): void {
  if (!bookId || /[/\\]|\.\./.test(bookId)) {
    throw new Error(`Invalid book id: "${bookId}"`);
  }
}

async function readResponseBody(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function requestJson(
  path: string,
  init: RequestInit,
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<{ res: Response; body: Record<string, unknown> }> {
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const res = await fetchImpl(path, init);
  const body = await readResponseBody(res);
  return { res, body };
}

function toFailure(body: Record<string, unknown>, fallbackMessage: string): StateReviewFailureDto {
  return {
    ok: false,
    ...(typeof body.code === "string" ? { code: body.code } : {}),
    ...(typeof body.itemId === "string" ? { itemId: body.itemId } : {}),
    message: typeof body.error === "string" ? body.error : fallbackMessage,
  };
}

const JSON_INIT = { headers: { "content-type": "application/json" } };

export async function fetchStateReview(
  bookId: string,
  chapter: number,
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<StateReviewViewResponseDto> {
  return fetchWithStateMapping(
    stateReviewBase(bookId, chapter),
    {},
    deps,
  ) as Promise<StateReviewViewResponseDto>;
}

async function fetchWithStateMapping(
  path: string,
  init: RequestInit,
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<unknown> {
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const res = await fetchImpl(path, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`.trim());
  return res.json();
}

export async function fetchStateReviewReceipts(
  bookId: string,
  chapter: number,
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<StateReviewReceiptsResponseDto> {
  return (await fetchWithStateMapping(
    `${stateReviewBase(bookId, chapter)}/receipts`,
    {},
    deps,
  )) as StateReviewReceiptsResponseDto;
}

export async function postStateReviewDecision(
  bookId: string,
  chapter: number,
  payload: { itemId: string; decision: "accept" | "reject"; expectedReviewRevision: number; overrideExplicitWarning?: boolean },
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<StateReviewMutationOutcome> {
  return mutateStateReview(
    `${stateReviewBase(bookId, chapter)}/decision`,
    payload,
    deps,
  );
}

export async function postStateReviewEdit(
  bookId: string,
  chapter: number,
  payload: { itemId: string; editedChange: unknown; expectedReviewRevision: number },
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<StateReviewMutationOutcome> {
  return mutateStateReview(`${stateReviewBase(bookId, chapter)}/edit`, payload, deps);
}

export async function postStateReviewUserItem(
  bookId: string,
  chapter: number,
  payload: { kind: string; change: unknown; title: string; expectedReviewRevision: number },
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<StateReviewMutationOutcome> {
  return mutateStateReview(`${stateReviewBase(bookId, chapter)}/items`, payload, deps);
}

export async function deleteStateReviewUserItem(
  bookId: string,
  chapter: number,
  itemId: string,
  expectedReviewRevision: number,
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<StateReviewMutationOutcome> {
  let res: Response;
  let body: Record<string, unknown>;
  try {
    ({ res, body } = await requestJson(
      `${stateReviewBase(bookId, chapter)}/items/user/${encodeURIComponent(itemId)}?expectedReviewRevision=${expectedReviewRevision}`,
      { method: "DELETE" },
      deps,
    ));
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  if (!res.ok) return toFailure(body, "Failed to remove the user item.");
  return normalizeArtifactResult(body);
}

export async function postStateReviewRejectAll(
  bookId: string,
  chapter: number,
  payload: { expectedReviewRevision: number; overrideExplicitWarning?: boolean },
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<StateReviewMutationOutcome> {
  return mutateStateReview(`${stateReviewBase(bookId, chapter)}/reject-all`, payload, deps);
}

/**
 * Retry Audit through the public PipelineRunner boundary.
 * `state_review_rebuild_failed` ⇒ the durable shell recorded an analyzer/
 * settler outage; surface the banner instead of retrying blindly.
 */
export async function postStateReviewRebuild(
  bookId: string,
  chapter: number,
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<StateReviewMutationOutcome | StateReviewFailureDto & { ok: false }> {
  return mutateStateReview(`${stateReviewBase(bookId, chapter)}/rebuild`, {}, deps);
}

async function mutateStateReview(
  path: string,
  payload: unknown,
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<StateReviewMutationOutcome> {
  let res: Response;
  let body: Record<string, unknown>;
  try {
    ({ res, body } = await requestJson(path, { ...JSON_INIT, method: "POST", body: JSON.stringify(payload) }, deps));
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  if (!res.ok) return toFailure(body, "The state review operation failed.");
  return normalizeArtifactResult(body);
}

function normalizeArtifactResult(body: Record<string, unknown>): StateReviewMutationResultDto | StateReviewFailureDto {
  const artifact = body.artifact as ActiveStateReviewArtifact | undefined;
  if (!artifact || typeof artifact.reviewRevision !== "number") {
    return { ok: false, message: "State review response missing artifact." };
  }
  return { ok: true, artifact };
}

/**
 * Final Confirm. `reviewId` is REQUIRED and must be the loaded generation's
 * id — it keys both the identity binding and the lost-response retry
 * (`already_resolved`). A missing/blank reviewId throws BEFORE any network
 * activity: the server would reject it with 400 anyway, but the client makes
 * the contract impossible to bypass.
 */
export async function confirmReview(
  bookId: string,
  chapter: number,
  reviewId: string,
  expectedReviewRevision: number,
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<StateReviewConfirmOutcome> {
  if (!reviewId || reviewId.trim() === "") {
    throw new Error("confirmReview requires the reviewId of the loaded generation.");
  }
  let res: Response;
  let body: Record<string, unknown>;
  try {
    ({ res, body } = await requestJson(
      `${stateReviewBase(bookId, chapter)}/confirm`,
      {
        ...JSON_INIT,
        method: "POST",
        body: JSON.stringify({ reviewId, expectedReviewRevision }),
      },
      deps,
    ));
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  if (!res.ok) return toFailure(body, "Final Confirm failed.");
  const status = body.status;
  if (status !== "resolved" && status !== "already_resolved") {
    return { ok: false, message: "Confirm response missing resolution status." };
  }
  const receipt = body.receipt as ResolvedReviewReceipt | undefined;
  if (!receipt || typeof body.resultingCanonRevision !== "string") {
    return { ok: false, message: "Confirm response missing receipt." };
  }
  return {
    ok: true,
    status,
    receipt,
    resultingCanonRevision: body.resultingCanonRevision,
    warnings: Array.isArray(body.warnings) ? (body.warnings as string[]) : [],
  };
}
