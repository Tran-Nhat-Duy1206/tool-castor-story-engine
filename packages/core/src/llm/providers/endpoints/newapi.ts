// LLM provider configuration and endpoints.
import type { ProviderEndpoint } from "../types.js";

// LLM provider configuration and endpoints.
export const NEWAPI: ProviderEndpoint = {
  id: "newapi",
  label: "New API ()",
  group: "aggregator",
  api: "openai-completions",
  baseUrl: "",
  models: [],
};
