import { getEndpoint } from "./providers/index.js";
import { probeModelsFromUpstream } from "./providers/probe.js";
import { isApiKeyOptionalForEndpoint } from "../utils/llm-endpoint-auth.js";

export interface ServicePreset {
  readonly providerFamily: "openai" | "anthropic";
  readonly api: string;
  readonly baseUrl: string;
  readonly label: string;
  readonly temperatureRange?: readonly [number, number];
  readonly defaultTemperature?: number;
  readonly writingTemperature?: number;
  readonly temperatureHint?: string;
  readonly knownModels?: readonly string[];
  readonly piProvider?: string;
  readonly modelsBaseUrl?: string;
}

export const SERVICE_PRESETS: Record<string, ServicePreset> = {
  openai:      { providerFamily: "openai",    api: "openai-responses",   baseUrl: "https://api.openai.com/v1",                          label: "OpenAI",          temperatureRange: [0, 2], defaultTemperature: 1.0, writingTemperature: 1.0 },
  anthropic:   { providerFamily: "anthropic", api: "anthropic-messages", baseUrl: "https://api.anthropic.com",                          label: "Anthropic",       temperatureRange: [0, 1], defaultTemperature: 1.0, writingTemperature: 1.0, temperatureHint: "Do not modify temperature and top_p simultaneously" },
  deepseek:    { providerFamily: "openai",    api: "openai-completions", baseUrl: "https://api.deepseek.com",                           label: "DeepSeek",        temperatureRange: [0, 2], defaultTemperature: 1.0, writingTemperature: 1.5, temperatureHint: "Recommended 1.5 for creative writing" },
  moonshot:    { providerFamily: "openai",    api: "openai-completions", baseUrl: "https://api.moonshot.cn/v1",                         label: "Moonshot (Kimi)", temperatureRange: [0, 1], defaultTemperature: 0.3, writingTemperature: 1.0, temperatureHint: "kimi-k2.5 recommended temperature=1.0" },
  minimax:     {
    providerFamily: "openai",
    api: "openai-completions",
    baseUrl: "https://api.minimaxi.com/v1",
    label: "MiniMax",
    temperatureRange: [0, 2],
    defaultTemperature: 0.9,
    writingTemperature: 0.9,
    knownModels: ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.7-highspeed", "MiniMax-M2.5", "MiniMax-M2.5-highspeed", "MiniMax-M2.1", "MiniMax-M2.1-highspeed", "MiniMax-M2"],
  },
  bailian:     {
    providerFamily: "anthropic",
    api: "anthropic-messages",
    baseUrl: "https://dashscope.aliyuncs.com/apps/anthropic",
    label: "Bailian (Qwen)",
    temperatureRange: [0, 2],
    defaultTemperature: 0.7,
    writingTemperature: 1.0,
    piProvider: "anthropic",
  },
  zhipu:       { providerFamily: "openai",    api: "openai-completions", baseUrl: "https://open.bigmodel.cn/api/paas/v4",               label: "Zhipu GLM",        temperatureRange: [0, 1], defaultTemperature: 0.95, writingTemperature: 0.95, piProvider: "zai" },
  siliconflow: { providerFamily: "openai",    api: "openai-completions", baseUrl: "https://api.siliconflow.cn/v1",                      label: "SiliconFlow" },
  ppio:        { providerFamily: "openai",    api: "openai-completions", baseUrl: "https://api.ppinfra.com/v3/openai",                  label: "PPIO" },
  openrouter:  { providerFamily: "openai",    api: "openai-responses",   baseUrl: "https://openrouter.ai/api/v1",                       label: "OpenRouter",      piProvider: "openrouter" },
  kkaiapi:     { providerFamily: "openai",    api: "openai-completions", baseUrl: "https://api.kkaiapi.com/v1",                         label: "kkaiapi",         modelsBaseUrl: "https://api.kkaiapi.com/v1" },
  ollama:      { providerFamily: "openai",    api: "openai-completions", baseUrl: "http://localhost:11434/v1",                          label: "Ollama (local)" },
  lmstudio:    { providerFamily: "openai",    api: "openai-completions", baseUrl: "http://localhost:1234/v1",                           label: "LM Studio (local)", modelsBaseUrl: "http://localhost:1234/v1" },
  custom:      { providerFamily: "openai",    api: "openai-completions", baseUrl: "",                                                    label: "Custom endpoint" },
};

export function resolveServicePreset(service: string): ServicePreset | undefined {
  const provider = getEndpoint(service);
  const legacy = SERVICE_PRESETS[service];
  if (!provider && !legacy) return undefined;

  return {
    providerFamily: legacy?.providerFamily ?? (provider?.api.startsWith("anthropic") ? "anthropic" : "openai"),
    api: (provider?.api ?? legacy?.api ?? "openai-completions") as ServicePreset["api"],
    baseUrl: provider?.baseUrl ?? legacy?.baseUrl ?? "",
    label: provider?.label ?? legacy?.label ?? service,
    ...(provider?.temperatureRange ?? legacy?.temperatureRange
      ? { temperatureRange: provider?.temperatureRange ?? legacy?.temperatureRange }
      : {}),
    ...(provider?.defaultTemperature !== undefined || legacy?.defaultTemperature !== undefined
      ? { defaultTemperature: provider?.defaultTemperature ?? legacy?.defaultTemperature }
      : {}),
    ...(provider?.writingTemperature !== undefined || legacy?.writingTemperature !== undefined
      ? { writingTemperature: provider?.writingTemperature ?? legacy?.writingTemperature }
      : {}),
    ...(provider?.temperatureHint ?? legacy?.temperatureHint
      ? { temperatureHint: provider?.temperatureHint ?? legacy?.temperatureHint }
      : {}),
    ...(legacy?.knownModels ? { knownModels: legacy.knownModels } : {}),
    // piProvider field removed from ProviderEndpoint (migrated to provider-to-pi-ai adapter), legacy fallback retained
    ...(legacy?.piProvider ? { piProvider: legacy.piProvider } : {}),
    ...((provider ? provider.modelsBaseUrl : legacy?.modelsBaseUrl)
      ? { modelsBaseUrl: provider ? provider.modelsBaseUrl : legacy?.modelsBaseUrl }
      : {}),
  };
}

export function resolveServiceProviderFamily(service: string): "openai" | "anthropic" | undefined {
  return resolveServicePreset(service)?.providerFamily;
}

export function resolveServicePiProvider(service: string): string | undefined {
  if (service === "google") return "google";
  const preset = resolveServicePreset(service);
  if (!preset) return undefined;
  return preset.piProvider ?? preset.providerFamily;
}

export function resolveServiceModelsBaseUrl(service: string): string | undefined {
  const preset = resolveServicePreset(service);
  if (!preset) return undefined;
  return preset.modelsBaseUrl ?? preset.baseUrl;
}

const DEFAULT_TEMPERATURE_RANGE: [number, number] = [0, 2];

export function clampTemperature(service: string, temperature: number): number {
  const preset = resolveServicePreset(service);
  const [min, max] = preset?.temperatureRange ?? DEFAULT_TEMPERATURE_RANGE;
  return Math.max(min, Math.min(max, temperature));
}

export function getWritingTemperature(service: string): number {
  const preset = resolveServicePreset(service);
  return preset?.writingTemperature ?? preset?.defaultTemperature ?? 1.0;
}

export function guessServiceFromBaseUrl(baseUrl: string): string {
  for (const [key, preset] of Object.entries(SERVICE_PRESETS)) {
    if (key === "custom" || !preset.baseUrl) continue;
    try {
      if (baseUrl.includes(new URL(preset.baseUrl).hostname)) return key;
    } catch {
      continue;
    }
  }
  return "custom";
}

export const SERVICE_TO_PI_PROVIDER: Record<string, string> = Object.fromEntries(
  Object.entries(SERVICE_PRESETS)
    .filter(([service]) => service !== "custom")
    .map(([service, preset]) => [service, preset.piProvider ?? preset.providerFamily]),
) as Record<string, string>;
SERVICE_TO_PI_PROVIDER.google = "google";

export interface ModelInfo {
  readonly id: string;
  readonly name: string;
  readonly contextWindow: number;
  /** Model max output tokens (from providers bank or live /models) */
  readonly maxOutput?: number;
}

function toModelInfo(providerModel: { id: string; maxOutput: number; contextWindowTokens: number }): ModelInfo {
  return {
    id: providerModel.id,
    name: providerModel.id,
    contextWindow: providerModel.contextWindowTokens,
    maxOutput: providerModel.maxOutput,
  };
}

/**
 * listModelsForService:
 * - Try live /models probe first (if baseUrl + apiKey are available)
 * - On probe failure or missing apiKey: fallback to provider.models (castor bank)
 * - CASTOR_LLM_MODEL env patching omitted (bank is comprehensive)
 *
 * Gateway providers with empty default baseUrl:
 *   Must provide liveBaseUrl to perform probe; otherwise relies on bank.
 */
export async function listModelsForService(
  service: string,
  apiKey?: string,
  liveBaseUrl?: string,
): Promise<ReadonlyArray<ModelInfo>> {
  const provider = getEndpoint(service);
  const preset = SERVICE_PRESETS[service];
  if (!provider && !preset) return [];

  const byId = new Map<string, ModelInfo>();

  // 1) Try live /models probe
  const probeBaseUrl = liveBaseUrl || provider?.modelsBaseUrl || provider?.baseUrl || resolveServiceModelsBaseUrl(service);
  const providerFamily = preset?.providerFamily ?? (provider?.api.startsWith("anthropic") ? "anthropic" : "openai");
  const canProbeWithoutApiKey = isApiKeyOptionalForEndpoint({ provider: providerFamily, baseUrl: probeBaseUrl });
  if ((apiKey || canProbeWithoutApiKey) && probeBaseUrl) {
    const probed = await probeModelsFromUpstream(probeBaseUrl, apiKey ?? "", 10_000);
    if (probed.length > 0) {
      const { lookupModel } = await import("./providers/lookup.js");
      for (const m of probed) {
        const card = lookupModel(service, m.id);
        byId.set(m.id, card ? toModelInfo(card) : { id: m.id, name: m.name, contextWindow: m.contextWindow });
      }
    }
  }

  // 2) Provider bank fallback
  if (provider) {
    for (const m of provider.models) {
      if (m.enabled === false) continue;
      if (byId.has(m.id)) continue;
      byId.set(m.id, toModelInfo(m));
    }
  }

  // 3) Legacy knownModels fallback
  if (byId.size === 0 && preset?.knownModels) {
    for (const id of preset.knownModels) {
      byId.set(id, { id, name: id, contextWindow: 0 });
    }
  }

  return Array.from(byId.values());
}

export async function listServicesWithModelCount(): Promise<ReadonlyArray<{ service: string; label: string; modelCount: number }>> {
  const result: { service: string; label: string; modelCount: number }[] = [];
  for (const [key, preset] of Object.entries(SERVICE_PRESETS)) {
    if (key === "custom") {
      result.push({ service: key, label: preset.label, modelCount: 0 });
      continue;
    }
    const models = await listModelsForService(key);
    result.push({ service: key, label: preset.label, modelCount: models.length });
  }
  return result;
}
