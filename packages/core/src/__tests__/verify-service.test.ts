import { describe, it, expect, vi, afterEach } from "vitest";
import { verifyService } from "../llm/providers/verify.js";

describe("verifyService (B9)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("probe mock_text → probe.ok=true + chat  từmock_text null（chat mock_text）", async () => {
    global.fetch = vi.fn()
      // probe /models mock_text
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }] }),
      } as any)
      // mock_text chat mock_text（Testmock_text openai SDK mock_text），mock_text OK —— mock_text chat mock_text
      .mockRejectedValue(new Error("test: no real chat backend"));

    const result = await verifyService("openai", "sk-test");
    expect(result.probe.ok).toBe(true);
    expect(result.probe.models).toBe(2);
    // chat  từmock_text null mock_text checkModel mock_text + chat mock_text（ok=true/false mock_text）
    expect(result.chat).not.toBeNull();
    expect(typeof result.chat?.ok).toBe("boolean");
    expect(result.chat?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("probe 401 → probe.ok=false, error mock_text 401", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    } as any) as typeof fetch;

    const result = await verifyService("openai", "wrong-key");
    expect(result.probe.ok).toBe(false);
    expect(result.probe.error).toContain("401");
  });

  it("probe mock_text → probe.ok=false, error mock_text fetch mock_text", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as typeof fetch;
    const result = await verifyService("openai", "sk-test");
    expect(result.probe.ok).toBe(false);
    expect(result.probe.error).toContain("ECONNREFUSED");
  });

  it("probe mock_text proxyUrl mock_text /models", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: "gpt-4o" }] }),
      } as any)
      .mockRejectedValue(new Error("test: no real chat backend"));
    global.fetch = fetchMock as typeof fetch;

    const result = await verifyService("openai", "sk-test", { proxyUrl: "http://127.0.0.1:9910" });
    expect(result.probe.ok).toBe(true);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      dispatcher: expect.any(Object),
    });
  });

  it("provider mock_text checkModel（custom baseUrl mock_text）→ chat  từmock_text null，mock_text chat mock_text", async () => {
    // custom mock_text checkModel，verifyService mock_text chat step
    const result = await verifyService("custom", "sk-x");
    expect(result.chat).toBeNull();
  });

  it("mock_text service → probe mock_text 'mock_text baseUrl'", async () => {
    const result = await verifyService("nonexistent-xyz", "sk-test");
    expect(result.probe.ok).toBe(false);
    expect(result.probe.error).toContain("baseUrl");
  });
});
