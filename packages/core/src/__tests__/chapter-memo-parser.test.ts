import { describe, it, expect } from "vitest";
import { parseMemo, PlannerParseError } from "../utils/chapter-memo-parser.js";

const SECTIONS = `
## Cảnh và ngân sách độ dài
- mock_text（mock_text 900  từ）：mock_text，mock_text。
- mock_text（mock_text 700  từ）：mock_text，mock_text。

## Nhiệm vụ hiện tại
mock_text，mock_text，mock_text"mock_text"mock_text。

## Độc giả đang chờ đợi điều gì lúc này
1) mock_text
2) mock_text——mock_text

## Cần thực hiện / tạm giữ lại
- mock_text：mock_text → mock_text
- mock_text：mock_text → mock_textChương 20

## Nhịp chậm / chuyển cảnh đảm nhận điều gì
mock_text - mock_text，mock_text。

## Kiểm tra ba câu hỏi cho lựa chọn then chốt
- mock_text：
  - mock_text？mock_text
  - mock_text？mock_text
  - mock_text？mock_text
- mock_text/mock_text：
  - mock_text？mock_text
  - mock_text？mock_text
  - mock_text？mock_text

## Thay đổi bắt buộc cuối chương
- mock_text：mock_text
- mock_text：mock_text

## Sổ hook chương này
advance:
- H03 "mock_text" → mock_text pressured → near_payoff（mock_text）
resolve:
- S004 "mock_text" → mock_text
defer:
- H07 "mock_text" → mock_textChương 20，mock_text

## Không làm
- mock_text
- mock_text
`.trim();

function makeRaw(
  opts: {
    goal?: string;
    threadRefs?: ReadonlyArray<string> | null | unknown;
    body?: string;
    prefix?: string;
    fenced?: boolean;
  } = {},
): string {
  const refs = Array.isArray(opts.threadRefs)
    ? opts.threadRefs.map((id) => `- ${id}`).join("\n")
    : "";
  const raw = [
    `# Chương 12 memo`,
    "",
    "## Mục tiêu chương",
    opts.goal ?? "mock_text",
    "",
    "## mock_text",
    refs || "mock_text",
    "",
    opts.body ?? SECTIONS,
  ].join("\n");
  const withPrefix = `${opts.prefix ?? ""}${raw}`;
  return opts.fenced ? `\`\`\`markdown\n${withPrefix}\n\`\`\`` : withPrefix;
}

describe("parseMemo", () => {
  it("parses a valid markdown memo without YAML frontmatter", () => {
    const memo = parseMemo(makeRaw({ threadRefs: ["H03", "S004"] }), 12, false);
    expect(memo.chapter).toBe(12);
    expect(memo.goal).toBe("mock_text");
    expect(memo.isGoldenOpening).toBe(false);
    expect(memo.threadRefs).toEqual(["H03", "S004"]);
    expect(memo.body).toContain("## Nhiệm vụ hiện tại");
    expect(memo.body).toContain("## Không làm");
  });

  it("accepts markdown wrapped in a code fence with leading prose", () => {
    const memo = parseMemo(makeRaw({
      prefix: "mock_text，mock_text memo：\n\n",
      fenced: true,
      threadRefs: ["H03"],
    }), 12, true);
    expect(memo.chapter).toBe(12);
    expect(memo.isGoldenOpening).toBe(true);
    expect(memo.threadRefs).toEqual(["H03"]);
  });

  it("keeps long goal semantics in the memo body while deriving a short display goal", () => {
    const longGoal = "mock_text".repeat(10);
    const memo = parseMemo(makeRaw({ goal: longGoal }), 12, false);
    expect(memo.goal.length).toBeLessThanOrEqual(50);
    expect(memo.body).toContain(longGoal);
  });

  it.each([
    "## mock_text",
    "## Cảnh và ngân sách độ dài",
    "## Nhiệm vụ hiện tại",
    "## Độc giả đang chờ đợi điều gì lúc này",
    "## Cần thực hiện / tạm giữ lại",
    "## Nhịp chậm / chuyển cảnh đảm nhận điều gì",
    "## Kiểm tra ba câu hỏi cho lựa chọn then chốt",
    "## Thay đổi bắt buộc cuối chương",
    "## Sổ hook chương này",
    "## Không làm",
  ])("throws when body is missing section %s", (heading) => {
    const raw = makeRaw().replace(heading, "## SECTION-REMOVED");
    expect(() => parseMemo(raw, 12, false)).toThrow(/missing sections|goal/);
  });

  it("silently coerces non-array threadRefs to empty array", () => {
    const raw = makeRaw({ threadRefs: null });
    const memo = parseMemo(raw, 12, false);
    expect(memo.threadRefs).toEqual([]);
  });

  it("uses caller-provided chapter and isGoldenOpening", () => {
    const memo = parseMemo(makeRaw(), 99, true);
    expect(memo.chapter).toBe(99);
    expect(memo.isGoldenOpening).toBe(true);
  });

  // Phase hotfix 7: empty / blank section payloads must be rejected.
  describe("empty section detection", () => {
    it("rejects a memo where every heading is present but payloads are blank", () => {
      const blankBody = [
        "## Cảnh và ngân sách độ dài",
        "",
        "## Nhiệm vụ hiện tại",
        "",
        "## Độc giả đang chờ đợi điều gì lúc này",
        "",
        "## Cần thực hiện / tạm giữ lại",
        "",
        "## Nhịp chậm / chuyển cảnh đảm nhận điều gì",
        "",
        "## Kiểm tra ba câu hỏi cho lựa chọn then chốt",
        "",
        "## Thay đổi bắt buộc cuối chương",
        "",
        "## Sổ hook chương này",
        "",
        "## Không làm",
        "",
      ].join("\n");
      expect(() => parseMemo(makeRaw({ body: blankBody }), 12, false))
        .toThrow(/empty sections/);
    });

    it("rejects a memo where one section has only whitespace / placeholder", () => {
      const body = SECTIONS.replace(
        /## Nhiệm vụ hiện tại\n[\s\S]*?\n\n## Độc giả đang chờ đợi điều gì lúc này/,
        "## Nhiệm vụ hiện tại\n   \n\n## Độc giả đang chờ đợi điều gì lúc này",
      );
      expect(() => parseMemo(makeRaw({ body }), 12, false))
        .toThrow(/empty sections.*Nhiệm vụ hiện tại/);
    });

    it("rejects a memo where one section has 'TODO' (under 20 chars)", () => {
      const body = SECTIONS.replace(
        /## Thay đổi bắt buộc cuối chương\n[\s\S]*?\n\n## Sổ hook chương này/,
        "## Thay đổi bắt buộc cuối chương\nTODO\n\n## Sổ hook chương này",
      );
      expect(() => parseMemo(makeRaw({ body }), 12, false))
        .toThrow(/empty sections.*Thay đổi bắt buộc cuối chương/);
    });

    it("accepts a sparse-but-non-empty memo (Phase 6 sparse-memo principle)", () => {
      // Each section just barely meets the threshold — this is the
      // breath/transition chapter case the principle wants to keep legal.
      const sparseBody = [
        "## Cảnh và ngân sách độ dài",
        "mock_text từ，mock_text；mock_text từ，mock_text。",
        "",
        "## Nhiệm vụ hiện tại",
        "mock_text，mock_text。",
        "",
        "## Độc giả đang chờ đợi điều gì lúc này",
        "mock_text。mock_text。",
        "",
        "## Cần thực hiện / tạm giữ lại",
        "mock_text：mock_text；mock_text：mock_text，mock_textChương 20。",
        "",
        "## Nhịp chậm / chuyển cảnh đảm nhận điều gì",
        "mock_text，mock_text。",
        "",
        "## Kiểm tra ba câu hỏi cho lựa chọn then chốt",
        "mock_text，mock_text；mock_text。",
        "",
        "## Thay đổi bắt buộc cuối chương",
        "mock_text：mock_text。",
        "",
        "## Sổ hook chương này",
        "advance: H03 mock_text → mock_text planted mock_text pressured（mock_textChương mock_text）。",
        "",
        "## Không làm",
        "mock_text",
      ].join("\n");

      const memo = parseMemo(makeRaw({ body: sparseBody }), 12, false);
      expect(memo.body).toContain("## Nhiệm vụ hiện tại");
      expect(memo.body).toContain("## Không làm");
    });

    it('accepts "## Không làm" with very short content like "mock_text" / "N/A" (relaxed threshold)', () => {
      // The "do not" section uses a 5-char minimum so books with no extra
      // chapter-level prohibitions can say so without inventing filler.
      const body = SECTIONS.replace(
        /## Không làm\n[\s\S]*$/,
        "## Không làm\nmock_text。",
      );
      const memo = parseMemo(makeRaw({ body }), 12, false);
      expect(memo.body).toContain("mock_text。");
    });

    it("rejects empty '## Không làm' even with the relaxed threshold", () => {
      const body = SECTIONS.replace(
        /## Không làm\n[\s\S]*$/,
        "## Không làm\n",
      );
      expect(() => parseMemo(makeRaw({ body }), 12, false))
        .toThrow(/empty sections.*Không làm/);
    });
  });
});
