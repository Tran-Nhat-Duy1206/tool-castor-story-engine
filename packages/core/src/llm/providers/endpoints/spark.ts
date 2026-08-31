// LLM provider configuration and endpoints.
import type { ProviderEndpoint } from "../types.js";

export const SPARK: ProviderEndpoint = {
  id: "spark",
  label: "iFlytek Spark",
  group: "china",
  api: "openai-completions",
  baseUrl: "https://spark-api-open.xf-yun.com/v1",
  checkModel: "lite",
  temperatureRange: [0, 1],
  defaultTemperature: 0.5,
  writingTemperature: 0.95,
  models: [
    // LLM provider configuration and endpoints.
    { id: "4.0Ultra", maxOutput: 32768, contextWindowTokens: 32768, enabled: true }, // Spark 4.0 Ultra
    { id: "pro-128k", maxOutput: 32768, contextWindowTokens: 131072, enabled: true }, // Spark Pro-128K
    { id: "max-32k", maxOutput: 8192, contextWindowTokens: 32768 }, // Spark Max-32K
    { id: "generalv3.5", maxOutput: 8192, contextWindowTokens: 8192 }, // LLM provider configuration and endpoints.
    { id: "generalv3", maxOutput: 8192, contextWindowTokens: 8192 }, // Spark Pro
    { id: "lite", maxOutput: 4096, contextWindowTokens: 8192, enabled: true }, // Spark Lite
  ],
};
