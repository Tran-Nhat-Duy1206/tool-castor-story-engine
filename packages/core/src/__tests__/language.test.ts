import { describe, it, expect } from "vitest";
import { inferLanguage } from "../utils/language.js";

describe("inferLanguage", () => {
  it("infers en for Latin-dominant briefs", () => {
    expect(inferLanguage("A detective investigates a murder in 1920s London.")).toBe("en");
  });

  it("infers zh for Chinese briefs", () => {
    expect(inferLanguage("一个修仙者重生回到宗门入门那年。")).toBe("vi");
  });

  it("stays zh when CJK dominates despite an English name", () => {
    expect(inferLanguage("主角叫 Jack，一部都市重生爽文。")).toBe("vi");
  });

  it("treats incidental CJK in an English brief as en", () => {
    expect(inferLanguage("A xianxia (修仙) progression story for Royal Road.")).toBe("en");
  });

  it("defaults to zh for empty or missing input", () => {
    expect(inferLanguage("")).toBe("vi");
    expect(inferLanguage(undefined)).toBe("vi");
    expect(inferLanguage(null)).toBe("vi");
  });
});
