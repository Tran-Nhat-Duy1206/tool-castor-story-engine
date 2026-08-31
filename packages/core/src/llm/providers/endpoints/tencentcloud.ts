// LLM provider configuration and endpoints.
import type { ProviderEndpoint } from "../types.js";

export const TENCENTCLOUD: ProviderEndpoint = {
  id: "tencentcloud",
  label: " (lkeap)",
  group: "china",
  api: "openai-completions",
  baseUrl: "https://api.lkeap.cloud.tencent.com/v1",
  checkModel: "deepseek-v3",
  temperatureRange: [0, 2],
  defaultTemperature: 0.7,
  writingTemperature: 1,
  models: [
    { id: "deepseek-r1", maxOutput: 16000, contextWindowTokens: 65536, enabled: true },
    { id: "deepseek-v3-0324", maxOutput: 16000, contextWindowTokens: 65536, enabled: true },
    { id: "deepseek-v3", maxOutput: 16000, contextWindowTokens: 65536 },
  ],
};
