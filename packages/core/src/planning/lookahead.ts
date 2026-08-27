import { z } from "zod";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  LookaheadStatusSchema,
  PlanningDependencyRefSchema,
  SafeGovernanceIdSchema,
  type LookaheadStatus,
  type PlanningDependencyRef,
  type SafeGovernanceId,
} from "../governance/contracts.js";
import {
  registerPlanningArtifact,
  unregisterPlanningArtifact,
} from "./invalidation-registry.js";
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
import { type ArcPlanSnapshot } from "./arc-plan.js";
import { commitAtomicFileSet } from "../utils/atomic-file-set.js";

// ===========================================================================
// Phase 5 Task 14 — Rolling Lookahead & Typed Selective Invalidation
//
// Advisory only: 2–3 lightweight chapter intentions ahead of the writer.
// No "approved" state, no publish operation, no authority pointer, no
// authorization granting.
//
// Typed Selective Invalidation:
// An UNRELATED Canon/Foundation change does NOT stale the Lookahead.
// A change to a DIRECTLY REFERENCED dependency DOES stale the Lookahead.
//
// Integration:
// Registers through Task 12 PlanningInvalidationRegistry (artifactKind: "lookahead")
// so Arc Publish invalidates it generically.
// ===========================================================================

export const LookaheadHorizonItemSchema = z.object({
  chapterNumber: z.number().int().min(1),
  intention: z.string().trim().min(1).max(2000),
}).strict();

export type LookaheadHorizonItem = z.infer<typeof LookaheadHorizonItemSchema>;

export const RollingLookaheadProvenanceSchema = z.object({
  foundationVersion: z.number().int().min(0),
  arcPlanVersion: z.number().int().min(0),
  basedOnCanonRevision: z.number().int().min(0),
  dependencyRefs: z.array(PlanningDependencyRefSchema),
}).strict();

export type RollingLookaheadProvenance = z.infer<typeof RollingLookaheadProvenanceSchema>;

export const RollingLookaheadSchema = z.object({
  lookaheadId: SafeGovernanceIdSchema,
  status: LookaheadStatusSchema,
  horizon: z.array(LookaheadHorizonItemSchema).min(2).max(3),
  provenance: RollingLookaheadProvenanceSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional(),
}).strict();

export type RollingLookahead = z.infer<typeof RollingLookaheadSchema>;

function lookaheadRelPath(lookaheadId: string): string {
  return join("story", "governance", "lookaheads", `${SafeGovernanceIdSchema.parse(lookaheadId)}.json`);
}

function serialized(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function saveLookahead(
  bookDir: string,
  record: RollingLookahead,
): Promise<void> {
  const validated = RollingLookaheadSchema.parse(record);
  await commitAtomicFileSet({
    rootDir: bookDir,
    writes: [
      {
        relativePath: lookaheadRelPath(validated.lookaheadId),
        content: serialized(validated),
      },
    ],
  });
}

export async function loadLookahead(
  bookDir: string,
  lookaheadId: string,
): Promise<RollingLookahead | null> {
  const validId = SafeGovernanceIdSchema.parse(lookaheadId);
  const fullPath = join(bookDir, lookaheadRelPath(validId));
  try {
    const raw = await readFile(fullPath, "utf-8");
    return RollingLookaheadSchema.parse(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function listLookaheads(bookDir: string): Promise<ReadonlyArray<RollingLookahead>> {
  const dir = join(bookDir, "story", "governance", "lookaheads");
  let files: string[] = [];
  try {
    files = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const results: RollingLookahead[] = [];
  for (const file of files.filter((f) => f.endsWith(".json"))) {
    try {
      const raw = await readFile(join(dir, file), "utf-8");
      results.push(RollingLookaheadSchema.parse(JSON.parse(raw)));
    } catch {
      // Ignore corrupt entries during listing
    }
  }

  return results;
}

export interface GenerateLookaheadOptions {
  readonly currentArcId?: string;
  readonly customIntentions?: ReadonlyArray<{ chapterNumber: number; intention: string }>;
  readonly customDependencies?: ReadonlyArray<PlanningDependencyRef>;
}

export async function generateLookahead(
  bookDir: string,
  horizonChapters: number,
  options?: GenerateLookaheadOptions,
): Promise<RollingLookahead> {
  if (!Number.isInteger(horizonChapters) || horizonChapters < 2 || horizonChapters > 3) {
    throw new Error(`Horizon chapters must be 2 or 3 (received ${horizonChapters})`);
  }

  const store = createVersionStore(bookDir);
  const currentFound = await store.readCurrentVersion<FoundationPublishedSnapshot>("foundation", "foundation").catch(() => null);
  const foundationVersion = currentFound ? currentFound.version : 0;

  const currentArc = await store.readCurrentVersion<ArcPlanSnapshot>("arc_plan", options?.currentArcId ?? "arc-1").catch(() => null);
  const arcPlanVersion = currentArc ? currentArc.version : 0;

  const currentCanonRev = await readCurrentCanonRevision(bookDir).catch(() => 0);

  // Read starting chapter from Canon
  let startChapter = 1;
  try {
    const raw = await readFile(join(bookDir, "story", "state", "manifest.json"), "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed.lastAppliedChapter === "number") {
      startChapter = parsed.lastAppliedChapter + 1;
    }
  } catch {
    // Default to 1
  }

  let horizon: LookaheadHorizonItem[];
  if (options?.customIntentions && options.customIntentions.length > 0) {
    if (options.customIntentions.length !== horizonChapters) {
      throw new Error(`Custom intentions count (${options.customIntentions.length}) must match horizon chapters (${horizonChapters})`);
    }
    horizon = options.customIntentions.map((item) => LookaheadHorizonItemSchema.parse(item));
  } else {
    horizon = Array.from({ length: horizonChapters }, (_, idx) => ({
      chapterNumber: startChapter + idx,
      intention: `Lightweight narrative intention for chapter ${startChapter + idx}`,
    }));
  }

  // Supersede existing current lookaheads
  const existing = await listLookaheads(bookDir);
  for (const prev of existing) {
    if (prev.status === "current") {
      await saveLookahead(bookDir, {
        ...prev,
        status: "superseded",
        updatedAt: new Date().toISOString(),
      });
    }
  }

  const lookaheadId = `lookahead-${randomUUID()}`;
  const now = new Date().toISOString();
  const dependencyRefs: PlanningDependencyRef[] = options?.customDependencies
    ? [...options.customDependencies]
    : [];

  const record: RollingLookahead = {
    lookaheadId,
    status: "current",
    horizon,
    provenance: {
      foundationVersion,
      arcPlanVersion,
      basedOnCanonRevision: currentCanonRev,
      dependencyRefs,
    },
    createdAt: now,
    updatedAt: now,
  };

  await saveLookahead(bookDir, record);

  // Register in Task 12 PlanningInvalidationRegistry
  await registerPlanningArtifact(bookDir, {
    artifactKind: "lookahead",
    artifactId: lookaheadId,
    dependencyRefs,
    registeredAt: now,
  });

  return record;
}

export interface RevalidateLookaheadResolvers {
  readonly currentArcId?: string;
  readonly factResolver?: (key: string) => { exists: boolean; revision: string } | null;
  readonly hookResolver?: (id: string) => { lifecycleRevision: string } | null;
  readonly relationshipResolver?: (id: string) => { stateRevision: string } | null;
}

export async function revalidateLookahead(
  bookDir: string,
  lookaheadId: string,
  resolvers?: RevalidateLookaheadResolvers,
): Promise<LookaheadStatus> {
  const lookahead = await loadLookahead(bookDir, lookaheadId);
  if (!lookahead) {
    throw new Error(`Lookahead "${lookaheadId}" not found`);
  }

  if (lookahead.status === "superseded" || lookahead.status === "consumed") {
    return lookahead.status;
  }

  const store = createVersionStore(bookDir);

  // 1. Check Foundation version
  const currentFound = await store.readCurrentVersion<FoundationPublishedSnapshot>("foundation", "foundation").catch(() => null);
  const currentFoundVer = currentFound ? currentFound.version : 0;
  if (currentFoundVer !== lookahead.provenance.foundationVersion) {
    await markStale();
    return "stale";
  }

  // 2. Check Arc Plan version
  const currentArc = await store.readCurrentVersion<ArcPlanSnapshot>("arc_plan", resolvers?.currentArcId ?? "arc-1").catch(() => null);
  const currentArcVer = currentArc ? currentArc.version : 0;
  if (currentArcVer !== lookahead.provenance.arcPlanVersion) {
    await markStale();
    return "stale";
  }

  // 3. Typed selective dependency checking
  for (const dep of lookahead.provenance.dependencyRefs) {
    if (dep.kind === "canon_fact") {
      if (resolvers?.factResolver) {
        const resolved = resolvers.factResolver(dep.factKey);
        if (!resolved || !resolved.exists || resolved.revision !== dep.evidenceRevision) {
          await markStale();
          return "stale";
        }
      }
    } else if (dep.kind === "hook") {
      if (resolvers?.hookResolver) {
        const resolved = resolvers.hookResolver(dep.hookId);
        if (!resolved || resolved.lifecycleRevision !== dep.observedLifecycleRevision) {
          await markStale();
          return "stale";
        }
      }
    } else if (dep.kind === "relationship") {
      if (resolvers?.relationshipResolver) {
        const resolved = resolvers.relationshipResolver(dep.relationshipId);
        if (!resolved || resolved.stateRevision !== dep.observedStateRevision) {
          await markStale();
          return "stale";
        }
      }
    } else if (dep.kind === "foundation_unit") {
      if (dep.foundationVersion !== currentFoundVer) {
        await markStale();
        return "stale";
      }
    } else if (dep.kind === "human_direction") {
      const dir = await loadHumanDirection(bookDir, dep.directionId);
      if (!dir || dir.lifecycle !== "active" || dir.lifecycleRevision !== dep.lifecycleRevision) {
        await markStale();
        return "stale";
      }
    } else if (dep.kind === "authorization") {
      const auth = await loadAuthorization(bookDir, dep.authorizationId);
      if (!auth || auth.lifecycle !== "active" || auth.lifecycleRevision !== dep.lifecycleRevision) {
        await markStale();
        return "stale";
      }
    }
  }

  async function markStale(): Promise<void> {
    await saveLookahead(bookDir, {
      ...lookahead!,
      status: "stale",
      updatedAt: new Date().toISOString(),
    });
  }

  return "current";
}

export async function consumeLookahead(
  bookDir: string,
  lookaheadId: string,
): Promise<RollingLookahead> {
  const lookahead = await loadLookahead(bookDir, lookaheadId);
  if (!lookahead) {
    throw new Error(`Cannot consume lookahead "${lookaheadId}": not found`);
  }

  const updated: RollingLookahead = {
    ...lookahead,
    status: "consumed",
    updatedAt: new Date().toISOString(),
  };

  await saveLookahead(bookDir, updated);
  await unregisterPlanningArtifact(bookDir, "lookahead", lookaheadId);

  return updated;
}
