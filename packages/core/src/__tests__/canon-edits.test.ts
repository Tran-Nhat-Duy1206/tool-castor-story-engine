import { describe, expect, it } from "vitest";
import {
  CanonCommitRequestSchema,
  CanonEditSchema,
} from "../models/canon-edits.js";
import {
  computeCanonRevision,
  validateCanonEditedState,
  CanonConflictError,
  readStoryCanon,
} from "../state/canon-service.js";
import { StateManifestSchema, CurrentStateStateSchema, HooksStateSchema, ChapterSummariesStateSchema, type CurrentStateState } from "../models/runtime-state.js";
import type { StoryCanonView } from "../state/canon-service.js";
import { createCanonBook } from "./helpers/canon-fixture.js";

describe("CanonEditSchema (P3A core edit contract)", () => {
  it("parses setFact with trimmed non-empty fields", () => {
    expect(
      CanonEditSchema.parse({ kind: "setFact", subject: "Elara", predicate: "age", object: "23" }),
    ).toEqual({ kind: "setFact", subject: "Elara", predicate: "age", object: "23" });
  });

  it("parses removeFact", () => {
    expect(
      CanonEditSchema.parse({ kind: "removeFact", subject: "Elara", predicate: "age" }),
    ).toEqual({ kind: "removeFact", subject: "Elara", predicate: "age" });
  });

  it("rejects unknown kinds, empty fields, extra keys, and paths", () => {
    expect(() => CanonEditSchema.parse({ kind: "replaceState", subject: "x" })).toThrow();
    expect(() =>
      CanonEditSchema.parse({ kind: "setFact", subject: "", predicate: "p", object: "o" }),
    ).toThrow();
    expect(() =>
      CanonEditSchema.parse({ kind: "setFact", subject: "s", predicate: "   ", object: "o" }),
    ).toThrow();
    expect(() =>
      CanonEditSchema.parse({ kind: "setFact", subject: "s", predicate: "p", object: "" }),
    ).toThrow();
    // Strict object: no origin/provenance/path smuggling.
    expect(() =>
      CanonEditSchema.parse({
        kind: "setFact",
        subject: "s",
        predicate: "p",
        object: "o",
        origin: "manual",
      }),
    ).toThrow();
    expect(() =>
      CanonEditSchema.parse({
        kind: "setFact",
        subject: "s",
        predicate: "p",
        object: "o",
        path: "story/state/current_state.json",
      }),
    ).toThrow();
  });
});

describe("CanonCommitRequestSchema (envelope)", () => {
  const edit = { kind: "setFact", subject: "Elara", predicate: "age", object: "23" };

  it("accepts edits plus expectedRevision", () => {
    expect(CanonCommitRequestSchema.parse({ edits: [edit], expectedRevision: "abcd1234abcd1234" })).toBeTruthy();
  });

  it("requires at least one edit and a real revision string", () => {
    expect(() => CanonCommitRequestSchema.parse({ edits: [], expectedRevision: "abcd1234abcd1234" })).toThrow();
    expect(() => CanonCommitRequestSchema.parse({ edits: [edit], expectedRevision: "" })).toThrow();
  });
});

function snapshotFromRaw(raw: {
  manifest: unknown; currentState: unknown; hooks: unknown; chapterSummaries: unknown;
}): StoryCanonView {
  return {
    manifest: StateManifestSchema.parse(raw.manifest),
    currentState: CurrentStateStateSchema.parse(raw.currentState),
    hooks: HooksStateSchema.parse(raw.hooks),
    chapterSummaries: ChapterSummariesStateSchema.parse(raw.chapterSummaries),
    revision: "",
  };
}

const BASE_RAW = {
  manifest: { schemaVersion: 2, language: "vi", lastAppliedChapter: 15, projectionVersion: 3, migrationWarnings: [] },
  currentState: {
    chapter: 15,
    facts: [
      { subject: "Elara", predicate: "age", object: "22", validFromChapter: 1, validUntilChapter: null, sourceChapter: 1 },
      { subject: "protagonist", predicate: "mock_text", object: "mock_text", validFromChapter: 11, validUntilChapter: null, sourceChapter: 11 },
    ],
  },
  hooks: { hooks: [] },
  chapterSummaries: { rows: [] },
};

describe("computeCanonRevision (deterministic fingerprint)", () => {
  it("is equal for identical semantics regardless of whitespace and key ordering", () => {
    const a = snapshotFromRaw(BASE_RAW);
    // Same semantics, serialized with reversed OBJECT key order and extra
    // whitespace. Fact ARRAY order is preserved deliberately — it is part of
    // the stored document.
    const reordered = JSON.parse(JSON.stringify({
      chapterSummaries: BASE_RAW.chapterSummaries,
      hooks: BASE_RAW.hooks,
      currentState: {
        facts: [
          { sourceChapter: 1, validUntilChapter: null, validFromChapter: 1, object: "22", predicate: "age", subject: "Elara" },
          { sourceChapter: 11, validUntilChapter: null, validFromChapter: 11, object: "mock_text", predicate: "mock_text", subject: "protagonist" },
        ],
        chapter: 15,
      },
      manifest: { migrationWarnings: [], projectionVersion: 3, lastAppliedChapter: 15, language: "vi", schemaVersion: 2 },
    }));
    const b = snapshotFromRaw(reordered);

    expect(computeCanonRevision(b)).toBe(computeCanonRevision(a));
  });

  it("changes when any semantic content changes", () => {
    const a = snapshotFromRaw(BASE_RAW);
    const changed = snapshotFromRaw({
      ...BASE_RAW,
      currentState: {
        chapter: 15,
        facts: [
          { subject: "Elara", predicate: "age", object: "23", validFromChapter: 1, validUntilChapter: null, sourceChapter: 1 },
          BASE_RAW.currentState.facts[1] as never,
        ],
      },
    });
    expect(computeCanonRevision(changed)).not.toBe(computeCanonRevision(a));
  });

  it("CanonConflictError carries the machine-readable canon_conflict code", () => {
    const err = new CanonConflictError("abcd1234abcd1234");
    expect(err.code).toBe("canon_conflict");
    expect(err).toBeInstanceOf(Error);
    expect(err.currentRevision).toBe("abcd1234abcd1234");
  });

  it("readStoryCanon views expose the additive revision field", async () => {
    const { bookDir } = await createCanonBook();
    const view = await readStoryCanon(bookDir);
    expect(view.revision).toMatch(/^[0-9a-f]{16}$/);
    expect(view.revision).toBe(computeCanonRevision(view));
  });
});

describe("validateCanonEditedState (edit-local only)", () => {
  const before = snapshotFromRaw(BASE_RAW);
  const E = 16;
  type Fact = CurrentStateState["facts"][number];

  function editedFact(object: string, validFrom: number): Fact {
    return { subject: "Elara", predicate: "age", object, validFromChapter: validFrom, validUntilChapter: null, sourceChapter: validFrom };
  }

  function withCurrentState(facts: CurrentStateState["facts"], chapter = 15) {
    return { ...before, currentState: { chapter, facts } };
  }

  it("accepts a clean forward-only replacement", () => {
    const after = withCurrentState([
      editedFact("23", E),
      before.currentState.facts[1]!,
    ]);
    expect(validateCanonEditedState(before, after, E)).toEqual([]);
  });

  it("flags duplicate open rows for the same semantic key", () => {
    const after = withCurrentState([
      editedFact("23", E),
      editedFact("24", E),
      before.currentState.facts[1]!,
    ]);
    expect(validateCanonEditedState(before, after, E).some((i) => i.code === "duplicate_active_fact")).toBe(true);
  });

  it("flags inverted temporal intervals", () => {
    const after = withCurrentState([
      { ...editedFact("23", E), validUntilChapter: 3 },
      before.currentState.facts[1]!,
    ]);
    expect(validateCanonEditedState(before, after, E).some((i) => i.code === "invalid_fact_interval")).toBe(true);
  });

  it("flags edited open rows whose validFrom deviates from the effective chapter", () => {
    const after = withCurrentState([
      editedFact("23", 9),
      before.currentState.facts[1]!,
    ]);
    expect(validateCanonEditedState(before, after, E).some((i) => i.code === "effective_chapter_mismatch")).toBe(true);
  });

  it("flags mutation of protected documents or currentState.chapter", () => {
    const bumpedManifest = { ...before.manifest, lastAppliedChapter: 20 };
    expect(
      validateCanonEditedState(before, { ...before }, E).length,
    ).toBe(0);
    const touchedManifest = validateCanonEditedState(before, { ...before, manifest: bumpedManifest }, E);
    expect(touchedManifest.some((i) => i.code === "protected_document_mutated")).toBe(true);

    const bumpedChapter = { ...before, currentState: { ...before.currentState, chapter: 16 } };
    expect(validateCanonEditedState(before, bumpedChapter, E).some((i) => i.code === "protected_document_mutated")).toBe(true);
  });
});
