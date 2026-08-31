// LLM provider configuration and endpoints.
import type { ProviderEndpoint } from "../types.js";

export const ASTRON_CODING_PLAN: ProviderEndpoint = {
  id: "astronCodingPlan",
  label: " Astron Coding Plan",
  group: "codingPlan",
  api: "anthropic-messages",
  baseUrl: "https://maas-coding-api.cn-huabei-1.xf-yun.com/anthropic",
  modelsBaseUrl: "https://maas-coding-api.cn-huabei-1.xf-yun.com/v2",
  checkModel: "astron-code-latest",
  temperatureRange: [0, 1],
  defaultTemperature: 0.7,
  writingTemperature: 1,
  models: [
    { id: "astron-code-latest", maxOutput: 32768, contextWindowTokens: 131072, enabled: true },
  ],
};
