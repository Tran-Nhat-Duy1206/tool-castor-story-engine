import { cp, mkdir, rename, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { CASTOR_RUNTIME_DIRNAME, LEGACY_CASTOR_RUNTIME_DIRNAME } from "./product-identity.js";

/**
 * Runtime directory adapter (Checkpoint 4, plan Task 4.3).
 *
 * Canonical runtime state (uploads, materials, secrets, sessions, tasks,
 * research, backups) lives under `.castor/`. Legacy `.inkos/` content is
 * read only for one-way compatibility, per spec §7 and §15:
 *
 *   - the canonical path always wins;
 *   - when the canonical counterpart is missing and legacy content exists,
 *     the legacy content is staged and committed with an atomic rename: an
 *     IO failure mid-copy leaves NO canonical residue, so the next call
 *     retries cleanly instead of being blocked forever by an empty or
 *     partial canonical directory (fail closed, spec §15);
 *   - the legacy tree is never modified;
 *   - secrets are copied as opaque file content and never echoed;
 *   - no story authority (Canon, Foundation, Arc, chapters, governance
 *     records) is derived from runtime migration.
 *
 * Callers resolve the path right before reading or creating a resource;
 * writing must target the returned canonical path.
 */

export function castorRuntimeDir(projectRoot: string): string {
  return join(projectRoot, CASTOR_RUNTIME_DIRNAME);
}

export function castorRuntimePath(projectRoot: string, ...segments: string[]): string {
  return join(castorRuntimeDir(projectRoot), ...segments);
}

export function legacyRuntimePath(projectRoot: string, ...segments: string[]): string {
  return join(projectRoot, LEGACY_CASTOR_RUNTIME_DIRNAME, ...segments);
}

async function pathKind(path: string): Promise<"missing" | "file" | "directory"> {
  try {
    const s = await stat(path);
    return s.isDirectory() ? "directory" : "file";
  } catch {
    return "missing";
  }
}

/**
 * Resolve a runtime resource path with one-way legacy read-through.
 * `segments` may address a file (e.g. ["secrets.json"]) or a directory
 * (e.g. ["materials"]). If the canonical counterpart is missing but legacy
 * content exists, the legacy content is staged, then committed atomically.
 */
export async function resolveRuntimePath(projectRoot: string, ...segments: string[]): Promise<string> {
  const canonical = castorRuntimePath(projectRoot, ...segments);
  if ((await pathKind(canonical)) !== "missing") return canonical;

  const legacy = legacyRuntimePath(projectRoot, ...segments);
  if ((await pathKind(legacy)) === "missing") return canonical;

  const canonicalParent = dirname(canonical);
  await mkdir(canonicalParent, { recursive: true });
  const staging = join(canonicalParent, `.castor-migrate-${Date.now()}-${randomUUID().slice(0, 8)}`);
  try {
    await cp(legacy, staging, { recursive: true, errorOnExist: true, force: false });
    try {
      await rename(staging, canonical);
    } catch (renameError) {
      // Canonical won a concurrent race → it stays authoritative; discard staging.
      if ((await pathKind(canonical)) !== "missing") {
        await rm(staging, { recursive: true, force: true }).catch(() => undefined);
        return canonical;
      }
      throw renameError;
    }
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  return canonical;
}

/**
 * Legacy-only view for read operations that must still see historical
 * resources (e.g. listing old backups) without copying them.
 * Returns the canonical path if it exists, otherwise the legacy path
 * (which may itself not exist — callers treat that as empty).
 */
export async function viewRuntimePath(projectRoot: string, ...segments: string[]): Promise<string> {
  const canonical = castorRuntimePath(projectRoot, ...segments);
  if ((await pathKind(canonical)) !== "missing") return canonical;
  const legacy = legacyRuntimePath(projectRoot, ...segments);
  if ((await pathKind(legacy)) !== "missing") return legacy;
  return canonical;
}
