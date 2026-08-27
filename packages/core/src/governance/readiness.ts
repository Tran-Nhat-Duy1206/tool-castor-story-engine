import { readUnitManifests } from "../foundation/manifest.js";
import type { FoundationUnitManifest } from "../foundation/manifest.js";
import { isUnitApproved } from "../foundation/manifest.js";
import { bootstrapFoundation } from "../foundation/bootstrap.js";

// ===========================================================================
// Foundation readiness (Task 4). Deterministic Core evaluation only — this is
// NOT a second readiness truth source; statuses/revisions come from the
// manifest store. `status: "stale"` remains the single durable stale truth.
// ===========================================================================

export interface ReadinessReport {
  readonly blockingReasons: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
  readonly nextRecommendedAction: string | null;
}

/** A unit is valid-and-ready iff it is structurally approved (Task 2 invariant). */
export function isUnitReady(manifest: FoundationUnitManifest): boolean {
  return isUnitApproved(manifest);
}

/** Protagonist rule: the protagonist is ALWAYS required — a designated
 * required character unit must exist and be ready. */
function designatedProtagonist(manifests: ReadonlyArray<FoundationUnitManifest>): FoundationUnitManifest | undefined {
  return manifests.find((manifest) => manifest.kind === "character" && manifest.importance === "required");
}

/**
 * Evaluate Foundation readiness for an explicit manifest set.
 * Rules:
 *  1. required units not valid/ready → BLOCK.
 *  2. optional units normally do NOT block.
 *  3. an optional unit DOES block when a required (authoritative) unit
 *     explicitly depends on it (direct dependency gating).
 *  4. protagonist is always required (a required character unit must be ready).
 *  5. approval respects the Task 2 revision invariant
 *     (status "approved" && approvedRevision === contentRevision).
 * legacy_established units are NEVER treated as approved.
 */
export async function evaluateFoundationReadiness(
  bookDir: string,
  manifests: ReadonlyArray<FoundationUnitManifest>,
): Promise<ReadinessReport> {
  const blockingReasons: string[] = [];
  const warnings: string[] = [];
  const byId = new Map(manifests.map((manifest) => [manifest.unitId, manifest]));

  // Rule 4 — protagonist always required.
  const protagonist = designatedProtagonist(manifests);
  if (!protagonist) {
    blockingReasons.push("No protagonist designated: no character unit with importance \"required\" exists.");
  } else if (!isUnitReady(protagonist)) {
    blockingReasons.push(`Protagonist unit "${protagonist.unitId}" is not approved (${protagonist.status}).`);
  }

  // Rule 1 — required units must be ready; Rule 3 — their declared
  // dependencies (even optional targets) must also be ready.
  for (const manifest of manifests) {
    if (manifest.importance === "required") {
      if (!isUnitReady(manifest)) {
        blockingReasons.push(
          `Required unit "${manifest.unitId}" is not ready: status ${manifest.status}`
          + (manifest.status === "approved" && manifest.approvedRevision !== manifest.contentRevision
            ? " (approvedRevision !== contentRevision)"
            : ""),
        );
      }
      for (const dep of manifest.dependencies) {
        const target = byId.get(dep.targetUnitId);
        if (!target) {
          blockingReasons.push(`Required unit "${manifest.unitId}" depends on missing unit "${dep.targetUnitId}".`);
        } else if (!isUnitReady(target)) {
          // Rule 3: an optional (or any) authoritative dependency target must be ready.
          blockingReasons.push(
            `Required unit "${manifest.unitId}" depends on unit "${dep.targetUnitId}" which is not ready (status ${target.status}).`,
          );
        }
      }
    } else if (manifest.importance === "optional" && !isUnitReady(manifest)) {
      warnings.push(`Optional unit "${manifest.unitId}" is not approved (${manifest.status}); it does not block unless depended on.`);
    }
  }

  const nextRecommendedAction = blockingReasons.length > 0
    ? firstBlockingAction(blockingReasons[0]!, manifests)
    : null;

  return { blockingReasons, warnings, nextRecommendedAction };
}

function firstBlockingAction(reason: string, manifests: ReadonlyArray<FoundationUnitManifest>): string {
  if (/protagonist/i.test(reason)) {
    return "Designate the protagonist: mark a character unit as importance required and approve it.";
  }
  const unitMatch = /"(.*?)"/.exec(reason);
  if (unitMatch) {
    const unitId = unitMatch[1]!;
    const manifest = manifests.find((m) => m.unitId === unitId);
    if (manifest) {
      if (manifest.status === "legacy_established") {
        return `Open a Foundation upgrade/revision for unit "${unitId}" (legacy content must be reviewed and approved by a Human).`;
      }
      return `Open a Foundation revision and approve/repair unit "${unitId}".`;
    }
  }
  return "Review the Foundation readiness blockers and resolve them through the revision workflow.";
}

/**
 * Chapter 1 Foundation readiness: loads current governance state (V2 manifests
 * when present, otherwise the legacy bootstrap snapshot) and requires the
 * Chapter-1 authority set — the four Story Frame units, the designated
 * protagonist, the first Arc/Volume Direction, and required Book Rules — all
 * approved per the revision invariant.
 */
export async function evaluateChapter1Readiness(bookDir: string): Promise<ReadinessReport> {
  const stored = await readUnitManifests(bookDir);
  const manifests = stored.size > 0
    ? [...stored.values()]
    : (await bootstrapFoundation(bookDir)).units;

  const blockingReasons: string[] = [];
  const warnings: string[] = [];

  const chapter1Required = [
    "sf-theme-tone",
    "sf-core-conflict",
    "sf-world-setting",
    "sf-ending-direction",
    "arc-direction",
  ];
  const byId = new Map(manifests.map((m) => [m.unitId, m]));
  for (const requiredId of chapter1Required) {
    const manifest = byId.get(requiredId);
    if (!manifest) {
      blockingReasons.push(`Chapter 1 requires unit "${requiredId}" but it is missing.`);
    } else if (!isUnitReady(manifest)) {
      blockingReasons.push(
        `Chapter 1 requires unit "${requiredId}" to be approved (status ${manifest.status}).`,
      );
    }
  }

  // Protagonist (always required) + other REQUIRED major characters.
  const requiredCharacters = manifests.filter((m) => m.kind === "character" && m.importance === "required");
  if (requiredCharacters.length === 0) {
    blockingReasons.push("Chapter 1 requires a designated protagonist (required character unit).");
  } else {
    for (const character of requiredCharacters) {
      if (!isUnitReady(character)) {
        blockingReasons.push(`Required character "${character.unitId}" is not approved (${character.status}).`);
      }
    }
  }

  // Required Book Rules.
  const requiredRules = manifests.filter((m) => m.kind === "book_rule" && m.importance === "required");
  for (const rule of requiredRules) {
    if (!isUnitReady(rule)) {
      blockingReasons.push(`Required Book Rule "${rule.unitId}" is not approved (${rule.status}).`);
    }
  }

  for (const manifest of manifests) {
    if (manifest.importance === "optional" && !isUnitReady(manifest)) {
      warnings.push(`Optional unit "${manifest.unitId}" is not approved (${manifest.status}).`);
    }
  }

  return {
    blockingReasons,
    warnings,
    nextRecommendedAction: blockingReasons.length > 0
      ? firstBlockingAction(blockingReasons[0]!, manifests)
      : null,
  };
}
