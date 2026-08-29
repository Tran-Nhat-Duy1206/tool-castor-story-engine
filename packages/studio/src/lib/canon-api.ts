import { fetchJson } from "../hooks/use-api";

/**
 * Typed client for the read-only canonical Story State boundary
 * (`GET /api/v1/books/:id/canon`). The browser never sees filesystem paths —
 * only book ids — and there is deliberately no mutation method here.
 */

export type CanonSection = "manifest" | "current_state" | "hooks" | "chapter_summaries";

export const CANON_SECTION_VALUES: ReadonlyArray<CanonSection> = [
  "manifest",
  "current_state",
  "hooks",
  "chapter_summaries",
];

export interface StateManifestDto {
  schemaVersion: number;
  language: string;
  lastAppliedChapter: number;
  projectionVersion: number;
  migrationWarnings: string[];
}

export interface CurrentStateFactDto {
  subject: string;
  predicate: string;
  object: string;
  validFromChapter: number;
  validUntilChapter: number | null;
  sourceChapter: number;
}

export interface CurrentStateStateDto {
  chapter: number;
  facts: CurrentStateFactDto[];
}

export type HookStatusDto = "open" | "progressing" | "deferred" | "resolved";

export interface HookRecordDto {
  hookId: string;
  startChapter: number;
  type: string;
  status: HookStatusDto;
  lastAdvancedChapter: number;
  expectedPayoff?: string;
  payoffTiming?: string;
  notes?: string;
  dependsOn?: string[];
  paysOffInArc?: string;
  coreHook?: boolean;
  halfLifeChapters?: number;
  advancedCount?: number;
  promoted?: boolean;
}

export interface HooksStateDto {
  hooks: HookRecordDto[];
}

export interface ChapterSummaryRowDto {
  chapter: number;
  title: string;
  characters: string;
  events: string;
  stateChanges: string;
  hookActivity: string;
  mood: string;
  chapterType: string;
}

export interface ChapterSummariesStateDto {
  rows: ChapterSummaryRowDto[];
}

/** Core-computed slot view (mirrors `describeCurrentState` output). */
export interface CurrentStateSlotViewDto {
  key: string;
  label: string;
  value: string | null;
  selected: CurrentStateFactDto | null;
  superseded: CurrentStateFactDto[];
}

export interface CurrentStateDescriptionDto {
  chapter: number;
  slots: CurrentStateSlotViewDto[];
  additionalFacts: CurrentStateFactDto[];
}

/** Shape of `GET /api/v1/books/:id/canon` (no section). */
export interface StoryCanonViewDto {
  bookId: string;
  manifest: StateManifestDto;
  currentState: CurrentStateStateDto;
  hooks: HooksStateDto;
  chapterSummaries: ChapterSummariesStateDto;
  /**
   * Core revision fingerprint (T3B.1): the client retains THIS value while
   * editing and sends it back as `expectedRevision` on save.
   */
  revision?: string;
  /** Display projection of currentState computed by Core; raw fields above remain authoritative. */
  description: CurrentStateDescriptionDto;
}

/** Shape of `GET /api/v1/books/:id/canon?section=…`. */
export interface StoryCanonSectionDto<TData = unknown> {
  bookId: string;
  section: CanonSection;
  data: TData;
}

export function buildCanonUrl(bookId: string, section?: CanonSection): string {
  assertValidBookId(bookId);
  const base = `/api/v1/books/${encodeURIComponent(bookId)}/canon`;
  return section ? `${base}?section=${section}` : base;
}

function assertValidBookId(bookId: string): void {
  if (!bookId || /[/\\]|\.\./.test(bookId)) {
    // Defense-in-depth: the server's membership check already blocks unknown
    // ids, but the client must never construct path-traversing URLs.
    throw new Error(`Invalid book id: "${bookId}"`);
  }
}

function buildCanonMutationUrl(bookId: string, action: "preview" | "commit"): string {
  assertValidBookId(bookId);
  return `/api/v1/books/${encodeURIComponent(bookId)}/canon/current-state/${action}`;
}

export function fetchCanon(
  bookId: string,
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<StoryCanonViewDto> {
  return fetchJson<StoryCanonViewDto>(buildCanonUrl(bookId), {}, deps);
}

export function fetchCanonSection<TData = unknown>(
  bookId: string,
  section: CanonSection,
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<StoryCanonSectionDto<TData>> {
  return fetchJson<StoryCanonSectionDto<TData>>(buildCanonUrl(bookId, section), {}, deps);
}

// --- Manual canon editing (T3B mutation boundary) ---
//
// SEMANTIC CONTRACT: Core-owned. `packages/core/src/models/canon-edits.ts`
// is the single source of truth for setFact/removeFact and the commit
// request envelope; the types below are TYPE-ONLY derivations from it
// (review I-1) so any Core change surfaces as a compile error here instead
// of drifting silently on the wire. `import type` is erased at build time —
// the browser bundle never pulls in @actalk/castor-core.
// Response/transport DTOs above remain deliberately Studio-owned.

import type { CanonCommitRequest, CanonEdit } from "@actalk/castor-core";

export type CanonSetFactEdit = Extract<CanonEdit, { kind: "setFact" }>;

export type CanonRemoveFactEdit = Extract<CanonEdit, { kind: "removeFact" }>;

export type CanonEditPayload = CanonEdit;

/** POST body for the commit route — Core's envelope itself, not a copy. */
export type CanonCommitRequestPayload = CanonCommitRequest;

export interface CanonMutationIssueDto {
  scope?: string;
  code?: string;
  message: string;
}

/**
 * Discriminated outcome for every mutation call. Callers MUST branch on
 * `status` — in particular `canon_conflict` is a first-class state (stale
 * revision), never an exception to be retried blindly.
 */
export type CanonCommitOutcome =
  | {
      status: "success";
      bookId: string;
      revision: string;
      appliedEdits: number;
      effectiveChapter: number;
      warnings: string[];
    }
  | { status: "canon_conflict"; currentRevision?: string; message: string }
  | { status: "canon_unavailable"; issues: CanonMutationIssueDto[]; message: string }
  | { status: "book_write_locked"; message: string }
  | { status: "invalid_request"; issues: CanonMutationIssueDto[]; message: string }
  | { status: "unexpected"; message: string };

export type CanonPreviewOutcome =
  | {
      status: "success";
      effectiveChapter: number;
      revision: string;
      issues: CanonMutationIssueDto[];
      warnings: string[];
    }
  | { status: "canon_unavailable"; issues: CanonMutationIssueDto[]; message: string }
  | { status: "invalid_request"; issues: CanonMutationIssueDto[]; message: string }
  | { status: "unexpected"; message: string };

interface MutationErrorBody {
  error?: string;
  code?: string;
  currentRevision?: string;
  issues?: CanonMutationIssueDto[];
}

async function readBody(res: Response): Promise<MutationErrorBody> {
  try {
    return (await res.json()) as MutationErrorBody;
  } catch {
    return {};
  }
}

async function postCanon(
  bookId: string,
  action: "preview" | "commit",
  payload: unknown,
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<{ res: Response; body: MutationErrorBody }> {
  assertValidBookId(bookId);
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const res = await fetchImpl(buildCanonMutationUrl(bookId, action), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await readBody(res);
  return { res, body };
}

export async function postCanonCommit(
  bookId: string,
  request: CanonCommitRequestPayload,
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<CanonCommitOutcome> {
  let res: Response;
  let body: MutationErrorBody;
  try {
    ({ res, body } = await postCanon(bookId, "commit", request, deps));
  } catch (e) {
    return { status: "unexpected", message: e instanceof Error ? e.message : String(e) };
  }

  if (res.ok) {
    const data = body as unknown as {
      bookId?: string;
      ok?: boolean;
      revision?: string;
      appliedEdits?: number;
      effectiveChapter?: number;
      warnings?: string[];
    };
    if (!data.revision) {
      return { status: "unexpected", message: "Commit response missing revision." };
    }
    return {
      status: "success",
      bookId: data.bookId ?? bookId,
      revision: data.revision,
      appliedEdits: typeof data.appliedEdits === "number" ? data.appliedEdits : 0,
      effectiveChapter: typeof data.effectiveChapter === "number" ? data.effectiveChapter : 0,
      warnings: Array.isArray(data.warnings) ? data.warnings : [],
    };
  }

  switch (body.code) {
    case "canon_conflict":
      return {
        status: "canon_conflict",
        currentRevision: body.currentRevision,
        message: body.error ?? "Canon changed since it was loaded.",
      };
    case "canon_unavailable":
      return {
        status: "canon_unavailable",
        issues: Array.isArray(body.issues) ? body.issues : [],
        message: body.error ?? "Canonical state is unavailable.",
      };
    case "book_write_locked":
      return { status: "book_write_locked", message: body.error ?? "A write task holds the book lock." };
    case "invalid_request":
      return {
        status: "invalid_request",
        issues: Array.isArray(body.issues) ? body.issues : [],
        message: body.error ?? "Invalid canon edit request.",
      };
    default:
      return { status: "unexpected", message: body.error ?? `Unexpected response (${res.status}).` };
  }
}

export async function postCanonPreview(
  bookId: string,
  request: CanonCommitRequestPayload,
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<CanonPreviewOutcome> {
  let res: Response;
  let body: MutationErrorBody;
  try {
    ({ res, body } = await postCanon(bookId, "preview", request, deps));
  } catch (e) {
    return { status: "unexpected", message: e instanceof Error ? e.message : String(e) };
  }

  if (res.ok) {
    const data = body as unknown as {
      effectiveChapter?: number;
      revision?: string;
      issues?: CanonMutationIssueDto[];
      warnings?: string[];
    };
    if (typeof data.effectiveChapter !== "number") {
      return { status: "unexpected", message: "Preview response missing effectiveChapter." };
    }
    return {
      status: "success",
      effectiveChapter: data.effectiveChapter,
      revision: data.revision ?? "",
      issues: Array.isArray(data.issues) ? data.issues : [],
      warnings: Array.isArray(data.warnings) ? data.warnings : [],
    };
  }

  if (body.code === "canon_unavailable") {
    return {
      status: "canon_unavailable",
      issues: Array.isArray(body.issues) ? body.issues : [],
      message: body.error ?? "Canonical state is unavailable.",
    };
  }
  if (body.code === "invalid_request") {
    return {
      status: "invalid_request",
      issues: Array.isArray(body.issues) ? body.issues : [],
      message: body.error ?? "Invalid canon edit request.",
    };
  }
  return { status: "unexpected", message: body.error ?? `Unexpected response (${res.status}).` };
}
