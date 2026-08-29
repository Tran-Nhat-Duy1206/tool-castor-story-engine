import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryDB } from "../state/memory-db.js";
import {
  rebuildNarrativeMemoryIndex,
  rebuildCurrentStateFactHistory,
  invalidateDerivedMemory,
} from "../state/memory-sync.js";

let root = "";
let bookDir = "";

async function seedStateFile(relPath: string, content: unknown): Promise<void> {
  const path = join(bookDir, relPath);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(content), "utf-8");
}

function factRow(object: string, from: number) {
  return { subject: "Elara", predicate: "age", object, validFromChapter: from, validUntilChapter: null, sourceChapter: from };
}

async function seedValidBook(): Promise<void> {
  await writeFile(join(bookDir, "chapters", "0001_c1.md"), "# c1", "utf-8");
  await seedStateFile("story/state/manifest.json", { schemaVersion: 2, language: "zh", lastAppliedChapter: 1, projectionVersion: 3, migrationWarnings: [] });
  await seedStateFile("story/state/current_state.json", { chapter: 1, facts: [factRow("22", 1)] });
  await seedStateFile("story/state/hooks.json", {
    hooks: [{ hookId: "h1", startChapter: 1, type: "core_mystery", status: "open", lastAdvancedChapter: 1, expectedPayoff: "P", notes: "" }],
  });
  await seedStateFile("story/state/chapter_summaries.json", {
    rows: [{ chapter: 1, title: "t", characters: "c", events: "e", stateChanges: "s", hookActivity: "h", mood: "m", chapterType: "过渡" }],
  });
}

/** Seed snapshots/<chapter>/state/current_state.json with the given facts. */
async function seedSnapshotFacts(chapter: number, facts: Array<ReturnType<typeof factRow>>): Promise<void> {
  await seedStateFile(`story/snapshots/${chapter}/state/current_state.json`, { chapter, facts });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "castor-memory-sync-"));
  bookDir = join(root, "books", "demo");
  await mkdir(join(bookDir, "chapters"), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("rebuildNarrativeMemoryIndex (extracted module)", () => {
  it("seeds summaries and hooks from live structured state", async () => {
    await seedValidBook();

    await rebuildNarrativeMemoryIndex(bookDir);

    const db = new MemoryDB(bookDir);
    try {
      expect(db.getSummaries(0, 999)).toHaveLength(1);
      expect(db.getSummaries(0, 999)[0]?.title).toBe("t");
      expect(db.getActiveHooks().map((h) => h.hookId)).toContain("h1");
    } finally {
      db.close();
    }
  });
});

describe("rebuildCurrentStateFactHistory (extracted module)", () => {
  it("attributes fact intervals from the snapshot chain (introduced at 2, changed at 5)", async () => {
    await seedValidBook();
    for (let chapter = 0; chapter <= 6; chapter += 1) {
      const value = chapter < 2 ? null : chapter < 5 ? "22" : "23";
      await seedSnapshotFacts(
        chapter,
        value === null ? [] : [factRow(value, chapter)],
      );
    }
    // Live state agrees with the final snapshot.
    await seedStateFile("story/state/current_state.json", { chapter: 6, facts: [factRow("23", 5)] });

    await rebuildCurrentStateFactHistory(bookDir, 6);

    const db = new MemoryDB(bookDir);
    try {
      const history = db.getFactHistory("Elara");
      expect(history).toHaveLength(2);
      expect(history[0]).toMatchObject({ object: "22", validFromChapter: 2, validUntilChapter: 5 });
      expect(history[1]).toMatchObject({ object: "23", validFromChapter: 5, validUntilChapter: null });
    } finally {
      db.close();
    }
  });

  it("is idempotent — rebuilding twice yields the identical history", async () => {
    await seedValidBook();
    await seedSnapshotFacts(1, [factRow("22", 1)]);
    await seedStateFile("story/state/current_state.json", { chapter: 1, facts: [factRow("22", 1)] });

    await rebuildCurrentStateFactHistory(bookDir, 1);
    const db1 = new MemoryDB(bookDir);
    const first = db1.getFactHistory("Elara");
    db1.close();

    await rebuildCurrentStateFactHistory(bookDir, 1);
    const db2 = new MemoryDB(bookDir);
    const second = db2.getFactHistory("Elara");
    db2.close();

    expect(second.map(({ id: _id, ...rest }) => rest)).toEqual(first.map(({ id: _id, ...rest }) => rest));
  });
});

describe("invalidateDerivedMemory (failure safety)", () => {
  it("reports deleted strategy on successful removal", async () => {
    await seedValidBook();
    await seedStateFile("story/runtime/memory.db", "db-bytes");

    const result = await invalidateDerivedMemory(bookDir);

    expect(result).toMatchObject({ invalidated: true, strategy: "deleted" });
    const { stat } = await import("node:fs/promises");
    await expect(stat(join(bookDir, "story", "runtime", "memory.db"))).rejects.toThrow();
  });

  it("quarantines when deletion fails", async () => {
    const failingRm = async () => { throw new Error("EPERM-ish"); };
    const renamed: string[] = [];
    const result = await invalidateDerivedMemory(bookDir, {
      rm: failingRm,
      rename: async (from, to) => { renamed.push(`${from}=>${to}`); },
    });

    expect(result.invalidated).toBe(true);
    expect(result.strategy).toBe("quarantined");
    expect(renamed.length).toBeGreaterThanOrEqual(1);
    expect(renamed[0]).toContain("memory.db.stale-");
  });

  it("returns the exact honest warning when both mechanisms fail", async () => {
    const result = await invalidateDerivedMemory(bookDir, {
      rm: async () => { throw new Error("busy"); },
      rename: async () => { throw new Error("busy"); },
    });

    expect(result.invalidated).toBe(false);
    expect(result.strategy).toBe("failed");
    expect(result.warning).toBe("derived memory invalidation failed; memory.db may be stale");
  });
});
