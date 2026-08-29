import {
  formatImportChaptersComplete,
  formatImportChaptersDiscovery,
  formatImportChaptersResume,
  formatWriteNextComplete,
  formatWriteNextProgress,
  formatWriteNextResultLines,
  type CliLanguage,
} from "./localization.js";

export { type CliLanguage };

export function formatWriteStartLine(
  language: CliLanguage,
  current: number,
  total: number,
  bookId: string,
): string {
  return formatWriteNextProgress(language, current, total, bookId);
}

export function formatWriteCompletionLines(
  language: CliLanguage,
  result: {
    readonly chapterNumber: number;
    readonly title: string;
    readonly wordCount: number;
    readonly passedAudit: boolean;
    readonly revised: boolean;
    readonly status: string;
    readonly issues: ReadonlyArray<{
      readonly severity: string;
      readonly category: string;
      readonly description: string;
    }>;
  },
): string[] {
  return [...formatWriteNextResultLines(language, result), ""];
}

export function formatWriteDoneLine(language: CliLanguage): string {
  return formatWriteNextComplete(language);
}

export function formatImportDiscoveryLine(
  language: CliLanguage,
  chapterCount: number,
  bookId: string,
): string {
  return formatImportChaptersDiscovery(language, chapterCount, bookId);
}

export function formatImportResumeLine(
  language: CliLanguage,
  resumeFrom: number,
): string {
  return formatImportChaptersResume(language, resumeFrom);
}

export function formatImportCompletionLines(
  language: CliLanguage,
  result: {
    readonly importedCount: number;
    readonly totalCountLabel: string;
    readonly nextChapter: number;
    readonly bookId: string;
  },
): string[] {
  return [
    language === "en" ? "Import complete:" : "Nhập chương hoàn tất:",
    language === "en"
      ? `  Chapters imported: ${result.importedCount}`
      : `  Đã nhập chương: ${result.importedCount}`,
    language === "en"
      ? `  Total length: ${result.totalCountLabel}`
      : `  Tổng độ dài: ${result.totalCountLabel}`,
    language === "en"
      ? `  Next chapter number: ${result.nextChapter}`
      : `  Số chương tiếp theo: ${result.nextChapter}`,
    "",
    language === "en"
      ? `Run "castor write next ${result.bookId}" to continue writing.`
      : `Chạy "castor write next ${result.bookId}" để tiếp tục viết.`,
  ];
}
