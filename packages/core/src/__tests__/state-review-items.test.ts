import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RuntimeStateDeltaSchema,
  type RuntimeStateLanguage,
} from "../models/runtime-state.js";
import {
  resolveReviewItemEffectiveChange,
  type ProposalChange,
  type ReviewItem,
} from "../models/state-review.js";
import {
  CURRENT_STATE_SLOT_DEFS,
  describeCurrentStateSlot,
  type CurrentStateSlotKey,
} from "../state/state-projections.js";
import { applyRuntimeStateDelta, type RuntimeStateSnapshot } from "../state/state-reducer.js";
import { buildStateReviewItems } from "../state/state-review-items.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LONG_VALUE = `${"A very long location description that keeps going. ".repeat(6)}END-OF-LONG-VALUE`;

const ZH_PROSE = [
  "Bong demmock_text。",
  "mock_text，mock_text，mock_text。",
  "mock_text：mock_text。",
  "mock_text。",
].join("\n");

/** Prose containing multi-space/newline variants and a decomposed accent. */
const NORMALIZATION_PROSE = [
  "Lin Yue found the old",
  "   ledger by the river, and kept walking.",
  "She stopped at a Cafe\u0301 near the bridge.",
].join(" ");

function minimalSnapshot(
  language: RuntimeStateLanguage,
  facts: Array<{ readonly predicate: string; readonly object: string }> = [],
): RuntimeStateSnapshot {
  return {
    manifest: {
      schemaVersion: 2,
      language,
      lastAppliedChapter: 11,
      projectionVersion: 1,
      migrationWarnings: [],
    },
    currentState: {
      chapter: 11,
      facts: facts.map((fact) => ({
        subject: "protagonist",
        validFromChapter: 1,
        validUntilChapter: null,
        sourceChapter: 1,
        ...fact,
      })),
    },
    hooks: { hooks: [] },
    chapterSummaries: { rows: [] },
  };
}

function zhDelta(patch: Record<string, string>): ReturnType<typeof RuntimeStateDeltaSchema.parse> {
  return RuntimeStateDeltaSchema.parse({ chapter: 12, currentStatePatch: patch });
}

function kinds(items: ReadonlyArray<ReviewItem>): string[] {
  return items.map((item) => item.kind);
}

function factItems(items: ReadonlyArray<ReviewItem>): Array<Extract<ProposalChange, { type: "fact" }>> {
  return items
    .filter((item) => item.kind === "current-state-fact")
    .map((item) => item.proposal as Extract<ProposalChange, { type: "fact" }>);
}

const HOOK_RECORD = {
  hookId: "mentor-debt",
  startChapter: 1,
  type: "mystery",
  status: "progressing",
  lastAdvancedChapter: 12,
  expectedPayoff: "Reveal who forged the ledger.",
  notes: "The river-port clue sharpens.",
};

// ---------------------------------------------------------------------------
// STEP A — shared slot vocabulary characterization (pins TODAY's semantics)
// ---------------------------------------------------------------------------

describe("shared current-state slot vocabulary (characterization)", () => {
  const SLOT_VALUES: Record<CurrentStateSlotKey, string> = {
    currentLocation: "mock_text",
    protagonistState: "mock_text",
    currentGoal: "mock_text",
    currentConstraint: "mock_text",
    currentAlliances: "mock_text",
    currentConflict: "mock_text",
  };

  it.each(["vi", "en"] as const)("reducer and describeCurrentStateSlot agree for every slot (%s)", (language) => {
    for (const def of CURRENT_STATE_SLOT_DEFS) {
      const described = describeCurrentStateSlot(def.key, language);
      expect(described.subject).toBe("protagonist");

      const result = applyRuntimeStateDelta({
        snapshot: minimalSnapshot(language),
        delta: zhDelta({ [def.key]: SLOT_VALUES[def.key] }),
      });
      const persisted = result.currentState.facts.find(
        (fact) => fact.object === SLOT_VALUES[def.key],
      );
      expect(persisted).toBeDefined();
      // Vocabulary equivalence: converter-side helper === what the engine persists.
      expect(persisted?.subject).toBe(described.subject);
      expect(persisted?.predicate).toBe(described.predicate);
    }
  });

  it("pins the exact language-first predicates for representative slots", () => {
    expect(describeCurrentStateSlot("currentLocation", "vi")).toEqual({
      subject: "protagonist",
      predicate: "mock_text",
    });
    expect(describeCurrentStateSlot("currentLocation", "en")).toEqual({
      subject: "protagonist",
      predicate: "Current Location",
    });
    expect(describeCurrentStateSlot("currentAlliances", "vi").predicate).toBe("mock_text");
    expect(describeCurrentStateSlot("currentAlliances", "en").predicate).toBe("Current Alliances");
    expect(describeCurrentStateSlot("protagonistState", "vi").predicate).toBe("mock_text");
    expect(describeCurrentStateSlot("currentConflict", "en").predicate).toBe("Current Conflict");
  });

  it("preserves alias-set removal matching across language boundaries", () => {
    // zh book carrying a legacy EN-labelled fact: the patch must STILL remove it.
    const result = applyRuntimeStateDelta({
      snapshot: minimalSnapshot("vi", [
        { predicate: "Current Location", object: "mock_text" },
      ]),
      delta: zhDelta({ currentLocation: "mock_text" }),
    });
    const openFacts = result.currentState.facts.filter(
      (fact) => fact.validUntilChapter === null
        && fact.predicate === "mock_text",
    );
    expect(openFacts).toHaveLength(1);
    expect(openFacts[0]?.object).toBe("mock_text");
    expect(
      result.currentState.facts.some(
        (fact) => fact.validUntilChapter === null && fact.predicate === "Current Location",
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PART B/C/D/E/F — buildStateReviewItems
// ---------------------------------------------------------------------------

describe("buildStateReviewItems", () => {
  it("returns zero items for an empty delta", () => {
    const items = buildStateReviewItems(RuntimeStateDeltaSchema.parse({ chapter: 13 }), {
      chapterContent: ZH_PROSE,
      language: "vi",
    });
    expect(items).toEqual([]);
  });

  it("maps one patch slot to exactly one ai-origin undecided current-state-fact using the SHARED vocabulary", () => {
    const items = buildStateReviewItems(zhDelta({ currentLocation: "mock_text" }), {
      chapterContent: ZH_PROSE,
      language: "vi",
    });
    expect(items).toHaveLength(1);
    const item = items[0]!;
    expect(item.kind).toBe("current-state-fact");
    expect(item.origin).toBe("ai");
    expect(item.decision).toBe("undecided");
    const described = describeCurrentStateSlot("currentLocation", "vi");
    expect(item.proposal).toEqual({
      type: "fact",
      change: { action: "set", subject: described.subject, predicate: described.predicate, object: "mock_text" },
    });
  });

  it("maps multiple supported slots to one item each in deterministic slot order", () => {
    const items = buildStateReviewItems(
      zhDelta({
        currentConflict: "mock_text",
        currentLocation: "mock_text",
        currentGoal: "mock_text",
      }),
      { chapterContent: "", language: "vi" },
    );
    expect(items).toHaveLength(3);
    expect(items.every((item) => item.kind === "current-state-fact")).toBe(true);
    // Canonical SLOT_DEFS order, independent of patch insertion order.
    expect(factItems(items).map((proposal) => proposal.change.predicate)).toEqual([
      "mock_text",
      "mock_text",
      "mock_text",
    ]);
    expect(factItems(items)[0]?.change.object).toBe("mock_text");
    expect(factItems(items)[1]?.change.object).toBe("mock_text");
    expect(factItems(items)[2]?.change.object).toBe("mock_text");
    expect(new Set(items.map((item) => item.id)).size).toBe(3);
  });

  it("maps hookOps.upsert to hook-upsert items retaining the real HookRecord", () => {
    const items = buildStateReviewItems(
      RuntimeStateDeltaSchema.parse({
        chapter: 13,
        hookOps: { upsert: [HOOK_RECORD], mention: [], resolve: [], defer: [] },
      }),
      // Evidence text is the joined payoff+notes semantic text.
      { chapterContent: "Reveal who forged the ledger. The river-port clue sharpens.", language: "en" },
    );
    expect(kinds(items)).toEqual(["hook-upsert"]);
    expect(items[0]!.origin).toBe("ai");
    expect(items[0]!.decision).toBe("undecided");
    expect(items[0]!.proposal).toEqual({ type: "hook-upsert", hook: HOOK_RECORD });
    expect(items[0]!.evidence).toMatchObject({ claimedLevel: "explicit", verifiedLevel: "explicit" });
  });

  it("maps hookOps.mention to a hook-mention hook-op item without fabricated evidence", () => {
    const items = buildStateReviewItems(
      RuntimeStateDeltaSchema.parse({ chapter: 13, hookOps: { mention: ["mentor-debt"] } }),
      { chapterContent: ZH_PROSE, language: "vi" },
    );
    expect(kinds(items)).toEqual(["hook-mention"]);
    expect(items[0]!.proposal).toEqual({ type: "hook-op", op: "mention", hookId: "mentor-debt" });
    expect(items[0]!.evidence).toBeUndefined();
  });

  it("maps hookOps.resolve to a hook-resolve item", () => {
    const items = buildStateReviewItems(
      RuntimeStateDeltaSchema.parse({ chapter: 13, hookOps: { resolve: ["mentor-debt"] } }),
      { chapterContent: "", language: "vi" },
    );
    expect(kinds(items)).toEqual(["hook-resolve"]);
    expect(items[0]!.proposal).toEqual({ type: "hook-op", op: "resolve", hookId: "mentor-debt" });
  });

  it("maps hookOps.defer to a hook-defer item", () => {
    const items = buildStateReviewItems(
      RuntimeStateDeltaSchema.parse({ chapter: 13, hookOps: { defer: ["mentor-debt"] } }),
      { chapterContent: "", language: "vi" },
    );
    expect(kinds(items)).toEqual(["hook-defer"]);
    expect(items[0]!.proposal).toEqual({ type: "hook-op", op: "defer", hookId: "mentor-debt" });
  });

  it("maps newHookCandidates to new-hook-candidate proposals without promotion", () => {
    const candidate = {
      type: "mystery",
      expectedPayoff: "The lighthouse keeper disappears.",
      notes: "Seeds the arc mystery.",
    };
    const items = buildStateReviewItems(
      RuntimeStateDeltaSchema.parse({ chapter: 13, newHookCandidates: [candidate] }),
      { chapterContent: "", language: "en" },
    );
    expect(kinds(items)).toEqual(["new-hook-candidate"]);
    expect(items[0]!.proposal).toEqual({ type: "new-hook-candidate", candidate });
  });

  it("maps chapterSummary to a chapter-summary item reusing ChapterSummaryRow", () => {
    const row = {
      chapter: 13,
      title: "River Ledger",
      characters: "Lin Yue",
      events: "Lin Yue finds the old ledger.",
      stateChanges: "",
      hookActivity: "",
      mood: "tense",
      chapterType: "mainline",
    };
    const items = buildStateReviewItems(
      RuntimeStateDeltaSchema.parse({ chapter: 13, chapterSummary: row }),
      { chapterContent: "Lin Yue finds the old ledger.", language: "en" },
    );
    expect(kinds(items)).toEqual(["chapter-summary"]);
    expect(items[0]!.proposal).toEqual({ type: "chapter-summary", row });
    expect(items[0]!.evidence).toMatchObject({ claimedLevel: "explicit", verifiedLevel: "explicit" });
  });

  it("produces the EXACT kind multiset and count for a fully-loaded mixed delta", () => {
    const items = buildStateReviewItems(
      RuntimeStateDeltaSchema.parse({
        chapter: 13,
        currentStatePatch: { currentGoal: "mock_text" },
        hookOps: {
          upsert: [HOOK_RECORD, { ...HOOK_RECORD, hookId: "lighthouse", type: "mystery" }],
          mention: ["harbor-toll"],
          resolve: ["mentor-debt"],
          defer: ["rain-omen"],
        },
        newHookCandidates: [{ type: "mystery", expectedPayoff: "", notes: "" }],
        chapterSummary: {
          chapter: 13,
          title: "mock_text",
          characters: "mock_text",
          events: "mock_text。",
          stateChanges: "",
          hookActivity: "",
          mood: "mock_text",
          chapterType: "mock_text",
        },
        subplotOps: [{ op: "insert", id: "smuggling" }],
        emotionalArcOps: [{ op: "shift", id: "trust" }],
        characterMatrixOps: [{ op: "update", pair: ["mock_text", "mock_text"] }],
        notes: ["Settler flagged an ambiguous alliance label."],
      }),
      { chapterContent: "", language: "vi" },
    );
    expect(items).toHaveLength(9);
    expect([...kinds(items)].sort()).toEqual([
      "chapter-summary",
      "current-state-fact",
      "hook-defer",
      "hook-mention",
      "hook-resolve",
      "hook-upsert",
      "hook-upsert",
      "new-hook-candidate",
      "note",
    ]);
  });

  it("aggregates ALL unsupported loose ops and delta notes into ONE note item", () => {
    const items = buildStateReviewItems(
      RuntimeStateDeltaSchema.parse({
        chapter: 13,
        subplotOps: [{ op: "a" }, { op: "b" }],
        emotionalArcOps: [{ op: "c" }],
        characterMatrixOps: [],
        notes: ["free-form note one", "free-form note two"],
      }),
      { chapterContent: "", language: "vi" },
    );
    expect(kinds(items)).toEqual(["note"]);
    const note = items[0]!;
    expect(note.proposal).toEqual({ type: "none" });
    expect(note.detail).toContain("subplotOps");
    expect(note.detail).toContain("emotionalArcOps");
    expect(note.detail).not.toContain("characterMatrixOps");
    expect(note.detail).toContain("free-form note one");
    expect(note.detail).toContain("free-form note two");
    // Notes can NEVER become a state mutation, whatever the human decides.
    for (const decision of ["undecided", "accepted", "rejected", "edited"] as const) {
      expect(resolveReviewItemEffectiveChange({ ...note, decision })).toEqual({ type: "none" });
    }
  });

  it("emits NO spurious note when unsupported arrays and notes are all empty", () => {
    const items = buildStateReviewItems(
      RuntimeStateDeltaSchema.parse({
        chapter: 13,
        hookOps: { mention: ["x"] },
        subplotOps: [],
        emotionalArcOps: [],
        characterMatrixOps: [],
        notes: [],
      }),
      { chapterContent: "", language: "vi" },
    );
    expect(kinds(items)).toEqual(["hook-mention"]);
  });

  it("is deterministic: two invocations yield identical ids in identical order", () => {
    const delta = RuntimeStateDeltaSchema.parse({
      chapter: 13,
      currentStatePatch: { currentGoal: "mock_text", currentLocation: "mock_text" },
      hookOps: { upsert: [HOOK_RECORD], mention: ["a"], resolve: [], defer: ["b"] },
      newHookCandidates: [{ type: "mystery", expectedPayoff: "p", notes: "n" }],
      chapterSummary: {
        chapter: 13,
        title: "T",
        characters: "",
        events: "e",
        stateChanges: "",
        hookActivity: "",
        mood: "",
        chapterType: "",
      },
      notes: ["loose"],
    });
    const ctx = { chapterContent: ZH_PROSE, language: "vi" } as const;
    const first = buildStateReviewItems(delta, ctx);
    const second = buildStateReviewItems(delta, ctx);
    expect(second.map((item) => item.id)).toEqual(first.map((item) => item.id));
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("makes ids payload-sensitive: changing one semantic value changes that item's id", () => {
    const before = buildStateReviewItems(zhDelta({ currentGoal: "mock_text" }), {
      chapterContent: "",
      language: "vi",
    });
    const after = buildStateReviewItems(zhDelta({ currentGoal: "mock_text" }), {
      chapterContent: "",
      language: "vi",
    });
    expect(before[0]!.id).not.toBe(after[0]!.id);

    const hookBefore = buildStateReviewItems(
      RuntimeStateDeltaSchema.parse({ chapter: 13, hookOps: { upsert: [HOOK_RECORD] } }),
      { chapterContent: "", language: "en" },
    );
    const hookAfter = buildStateReviewItems(
      RuntimeStateDeltaSchema.parse({
        chapter: 13,
        hookOps: { upsert: [{ ...HOOK_RECORD, expectedPayoff: "Changed payoff." }] },
      }),
      { chapterContent: "", language: "en" },
    );
    expect(hookBefore[0]!.id).not.toBe(hookAfter[0]!.id);
  });

  it("marks truly-present semantic text as explicit with a bounded quote", () => {
    const items = buildStateReviewItems(zhDelta({ currentGoal: LONG_VALUE }), {
      chapterContent: `${ZH_PROSE}\n${LONG_VALUE}`,
      language: "vi",
    });
    const evidence = items[0]!.evidence;
    expect(evidence?.claimedLevel).toBe("explicit");
    expect(evidence?.verifiedLevel).toBe("explicit");
    // Quote is the bounded prefix of the verified semantic value.
    expect(evidence?.quote).toBe(LONG_VALUE.slice(0, 200));
    expect(evidence!.quote!.length).toBeLessThanOrEqual(200);
  });

  it("marks absent semantic text as inferred WITHOUT fabricating a quote", () => {
    const items = buildStateReviewItems(zhDelta({ currentGoal: "mock_text" }), {
      chapterContent: ZH_PROSE,
      language: "vi",
    });
    expect(items[0]!.evidence).toEqual({
      claimedLevel: "inferred",
      verifiedLevel: "inferred",
    });
    expect(items[0]!.evidence?.quote).toBeUndefined();
  });

  it("verifies contiguous CJK phrases in prose", () => {
    const items = buildStateReviewItems(zhDelta({ currentLocation: "mock_text" }), {
      chapterContent: ZH_PROSE,
      language: "vi",
    });
    expect(items[0]!.evidence?.verifiedLevel).toBe("explicit");
    expect(items[0]!.evidence?.quote).toBe("mock_text");
  });

  it("matches across newline/space normalization exactly like Task 2", () => {
    const items = buildStateReviewItems(
      RuntimeStateDeltaSchema.parse({
        chapter: 13,
        hookOps: {
          upsert: [{ ...HOOK_RECORD, expectedPayoff: "found the old ledger by the river,", notes: "" }],
        },
      }),
      { chapterContent: NORMALIZATION_PROSE, language: "en" },
    );
    expect(items[0]!.evidence?.verifiedLevel).toBe("explicit");
  });

  it("does NOT fake-match CJK values with internal spacing against contiguous prose", () => {
    const items = buildStateReviewItems(zhDelta({ currentLocation: "mock_text mock_text" }), {
      chapterContent: ZH_PROSE,
      language: "vi",
    });
    expect(items[0]!.evidence).toEqual({ claimedLevel: "inferred", verifiedLevel: "inferred" });
  });

  it("matches NFC-composed item text against NFD prose via Task 2 normalization", () => {
    const items = buildStateReviewItems(
      RuntimeStateDeltaSchema.parse({
        chapter: 13,
        hookOps: {
          upsert: [{
            ...HOOK_RECORD,
            expectedPayoff: "stopped at a Caf\u00E9 near the bridge.",
            notes: "",
          }],
        },
      }),
      { chapterContent: NORMALIZATION_PROSE, language: "en" },
    );
    expect(items[0]!.evidence?.verifiedLevel).toBe("explicit");
  });

  it("never produces a quote longer than the schema maximum of 200 characters", () => {
    const items = buildStateReviewItems(
      RuntimeStateDeltaSchema.parse({ chapter: 13, chapterSummary: {
        chapter: 13,
        title: "Long",
        characters: "",
        events: LONG_VALUE,
        stateChanges: "",
        hookActivity: "",
        mood: "",
        chapterType: "",
      } }),
      { chapterContent: `${NORMALIZATION_PROSE} ${LONG_VALUE}`, language: "en" },
    );
    const quote = items[0]!.evidence?.quote;
    expect(quote).toBeDefined();
    expect(quote!.length).toBeLessThanOrEqual(200);
  });

  it("converter module is statically pure: no fs/store/reducer/canon dependencies", () => {
    const sourcePath = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "state",
      "state-review-items.ts",
    );
    const source = readFileSync(sourcePath, "utf-8");
    for (const banned of [
      /from\s+"node:/,
      /\bwriteFile\b/,
      /\bmkdir\b/,
      /\brename\b/,
      /applyRuntimeStateDelta/,
      /canon-service/,
      /state-review-store/,
      /bookDir/,
    ]) {
      expect(source).not.toMatch(banned);
    }
  });
});
