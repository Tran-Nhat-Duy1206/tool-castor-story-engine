import { formatLengthCount, resolveLengthCountingMode } from "@actalk/castor-core";
import { castorEnv } from "./utils.js";

export type CliLanguage = "vi" | "en";

type WriteIssue = {
  readonly severity: string;
  readonly category: string;
  readonly description: string;
};

type WriteResultShape = {
  readonly chapterNumber: number;
  readonly title: string;
  readonly wordCount: number;
  readonly status: string;
  readonly revised: boolean;
  readonly issues: ReadonlyArray<WriteIssue>;
  readonly auditPassed?: boolean;
  readonly passedAudit?: boolean;
};

type ImportResultShape = {
  readonly importedCount: number;
  readonly totalWords: number;
  readonly nextChapter: number;
  readonly continueBookId: string;
};

function localize(language: CliLanguage, messages: { vi: string; en: string }): string {
  return language === "en" ? messages.en : messages.vi;
}

function normalizeCliLanguageTag(value: string | undefined): CliLanguage | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("en")) {
    return "en";
  }
  if (normalized.startsWith("vi")) {
    return "vi";
  }
  // Legacy product locale "zh" falls back to the Vietnamese default (spec §21.5).
  return undefined;
}

export function resolveCliLanguage(
  language?: string,
  env: NodeJS.ProcessEnv = process.env,
): CliLanguage {
  const explicit = normalizeCliLanguageTag(language);
  if (explicit) {
    return explicit;
  }

  const requested = normalizeCliLanguageTag(castorEnv("CASTOR_LOCALE", env));
  if (requested) {
    return requested;
  }

  const detected = normalizeCliLanguageTag(env.LC_ALL ?? env.LC_MESSAGES ?? env.LANG);
  return detected ?? "vi";
}

/**
 * Vietnamese is counted in words (space-separated script), like English.
 * This is display-only: chapter word counts for a book still follow the
 * book's own language through resolveLengthCountingMode(book.language).
 */
function displayLengthCount(count: number): string {
  return formatLengthCount(count, resolveLengthCountingMode("en"));
}

export function formatBookCreateCreating(
  language: CliLanguage,
  title: string,
  genre: string,
  platform: string,
): string {
  return localize(language, {
    vi: `Đang tạo sách "${title}" (${genre} / ${platform})...`,
    en: `Creating book "${title}" (${genre} / ${platform})...`,
  });
}

export function formatBookCreateCreated(language: CliLanguage, bookId: string): string {
  return localize(language, {
    vi: `Đã tạo sách: ${bookId}`,
    en: `Book created: ${bookId}`,
  });
}

export function formatBookCreateLocation(language: CliLanguage, bookId: string): string {
  return localize(language, {
    vi: `  Vị trí: books/${bookId}/`,
    en: `  Location: books/${bookId}/`,
  });
}

export function formatBookCreateFoundationReady(language: CliLanguage): string {
  return localize(language, {
    vi: "  Đã tạo xong kinh thánh truyện, đại cương và quy tắc sách.",
    en: "  Story bible, outline, book rules generated.",
  });
}

export function formatBookCreateNextStep(language: CliLanguage, bookId: string): string {
  return localize(language, {
    vi: `Bước tiếp theo: castor write next ${bookId}`,
    en: `Next: castor write next ${bookId}`,
  });
}

export function formatWriteNextProgress(
  language: CliLanguage,
  current: number,
  total: number,
  bookId: string,
): string {
  return localize(language, {
    vi: `[${current}/${total}] Đang viết chương cho "${bookId}"...`,
    en: `[${current}/${total}] Writing chapter for "${bookId}"...`,
  });
}

export function formatWriteNextResultLines(
  language: CliLanguage,
  result: WriteResultShape,
): string[] {
  const auditPassed = result.auditPassed ?? result.passedAudit ?? false;
  const lengthLabel = displayLengthCount(result.wordCount);
  const lines = [
    localize(language, {
      vi: `  Chương ${result.chapterNumber}: ${result.title}`,
      en: `  Chapter ${result.chapterNumber}: ${result.title}`,
    }),
    localize(language, {
      vi: `  Độ dài: ${lengthLabel}`,
      en: `  Length: ${lengthLabel}`,
    }),
    localize(language, {
      vi: `  Kiểm tra: ${auditPassed ? "ĐẠT" : "CẦN XEM LẠI"}`,
      en: `  Audit: ${auditPassed ? "PASSED" : "NEEDS REVIEW"}`,
    }),
  ];

  if (result.revised) {
    lines.push(localize(language, {
      vi: "  Tự động chỉnh sửa: CÓ (đã sửa các lỗi nghiêm trọng)",
      en: "  Auto-revised: YES (critical issues were fixed)",
    }));
  }

  lines.push(localize(language, {
    vi: `  Trạng thái: ${result.status}`,
    en: `  Status: ${result.status}`,
  }));

  if (result.issues.length > 0) {
    lines.push(localize(language, {
      vi: "  Vấn đề:",
      en: "  Issues:",
    }));
    for (const issue of result.issues) {
      lines.push(`    [${issue.severity}] ${issue.category}: ${issue.description}`);
    }
  }

  return lines;
}

export function formatWriteNextComplete(language: CliLanguage): string {
  return localize(language, {
    vi: "Hoàn tất.",
    en: "Done.",
  });
}

export function formatAutoWriteStart(
  language: CliLanguage,
  bookId: string,
  startChapter: number,
  targetChapter: number,
): string {
  return localize(language, {
    vi: `Tự động viết "${bookId}": từ chương ${startChapter} đến chương ${targetChapter}...`,
    en: `Auto-writing "${bookId}": chapter ${startChapter} through chapter ${targetChapter}...`,
  });
}

export function formatAutoWriteAlreadyComplete(
  language: CliLanguage,
  bookId: string,
  writtenChapters: number,
  targetChapter: number,
): string {
  return localize(language, {
    vi: `"${bookId}" đã viết ${writtenChapters} chương (mục tiêu chương ${targetChapter}), không cần tiếp tục.`,
    en: `"${bookId}" already has ${writtenChapters} chapter(s) written (target: chapter ${targetChapter}). Nothing to do.`,
  });
}

export type NotifyCommandAction = "write-next" | "write-rewrite" | "revise" | "audit" | "auto";

const NOTIFY_ACTION_LABELS: Record<NotifyCommandAction, { vi: string; en: string }> = {
  "write-next": { vi: "Viết", en: "Write" },
  "write-rewrite": { vi: "Viết lại", en: "Rewrite" },
  revise: { vi: "Chỉnh sửa", en: "Revise" },
  audit: { vi: "Kiểm tra", en: "Audit" },
  auto: { vi: "Tự động viết liên tiếp", en: "Auto-write" },
};

export function formatNotifyCommandTitle(
  language: CliLanguage,
  action: NotifyCommandAction,
  bookName: string | undefined,
  succeeded: boolean,
): string {
  const label = localize(language, NOTIFY_ACTION_LABELS[action]);
  const book = bookName === undefined
    ? ""
    : localize(language, { vi: `: ${bookName}`, en: `: ${bookName}` });
  return succeeded
    ? localize(language, { vi: `✅ ${label} hoàn tất${book}`, en: `✅ ${label} complete${book}` })
    : localize(language, { vi: `❌ ${label} thất bại${book}`, en: `❌ ${label} failed${book}` });
}

export function formatNotifyBatchWriteBody(
  language: CliLanguage,
  chapters: ReadonlyArray<{
    readonly chapterNumber: number;
    readonly title: string;
    readonly wordCount: number;
    readonly auditPassed: boolean;
  }>,
): string {
  const first = chapters[0]!;
  const last = chapters[chapters.length - 1]!;
  const lines = [
    localize(language, {
      vi: `Hoàn thành ${chapters.length} chương (từ chương ${first.chapterNumber} đến chương ${last.chapterNumber})`,
      en: `${chapters.length} chapter(s) written (chapter ${first.chapterNumber} to ${last.chapterNumber})`,
    }),
    ...chapters.map((ch) => {
      const lengthLabel = displayLengthCount(ch.wordCount);
      return localize(language, {
        vi: `Chương ${ch.chapterNumber} ${ch.title} | ${lengthLabel} | ${ch.auditPassed ? "kiểm tra đạt" : "cần xem lại"}`,
        en: `Chapter ${ch.chapterNumber} ${ch.title} | ${lengthLabel} | ${ch.auditPassed ? "audit passed" : "needs review"}`,
      });
    }),
  ];
  return lines.join("\n");
}

export function formatNotifyAuditBody(
  language: CliLanguage,
  result: {
    readonly chapterNumber: number;
    readonly passed: boolean;
    readonly issueCount: number;
    readonly summary: string;
  },
): string {
  const head = localize(language, {
    vi: `Kiểm tra chương ${result.chapterNumber} ${result.passed ? "đạt" : "không đạt"} (${result.issueCount} vấn đề)`,
    en: `Chapter ${result.chapterNumber} audit ${result.passed ? "passed" : "failed"} (${result.issueCount} issue(s))`,
  });
  return result.summary ? `${head}\n${result.summary}` : head;
}

export function formatNotifyReviseBody(
  language: CliLanguage,
  result: {
    readonly chapterNumber: number;
    readonly applied: boolean;
    readonly wordCount: number;
    readonly fixedCount: number;
    readonly skippedReason?: string;
  },
): string {
  if (!result.applied) {
    return localize(language, {
      vi: `Chương ${result.chapterNumber} giữ nguyên bản gốc${result.skippedReason ? `: ${result.skippedReason}` : ""}`,
      en: `Chapter ${result.chapterNumber} kept original draft${result.skippedReason ? `: ${result.skippedReason}` : ""}`,
    });
  }
  const lengthLabel = displayLengthCount(result.wordCount);
  return localize(language, {
    vi: `Chương ${result.chapterNumber} đã chỉnh sửa | ${lengthLabel} | đã sửa ${result.fixedCount} vấn đề`,
    en: `Chapter ${result.chapterNumber} revised | ${lengthLabel} | ${result.fixedCount} issue(s) fixed`,
  });
}

export function formatNotifyFailureBody(language: CliLanguage, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return localize(language, {
    vi: `Lỗi: ${detail}`,
    en: `Error: ${detail}`,
  });
}

export function formatImportChaptersDiscovery(
  language: CliLanguage,
  chapterCount: number,
  bookId: string,
): string {
  return localize(language, {
    vi: `Tìm thấy ${chapterCount} chương, chuẩn bị nhập vào "${bookId}".`,
    en: `Found ${chapterCount} chapters to import into "${bookId}".`,
  });
}

export function formatImportChaptersResume(
  language: CliLanguage,
  resumeFrom: number,
): string {
  return localize(language, {
    vi: `Tiếp tục nhập từ chương ${resumeFrom}.`,
    en: `Resuming from chapter ${resumeFrom}.`,
  });
}

export function formatImportChaptersComplete(
  language: CliLanguage,
  result: ImportResultShape,
): string[] {
  const lengthLabel = displayLengthCount(result.totalWords);
  return [
    localize(language, {
      vi: "Nhập hoàn tất:",
      en: "Import complete:",
    }),
    localize(language, {
      vi: `  Số chương đã nhập: ${result.importedCount}`,
      en: `  Chapters imported: ${result.importedCount}`,
    }),
    localize(language, {
      vi: `  Tổng độ dài: ${lengthLabel}`,
      en: `  Total length: ${lengthLabel}`,
    }),
    localize(language, {
      vi: `  Số chương kế tiếp: ${result.nextChapter}`,
      en: `  Next chapter number: ${result.nextChapter}`,
    }),
    "",
    localize(language, {
      vi: `Chạy "castor write next ${result.continueBookId}" để tiếp tục viết.`,
      en: `Run "castor write next ${result.continueBookId}" to continue writing.`,
    }),
  ];
}

export function formatImportCanonStart(
  language: CliLanguage,
  parentBookId: string,
  targetBookId: string,
): string {
  return localize(language, {
    vi: `Đang nhập chính thống từ "${parentBookId}" vào "${targetBookId}"...`,
    en: `Importing canon from "${parentBookId}" into "${targetBookId}"...`,
  });
}

export function formatImportCanonComplete(language: CliLanguage): string[] {
  return [
    localize(language, {
      vi: "Đã nhập chính thống: story/parent_canon.md",
      en: "Canon imported: story/parent_canon.md",
    }),
    localize(language, {
      vi: "Writer và auditor sẽ tự động nhận diện file này ở chế độ ngoại truyện.",
      en: "Writer and auditor will auto-detect this file for spinoff mode.",
    }),
  ];
}

export function formatListModelsEmpty(language: CliLanguage, service: string): string {
  return localize(language, {
    vi: `${service} không có model khả dụng (có thể cần --api-key và --base-url)`,
    en: `No models available for ${service} (you may need --api-key and --base-url)`,
  });
}

export function formatListModelsHeader(
  language: CliLanguage,
  service: string,
  count: number,
): string {
  return localize(language, {
    vi: `${service}: ${count} model`,
    en: `${service}: ${count} model(s)`,
  });
}

export function formatDoctorHintQuota(language: CliLanguage): string {
  return localize(language, {
    vi: "Kiểm tra API Key có đúng không, model có khả dụng không, và tài khoản còn đủ số dư hoặc hạn mức không.",
    en: "Check that the API key is valid, the model is available, and the account has enough balance or quota.",
  });
}

export function formatDoctorHintOpenAiProbeExhausted(language: CliLanguage): string {
  return localize(language, {
    vi: "Đã tự động thử tất cả tổ hợp chat/responses và bật/tắt stream; nếu vẫn lỗi, nguyên nhân nhiều khả năng nằm ở tên model, đường dẫn baseUrl hoặc khả năng tương thích của nhà cung cấp.",
    en: "All chat/responses and stream on/off combinations were already probed; if it still fails, the problem is more likely the model name, the baseUrl path, or provider compatibility itself.",
  });
}

export function formatDoctorHintBaseUrl(language: CliLanguage): string {
  return localize(language, {
    vi: "baseUrl có thể sai; kiểm tra CASTOR_LLM_BASE_URL đã chứa đầy đủ đường dẫn chưa (ví dụ /v1)",
    en: "The baseUrl may be wrong. Check that CASTOR_LLM_BASE_URL includes the full path (e.g. /v1).",
  });
}

export function formatDoctorHintStreamRequirement(language: CliLanguage): string {
  return localize(language, {
    vi: "Xem tài liệu nhà cung cấp để xác nhận endpoint yêu cầu stream=true, stream=false hay không hỗ trợ stream",
    en: "Check the provider docs to confirm whether the endpoint requires stream=true, stream=false, or does not support streaming at all.",
  });
}

export function formatDoctorHintModelName(language: CliLanguage): string {
  return localize(language, {
    vi: "Kiểm tra tên model đã đúng chưa (CASTOR_LLM_MODEL)",
    en: "Check that the model name is correct (CASTOR_LLM_MODEL).",
  });
}

export function formatDoctorHintInvalidApiKey(language: CliLanguage): string {
  return localize(language, {
    vi: "API Key không hợp lệ; kiểm tra CASTOR_LLM_API_KEY",
    en: "The API key is invalid. Check CASTOR_LLM_API_KEY.",
  });
}

// Fanfic errors are intentionally bilingual in a single string: they can surface
// through `--json` output or be rethrown before any book language is known.
export function formatFanficInvalidModeError(mode: string): string {
  return `Invalid fanfic mode: "${mode}". Valid modes: canon, au, ooc, cp (Chế độ fanfic không hợp lệ: "${mode}", chọn canon、au、ooc、cp)`;
}

export function formatFanficSourceTooShortError(length: number): string {
  return `Source material too short (${length} chars); provide at least 100 chars (Nguyên liệu quá ngắn, chỉ ${length} ký tự, cần ít nhất 100 ký tự)`;
}

export function formatFanficCanonMissingError(): string {
  return "No fanfic canon found for this book. Create one with `castor fanfic init` (Chưa có file chính thống fanfic cho sách này; dùng castor fanfic init để tạo)";
}

export function formatFanficSourceDirEmptyError(sourcePath: string): string {
  return `No .txt or .md files found in ${sourcePath} (Không có file .txt hoặc .md nào trong thư mục ${sourcePath})`;
}

export function formatChapterSyncNoChanges(language: CliLanguage, checked: number): string {
  return localize(language, {
    vi: `Đã đối chiếu ${checked} chương; số từ trong index.json đã khớp với file.`,
    en: `Checked ${checked} chapter(s); index.json word counts already match the files.`,
  });
}

export function formatChapterSyncChange(
  language: CliLanguage,
  change: { number: number; title: string; previousWordCount: number; wordCount: number },
  countingMode: "zh_chars" | "en_words",
): string {
  const from = formatLengthCount(change.previousWordCount, countingMode);
  const to = formatLengthCount(change.wordCount, countingMode);
  return localize(language, {
    vi: `  Chương ${change.number} ${change.title}: ${from} → ${to}`,
    en: `  Chapter ${change.number} ${change.title}: ${from} → ${to}`,
  });
}

export function formatChapterSyncSummary(language: CliLanguage, changed: number, checked: number): string {
  return localize(language, {
    vi: `Đã đối chiếu ${checked} chương, sửa số từ trong index.json cho ${changed} chương.`,
    en: `Checked ${checked} chapter(s); corrected ${changed} index.json word count(s).`,
  });
}

export function formatChapterSyncMissingFiles(language: CliLanguage, numbers: ReadonlyArray<number>): string {
  return localize(language, {
    vi: `Cảnh báo: các chương ${numbers.join(", ")} có trong index.json nhưng không tìm thấy file chương tương ứng; đã bỏ qua.`,
    en: `Warning: chapter(s) ${numbers.join(", ")} exist in index.json but have no chapter file on disk; skipped.`,
  });
}

export function formatChapterDeleteConfirm(
  language: CliLanguage,
  params: { bookTitle: string; bookId: string; number: number; title: string },
): string {
  return localize(language, {
    vi: `Sẽ xóa chương mới nhất của "${params.bookTitle}" (${params.bookId}): chương ${params.number} ${params.title}. `
      + `File chương sẽ chuyển vào chapters/.trash/, chỉ mục và trạng thái truyện quay lại chương ${params.number - 1}. Xác nhận xóa? (y/N) `,
    en: `Delete the latest chapter of "${params.bookTitle}" (${params.bookId}): chapter ${params.number} ${params.title}? `
      + `The chapter file moves to chapters/.trash/ and the index and story state roll back to chapter ${params.number - 1}. (y/N) `,
  });
}

export function formatChapterDeleteCancelled(language: CliLanguage): string {
  return localize(language, {
    vi: "Đã hủy.",
    en: "Cancelled.",
  });
}

export function formatChapterDeleteDone(
  language: CliLanguage,
  params: { number: number; title: string; trashedFiles: ReadonlyArray<string>; rolledBackTo: number },
): string {
  const trashNote = params.trashedFiles.length > 0
    ? params.trashedFiles.join(", ")
    : localize(language, { vi: "(file chương không còn tồn tại, không di chuyển gì)", en: "(chapter file was already gone; nothing moved)" });
  return localize(language, {
    vi: `Đã xóa chương ${params.number} ${params.title}: file chương lưu tại ${trashNote}; chỉ mục và trạng thái truyện đã quay lại chương ${params.rolledBackTo}.`,
    en: `Deleted chapter ${params.number} ${params.title}: chapter file kept at ${trashNote}; index and story state rolled back to chapter ${params.rolledBackTo}.`,
  });
}

export function formatBookBackupCreated(language: CliLanguage, bookId: string, backupId: string): string {
  return localize(language, {
    vi: `Đã sao lưu ${bookId} → .castor/backups/${bookId}/${backupId}/`,
    en: `Backed up ${bookId} → .castor/backups/${bookId}/${backupId}/`,
  });
}

export function formatBookBackupListEmpty(language: CliLanguage, bookId: string): string {
  return localize(language, {
    vi: `${bookId} chưa có bản sao lưu nào. Tạo bằng: castor book backup ${bookId}`,
    en: `No backups for ${bookId} yet. Create one with: castor book backup ${bookId}`,
  });
}

export function formatBookRestoreDone(
  language: CliLanguage,
  params: { bookId: string; backupId: string; preRestoreBackupId: string | null },
): string {
  const preNote = params.preRestoreBackupId
    ? localize(language, {
        vi: `Trạng thái trước khi khôi phục đã được tự động sao lưu thành ${params.preRestoreBackupId}.`,
        en: `The pre-restore state was automatically backed up as ${params.preRestoreBackupId}.`,
      })
    : localize(language, {
        vi: "Thư mục sách khi đó chưa tồn tại nên không tạo bản sao lưu trước khôi phục.",
        en: "The book directory did not exist, so no pre-restore backup was created.",
      });
  return localize(language, {
    vi: `Đã khôi phục ${params.bookId} về bản sao lưu ${params.backupId}. ${preNote}`,
    en: `Restored ${params.bookId} to backup ${params.backupId}. ${preNote}`,
  });
}
