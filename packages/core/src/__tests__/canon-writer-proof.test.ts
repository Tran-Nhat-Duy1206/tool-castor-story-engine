import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readdirSync } from "node:fs";
import {
  CanonConflictError,
  commitCanonEdits,
  previewCanonEdits,
  readStoryCanon,
} from "../state/canon-service.js";
import { StateManager } from "../state/manager.js";
import { MemoryDB } from "../state/memory-db.js";
import { renderCurrentStateProjection } from "../state/state-projections.js";
import { retrieveMemorySelection } from "../utils/memory-retrieval.js";
import { renderNarrativeSelectedContext } from "../utils/narrative-control.js";
import { captureBookMetadata, createCanonBook, type FileMetadata } from "./helpers/canon-fixture.js";

let root = "";
let bookDir = "";
let beforeMeta: Record<string, FileMetadata> = {};

const AGE_22 = {
  subject: "Elara", predicate: "age", object: "22",
  validFromChapter: 1, validUntilChapter: null, sourceChapter: 1,
};

beforeEach(async () => {
  const fixture = await createCanonBook({
    chapterCount: 15,
    seedSnapshotsThrough: 15,
    inflateManifestTo: 99,
    extraFacts: [AGE_22],
  });
  root = fixture.root;
  bookDir = fixture.bookDir;
  beforeMeta = await captureBookMetadata(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function residueCount(): number {
  let count = 0;
  const stack = [bookDir];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".castor-file-txn-")) count += 1;
      else stack.push(join(dir, entry.name));
    }
  }
  return count;
}

function metaOf(meta: Record<string, FileMetadata>, rel: string): FileMetadata {
  const norm = rel.replaceAll("/", "\\");
  for (const key of Object.keys(meta)) {
    if (key === rel || key === norm || key.endsWith(`\\${norm}`)) return meta[key]!;
  }
  throw new Error(`metadata entry not found for ${rel}`);
}

describe("P3A deterministic writer contract (LLM-free integration proof)", () => {
  it("manual edits land exactly like a deterministic writer would write them", async () => {
    const spy = vi.spyOn(StateManager.prototype, "snapshotStateAt");
    const view0 = await readStoryCanon(bookDir);

    // (precondition) inflated manifest does NOT move the anchor
    const preview = await previewCanonEdits(bookDir, [
      { kind: "setFact", subject: "Elara", predicate: "age", object: "23" },
    ]);
    expect(preview.effectiveChapter).toBe(16);

    const result = await commitCanonEdits(bookDir, {
      edits: [{ kind: "setFact", subject: "Elara", predicate: "age", object: "23" }],
      expectedRevision: view0.revision,
    });

    // (1) anchor pinned at durable+1 despite manifest claiming 99.
    expect(result.effectiveChapter).toBe(16);

    // (2) live JSON carries exactly ONE open Elara/age row, spliced forward.
    const { readFile: readFileAsync } = await import("node:fs/promises");
    const live = JSON.parse(await readFileAsync(join(bookDir, "story", "state", "current_state.json"), "utf-8"));
    const rows = live.facts.filter((f: { subject: string; predicate: string }) => f.subject === "Elara" && f.predicate === "age");
    expect(rows).toEqual([
      { subject: "Elara", predicate: "age", object: "23", validFromChapter: 16, validUntilChapter: null, sourceChapter: 16 },
    ]);

    // (3) every PROSE chapter file stayed byte-identical.
    const afterMeta = await captureBookMetadata(root);
    const chapterPaths = Object.keys(afterMeta).filter((p) => p.includes("chapters") && p.endsWith(".md"));
    expect(chapterPaths.length).toBeGreaterThanOrEqual(15);
    for (const p of chapterPaths) {
      expect(metaOf(afterMeta, p).sha256, p).toBe(metaOf(beforeMeta, p).sha256);
    }

    // (4) protected documents untouched. Manifest nuance: the narrative
    // memory seed bootstraps like every pipeline write, which normalizes an
    // INFLATED lastAppliedChapter down to durable progress — semantic
    // normalization, not editorial mutation. Hooks/summaries stay byte-equal.
    for (const rel of ["story/state/hooks.json", "story/state/chapter_summaries.json"]) {
      expect(metaOf(afterMeta, rel).sha256, rel).toBe(metaOf(beforeMeta, rel).sha256);
    }
    const manifestAfter = JSON.parse(
      await import("node:fs/promises").then((m) => m.readFile(join(bookDir, "story", "state", "manifest.json"), "utf-8")),
    );
    expect(manifestAfter).toMatchObject({ schemaVersion: 2, language: "zh", lastAppliedChapter: 15 });

    // (5) head snapshot mirrors refreshed INSIDE the same transaction.
    expect(metaOf(afterMeta, "story/snapshots/15/state/current_state.json").sha256)
      .toBe(metaOf(afterMeta, "story/state/current_state.json").sha256);

    // (6) derived memory serves old value through 15 and new from 16.
    const db = new MemoryDB(bookDir);
    try {
      expect(db.getFactsAt("Elara", 15).map((f) => f.object)).toEqual(["22"]);
      expect(db.getFactsAt("Elara", 16).map((f) => f.object)).toEqual(["23"]);
      const history = db.getFactHistory("Elara");
      expect(history.map(({ id: _id, ...rest }) => rest)).toEqual([
        { subject: "Elara", predicate: "age", object: "22", validFromChapter: 1, validUntilChapter: 16, sourceChapter: 1 },
        { subject: "Elara", predicate: "age", object: "23", validFromChapter: 16, validUntilChapter: null, sourceChapter: 16 },
      ]);
    } finally {
      db.close();
    }

    // (7) revision fingerprint advanced and matches a fresh read.
    expect(result.revision).not.toBe(view0.revision);
    await expect(readStoryCanon(bookDir).then((v) => v.revision)).resolves.toBe(result.revision);

    // (7b) T3A.9 projection leg: the PERSISTED current_state.md produced by
    // the manual commit is byte-equal to rendering the persisted canonical
    // state, carries the corrected 23, and contains no stale active 22.
    // (Fixture audit: no other value/label in this book contains "22".)
    const { readFile: readFixtureFile } = await import("node:fs/promises");
    const liveJsonText = await readFixtureFile(join(bookDir, "story", "state", "current_state.json"), "utf-8");
    const liveState = JSON.parse(liveJsonText);
    const persistedProjection = await readFixtureFile(join(bookDir, "story", "current_state.md"), "utf-8");
    expect(persistedProjection).toBe(renderCurrentStateProjection(liveState, "zh"));
    expect(persistedProjection).toContain("23");
    expect(persistedProjection).not.toContain("22");

    // (7c) T3A.9 writer-evidence leg through REAL production boundaries:
    // retrieveMemorySelection reads LIVE structured canon directly and ranks
    // against the memory index the commit just rebuilt; composer.ts:678-682
    // shapes fact entries exactly as replicated here (anchor semantics =
    // predicate.trim().replaceAll(/\s+/g,"-"), excerpt = `predicate | object`);
    // writer.ts:855/869 embeds ALL selectedContext verbatim via
    // renderNarrativeSelectedContext. buildGovernedMemoryEvidenceBlocks has
    // NO filter for `story/current_state.md#` entries (governed-context.ts
    // routes only hooks/summaries/volume/trail/canon), so that builder is not
    // the production carrier of facts — renderNarrativeSelectedContext is.
    const selection = await retrieveMemorySelection({
      bookDir,
      chapterNumber: 16,
      goal: "Elara age",
    });
    const ageFact = selection.facts.find((f) => f.subject === "Elara" && f.predicate === "age");
    expect(ageFact?.object).toBe("23");

    const ageEntry = {
      source: `story/current_state.md#${ageFact!.predicate.trim().replaceAll(/\s+/g, "-")}`,
      reason: "Relevant current-state fact retrieved for the current chapter goal.",
      excerpt: `${ageFact!.predicate} | ${ageFact!.object}`,
    };
    const writerEvidence = renderNarrativeSelectedContext([ageEntry], "zh");
    expect(writerEvidence).toContain("23");
    expect(writerEvidence).not.toContain("22");

    // (8) zero transaction residue and ZERO side-effecting pre-steps.
    expect(residueCount()).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("a second writer with a stale fingerprint gets canon_conflict and changes nothing", async () => {
    const view0 = await readStoryCanon(bookDir);
    await commitCanonEdits(bookDir, {
      edits: [{ kind: "setFact", subject: "Elara", predicate: "age", object: "23" }],
      expectedRevision: view0.revision,
    });

    await expect(
      commitCanonEdits(bookDir, {
        edits: [{ kind: "setFact", subject: "Elara", predicate: "age", object: "24" }],
        expectedRevision: view0.revision,
      }),
    ).rejects.toBeInstanceOf(CanonConflictError);

    const afterMeta = await captureBookMetadata(root);
    // Only the FIRST commit's legitimate writes exist — the conflicting one
    // contributed nothing beyond them.
    expect(metaOf(afterMeta, "story/state/current_state.json").sha256)
      .not.toBe(metaOf(beforeMeta, "story/state/current_state.json").sha256);
    const live = JSON.parse(await import("node:fs/promises").then((m) => m.readFile(join(bookDir, "story", "state", "current_state.json"), "utf-8")));
    expect(live.facts.filter((f: { subject: string }) => f.subject === "Elara").map((f: { object: string }) => f.object)).toEqual(["23"]);
  });
});

