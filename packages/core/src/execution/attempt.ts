import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  AttemptDefectSchema,
  SafeGovernanceIdSchema,
  type AttemptDefect,
  type SafeGovernanceId,
} from "../governance/contracts.js";
import {
  loadExecutionSnapshot,
} from "./snapshot.js";
import {
  loadExecutionAttempt,
  saveExecutionAttempt,
} from "./attempt-store.js";

// ===========================================================================
// Phase 5 Task 18 — Durable Execution Attempts
//
// Invariants:
// - Snapshot linkage is immutable (attemptId -> snapshotId).
// - replanNumber must be 0, 1, or 2 (0 = Initial, 1 = Replan #1, 2 = Replan #2).
//   replanNumber >= 3 is forbidden and must throw / route to Human.
// - Legal lifecycle state transitions only.
// - Provider failures persist durable failure metadata and consume no authority.
// - Accepted status is execution history only (does NOT settle Canon).
// - Rejected/aborted attempt prose is NON-CANON history.
// ===========================================================================

export const ExecutionAttemptStatusSchema = z.enum([
  "created",
  "running",
  "drafted",
  "failed",
  "aborted_for_plan_defect",
  "accepted",
  "rejected",
]);

export type ExecutionAttemptStatus = z.infer<typeof ExecutionAttemptStatusSchema>;

export const ExecutionAttemptSchema = z.object({
  attemptId: z.string().min(1),
  chapterNumber: z.number().int().min(1),
  snapshotId: z.string().min(1),
  status: ExecutionAttemptStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  providerFailure: z.object({
    provider: z.string(),
    model: z.string(),
    message: z.string(),
    at: z.string().datetime(),
  }).optional(),
  draftArtifactRefs: z.array(z.string()).optional(),
  defect: AttemptDefectSchema.optional(),
  replanNumber: z.number().int().min(0).max(2),
}).strict();

export type ExecutionAttempt = z.infer<typeof ExecutionAttemptSchema>;

export async function createExecutionAttempt(
  bookDir: string,
  snapshotId: string,
  chapterNumber: number,
  replanNumber: number,
): Promise<ExecutionAttempt> {
  if (!Number.isInteger(replanNumber) || replanNumber < 0 || replanNumber > 2) {
    throw new Error(`Invalid replanNumber ${replanNumber}; must be 0 (initial), 1 (replan #1), or 2 (replan #2). Round > 2 requires human intervention.`);
  }

  const snapshot = await loadExecutionSnapshot(bookDir, snapshotId);
  if (!snapshot) {
    throw new Error(`Cannot create ExecutionAttempt: ExecutionSnapshot "${snapshotId}" not found`);
  }

  const now = new Date().toISOString();
  const attempt: ExecutionAttempt = {
    attemptId: `attempt-ch${chapterNumber}-${randomUUID()}`,
    chapterNumber,
    snapshotId,
    status: "created",
    createdAt: now,
    updatedAt: now,
    replanNumber,
  };

  await saveExecutionAttempt(bookDir, attempt);
  return attempt;
}

export { loadExecutionAttempt } from "./attempt-store.js";

export async function recordAttemptRunning(
  bookDir: string,
  attemptId: string,
): Promise<void> {
  const attempt = await loadExecutionAttempt(bookDir, attemptId);
  if (!attempt) {
    throw new Error(`ExecutionAttempt "${attemptId}" not found`);
  }
  if (attempt.status !== "created") {
    throw new Error(`Illegal attempt state transition: cannot move from "${attempt.status}" to "running"`);
  }

  const updated: ExecutionAttempt = {
    ...attempt,
    status: "running",
    updatedAt: new Date().toISOString(),
  };

  await saveExecutionAttempt(bookDir, updated);
}

export async function recordAttemptDrafted(
  bookDir: string,
  attemptId: string,
  artifactRefs: ReadonlyArray<string>,
): Promise<void> {
  const attempt = await loadExecutionAttempt(bookDir, attemptId);
  if (!attempt) {
    throw new Error(`ExecutionAttempt "${attemptId}" not found`);
  }
  if (attempt.status !== "running") {
    throw new Error(`Illegal attempt state transition: cannot move from "${attempt.status}" to "drafted"`);
  }

  const updated: ExecutionAttempt = {
    ...attempt,
    status: "drafted",
    draftArtifactRefs: [...artifactRefs],
    updatedAt: new Date().toISOString(),
  };

  await saveExecutionAttempt(bookDir, updated);
}

export async function recordAttemptFailure(
  bookDir: string,
  attemptId: string,
  failure?: ExecutionAttempt["providerFailure"],
): Promise<void> {
  const attempt = await loadExecutionAttempt(bookDir, attemptId);
  if (!attempt) {
    throw new Error(`ExecutionAttempt "${attemptId}" not found`);
  }
  if (attempt.status !== "running" && attempt.status !== "created") {
    throw new Error(`Illegal attempt state transition: cannot move from "${attempt.status}" to "failed"`);
  }

  const updated: ExecutionAttempt = {
    ...attempt,
    status: "failed",
    providerFailure: failure,
    updatedAt: new Date().toISOString(),
  };

  await saveExecutionAttempt(bookDir, updated);
}

export async function abortAttemptForPlanDefect(
  bookDir: string,
  attemptId: string,
  reason?: string,
): Promise<void> {
  const attempt = await loadExecutionAttempt(bookDir, attemptId);
  if (!attempt) {
    throw new Error(`ExecutionAttempt "${attemptId}" not found`);
  }
  if (attempt.status !== "running" && attempt.status !== "drafted") {
    throw new Error(`Illegal attempt state transition: cannot move from "${attempt.status}" to "aborted_for_plan_defect"`);
  }

  const updated: ExecutionAttempt = {
    ...attempt,
    status: "aborted_for_plan_defect",
    defect: "plan_defect",
    updatedAt: new Date().toISOString(),
  };

  await saveExecutionAttempt(bookDir, updated);
}

export async function acceptAttempt(
  bookDir: string,
  attemptId: string,
): Promise<void> {
  const attempt = await loadExecutionAttempt(bookDir, attemptId);
  if (!attempt) {
    throw new Error(`ExecutionAttempt "${attemptId}" not found`);
  }
  if (attempt.status !== "drafted") {
    throw new Error(`Illegal attempt state transition: cannot move from "${attempt.status}" to "accepted"`);
  }

  const updated: ExecutionAttempt = {
    ...attempt,
    status: "accepted",
    updatedAt: new Date().toISOString(),
  };

  await saveExecutionAttempt(bookDir, updated);
}

export type AttemptOutcome =
  | { status: "prose_defect"; next: "revise_same_snapshot" }
  | { status: "plan_defect"; next: "fresh_plan_and_snapshot" }
  | { status: "authority_defect"; next: "authority_resolver" }
  | { status: "canon_conflict"; next: "hard_stop" };

export function classifyAttemptDefect(defectOrAttempt: unknown): AttemptOutcome {
  let defectKind = "prose_defect";

  if (typeof defectOrAttempt === "string") {
    defectKind = defectOrAttempt;
  } else if (typeof defectOrAttempt === "object" && defectOrAttempt !== null) {
    const obj = defectOrAttempt as Record<string, any>;
    if (typeof obj.kind === "string") {
      defectKind = obj.kind;
    } else if (typeof obj.defect === "string") {
      defectKind = obj.defect;
    } else if (typeof obj.defect === "object" && obj.defect !== null && typeof obj.defect.kind === "string") {
      defectKind = obj.defect.kind;
    } else if (Array.isArray(obj.issues)) {
      const issues = obj.issues as Array<{ category?: string; repairScope?: string }>;
      if (issues.some((i) => i.category === "canon_conflict" || i.category === "canon_contradiction")) {
        defectKind = "canon_conflict";
      } else if (issues.some((i) => i.category === "authority_defect" || i.category === "missing_authority")) {
        defectKind = "authority_defect";
      } else if (issues.some((i) => i.category === "plan_defect" || i.repairScope === "structural" || i.category === "major_beat_contradiction" || i.category === "arc_turn_violation")) {
        defectKind = "plan_defect";
      }
    }
  }

  switch (defectKind) {
    case "plan_defect":
      return { status: "plan_defect", next: "fresh_plan_and_snapshot" };
    case "authority_defect":
      return { status: "authority_defect", next: "authority_resolver" };
    case "canon_conflict":
      return { status: "canon_conflict", next: "hard_stop" };
    case "prose_defect":
    default:
      return { status: "prose_defect", next: "revise_same_snapshot" };
  }
}
