import { describe, expect, it } from "vitest";
import {
  formatImportCompletionLines,
  formatImportDiscoveryLine,
  formatImportResumeLine,
  formatWriteCompletionLines,
  formatWriteDoneLine,
  formatWriteStartLine,
} from "../progress-text.js";

describe("CLI progress text", () => {
  it("formats Vietnamese write progress lines", () => {
    expect(formatWriteStartLine("vi", 1, 3, "demo-book")).toBe('[1/3] Đang viết chương cho "demo-book"...');
    expect(formatWriteCompletionLines("vi", {
      chapterNumber: 7,
      title: "Triều Thanh Đêm Qua",
      wordCount: 2345,
      passedAudit: false,
      revised: true,
      status: "audit-failed",
      issues: [
        { severity: "warning", category: "continuity", description: "dòng thời gian hơi lệch" },
      ],
    })).toEqual([
      "  Chương 7: Triều Thanh Đêm Qua",
      "  Độ dài: 2345 words",
      "  Kiểm tra: CẦN XEM LẠI",
      "  Tự động chỉnh sửa: CÓ (đã sửa các lỗi nghiêm trọng)",
      "  Trạng thái: audit-failed",
      "  Vấn đề:",
      "    [warning] continuity: dòng thời gian hơi lệch",
      "",
    ]);
    expect(formatWriteDoneLine("vi")).toBe("Hoàn tất.");
  });

  it("formats English write progress lines", () => {
    expect(formatWriteStartLine("en", 2, 5, "demo-book")).toBe('[2/5] Writing chapter for "demo-book"...');
    expect(formatWriteCompletionLines("en", {
      chapterNumber: 7,
      title: "Harbor Wake",
      wordCount: 2310,
      passedAudit: true,
      revised: false,
      status: "ready-for-review",
      issues: [],
    })).toEqual([
      "  Chapter 7: Harbor Wake",
      "  Length: 2310 words",
      "  Audit: PASSED",
      "  Status: ready-for-review",
      "",
    ]);
    expect(formatWriteDoneLine("en")).toBe("Done.");
  });

  it("formats Vietnamese import progress lines", () => {
    expect(formatImportDiscoveryLine("vi", 12, "demo-book")).toBe('Tìm thấy 12 chương, chuẩn bị nhập vào "demo-book".');
    expect(formatImportResumeLine("vi", 8)).toBe("Tiếp tục nhập từ chương 8.");
    expect(formatImportCompletionLines("vi", {
      importedCount: 12,
      totalCountLabel: "24000字",
      nextChapter: 13,
      bookId: "demo-book",
    })).toEqual([
      "Nhập chương hoàn tất:",
      "  Đã nhập chương: 12",
      "  Tổng độ dài: 24000字",
      "  Số chương tiếp theo: 13",
      "",
      'Chạy "castor write next demo-book" để tiếp tục viết.',
    ]);
  });

  it("formats English import progress lines", () => {
    expect(formatImportDiscoveryLine("en", 12, "demo-book")).toBe('Found 12 chapters to import into "demo-book".');
    expect(formatImportResumeLine("en", 8)).toBe("Resuming from chapter 8.");
    expect(formatImportCompletionLines("en", {
      importedCount: 12,
      totalCountLabel: "24000 words",
      nextChapter: 13,
      bookId: "demo-book",
    })).toEqual([
      "Import complete:",
      "  Chapters imported: 12",
      "  Total length: 24000 words",
      "  Next chapter number: 13",
      '',
      'Run "castor write next demo-book" to continue writing.',
    ]);
  });
});
