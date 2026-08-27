import { z } from "zod";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  PlanningArtifactKindSchema,
  PlanningDependencyRefSchema,
  SafeGovernanceIdSchema,
  type PlanningArtifactKind,
  type PlanningDependencyRef,
  type SafeGovernanceId,
} from "../governance/contracts.js";
import { commitAtomicFileSet } from "../utils/atomic-file-set.js";

// ===========================================================================
// Phase 5 Task 12 — Generic Planning Invalidation Registry
//
// Generic registry of future-planning artifacts and their DECLARED dependency
// refs. Lookahead (Task 14) and Detailed Plan (Task 15) stores register through
// it; Arc Publish (Task 13) invalidates direct dependents GENERICALLY
// (PlanningArtifactKind only) — no T14/T15 imports, no duplicate invalidation
// subsystem, per-Task typecheck preserved.
//
// DIRECT-only: only artifacts whose declared refs point at the changed key
// become stale; transitive invalidation follows only when the intermediate
// artifact's own authoritative content actually changes (same rule as
// Foundation dependencies).
// ===========================================================================

export const RegisteredPlanningArtifactSchema = z.object({
  artifactKind: PlanningArtifactKindSchema,
  artifactId: SafeGovernanceIdSchema,
  dependencyRefs: z.array(PlanningDependencyRefSchema),
  registeredAt: z.string().datetime(),
}).strict();

export type RegisteredPlanningArtifact = z.infer<typeof RegisteredPlanningArtifactSchema>;

function registryRoot(bookDir: string): string {
  return join(bookDir, "story", "governance", "planning-registry");
}

function artifactDir(bookDir: string, artifactKind: PlanningArtifactKind): string {
  return join(registryRoot(bookDir), artifactKind);
}

function artifactRelPath(artifactKind: PlanningArtifactKind, artifactId: string): string {
  return join("story", "governance", "planning-registry", artifactKind, `${SafeGovernanceIdSchema.parse(artifactId)}.json`);
}

function serialized(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function validateDependencyKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed || trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) {
    throw new Error(`Invalid dependency key: ${key}`);
  }
  return trimmed;
}

export function getDependencyTargetId(ref: PlanningDependencyRef): string {
  switch (ref.kind) {
    case "foundation_unit": return ref.unitId;
    case "canon_fact": return ref.factKey;
    case "hook": return ref.hookId;
    case "relationship": return ref.relationshipId;
    case "timeline": return ref.anchorId;
    case "character_state": return ref.characterId;
    case "arc_beat": return ref.beatId;
    case "human_direction": return ref.directionId;
    case "authorization": return ref.authorizationId;
  }
}

export async function registerPlanningArtifact(
  bookDir: string,
  entry: RegisteredPlanningArtifact,
): Promise<void> {
  const validated = RegisteredPlanningArtifactSchema.parse(entry);
  await commitAtomicFileSet({
    rootDir: bookDir,
    writes: [
      {
        relativePath: artifactRelPath(validated.artifactKind, validated.artifactId),
        content: serialized(validated),
      },
    ],
  });
}

export async function unregisterPlanningArtifact(
  bookDir: string,
  artifactKind: PlanningArtifactKind,
  artifactId: string,
): Promise<void> {
  const validKind = PlanningArtifactKindSchema.parse(artifactKind);
  const validId = SafeGovernanceIdSchema.parse(artifactId);
  const filePath = join(bookDir, artifactRelPath(validKind, validId));
  try {
    await rm(filePath, { force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function listAllRegisteredArtifacts(bookDir: string): Promise<ReadonlyArray<RegisteredPlanningArtifact>> {
  const results: RegisteredPlanningArtifact[] = [];
  const kinds: PlanningArtifactKind[] = ["lookahead", "detailed_plan"];

  for (const kind of kinds) {
    const dir = artifactDir(bookDir, kind);
    let files: string[] = [];
    try {
      files = await readdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }

    for (const file of files.filter((f) => f.endsWith(".json"))) {
      try {
        const raw = await readFile(join(dir, file), "utf-8");
        const parsed = RegisteredPlanningArtifactSchema.parse(JSON.parse(raw));
        results.push(parsed);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
    }
  }

  return results;
}

export async function listPlanningArtifactsDirectlyDependingOn(
  bookDir: string,
  dependencyKey: string,
): Promise<ReadonlyArray<{ readonly artifactKind: PlanningArtifactKind; readonly artifactId: string }>> {
  const validKey = validateDependencyKey(dependencyKey);
  const all = await listAllRegisteredArtifacts(bookDir);

  const matched: Array<{ artifactKind: PlanningArtifactKind; artifactId: string }> = [];
  for (const artifact of all) {
    const hasDirectMatch = artifact.dependencyRefs.some((ref) => {
      const targetId = getDependencyTargetId(ref);
      return targetId === validKey || `${ref.kind}:${targetId}` === validKey;
    });
    if (hasDirectMatch) {
      matched.push({
        artifactKind: artifact.artifactKind,
        artifactId: artifact.artifactId,
      });
    }
  }

  return matched;
}

export async function invalidateDirectPlanningDependents(
  bookDir: string,
  dependencyKey: string,
): Promise<ReadonlyArray<{ readonly artifactKind: PlanningArtifactKind; readonly artifactId: string }>> {
  // Direct-only: finds all artifacts whose declared dependencies point to dependencyKey.
  return listPlanningArtifactsDirectlyDependingOn(bookDir, dependencyKey);
}
