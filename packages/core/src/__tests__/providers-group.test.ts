import { describe, expect, it } from "vitest";
import { getAllEndpoints } from "../llm/providers/index.js";

describe("ProviderEndpoint.group", () => {
  it("mock_text custom endpoint mock_text group  từmock_text", () => {
    const missing = getAllEndpoints().filter((ep) => ep.id !== "custom" && !ep.group);
    expect(missing, `missing group: ${missing.map((e) => e.id).join(", ")}`).toHaveLength(0);
  });

  it("mock_text group mock_text endpoint mock_text", () => {
    const all = getAllEndpoints();
    const byGroup = (g: string) => all.filter((ep) => ep.group === g).map((e) => e.id).sort();

    expect(byGroup("overseas")).toEqual(["anthropic", "google", "mistral", "openai", "xai"].sort());
    expect(byGroup("china")).toEqual([
      "ai360", "baichuan", "bailian", "deepseek", "hunyuan", "internlm", "longcat",
      "minimax", "moonshot", "sensenova", "spark", "stepfun", "tencentcloud",
      "volcengine", "wenxin", "xiaomimimo", "zeroone", "zhipu",
    ].sort());
    expect(byGroup("aggregator")).toEqual([
      "kkaiapi", "newapi", "openrouter", "siliconcloud",
    ].sort());
    expect(byGroup("local")).toEqual(["githubCopilot", "lmstudio", "ollama"].sort());
    expect(byGroup("codingPlan")).toEqual([
      "astronCodingPlan", "bailianCodingPlan", "glmCodingPlan", "kimiCodingPlan", "kimicode",
      "minimaxCodingPlan", "opencodeCodingPlan", "volcengineCodingPlan",
    ].sort());
  });

  it("custom endpoint mock_text", () => {
    const custom = getAllEndpoints().find((ep) => ep.id === "custom");
    expect(custom).toBeDefined();
  });
});
