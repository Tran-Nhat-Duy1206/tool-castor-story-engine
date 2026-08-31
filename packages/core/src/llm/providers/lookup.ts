import type { ProviderModel } from "./types.js";
import { getAllEndpoints, getEndpoint } from "./index.js";

// LLM provider configuration and endpoints.
const PROVIDER_PRIORITY: readonly string[] = [
  "anthropic", "openai", "google", "deepseek", "bailian", "moonshot", "kimicode",
  "zhipu", "minimax", "xai",
  "siliconcloud",
  "openrouter", "aihubmix", "novita",
];

// LLM provider configuration and endpoints.
export function lookupModel(
  serviceId: string,
  modelId: string,
): ProviderModel | undefined {
  const lowerId = modelId.toLowerCase();

  const provider = getEndpoint(serviceId);
  if (provider) {
    const hit = provider.models.find((m) => m.id.toLowerCase() === lowerId);
    if (hit) return hit;
  }

  const matches: Array<{ model: ProviderModel; providerId: string }> = [];
  for (const p of getAllEndpoints()) {
    const hit = p.models.find((m) => m.id.toLowerCase() === lowerId);
    if (hit) matches.push({ model: hit, providerId: p.id });
  }
  if (matches.length === 0) return undefined;

  matches.sort((a, b) => {
    const ai = PROVIDER_PRIORITY.indexOf(a.providerId);
    const bi = PROVIDER_PRIORITY.indexOf(b.providerId);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
  return matches[0].model;
}

// LLM provider configuration and endpoints.
export function listEnabledModels(serviceId: string): ProviderModel[] {
  const provider = getEndpoint(serviceId);
  if (!provider) return [];
  return provider.models.filter((m) => m.enabled !== false);
}

export function isActiveTextModel(model: ProviderModel): boolean {
  if (model.enabled === false) return false;
  if (model.status === "disabled" || model.status === "deprecated" || model.status === "nonText") return false;
  if (model.capabilities?.text === false) return false;
  if (model.capabilities?.imageOutput === true && model.capabilities?.text !== true) return false;
  return true;
}

export function listActiveTextModels(serviceId: string): ProviderModel[] {
  const provider = getEndpoint(serviceId);
  if (!provider) return [];
  return provider.models.filter(isActiveTextModel);
}
