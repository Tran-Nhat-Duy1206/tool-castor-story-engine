import { describe, it, expect } from "vitest";
import { lookupModel, listEnabledModels } from "../llm/providers/lookup.js";

describe("lookupModel", () => {
  describe("Layer 1（mock_text provider mock_text）", () => {
    it("anthropic mock_text claude-sonnet-4-6 mock_text provider.models", () => {
      const hit = lookupModel("anthropic", "claude-sonnet-4-6");
      expect(hit).toBeDefined();
      expect(hit?.maxOutput).toBe(64_000);
      expect(hit?.contextWindowTokens).toBe(1_000_000);
    });

    it("openai mock_text gpt-4o mock_text", () => {
      const hit = lookupModel("openai", "gpt-4o");
      expect(hit).toBeDefined();
      expect(hit?.maxOutput).toBe(4096);
      expect(hit?.contextWindowTokens).toBe(128_000);
    });

    it("mock_text", () => {
      const hit = lookupModel("anthropic", "CLAUDE-SONNET-4-6");
      expect(hit?.maxOutput).toBe(64_000);
    });
  });

  describe("Layer 2（mock_text）", () => {
    it("custom mock_text gpt-4o mock_text openai provider", () => {
      const hit = lookupModel("custom", "gpt-4o");
      expect(hit?.maxOutput).toBe(4096);
    });

    it("custom mock_text claude-sonnet-4-6 mock_text anthropic provider", () => {
      const hit = lookupModel("custom", "claude-sonnet-4-6");
      expect(hit?.maxOutput).toBe(64_000);
    });

    it("mock_text id mock_text undefined", () => {
      const hit = lookupModel("custom", "my-private-llm-does-not-exist");
      expect(hit).toBeUndefined();
    });
  });

  describe("Layer 2 mock_text（B mock_text）", () => {
    it("mock_text id mock_text provider mock_text PROVIDER_PRIORITY mock_text", () => {
      const hit = lookupModel("custom", "deepseek-chat");
      expect(hit?.maxOutput).toBeGreaterThan(0);
    });
  });
});

describe("Layer 2 mock_text（mock_text）", () => {
  it("deepseek/deepseek-r1-0528 mock_text OpenRouter provider", () => {
    const hit = lookupModel("custom", "deepseek/deepseek-r1-0528");
    expect(hit).toBeDefined();
    expect(hit?.maxOutput).toBe(4096);
  });

  it("OpenRouter mock_text id（:free）mock_text openrouter provider", () => {
    const hit = lookupModel("custom", "meta-llama/llama-3.1-8b-instruct:free");
    expect(hit).toBeDefined();
    expect(hit?.maxOutput).toBe(4096);
  });

  it("mock_text PPIO mock_text provider mock_text", () => {
    const hit = lookupModel("ppio", "deepseek/deepseek-v3.2");
    expect(hit).toBeUndefined();
  });
});

describe("listEnabledModels", () => {
  it("mock_text provider mock_text enabled !== false mock_text models", () => {
    const models = listEnabledModels("anthropic");
    expect(models.length).toBeGreaterThan(0);
    expect(models.every((m) => m.enabled !== false)).toBe(true);
  });

  it("mock_text service mock_text", () => {
    const models = listEnabledModels("nope");
    expect(models).toEqual([]);
  });
});
