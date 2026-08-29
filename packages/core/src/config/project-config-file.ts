import { access, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CASTOR_CONFIG_FILENAME, LEGACY_CASTOR_CONFIG_FILENAME } from "./product-identity.js";

/**
 * Project config file adapter (Checkpoint 3, plan Task 3.4).
 *
 * One-way legacy migration at the configuration boundary, per spec §6:
 *
 *   1. castor.json exists           → canonical, used directly.
 *   2. castor.json + castor.json     → castor.json wins; meaningful conflicts
 *                                      produce a non-secret warning (key names
 *                                      only). Never merged.
 *   3. castor.json only              → legacy input: validated, then an
 *                                      equivalent castor.json is atomically
 *                                      created. The legacy file is left
 *                                      byte-identical and never written again.
 *   4. neither exists               → actionable ConfigNotFoundError.
 *
 * This adapter is the only place allowed to branch on legacy vs canonical
 * config file names. Config migration never touches story state (Canon,
 * Foundation, Arc, chapters, governance records).
 */

export interface LoadedProjectConfig {
  readonly config: Record<string, unknown>;
  readonly source: "castor" | "legacy-migrated";
  readonly warnings: readonly string[];
}

export class ConfigNotFoundError extends Error {
  constructor(root: string) {
    super(
      `Project config not found in ${root}: expected ${CASTOR_CONFIG_FILENAME}` +
        ` (a legacy ${LEGACY_CASTOR_CONFIG_FILENAME} is migrated automatically).\n` +
        `Run 'castor init' in this directory or open the folder created by 'castor init'.`,
    );
    this.name = "ConfigNotFoundError";
  }
}

function castorPath(root: string): string {
  return join(root, CASTOR_CONFIG_FILENAME);
}

function legacyPath(root: string): string {
  return join(root, LEGACY_CASTOR_CONFIG_FILENAME);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(path: string): Promise<Record<string, unknown>> {
  const raw = await readFile(path, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}. Fix the syntax error and retry.`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON object with project settings.`);
  }
  return parsed as Record<string, unknown>;
}

/** Atomic single-file write consistent with the repository's staging pattern. */
/**
 * Stage-then-rename write. Never clobbers a canonical file that appeared
 * concurrently during MIGRATION: if the target exists after a failed rename,
 * the canonical file wins and the migration is skipped (the caller re-reads
 * the target). For explicit saves (intended overwrite) pass overwrite:true.
 */
async function writeFileAtomic(target: string, content: string, overwrite: boolean): Promise<void> {
  const staging = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await writeFile(staging, content, "utf-8");
  try {
    await rename(staging, target);
  } catch (renameError) {
    if (!overwrite && (await exists(target))) {
      // Lost a create race — the canonical file is authoritative.
      await rm(staging, { force: true }).catch(() => undefined);
      return;
    }
    // Retried overwrite save with a transient rename failure (Windows EBUSY/EPERM).
    await rm(staging, { force: true }).catch(() => undefined);
    throw renameError;
  }
}

/**
 * Keys whose values may differ between the canonical and legacy files without
 * being flagged. Derived/ephemeral fields are normal to drift.
 */
const CONFLICT_IGNORED_KEYS = new Set(["version"]);

function meaningfulConflictKeys(castor: Record<string, unknown>, legacy: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(castor), ...Object.keys(legacy)]);
  const conflicts: string[] = [];
  for (const key of keys) {
    if (CONFLICT_IGNORED_KEYS.has(key)) continue;
    if (JSON.stringify(castor[key]) !== JSON.stringify(legacy[key])) conflicts.push(key);
  }
  return conflicts.sort();
}

function serialize(config: Record<string, unknown>): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

/**
 * Load the project config through the canonical boundary, migrating legacy
 * input one-way when needed. The returned warnings are safe to display: they
 * contain key names, never values.
 */
export async function loadProjectConfigFile(root: string): Promise<LoadedProjectConfig> {
  if (await exists(castorPath(root))) {
    const config = await readJsonFile(castorPath(root));
    const warnings: string[] = [];
    if (await exists(legacyPath(root))) {
      let legacy: Record<string, unknown>;
      try {
        legacy = await readJsonFile(legacyPath(root));
      } catch {
        legacy = {};
        warnings.push(
          `Legacy ${LEGACY_CASTOR_CONFIG_FILENAME} exists but is invalid JSON; it was ignored. ` +
            `${CASTOR_CONFIG_FILENAME} remains canonical.`,
        );
      }
      const conflicts = meaningfulConflictKeys(config, legacy);
      if (conflicts.length > 0) {
        warnings.push(
          `Both ${CASTOR_CONFIG_FILENAME} and legacy ${LEGACY_CASTOR_CONFIG_FILENAME} exist with different values ` +
            `for: ${conflicts.join(", ")}. ${CASTOR_CONFIG_FILENAME} is canonical; the legacy file was not merged.`,
        );
      }
    }
    return { config, source: "castor", warnings };
  }

  if (await exists(legacyPath(root))) {
    const legacy = await readJsonFile(legacyPath(root)); // invalid legacy → fail closed, no partial castor.json
    await writeFileAtomic(castorPath(root), serialize(legacy), false);
    return {
      config: await readJsonFile(castorPath(root)),
      source: "legacy-migrated",
      warnings: [
        `Migrated legacy ${LEGACY_CASTOR_CONFIG_FILENAME} to ${CASTOR_CONFIG_FILENAME}. ` +
          `The legacy file was kept unchanged; future saves update ${CASTOR_CONFIG_FILENAME} only.`,
      ],
    };
  }

  throw new ConfigNotFoundError(root);
}

/**
 * Save the project config to the canonical file only. After migration, the
 * legacy file is never updated again (spec §6.2).
 */
export async function saveProjectConfigFile(root: string, config: Record<string, unknown>): Promise<void> {
  await writeFileAtomic(castorPath(root), serialize(config), true);
}

/** True when the project has a config file in canonical or legacy form. */
export async function hasProjectConfigFile(root: string): Promise<boolean> {
  return (await exists(castorPath(root))) || (await exists(legacyPath(root)));
}
