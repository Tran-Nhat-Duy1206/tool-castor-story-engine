import { describe, expect, it } from "vitest";
import { formatModeLabel, getTuiCopy, normalizeStageLabel, resolveTuiLocale } from "../tui/i18n.js";

describe("tui i18n", () => {
  it("defaults to Vietnamese and supports explicit English override", () => {
    expect(resolveTuiLocale({})).toBe("vi-VN");
    expect(resolveTuiLocale({ CASTOR_TUI_LOCALE: "en" })).toBe("en");
    expect(resolveTuiLocale({ LANG: "en_US.UTF-8" })).toBe("en");
    expect(resolveTuiLocale({}, "en")).toBe("en");
  });

  it("falls back to the Vietnamese default for legacy zh locales", () => {
    expect(resolveTuiLocale({ CASTOR_TUI_LOCALE: "zh-CN" })).toBe("vi-VN");
    expect(resolveTuiLocale({ LANG: "zh_CN.UTF-8" })).toBe("vi-VN");
  });

  it("normalizes common activity labels for Vietnamese chrome", () => {
    const copy = getTuiCopy("vi-VN");
    expect(normalizeStageLabel("writing chapter", copy)).toBe("đang viết");
    expect(normalizeStageLabel("thinking ...", copy)).toBe("đang suy nghĩ");
    expect(normalizeStageLabel("idle", copy)).toBe("Sẵn sàng");
    expect(normalizeStageLabel("waiting_human", copy)).toBe("chờ bạn quyết định");
    expect(normalizeStageLabel("completed", copy)).toBe("hoàn thành");
    expect(formatModeLabel("semi", copy)).toBe("bán tự động");
    expect(formatModeLabel("auto", copy)).toBe("tự động");
  });
});
