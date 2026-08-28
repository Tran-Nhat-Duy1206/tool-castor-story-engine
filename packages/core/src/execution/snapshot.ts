import { z } from "zod";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, normalize } from "node:path";
import {
  SafeGovernanceIdSchema,
  type SafeGovernanceId,
} from "../governance/contracts.js";
import {
  DetailedPlanBindingsSchema,
  loadDetailedPlan,
  type DetailedPlanBindings,
} from "../planning/detailed-plan.js";
import {
  isBundleStale,
  type ContextBundle,
} from "../context/bundle.js";
import {
  evaluatePlanningGate,
} from "../planning/gate.js";
import {
  createVersionStore,
  type FoundationPublishedSnapshot,
} from "../governance/versions.js";
import {
  readCurrentCanonRevision,
} from "../governance/conflicts.js";
import {
  loadAuthorization,
  loadHumanDirection,
} from "../governance/authorizations.js";
import { type ArcPlanSnapshot } from "../planning/arc-plan.js";
import { computeProseRevision } from "../utils/prose-revision.js";
import { StateManager } from "../state/manager.js";

// ===========================================================================
// Phase 5 Task 18 — Execution Snapshot & Immutability
//
// Freezes the EXACT persisted plan that passed Planning Gate:
// - Caller supplies only `bookDir`, `planId`, and `contextBundle`
// - Revalidates all authority, Gate SAFE proof, and ContextBundle identity
//   INSIDE the book lock (preventing check-before-lock races)
// - Once persisted, Snapshot is IMMUTABLE
// ===========================================================================

export const ExecutionSnapshotSchema = z.object({
  snapshotId: z.string().min(1),
  chapterNumber: z.number().int().min(1),
  planId: SafeGovernanceIdSchema,
  planHash: z.string().min(1),
  bindings: DetailedPlanBindingsSchema,
  contextBundleId: z.string().min(1),
  frozenAt: z.string().datetime(),
}).strict();

export type ExecutionSnapshot = z.infer<typeof ExecutionSnapshotSchema>;

export type FreezeResult =
  | { readonly status: "frozen"; readonly snapshot: ExecutionSnapshot }
  | { readonly status: "execution_prepare_failed"; readonly reason: string };

function snapshotRelPath(snapshotId: string): string {
  return join("story", "governance", "execution-snapshots", `${SafeGovernanceIdSchema.parse(snapshotId)}.json`);
}

export async function saveExecutionSnapshot(
  bookDir: string,
  snapshot: ExecutionSnapshot,
): Promise<void> {
  const filePath = join(bookDir, snapshotRelPath(snapshot.snapshotId));
  await mkdir(join(bookDir, "story", "governance", "execution-snapshots"), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf-8");
}

export async function loadExecutionSnapshot(
  bookDir: string,
  snapshotId: string,
): Promise<ExecutionSnapshot | null> {
  try {
    const filePath = join(bookDir, snapshotRelPath(snapshotId));
    const raw = await readFile(filePath, "utf-8");
    return ExecutionSnapshotSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function freezeExecutionSnapshot(
  bookDir: string,
  planId: SafeGovernanceId,
  contextBundle: ContextBundle,
): Promise<FreezeResult> {
  const projectRoot = dirname(dirname(normalize(bookDir)));
  const bookId = basename(normalize(bookDir));
  const manager = new StateManager(projectRoot);

  let releaseLock: (() => Promise<void>) | null = null;
  try {
    releaseLock = await manager.acquireBookLock(bookId);
  } catch (error) {
    // If book is busy, return prepare failed
    return {
      status: "execution_prepare_failed",
      reason: `Could not acquire book lock for "${bookId}": ${(error as Error).message}`,
    };
  }

  try {
    // 1. Load exact persisted plan inside lock
    const plan = await loadDetailedPlan(bookDir, planId);
    if (!plan) {
      return {
        status: "execution_prepare_failed",
        reason: `Detailed chapter plan "${planId}" not found in governance store`,
      };
    }

    // 2. Validate exact planHash against persisted content
    const expectedHash = computeProseRevision(JSON.stringify({
      chapterNumber: plan.chapterNumber,
      intent: plan.intent,
      memo: plan.memo,
      bindings: plan.bindings,
    }));
    if (plan.planHash !== expectedHash) {
      return {
        status: "execution_prepare_failed",
        reason: `Plan hash corrupt or mismatched: record has ${plan.planHash}, computed ${expectedHash}`,
      };
    }

    // 3. Re-evaluate Planning Gate inside lock
    const gateResult = await evaluatePlanningGate({ bookDir, planId });
    if (gateResult.outcome !== "safe") {
      return {
        status: "execution_prepare_failed",
        reason: `Planning gate outcome is "${gateResult.outcome}", required "safe" to freeze snapshot`,
      };
    }

    // 4. Validate ContextBundle exact binding and staleness
    if (
      contextBundle.subject.kind !== "detailed_plan" ||
      contextBundle.subject.planId !== plan.planId ||
      contextBundle.subject.planHash !== plan.planHash
    ) {
      return {
        status: "execution_prepare_failed",
        reason: "ContextBundle subject does not match target detailed plan identity/hash",
      };
    }

    const isStale = await isBundleStale(bookDir, contextBundle);
    if (isStale) {
      return {
        status: "execution_prepare_failed",
        reason: "ContextBundle is stale due to upstream authority or subject modification",
      };
    }

    // 5. Revalidate Foundation, Arc, and Canon versions
    const store = createVersionStore(bookDir);
    const currentFound = await store.readCurrentVersion<FoundationPublishedSnapshot>("foundation", "foundation").catch(() => null);
    const currentFoundVer = currentFound ? currentFound.version : 0;
    if (currentFoundVer !== plan.bindings.foundationVersion) {
      return {
        status: "execution_prepare_failed",
        reason: `Foundation version mismatch: plan bound to v${plan.bindings.foundationVersion}, current published is v${currentFoundVer}`,
      };
    }

    const currentArc = await store.readCurrentVersion<ArcPlanSnapshot>("arc_plan", "arc-1").catch(() => null);
    const currentArcVer = currentArc ? currentArc.version : 0;
    if (currentArcVer !== plan.bindings.arcPlanVersion) {
      return {
        status: "execution_prepare_failed",
        reason: `Arc Plan version mismatch: plan bound to v${plan.bindings.arcPlanVersion}, current published is v${currentArcVer}`,
      };
    }

    const currentCanonRev = await readCurrentCanonRevision(bookDir).catch(() => 0);
    if (currentCanonRev !== plan.bindings.canonRevision) {
      return {
        status: "execution_prepare_failed",
        reason: `Canon revision mismatch: plan bound to rev ${plan.bindings.canonRevision}, current is rev ${currentCanonRev}`,
      };
    }

    // 6. Revalidate typed dependencies
    for (const dep of plan.bindings.dependencyRefs) {
      if (dep.kind === "human_direction") {
        const dir = await loadHumanDirection(bookDir, dep.directionId);
        if (!dir || dir.lifecycle !== "active" || dir.lifecycleRevision !== dep.lifecycleRevision) {
          return {
            status: "execution_prepare_failed",
            reason: `Human Direction dependency "${dep.directionId}" observed state changed or is inactive`,
          };
        }
      } else if (dep.kind === "authorization") {
        const auth = await loadAuthorization(bookDir, dep.authorizationId);
        if (!auth || auth.lifecycle !== "active" || auth.lifecycleRevision !== dep.lifecycleRevision) {
          return {
            status: "execution_prepare_failed",
            reason: `Authorization dependency "${dep.authorizationId}" observed state changed or is inactive`,
          };
        }
      }
    }

    // 7. Create and persist immutable snapshot
    const snapshot: ExecutionSnapshot = {
      snapshotId: `snapshot-${randomUUID()}`,
      chapterNumber: plan.chapterNumber,
      planId: plan.planId,
      planHash: plan.planHash,
      bindings: plan.bindings,
      contextBundleId: contextBundle.bundleId,
      frozenAt: new Date().toISOString(),
    };

    await saveExecutionSnapshot(bookDir, snapshot);

    return {
      status: "frozen",
      snapshot,
    };
  } catch (err) {
    return {
      status: "execution_prepare_failed",
      reason: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (releaseLock) {
      await releaseLock().catch(() => {});
    }
  }
}
