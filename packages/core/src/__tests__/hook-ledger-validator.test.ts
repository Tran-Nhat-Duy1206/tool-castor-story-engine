import { describe, it, expect } from "vitest";
import {
  parseHookLedger,
  validateHookLedger,
} from "../utils/hook-ledger-validator.js";

const ZH_MEMO = `## Nhiệm vụ hiện tại
mock_textPhong so sachmock_text。

## Sổ hook chương này
open:
- [new] mock_text || mock_text：mock_text

advance:
- H007 "mock_text" → planted → pressured
- H012 "mock_text" → pressured → near_payoff

resolve:
- H003 "mock_text" → mock_text

defer:
- H009 "mock_text" → mock_text

## Không làm
- mock_text`;

const EN_MEMO = `## Current task
Lin Qiu lifts the ledger from the Old Port accounting hall.

## Hook ledger for this chapter
open:
- [new] Old Port tail || reason: save for later arc

advance:
- H007 "Huzi's IOU" → planted → pressured

resolve:
- H003 "errand badge" → Lin Qiu unpins it himself

defer:
- H009 "Shou-Zhuo Jue origin" → timing not right

## Do not
- Do not reveal the mother's name`;

describe("parseHookLedger", () => {
  it("extracts all four sub-lists from a zh memo", () => {
    const ledger = parseHookLedger(ZH_MEMO);
    expect(ledger.advance.map((e) => e.id)).toEqual(["H007", "H012"]);
    expect(ledger.resolve.map((e) => e.id)).toEqual(["H003"]);
    expect(ledger.defer.map((e) => e.id)).toEqual(["H009"]);
    // open uses [new] so no hook_id is extracted
    expect(ledger.open).toEqual([]);
  });

  it("captures descriptor + keywords for each entry", () => {
    const ledger = parseHookLedger(ZH_MEMO);
    const h007 = ledger.advance[0]!;
    expect(h007.id).toBe("H007");
    expect(h007.descriptor).toContain("mock_text");
    expect(h007.keywords).toContain("mock_text");
    expect(h007.keywords).toContain("mock_text");

    const h003 = ledger.resolve[0]!;
    expect(h003.keywords).toContain("mock_text");
    expect(h003.keywords).toContain("mock_text");
  });

  it("extracts all four sub-lists from an en memo", () => {
    const ledger = parseHookLedger(EN_MEMO);
    expect(ledger.advance.map((e) => e.id)).toEqual(["H007"]);
    expect(ledger.resolve.map((e) => e.id)).toEqual(["H003"]);
    expect(ledger.defer.map((e) => e.id)).toEqual(["H009"]);
  });

  it("returns empty lists when no ledger section is present", () => {
    const ledger = parseHookLedger("## Nhiệm vụ hiện tại\nmock_text\n\n## Không làm\n- mock_text");
    expect(ledger).toEqual({ open: [], advance: [], resolve: [], defer: [], newOpenCount: 0 });
  });

  it("counts [new] placeholder lines under open as new hooks opened", () => {
    const memo = `## Sổ hook chương này
open:
- [new] mock_text || mock_text
- [new] Chương mock_text || mock_text
advance:
- H001 "x" → y
`;
    const ledger = parseHookLedger(memo);
    expect(ledger.open).toEqual([]); // [new] lines have no id → not in .open
    expect(ledger.newOpenCount).toBe(2);
  });

  it("stops at the next H2 heading and does not pollute across sections", () => {
    const memo = `## Sổ hook chương này
advance:
- H007 "xxx" → ...

## Không làm
- H999 looks-like-a-hook-but-its-under-do-not`;
    const ledger = parseHookLedger(memo);
    expect(ledger.advance.map((e) => e.id)).toEqual(["H007"]);
    expect(ledger.defer).toEqual([]);
  });

  it("ignores placeholder tokens like mock_text / none / n/a under empty slots", () => {
    const memo = `## Sổ hook chương này
advance:
- mock_text
- none
- H007 "mock_text" → planted
resolve:
- Chua co
defer:
- n/a
`;
    const ledger = parseHookLedger(memo);
    expect(ledger.advance.map((e) => e.id)).toEqual(["H007"]);
    expect(ledger.resolve).toEqual([]);
    expect(ledger.defer).toEqual([]);
  });
});

describe("validateHookLedger", () => {
  it("passes when draft echoes keyword from each committed ledger entry", () => {
    // Draft mentions mock_text/mock_text (→H007), mock_text or mock_text (→H012), mock_text or mock_text (→H003).
    const draft =
      "mock_textPhong so sachmock_text，mock_text。mock_text。";
    const violations = validateHookLedger(ZH_MEMO, draft);
    expect(violations).toEqual([]);
  });

  it("flags a warning for each un-echoed advance/resolve entry", () => {
    // Only mock_text (H007) present; mock_text/mock_text (H012) and mock_text/mock_text (H003) missing.
    const draft = "mock_text，mock_text。";
    const violations = validateHookLedger(ZH_MEMO, draft);
    expect(violations).toHaveLength(2);
    expect(violations.every((v) => v.severity === "warning")).toBe(true);
    expect(violations.map((v) => v.description).join(" ")).toContain("H012");
    expect(violations.map((v) => v.description).join(" ")).toContain("H003");
  });

  it("does not turn semantic near-misses into critical failures", () => {
    const memo = `## Sổ hook chương này
advance:
- H002 "mock_text" → mock_text từ342
`;
    const draft = "mock_text，mock_text từmock_text：342。mock_text。";
    const violations = validateHookLedger(memo, draft);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.severity).toBe("warning");
    expect(violations[0]!.category).toContain("mock_text");
  });

  it("does NOT flag hooks that are only under defer", () => {
    // H009 is deferred — keyword mock_text absence is fine.
    const draft = "mock_text，mock_text。";
    const violations = validateHookLedger(ZH_MEMO, draft);
    expect(violations).toEqual([]);
  });

  it("does NOT flag [new] open entries (they have no pre-existing id)", () => {
    const memo = `## Sổ hook chương này
open:
- [new] mock_text || mock_text
advance:
- H001 "Testmock_text" → x
`;
    const draft = "mock_textTestmock_text。";
    const violations = validateHookLedger(memo, draft);
    expect(violations).toEqual([]);
  });

  it("returns empty array when memo has no ledger section at all", () => {
    const violations = validateHookLedger("## mock_text\nmock_text", "draft");
    expect(violations).toEqual([]);
  });

  it("falls back to strict ID match when ledger line has no descriptor", () => {
    const memo = `## Sổ hook chương này
advance:
- H1
`;
    // Draft contains H12 — must NOT accidentally satisfy H1 commitment.
    const draft = "mock_text H12 mock_text H123。";
    const violations = validateHookLedger(memo, draft);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.severity).toBe("warning");
    expect(violations[0]!.description).toContain("H1");
  });

  it("accepts english keyword match for en memos", () => {
    const draft =
      "Lin Qiu finds Huzi's IOU folded inside the ledger and tucks it away. Later he unpins the errand badge before slipping out.";
    const violations = validateHookLedger(EN_MEMO, draft);
    expect(violations).toEqual([]);
  });

  it("flags mock_text 1 mock_text 1 violation when a chapter resolves hooks without opening any", () => {
    const memo = `## Sổ hook chương này
advance:
- H007 "mock_text" → planted
resolve:
- H003 "mock_text" → mock_text
`;
    const draft = "mock_text，mock_text。";
    const violations = validateHookLedger(memo, draft);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.category).toContain("mock_text 1 mock_text 1");
  });

  it("accepts mock_text 1 mock_text 1 floor when a [new] line balances the resolved hook", () => {
    const memo = `## Sổ hook chương này
open:
- [new] mock_text || mock_text：mock_text
advance:
- H007 "mock_text" → planted
resolve:
- H003 "mock_text" → mock_text
`;
    const draft = "mock_text，mock_text。";
    const violations = validateHookLedger(memo, draft);
    expect(violations).toEqual([]);
  });

  it("does not let placeholder mock_text raise a false critical", () => {
    const memo = `## Sổ hook chương này
open:
- [new] mock_text || mock_text
advance:
- mock_text
resolve:
- H005 "mock_text" → ok
`;
    const draft = "mock_text。";
    const violations = validateHookLedger(memo, draft);
    expect(violations).toEqual([]);
  });

  it("accepts middle keywords from a longer Chinese hook name", () => {
    const memo = `## Sổ hook chương này
advance:
- H007 "mock_text" → evoked → pressured
`;
    const draft = "mock_text，mock_text，mock_text。";
    const violations = validateHookLedger(memo, draft);
    expect(violations).toEqual([]);
  });
});
