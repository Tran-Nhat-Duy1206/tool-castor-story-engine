import { getEndpoint } from "./index.js";
import { resolveServiceModelsBaseUrl } from "../service-presets.js";
import { fetchWithProxy } from "../../utils/proxy-fetch.js";

export interface VerifyResult {
  readonly recommendedTransport?: {
    readonly apiFormat?: "chat" | "responses";
    readonly stream?: boolean;
  };
  readonly probe: {
    readonly ok: boolean;
    readonly models: number;
    readonly error?: string;
  };
  readonly chat: {
    readonly ok: boolean;
    readonly latencyMs?: number;
    readonly error?: string;
  } | null;
}

// LLM provider configuration and endpoints.
async function probe(
  service: string,
  apiKey: string,
  baseUrl?: string,
  proxyUrl?: string,
): Promise<VerifyResult["probe"]> {
  const provider = getEndpoint(service);
  const probeBaseUrl = baseUrl || provider?.modelsBaseUrl || provider?.baseUrl || resolveServiceModelsBaseUrl(service);
  if (!probeBaseUrl) {
    return { ok: false, models: 0, error: " baseUrl （custom / newapi / higress ）" };
  }
  try {
    const url = probeBaseUrl.replace(/\/$/, "") + "/models";
    const res = await fetchWithProxy(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    }, proxyUrl);
    if (!res.ok) {
      return { ok: false, models: 0, error: `HTTP ${res.status} ${res.statusText}` };
    }
    const json = (await res.json()) as { data?: Array<{ id: string }> };
    const count = json.data?.length ?? 0;
    return { ok: count > 0, models: count };
  } catch (error) {
    return {
      ok: false,
      models: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// LLM provider configuration and endpoints.
export async function verifyService(
  service: string,
  apiKey: string,
  opts?: { checkModel?: string; baseUrl?: string; proxyUrl?: string },
): Promise<VerifyResult> {
  const probeResult = await probe(service, apiKey, opts?.baseUrl, opts?.proxyUrl);

  const provider = getEndpoint(service);
  const recommendedTransport = provider?.transportDefaults;
  const checkModel = opts?.checkModel ?? provider?.checkModel;
  if (!checkModel) {
    return { recommendedTransport, probe: probeResult, chat: null };
  }

  const start = Date.now();
  try {
    const { createLLMClient, chatCompletion } = await import("../provider.js");
    const { LLMConfigSchema } = await import("../../models/project.js");
    const client = createLLMClient(LLMConfigSchema.parse({
      provider: provider?.api === "anthropic-messages" ? "anthropic" : "openai",
      service,
      model: checkModel,
      apiKey,
      baseUrl: opts?.baseUrl ?? provider?.baseUrl ?? "",
      proxyUrl: opts?.proxyUrl,
      configSource: "studio",
      stream: false,
    }));
    await chatCompletion(client, checkModel, [{ role: "user", content: "hi" }], { maxTokens: 10 });
    return { recommendedTransport, probe: probeResult, chat: { ok: true, latencyMs: Date.now() - start } };
  } catch (error) {
    return {
      recommendedTransport,
      probe: probeResult,
      chat: {
        ok: false,
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
