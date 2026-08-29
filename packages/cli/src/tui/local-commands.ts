import type { ChatDepth } from "./chat-depth.js";

export type LocalTuiCommand = "help" | "status" | "quit" | "clear" | "config";
export type ModelCommand =
  | { readonly kind: "show" }
  | { readonly kind: "set"; readonly model: string };

export function classifyLocalTuiCommand(input: string): LocalTuiCommand | undefined {
  const value = input.trim();

  if (/^\/help$/i.test(value) || /^(help|giup|giúp|tro giup|trợ giúp|帮助)$/i.test(value)) {
    return "help";
  }

  if (/^\/status$/i.test(value) || /^(status|trang thai|trạng thái|状态)$/i.test(value)) {
    return "status";
  }

  if (/^\/clear$/i.test(value) || /^(xoa man hinh|xóa màn hình|清屏)$/i.test(value)) {
    return "clear";
  }

  if (/^\/config$/i.test(value) || /^(config|cau hinh|cấu hình|配置)$/i.test(value)) {
    return "config";
  }

  if (/^\/quit$/i.test(value) || /^\/exit$/i.test(value) || /^(quit|exit|bye|thoat|thoát|退出)$/i.test(value)) {
    return "quit";
  }

  return undefined;
}

export function parseDepthCommand(input: string): ChatDepth | undefined {
  const value = input.trim().toLowerCase();
  const englishMatch = value.match(/^\/?depth\s+(light|normal|deep)$/);
  if (englishMatch?.[1]) {
    return englishMatch[1] as ChatDepth;
  }

  const chineseMatch = input.trim().match(/^\/?深度\s+(浅|轻量|标准|普通|深|深入)$/);
  if (chineseMatch?.[1]) {
    switch (chineseMatch[1]) {
      case "浅":
      case "轻量":
        return "light";
      case "深":
      case "深入":
        return "deep";
      case "标准":
      case "普通":
      default:
        return "normal";
    }
  }

  const vietnameseMatch = input.trim().match(/^\/?(?:do sau|độ sâu)\s+(nhe|nhẹ|nhe|chuan|chuẩn|thuong|thường|sau|san sau|sâu hơn)$/i);
  if (!vietnameseMatch?.[1]) {
    return undefined;
  }

  switch (vietnameseMatch[1]!.toLowerCase()) {
    case "nhe":
    case "nhẹ":
      return "light";
    case "sau":
    case "sâu hơn":
      return "deep";
    case "chuan":
    case "chuẩn":
    case "thuong":
    case "thường":
    default:
      return "normal";
  }
}

export function parseModelCommand(input: string): ModelCommand | undefined {
  const match = input.trim().match(/^\/model(?:\s+([\s\S]+?))?$/i);
  if (!match) return undefined;
  const model = match[1]?.trim();
  return model ? { kind: "set", model } : { kind: "show" };
}
