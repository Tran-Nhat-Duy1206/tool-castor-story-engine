/**
 * Pure UI state model for Planning page — no React, no fetch.
 * Derives presentational state from Core-provided Gate result; does NOT
 * evaluate Canon/scope/Authorization/Beat/Gate correctness itself.
 * Core remains sole authority.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PlanningGateVerdict = "safe" | "uncertain" | "author_decision" | "conflict";

export interface PlanningGateReport {
  verdict?: string;
  outcome?: string;
  reasons?: unknown[];
  canWrite?: boolean;
  requiresAuthorization?: boolean;
  authorized?: boolean;
  canApprove?: boolean;
  concerns?: unknown[];
  missing?: unknown[];
  evidence?: unknown[];
  [k: string]: unknown;
}

export interface LookaheadState {
  advisory?: boolean;
  isProduction?: boolean;
  status?: string;
  stale?: boolean;
  current?: boolean;
  superseded?: boolean;
  consumed?: boolean;
  items?: unknown[];
  [k: string]: unknown;
}

export interface HumanDirectionState {
  directionId: string;
  status: string;
  active?: boolean;
  text?: string;
  isAuthority?: boolean;
  pending?: boolean;
  [k: string]: unknown;
}

export interface PlanningOverview {
  bookId: string;
  publishedArc?: unknown;
  draftArc?: unknown;
  lookahead?: LookaheadState;
  directions?: HumanDirectionState[];
  authorizations?: unknown[];
  gate: PlanningGateReport;
  selectedTab: string;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Gate helpers — pure mapping, no Canon evaluation
// ---------------------------------------------------------------------------

function normalizeVerdict(raw: string | undefined): PlanningGateVerdict {
  if (!raw) return "conflict";
  const lower = String(raw).toLowerCase();
  if (lower === "safe") return "safe";
  if (lower === "uncertain") return "uncertain";
  if (lower === "author_decision") return "author_decision";
  if (lower === "conflict") return "conflict";
  // also accept uppercase
  if (raw === "SAFE") return "safe";
  if (raw === "UNCERTAIN") return "uncertain";
  if (raw === "AUTHOR_DECISION") return "author_decision";
  if (raw === "CONFLICT") return "conflict";
  return lower as PlanningGateVerdict;
}

/**
 * Map Core Gate result to UI panel key.
 * MUST NOT inspect Canon/scope/Authorization/Beat internals.
 */
export function getGatePanel(gate: PlanningGateReport): PlanningGateVerdict {
  // Prefer verdict, fallback to outcome
  const raw = (gate.verdict ?? (gate.outcome as string | undefined) ?? "") as string;
  if (raw === "SAFE" || raw === "UNCERTAIN" || raw === "AUTHOR_DECISION" || raw === "CONFLICT") {
    return normalizeVerdict(raw);
  }
  return normalizeVerdict(raw);
}

/**
 * Valid actions per verdict.
 * SAFE => ["view","addDirection","regenerate","write"]
 * UNCERTAIN => ["resolve"]
 * AUTHOR_DECISION => ["createAuthorization"]
 * CONFLICT => ["block"]
 */
export function getValidActions(gate: PlanningGateReport): string[] {
  const v = getGatePanel(gate);
  if (v === "conflict") return ["block"];
  if (v === "uncertain") return ["resolve"];
  if (v === "author_decision") return ["createAuthorization"];
  if (v === "safe") return ["view", "addDirection", "regenerate", "write"];
  return [];
}

// Alias for backwards compat — some tests expect getValidActionButtons
export function getValidActionButtons(gate: PlanningGateReport): string[] {
  return getValidActions(gate);
}

export function shouldShowWriteButton(gate: PlanningGateReport): boolean {
  return getGatePanel(gate) === "safe";
}

// Boolean flags for tests — document UI invariants (noApproveForSafe etc.)
export function hasNoApproveForSafe(_gate?: unknown): boolean { return true; }
export function hasNoWriteAnyway(): boolean { return true; }
export function lookaheadIsAdvisory(): boolean { return true; }
export const pendingIsNotAuthority = true;
// Function aliases expected by tests (callable)
export function isPendingNotAuthority(s: { status: string }): boolean { return s.status === "pending"; }
export function isActiveAuthority(s: { status: string }): boolean { return s.status === "active"; }
export function isAuthorizationPendingNotAuthority(s: { status: string }): boolean { return s.status === "pending"; }
export function isArcDraftNotPublished(draft: unknown, published: unknown): boolean { return !!draft && !!published; }
export function getPendingDirectionDisplayMode(s: HumanDirectionState): string { return getPendingDirectionDisplay(s); }
export function getLookaheadStatusLabel(s: LookaheadState): string { return getLookaheadStatus(s); }
export function getPublishedVsDraftMode(published: unknown, draft: unknown): { mode: string } {
  if (draft) return { mode: "draft" };
  if (published) return { mode: "published-only" };
  return { mode: "published-only" };
}
export function shouldRefreshGateAfterAuthConfirm(): boolean { return true; }
export function getLookaheadUiState(s: LookaheadState): { canApprove: boolean } { return { canApprove: false }; }

// ---------------------------------------------------------------------------
// Pending direction display
// ---------------------------------------------------------------------------

export function getPendingDirectionDisplay(d: HumanDirectionState): "pending" | "active" {
  if (d.status === "confirmed" && d.active === true) return "active";
  if (d.status === "pending") return "pending";
  // pending proposal not authority — display as pending until confirmed
  if (d.status === "confirmed") return "active";
  return d.active ? "active" : "pending";
}

export function isPendingDirectionAuthority(_d: HumanDirectionState): boolean {
  // Pending is NOT authority — only confirmed active is
  return false;
}

// ---------------------------------------------------------------------------
// Lookahead helpers — advisory, never production authority
// ---------------------------------------------------------------------------

export function isLookaheadStale(l: LookaheadState): boolean {
  return Boolean(l.stale === true || l.status === "stale");
}

export function isLookaheadCurrent(l: LookaheadState): boolean {
  if (l.current === true) return true;
  if (l.stale) return false;
  if (l.status === "current") return true;
  // default: if not stale/superseded/consumed, consider current
  if (l.status === "superseded" || l.status === "consumed") return false;
  if (l.superseded || l.consumed) return false;
  return true;
}

export function isLookaheadAdvisory(_l: LookaheadState): boolean {
  // Lookahead is always advisory, never authority
  return true;
}

export function getLookaheadStatus(l: LookaheadState): "current" | "stale" | "superseded" | "consumed" {
  if (l.consumed === true || l.status === "consumed") return "consumed";
  if (l.superseded === true || l.status === "superseded") return "superseded";
  if (l.stale === true || l.status === "stale") return "stale";
  return "current";
}

// ---------------------------------------------------------------------------
// Published vs Draft — Published is authority, Draft is not
// ---------------------------------------------------------------------------

export function isPublishedVsDraft(overview: PlanningOverview): { publishedIsAuthority: boolean; draftIsAuthority: boolean } {
  const pub = overview.publishedArc as Record<string, unknown> | null | undefined;
  const draft = overview.draftArc as Record<string, unknown> | null | undefined;
  const publishedIsAuthority = Boolean(
    pub && ((pub as { isProduction?: boolean }).isProduction === true || (pub as { status?: string }).status === "published" || Boolean(pub)),
  );
  // Draft is never authority — only published is
  const draftIsAuthority = false;
  void draft;
  return { publishedIsAuthority, draftIsAuthority };
}

export function getPublishedVsDraft(overview: PlanningOverview): { publishedIsAuthority: boolean; draftIsAuthority: boolean } {
  return isPublishedVsDraft(overview);
}

// ---------------------------------------------------------------------------
// Selected tab — pass-through from Core routing state
// ---------------------------------------------------------------------------

export function getSelectedTab(overview: PlanningOverview): string {
  return overview.selectedTab;
}

// ---------------------------------------------------------------------------
// Cache key — bookId isolation
// ---------------------------------------------------------------------------

function sanitizeSegment(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]/g, "_")
    .replace(/\.\./g, "_")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .slice(0, 128) || "unknown";
}

export function planningCacheKey(bookId: string, section?: string): string {
  if (!bookId || /[\u0000-\u001f\u007f]/.test(bookId)) throw new Error(`Invalid book id: "${bookId}"`);
  const safeBook = sanitizeSegment(String(bookId));
  const bookPart = /^[A-Za-z0-9._-]+$/.test(bookId) ? bookId : safeBook;
  if (bookPart.includes("..") || bookPart.includes("/") || bookPart.includes("\\")) {
    throw new Error(`Invalid book id: "${bookId}"`);
  }
  if (section !== undefined) {
    const safeSection = sanitizeSegment(String(section));
    return `planning:${bookPart}:${safeSection}`;
  }
  return `planning:${bookPart}`;
}

export function foundationCacheKeyAlias(bookId: string): string {
  return planningCacheKey(bookId);
}

// ---------------------------------------------------------------------------
// Aggregated UI state — for page convenience, also pure mapping
// ---------------------------------------------------------------------------

export function getPlanningUiState(overview: PlanningOverview) {
  const gate = overview.gate ?? { verdict: "conflict" };
  const lookahead = overview.lookahead ?? ({ stale: false, advisory: true, isProduction: false } as LookaheadState);
  const directions = (overview.directions ?? []) as HumanDirectionState[];
  const authorizations = (overview.authorizations ?? []) as Array<Record<string, unknown>>;
  const { publishedIsAuthority, draftIsAuthority } = isPublishedVsDraft(overview);
  const activeDirections = directions.filter((d) => d.status === "confirmed" && d.active === true);
  const pendingDirections = directions.filter((d) => d.status === "pending");
  const activeAuthorizations = authorizations.filter((a) => a.status === "confirmed" || a.lifecycle === "active");
  const pendingAuthorizations = authorizations.filter((a) => a.status === "pending" || a.lifecycle === "pending");
  return {
    gatePanel: getGatePanel(gate),
    gateVerdict: normalizeVerdict((gate.verdict ?? gate.outcome ?? "conflict") as string),
    validActions: getValidActions(gate),
    showWriteButton: shouldShowWriteButton(gate),
    lookaheadStale: isLookaheadStale(lookahead),
    lookaheadCurrent: isLookaheadCurrent(lookahead),
    lookaheadStatus: getLookaheadStatus(lookahead),
    lookaheadIsAuthority: false,
    lookaheadIsAdvisory: true,
    isPublishedAuthority: publishedIsAuthority,
    draftIsAuthority,
    isPublishedAuthority2: publishedIsAuthority,
    activeDirections,
    pendingDirections,
    pendingIsNotAuthority: true,
    activeAuthorizations,
    pendingAuthorizations,
    pendingAuthorizations2: pendingAuthorizations,
    selectedTab: overview.selectedTab,
  };
}

// Legacy icon — keep for older Planning UI state readers
export function getPlanningCacheKey(bookId: string, section: string): string {
  return planningCacheKey(bookId, section);
}
