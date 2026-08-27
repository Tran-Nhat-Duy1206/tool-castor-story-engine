import {
  FoundationDependencyKind,
  FoundationDependencyKindSchema,
  FoundationDependencyRef,
  SafeGovernanceIdSchema,
} from "./contracts.js";
import {
  FoundationUnitManifest,
  readUnitManifests,
  writeUnitManifest,
} from "../foundation/manifest.js";

// ===========================================================================
// Foundation dependency management (Task 4).
//
// - Core owns the dependency vocabulary (Task 1 FoundationDependencyKind);
//   AI selects valid concrete links, never invents semantics.
// - Invalidation is DIRECT ONLY: changing A marks only A's DIRECT dependents
//   stale; transitive staleness happens only when the intermediate artifact's
//   own authoritative content actually changes (A → B → C scenario).
// - `status: "stale"` is the single durable stale truth; invalidation never
//   modifies Markdown or Canon, never publishes, never approves.
// ===========================================================================

export interface DependencyDeclaration {
  readonly unitId: string;
  readonly kind: FoundationDependencyKind;
  readonly targetUnitId: string;
}

/**
 * Declare (validate) a dependency link. Throws on unknown kinds (Core-owned
 * vocabulary only) or unsafe governed ids. Pure — no persistence.
 */
export function declareDependency(unitId: string, kind: FoundationDependencyKind, targetUnitId: string): void {
  const parsedKind = FoundationDependencyKindSchema.parse(kind); // unknown kind fails closed
  SafeGovernanceIdSchema.parse(unitId);
  SafeGovernanceIdSchema.parse(targetUnitId);
  void parsedKind;
}

/**
 * Validate a dependency graph: returns error strings for unknown kinds,
 * dangling targets, and dependency CYCLES (fail closed). Empty array = clean.
 */
export function validateDependencyGraph(manifests: ReadonlyArray<FoundationUnitManifest>): ReadonlyArray<string> {
  const errors: string[] = [];
  const byId = new Map(manifests.map((manifest) => [manifest.unitId, manifest]));

  for (const manifest of manifests) {
    for (const dep of manifest.dependencies) {
      const kindParsed = FoundationDependencyKindSchema.safeParse(dep.kind);
      if (!kindParsed.success) {
        errors.push(`Unit "${manifest.unitId}" declares unknown dependency kind "${dep.kind}".`);
        continue;
      }
      if (!byId.has(dep.targetUnitId)) {
        errors.push(`Unit "${manifest.unitId}" depends on missing unit "${dep.targetUnitId}".`);
      }
    }
  }

  // Cycle detection (iterative DFS).
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const visit = (unitId: string): void => {
    if (visited.has(unitId) || visiting.has(unitId)) return;
    visiting.add(unitId);
    stack.push(unitId);
    const manifest = byId.get(unitId);
    if (manifest) {
      for (const dep of manifest.dependencies) {
        if (visiting.has(dep.targetUnitId)) {
          const cycle = [...stack.slice(stack.indexOf(dep.targetUnitId)), dep.targetUnitId].join(" → ");
          errors.push(`Dependency cycle detected: ${cycle}`);
        } else {
          visit(dep.targetUnitId);
        }
      }
    }
    stack.pop();
    visiting.delete(unitId);
    visited.add(unitId);
  };
  for (const unitId of byId.keys()) visit(unitId);

  return errors;
}

/**
 * Invalidate DIRECT dependents of a unit: every manifest that declares a
 * dependency on `unitId` becomes `status: "stale"` (preserving its creative
 * Markdown, contentHash, contentRevision and approvedRevision). Transitive
 * dependents are NOT touched. Returns the unitIds that were marked stale.
 * Never modifies Markdown/Canon; never publishes; never approves.
 */
export async function invalidateDirectDependents(bookDir: string, unitId: string): Promise<ReadonlyArray<string>> {
  SafeGovernanceIdSchema.parse(unitId);
  const manifests = await readUnitManifests(bookDir);
  const marked: string[] = [];
  for (const manifest of manifests.values()) {
    if (manifest.unitId === unitId) continue;
    if (!manifest.dependencies.some((dep: FoundationDependencyRef) => dep.targetUnitId === unitId)) continue;
    if (manifest.status === "stale") continue; // idempotent
    if (manifest.status === "legacy_established") continue; // legacy snapshot — no approval state to invalidate
    await writeUnitManifest(bookDir, { ...manifest, status: "stale" });
    marked.push(manifest.unitId);
  }
  return marked;
}
