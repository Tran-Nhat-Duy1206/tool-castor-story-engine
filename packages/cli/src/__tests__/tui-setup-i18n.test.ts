import { describe, expect, it } from "vitest";
import { buildAutoInitMessages, buildInteractiveSetupCopy, resolveSetupProvider, resolveSetupService } from "../tui/setup.js";

describe("tui setup i18n", () => {
  it("builds Vietnamese setup copy by default", () => {
    const copy = buildInteractiveSetupCopy("vi-VN");
    expect(copy.title).toBe("Cấu hình Model");
    expect(copy.subtitle).toContain("cấu hình dịch vụ model");
    expect(copy.steps.provider).toBe("Nhà cung cấp");
    expect(copy.hints.provider).toContain("kkaiapi");
    expect(copy.hints.apiKey).not.toMatch(/kkaiapi/i);
    expect(copy.steps.scope).toBe("Phạm vi lưu");
    expect(copy.scopeChoices.project).toBe("thư mục hiện tại");
  });

  it("builds localized auto-init messages", () => {
    expect(buildAutoInitMessages("Sơn Hải", "vi-VN").initializing).toContain("Đang khởi tạo dự án: Sơn Hải");
    expect(buildAutoInitMessages("harbor", "en").initialized).toContain("Project initialized");
  });

  it("uses Anthropic protocol for Kimi Code base URLs even when the user picked custom", () => {
    expect(resolveSetupProvider("custom", "https://api.kimi.com/coding")).toBe("anthropic");
    expect(resolveSetupProvider("openai", "https://api.kimi.com/coding/v1")).toBe("anthropic");
  });

  it("keeps kkaiapi as a service while using the OpenAI-compatible transport", () => {
    expect(resolveSetupProvider("kkaiapi", "https://api.kkaiapi.com/v1")).toBe("openai");
    expect(resolveSetupService("kkaiapi", "")).toBe("kkaiapi");
    expect(resolveSetupService("openai", "https://api.kkaiapi.com/v1")).toBe("kkaiapi");
  });
});
