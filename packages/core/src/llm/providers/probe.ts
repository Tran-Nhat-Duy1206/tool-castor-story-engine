import { fetchWithProxy } from "../../utils/proxy-fetch.js";

// LLM provider configuration and endpoints.

export interface ProbedModel {
  readonly id: string;
  readonly name: string;
  readonly contextWindow: number;
}

export async function probeModelsFromUpstream(
  baseUrl: string,
  apiKey: string,
  timeoutMs = 10_000,
): Promise<ReadonlyArray<ProbedModel>> {
  if (!baseUrl) return [];
  try {
    const modelsUrl = baseUrl.replace(/\/$/, "") + "/models";
    const res = await fetchWithProxy(modelsUrl, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: Array<{ id: unknown }> };
    if (!Array.isArray(json.data)) return [];
    return json.data
      .filter((m): m is { id: string } => typeof m.id === "string" && m.id.length > 0)
      .map((m) => ({ id: m.id, name: m.id, contextWindow: 0 }));
  } catch {
    return [];
  }
}
