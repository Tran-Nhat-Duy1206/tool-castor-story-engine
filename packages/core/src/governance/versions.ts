import { z } from "zod";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { SafeGovernanceIdSchema, type SafeGovernanceId } from "./contracts.js";
import { computeProseRevision } from "../utils/prose-revision.js";
import type { AtomicFileWrite } from "../utils/atomic-file-set.js";

// ===========================================================================
// Generic version/history primitives (Task 5) — infrastructure ONLY.
//
// Foundation history is GLOBAL: Foundation v1 → v2 → v3, each version the
// COMPLETE authoritative Foundation state expressed as governance refs/hashes
// only (never creative prose — no shadow story store).
//
// VersionStore PREPARES writes; it NEVER commits publication writes itself.
// Task 9's TransactionCoordinator owns the actual atomic publication commit.
// There is no journal here, no TransactionCoordinator, no authority switch,
// no marker activation, no dependency-invalidation transaction.
//
// Restore = a NEW revision PROPOSAL (RevisionCandidate). It never appends a
// Published version, never moves the current pointer, never skips later
// Canon/dependency review.
// ===========================================================================

// ---------------------------------------------------------------------------
// Version envelope / global Foundation snapshot
// ---------------------------------------------------------------------------

export interface VersionEnvelope<TSnapshot> {
  readonly artifactKind: "foundation" | "arc_plan";
  /** "foundation" for the whole-Foundation snapshot; arcId for arc plans (T12). */
  readonly unitId: SafeGovernanceId;
  readonly version: number;
  readonly parentVersion: number | null;
  readonly baseCanonRevision: number;
  readonly contentHash: string;
  readonly snapshot: TSnapshot;
  readonly publishedAt: string;
  readonly publishedBy: string;
  readonly restoredFromVersion?: number;
}

export interface FoundationUnitRef {
  readonly unitId: SafeGovernanceId;
  readonly contentRevision: number;
  readonly approvedRevision: number;
  readonly contentHash: string;
}

/** Whole-Foundation authoritative snapshot — governance refs/hashes ONLY. */
export interface FoundationPublishedSnapshot {
  readonly unitRefs: ReadonlyArray<FoundationUnitRef>;
  readonly changedUnitIds: ReadonlyArray<string>;
  readonly humanResolutionIds: ReadonlyArray<string>;
  readonly dependencyImpact: ReadonlyArray<string>;
  readonly baseCanonRevision: number;
}

export type FoundationVersion = VersionEnvelope<FoundationPublishedSnapshot>;

export interface RevisionCandidate<TSnapshot> {
  readonly artifactKind: "foundation" | "arc_plan";
  readonly unitId: SafeGovernanceId;
  readonly parentVersion: number;           // = CURRENT published version
  readonly restoredFromVersion: number;     // selected historical version
  readonly baseCanonRevision: number;       // CURRENT Canon (argument)
  readonly status: "draft" | "needs_review";
  readonly snapshot: TSnapshot;
}

export interface PreparedVersionWrites {
  /** Immutable version record write ONLY — no current-pointer write, no journal. */
  readonly writes: ReadonlyArray<AtomicFileWrite>;
}

const FoundationUnitRefSchema = z.object({
  unitId: SafeGovernanceIdSchema,
  contentRevision: z.number().int().min(1),
  approvedRevision: z.number().int().min(1),
  contentHash: z.string().min(1),
}).strict();

const FoundationPublishedSnapshotSchema = z.object({
  unitRefs: z.array(FoundationUnitRefSchema),
  changedUnitIds: z.array(z.string()),
  humanResolutionIds: z.array(z.string()),
  dependencyImpact: z.array(z.string()),
  baseCanonRevision: z.number().int().min(0),
}).strict();

/** Hash of the governance payload (excludes commit metadata publishedAt). */
function versionContentHash(params: {
  artifactKind: string;
  unitId: string;
  version: number;
  parentVersion: number | null;
  baseCanonRevision: number;
  snapshot: unknown;
  restoredFromVersion?: number;
}): string {
  return computeProseRevision(JSON.stringify({
    artifactKind: params.artifactKind,
    unitId: params.unitId,
    version: params.version,
    parentVersion: params.parentVersion,
    baseCanonRevision: params.baseCanonRevision,
    restoredFromVersion: params.restoredFromVersion ?? null,
    snapshot: params.snapshot,
  }));
}

// ---------------------------------------------------------------------------
// VersionStore — PREPARE-ONLY publication writes; read/list/integrity.
// ---------------------------------------------------------------------------

function versionsRoot(bookDir: string): string {
  return join(bookDir, "story", "governance", "versions");
}

function unitRoot(bookDir: string, artifactKind: string, unitId: string): string {
  const kind = SafeGovernanceIdSchema.parse(artifactKind === "foundation" ? "foundation" : "arc_plan");
  const safeUnit = SafeGovernanceIdSchema.parse(unitId);
  return join(versionsRoot(bookDir), kind, safeUnit);
}

function versionPath(bookDir: string, artifactKind: string, unitId: string, version: number): string {
  return join(unitRoot(bookDir, artifactKind, unitId), `${version}.json`);
}

function currentPath(bookDir: string, artifactKind: string, unitId: string): string {
  return join(unitRoot(bookDir, artifactKind, unitId), "current.json");
}

async function readVersionFile<T>(bookDir: string, artifactKind: string, unitId: string, version: number): Promise<VersionEnvelope<T> | null> {
  try {
    const raw = await readFile(versionPath(bookDir, artifactKind, unitId, version), "utf-8");
    const parsed = JSON.parse(raw) as VersionEnvelope<T>;
    if (typeof parsed.version !== "number" || typeof parsed.snapshot !== "object" || parsed.snapshot === null) {
      throw new Error(`Corrupt version record: ${artifactKind}/${unitId}/${version}`);
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function listVersionNumbers(bookDir: string, artifactKind: string, unitId: string): Promise<ReadonlyArray<number>> {
  const root = unitRoot(bookDir, artifactKind, unitId);
  const entries = await readdir(root).catch(() => [] as string[]);
  return entries
    .filter((entry) => /^\d+\.json$/.test(entry))
    .map((entry) => Number.parseInt(entry, 10))
    .sort((a, b) => a - b);
}

export interface VersionStore {
  /**
   * Prepare the immutable version-record write for the NEXT global version.
   * Throws when the record would overwrite an existing committed version or
   * skip a version number. NO filesystem side effect — Task 9 commits these
   * writes atomically.
   */
  prepareVersionAppend<T>(v: Omit<VersionEnvelope<T>, "publishedAt" | "contentHash">): Promise<PreparedVersionWrites>;
  /** Prepare the current-authority pointer write (committed by Task 9). */
  prepareCurrentVersionPointer(artifactKind: "foundation" | "arc_plan", unitId: string, version: number): AtomicFileWrite;
  readVersion<T>(artifactKind: "foundation" | "arc_plan", unitId: string, version: number): Promise<VersionEnvelope<T> | null>;
  readCurrentVersion<T>(artifactKind: "foundation" | "arc_plan", unitId: string): Promise<VersionEnvelope<T> | null>;
  listVersions(artifactKind: "foundation" | "arc_plan", unitId: string): Promise<ReadonlyArray<number>>;
  verifyIntegrity(artifactKind: "foundation" | "arc_plan", unitId: string): Promise<ReadonlyArray<string>>;
}

export function createVersionStore(bookDir: string): VersionStore {
  return {
    async prepareVersionAppend<T>(v: Omit<VersionEnvelope<T>, "publishedAt" | "contentHash">): Promise<PreparedVersionWrites> {
      SafeGovernanceIdSchema.parse(v.unitId);
      const committed = await listVersionNumbers(bookDir, v.artifactKind, v.unitId);
      const nextVersion = committed.length === 0 ? 1 : (committed[committed.length - 1]! + 1);
      if (v.version !== nextVersion) {
        throw new Error(
          `Cannot prepare version ${v.version} for ${v.artifactKind}/${v.unitId}: next legal version is ${nextVersion} `
          + `(immutable history — committed versions are never overwritten or skipped).`,
        );
      }
      const contentHash = versionContentHash(v);
      const record: VersionEnvelope<T> = {
        artifactKind: v.artifactKind,
        unitId: v.unitId,
        version: v.version,
        parentVersion: v.parentVersion,
        baseCanonRevision: v.baseCanonRevision,
        contentHash,
        snapshot: v.snapshot,
        publishedAt: "", // filled by the Task 9 commit
        publishedBy: v.publishedBy,
        ...(v.restoredFromVersion !== undefined ? { restoredFromVersion: v.restoredFromVersion } : {}),
      };
      const relativePath = `story/governance/versions/${v.artifactKind}/${v.unitId}/${v.version}.json`;
      return {
        writes: [{ relativePath, content: `${JSON.stringify(record, null, 2)}\n` }],
      };
    },

    prepareCurrentVersionPointer(artifactKind, unitId, version): AtomicFileWrite {
      const safeUnit = SafeGovernanceIdSchema.parse(unitId);
      return {
        relativePath: `story/governance/versions/${artifactKind}/${safeUnit}/current.json`,
        content: `${JSON.stringify({ version }, null, 2)}\n`,
      };
    },

    readVersion<T>(artifactKind: "foundation" | "arc_plan", unitId: string, version: number) {
      return readVersionFile<T>(bookDir, artifactKind, unitId, version);
    },

    async readCurrentVersion<T>(artifactKind: "foundation" | "arc_plan", unitId: string): Promise<VersionEnvelope<T> | null> {
      try {
        const raw = await readFile(currentPath(bookDir, artifactKind, unitId), "utf-8");
        const { version } = JSON.parse(raw) as { version: number };
        return readVersionFile<T>(bookDir, artifactKind, unitId, version);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },

    listVersions(artifactKind, unitId) {
      return listVersionNumbers(bookDir, artifactKind, unitId);
    },

    async verifyIntegrity(artifactKind, unitId): Promise<ReadonlyArray<string>> {
      const errors: string[] = [];
      const versions = await listVersionNumbers(bookDir, artifactKind, unitId);
      // NOTE: no early return on an empty listing — a dangling current pointer
      // (pointer exists, target record deleted) must still be reported.
      // Contiguity 1..N.
      for (let i = 0; i < versions.length; i++) {
        if (versions[i] !== i + 1) errors.push(`Version history not contiguous at index ${i}: ${versions[i]}`);
      }
      for (const version of versions) {
        const record = await readVersionFile<unknown>(bookDir, artifactKind, unitId, version);
        if (!record) {
          errors.push(`Version ${version} unreadable`);
          continue;
        }
        const expected = versionContentHash({
          artifactKind: record.artifactKind,
          unitId: record.unitId,
          version: record.version,
          parentVersion: record.parentVersion,
          baseCanonRevision: record.baseCanonRevision,
          snapshot: record.snapshot,
          restoredFromVersion: record.restoredFromVersion,
        });
        if (record.contentHash !== expected) {
          errors.push(`Version ${version} content hash mismatch (tampered/corrupt)`);
        }
        if (artifactKind === "foundation") {
          const snapshotParsed = FoundationPublishedSnapshotSchema.safeParse(record.snapshot);
          if (!snapshotParsed.success) {
            errors.push(`Version ${version} Foundation snapshot invalid`);
          }
        }
      }
      // Current-authority pointer integrity — read the pointer FILE directly so
      // a deleted/corrupt pointer, or a pointer whose target version record was
      // deleted, is ALWAYS reported. (readCurrentVersion returns null for a
      // missing target, which would silently hide the damage.)
      const pointerRaw = await readFile(currentPath(bookDir, artifactKind, unitId), "utf-8").catch(() => null);
      if (pointerRaw === null) {
        if (versions.length > 0) {
          errors.push(`Current pointer missing while ${versions.length} committed version(s) exist`);
        }
      } else {
        let pointerVersion: number | undefined;
        try {
          const parsed = JSON.parse(pointerRaw) as { version?: unknown };
          if (typeof parsed?.version !== "number") {
            throw new Error("current pointer must contain a numeric version");
          }
          pointerVersion = parsed.version;
        } catch {
          errors.push("Current pointer file unparseable");
        }
        if (pointerVersion !== undefined && !versions.includes(pointerVersion)) {
          errors.push(`Current pointer points at version ${pointerVersion} which does not exist`);
        }
      }
      return errors;
    },
  };
}

// ---------------------------------------------------------------------------
// Restore → revision candidate (never authority, never a pointer move).
// ---------------------------------------------------------------------------

/**
 * Create a NEW non-authoritative RevisionCandidate from a historical version.
 * parentVersion = CURRENT published version; restoredFromVersion = selected
 * historical version; baseCanonRevision = the CURRENT Canon revision argument;
 * status = needs_review. MUST NOT append/publish/move the current pointer.
 */
export async function restoreVersionAsRevisionCandidate<T>(
  store: VersionStore,
  artifactKind: "foundation" | "arc_plan",
  unitId: string,
  fromVersion: number,
  currentCanonRevision: number,
): Promise<RevisionCandidate<T>> {
  const historical = await store.readVersion<T>(artifactKind, unitId, fromVersion);
  if (!historical) {
    throw new Error(`Cannot restore ${artifactKind}/${unitId} version ${fromVersion}: version does not exist.`);
  }
  const current = await store.readCurrentVersion<T>(artifactKind, unitId);
  if (!current) {
    throw new Error(`Cannot restore ${artifactKind}/${unitId}: no current published version exists.`);
  }
  return {
    artifactKind,
    unitId: historical.unitId,
    parentVersion: current.version,
    restoredFromVersion: fromVersion,
    baseCanonRevision: currentCanonRevision,
    status: "needs_review",
    snapshot: historical.snapshot,
  };
}
