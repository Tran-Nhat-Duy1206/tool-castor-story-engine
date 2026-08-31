import { describe, expect, it } from "vitest";
import { applyManualCurrentStateEdits } from "../state/state-reducer.js";
import type { RuntimeStateSnapshot } from "../state/state-reducer.js";
import type { CanonEdit } from "../models/canon-edits.js";

function snapshotWithFacts(facts: Array<{ subject: string; predicate: string; object: string; validFromChapter: number; validUntilChapter: number | null; sourceChapter: number }>): RuntimeStateSnapshot {
  return {
    manifest: { schemaVersion: 2, language: "vi", lastAppliedChapter: 15, projectionVersion: 3, migrationWarnings: [] },
    currentState: { chapter: 15, facts },
    hooks: { hooks: [] },
    chapterSummaries: { rows: [] },
  };
}

const age22 = { subject: "Elara", predicate: "age", object: "22", validFromChapter: 1, validUntilChapter: null, sourceChapter: 1 };

describe("applyManualCurrentStateEdits (P3A reducer semantics)", () => {
  it("setFact replaces the active fact with validFrom = source = effectiveChapter and leaves NO closed row behind", () => {
    const before = snapshotWithFacts([age22]);
    const after = applyManualCurrentStateEdits({
      snapshot: before,
      edits: [{ kind: "setFact", subject: "Elara", predicate: "age", object: "23" }],
      effectiveChapter: 16,
    });

    const ageRows = after.currentState.facts.filter((f) => f.subject === "Elara" && f.predicate === "age");
    expect(ageRows).toHaveLength(1);
    expect(ageRows[0]).toEqual({
      subject: "Elara", predicate: "age", object: "23",
      validFromChapter: 16, validUntilChapter: null, sourceChapter: 16,
    });
    // Reducer splice convention: the old value must be GONE from live state,
    // not preserved as a closed interval.
    expect(after.currentState.facts.some((f) => f.object === "22")).toBe(false);
  });

  it("removeFact stops asserting the fact without inventing history", () => {
    const before = snapshotWithFacts([age22]);
    const after = applyManualCurrentStateEdits({
      snapshot: before,
      edits: [{ kind: "removeFact", subject: "Elara", predicate: "age" }],
      effectiveChapter: 16,
    });
    expect(after.currentState.facts).toHaveLength(0);
  });

  it("resolves slot aliases to the same semantic key and keeps the stored canonical predicate", () => {
    const location = { subject: "protagonist", predicate: "mock_text", object: "mock_text", validFromChapter: 11, validUntilChapter: null, sourceChapter: 11 };
    const before = snapshotWithFacts([location]);
    const after = applyManualCurrentStateEdits({
      snapshot: before,
      edits: [{ kind: "setFact", subject: "protagonist", predicate: "Current Location", object: "mock_text" }],
      effectiveChapter: 16,
    });

    expect(after.currentState.facts).toHaveLength(1);
    expect(after.currentState.facts[0]).toMatchObject({
      predicate: "mock_text", object: "mock_text",
      validFromChapter: 16, validUntilChapter: null, sourceChapter: 16,
    });
  });

  it("is idempotent under repeated identical setFact", () => {
    const before = snapshotWithFacts([age22]);
    const edit: CanonEdit = { kind: "setFact", subject: "Elara", predicate: "age", object: "23" };
    const once = applyManualCurrentStateEdits({ snapshot: before, edits: [edit], effectiveChapter: 16 });
    const twice = applyManualCurrentStateEdits({ snapshot: once, edits: [edit], effectiveChapter: 16 });
    expect(twice.currentState.facts).toEqual(once.currentState.facts);
  });

  it("does not mutate the input snapshot and preserves unrelated structures", () => {
    const extra = { subject: "mock_text", predicate: "mock_text", object: "mock_text", validFromChapter: 4, validUntilChapter: null, sourceChapter: 4 };
    const before = snapshotWithFacts([age22, extra]);
    const frozen = structuredClone(before);
    Object.freeze(frozen.currentState);
    Object.freeze(frozen.currentState.facts);
    frozen.currentState.facts.forEach((f) => Object.freeze(f));

    const after = applyManualCurrentStateEdits({
      snapshot: frozen as RuntimeStateSnapshot,
      edits: [{ kind: "setFact", subject: "Elara", predicate: "age", object: "23" }],
      effectiveChapter: 16,
    });

    expect(before.currentState.facts).toHaveLength(2); // untouched
    // Structural sharing: untouched top-level documents keep their references
    // from the ACTUAL input object.
    expect(after.manifest).toBe((frozen as RuntimeStateSnapshot).manifest);
    expect(after.hooks).toBe((frozen as RuntimeStateSnapshot).hooks);
    expect(after.chapterSummaries).toBe((frozen as RuntimeStateSnapshot).chapterSummaries);
    expect(after.currentState.chapter).toBe(before.currentState.chapter);
    expect(after.currentState.facts.find((f) => f.subject === "mock_text")).toEqual(extra);
  });
});
