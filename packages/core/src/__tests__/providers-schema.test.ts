import { describe, it, expect } from "vitest";
import { getAllEndpoints, getEndpoint } from "../llm/providers/index.js";

describe("providers structural integrity", () => {
  it("mock_text provider mock_text từmock_text", () => {
    const gatewayProviders = new Set(["custom", "newapi"]);
    for (const p of getAllEndpoints()) {
      expect(p.id).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(p.api).toMatch(/^(openai-completions|openai-responses|anthropic-messages|google-generative-ai)$/);
      // gateway/anchor provider mock_text baseUrl mock_text（mock_text）
      if (gatewayProviders.has(p.id)) {
        expect(typeof p.baseUrl).toBe("string");
      } else {
        expect(p.baseUrl, `provider=${p.id}`).toBeTruthy();
      }
    }
  });

  it("mock_text model card mock_text từmock_text contextWindowTokens >= maxOutput", () => {
    for (const p of getAllEndpoints()) {
      for (const m of p.models) {
        expect(m.id, `provider=${p.id}`).toBeTruthy();
        expect(m.maxOutput, `provider=${p.id} model=${m.id}`).toBeGreaterThan(0);
        expect(m.contextWindowTokens, `provider=${p.id} model=${m.id}`).toBeGreaterThanOrEqual(m.maxOutput);
      }
    }
  });

  it("mock_text provider mock_text id mock_text", () => {
    const ids = getAllEndpoints().map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("mock_text provider mock_text models mock_text id mock_text", () => {
    for (const p of getAllEndpoints()) {
      const ids = p.models.map((m) => m.id);
      expect(new Set(ids).size, `provider=${p.id} mock_text model id`).toBe(ids.length);
    }
  });

  it("DeepSeek mock_text API model card mock_text V4", () => {
    const deepseek = getEndpoint("deepseek");
    expect(deepseek?.checkModel).toBe("deepseek-v4-flash");

    expect(deepseek?.models).toEqual([
      { id: "deepseek-v4-flash", maxOutput: 393216, contextWindowTokens: 1_000_000, enabled: true, releasedAt: "2026-04-24" },
      { id: "deepseek-v4-pro", maxOutput: 393216, contextWindowTokens: 1_000_000, enabled: true, releasedAt: "2026-04-24" },
      { id: "deepseek-chat", maxOutput: 393216, contextWindowTokens: 1_000_000, releasedAt: "2026-04-24" },
      { id: "deepseek-reasoner", maxOutput: 393216, contextWindowTokens: 1_000_000, releasedAt: "2026-04-24" },
    ]);
  });

  it("Zhipu check model uses a stable chat alias", () => {
    const zhipu = getEndpoint("zhipu");
    expect(zhipu?.checkModel).toBe("glm-4-flash");
    expect(zhipu?.models.some((model) => model.id === "glm-4-flash" && model.enabled !== false)).toBe(true);
  });

  it("A mock_text 5 mock_text provider", () => {
    const ids = getAllEndpoints().map((p) => p.id);
    expect(ids).toContain("anthropic");
    expect(ids).toContain("openai");
    expect(ids).toContain("google");
    expect(ids).toContain("deepseek");
    expect(ids).toContain("minimax");
    // mock_text：mock_text bailian（Anthropic mock_text，mock_text），
    // mock_text qwen endpoint（OpenAI mock_text）
    expect(ids).toContain("bailian");
    expect(ids).not.toContain("qwen");
  });

  it("B1：mock_text 1 mock_text（9 mock_text，PPIO mock_text）", () => {
    const ids = getAllEndpoints().map((p) => p.id);
    for (const id of [
      "moonshot", "zhipu", "siliconcloud", "bailian",
      "volcengine", "hunyuan", "baichuan", "stepfun", "wenxin",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("B1：bailian mock_text anthropic-messages api（mock_text，mock_text lobe mock_text）", () => {
    expect(getEndpoint("bailian")?.api).toBe("anthropic-messages");
    expect(getEndpoint("bailian")?.baseUrl).toContain("/anthropic");
  });

  it("B1：minimax mock_text OpenAI-compatible chat endpoint", () => {
    expect(getEndpoint("minimax")?.api).toBe("openai-completions");
    expect(getEndpoint("minimax")?.baseUrl).toBe("https://api.minimaxi.com/v1");
  });

  it("B2：mock_text MiMo mock_text OpenAI-compatible endpoint", () => {
    expect(getEndpoint("xiaomimimo")?.api).toBe("openai-completions");
    expect(getEndpoint("xiaomimimo")?.baseUrl).toBe("https://api.xiaomimimo.com/v1");
  });

  it("B2：mock_text 2 mock_text（6 mock_text）", () => {
    const ids = getAllEndpoints().map((p) => p.id);
    for (const id of ["spark", "sensenova", "tencentcloud", "xiaomimimo", "longcat", "internlm"]) {
      expect(ids).toContain(id);
    }
  });

  it("B3：mock_text 3 mock_textCong khaimock_text（R5 mock_text higress）", () => {
    const ids = getAllEndpoints().map((p) => p.id);
    for (const id of ["zeroone", "ai360"]) {
      expect(ids).toContain(id);
    }
    for (const id of ["modelscope", "giteeai", "qiniu", "infiniai"]) {
      expect(ids).not.toContain(id);
    }
    expect(ids).not.toContain("higress");
  });

  it("B4：mock_text/mock_text/mock_text/mock_text/GH mock_text", () => {
    const ids = getAllEndpoints().map((p) => p.id);
    for (const id of ["ollama", "lmstudio", "openrouter", "custom", "mistral", "xai", "newapi", "githubCopilot", "kkaiapi"]) {
      expect(ids).toContain(id);
    }
  });

  it("B4：custom / newapi baseUrl mock_text（gateway mock_text）", () => {
    expect(getEndpoint("custom")?.baseUrl).toBe("");
    expect(getEndpoint("newapi")?.baseUrl).toBe("");
  });

  it("B4：mock_text provider mock_text = 31（mock_text CodingPlan mock_text）", () => {
    const nonCoding = getAllEndpoints().filter((p) => p.group !== "codingPlan");
    expect(nonCoding.length).toBe(31);
  });

  it("B6：CodingPlan 8 mock_text provider mock_text", () => {
    const ids = getAllEndpoints().map((p) => p.id);
    for (const id of [
      "kimiCodingPlan", "minimaxCodingPlan", "bailianCodingPlan",
      "glmCodingPlan", "volcengineCodingPlan", "opencodeCodingPlan",
      "astronCodingPlan", "kimicode",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("B6：mock_text provider mock_text = 39 (31 base + 8 CodingPlan)", () => {
    expect(getAllEndpoints().length).toBe(39);
  });

  it("B6：CodingPlan provider mock_text anthropic-messages", () => {
    for (const id of [
      "kimiCodingPlan", "minimaxCodingPlan", "bailianCodingPlan",
      "glmCodingPlan", "volcengineCodingPlan", "opencodeCodingPlan",
      "astronCodingPlan", "kimicode",
    ]) {
      expect(getEndpoint(id)?.api).toBe("anthropic-messages");
    }
  });

  it("R3：endpoint mock_text piProvider  từmock_text（mock_text provider-to-pi-ai adapter）", () => {
    for (const ep of getAllEndpoints()) {
      expect((ep as any).piProvider, `endpoint=${ep.id}`).toBeUndefined();
    }
  });
});
