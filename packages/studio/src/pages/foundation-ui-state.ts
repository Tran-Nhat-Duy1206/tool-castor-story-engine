/**
 * Pure UI state model for Foundation page — no React, no fetch.
 * Derives presentational state from Core data; does NOT duplicate Core governance.
 * Core remains sole authority on readiness, approval, dependencies, blockers.
 *
 * This file satisfies BOTH the Task 22 RED suite (foundation-ui-state.test.ts)
 * and the original Foundation spec (isApprovedReadOnly etc.).
 */
import type { FoundationUnitManifest, FoundationRevisionDraft, ReadinessReport } from "../lib/foundation-api";

// ---------------------------------------------------------------------------
// Types for RED suite (test-expected)
// ---------------------------------------------------------------------------

export interface FoundationUnit {
  readonly id: string;
  readonly title?: string;
  readonly status: string;
  readonly required?: boolean;
  readonly isProduction?: boolean;
  readonly readOnly?: boolean;
  readonly stale?: boolean;
  readonly dependencies?: ReadonlyArray<string> | ReadonlyArray<{ targetUnitId: string; kind: string }>;
  readonly findings?: ReadonlyArray<unknown>;
  readonly blockers?: ReadonlyArray<unknown>;
  readonly [key: string]: unknown;
}

export interface FoundationOverview {
  readonly bookId: string;
  readonly published: { units: ReadonlyArray<FoundationUnit> } | null;
  readonly draft: { units: ReadonlyArray<FoundationUnit> } | null;
  readonly manifests?: ReadonlyArray<unknown>;
  readonly [key: string]: unknown;
}

export interface FoundationReadiness {
  readonly ready: boolean;
  readonly blockers: ReadonlyArray<unknown>;
  readonly findings: ReadonlyArray<unknown>;
  readonly requiredUnits?: ReadonlyArray<FoundationUnit>;
  readonly optionalUnits?: ReadonlyArray<FoundationUnit>;
  readonly [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Types for earlier spec (Core manifest based)
// ---------------------------------------------------------------------------

export type PublishedVsDraftMode = "published-only" | "revision-draft";

export interface PublishedVsDraftView {
  readonly mode: PublishedVsDraftMode;
  readonly published: ReadonlyArray<FoundationUnitManifest>;
  readonly draft: FoundationRevisionDraft | null;
}

export interface BlockingReasonsView {
  readonly blockers: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
  readonly isReady: boolean;
  readonly isPublished: boolean;
  readonly nextAction: string | null;
}

// ---------------------------------------------------------------------------
// bookId isolation (key) — prevents cross-book leak
// Supports both 1-arg (spec) and 2-arg (RED test) signatures
// ---------------------------------------------------------------------------

function sanitizeSegment(value: string): string {
  // Remove path traversal, slashes, null bytes; keep alphanum, dash, underscore
  return value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]/g, "_")
    .replace(/\.\./g, "_")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .slice(0, 128) || "unknown";
}

export function foundationCacheKey(bookId: string, revisionId?: string): string {
  if (!bookId || /[\u0000-\u001f\u007f]/.test(bookId)) throw new Error(`Invalid book id: "${bookId}"`);
  // Sanitize but preserve bookId for test expectations (must contain original bookId when safe)
  const safeBook = sanitizeSegment(String(bookId));
  // Also reject traversal via check but sanitized version won't contain ..
  if (safeBook.includes("..") || safeBook.includes("/") || safeBook.includes("\\")) {
    throw new Error(`Invalid book id: "${bookId}"`);
  }
  // For RED tests: key must contain bookId verbatim when bookId is safe
  const bookPart = /^[A-Za-z0-9._-]+$/.test(bookId) ? bookId : safeBook;
  if (revisionId !== undefined) {
    const safeRev = sanitizeSegment(String(revisionId));
    return `foundation:${bookPart}:${safeRev}`;
  }
  return `foundation:${bookPart}`;
}

export function foundationStorageKey(bookId: string, revisionId?: string): string {
  return foundationCacheKey(bookId, revisionId);
}

// ---------------------------------------------------------------------------
// RED suite helpers
// ---------------------------------------------------------------------------

export function partitionPublishedDraft(overview: FoundationOverview): { published: FoundationUnit[]; draft: FoundationUnit[] } {
  const published = [...(overview.published?.units ?? [])] as FoundationUnit[];
  const draft = [...(overview.draft?.units ?? [])] as FoundationUnit[];
  return { published, draft };
}

export function getFoundationUiState(
  overview: FoundationOverview,
  readiness: FoundationReadiness,
): {
  readonly publishedUnits: ReadonlyArray<FoundationUnit>;
  readonly draftUnits: ReadonlyArray<FoundationUnit>;
  readonly productionAuthority: ReadonlyArray<FoundationUnit>;
  readonly unitsById: Record<string, FoundationUnit>;
  readonly requiredUnits: ReadonlyArray<FoundationUnit>;
  readonly optionalUnits: ReadonlyArray<FoundationUnit>;
  readonly staleUnits: ReadonlyArray<FoundationUnit>;
  readonly readiness: FoundationReadiness;
  readonly isPublished: boolean;
  readonly isReady: boolean;
} {
  const { published, draft } = partitionPublishedDraft(overview);
  const productionAuthority = published.filter((u) => u.isProduction === true);
  const all = [...published, ...draft];
  const unitsById: Record<string, FoundationUnit> = {};
  for (const u of all) unitsById[u.id] = u;
  const requiredUnits = readiness.requiredUnits ?? all.filter((u) => u.required === true);
  const optionalUnits = readiness.optionalUnits ?? all.filter((u) => u.required === false);
  const staleUnits = all.filter((u) => u.stale === true);
  const isPublished = overview.published !== null && published.length > 0;
  const isReady = readiness.ready === true && (readiness.blockers?.length ?? 0) === 0;
  return { publishedUnits: published, draftUnits: draft, productionAuthority, unitsById, requiredUnits, optionalUnits, staleUnits, readiness, isPublished, isReady };
}

export function canEditFoundationUnit(unit: FoundationUnit, revision: { revisionStatus: string } | null | undefined): boolean {
  // Draft units are always editable
  if (unit.status === "draft") return true;
  // Approved read-only units: only editable when revision is draft/open
  if (unit.readOnly === true || unit.status === "approved") {
    const status = revision?.revisionStatus ?? "approved";
    if (status === "draft" || status === "open" || status === "needs_review") return true;
    return false;
  }
  return true;
}

export function isFoundationUnitRequired(unit: FoundationUnit): boolean {
  return unit.required === true;
}

export function getFoundationDependencies(unit: FoundationUnit): ReadonlyArray<string> {
  const deps = unit.dependencies as ReadonlyArray<string> | ReadonlyArray<{ targetUnitId: string }> | undefined;
  if (!deps) return [];
  // Normalize: if objects, extract targetUnitId; if strings, return as is
  return (deps as ReadonlyArray<unknown>).map((d) => {
    if (typeof d === "string") return d;
    if (d && typeof d === "object" && "targetUnitId" in (d as Record<string, unknown>)) return String((d as { targetUnitId: string }).targetUnitId);
    return String(d);
  });
}

export function getFoundationFindings(readiness: FoundationReadiness): ReadonlyArray<unknown> {
  return [...(readiness.findings ?? [])];
}

export function getFoundationBlockers(readiness: FoundationReadiness): ReadonlyArray<unknown> {
  return [...(readiness.blockers ?? [])];
}

export function diffFirstView(revision: { revisionId: string; revisionIndex: number; diff?: ReadonlyArray<unknown>; units?: ReadonlyArray<unknown> }): { hasDiff: boolean; diff: ReadonlyArray<unknown> } {
  const diff = [...(revision.diff ?? [])];
  const hasDiff = revision.revisionIndex > 0 && diff.length > 0;
  return { hasDiff, diff };
}

export function staleFoundationView(unit: FoundationUnit, _readiness: FoundationReadiness): { stale: boolean; requiresReReview: boolean } {
  void _readiness;
  const stale = unit.stale === true;
  return { stale, requiresReReview: stale };
}

export function isReadyToPublish(readiness: FoundationReadiness): boolean {
  return readiness.ready === true && (readiness.blockers?.length ?? 0) === 0;
}

export function batchApproveView(units: ReadonlyArray<FoundationUnit>, _options: { force?: boolean } = {}): { approvable: string[]; requiresReapproveStale: string[] } {
  void _options;
  const approvable: string[] = [];
  const requiresReapproveStale: string[] = [];
  for (const u of units) {
    if (u.stale === true) {
      requiresReapproveStale.push(u.id);
      continue;
    }
    // Only non-stale, non-blocked, draft/needs_review are batch-approvable
    const hasBlockers = Array.isArray(u.blockers) && u.blockers.length > 0;
    if (hasBlockers) continue;
    if (u.status === "draft" || u.status === "needs_review" || u.status === undefined) {
      approvable.push(u.id);
    } else if (u.status === "published" || u.status === "approved") {
      // approved without stale is not batch-approvable via this path (needs separate)
      continue;
    } else {
      approvable.push(u.id);
    }
  }
  return { approvable, requiresReapproveStale };
}

// ---------------------------------------------------------------------------
// Original spec helpers (keep for FoundationPage)
// ---------------------------------------------------------------------------

export function isApprovedReadOnly(
  unit: Pick<FoundationUnitManifest, "status">,
  revision: FoundationRevisionDraft | null | undefined,
): boolean {
  return unit.status === "approved" && !revision;
}

export function getPublishedVsDraftMode(
  manifests: ReadonlyArray<FoundationUnitManifest>,
  revision: FoundationRevisionDraft | null | undefined,
): PublishedVsDraftView {
  if (revision) {
    return { mode: "revision-draft", published: manifests, draft: revision };
  }
  return { mode: "published-only", published: manifests, draft: null };
}

export function shouldShowDiffFirst(
  revision: FoundationRevisionDraft | null | undefined,
  publishedVersion: number | null | undefined,
): boolean {
  if (!revision) return false;
  if (publishedVersion == null) return false;
  if (revision.baseFoundationVersion != null && revision.baseFoundationVersion !== publishedVersion) return true;
  if (revision.status !== "open") return true;
  return revision.unitStates.length > 0;
}

export type BatchEligibleUnit = Pick<FoundationUnitManifest, "status" | "unitId"> & {
  readonly hasBlockingFindings?: boolean;
  readonly state?: string;
};

export type RevisionUnitEligible = Pick<FoundationRevisionDraft["unitStates"][number], "state" | "unitId"> & {
  readonly hasBlockingFindings?: boolean;
};

export function batchApproveEligible(
  units: ReadonlyArray<BatchEligibleUnit | RevisionUnitEligible>,
): ReadonlyArray<BatchEligibleUnit | RevisionUnitEligible> {
  return units.filter((u) => {
    const state = (u as { state?: string }).state ?? (u as BatchEligibleUnit).status;
    const hasBlockers = (u as { hasBlockingFindings?: boolean }).hasBlockingFindings === true;
    if (hasBlockers) return false;
    return state === "draft" || state === "needs_review";
  });
}

export function getBlockingReasons(readiness: ReadinessReport | null | undefined): BlockingReasonsView {
  if (!readiness) {
    return { blockers: [], warnings: [], isReady: false, isPublished: false, nextAction: null };
  }
  const blockers = [...(readiness.blockingReasons ?? [])];
  const warnings = [...(readiness.warnings ?? [])];
  const isReady = blockers.length === 0;
  const isPublished = false;
  return {
    blockers,
    warnings,
    isReady,
    isPublished,
    nextAction: readiness.nextRecommendedAction ?? null,
  };
}

export function getBlockingReasonsWithPublished(
  readiness: ReadinessReport | null | undefined,
  currentVersion: number | null | undefined,
): BlockingReasonsView {
  const base = getBlockingReasons(readiness);
  return { ...base, isPublished: currentVersion != null && currentVersion > 0 };
}

export function isReady(readiness: ReadinessReport | null | undefined): boolean {
  if (!readiness) return false;
  return (readiness.blockingReasons ?? []).length === 0;
}

export function isPublishedVersion(currentVersion: number | null | undefined): boolean {
  return typeof currentVersion === "number" && currentVersion > 0;
}

export function readyVsPublishedDiverged(
  readiness: ReadinessReport | null | undefined,
  currentVersion: number | null | undefined,
): boolean {
  return isReady(readiness) !== isPublishedVersion(currentVersion);
}

export function getUnitStatusLabel(status: string, lang: "zh" | "en" = "zh"): string {
  const map: Record<string, { zh: string; en: string }> = {
    approved: { zh: "已批准", en: "Approved" },
    published: { zh: "已发布", en: "Published" },
    draft: { zh: "草稿", en: "Draft" },
    needs_review: { zh: "待复核", en: "Needs Review" },
    needs_revision: { zh: "需修订", en: "Needs Revision" },
    stale: { zh: "已过期", en: "Stale" },
    missing: { zh: "缺失", en: "Missing" },
    legacy_established: { zh: "历史已确立", en: "Legacy Established" },
  };
  return (map[status] ?? { zh: status, en: status })[lang];
}

export function getImportanceLabel(importance: string, lang: "zh" | "en" = "zh"): string {
  return importance === "required" ? (lang === "zh" ? "必填" : "Required") : (lang === "zh" ? "可选" : "Optional");
}

export function dependencyLabels(
  dependencies: ReadonlyArray<{ targetUnitId: string; kind: string }>,
): ReadonlyArray<string> {
  return dependencies.map((d) => `${d.kind}:${d.targetUnitId}`);
}

export function findingsSummary(
  findings: ReadonlyArray<{ severity: string; category: string }>,
): string {
  if (findings.length === 0) return "No findings";
  return findings.map((f) => `${f.severity}/${f.category}`).join(", ");
}
