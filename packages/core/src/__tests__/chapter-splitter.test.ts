import { describe, expect, it } from "vitest";
import { splitChapters } from "../utils/chapter-splitter.js";

describe("splitChapters", () => {
  it("splits Vietnamese chapter headings with Chương X by default", () => {
    const input = [
      "Chương 1: Yến tiệc vườn đào ba anh hùng kết nghĩa, chém tướng Khăn Vàng lập công đầu",
      "",
      "Sông Trường Giang cuồn cuộn chảy về đông, sóng vỗ tan hết anh hùng.",
      "",
      "Chương 2: Trương Phi giận đánh quan đốc, Hà Quốc Cữu mưu giết hoạn quan",
      "",
      "Lại nói Đổng Trác chuyên quyền, triều đình chấn động.",
    ].join("\n");

    const chapters = splitChapters(input);

    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toEqual({
      title: "Yến tiệc vườn đào ba anh hùng kết nghĩa, chém tướng Khăn Vàng lập công đầu",
      content: "Sông Trường Giang cuồn cuộn chảy về đông, sóng vỗ tan hết anh hùng.",
    });
    expect(chapters[1]).toEqual({
      title: "Trương Phi giận đánh quan đốc, Hà Quốc Cữu mưu giết hoạn quan",
      content: "Lại nói Đổng Trác chuyên quyền, triều đình chấn động.",
    });
  });

  it("uses a Chương N fallback title when a Vietnamese heading has no title text", () => {
    const input = [
      "Chương 1",
      "",
      "Thiên hạ đại thế, phân lâu ắt hợp, hợp lâu ắt phân.",
    ].join("\n");

    const chapters = splitChapters(input);

    expect(chapters).toHaveLength(1);
    expect(chapters[0]?.title).toBe("Chương 1");
  });

  it("splits Vietnamese headings with Arabic numerals", () => {
    const input = [
      "Chương 99: Khổng Minh mưa thu lui quân Ngụy",
      "",
      "Chưa biết Khổng Minh phá Ngụy thế nào, xem hồi sau phân giải.",
      "",
      "Chương 100: Quân Hán cướp trại phá Tào Chân, Vũ Hầu đấu trận nhục Trọng Đạt",
      "",
      "Lại nói các tướng nghe Khổng Minh không đuổi quân Ngụy, đều vào trướng bẩm rằng.",
    ].join("\n");

    const chapters = splitChapters(input);

    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toEqual({
      title: "Khổng Minh mưa thu lui quân Ngụy",
      content: "Chưa biết Khổng Minh phá Ngụy thế nào, xem hồi sau phân giải.",
    });
    expect(chapters[1]).toEqual({
      title: "Quân Hán cướp trại phá Tào Chân, Vũ Hầu đấu trận nhục Trọng Đạt",
      content: "Lại nói các tướng nghe Khổng Minh không đuổi quân Ngụy, đều vào trướng bẩm rằng.",
    });
  });

  it("splits English chapter headings with the default pattern", () => {
    const input = [
      "Chapter 1: Prelude",
      "",
      "The harbor bells rang before dawn.",
      "",
      "Chapter 2: Into the Fog",
      "",
      "Mara followed the last lantern into the mist.",
    ].join("\n");

    const chapters = splitChapters(input);

    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toEqual({
      title: "Prelude",
      content: "The harbor bells rang before dawn.",
    });
    expect(chapters[1]).toEqual({
      title: "Into the Fog",
      content: "Mara followed the last lantern into the mist.",
    });
  });

  it("uses an English fallback title when the chapter heading has no title text", () => {
    const input = [
      "Chapter 1",
      "",
      "The harbor bells rang before dawn.",
    ].join("\n");

    const chapters = splitChapters(input);

    expect(chapters).toHaveLength(1);
    expect(chapters[0]?.title).toBe("Chapter 1");
  });

  it("splits Roman numeral English chapter headings with the default pattern", () => {
    const input = [
      "CHAPTER I.",
      "",
      "The harbor bells rang before dawn.",
      "",
      "CHAPTER II.",
      "",
      "Mara followed the last lantern into the mist.",
    ].join("\n");

    const chapters = splitChapters(input);

    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toEqual({
      title: "Chapter 1",
      content: "The harbor bells rang before dawn.",
    });
    expect(chapters[1]).toEqual({
      title: "Chapter 2",
      content: "Mara followed the last lantern into the mist.",
    });
  });

  it("keeps English fallback titles when a custom regex matches Roman numeral headings", () => {
    const input = [
      "CHAPTER I.",
      "",
      "The harbor bells rang before dawn.",
    ].join("\n");

    const chapters = splitChapters(input, "^CHAPTER\\s+[IVXLCDM]+\\.$");

    expect(chapters).toHaveLength(1);
    expect(chapters[0]?.title).toBe("Chapter 1");
  });

  it("strips a Project Gutenberg trailer from the final chapter content", () => {
    const input = [
      "Chapter 1: Finale",
      "",
      "The harbor bells rang once and went silent.",
      "",
      "Project Gutenberg™ depends upon and cannot survive without widespread",
      "public support and donations to carry out its mission.",
    ].join("\n");

    const chapters = splitChapters(input);

    expect(chapters).toHaveLength(1);
    expect(chapters[0]?.content).toBe("The harbor bells rang once and went silent.");
    expect(chapters[0]?.content).not.toContain("Project Gutenberg");
  });
});
