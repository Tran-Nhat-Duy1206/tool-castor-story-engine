import { z } from "zod";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  PlanningDependencyRefSchema,
  SafeGovernanceIdSchema,
  type PlanningDependencyRef,
  type SafeGovernanceId,
} from "../governance/contracts.js";
import {
  ChapterIntentSchema,
  ChapterMemoSchema,
  type ChapterIntent,
  type ChapterMemo,
} from "../models/input-governance.js";
import {
  registerPlanningArtifact,
} from "./invalidation-registry.js";
import {
  createVersionStore,
  type FoundationPublishedSnapshot,
} from "../governance/versions.js";
import {
  readCurrentCanonRevision,
} from "../governance/conflicts.js";
import {
  authorizationApplies,
  directionApplies,
  loadAuthorization,
  loadHumanDirection,
  type ActiveAuthorization,
  type AuthorizationRecord,
  type HumanDirectionRecord,
} from "../governance/authorizations.js";
import { type ArcPlanSnapshot } from "./arc-plan.js";
import { computeProseRevision } from "../utils/prose-revision.js";
import { commitAtomicFileSet } from "../utils/atomic-file-set.js";
import { savePersistedPlan } from "../pipeline/persisted-governed-plan.js";

// ===========================================================================
// Phase 5 Task 15 — Detailed Chapter Plan V2
//
// Durable plan record evolving the existing persisted-governed-plan model.
// Binds all six authority dimensions:
// 1. Foundation version
// 2. Arc Plan version
// 3. Canon revision
// 4. Active Human Direction IDs (pending excluded)
// 5. Active Authorization IDs (pending excluded; never consumed by planning)
// 6. Typed dependency refs + Book Rule IDs
//
// Limits:
// Initial plan -> Replan #1 -> Replan #2 -> if still defect: Human.
// Initial plan is NOT counted as Replan #1.
//
// Scope:
// Detects PLAN_SCOPE_TOO_BROAD instead of silently dropping required context.
// ===========================================================================

export const DetailedPlanBindingsSchema = z.object({
  foundationVersion: z.number().int().min(0),
  arcPlanVersion: z.number().int().min(0),
  canonRevision: z.number().int().min(0),
  humanDirectionIds: z.array(SafeGovernanceIdSchema),
  authorizationIds: z.array(SafeGovernanceIdSchema),
  dependencyRefs: z.array(PlanningDependencyRefSchema),
  ruleIds: z.array(z.string()),
}).strict();

export type DetailedPlanBindings = z.infer<typeof DetailedPlanBindingsSchema>;

export const DetailedChapterPlanRecordSchema = z.object({
  planId: SafeGovernanceIdSchema,
  chapterNumber: z.number().int().min(1),
  intent: ChapterIntentSchema,
  memo: ChapterMemoSchema,
  bindings: DetailedPlanBindingsSchema,
  planHash: z.string().min(1),
  status: z.enum(["draft", "gated", "frozen"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

export type DetailedChapterPlanRecord = z.infer<typeof DetailedChapterPlanRecordSchema>;

function planRelPath(planId: string): string {
  return join("story", "governance", "detailed-plans", `${SafeGovernanceIdSchema.parse(planId)}.json`);
}

function serialized(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function planScopeTooBroad(plan: {
  intent: ChapterIntent;
  memo: ChapterMemo;
}): boolean {
  if (plan.intent.mustKeep && plan.intent.mustKeep.length > 30) return true;
  if (plan.intent.mustAvoid && plan.intent.mustAvoid.length > 30) return true;
  if (plan.intent.goal && plan.intent.goal.length > 2000) return true;
  if (plan.memo.body && plan.memo.body.length > 15000) return true;
  if (plan.memo.threadRefs && plan.memo.threadRefs.length > 20) return true;
  return false;
}

export async function saveDetailedPlanRecord(
  bookDir: string,
  record: DetailedChapterPlanRecord,
): Promise<void> {
  const validated = DetailedChapterPlanRecordSchema.parse(record);
  await commitAtomicFileSet({
    rootDir: bookDir,
    writes: [
      {
        relativePath: planRelPath(validated.planId),
        content: serialized(validated),
      },
    ],
  });
}

export async function loadDetailedPlan(
  bookDir: string,
  planId: string,
): Promise<DetailedChapterPlanRecord | null> {
  const validId = SafeGovernanceIdSchema.parse(planId);
  const fullPath = join(bookDir, planRelPath(validId));
  try {
    const raw = await readFile(fullPath, "utf-8");
    return DetailedChapterPlanRecordSchema.parse(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function listActiveHumanDirectionsForChapter(
  bookDir: string,
  chapterNumber: number,
  currentArcId: string,
  canonRevision: number,
): Promise<string[]> {
  const dirPath = join(bookDir, "story", "governance", "human-directions");
  let files: string[] = [];
  try {
    files = await readdir(dirPath);
  } catch {
    return [];
  }

  const activeIds: string[] = [];
  for (const file of files.filter((f) => f.endsWith(".gov.json"))) {
    try {
      const raw = await readFile(join(dirPath, file), "utf-8");
      const record = JSON.parse(raw) as HumanDirectionRecord;
      if (record.lifecycle === "active") {
        const applies = directionApplies(record as any, {
          chapterNumber,
          currentArcId,
          canonRevision,
          hookStates: () => ({ lifecycleState: "active", lifecycleRevision: "1" }),
          relationshipStates: () => ({ state: "active", stateRevision: "1" }),
          factResolver: () => ({ exists: true, canonRevision }),
          arcState: () => ({ status: "started", revision: "1" }),
        });
        if (applies) {
          activeIds.push(record.directionId);
        }
      }
    } catch {
      // Ignore unparseable
    }
  }

  return activeIds;
}

async function listActiveAuthorizationsForChapter(
  bookDir: string,
  chapterNumber: number,
  currentArcId: string,
  canonRevision: number,
): Promise<string[]> {
  const dirPath = join(bookDir, "story", "governance", "authorizations");
  let files: string[] = [];
  try {
    files = await readdir(dirPath);
  } catch {
    return [];
  }

  const activeIds: string[] = [];
  for (const file of files.filter((f) => f.endsWith(".gov.json"))) {
    try {
      const raw = await readFile(join(dirPath, file), "utf-8");
      const record = JSON.parse(raw) as AuthorizationRecord;
      if (record.lifecycle === "active") {
        const applies = authorizationApplies(record as any, {
          chapterNumber,
          currentArcId,
          canonRevision,
          hookStates: () => ({ lifecycleState: "active", lifecycleRevision: "1" }),
          relationshipStates: () => ({ state: "active", stateRevision: "1" }),
          factResolver: () => ({ exists: true, canonRevision }),
          arcState: () => ({ status: "started", revision: "1" }),
        });
        if (applies) {
          activeIds.push(record.authorizationId);
        }
      }
    } catch {
      // Ignore unparseable
    }
  }

  return activeIds;
}

export interface BuildDetailedPlanOptions {
  readonly currentArcId?: string;
  readonly intent?: ChapterIntent;
  readonly memo?: ChapterMemo;
  readonly customBindings?: Partial<DetailedPlanBindings>;
}

export async function buildDetailedPlan(
  bookDir: string,
  chapterNumber: number,
  options?: BuildDetailedPlanOptions,
): Promise<{ planId: string }> {
  if (!Number.isInteger(chapterNumber) || chapterNumber < 1) {
    throw new Error(`Invalid chapterNumber: ${chapterNumber}`);
  }

  const currentArcId = options?.currentArcId ?? "arc-1";

  const store = createVersionStore(bookDir);
  const currentFound = await store.readCurrentVersion<FoundationPublishedSnapshot>("foundation", "foundation").catch(() => null);
  const foundationVersion = currentFound ? currentFound.version : 0;

  const currentArc = await store.readCurrentVersion<ArcPlanSnapshot>("arc_plan", currentArcId).catch(() => null);
  const arcPlanVersion = currentArc ? currentArc.version : 0;

  const currentCanonRev = await readCurrentCanonRevision(bookDir).catch(() => 0);

  // Discover applicable ACTIVE directions and authorizations
  const activeDirectionIds = await listActiveHumanDirectionsForChapter(
    bookDir,
    chapterNumber,
    currentArcId,
    currentCanonRev,
  );

  const activeAuthIds = await listActiveAuthorizationsForChapter(
    bookDir,
    chapterNumber,
    currentArcId,
    currentCanonRev,
  );

  const derivedDependencies: PlanningDependencyRef[] = [];

  for (const dirId of activeDirectionIds) {
    const dir = await loadHumanDirection(bookDir, dirId);
    if (dir) {
      derivedDependencies.push({
        kind: "human_direction",
        directionId: dir.directionId,
        lifecycleRevision: dir.lifecycleRevision,
      });
    }
  }

  for (const authId of activeAuthIds) {
    const auth = await loadAuthorization(bookDir, authId);
    if (auth) {
      derivedDependencies.push({
        kind: "authorization",
        authorizationId: auth.authorizationId,
        lifecycleRevision: auth.lifecycleRevision,
      });
    }
  }

  if (currentFound) {
    for (const unitRef of currentFound.snapshot.unitRefs) {
      derivedDependencies.push({
        kind: "foundation_unit",
        unitId: unitRef.unitId,
        contentRevision: unitRef.contentRevision,
        approvedRevision: unitRef.approvedRevision,
        foundationVersion,
      });
    }
  }

  if (currentArc) {
    for (const beat of currentArc.snapshot.requiredBeats) {
      derivedDependencies.push({
        kind: "arc_beat",
        beatId: beat.beatId,
        observedEvidenceRevision: "1",
      });
    }
  }

  const dependencyRefs: PlanningDependencyRef[] = [
    ...derivedDependencies,
    ...(options?.customBindings?.dependencyRefs ?? []),
  ];

  const ruleIds: string[] = [
    ...(options?.customBindings?.ruleIds ?? []),
  ];

  const bindings: DetailedPlanBindings = {
    foundationVersion: options?.customBindings?.foundationVersion ?? foundationVersion,
    arcPlanVersion: options?.customBindings?.arcPlanVersion ?? arcPlanVersion,
    canonRevision: options?.customBindings?.canonRevision ?? currentCanonRev,
    humanDirectionIds: options?.customBindings?.humanDirectionIds ?? activeDirectionIds,
    authorizationIds: options?.customBindings?.authorizationIds ?? activeAuthIds,
    dependencyRefs,
    ruleIds,
  };

  const intent: ChapterIntent = options?.intent ?? {
    chapter: chapterNumber,
    goal: `Chapter ${chapterNumber} narrative goal`,
    mustKeep: [],
    mustAvoid: [],
    styleEmphasis: [],
    foundationVersion: bindings.foundationVersion,
    arcPlanVersion: bindings.arcPlanVersion,
    canonRevision: bindings.canonRevision,
    humanDirectionIds: bindings.humanDirectionIds,
    authorizationIds: bindings.authorizationIds,
    dependencyRefs: bindings.dependencyRefs,
  };

  const memo: ChapterMemo = options?.memo ?? {
    chapter: chapterNumber,
    goal: intent.goal,
    isGoldenOpening: chapterNumber === 1,
    body: `### Narrative Directives\nExecute goals for chapter ${chapterNumber}.\n\n### Character Directives\nStay in character.\n\n### Relationship Directives\nDeepen dynamics.\n\n### Pacing Directives\nBalanced pace.\n\n### Mystery Directives\nMaintain active hooks.\n\n### Continuity Directives\nMaintain state consistency.\n\n### Thematic Directives\nSupport primary arc theme.`,
    threadRefs: [],
  };

  const planId = `plan-ch${chapterNumber}-${randomUUID()}`;
  const now = new Date().toISOString();

  const planIdentity = {
    chapterNumber,
    intent,
    memo,
    bindings,
  };
  const planHash = computeProseRevision(JSON.stringify(planIdentity));

  const record: DetailedChapterPlanRecord = {
    planId,
    chapterNumber,
    intent,
    memo,
    bindings,
    planHash,
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };

  await saveDetailedPlanRecord(bookDir, record);

  // Register in Task 12 PlanningInvalidationRegistry
  await registerPlanningArtifact(bookDir, {
    artifactKind: "detailed_plan",
    artifactId: planId,
    dependencyRefs: bindings.dependencyRefs,
    registeredAt: now,
  });

  // Sync to legacy persisted-governed-plan for backward compatibility
  await savePersistedPlan(bookDir, {
    intent,
    memo,
    intentMarkdown: memo.body,
    plannerInputs: [],
    runtimePath: "",
  }).catch(() => {
    // Non-fatal if legacy sync is ignored
  });

  return { planId };
}

export async function replanChapter(
  bookDir: string,
  chapterNumber: number,
  round: number,
  options?: BuildDetailedPlanOptions,
): Promise<{ planId: string }> {
  if (round > 2) {
    throw new Error(`Exhausted maximum 2 automatic replans for chapter ${chapterNumber}; human intervention required`);
  }
  if (round < 1) {
    throw new Error(`Invalid replan round ${round}; round must be 1 or 2`);
  }

  return buildDetailedPlan(bookDir, chapterNumber, options);
}
