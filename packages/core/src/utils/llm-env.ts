import { copyFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "dotenv";
import { access } from "node:fs/promises";

/**
 * Canonical global Castor config directory. The legacy ~/.inkos directory is
 * only read for one-way migration of the global .env (Checkpoint 4/5); it is
 * never written again.
 */
export const GLOBAL_CONFIG_DIR = join(homedir(), ".castor");
export const LEGACY_GLOBAL_CONFIG_DIR = join(homedir(), ".inkos");
export const GLOBAL_ENV_PATH = join(GLOBAL_CONFIG_DIR, ".env");
export const LEGACY_GLOBAL_ENV_PATH = join(LEGACY_GLOBAL_CONFIG_DIR, ".env");

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the global .env path with one-way legacy migration: if the
 * canonical ~/.castor/.env is missing but the legacy ~/.inkos/.env exists,
 * the legacy file is copied once. Secrets are copied as opaque file content
 * and never echoed. The legacy file is never modified.
 */
export async function resolveGlobalEnvPath(): Promise<string> {
  if (await fileExists(GLOBAL_ENV_PATH)) return GLOBAL_ENV_PATH;
  if (await fileExists(LEGACY_GLOBAL_ENV_PATH)) {
    await mkdir(GLOBAL_CONFIG_DIR, { recursive: true });
    // force:false keeps an existing canonical file authoritative under races.
    await copyFile(LEGACY_GLOBAL_ENV_PATH, GLOBAL_ENV_PATH).catch(() => undefined);
  }
  return GLOBAL_ENV_PATH;
}

export type LLMEnvMap = Record<string, string | undefined>;

export interface LLMEnvLayers {
  readonly global: LLMEnvMap;
  readonly project: LLMEnvMap;
  readonly process: LLMEnvMap;
}

export async function loadLLMEnvLayers(
  root: string,
  processEnv: NodeJS.ProcessEnv = process.env,
): Promise<LLMEnvLayers> {
  const global = await parseEnvFile(await resolveGlobalEnvPath());
  const project = await parseEnvFile(join(root, ".env"));
  // Compatibility: modelOverrides.apiKeyEnv and detector config still read process.env directly.
  hydrateProcessEnvFromEnvFiles(processEnv, global, project);

  return {
    global,
    project,
    process: { ...processEnv },
  };
}

export function mergeEnvMaps(...layers: readonly LLMEnvMap[]): LLMEnvMap {
  const merged: LLMEnvMap = {};
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer)) {
      if (value !== undefined) merged[key] = value;
    }
  }
  return merged;
}

export function studioIgnoredEnv(layers: LLMEnvLayers): LLMEnvMap {
  return mergeEnvMaps(layers.global, layers.project, layers.process);
}

export function cliOverlayEnv(layers: LLMEnvLayers): LLMEnvMap {
  return mergeEnvMaps(layers.global, layers.project, layers.process);
}

export function legacyEnv(layers: LLMEnvLayers): LLMEnvMap {
  return mergeEnvMaps(layers.global, layers.project, layers.process);
}

async function parseEnvFile(path: string): Promise<LLMEnvMap> {
  try {
    return parse(await readFile(path, "utf-8"));
  } catch {
    return {};
  }
}

function hydrateProcessEnvFromEnvFiles(
  processEnv: NodeJS.ProcessEnv,
  global: LLMEnvMap,
  project: LLMEnvMap,
): void {
  const fileEnv = mergeEnvMaps(global, project);
  for (const [key, value] of Object.entries(fileEnv)) {
    if (value !== undefined && processEnv[key] === undefined) {
      processEnv[key] = value;
    }
  }
}
