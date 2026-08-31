import { describe, it, expect } from "vitest";
import { inferLanguage } from "../utils/language.js";

describe("inferLanguage", () => {
  it("infers en for Latin-dominant briefs", () => {
    expect(inferLanguage("A detective investigates a murder in 1920s London.")).toBe("en");
  });

  it("infers zh for Chinese briefs", () => {
    expect(inferLanguage("mock_text。")).toBe("vi");
  });

  it("stays vi when Vietnamese diacritics dominate despite an English name", () => {
    expect(inferLanguage("Nhân vật chính tên Jack, một bộ đô thị trùng sinh sảng văn.")).toBe("vi");
  });

  it("treats incidental CJK in an English brief as en", () => {
    expect(inferLanguage("A xianxia (mock_text) progression story for Royal Road.")).toBe("en");
  });

  it("defaults to zh for empty or missing input", () => {
    expect(inferLanguage("")).toBe("vi");
    expect(inferLanguage(undefined)).toBe("vi");
    expect(inferLanguage(null)).toBe("vi");
  });
});
