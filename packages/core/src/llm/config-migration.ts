import { saveSecrets, loadSecrets } from "./secrets.js";
import { guessServiceFromBaseUrl } from "./service-presets.js";

export interface MigrationResult {
  migrated: boolean;
}

export async function migrateConfig(projectRoot: string): Promise<MigrationResult> {
  const { loadProjectConfigFile, saveProjectConfigFile } = await import("../config/project-config-file.js");
  let config: Record<string, unknown>;
  try {
    config = (await loadProjectConfigFile(projectRoot)).config;
  } catch {
    return { migrated: false };
  }

  const llm = config.llm as Record<string, unknown> | undefined;
  if (!llm) return { migrated: false };

  // Already new format
  if (Array.isArray(llm.services)) return { migrated: false };

  // Old format: llm.provider, llm.model, llm.baseUrl, llm.apiKey
  const { provider, model, baseUrl, apiKey, ...restLlm } = llm as {
    provider?: string;
    model?: string;
    baseUrl?: string;
    apiKey?: string;
  } & Record<string, unknown>;
  if (!model && !provider) return { migrated: false };

  // Determine service from baseUrl
  const guessedService = baseUrl ? guessServiceFromBaseUrl(baseUrl) : null;
  const service = guessedService ?? "custom";

  // Build new service entry
  const serviceEntry: Record<string, string> = { service };
  if (service === "custom") {
    serviceEntry.name = "Custom";
    if (baseUrl) serviceEntry.baseUrl = baseUrl;
  }

  // Write new config (no apiKey)
  config.llm = {
    ...restLlm,
    services: [serviceEntry],
    defaultModel: model,
  };
  await saveProjectConfigFile(projectRoot, config);

  // Move apiKey to secrets
  if (apiKey) {
    const secrets = await loadSecrets(projectRoot);
    const secretKey = service === "custom" ? `custom:${serviceEntry.name}` : service;
    secrets.services[secretKey] = { apiKey };
    await saveSecrets(projectRoot, secrets);
  }

  return { migrated: true };
}
