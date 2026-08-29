import type { ProjectConfig } from "../models/project.js";
import {
  resolveEffectiveLLMConfig,
  type LLMConfigCliOverrides,
  type LLMConsumer,
} from "./effective-llm-config.js";
import { loadLLMEnvLayers, castorEnv, LEGACY_ENV_KEYS, normalizeLegacyEnvKeys, GLOBAL_CONFIG_DIR, GLOBAL_ENV_PATH, resolveGlobalEnvPath } from "./llm-env.js";
import { isApiKeyOptionalForEndpoint } from "./llm-endpoint-auth.js";

export { GLOBAL_CONFIG_DIR, GLOBAL_ENV_PATH, resolveGlobalEnvPath, castorEnv, LEGACY_ENV_KEYS, normalizeLegacyEnvKeys, isApiKeyOptionalForEndpoint };

export async function loadProjectConfig(
  root: string,
  options?: {
    readonly requireApiKey?: boolean;
    readonly cli?: LLMConfigCliOverrides;
    readonly consumer?: LLMConsumer;
  },
): Promise<ProjectConfig> {
  const envLayers = await loadLLMEnvLayers(root);
  const result = await resolveEffectiveLLMConfig({
    consumer: options?.consumer ?? "cli",
    projectRoot: root,
    envLayers,
    cli: options?.cli,
    requireApiKey: options?.requireApiKey,
  });
  return result.config;
}
