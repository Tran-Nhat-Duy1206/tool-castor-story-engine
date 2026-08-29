import { describe, expect, it } from "vitest";
import {
  formatAutoWriteAlreadyComplete,
  formatAutoWriteStart,
  formatBookCreateCreating,
  formatBookCreateCreated,
  formatBookCreateNextStep,
  formatDoctorHintBaseUrl,
  formatDoctorHintInvalidApiKey,
  formatDoctorHintModelName,
  formatDoctorHintOpenAiProbeExhausted,
  formatDoctorHintQuota,
  formatDoctorHintStreamRequirement,
  formatFanficCanonMissingError,
  formatFanficInvalidModeError,
  formatFanficSourceDirEmptyError,
  formatFanficSourceTooShortError,
  formatImportCanonComplete,
  formatImportCanonStart,
  formatImportChaptersComplete,
  formatImportChaptersDiscovery,
  formatImportChaptersResume,
  formatListModelsEmpty,
  formatListModelsHeader,
  formatWriteNextComplete,
  formatWriteNextProgress,
  formatWriteNextResultLines,
  resolveCliLanguage,
} from "../localization.js";

const CHINESE_CHARS = /[一-鿿]/;

describe("CLI localization", () => {
  it("formats book-create summaries in both languages", () => {
    expect(formatBookCreateCreating("vi", "Sông Ngân", "xuanhuan", "tomato"))
      .toBe('Đang tạo sách "Sông Ngân" (xuanhuan / tomato)...');
    expect(formatBookCreateCreated("vi", "song-ngan")).toBe("Đã tạo sách: song-ngan");
    expect(formatBookCreateNextStep("vi", "song-ngan")).toBe("Bước tiếp theo: castor write next song-ngan");

    expect(formatBookCreateCreating("en", "Harbor", "other", "other"))
      .toBe('Creating book "Harbor" (other / other)...');
    expect(formatBookCreateCreated("en", "harbor")).toBe("Book created: harbor");
    expect(formatBookCreateNextStep("en", "harbor")).toBe("Next: castor write next harbor");
  });

  it("formats write-next progress and result summaries in both languages", () => {
    expect(formatWriteNextProgress("vi", 1, 2, "song-ngan"))
      .toBe('[1/2] Đang viết chương cho "song-ngan"...');
    expect(formatWriteNextComplete("vi")).toBe("Hoàn tất.");
    expect(formatWriteNextResultLines("vi", {
      chapterNumber: 3,
      title: "Đêm Gió Mưa",
      wordCount: 3200,
      status: "ready-for-review",
      revised: true,
      issues: [],
      auditPassed: true,
    })).toEqual([
      "  Chương 3: Đêm Gió Mưa",
      "  Độ dài: 3200 words",
      "  Kiểm tra: ĐẠT",
      "  Tự động chỉnh sửa: CÓ (đã sửa các lỗi nghiêm trọng)",
      "  Trạng thái: ready-for-review",
    ]);

    expect(formatWriteNextProgress("en", 2, 3, "harbor"))
      .toBe('[2/3] Writing chapter for "harbor"...');
    expect(formatWriteNextComplete("en")).toBe("Done.");
    expect(formatWriteNextResultLines("en", {
      chapterNumber: 4,
      title: "Cold Harbor",
      wordCount: 2200,
      status: "audit-failed",
      revised: false,
      issues: [{ severity: "critical", category: "continuity", description: "Mismatch" }],
      auditPassed: false,
    })).toEqual([
      "  Chapter 4: Cold Harbor",
      "  Length: 2200 words",
      "  Audit: NEEDS REVIEW",
      "  Status: audit-failed",
      "  Issues:",
      "    [critical] continuity: Mismatch",
    ]);
  });

  it("formats auto-write banners in both languages", () => {
    expect(formatAutoWriteStart("vi", "song-ngan", 3, 10))
      .toBe('Tự động viết "song-ngan": từ chương 3 đến chương 10...');
    expect(formatAutoWriteAlreadyComplete("vi", "song-ngan", 12, 10))
      .toBe('"song-ngan" đã viết 12 chương (mục tiêu chương 10), không cần tiếp tục.');

    expect(formatAutoWriteStart("en", "harbor", 3, 10))
      .toBe('Auto-writing "harbor": chapter 3 through chapter 10...');
    expect(formatAutoWriteAlreadyComplete("en", "harbor", 12, 10))
      .toBe('"harbor" already has 12 chapter(s) written (target: chapter 10). Nothing to do.');
  });

  it("formats import summaries with language-specific units and action hints", () => {
    expect(formatImportChaptersDiscovery("vi", 12, "song-ngan"))
      .toBe('Tìm thấy 12 chương, chuẩn bị nhập vào "song-ngan".');
    expect(formatImportChaptersResume("vi", 5)).toBe("Tiếp tục nhập từ chương 5.");
    expect(formatImportChaptersComplete("vi", {
      importedCount: 8,
      totalWords: 45678,
      nextChapter: 13,
      continueBookId: "song-ngan",
    })).toEqual([
      "Nhập hoàn tất:",
      "  Số chương đã nhập: 8",
      "  Tổng độ dài: 45678 words",
      "  Số chương kế tiếp: 13",
      "",
      'Chạy "castor write next song-ngan" để tiếp tục viết.',
    ]);

    expect(formatImportChaptersDiscovery("en", 10, "harbor"))
      .toBe('Found 10 chapters to import into "harbor".');
    expect(formatImportChaptersResume("en", 6)).toBe("Resuming from chapter 6.");
    expect(formatImportChaptersComplete("en", {
      importedCount: 10,
      totalWords: 18342,
      nextChapter: 11,
      continueBookId: "harbor",
    })).toEqual([
      "Import complete:",
      "  Chapters imported: 10",
      "  Total length: 18342 words",
      "  Next chapter number: 11",
      "",
      'Run "castor write next harbor" to continue writing.',
    ]);
  });

  it("formats import-canon prompts in both languages", () => {
    expect(formatImportCanonStart("vi", "parent-book", "target-book"))
      .toBe('Đang nhập chính thống từ "parent-book" vào "target-book"...');
    expect(formatImportCanonComplete("vi")).toEqual([
      "Đã nhập chính thống: story/parent_canon.md",
      "Writer và auditor sẽ tự động nhận diện file này ở chế độ ngoại truyện.",
    ]);

    expect(formatImportCanonStart("en", "parent-book", "target-book"))
      .toBe('Importing canon from "parent-book" into "target-book"...');
    expect(formatImportCanonComplete("en")).toEqual([
      "Canon imported: story/parent_canon.md",
      "Writer and auditor will auto-detect this file for spinoff mode.",
    ]);
  });
});

describe("resolveCliLanguage environment fallback", () => {
  it("prefers the explicit language over any environment variable", () => {
    expect(resolveCliLanguage("en", { CASTOR_LOCALE: "vi" })).toBe("en");
    expect(resolveCliLanguage("vi", { CASTOR_LOCALE: "en", LANG: "en_US.UTF-8" })).toBe("vi");
  });

  it("reads CASTOR_LOCALE before the system locale variables", () => {
    expect(resolveCliLanguage(undefined, { CASTOR_LOCALE: "en", LANG: "vi_VN.UTF-8" })).toBe("en");
    expect(resolveCliLanguage(undefined, { CASTOR_LOCALE: "vi", LC_ALL: "en_US.UTF-8" })).toBe("vi");
  });

  it("falls back to LC_ALL, then LC_MESSAGES, then LANG", () => {
    expect(resolveCliLanguage(undefined, { LC_ALL: "en_US.UTF-8" })).toBe("en");
    expect(resolveCliLanguage(undefined, { LC_MESSAGES: "en_GB.UTF-8" })).toBe("en");
    expect(resolveCliLanguage(undefined, { LANG: "en_US.UTF-8" })).toBe("en");
  });

  it("lets an unrecognized explicit language fall through to the environment", () => {
    expect(resolveCliLanguage("fr", { LANG: "en_US.UTF-8" })).toBe("en");
  });

  it("falls back to the Vietnamese default for unset, unrecognized, or legacy zh locales", () => {
    expect(resolveCliLanguage(undefined, {})).toBe("vi");
    expect(resolveCliLanguage(undefined, { LANG: "C" })).toBe("vi");
    expect(resolveCliLanguage("fr", {})).toBe("vi");
    expect(resolveCliLanguage(undefined, { LANG: "zh_CN.UTF-8" })).toBe("vi");
    expect(resolveCliLanguage(undefined, { CASTOR_LOCALE: "zh-CN", LC_ALL: "en_US.UTF-8" })).toBe("en");
    expect(resolveCliLanguage(undefined, { CASTOR_LOCALE: "zh" })).toBe("vi");
  });
});

describe("config list-models localization", () => {
  it("formats the empty-result error in both languages", () => {
    expect(formatListModelsEmpty("vi", "deepseek"))
      .toBe("deepseek không có model khả dụng (có thể cần --api-key và --base-url)");
    expect(formatListModelsEmpty("en", "deepseek"))
      .toBe("No models available for deepseek (you may need --api-key and --base-url)");
  });

  it("formats the model-count header in both languages", () => {
    expect(formatListModelsHeader("vi", "deepseek", 3)).toBe("deepseek: 3 model");
    expect(formatListModelsHeader("en", "deepseek", 3)).toBe("deepseek: 3 model(s)");
  });
});

describe("doctor hint localization", () => {
  it("emits Vietnamese hints for vi", () => {
    expect(formatDoctorHintQuota("vi"))
      .toBe("Kiểm tra API Key có đúng không, model có khả dụng không, và tài khoản còn đủ số dư hoặc hạn mức không.");
    expect(formatDoctorHintBaseUrl("vi")).toContain("CASTOR_LLM_BASE_URL");
    expect(formatDoctorHintStreamRequirement("vi")).toContain("stream");
    expect(formatDoctorHintModelName("vi")).toContain("CASTOR_LLM_MODEL");
    expect(formatDoctorHintInvalidApiKey("vi")).toContain("CASTOR_LLM_API_KEY");
    expect(formatDoctorHintOpenAiProbeExhausted("vi")).toContain("chat/responses");
    for (const hint of [
      formatDoctorHintQuota("vi"),
      formatDoctorHintOpenAiProbeExhausted("vi"),
      formatDoctorHintBaseUrl("vi"),
      formatDoctorHintStreamRequirement("vi"),
      formatDoctorHintModelName("vi"),
      formatDoctorHintInvalidApiKey("vi"),
    ]) {
      expect(hint).not.toMatch(CHINESE_CHARS);
    }
  });

  it("emits pure English hints for en", () => {
    const hints = [
      formatDoctorHintQuota("en"),
      formatDoctorHintOpenAiProbeExhausted("en"),
      formatDoctorHintBaseUrl("en"),
      formatDoctorHintStreamRequirement("en"),
      formatDoctorHintModelName("en"),
      formatDoctorHintInvalidApiKey("en"),
    ];
    for (const hint of hints) {
      expect(hint).not.toMatch(CHINESE_CHARS);
    }
    expect(formatDoctorHintBaseUrl("en")).toContain("CASTOR_LLM_BASE_URL");
    expect(formatDoctorHintModelName("en")).toContain("CASTOR_LLM_MODEL");
    expect(formatDoctorHintInvalidApiKey("en")).toContain("CASTOR_LLM_API_KEY");
    expect(formatDoctorHintStreamRequirement("en")).toContain("stream=true");
  });
});

describe("fanfic error localization", () => {
  it("builds bilingual error messages", () => {
    const invalidMode = formatFanficInvalidModeError("xx");
    expect(invalidMode).toContain('Invalid fanfic mode: "xx"');
    expect(invalidMode).toContain("Chế độ fanfic không hợp lệ");

    const tooShort = formatFanficSourceTooShortError(42);
    expect(tooShort).toContain("Source material too short (42 chars)");
    expect(tooShort).toContain("Nguyên liệu quá ngắn");

    const missingCanon = formatFanficCanonMissingError();
    expect(missingCanon).toContain("castor fanfic init");
    expect(missingCanon).toContain("chính thống fanfic");

    const emptyDir = formatFanficSourceDirEmptyError("/tmp/source");
    expect(emptyDir).toContain("No .txt or .md files found in /tmp/source");
    expect(emptyDir).toContain("Không có file .txt hoặc .md nào trong thư mục /tmp/source");
  });
});
