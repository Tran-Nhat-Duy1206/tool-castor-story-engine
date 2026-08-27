import { z } from "zod";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SafeGovernanceIdSchema } from "../governance/contracts.js";
import {
  readCurrentCanonRevision,
  readRevisionUnitDraft,
  loadHumanResolution,
  isResolutionStillValid,
} from "../governance/conflicts.js";
import {
  readUnitManifests,
  writeUnitManifest,
  governedContentHash,
  type FoundationUnitManifest,
} from "./manifest.js";
import {
  loadFoundationRevision,
  openFoundationRevision,
  saveFoundationUnitDraft,
  type FoundationRevisionDraft,
} from "./revision-service.js";
import {
  createVersionStore,
  type FoundationPublishedSnapshot,
  type FoundationUnitRef,
} from "../governance/versions.js";
import { validateDependencyGraph } from "../governance/dependencies.js";
import { reviewFoundationRevision } from "./review.js";
import { runTransaction, type TransactionStage } from "../governance/transactions.js";
import type { AtomicFileWrite } from "../utils/atomic-file-set.js";

// ===========================================================================
// Phase 5 Task 9 — Foundation Human Publish
//
// Trusted Foundation Publish Gate + explicit Human Publish + atomic V2 marker
// activation + external edit handling, built on TransactionCoordinator.
//
// POLICIES & BOUNDARIES:
// 1. HUMAN-ONLY PUBLISH: publishFoundation is the ONLY operation creating
//    Foundation authority. Task 10 AI pipeline cannot call Publish. No autoPublish,
//    no --force, no bypasses.
// 2. TRUSTED PUBLISH INPUT: Caller provides intent and expected bases only.
//    Core loads/verifies all truth from persistence (hashes, revisions, resolutions).
// 3. REVALIDATE INSIDE LOCK: Current authority and bases are re-checked inside
//    the book lock immediately before commit. Base mismatch returns revision_base_stale.
// 4. GLOBAL FOUNDATION VERSION: Exactly one next Foundation vN per publish.
// 5. ATOMIC V2 MARKER: First publish atomically commits v1 + marker (governance.foundation = "v2").
// 6. DIRECT INVALIDATION: Direct-only dependency invalidations committed in the SAME transaction.
// 7. EXTERNAL EDITS: External edits to Published Markdown are detected and reset approval.
// ===========================================================================

export interface PublishGateInput {
  readonly bookDir: string;
  readonly revisionId: string;
  readonly humanActor: string;
  readonly expectedBaseFoundationVersion: number;
  readonly expectedBaseCanonRevision: number;
  readonly failAtStage?: TransactionStage;
}

export interface PublishGateResult {
  readonly ok: boolean;
  readonly failures: ReadonlyArray<string>;
}

export type PublishOutcome =
  | { status: "published"; version: number }
  | { status: "revision_base_stale" }
  | { status: "external_change_detected" };

function validateHumanActor(actor: string): string {
  const parsed = z.string().min(1, "humanActor must not be empty").parse(actor).trim();
  const lower = parsed.toLowerCase();
  if (["system", "ai", "llm", "auto", "automated", "bot"].includes(lower)) {
    throw new Error(`Approval requires an explicit Human actor, not AI or system: "${actor}"`);
  }
  return parsed;
}

function publishedBaselinePath(bookDir: string, unitId: string): string {
  return join(bookDir, "story", "foundation-v2", `${unitId}.published.md`);
}

async function detectExternalChanges(bookDir: string): Promise<ReadonlyArray<string>> {
  const manifests = await readUnitManifests(bookDir);
  const changedUnits: string[] = [];

  for (const [unitId, manifest] of manifests) {
    const pubRel = manifest.locator.sourceRelPath;
    const pubPath = join(bookDir, pubRel);
    try {
      const diskContent = await readFile(pubPath, "utf-8");
      const diskHash = governedContentHash(diskContent);

      // Check baseline copy if available, else manifest.contentHash
      let expectedHash = manifest.contentHash;
      try {
        const baselineContent = await readFile(publishedBaselinePath(bookDir, unitId), "utf-8");
        expectedHash = governedContentHash(baselineContent);
      } catch {
        // Fall back to manifest.contentHash if baseline file does not exist yet
      }

      if (diskHash !== expectedHash) {
        changedUnits.push(unitId);
      }
    } catch {
      // If published file doesn't exist, not an external edit
    }
  }

  return changedUnits;
}

export async function checkFoundationPublishGate(input: PublishGateInput): Promise<PublishGateResult> {
  const failures: string[] = [];

  try {
    SafeGovernanceIdSchema.parse(input.revisionId);
  } catch {
    failures.push(`Invalid revisionId: "${input.revisionId}"`);
    return { ok: false, failures };
  }

  try {
    validateHumanActor(input.humanActor);
  } catch (error) {
    failures.push((error as Error).message);
  }

  let draft: FoundationRevisionDraft;
  try {
    draft = await loadFoundationRevision(input.bookDir, input.revisionId);
  } catch (error) {
    failures.push(`Failed to load revision "${input.revisionId}": ${(error as Error).message}`);
    return { ok: false, failures };
  }

  if (draft.status === "discarded") {
    failures.push(`Revision "${input.revisionId}" is discarded`);
  }

  // Check expected base versions
  const store = createVersionStore(input.bookDir);
  const currentVer = await store.readCurrentVersion<FoundationPublishedSnapshot>("foundation", "foundation");
  const currentBaseFoundationVersion = currentVer ? currentVer.version : 0;
  if (currentBaseFoundationVersion !== input.expectedBaseFoundationVersion) {
    failures.push(
      `Expected base Foundation version mismatch: expected ${input.expectedBaseFoundationVersion}, current is ${currentBaseFoundationVersion}`,
    );
  }

  const currentCanon = await readCurrentCanonRevision(input.bookDir);
  if (currentCanon !== input.expectedBaseCanonRevision) {
    failures.push(
      `Expected base Canon revision mismatch: expected ${input.expectedBaseCanonRevision}, current is ${currentCanon}`,
    );
  }

  // Check draft unit approvals and content integrity
  for (const unit of draft.unitStates) {
    if (unit.state !== "approved") {
      failures.push(`Unit "${unit.unitId}" is not approved (state: ${unit.state})`);
      continue;
    }

    if (unit.approvedRevision === undefined || unit.approvedRevision !== unit.contentRevision) {
      failures.push(
        `Unit "${unit.unitId}" approval invariant violated: approvedRevision (${unit.approvedRevision}) !== contentRevision (${unit.contentRevision})`,
      );
    }

    const approvalRec = draft.approvalRecords.find((r) => r.unitId === unit.unitId);
    if (!approvalRec) {
      failures.push(`Unit "${unit.unitId}" lacks an approval record`);
    }

    const draftProse = await readRevisionUnitDraft(input.bookDir, draft.revisionId, unit.unitId);
    if (draftProse === null) {
      failures.push(`Draft prose file missing for unit "${unit.unitId}"`);
      continue;
    }

    const recomputedHash = governedContentHash(draftProse);
    if (recomputedHash !== unit.contentHash) {
      failures.push(
        `Working Markdown changed after approval for unit "${unit.unitId}" (hash mismatch: expected ${unit.contentHash}, found ${recomputedHash})`,
      );
    }
  }

  // Check dependency graph
  const existingManifests = await readUnitManifests(input.bookDir);
  const graphManifests: FoundationUnitManifest[] = [...existingManifests.values()];
  const depErrors = validateDependencyGraph(graphManifests);
  if (depErrors.length > 0) {
    failures.push(...depErrors);
  }

  // Check unresolved Task 6 conflict findings
  const findingsDir = join(input.bookDir, "story", "governance", "findings", draft.revisionId);
  try {
    const entries = await readdir(findingsDir);
    for (const entry of entries) {
      if (!entry.endsWith(".gov.json")) continue;
      const raw = await readFile(join(findingsDir, entry), "utf-8");
      const finding = JSON.parse(raw) as { findingId: string; unitId: string };

      // Find resolution in resolutions directory
      const resolutionsDir = join(input.bookDir, "story", "governance", "resolutions");
      let resolved = false;
      try {
        const resEntries = await readdir(resolutionsDir);
        for (const resEntry of resEntries) {
          if (!resEntry.endsWith(".gov.json")) continue;
          const resRaw = await readFile(join(resolutionsDir, resEntry), "utf-8");
          const res = JSON.parse(resRaw) as {
            resolutionId: string;
            revisionId: string;
            findingId: string;
            choice: string;
          };
          if (res.revisionId === draft.revisionId && res.findingId === finding.findingId && res.choice === "compatible") {
            const valid = await isResolutionStillValid(input.bookDir, res.resolutionId);
            if (valid) {
              resolved = true;
              break;
            }
          }
        }
      } catch {
        // No resolutions directory
      }

      if (!resolved) {
        failures.push(`Unresolved conflict finding "${finding.findingId}" on unit "${finding.unitId}"`);
      }
    }
  } catch {
    // No findings dir
  }

  // Check Task 7 review findings
  try {
    const reviewFindings = await reviewFoundationRevision(input.bookDir, draft.revisionId);
    if (reviewFindings.length > 0) {
      failures.push(`Unresolved review findings on revision: ${reviewFindings.map((f) => f.findingId).join(", ")}`);
    }
  } catch (error) {
    failures.push((error as Error).message);
  }

  // Check external edits on published files
  const externalChanges = await detectExternalChanges(input.bookDir);
  if (externalChanges.length > 0) {
    failures.push(`External change detected on published units: ${externalChanges.join(", ")}`);
  }

  return { ok: failures.length === 0, failures };
}

export async function publishFoundation(input: PublishGateInput): Promise<PublishOutcome> {
  const validHuman = validateHumanActor(input.humanActor);
  const safeRevision = SafeGovernanceIdSchema.parse(input.revisionId);

  // Preliminary check for external edits before transaction
  const initialExternal = await detectExternalChanges(input.bookDir);
  if (initialExternal.length > 0) {
    return { status: "external_change_detected" };
  }

  const initialGate = await checkFoundationPublishGate(input);
  if (!initialGate.ok) {
    return { status: "revision_base_stale" };
  }

  const store = createVersionStore(input.bookDir);
  const currentVer = await store.readCurrentVersion<FoundationPublishedSnapshot>("foundation", "foundation");
  const nextVersion = (currentVer ? currentVer.version : 0) + 1;
  const now = new Date().toISOString();

  const draft = await loadFoundationRevision(input.bookDir, safeRevision);
  const existingManifests = await readUnitManifests(input.bookDir);

  const writes: AtomicFileWrite[] = [];

  // 1. Materialize Published Markdown and baseline files
  for (const unit of draft.unitStates) {
    const content = await readRevisionUnitDraft(input.bookDir, safeRevision, unit.unitId);
    if (content === null) {
      throw new Error(`Draft content missing for unit "${unit.unitId}"`);
    }

    const existingManifest = existingManifests.get(unit.unitId);
    const targetRelPath = existingManifest
      ? existingManifest.locator.sourceRelPath
      : `story/outline/${unit.unitId}.md`;

    writes.push({
      relativePath: targetRelPath,
      content,
    });

    // Write baseline copy for external change detection
    writes.push({
      relativePath: `story/foundation-v2/${unit.unitId}.published.md`,
      content,
    });

    // Update or create unit manifest
    const updatedManifest: FoundationUnitManifest = {
      unitId: unit.unitId,
      kind: existingManifest ? existingManifest.kind : "story_frame",
      importance: existingManifest ? existingManifest.importance : "required",
      status: "approved",
      approvedRevision: unit.contentRevision,
      contentRevision: unit.contentRevision,
      contentHash: unit.contentHash,
      dependencies: existingManifest ? existingManifest.dependencies : [],
      locator: existingManifest
        ? existingManifest.locator
        : { contentKind: "whole_file", sourceRelPath: targetRelPath },
    };

    writes.push({
      relativePath: `story/foundation-v2/${unit.unitId}.gov.json`,
      content: `${JSON.stringify(updatedManifest, null, 2)}\n`,
    });
  }

  // 2. Direct dependency invalidations in the same transaction
  const changedUnitIds = draft.unitStates.map((u) => u.unitId);
  const dependencyImpact: string[] = [];

  for (const [unitId, manifest] of existingManifests) {
    if (draft.unitStates.some((u) => u.unitId === unitId)) continue;
    if (manifest.dependencies.some((dep) => changedUnitIds.includes(dep.targetUnitId))) {
      if (manifest.status !== "stale") {
        const invalidated: FoundationUnitManifest = {
          ...manifest,
          status: "stale",
        };
        writes.push({
          relativePath: `story/foundation-v2/${unitId}.gov.json`,
          content: `${JSON.stringify(invalidated, null, 2)}\n`,
        });
        dependencyImpact.push(unitId);
      }
    }
  }

  // 3. Build FoundationPublishedSnapshot and global version records
  const unitRefs: FoundationUnitRef[] = [];
  for (const u of draft.unitStates) {
    unitRefs.push({
      unitId: u.unitId,
      contentRevision: u.contentRevision,
      approvedRevision: u.contentRevision,
      contentHash: u.contentHash,
    });
  }

  if (currentVer) {
    for (const ref of currentVer.snapshot.unitRefs) {
      if (!unitRefs.some((r) => r.unitId === ref.unitId)) {
        unitRefs.push(ref);
      }
    }
  }

  const snapshot: FoundationPublishedSnapshot = {
    unitRefs,
    changedUnitIds,
    humanResolutionIds: [],
    dependencyImpact,
    baseCanonRevision: input.expectedBaseCanonRevision,
  };

  const prep = await store.prepareVersionAppend({
    artifactKind: "foundation",
    unitId: "foundation",
    version: nextVersion,
    parentVersion: currentVer ? currentVer.version : null,
    baseCanonRevision: input.expectedBaseCanonRevision,
    snapshot,
    publishedBy: validHuman,
  });

  // Inject publishedAt timestamp into prepared version record
  for (const w of prep.writes) {
    const parsed = JSON.parse(w.content as string);
    parsed.publishedAt = now;
    writes.push({
      relativePath: w.relativePath,
      content: `${JSON.stringify(parsed, null, 2)}\n`,
    });
  }

  const pointer = store.prepareCurrentVersionPointer("foundation", "foundation", nextVersion);
  writes.push(pointer);

  // 4. First V2 Publish — Atomic Marker in book.json
  try {
    const rawBook = await readFile(join(input.bookDir, "book.json"), "utf-8");
    const bookObj = JSON.parse(rawBook);
    if (!bookObj.governance || bookObj.governance.foundation !== "v2") {
      bookObj.governance = {
        ...(bookObj.governance ?? {}),
        foundation: "v2",
        planning: bookObj.governance?.planning ?? "legacy",
      };
      writes.push({
        relativePath: "book.json",
        content: `${JSON.stringify(bookObj, null, 2)}\n`,
      });
    }
  } catch {
    // book.json missing or invalid
  }

  // 5. Execute transaction with inside-lock revalidation
  const txResult = await runTransaction({
    bookDir: input.bookDir,
    writes,
    deletes: [],
    revalidate: async () => {
      // Re-read current authority and bases inside the lock
      const gate = await checkFoundationPublishGate(input);
      if (!gate.ok) {
        return gate.failures;
      }
      return [];
    },
    failAtStage: input.failAtStage,
  });

  if (txResult.status === "revision_base_stale") {
    if (txResult.reasons.some((r) => /external.*change/i.test(r))) {
      return { status: "external_change_detected" };
    }
    return { status: "revision_base_stale" };
  }

  return { status: "published", version: nextVersion };
}

export async function handleExternalEdit(
  bookDir: string,
  unitId: string,
  action: "compare" | "adopt_into_revision" | "discard",
): Promise<{
  action: "compare" | "adopt_into_revision" | "discard";
  hasExternalEdit: boolean;
  revisionId?: string;
  diskContent?: string;
  authoritativeContent?: string;
}> {
  const safeUnit = SafeGovernanceIdSchema.parse(unitId);
  const manifests = await readUnitManifests(bookDir);
  const manifest = manifests.get(safeUnit);

  const targetRelPath = manifest
    ? manifest.locator.sourceRelPath
    : `story/outline/${safeUnit}.md`;

  const pubPath = join(bookDir, targetRelPath);
  let diskContent = "";
  try {
    diskContent = await readFile(pubPath, "utf-8");
  } catch {
    return { action, hasExternalEdit: false };
  }

  let authoritativeContent = "";
  const baselinePath = publishedBaselinePath(bookDir, safeUnit);
  try {
    authoritativeContent = await readFile(baselinePath, "utf-8");
  } catch {
    if (manifest) {
      authoritativeContent = diskContent; // no baseline recorded yet
    }
  }

  const diskHash = governedContentHash(diskContent);
  const authHash = authoritativeContent ? governedContentHash(authoritativeContent) : "";
  const hasExternalEdit = authoritativeContent !== "" && diskHash !== authHash;

  if (!hasExternalEdit) {
    return { action, hasExternalEdit: false, diskContent, authoritativeContent };
  }

  if (action === "compare") {
    return { action, hasExternalEdit: true, diskContent, authoritativeContent };
  }

  if (action === "adopt_into_revision") {
    const { revisionId } = await openFoundationRevision(bookDir, [safeUnit]);
    await saveFoundationUnitDraft(bookDir, revisionId, safeUnit, diskContent);
    // Restore published file to authoritative content so published authority stays intact
    if (authoritativeContent) {
      await writeFile(pubPath, authoritativeContent, "utf-8");
    }
    return { action, hasExternalEdit: true, revisionId, diskContent, authoritativeContent };
  }

  if (action === "discard") {
    if (authoritativeContent) {
      await writeFile(pubPath, authoritativeContent, "utf-8");
    }
    return { action, hasExternalEdit: true, diskContent, authoritativeContent };
  }

  return { action, hasExternalEdit: false };
}