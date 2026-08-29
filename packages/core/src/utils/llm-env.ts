import { copyFile, mkdir, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
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

/**
 * Explicit legacy environment-variable compatibility map (spec §8).
 * Every documented INKOS_* variable maps to exactly one CASTOR_* name.
 * Unknown INKOS_* names are never copied. No wildcard substitution.
 */
export const LEGACY_INKOS_ENV_KEYS: Readonly<Record<string, string>> = Object.freeze({
  INKOS_STUDIO_PORT: "CASTOR_STUDIO_PORT",
  INKOS_PROJECT_ROOT: "CASTOR_PROJECT_ROOT",
  INKOS_SKILL_DIRS: "CASTOR_SKILL_DIRS",
  INKOS_LOCALE: "CASTOR_LOCALE",
  INKOS_TUI_LOCALE: "CASTOR_TUI_LOCALE",
  INKOS_TUI_THEME: "CASTOR_TUI_THEME",
  INKOS_DEFAULT_LANGUAGE: "CASTOR_DEFAULT_LANGUAGE",
  INKOS_USER_AGENT: "CASTOR_USER_AGENT",
  INKOS_LIVE_E2E: "CASTOR_LIVE_E2E",
  INKOS_FILM_IMAGE_SIZE: "CASTOR_FILM_IMAGE_SIZE",
  INKOS_AGENT_ALLOW_SYSTEM_READ: "CASTOR_AGENT_ALLOW_SYSTEM_READ",
  INKOS_AGENT_LLM_STUB: "CASTOR_AGENT_LLM_STUB",
  INKOS_COVER_BASE_URL: "CASTOR_COVER_BASE_URL",
  INKOS_COVER_API_KEY: "CASTOR_COVER_API_KEY",
  INKOS_COVER_ENDPOINT: "CASTOR_COVER_ENDPOINT",
  INKOS_COVER_MODEL: "CASTOR_COVER_MODEL",
  INKOS_COVER_SIZE: "CASTOR_COVER_SIZE",
  INKOS_LLM_PROVIDER: "CASTOR_LLM_PROVIDER",
  INKOS_LLM_SERVICE: "CASTOR_LLM_SERVICE",
  INKOS_LLM_BASE_URL: "CASTOR_LLM_BASE_URL",
  INKOS_LLM_API_KEY: "CASTOR_LLM_API_KEY",
  INKOS_LLM_MODEL: "CASTOR_LLM_MODEL",
  INKOS_LLM_API_FORMAT: "CASTOR_LLM_API_FORMAT",
  INKOS_LLM_STREAM: "CASTOR_LLM_STREAM",
  INKOS_LLM_TEMPERATURE: "CASTOR_LLM_TEMPERATURE",
  INKOS_LLM_THINKING_BUDGET: "CASTOR_LLM_THINKING_BUDGET",
  INKOS_LLM_PROXY_URL: "CASTOR_LLM_PROXY_URL",
  INKOS_LLM_FIRST_EVENT_TIMEOUT_MS: "CASTOR_LLM_FIRST_EVENT_TIMEOUT_MS",
  INKOS_LLM_STREAM_IDLE_TIMEOUT_MS: "CASTOR_LLM_STREAM_IDLE_TIMEOUT_MS",
  INKOS_LLM_HEADERS: "CASTOR_LLM_HEADERS",
  // Prefix families are handled by isLegacyEnvKey below.
});

const LEGACY_ENV_PREFIX_RULES: ReadonlyArray<{ prefix: string; replacement: string }> = Object.freeze([
  { prefix: "INKOS_LLM_EXTRA_", replacement: "CASTOR_LLM_EXTRA_" },
]);

function legacyToCastorKey(key: string): string | undefined {
  const direct = LEGACY_INKOS_ENV_KEYS[key];
  if (direct) return direct;
  for (const rule of LEGACY_ENV_PREFIX_RULES) {
    if (key.startsWith(rule.prefix)) return `${rule.replacement}${key.slice(rule.prefix.length)}`;
  }
  return undefined;
}

function isLegacyEnvKey(key: string): boolean {
  return key.startsWith("INKOS_LLM_") || key in LEGACY_INKOS_ENV_KEYS;
}

/**
 * Read a canonical CASTOR_* variable from an environment with legacy
 * INKOS_* fallback. Castor wins when both define the key; conflicting dual
 * definitions push a non-secret warning (key names only) into `warnings`
 * when provided. Unknown legacy names are not mapped.
 */
export function castorEnv(
  castorKey: string,
  env: NodeJS.ProcessEnv = process.env,
  warnings?: string[],
): string | undefined {
  const castorValue = env[castorKey];
  const legacyKey = Object.entries(LEGACY_INKOS_ENV_KEYS).find(([, castor]) => castor === castorKey)?.[0];
  const legacyValue = legacyKey ? env[legacyKey] : undefined;
  if (castorValue !== undefined && castorValue !== "") {
    if (legacyValue !== undefined && legacyValue !== "" && legacyValue !== castorValue && warnings) {
      warnings.push(
        `Environment variable ${legacyKey} is deprecated and conflicts with ${castorKey}; using ${castorKey}.`,
      );
    }
    return castorValue;
  }
  if (legacyValue !== undefined && legacyValue !== "") return legacyValue;
  return castorValue;
}

/**
 * Normalize one env map in place: known legacy INKOS_* keys become their
 * CASTOR_* counterparts unless the Castor key already has a value (Castor
 * wins). Returns non-secret conflict warnings (key names only).
 */
export function normalizeLegacyEnvKeys(map: Record<string, string | undefined>): string[] {
  const warnings: string[] = [];
  for (const key of Object.keys(map)) {
    if (!isLegacyEnvKey(key)) continue;
    const castorKey = legacyToCastorKey(key);
    if (!castorKey) continue;
    const legacyValue = map[key];
    const castorValue = map[castorKey];
    if (castorValue === undefined || castorValue === "") {
      map[castorKey] = legacyValue;
    } else if (legacyValue !== undefined && legacyValue !== "" && legacyValue !== castorValue) {
      warnings.push(
        `Environment variable ${key} is deprecated and conflicts with ${castorKey}; using ${castorKey}.`,
      );
    }
    delete map[key];
  }
  return warnings;
}

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

export interface LLMEnvLayers {
  readonly global: LLMEnvMap;
  readonly project: LLMEnvMap;
  readonly process: LLMEnvMap;
  /** Non-secret deprecation/conflict warnings collected while normalizing legacy keys. */
  readonly warnings?: readonly string[];
}

export async function loadLLMEnvLayers(
  root: string,
  processEnv: NodeJS.ProcessEnv = process.env,
): Promise<LLMEnvLayers> {
  const warnings: string[] = [];
  const global = parseEnvFileSync(await resolveGlobalEnvPath());
  const project = parseEnvFileSync(join(root, ".env"));
  const processLayer: Record<string, string | undefined> = { ...processEnv };
  warnings.push(...normalizeLegacyEnvKeys(global));
  warnings.push(...normalizeLegacyEnvKeys(project));
  warnings.push(...normalizeLegacyEnvKeys(processLayer));
  // Compatibility: modelOverrides.apiKeyEnv and detector config still read process.env directly.
  hydrateProcessEnvFromEnvFiles(processEnv, global, project);

  return {
    global,
    project,
    process: processLayer,
    warnings: warnings.length > 0 ? warnings : undefined,
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

function parseEnvFileSync(path: string): Record<string, string | undefined> {
  try {
    return parse(readFileSync(path, "utf-8")) as Record<string, string | undefined>;
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
