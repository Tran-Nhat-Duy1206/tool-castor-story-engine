import { describe, expect, it } from "vitest";
import type { CurrentStateFactDto, HookRecordDto, StoryCanonViewDto } from "../../lib/canon-api";
import {
  additionalFactRows,
  buildCommitRequest,
  buildRemoveFactEdit,
  buildSetFactEdit,
  DERIVED_MEMORY_WARNING_TEXT,
  formatValidityInterval,
  hookRows,
  manifestSummary,
  resolveCanonRequestUrl,
  saveOutcomeToUi,
  slotRows,
  validateFactDraft,
} from "./story-state-model";

const fact = (overrides: Partial<CurrentStateFactDto> = {}): CurrentStateFactDto => ({
  subject: "mock_val",
  predicate: "mock_val",
  object: "mock_val",
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
    expect(formatValidityInterval(fact(), "vi")).toBe("từ chương 11");
    expect(formatValidityInterval(fact(), "en")).toBe("from ch.11");
  });

  it("formats closed intervals as chapter ranges without rewriting history", () => {
    const closed = fact({ validFromChapter: 1, validUntilChapter: 10 });
    expect(formatValidityInterval(closed, "vi")).toBe("Chương 1–10");
    expect(formatValidityInterval(closed, "en")).toBe("ch.1–10");
  });
});

describe("slotRows", () => {
  it("shapes slot views into display rows with superseded history counts", () => {
    const rows = slotRows(
      [
        {
          key: "currentLocation",
          label: "mock_val",
          value: "mock_val",
          selected: fact(),
          superseded: [fact({ object: "mock_val", validFromChapter: 1, validUntilChapter: 10, sourceChapter: 2 })],
        },
        { key: "currentGoal", label: "mock_val", value: null, selected: null, superseded: [] },
      ],
      "vi",
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      key: "currentLocation",
      label: "mock_val",
      value: "mock_val",
      supersededCount: 1,
      validity: "từ chương 11",
    });
    expect(rows[1]).toMatchObject({ value: null, supersededCount: 0, validity: null });
  });
});

describe("additionalFactRows", () => {
  it("attaches validity text to every non-slot fact so nothing is silently hidden", () => {
    const rows = additionalFactRows([fact({ subject: "mock_val", predicate: "mock_val", object: "mock_val", validFromChapter: 4 })], "vi");
    expect(rows[0]).toMatchObject({
      subject: "mock_val",
      predicate: "mock_val",
      object: "mock_val",
      validity: "từ chương 4",
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
    expectedPayoff: "mock_val",
    notes: "mock_val",
    dependsOn: ["hook-sub-neighbor"],
    paysOffInArc: "mock_val",
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
      paysOffInArc: "mock_val",
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
        language: "vi",
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
      language: "vi",
      lastAppliedChapter: 12,
      projectionVersion: 3,
      warningCount: 1,
      warnings: ["legacy row repaired"],
    });
  });
});

// --- T3B: manual-edit model layer ---

describe("canon edit builders", () => {
  it("buildSetFactEdit trims inputs and emits the exact Core wire shape", () => {
    expect(buildSetFactEdit(" Elara ", " age ", "  23 ")).toEqual({
      kind: "setFact",
      subject: "Elara",
      predicate: "age",
      object: "23",
    });
  });

  it("buildRemoveFactEdit trims and omits any object field", () => {
    expect(buildRemoveFactEdit(" Elara ", "age")).toEqual({
      kind: "removeFact",
      subject: "Elara",
      predicate: "age",
    });
    expect("object" in buildRemoveFactEdit("a", "b")).toBe(false);
  });

  it("buildCommitRequest wraps edits with the retained expectedRevision", () => {
    const request = buildCommitRequest([buildSetFactEdit("a", "b", "c")], "0123456789abcdef");
    expect(request).toEqual({
      edits: [{ kind: "setFact", subject: "a", predicate: "b", object: "c" }],
      expectedRevision: "0123456789abcdef",
    });
  });
});

describe("validateFactDraft", () => {
  it("accepts a complete draft and rejects whitespace-only fields with messages", () => {
    expect(validateFactDraft({ subject: "Elara", predicate: "age", object: "23" })).toEqual([]);
    const issues = validateFactDraft({ subject: "  ", predicate: "", object: " " });
    expect(issues.length).toBe(3);
  });
});

describe("saveOutcomeToUi", () => {
  it("maps a clean success to a success banner without refetch demand", () => {
    const view = saveOutcomeToUi(
      { status: "success", bookId: "demo", revision: "r2", appliedEdits: 1, effectiveChapter: 13, warnings: [] },
      "vi",
    );
    expect(view.tone).toBe("success");
    expect(view.showRefetch).toBe(false);
    expect(view.warnings).toEqual([]);
  });

  it("surfaces the exact derived-memory warning without turning success into failure", () => {
    const view = saveOutcomeToUi(
      {
        status: "success",
        bookId: "demo",
        revision: "r2",
        appliedEdits: 1,
        effectiveChapter: 13,
        warnings: [DERIVED_MEMORY_WARNING_TEXT],
      },
      "vi",
    );
    expect(view.tone).toBe("warning");
    expect(view.saved).toBe(true);
    expect(view.warnings).toContain(DERIVED_MEMORY_WARNING_TEXT);
  });

  it("maps canon_conflict to a stale-state banner that demands refetch and re-apply", () => {
    const view = saveOutcomeToUi(
      { status: "canon_conflict", currentRevision: "aaaabbbbccccdddd", message: "Canon changed" },
      "vi",
    );
    expect(view.tone).toBe("conflict");
    expect(view.showRefetch).toBe(true);
    expect(view.currentRevision).toBe("aaaabbbbccccdddd");
    // The user's edit buffer must be discarded — no silent retry.
    expect(view.keepBuffer).toBe(false);
  });

  it("maps lock, unavailable, invalid and unexpected outcomes to non-success tones", () => {
    expect(saveOutcomeToUi({ status: "book_write_locked", message: "busy" }, "vi").tone).toBe("locked");
    expect(saveOutcomeToUi({ status: "canon_unavailable", issues: [], message: "x" }, "vi").tone).toBe("error");
    expect(saveOutcomeToUi({ status: "invalid_request", issues: [{ scope: "edits.0.subject", message: "required" }], message: "bad" }, "vi").issues[0]).toContain("required");
    expect(saveOutcomeToUi({ status: "unexpected", message: "boom" }, "vi").tone).toBe("error");
  });
});

