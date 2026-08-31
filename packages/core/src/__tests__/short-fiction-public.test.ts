import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LLMClient } from "../llm/provider.js";
import {
  ShortFictionOutlineAgent,
  ShortFictionOutlineReviserAgent,
  ShortFictionDraftReviserAgent,
  parseShortFictionBatchDraft,
  validateShortFictionDraftForFinal,
} from "../agents/short-fiction.js";
import { saveSecrets } from "../llm/secrets.js";
import {
  extractGeminiImageBase64,
  extractImagesGenerationImage,
  generateShortFictionCover,
  resolveCoverGenerationRequest,
} from "../pipeline/short-fiction-runner.js";

const ZERO_USAGE = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

function fakeClient(): LLMClient {
  return {
    provider: "openai",
    apiFormat: "chat",
    stream: false,
    defaults: {
      temperature: 0.7,
      maxTokens: 8192,
      thinkingBudget: 0,
      extra: {},
    },
  };
}

describe("public short-fiction chain", () => {
  it("gives outline generation enough output budget for models with a separate reasoning channel", async () => {
    const validOutline = `=== SHORT_FICTION_PLAN_TITLE ===\nmock_text\n=== SHORT_FICTION_PLAN ===\n## 12mock_text`;
    const createChat = vi
      .spyOn(ShortFictionOutlineAgent.prototype as never, "chat" as never)
      .mockResolvedValue({ content: validOutline, usage: ZERO_USAGE });
    const reviseChat = vi
      .spyOn(ShortFictionOutlineReviserAgent.prototype as never, "chat" as never)
      .mockResolvedValue({ content: validOutline, usage: ZERO_USAGE });
    const context = { client: fakeClient(), model: "fake", projectRoot: "/tmp" };

    const first = await new ShortFictionOutlineAgent(context).createOutline({
      direction: "mock_text", chapterCount: 12, charsPerChapter: 1000,
    });
    await new ShortFictionOutlineReviserAgent(context).reviseOutline({
      direction: "mock_text", outline: first, review: "mock_text", chapterCount: 12, charsPerChapter: 1000,
    });

    expect(createChat.mock.calls[0]?.[1]).toMatchObject({ maxTokens: 16_384 });
    expect(reviseChat.mock.calls[0]?.[1]).toMatchObject({ maxTokens: 16_384 });
  });

  it("parses a complete tagged short-fiction draft", () => {
    const draft = parseShortFictionBatchDraft(`
=== SHORT_FICTION_TITLE ===
mock_text，mock_text
=== SHORT_FICTION_OPENING_HOOK ===
mock_text，mock_text。
=== CHAPTER 1 TITLE ===
mock_text
=== CHAPTER 1 CONTENT ===
mock_text，mock_text。mock_text，mock_text，mock_text，mock_text。
=== CHAPTER 2 TITLE ===
mock_text
=== CHAPTER 2 CONTENT ===
Chương mock_text，mock_text。mock_text，mock_text。mock_text，mock_textChương mock_text。
`, { expectedChapters: 2 });

    expect(draft.storyTitle).toBe("mock_text，mock_text");
    expect(draft.openingHook).toContain("mock_text");
    expect(draft.chapters).toHaveLength(2);
    expect(draft.chapters[0]?.title).toContain("mock_text");
    expect(draft.chapters[1]?.charCount).toBeGreaterThan(20);
    expect(() => validateShortFictionDraftForFinal(draft, { expectedChapters: 2 })).not.toThrow();
  });

  it("recovers chapter content when a model repeats the title tag instead of the content tag", () => {
    const draft = parseShortFictionBatchDraft(`
=== SHORT_FICTION_TITLE ===
mock_text，mock_text
=== CHAPTER 1 TITLE ===
mock_text
=== CHAPTER 1 CONTENT ===
mock_text，mock_text。
=== CHAPTER 2 TITLE ===
mock_text
=== CHAPTER 2 TITLE ===
mock_text，mock_text。
mock_text，mock_text，mock_text。
Chương mock_text，mock_text：“mock_text，mock_text。”
=== CHAPTER 3 TITLE ===
mock_text，mock_text
=== CHAPTER 3 TITLE ===
mock_text，mock_text，mock_text。
mock_text，mock_text。
`, { expectedChapters: 3 });

    expect(draft.chapters[1]?.title).toBe("mock_text");
    expect(draft.chapters[1]?.content).toContain("mock_text");
    expect(draft.chapters[1]?.content).not.toContain("mock_text");
    expect(draft.chapters[2]?.content).toContain("mock_text");
    expect(() => validateShortFictionDraftForFinal(draft, { expectedChapters: 3 })).not.toThrow();
  });

  it("uses the previous draft as assistant context for the second writer pass", async () => {
    const firstDraft = parseShortFictionBatchDraft(`
=== SHORT_FICTION_TITLE ===
mock_text
=== CHAPTER 1 TITLE ===
mock_text
=== CHAPTER 1 CONTENT ===
mock_text。
`, { expectedChapters: 1 });

    const chatSpy = vi
      .spyOn(ShortFictionDraftReviserAgent.prototype as never, "chat" as never)
      .mockResolvedValue({
        content: `
=== SHORT_FICTION_TITLE ===
mock_text
=== CHAPTER 1 TITLE ===
mock_text
=== CHAPTER 1 CONTENT ===
mock_text。
`,
        usage: ZERO_USAGE,
      });

    const agent = new ShortFictionDraftReviserAgent({
      client: fakeClient(),
      model: "fake",
      projectRoot: "/tmp",
    });

    const revised = await agent.reviseDraft({
      direction: "mock_text mock_text",
      outlineMarkdown: "12mock_text",
      draft: firstDraft,
      review: "mock_text，Chương mock_text。",
      chapterCount: 1,
      charsPerChapter: 1000,
    });

    const messages = chatSpy.mock.calls[0]?.[0] as ReadonlyArray<{ role: string; content: string }>;
    expect(messages.map((message) => message.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(messages[2]?.content).toContain("mock_text");
    expect(messages[3]?.content).toContain("mock_text");
    expect(revised.storyTitle).toBe("mock_text");

    chatSpy.mockRestore();
  });

  it("resolves cover generation from project cover config and stored cover secret", async () => {
    const root = await mkdtemp(join(tmpdir(), "castor-short-cover-"));
    try {
      await writeFile(join(root, "castor.json"), JSON.stringify({
        name: "cover-test",
        version: "0.1.0",
        language: "vi",
        llm: {
          provider: "openai",
          service: "kkaiapi",
          configSource: "studio",
          baseUrl: "https://api.kkaiapi.com/v1",
          apiKey: "",
          model: "deepseek-v4-flash",
          cover: {
            service: "kkaiapi",
            model: "gpt-image-2",
          },
        },
        notify: [],
      }, null, 2), "utf-8");
      await saveSecrets(root, {
        services: {
          "cover:kkaiapi": { apiKey: "sk-cover" },
        },
      });

      await expect(resolveCoverGenerationRequest({ root })).resolves.toMatchObject({
        api: "images",
        baseUrl: "https://api.kkaiapi.com/v1",
        model: "gpt-image-2",
        apiKey: "sk-cover",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses a custom cover base URL stored in the project cover config", async () => {
    const root = await mkdtemp(join(tmpdir(), "castor-short-cover-custom-"));
    try {
      await writeFile(join(root, "castor.json"), JSON.stringify({
        name: "cover-test",
        version: "0.1.0",
        language: "vi",
        llm: {
          provider: "openai",
          service: "kkaiapi",
          configSource: "studio",
          baseUrl: "https://api.kkaiapi.com/v1",
          apiKey: "",
          model: "deepseek-v4-flash",
          cover: {
            service: "kkaiapi",
            model: "gpt-image-2",
            baseUrl: "https://images.example.com/v1",
          },
        },
        notify: [],
      }, null, 2), "utf-8");
      await saveSecrets(root, {
        services: {
          "cover:kkaiapi": { apiKey: "sk-cover" },
        },
      });

      await expect(resolveCoverGenerationRequest({ root })).resolves.toMatchObject({
        api: "images",
        baseUrl: "https://images.example.com/v1",
        model: "gpt-image-2",
        apiKey: "sk-cover",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("extracts OpenAI-compatible image generation URLs and base64 payloads", () => {
    expect(extractImagesGenerationImage({
      data: [{ url: "https://api.kkaiapi.com/files/img_abc123.png" }],
    })).toEqual({ url: "https://api.kkaiapi.com/files/img_abc123.png" });

    expect(extractImagesGenerationImage({
      data: [{ b64_json: "ZmFrZQ==" }],
    })).toEqual({ base64: "ZmFrZQ==", extension: "png" });
  });

  it("extracts Gemini inline image data from generateContent responses", () => {
    const image = extractGeminiImageBase64({
      candidates: [
        {
          content: {
            parts: [
              { text: "ok" },
              { inlineData: { mimeType: "image/jpeg", data: "ZmFrZQ==" } },
            ],
          },
        },
      ],
    });

    expect(image).toEqual({ base64: "ZmFrZQ==", extension: "jpg" });
  });

  it("generates a standalone cover artifact without running the short fiction pipeline", async () => {
    const root = await mkdtemp(join(tmpdir(), "castor-cover-tool-"));
    const originalFetch = globalThis.fetch;
    const controller = new AbortController();
    process.env.CASTOR_TEST_COVER_KEY = "sk-cover";
    try {
      const fetchMock = vi.fn(async (_url: unknown, _init?: { readonly body?: unknown }) => new Response(JSON.stringify({
        data: [{ b64_json: "ZmFrZQ==" }],
      }), { status: 200, headers: { "content-type": "application/json" } }));
      globalThis.fetch = fetchMock as never;

      const result = await generateShortFictionCover({
        projectRoot: root,
        title: "mock_text",
        intro: "mock_text từmock_text。",
        sellingPoints: ["mock_text", "mock_text"],
        coverPrompt: "mock_text，mock_text。",
        outputDir: "covers/demo",
        coverEndpoint: "https://images.example.test/v1/images/generations",
        coverModel: "gpt-image-2",
        coverApiKeyEnv: "CASTOR_TEST_COVER_KEY",
        signal: controller.signal,
      });

      expect(result.coverPromptPath).toBe("covers/demo/cover-prompt.md");
      expect(result.coverImagePath).toBe("covers/demo/cover.png");
      await expect(readFile(join(root, "covers", "demo", "cover-prompt.md"), "utf-8"))
        .resolves.toContain("mock_text");
      await expect(readFile(join(root, "covers", "demo", "cover.png")))
        .resolves.toEqual(Buffer.from("fake"));
      expect(fetchMock).toHaveBeenCalledWith(
        "https://images.example.test/v1/images/generations",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("mock_text"),
          signal: controller.signal,
        }),
      );
      const body = String(fetchMock.mock.calls[0]?.[1]?.body ?? "");
      expect(body).toContain("mock_text、mock_text、mock_text。");
      expect(body).not.toContain("mock_text từ");
      expect(body).not.toContain("mock_text");
      expect(body).not.toContain("mock_text");
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.CASTOR_TEST_COVER_KEY;
      await rm(root, { recursive: true, force: true });
    }
  });
});
