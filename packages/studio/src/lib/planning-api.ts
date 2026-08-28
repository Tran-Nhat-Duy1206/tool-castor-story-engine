/**
 * Typed client for the Planning V2 HTTP boundary.
 * Mirrors foundation-api.ts / state-review-api.ts conventions.
 * Each function does fetch to /api/v1/books/:id/planning/... with correct
 * method, JSON, and ApiError handling, invalidateApiPaths on mutations.
 */
import { invalidateApiPaths } from "../hooks/use-api";

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

function planningBase(bookId: string): string {
  assertValidBookId(bookId);
  return `/api/v1/books/${encodeURIComponent(bookId)}/planning`;
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

function invalidatePlanning(bookId: string): void {
  try {
    invalidateApiPaths([planningBase(bookId)]);
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// DTOs (loose, Core-owned shapes erased at build)
// ---------------------------------------------------------------------------

export interface ArcPlanDto { readonly arcId?: string; readonly goal?: string; readonly status?: string; readonly isProduction?: boolean; readonly version?: number; readonly [k: string]: unknown; }
export interface ArcDraftDto { readonly draftId: string; readonly status?: string; readonly [k: string]: unknown; }
export interface ArcPreflightDto { readonly ready?: boolean; readonly pass?: boolean; readonly issues?: unknown[]; readonly [k: string]: unknown; }
export interface BeatsDto { readonly beats?: ReadonlyArray<unknown>; readonly required?: ReadonlyArray<unknown>; readonly optional?: ReadonlyArray<unknown>; readonly [k: string]: unknown; }
export interface LookaheadDto { readonly advisory?: boolean; readonly status?: string; readonly stale?: boolean; readonly current?: boolean; readonly superseded?: boolean; readonly consumed?: boolean; readonly items?: ReadonlyArray<unknown>; readonly [k: string]: unknown; }
export interface DetailedPlanDto { readonly planId?: string; readonly chapter?: number; readonly intent?: unknown; readonly memo?: unknown; readonly bases?: unknown; readonly refs?: unknown; readonly status?: string; readonly gateReport?: unknown; readonly [k: string]: unknown; }
export interface GateReportDto { readonly verdict: string; readonly outcome?: string; readonly canWrite?: boolean; readonly requiresAuthorization?: boolean; readonly concerns?: unknown[]; readonly missing?: unknown[]; readonly evidence?: unknown[]; readonly [k: string]: unknown; }
export interface DirectionDto { readonly directionId: string; readonly status: string; readonly text?: string; readonly pending?: boolean; readonly active?: boolean; readonly isAuthority?: boolean; readonly [k: string]: unknown; }
export interface AuthorizationDto { readonly authorizationId?: string; readonly id?: string; readonly status: string; readonly lifecycle?: string; readonly kind?: string; readonly [k: string]: unknown; }

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getPublishedArc(
  bookId: string,
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<ArcPlanDto> {
  const path = `${planningBase(bookId)}/arc`;
  const { res, body } = await requestJson(path, { method: "GET" }, deps);
  if (!res.ok) throw toApiError(res, body, "Failed to load published arc.");
  return body as unknown as ArcPlanDto;
}

export async function getArcDrafts(
  bookId: string,
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<{ drafts: ArcDraftDto[] } & Record<string, unknown>> {
  const path = `${planningBase(bookId)}/arc/drafts`;
  const { res, body } = await requestJson(path, { method: "GET" }, deps);
  if (!res.ok) throw toApiError(res, body, "Failed to load arc drafts.");
  if (Array.isArray(body)) return { drafts: body as ArcDraftDto[] } as unknown as { drafts: ArcDraftDto[] } & Record<string, unknown>;
  if (Array.isArray((body as { drafts?: unknown }).drafts)) return body as unknown as { drafts: ArcDraftDto[] } & Record<string, unknown>;
  if (Array.isArray((body as { items?: unknown }).items)) return { drafts: (body as { items: ArcDraftDto[] }).items } as unknown as { drafts: ArcDraftDto[] } & Record<string, unknown>;
  return body as unknown as { drafts: ArcDraftDto[] } & Record<string, unknown>;
}

export async function createArcDraft(
  bookId: string,
  payload: Record<string, unknown> = {},
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<ArcDraftDto> {
  const path = `${planningBase(bookId)}/arc/drafts`;
  const { res, body } = await requestJson(path, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(payload) }, deps);
  if (!res.ok) throw toApiError(res, body, "Failed to create arc draft.");
  invalidatePlanning(bookId);
  return body as unknown as ArcDraftDto;
}

export async function getArcPreflight(
  bookId: string,
  draftId?: string,
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<ArcPreflightDto> {
  const base = `${planningBase(bookId)}/arc/preflight`;
  const path = draftId ? `${base}/${encodeURIComponent(draftId)}` : base;
  const { res, body } = await requestJson(path, { method: "GET" }, deps);
  if (!res.ok) throw toApiError(res, body, "Failed to load arc preflight.");
  return body as unknown as ArcPreflightDto;
}

export async function publishArc(
  bookId: string,
  payload: { draftId: string; humanActor?: string; expectedRevision?: unknown; expectedFoundationVersion?: unknown; expectedCanonRevision?: unknown; [k: string]: unknown },
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<Record<string, unknown>> {
  if (!payload.draftId) throw new Error("publishArc requires draftId");
  const path = `${planningBase(bookId)}/arc/publish`;
  const bodyPayload = { humanActor: "human", ...payload };
  const { res, body } = await requestJson(path, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(bodyPayload) }, deps);
  if (!res.ok) throw toApiError(res, body, "Failed to publish arc.");
  invalidatePlanning(bookId);
  try { invalidateApiPaths([`/api/v1/books/${bookId}`]); } catch { /* ignore */ }
  return body as Record<string, unknown>;
}

export async function getBeats(
  bookId: string,
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<BeatsDto> {
  const path = `${planningBase(bookId)}/beats`;
  const { res, body } = await requestJson(path, { method: "GET" }, deps);
  if (!res.ok) throw toApiError(res, body, "Failed to load beats.");
  return body as unknown as BeatsDto;
}

export async function getLookahead(
  bookId: string,
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<LookaheadDto> {
  const path = `${planningBase(bookId)}/lookahead`;
  const { res, body } = await requestJson(path, { method: "GET" }, deps);
  if (!res.ok) throw toApiError(res, body, "Failed to load lookahead.");
  return body as unknown as LookaheadDto;
}

export async function getDetailedPlan(
  bookId: string,
  chapter?: number,
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<DetailedPlanDto> {
  const base = `${planningBase(bookId)}/detailed-plan`;
  const path = typeof chapter === "number" ? `${base}/${chapter}` : base;
  const { res, body } = await requestJson(path, { method: "GET" }, deps);
  if (!res.ok) throw toApiError(res, body, "Failed to load detailed plan.");
  return body as unknown as DetailedPlanDto;
}

export async function getGateReport(
  bookId: string,
  chapter?: number,
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<GateReportDto> {
  const base = `${planningBase(bookId)}/gate`;
  const path = typeof chapter === "number" ? `${base}/${chapter}` : base;
  const { res, body } = await requestJson(path, { method: "GET" }, deps);
  if (!res.ok) throw toApiError(res, body, "Failed to load gate report.");
  // normalize outcome -> verdict
  const obj = body as Record<string, unknown>;
  if (obj && typeof obj.outcome === "string" && !obj.verdict) {
    const map: Record<string, string> = { safe: "SAFE", uncertain: "UNCERTAIN", author_decision: "AUTHOR_DECISION", conflict: "CONFLICT" };
    (obj as Record<string, unknown>).verdict = map[String(obj.outcome).toLowerCase()] ?? obj.outcome;
  }
  return obj as unknown as GateReportDto;
}

export async function parseDirection(
  bookId: string,
  payload: { text: string; [k: string]: unknown },
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<DirectionDto> {
  if (!payload.text || !String(payload.text).trim()) throw new Error("parseDirection requires text");
  const path = `${planningBase(bookId)}/directions/parse`;
  const { res, body } = await requestJson(path, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(payload) }, deps);
  if (!res.ok) throw toApiError(res, body, "Failed to parse direction.");
  invalidatePlanning(bookId);
  return body as unknown as DirectionDto;
}

export async function getPendingDirections(
  bookId: string,
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<{ items: DirectionDto[] } & Record<string, unknown>> {
  const path = `${planningBase(bookId)}/directions`;
  const { res, body } = await requestJson(path, { method: "GET" }, deps);
  if (!res.ok) throw toApiError(res, body, "Failed to load pending directions.");
  if (Array.isArray(body)) return { items: body as DirectionDto[] } as unknown as { items: DirectionDto[] } & Record<string, unknown>;
  if (Array.isArray((body as { items?: unknown }).items)) return body as unknown as { items: DirectionDto[] } & Record<string, unknown>;
  if (Array.isArray((body as { directions?: unknown }).directions)) return { items: (body as { directions: DirectionDto[] }).directions } as unknown as { items: DirectionDto[] } & Record<string, unknown>;
  return body as unknown as { items: DirectionDto[] } & Record<string, unknown>;
}

export async function confirmDirection(
  bookId: string,
  directionId: string,
  payload: { humanActor?: string; [k: string]: unknown } = {},
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<DirectionDto> {
  if (!directionId || /[/\\]/.test(directionId)) throw new Error(`Invalid directionId: "${directionId}"`);
  const path = `${planningBase(bookId)}/directions/${encodeURIComponent(directionId)}/confirm`;
  const bodyPayload = { humanActor: "human", ...payload };
  const { res, body } = await requestJson(path, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(bodyPayload) }, deps);
  if (!res.ok) throw toApiError(res, body, "Failed to confirm direction.");
  invalidatePlanning(bookId);
  return body as unknown as DirectionDto;
}

export async function resolveDirectionConflict(
  bookId: string,
  payload: { directionId?: string; resolution: string; strategy?: string; [k: string]: unknown },
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<Record<string, unknown>> {
  const path = `${planningBase(bookId)}/directions/conflict/resolve`;
  const { res, body } = await requestJson(path, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(payload) }, deps);
  if (!res.ok) throw toApiError(res, body, "Failed to resolve direction conflict.");
  invalidatePlanning(bookId);
  return body as Record<string, unknown>;
}

export async function createAuthorization(
  bookId: string,
  payload: Record<string, unknown>,
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<AuthorizationDto> {
  const path = `${planningBase(bookId)}/authorizations`;
  const { res, body } = await requestJson(path, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(payload) }, deps);
  if (!res.ok) throw toApiError(res, body, "Failed to create authorization.");
  invalidatePlanning(bookId);
  return body as unknown as AuthorizationDto;
}

export async function confirmAuthorization(
  bookId: string,
  authorizationId: string,
  payload: { humanActor?: string; [k: string]: unknown } = {},
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<AuthorizationDto> {
  if (!authorizationId || /[/\\]/.test(authorizationId)) throw new Error(`Invalid authorizationId: "${authorizationId}"`);
  const path = `${planningBase(bookId)}/authorizations/${encodeURIComponent(authorizationId)}/confirm`;
  const bodyPayload = { humanActor: "human", ...payload };
  const { res, body } = await requestJson(path, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(bodyPayload) }, deps);
  if (!res.ok) throw toApiError(res, body, "Failed to confirm authorization.");
  invalidatePlanning(bookId);
  return body as unknown as AuthorizationDto;
}

export async function listAuthorizations(
  bookId: string,
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<{ items: AuthorizationDto[] } & Record<string, unknown>> {
  const path = `${planningBase(bookId)}/authorizations`;
  const { res, body } = await requestJson(path, { method: "GET" }, deps);
  if (!res.ok) throw toApiError(res, body, "Failed to list authorizations.");
  if (Array.isArray(body)) return { items: body as AuthorizationDto[] } as unknown as { items: AuthorizationDto[] } & Record<string, unknown>;
  if (Array.isArray((body as { items?: unknown }).items)) return body as unknown as { items: AuthorizationDto[] } & Record<string, unknown>;
  return body as unknown as { items: AuthorizationDto[] } & Record<string, unknown>;
}

export async function writeChapter(
  bookId: string,
  payload: Record<string, unknown> = {},
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<Record<string, unknown>> {
  const path = `${planningBase(bookId)}/write`;
  const { res, body } = await requestJson(path, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(payload) }, deps);
  if (!res.ok) throw toApiError(res, body, "Failed to write chapter.");
  invalidatePlanning(bookId);
  try { invalidateApiPaths([`/api/v1/books/${bookId}`]); } catch { /* ignore */ }
  return body as Record<string, unknown>;
}

export async function regeneratePlan(
  bookId: string,
  payload: Record<string, unknown> = {},
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<Record<string, unknown>> {
  const path = `${planningBase(bookId)}/detailed-plan/regenerate`;
  const { res, body } = await requestJson(path, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(payload) }, deps);
  if (!res.ok) throw toApiError(res, body, "Failed to regenerate plan.");
  invalidatePlanning(bookId);
  return body as Record<string, unknown>;
}
