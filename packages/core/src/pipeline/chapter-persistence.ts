import type { AuditIssue, AuditResult } from "../agents/continuity.js";
import type { ChapterMeta } from "../models/chapter.js";
import type { LengthTelemetry } from "../models/length-governance.js";
import { buildStateDegradedReviewNote } from "./chapter-state-recovery.js";

export interface ChapterPersistenceUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export type ChapterPersistenceStatus =
  | "needs-state-review"
  | "ready-for-review"
  | "audit-failed"
  | "state-degraded";

/**
 * Task 7 seam: `extra.chapterIndexJson` rides the Writer's ONE authoritative
 * atomic set (Task 6 `updatedChapterIndexJson`). Legacy callers pass nothing.
 */
export type SaveChapterSeam = (
  extra?: { readonly chapterIndexJson?: string },
) => Promise<void>;

function upsertByNumber(
  index: ReadonlyArray<ChapterMeta>,
  entry: ChapterMeta,
): Array<ChapterMeta> {
  const existingIdx = index.findIndex((e) => e.number === entry.number);
  return existingIdx >= 0
    ? index.map((e, i) => i === existingIdx ? { ...entry, createdAt: e.createdAt } : e)
    : [...index, entry];
}

function buildChapterMetaEntry(
  params: Parameters<typeof persistChapterArtifacts>[0],
  now: string,
  status: ChapterPersistenceStatus,
): ChapterMeta {
  return {
    number: params.chapterNumber,
    title: params.chapterTitle,
    status,
    wordCount: params.finalWordCount,
    createdAt: now,
    updatedAt: now,
    auditIssues: params.auditResult.issues.map((issue) => `[${issue.severity}] ${issue.description}`),
    lengthWarnings: [...params.lengthWarnings],
    reviewNote: status === "state-degraded"
      ? buildStateDegradedReviewNote(
          params.auditResult.passed ? "ready-for-review" : "audit-failed",
          params.degradedIssues,
        )
      : undefined,
    lengthTelemetry: params.lengthTelemetry,
    tokenUsage: params.tokenUsage,
  };
}

export async function persistChapterArtifacts(params: {
  readonly chapterNumber: number;
  readonly chapterTitle: string;
  readonly status: ChapterPersistenceStatus;
  readonly auditResult: AuditResult;
  readonly finalWordCount: number;
  readonly lengthWarnings: ReadonlyArray<string>;
  readonly lengthTelemetry?: LengthTelemetry;
  readonly degradedIssues: ReadonlyArray<AuditIssue>;
  readonly tokenUsage?: ChapterPersistenceUsage;
  readonly loadChapterIndex: () => Promise<ReadonlyArray<ChapterMeta>>;
  readonly saveChapter: SaveChapterSeam;
  readonly saveTruthFiles: () => Promise<void>;
  readonly saveChapterIndex: (index: ReadonlyArray<ChapterMeta>) => Promise<void>;
  readonly markBookActiveIfNeeded: () => Promise<void>;
  readonly persistAuditDriftGuidance: (issues: ReadonlyArray<AuditIssue>) => Promise<void>;
  readonly snapshotState: () => Promise<void>;
  readonly syncCurrentStateFactHistory: () => Promise<void>;
  readonly logSnapshotStage: () => void;
  readonly now?: () => string;
}): Promise<{ readonly entry: ChapterMeta }> {
  const driftIssues = params.auditResult.issues.filter(
    (issue) => issue.severity === "critical" || issue.severity === "warning",
  );

  // Task 7 gated publication: prose + active State Review artifact + gated
  // index share the Writer's ONE atomic commit. NO truth-file writes, NO
  // runtime snapshot, NO fact-history sync — the proposal is NOT confirmed,
  // and there is deliberately no separate saveChapterIndex call.
  if (params.status === "needs-state-review") {
    const existingIndex = await params.loadChapterIndex();
    const now = params.now?.() ?? new Date().toISOString();
    const entry = buildChapterMetaEntry(params, now, "needs-state-review");
    const updatedIndex = upsertByNumber(existingIndex, entry);
    await params.saveChapter({ chapterIndexJson: JSON.stringify(updatedIndex, null, 2) });
    await params.markBookActiveIfNeeded();
    await params.persistAuditDriftGuidance(driftIssues);
    return { entry };
  }

  await params.saveChapter();
  if (params.status !== "state-degraded") {
    await params.saveTruthFiles();
  }

  const existingIndex = await params.loadChapterIndex();
  const now = params.now?.() ?? new Date().toISOString();
  const entry = buildChapterMetaEntry(params, now, params.status);
  const updatedIndex = upsertByNumber(existingIndex, entry);
  await params.saveChapterIndex(updatedIndex);
  await params.markBookActiveIfNeeded();

  await params.persistAuditDriftGuidance(params.status === "state-degraded" ? [] : driftIssues);

  if (params.status !== "state-degraded") {
    params.logSnapshotStage();
    await params.snapshotState();
    await params.syncCurrentStateFactHistory();
  }

  return { entry };
}
