// Ứng dụng ngôn ngữ toàn cục: các module không phải React (store slice,
// parts-builder, error-copy, v.v.) không dùng được hook useI18n, nên đọc từ đây.
// App.tsx gọi setAppLanguage khi tải/đổi ngôn ngữ cấu hình dự án để đồng bộ.
export type AppLanguage = "vi" | "en";

let current: AppLanguage = "vi";

export function setAppLanguage(lang: AppLanguage): void {
  current = lang;
}

export function getAppLanguage(): AppLanguage {
  return current;
}

/** Song ngữ nội tuyến: tr("Tiếng Việt", "English"). Mặc định tiếng Việt; yêu cầu ngôn ngữ zh cũ cũng rơi về tiếng Việt. */
export function tr(vi: string, en: string): string {
  return current === "en" ? en : vi;
}
