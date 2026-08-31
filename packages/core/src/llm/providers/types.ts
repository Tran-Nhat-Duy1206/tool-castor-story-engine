// LLM provider configuration and endpoints.

export type ApiProtocol =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generative-ai";

export type EndpointGroup =
  | "overseas"
  | "china"
  | "aggregator"
  | "local"
  | "codingPlan";

export interface ProviderModel {
  // LLM provider configuration and endpoints.
  readonly id: string;
  // LLM provider configuration and endpoints.
  readonly maxOutput: number;
  // LLM provider configuration and endpoints.
  readonly contextWindowTokens: number;
  // LLM provider configuration and endpoints.
  readonly enabled?: boolean;
  // LLM provider configuration and endpoints.
  readonly deploymentName?: string;
  // LLM provider configuration and endpoints.
  readonly releasedAt?: string;
  // LLM provider configuration and endpoints.
  readonly temperature?: number;
  // LLM provider configuration and endpoints.
  readonly status?: "active" | "deprecated" | "disabled" | "nonText";
  readonly replacement?: string;
  readonly capabilities?: {
    readonly text?: boolean;
    readonly imageInput?: boolean;
    readonly imageOutput?: boolean;
    readonly tools?: boolean;
    readonly reasoning?: boolean;
  };
}

export interface ProviderCompat {
  // LLM provider configuration and endpoints.
  readonly supportsStore?: boolean;
  readonly supportsSystemRole?: boolean;
  readonly supportsDeveloperRole?: boolean;
  /** Some OpenAI-compatible providers reject restored histories ending in toolResult; only those providers get a synthetic assistant bridge during context projection. */
  readonly requiresAssistantAfterToolResult?: boolean;
}

export interface ProviderTransportDefaults {
  readonly apiFormat?: "chat" | "responses";
  readonly stream?: boolean;
}

export interface ProviderEndpoint {
  readonly id: string;
  readonly label: string;
  // LLM provider configuration and endpoints.
  readonly group?: EndpointGroup;

  readonly api: ApiProtocol;
  readonly baseUrl: string;
  // LLM provider configuration and endpoints.
  readonly modelsBaseUrl?: string;

  // LLM provider configuration and endpoints.
  readonly checkModel?: string;

  readonly temperatureRange?: readonly [number, number];
  readonly defaultTemperature?: number;
  readonly writingTemperature?: number;
  readonly temperatureHint?: string;
  readonly compat?: ProviderCompat;
  readonly transportDefaults?: ProviderTransportDefaults;

  readonly models: readonly ProviderModel[];
}
