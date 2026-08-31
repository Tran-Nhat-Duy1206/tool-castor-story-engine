import { describe, it, expect, afterEach } from "vitest";
import { setAppLanguage } from "../lib/app-language";
import { getGroupDescription, getGroupLabel, getGroupShortLabel } from "../constants/service-groups";
import { getServiceQuickLinks } from "../components/ServiceQuickLinks";

// mock_val，mock_valTest。
afterEach(() => {
  setAppLanguage("vi");
});

describe("service-groups i18n", () => {
  it("mock_val（vi）mock_val", () => {
    expect(getGroupLabel("overseas")).toBe("Nhà cung cấp quốc tế");
    expect(getGroupShortLabel("aggregator")).toBe("Tổng hợp");
    expect(getGroupDescription("aggregator")).toContain("một API Key");
    expect(getGroupDescription("overseas")).toBeNull();
  });

  it("mock_val en mock_val", () => {
    setAppLanguage("en");
    expect(getGroupLabel("overseas")).toBe("International providers");
    expect(getGroupShortLabel("aggregator")).toBe("Aggregator");
    expect(getGroupDescription("aggregator")).toContain("one API key");
  });
});

describe("service quick links i18n", () => {
  it("mock_val（vi）mock_val，en mock_val，href mock_val", () => {
    const viLinks = getServiceQuickLinks("kkaiapi");
    expect(viLinks.map((l) => l.label)).toEqual(["Trang chủ", "Tài liệu API", "Mô hình & giá"]);

    setAppLanguage("en");
    const enLinks = getServiceQuickLinks("kkaiapi");
    expect(enLinks.map((l) => l.label)).toEqual(["Website", "API docs", "Models & pricing"]);
    expect(enLinks.map((l) => l.href)).toEqual(viLinks.map((l) => l.href));
  });
});
