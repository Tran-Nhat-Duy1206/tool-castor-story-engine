import { describe, it, expect, afterEach } from "vitest";
import { setAppLanguage } from "../lib/app-language";
import { getGroupDescription, getGroupLabel, getGroupShortLabel } from "../constants/service-groups";
import { getServiceQuickLinks } from "../components/ServiceQuickLinks";

// 每条用例结束后恢复默认语言，避免污染其他测试。
afterEach(() => {
  setAppLanguage("vi");
});

describe("service-groups i18n", () => {
  it("默认（vi）返回越南语标签", () => {
    expect(getGroupLabel("overseas")).toBe("Nhà cung cấp quốc tế");
    expect(getGroupShortLabel("aggregator")).toBe("Tổng hợp");
    expect(getGroupDescription("aggregator")).toContain("một API Key");
    expect(getGroupDescription("overseas")).toBeNull();
  });

  it("切换到 en 后返回英文标签", () => {
    setAppLanguage("en");
    expect(getGroupLabel("overseas")).toBe("International providers");
    expect(getGroupShortLabel("aggregator")).toBe("Aggregator");
    expect(getGroupDescription("aggregator")).toContain("one API key");
  });
});

describe("service quick links i18n", () => {
  it("默认（vi）返回越南语标签，en 分支返回英文标签，href 不变", () => {
    const viLinks = getServiceQuickLinks("kkaiapi");
    expect(viLinks.map((l) => l.label)).toEqual(["Trang chủ", "Tài liệu API", "Mô hình & giá"]);

    setAppLanguage("en");
    const enLinks = getServiceQuickLinks("kkaiapi");
    expect(enLinks.map((l) => l.label)).toEqual(["Website", "API docs", "Models & pricing"]);
    expect(enLinks.map((l) => l.href)).toEqual(viLinks.map((l) => l.href));
  });
});
