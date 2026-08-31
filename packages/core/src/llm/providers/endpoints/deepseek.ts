// LLM provider configuration and endpoints.
import type { ProviderEndpoint } from "../types.js";

export const DEEPSEEK: ProviderEndpoint = {
  id: "deepseek",
  label: "DeepSeek",
  group: "china",
  api: "openai-completions",
  baseUrl: "https://api.deepseek.com",
  checkModel: "deepseek-v4-flash",
  compat: { requiresAssistantAfterToolResult: true },
  temperatureRange: [0, 2],
  defaultTemperature: 1,
  writingTemperature: 1.5,
  temperatureHint: "Recommended 1.5 for creative writing",
  models: [
    { id: "deepseek-v4-flash", maxOutput: 393216, contextWindowTokens: 1_000_000, enabled: true, releasedAt: "2026-04-24" },
    { id: "deepseek-v4-pro", maxOutput: 393216, contextWindowTokens: 1_000_000, enabled: true, releasedAt: "2026-04-24" },
    { id: "deepseek-chat", maxOutput: 393216, contextWindowTokens: 1_000_000, releasedAt: "2026-04-24" },
    { id: "deepseek-reasoner", maxOutput: 393216, contextWindowTokens: 1_000_000, releasedAt: "2026-04-24" },
  ],
};
