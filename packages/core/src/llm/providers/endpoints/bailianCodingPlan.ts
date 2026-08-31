// LLM provider configuration and endpoints.
import type { ProviderEndpoint } from "../types.js";

export const BAILIAN_CODING_PLAN: ProviderEndpoint = {
  id: "bailianCodingPlan",
  label: "Bailian Coding Plan",
  group: "codingPlan",
  api: "anthropic-messages",
  baseUrl: "https://dashscope.aliyuncs.com/apps/anthropic",
  checkModel: "qwen-max",
  temperatureRange: [0, 2],
  defaultTemperature: 0.7,
  writingTemperature: 1,
  models: [
    { id: "qwen3.5-plus", maxOutput: 65536, contextWindowTokens: 1000000, enabled: true, releasedAt: "2026-02-15" },
    { id: "qwen3-coder-plus", maxOutput: 65536, contextWindowTokens: 1000000, releasedAt: "2025-09-23" },
    { id: "qwen3-max-2026-01-23", maxOutput: 65536, contextWindowTokens: 262144, enabled: true, releasedAt: "2026-01-23" },
    { id: "qwen3-coder-next", maxOutput: 65536, contextWindowTokens: 262144, releasedAt: "2026-02-15" },
    { id: "glm-5", maxOutput: 131072, contextWindowTokens: 200000, enabled: true, releasedAt: "2026-02-12" },
    { id: "glm-4.7", maxOutput: 131072, contextWindowTokens: 200000, enabled: true, releasedAt: "2025-12-01" },
    { id: "kimi-k2.5", maxOutput: 32768, contextWindowTokens: 262144, enabled: true, releasedAt: "2026-01-27", temperature: 1 },
    { id: "MiniMax-M2.5", maxOutput: 131072, contextWindowTokens: 204800, enabled: true, releasedAt: "2026-02-12" },
  ],
};
