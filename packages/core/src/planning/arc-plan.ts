import { z } from "zod";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  BeatCategorySchema,
  ImportanceSchema,
  PlanningDependencyRefSchema,
  SafeGovernanceIdSchema,
  type BeatCategory,
  type Importance,
  type PlanningDependencyRef,
  type SafeGovernanceId,
} from "../governance/contracts.js";
import {
  createVersionStore,
  type VersionEnvelope,
} from "../governance/versions.js";
import { readCurrentCanonRevision } from "../governance/conflicts.js";
import { computeProseRevision } from "../utils/prose-revision.js";
import { commitAtomicFileSet } from "../utils/atomic-file-set.js";

// ===========================================================================
// Phase 5 Task 12 — Arc Plan Domain & Storage
//
// Persistence and domain metadata for Arc Plans. Consumes the exact generic
// VersionEnvelope from Task 5 (no duplicate version/history system).
//
// Scope discipline: Task 12 is persistence/domain ONLY. There is NO
// authoritative `publishArcPlan` here. Task 13 owns Human Publish.
//
// Restore reads a historical version and creates a NEW durable Draft C with its
// own draftId (persisted into the same draft store), leaving current Published
// Arc authority completely unchanged.
// ===========================================================================

export const BeatRefSchema = z.object({
  beatId: SafeGovernanceIdSchema,
  category: BeatCategorySchema,
  importance: ImportanceSchema,
  description: z.string().trim().min(1).max(2000),
  targetChapter: z.number().int().min(1).optional(),
}).strict();

export type BeatRef = z.infer<typeof BeatRefSchema>;

export const ArcPlanSnapshotSchema = z.object({
  arcId: SafeGovernanceIdSchema,
  goal: z.string().trim().min(1).max(5000),
  requiredBeats: z.array(BeatRefSchema),
  optionalBeats: z.array(BeatRefSchema),
  relationshipMovements: z.array(z.string().trim().min(1)),
  hookMovements: z.array(z.string().trim().min(1)),
  timing: z.record(z.unknown()),
  authorizations: z.array(z.string().trim().min(1)),
  dependencies: z.array(PlanningDependencyRefSchema),
  changedBeats: z.array(z.string().trim().min(1)),
  changedAuthorizations: z.array(z.string().trim().min(1)),
}).strict();

export type ArcPlanSnapshot = z.infer<typeof ArcPlanSnapshotSchema>;

export type ArcPlanVersion = VersionEnvelope<ArcPlanSnapshot>;

export const ArcPlanDraftRecordSchema = z.object({
  draftId: SafeGovernanceIdSchema,
  arcId: SafeGovernanceIdSchema,
  snapshot: ArcPlanSnapshotSchema,
  draftHash: z.string().min(1),
  foundationVersion: z.number().int().min(1),
  baseCanonRevision: z.number().int().min(0),
  status: z.enum(["draft", "needs_review"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

export type ArcPlanDraftRecord = z.infer<typeof ArcPlanDraftRecordSchema>;

function draftRelPath(draftId: string): string {
  return join("story", "governance", "arc-plan-drafts", `${SafeGovernanceIdSchema.parse(draftId)}.json`);
}

function serialized(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function saveArcPlanDraft(
  bookDir: string,
  record: ArcPlanDraftRecord,
): Promise<{ draftId: string }> {
  const validated = ArcPlanDraftRecordSchema.parse(record);
  await commitAtomicFileSet({
    rootDir: bookDir,
    writes: [
      {
        relativePath: draftRelPath(validated.draftId),
        content: serialized(validated),
      },
    ],
  });
  return { draftId: validated.draftId };
}

export async function loadArcPlanDraft(
  bookDir: string,
  draftId: string,
): Promise<ArcPlanDraftRecord | null> {
  const validId = SafeGovernanceIdSchema.parse(draftId);
  const fullPath = join(bookDir, draftRelPath(validId));
  try {
    const raw = await readFile(fullPath, "utf-8");
    return ArcPlanDraftRecordSchema.parse(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function loadPublishedArcPlan(
  bookDir: string,
  arcId: string,
): Promise<ArcPlanVersion | null> {
  const validArcId = SafeGovernanceIdSchema.parse(arcId);
  const store = createVersionStore(bookDir);
  return store.readCurrentVersion<ArcPlanSnapshot>("arc_plan", validArcId);
}

export async function restoreArcPlanAsRevisionDraft(
  bookDir: string,
  arcId: string,
  fromVersion: number,
): Promise<{ draftId: string }> {
  const validArcId = SafeGovernanceIdSchema.parse(arcId);
  if (!Number.isInteger(fromVersion) || fromVersion < 1) {
    throw new Error(`Invalid fromVersion for Arc Plan restore: ${fromVersion}`);
  }

  const store = createVersionStore(bookDir);
  const historical = await store.readVersion<ArcPlanSnapshot>("arc_plan", validArcId, fromVersion);
  if (!historical) {
    throw new Error(`Historical Arc Plan version ${fromVersion} not found for arc ${validArcId}`);
  }

  const [currentCanonRev, currentFoundation] = await Promise.all([
    readCurrentCanonRevision(bookDir).catch(() => 0),
    store.readCurrentVersion("foundation", "foundation").catch(() => null),
  ]);

  const foundationVersion = currentFoundation?.version ?? 1;
  const draftId = `draft-arc-${randomUUID()}`;
  const now = new Date().toISOString();
  const draftHash = computeProseRevision(JSON.stringify(historical.snapshot));

  const draftRecord: ArcPlanDraftRecord = {
    draftId,
    arcId: validArcId,
    snapshot: historical.snapshot,
    draftHash,
    foundationVersion,
    baseCanonRevision: currentCanonRev,
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };

  await saveArcPlanDraft(bookDir, draftRecord);
  return { draftId };
}
