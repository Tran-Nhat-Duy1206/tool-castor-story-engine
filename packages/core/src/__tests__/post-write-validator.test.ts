import { describe, expect, it } from "vitest";
import {
  detectCrossChapterRepetition,
  detectDuplicateTitle,
  detectParagraphLengthDrift,
  detectParagraphShapeWarnings,
  normalizePostWriteSurface,
  resolveDuplicateTitle,
  validatePostWrite,
  type PostWriteViolation,
} from "../agents/post-write-validator.js";
import type { GenreProfile } from "../models/genre-profile.js";

const viProfile: GenreProfile = {
  id: "test", name: "Test", language: "vi", chapterTypes: [], fatigueWords: [], pacingRule: "",
  numericalSystem: false, powerScaling: false, eraResearch: false, auditDimensions: [], satisfactionTypes: [],
};

const findRule = (items: ReadonlyArray<PostWriteViolation>, rule: string) => items.find((item) => item.rule === rule);

describe("post-write validator", () => {
  it("strips canonical note lines and repairs doubled em-dash hybrids", () => {
    expect(normalizePostWriteSurface("Anh dừng lại——rồi quay đi.\n[writer-note] hidden", "vi"))
      .toBe("Anh dừng lại—rồi quay đi.");
  });

  it("does not recognize former Chinese compatibility note syntax", () => {
    expect(normalizePostWriteSurface("Nội dung\n[mock_text] giữ nguyên", "vi"))
      .toBe("Nội dung\n[mock_text] giữ nguyên");
  });

  it("uses canonical English machine-facing messages for Vietnamese", () => {
    const profile = { ...viProfile, fatigueWords: ["im lặng"] };
    const violations = validatePostWrite("Anh im lặng. Cô vẫn im lặng.", profile, null, "vi");
    const violation = findRule(violations, "fatigue-word");
    expect(violation?.description).toBe('The fatigue term "im lặng" appears 2 times (maximum 1 per chapter).');
  });

  it("detects Vietnamese chapter references without malformed mixed-language parsing", () => {
    const violations = validatePostWrite("Những việc ở Chương 12 vẫn chưa kết thúc.", viProfile, null, "vi");
    expect(findRule(violations, "chapter-number-reference")?.description).toContain('"Chương 12"');
    expect(validatePostWrite("Chương 12", viProfile, null, "vi")[0]?.description).not.toContain("mock_text");
  });

  it("uses Unicode-aware, word-based Vietnamese fatigue matching", () => {
    const profile = { ...viProfile, fatigueWords: ["ánh mắt"] };
    const violations = validatePostWrite("Ánh mắt cô đổi khác; ánh mắt ấy vẫn bình thản.", profile, null, "vi");
    expect(findRule(violations, "fatigue-word")).toBeDefined();
  });

  it("uses word counts for Vietnamese paragraph shape", () => {
    const content = ["Anh dừng lại.", "Cửa vẫn đóng.", "Mưa rơi đều.", "Không ai đáp.", "Cô quay đi."].join("\n\n");
    const violations = detectParagraphShapeWarnings(content, "vi");
    expect(findRule(violations, "paragraph-fragmentation")).toBeDefined();
    expect(findRule(violations, "consecutive-short-paragraphs")).toBeDefined();
  });

  it("detects word-based cross-chapter repetition in Vietnamese", () => {
    const phrase = "ánh đèn rung";
    const current = `${phrase} ngoài cửa, ${phrase} trên tường, gió thổi. tiếng mưa rơi, tiếng mưa rơi. cánh cửa khép, cánh cửa khép.`;
    const recent = `${phrase} ngoài hiên. tiếng mưa rơi suốt đêm. cánh cửa khép rất chậm. `.repeat(4);
    expect(findRule(detectCrossChapterRepetition(current, recent, "vi"), "cross-chapter-repetition")).toBeDefined();
  });

  it("keeps Unicode title comparison language-neutral", () => {
    expect(findRule(detectDuplicateTitle("Ánh đèn!", ["Ánh đèn"]), "near-duplicate-title")).toBeDefined();
    const resolved = resolveDuplicateTitle("Ánh đèn", ["Ánh đèn"], "vi", { content: "Bến cảng chìm trong sương muối." });
    expect(resolved.title).toContain(":");
    expect(resolved.title).not.toContain("（");
  });

  it("reports paragraph drift with canonical English fields", () => {
    const recent = Array(5).fill("Anh đặt chiếc túi xuống bàn rồi nhìn qua cửa sổ nơi cơn mưa phủ kín con đường vắng trước nhà.").join("\n\n");
    const current = ["Anh dừng.", "Cô đợi.", "Mưa rơi.", "Cửa đóng.", "Đèn tắt."].join("\n\n");
    expect(findRule(detectParagraphLengthDrift(current, recent, "vi"), "paragraph-density-drift")?.description)
      .toMatch(/^Average paragraph length dropped/);
  });

  it("supports English validation", () => {
    const content = "Mara found an intricate map. The intricate route was an intricate tapestry, and the intricate marks remained.";
    expect(findRule(validatePostWrite(content, viProfile, null, "en"), "ai-tell-word-density")).toBeDefined();
  });
});
