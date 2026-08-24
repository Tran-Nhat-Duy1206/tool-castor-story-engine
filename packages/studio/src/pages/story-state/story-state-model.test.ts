import { describe, expect, it } from "vitest";
import type { CurrentStateFactDto, HookRecordDto, StoryCanonViewDto } from "../../lib/canon-api";
import {
  additionalFactRows,
  formatValidityInterval,
  hookRows,
  manifestSummary,
  resolveCanonRequestUrl,
  slotRows,
} from "./story-state-model";

const fact = (overrides: Partial<CurrentStateFactDto> = {}): CurrentStateFactDto => ({
  subject: "主角",
  predicate: "当前位置",
  object: "东城公寓",
  validFromChapter: 11,
  validUntilChapter: null,
  sourceChapter: 11,
  ...overrides,
});

describe("resolveCanonRequestUrl", () => {
  it("resolves a fetchable url for valid book ids", () => {
    expect(resolveCanonRequestUrl("demo-canon-book")).toEqual({ url: "/api/v1/books/demo-canon-book/canon" });
  });

  it("returns an error result instead of throwing, so callers keep stable hook order", () => {
    expect(resolveCanonRequestUrl("../secret").error).toMatch(/Invalid book id/);
    expect(resolveCanonRequestUrl("a/b").url).toBeUndefined();
    expect(resolveCanonRequestUrl("").error).toBeTruthy();
  });
});

describe("formatValidityInterval", () => {
  it("formats open intervals as starting at a chapter", () => {
    expect(formatValidityInterval(fact(), "zh")).toBe("第11章 起");
    expect(formatValidityInterval(fact(), "en")).toBe("from ch.11");
  });

  it("formats closed intervals as chapter ranges without rewriting history", () => {
    const closed = fact({ validFromChapter: 1, validUntilChapter: 10 });
    expect(formatValidityInterval(closed, "zh")).toBe("第1–10章");
    expect(formatValidityInterval(closed, "en")).toBe("ch.1–10");
  });
});

describe("slotRows", () => {
  it("shapes slot views into display rows with superseded history counts", () => {
    const rows = slotRows(
      [
        {
          key: "currentLocation",
          label: "当前位置",
          value: "东城公寓",
          selected: fact(),
          superseded: [fact({ object: "城南旧宅", validFromChapter: 1, validUntilChapter: 10, sourceChapter: 2 })],
        },
        { key: "currentGoal", label: "当前目标", value: null, selected: null, superseded: [] },
      ],
      "zh",
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      key: "currentLocation",
      label: "当前位置",
      value: "东城公寓",
      supersededCount: 1,
      validity: "第11章 起",
    });
    expect(rows[1]).toMatchObject({ value: null, supersededCount: 0, validity: null });
  });
});

describe("additionalFactRows", () => {
  it("attaches validity text to every non-slot fact so nothing is silently hidden", () => {
    const rows = additionalFactRows([fact({ subject: "林晚", predicate: "身份", object: "卧底记者", validFromChapter: 4 })], "zh");
    expect(rows[0]).toMatchObject({
      subject: "林晚",
      predicate: "身份",
      object: "卧底记者",
      validity: "第4章 起",
    });
  });
});

describe("hookRows", () => {
  const hook = (overrides: Partial<HookRecordDto> = {}): HookRecordDto => ({
    hookId: "hook-core-missing-will",
    startChapter: 3,
    type: "core_mystery",
    status: "progressing",
    lastAdvancedChapter: 12,
    expectedPayoff: "遗嘱真伪揭晓",
    notes: "与林晚身份线交织",
    dependsOn: ["hook-sub-neighbor"],
    paysOffInArc: "第二卷",
    coreHook: true,
    halfLifeChapters: 6,
    advancedCount: 5,
    promoted: true,
    ...overrides,
  });

  it("preserves every ledger column including promotion metadata", () => {
    const rows = hookRows([hook()]);
    expect(rows[0]).toMatchObject({
      hookId: "hook-core-missing-will",
      dependsOnText: "[hook-sub-neighbor]",
      paysOffInArc: "第二卷",
      coreHook: true,
      halfLifeChapters: 6,
      advancedCount: 5,
      promoted: true,
    });
  });

  it("renders empty optional columns as neutral placeholders", () => {
    const rows = hookRows([
      hook({
        hookId: "hook-plain",
        dependsOn: [],
        paysOffInArc: undefined,
        coreHook: undefined,
        halfLifeChapters: undefined,
        advancedCount: undefined,
        promoted: undefined,
      }),
    ]);
    expect(rows[0]).toMatchObject({ dependsOnText: "—", coreHook: false, promoted: false });
    expect(rows[0]?.paysOffInArc ?? "").toBe("");
    expect(rows[0]?.halfLifeChapters ?? "").toBe("");
  });
});

describe("manifestSummary", () => {
  it("summarizes the canonical manifest for the header card", () => {
    const summary = manifestSummary({
      bookId: "demo",
      manifest: {
        schemaVersion: 2,
        language: "zh",
        lastAppliedChapter: 12,
        projectionVersion: 3,
        migrationWarnings: ["legacy row repaired"],
      },
      currentState: { chapter: 12, facts: [] },
      hooks: { hooks: [] },
      chapterSummaries: { rows: [] },
      description: { chapter: 12, slots: [], additionalFacts: [] },
    });
    expect(summary).toEqual({
      schemaVersion: 2,
      language: "zh",
      lastAppliedChapter: 12,
      projectionVersion: 3,
      warningCount: 1,
      warnings: ["legacy row repaired"],
    });
  });
});
