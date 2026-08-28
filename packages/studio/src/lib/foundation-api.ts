/**
 * Typed client for the Foundation V2 HTTP boundary.
 * Mirrors lib/state-review-api.ts and lib/canon-api.ts conventions.
 * Each function does fetch to /api/v1/books/:id/foundation/... with correct
 * method, JSON body, and error handling (throw ApiError on non-ok).
 */
import { invalidateApiPaths } from "../hooks/use-api";

// Local DTO types — mirror Core shapes without pulling runtime (erased at build)
export type FoundationUnitManifest = {
  readonly unitId: string;
  readonly status: string;
  readonly kind: string;
  readonly importance: string;
  readonly contentHash: string;
  readonly contentRevision: number;
  readonly approvedRevision?: number;
  readonly dependencies: ReadonlyArray<{ targetUnitId: string; kind: string }>;
  readonly locator: { sourceRelPath: string; contentKind: string; [k: string]: unknown };
  readonly [k: string]: unknown;
};
export type FoundationRevisionDraft = {
  readonly revisionId: string;
  readonly status: string;
  readonly baseFoundationVersion: number | null;
  readonly baseCanonRevision: number;
  readonly unitStates: ReadonlyArray<{ unitId: string; state: string; contentRevision: number; contentHash: string; approvedRevision?: number }>;
  readonly approvalRecords: ReadonlyArray<unknown>;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly [k: string]: unknown;
};
export type ReadinessReport = {
  readonly blockingReasons: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
  readonly nextRecommendedAction: string | null;
  readonly [k: string]: unknown;
};
export type FoundationVersion = unknown;

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    if (code) this.code = code;
  }
}

function assertValidBookId(bookId: string): void {
  if (!bookId || /[/\\]|\.\./.test(bookId)) {
    throw new Error(`Invalid book id: "${bookId}"`);
  }
}

function foundationBase(bookId: string): string {
  assertValidBookId(bookId);
  return `/api/v1/books/${encodeURIComponent(bookId)}/foundation`;
}

async function readBody(res: Response): Promise<Record<string, unknown>> {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try { return (await res.json()) as Record<string, unknown>; } catch { return {}; }
  }
  try { const text = await res.text(); return text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { return {}; }
}

async function requestJson(
  path: string,
  init: RequestInit,
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<{ res: Response; body: Record<string, unknown> }> {
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const res = await fetchImpl(path, init);
  const body = await readBody(res);
  return { res, body };
}

function toApiError(res: Response, body: Record<string, unknown>, fallback: string): ApiError {
  const message = typeof body.error === "string" && body.error.trim() ? body.error : fallback;
  const code = typeof body.code === "string" ? body.code : undefined;
  return new ApiError(message, res.status, code);
}

const JSON_HEADERS = { "content-type": "application/json" };

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface FoundationOverviewDto {
  readonly bookId: string;
  readonly governance?: { foundation: string; planning: string };
  readonly manifests?: ReadonlyArray<FoundationUnitManifest>;
  readonly readiness?: ReadinessReport;
  readonly version?: number | null;
  readonly [key: string]: unknown;
}

export interface UnitManifestsDto {
  readonly manifests: ReadonlyArray<FoundationUnitManifest>;
  readonly bookId?: string;
}

export interface ReadinessDto extends ReadinessReport { }

export interface OpenRevisionPayload {
  readonly unitIds: ReadonlyArray<string>;
}

export interface OpenRevisionResult {
  readonly revisionId: string;
  readonly [key: string]: unknown;
}

export interface SaveRevisionPayload {
  readonly content: string;
  readonly expectedRevision?: number | string;
}

export interface ApprovePayload {
  readonly expectedRevision: number | string;
  readonly humanActor?: string;
}

export interface NeedsRevisionPayload {
  readonly reason: string;
}

export interface ReapprovePayload {
  readonly expectedRevision: number | string;
  readonly resolutionId?: string;
  readonly humanActor?: string;
}

export interface BatchApprovePayload {
  readonly unitIds: ReadonlyArray<string>;
  readonly humanActor?: string;
  readonly expectedRevisions?: Record<string, number>;
}

export interface BatchApproveResult {
  readonly approved: ReadonlyArray<string>;
  readonly rejected: ReadonlyArray<{ unitId: string; reason: string }>;
}

export interface VersionsDto {
  readonly versions: ReadonlyArray<number>;
  readonly currentVersion?: number | null;
}

export interface PublishPayload {
  readonly revisionId: string;
  readonly expectedBaseFoundationVersion: number;
  readonly expectedBaseCanonRevision: number;
  readonly humanActor?: string;
}

export type PublishResult =
  | { readonly status: "published"; readonly version: number; readonly [key: string]: unknown }
  | { readonly status: "revision_base_stale"; readonly [key: string]: unknown }
  | { readonly status: "external_change_detected"; readonly [key: string]: unknown }
  | { readonly status: string; readonly [key: string]: unknown };

// ---------------------------------------------------------------------------
// Helpers: invalidate foundation paths after mutations
// ---------------------------------------------------------------------------
function invalidateFoundation(bookId: string): void {
  try {
    invalidateApiPaths([foundationBase(bookId), `${foundationBase(bookId)}/manifests`, `${foundationBase(bookId)}/readiness`]);
  } catch { /* ignore if not in browser */ }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getFoundationOverview(
  bookId: string,
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<FoundationOverviewDto> {
  const { res, body } = await requestJson(foundationBase(bookId), { method: "GET" }, deps);
  if (!res.ok) throw toApiError(res, body, "Failed to load foundation overview.");
  return body as unknown as FoundationOverviewDto;
}

export async function getUnitManifests(
  bookId: string,
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<UnitManifestsDto> {
  const path = `${foundationBase(bookId)}/manifests`;
  const { res, body } = await requestJson(path, { method: "GET" }, deps);
  if (!res.ok) throw toApiError(res, body, "Failed to load unit manifests.");
  if (Array.isArray(body)) return { manifests: body as unknown as FoundationUnitManifest[] };
  if (Array.isArray((body as { manifests?: unknown }).manifests)) return body as unknown as UnitManifestsDto;
  return body as unknown as UnitManifestsDto;
}

export async function getReadiness(
  bookId: string,
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<ReadinessDto> {
  const path = `${foundationBase(bookId)}/readiness`;
  const { res, body } = await requestJson(path, { method: "GET" }, deps);
  if (!res.ok) throw toApiError(res, body, "Failed to load readiness.");
  return body as unknown as ReadinessDto;
}

export async function getVersions(
  bookId: string,
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<VersionsDto> {
  const path = `${foundationBase(bookId)}/versions`;
  const { res, body } = await requestJson(path, { method: "GET" }, deps);
  if (!res.ok) {
    // Fallback: some deployments expose versions via overview; treat 404 as empty
    if (res.status === 404) return { versions: [] };
    throw toApiError(res, body, "Failed to load versions.");
  }
  if (Array.isArray((body as { versions?: unknown }).versions)) return body as unknown as VersionsDto;
  if (Array.isArray(body)) return { versions: body as unknown as number[] };
  return body as unknown as VersionsDto;
}

// ---------------------------------------------------------------------------
// Revision workspace
// ---------------------------------------------------------------------------

export async function openRevision(
  bookId: string,
  payload: OpenRevisionPayload,
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<OpenRevisionResult> {
  const path = `${foundationBase(bookId)}/revisions`;
  const { res, body } = await requestJson(path, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(payload) }, deps);
  if (!res.ok) throw toApiError(res, body, "Failed to open revision.");
  invalidateFoundation(bookId);
  return body as unknown as OpenRevisionResult;
}

export async function loadRevision(
  bookId: string,
  revisionId: string,
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<FoundationRevisionDraft> {
  if (!revisionId || /[/\\]/.test(revisionId)) throw new Error(`Invalid revisionId: "${revisionId}"`);
  const path = `${foundationBase(bookId)}/revisions/${encodeURIComponent(revisionId)}`;
  const { res, body } = await requestJson(path, { method: "GET" }, deps);
  if (!res.ok) throw toApiError(res, body, "Failed to load revision.");
  return body as unknown as FoundationRevisionDraft;
}

export async function saveRevision(
  bookId: string,
  revisionId: string,
  unitId: string,
  payload: SaveRevisionPayload,
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<unknown> {
  if (!revisionId || /[/\\]/.test(revisionId)) throw new Error(`Invalid revisionId: "${revisionId}"`);
  if (!unitId || /[/\\]/.test(unitId)) throw new Error(`Invalid unitId: "${unitId}"`);
  const path = `${foundationBase(bookId)}/revisions/${encodeURIComponent(revisionId)}/units/${encodeURIComponent(unitId)}`;
  const { res, body } = await requestJson(path, { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(payload) }, deps);
  if (!res.ok) throw toApiError(res, body, "Failed to save revision.");
  return body;
}

export async function approveUnit(
  bookId: string,
  revisionId: string,
  unitId: string,
  payload: ApprovePayload,
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<unknown> {
  if (!revisionId || /[/\\]/.test(revisionId)) throw new Error(`Invalid revisionId: "${revisionId}"`);
  const path = `${foundationBase(bookId)}/revisions/${encodeURIComponent(revisionId)}/units/${encodeURIComponent(unitId)}/approve`;
  const { res, body } = await requestJson(path, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(payload) }, deps);
  if (!res.ok) throw toApiError(res, body, "Failed to approve unit.");
  invalidateFoundation(bookId);
  return body;
}

export async function needsRevision(
  bookId: string,
  revisionId: string,
  unitId: string,
  payload: NeedsRevisionPayload,
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<unknown> {
  if (!revisionId || /[/\\]/.test(revisionId)) throw new Error(`Invalid revisionId: "${revisionId}"`);
  const path = `${foundationBase(bookId)}/revisions/${encodeURIComponent(revisionId)}/units/${encodeURIComponent(unitId)}/needs-revision`;
  const { res, body } = await requestJson(path, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(payload) }, deps);
  if (!res.ok) throw toApiError(res, body, "Failed to mark needs-revision.");
  invalidateFoundation(bookId);
  return body;
}

export async function reapproveStale(
  bookId: string,
  revisionId: string,
  unitId: string,
  payload: ReapprovePayload,
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<unknown> {
  if (!revisionId || /[/\\]/.test(revisionId)) throw new Error(`Invalid revisionId: "${revisionId}"`);
  const path = `${foundationBase(bookId)}/revisions/${encodeURIComponent(revisionId)}/units/${encodeURIComponent(unitId)}/reapprove-stale`;
  const { res, body } = await requestJson(path, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(payload) }, deps);
  if (!res.ok) throw toApiError(res, body, "Failed to reapprove stale unit.");
  invalidateFoundation(bookId);
  return body;
}

export async function discardRevision(
  bookId: string,
  revisionId: string,
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<unknown> {
  const path = `${foundationBase(bookId)}/revisions/${encodeURIComponent(revisionId)}`;
  const { res, body } = await requestJson(path, { method: "DELETE" }, deps);
  if (!res.ok) throw toApiError(res, body, "Failed to discard revision.");
  invalidateFoundation(bookId);
  return body;
}

export async function batchApprove(
  bookId: string,
  revisionId: string,
  payload: BatchApprovePayload,
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<BatchApproveResult> {
  if (!revisionId || /[/\\]/.test(revisionId)) throw new Error(`Invalid revisionId: "${revisionId}"`);
  const path = `${foundationBase(bookId)}/batch-approve`;
  const bodyPayload = { ...payload, revisionId } as Record<string, unknown>;
  const { res, body } = await requestJson(path, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(bodyPayload) }, deps);
  if (!res.ok) throw toApiError(res, body, "Failed to batch approve.");
  invalidateFoundation(bookId);
  return body as unknown as BatchApproveResult;
}

export async function publishFoundation(
  bookId: string,
  payload: PublishPayload,
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<PublishResult> {
  const path = `${foundationBase(bookId)}/publish`;
  const { res, body } = await requestJson(path, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(payload) }, deps);
  if (!res.ok) throw toApiError(res, body, "Failed to publish foundation.");
  invalidateFoundation(bookId);
  try { invalidateApiPaths([`/api/v1/books/${bookId}`]); } catch { /* ignore */ }
  return body as unknown as PublishResult;
}

// Back-compat aliases matching task naming
export const getFoundationOverviewAlias = getFoundationOverview;
