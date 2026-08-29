import type { EndpointGroup } from "../store/service/types";
import { tr } from "../lib/app-language";

export const GROUP_ORDER: ReadonlyArray<EndpointGroup> = [
  "aggregator",
  "overseas",
  "china",
  "local",
  "codingPlan",
] as const;

// Nhãn được resolve qua tr() khi render, không thể đóng băng thành chuỗi
// đơn ngữ khi nạp module, nên ở đây lưu cặp vi/en, các hàm getGroupLabel...
// bên dưới sẽ resolve khi được gọi.
const GROUP_LABELS: Record<EndpointGroup, { vi: string; en: string }> = {
  overseas: { vi: "Nhà cung cấp quốc tế", en: "International providers" },
  china: { vi: "Nhà cung cấp Trung Quốc", en: "China providers" },
  aggregator: { vi: "API tổng hợp", en: "Aggregator APIs" },
  local: { vi: "Cục bộ / Gói đăng ký", en: "Local / Subscription" },
  codingPlan: { vi: "CodingPlan", en: "CodingPlan" },
};

const GROUP_DESCRIPTIONS: Partial<Record<EndpointGroup, { vi: string; en: string }>> = {
  aggregator: {
    vi: "Tổng hợp các mô hình chủ lực trong và ngoài nước, phù hợp khi muốn truy cập nhiều mô hình bằng một API Key.",
    en: "Aggregates mainstream models from multiple vendors — access many models with one API key.",
  },
};

const GROUP_SHORT_LABELS: Record<EndpointGroup, { vi: string; en: string }> = {
  overseas: { vi: "Quốc tế", en: "Intl" },
  china: { vi: "Trung Quốc", en: "China" },
  aggregator: { vi: "Tổng hợp", en: "Aggregator" },
  local: { vi: "Cục bộ", en: "Local" },
  codingPlan: { vi: "CodingPlan", en: "CodingPlan" },
};

export function getGroupLabel(group: EndpointGroup): string {
  const label = GROUP_LABELS[group];
  return tr(label.vi, label.en);
}

export function getGroupDescription(group: EndpointGroup): string | null {
  const desc = GROUP_DESCRIPTIONS[group];
  return desc ? tr(desc.vi, desc.en) : null;
}

export function getGroupShortLabel(group: EndpointGroup): string {
  const label = GROUP_SHORT_LABELS[group];
  return tr(label.vi, label.en);
}
