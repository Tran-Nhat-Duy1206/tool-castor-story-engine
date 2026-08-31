// LLM provider configuration and endpoints.
import type { ProviderEndpoint } from "../types.js";

export const INTERNLM: ProviderEndpoint = {
  id: "internlm",
  label: "InternLM (InternLM)",
  group: "china",
  api: "openai-completions",
  baseUrl: "https://chat.intern-ai.org.cn/api/v1",
  checkModel: "internlm2.5-latest",
  temperatureRange: [0, 2],
  defaultTemperature: 0.8,
  writingTemperature: 1,
  models: [
    { id: "intern-latest", maxOutput: 4096, contextWindowTokens: 262144, releasedAt: "2026-02-04" },
    { id: "intern-s1-pro", maxOutput: 4096, contextWindowTokens: 262144, enabled: true, releasedAt: "2026-02-04" },
    { id: "intern-s1", maxOutput: 4096, contextWindowTokens: 32768, enabled: true, releasedAt: "2025-07-26" },
    { id: "intern-s1-mini", maxOutput: 4096, contextWindowTokens: 32768, enabled: true, releasedAt: "2025-08-20" },
    { id: "internvl3.5-latest", maxOutput: 4096, contextWindowTokens: 32768, releasedAt: "2025-08-28" },
    { id: "internvl3.5-241b-a28b", maxOutput: 4096, contextWindowTokens: 32768, enabled: true, releasedAt: "2025-08-28" },
  ],
};
