import { cp, mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CASTOR_RUNTIME_DIRNAME, LEGACY_CASTOR_RUNTIME_DIRNAME } from "./product-identity.js";

/**
 * Runtime directory adapter (Checkpoint 4, plan Task 4.3).
 *
 * Canonical runtime state (uploads, materials, secrets, sessions, tasks,
 * research, backups) lives under `.castor/`. Legacy `.inkos/` content is
 * read only for one-way compatibility, per spec §7:
 *
 *   - the canonical path always wins;
 *   - when the canonical counterpart is missing and legacy content exists,
 *     the legacy content is copied into the canonical tree exactly once
 *     (never overwriting an existing canonical file);
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
 * content exists, the legacy content is copied into the canonical tree first.
 */
export async function resolveRuntimePath(projectRoot: string, ...segments: string[]): Promise<string> {
  const canonical = castorRuntimePath(projectRoot, ...segments);
  if ((await pathKind(canonical)) !== "missing") return canonical;

  const legacy = legacyRuntimePath(projectRoot, ...segments);
  if ((await pathKind(legacy)) !== "missing") {
    await mkdir(dirname(canonical), { recursive: true });
    // force:false keeps an existing canonical file authoritative even under
    // a concurrent race; errorOnExist:false makes the copy best-effort.
    await cp(legacy, canonical, { recursive: true, force: false, errorOnExist: false });
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
