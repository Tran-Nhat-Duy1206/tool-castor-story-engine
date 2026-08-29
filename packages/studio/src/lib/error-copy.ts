import { getAppLanguage } from "./app-language";

const KNOWN_RUNTIME_REPLACEMENTS: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly replacement: string;
}> = [
  {
    pattern: /Latest chapter (\d+) is state-degraded\. Repair state or rewrite that chapter before continuing\./g,
    replacement: "Chương mới nhất $1 đang ở trạng thái suy giảm (state-degraded). Trước khi viết chương tiếp theo, hãy sửa trạng thái hoặc viết lại chương này.",
  },
  {
    pattern: /Chapter (\d+) is not state-degraded\./g,
    replacement: "Chương $1 không ở trạng thái suy giảm (state-degraded), không cần sửa theo trạng thái.",
  },
  {
    pattern: /Only the latest state-degraded chapter can be repaired safely \(latest is (\d+)\)\./g,
    replacement: "Chỉ có thể sửa an toàn chương suy giảm trạng thái mới nhất; hiện chương mới nhất là chương $1.",
  },
  {
    pattern: /State repair still failed for chapter (\d+)\./g,
    replacement: "Sửa trạng thái cho chương $1 vẫn thất bại.",
  },
  {
    pattern: /Studio LLM API key not set\. Open Studio services and save an API key for the selected service\./g,
    replacement: "Chưa đặt API Key mô hình Studio. Hãy mở \"Cấu hình mô hình\" và lưu API Key cho dịch vụ hiện tại.",
  },
  {
    pattern: /CASTOR_LLM_API_KEY not set\. Run 'castor config set-global' or add it to project \.env file\./g,
    replacement: "CASTOR_LLM_API_KEY chưa được đặt. Hãy chạy `castor config set-global` hoặc thêm nó vào tệp .env của dự án.",
  },
];

export function localizeKnownRuntimeMessage(message: string): string {
  // Runtime messages arrive in English; in English mode show them as-is.
  if (getAppLanguage() === "en") return message;
  let localized = message;
  for (const entry of KNOWN_RUNTIME_REPLACEMENTS) {
    localized = localized.replace(entry.pattern, entry.replacement);
  }
  return localized;
}
