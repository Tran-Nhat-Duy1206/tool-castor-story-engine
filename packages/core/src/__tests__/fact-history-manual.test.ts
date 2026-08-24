import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryDB } from "../state/memory-db.js";
import { rebuildCurrentStateFactHistory } from "../state/memory-sync.js";

let root = "";
let bookDir = "";

async function seed(relPath: string, content: unknown): Promise<void> {
  const p = join(bookDir, relPath);
  await mkdir(join(p, ".."), { recursive: true });
  await writeFile(p, JSON.stringify(content));
}

const ageFact = (object: string, from: number) => ({
  subject: "Elara", predicate: "age", object,
  validFromChapter: from, validUntilChapter: null, sourceChapter: from,
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "inkos-fact-history-manual-"));
  bookDir = join(root, "books", "demo");
  await mkdir(join(bookDir, "chapters"), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("fact-history reconciliation around manual edits (T3A.7 golden)", () => {
  it("durable 15 + manual set → history ends [22:[1,16), 23:[16,null)]", async () => {
    // Snapshots 1..14 carry age=22 (established ch1); snapshot 15 was
    // refreshed by the manual commit with the POST-edit state.
    for (let c = 0; c <= 14; c += 1) {
      await seed(`story/snapshots/${c}/state/current_state.json`, { chapter: c, facts: c >= 1 ? [ageFact("22", 1)] : [] });
    }
    await seed("story/snapshots/15/state/current_state.json", { chapter: 15, facts: [ageFact("23", 16)] });
    await seed("story/state/current_state.json", { chapter: 15, facts: [ageFact("23", 16)] });

    await rebuildCurrentStateFactHistory(bookDir, 15);

    const db = new MemoryDB(bookDir);
    try {
      expect(db.getFactsAt("Elara", 15).map((f) => f.object)).toEqual(["22"]);
      expect(db.getFactsAt("Elara", 16).map((f) => f.object)).toEqual(["23"]);

      const history = db.getFactHistory("Elara");
      expect(history).toHaveLength(2);
      expect(history[0]).toMatchObject({ object: "22", validFromChapter: 1, validUntilChapter: 16 });
      expect(history[1]).toMatchObject({ object: "23", validFromChapter: 16, validUntilChapter: null });
    } finally {
      db.close();
    }
  });

  it("a book whose snapshots agree with live truth reconciles to a no-op (golden equality)", async () => {
    // age=22 established ch1, superseded by 23 at ch12 through normal writes;
    // snapshot15 and live agree.
    for (let c = 0; c <= 11; c += 1) {
      await seed(`story/snapshots/${c}/state/current_state.json`, { chapter: c, facts: c >= 1 ? [ageFact("22", 1)] : [] });
    }
    for (let c = 12; c <= 15; c += 1) {
      await seed(`story/snapshots/${c}/state/current_state.json`, { chapter: c, facts: [ageFact("23", 12)] });
    }
    await seed("story/state/current_state.json", { chapter: 15, facts: [ageFact("23", 12)] });

    await rebuildCurrentStateFactHistory(bookDir, 15);

    const db = new MemoryDB(bookDir);
    try {
      const history = db.getFactHistory("Elara");
      expect(history.map(({ id: _id, ...rest }) => rest)).toEqual([
        { subject: "Elara", predicate: "age", object: "22", validFromChapter: 1, validUntilChapter: 12, sourceChapter: 1 },
        { subject: "Elara", predicate: "age", object: "23", validFromChapter: 12, validUntilChapter: null, sourceChapter: 12 },
      ]);
    } finally {
      db.close();
    }
  });

  it("a story re-establishing a value later closes the previous interval exactly", async () => {
    for (let c = 0; c <= 19; c += 1) {
      await seed(`story/snapshots/${c}/state/current_state.json`, { chapter: c, facts: c >= 1 && c < 20 ? [ageFact(c < 20 ? "23" : "24", c < 20 ? 1 : 20)] : [] });
    }
    await seed("story/snapshots/20/state/current_state.json", { chapter: 20, facts: [ageFact("24", 20)] });
    await seed("story/state/current_state.json", { chapter: 20, facts: [ageFact("24", 20)] });

    await rebuildCurrentStateFactHistory(bookDir, 20);

    const db = new MemoryDB(bookDir);
    try {
      expect(db.getFactsAt("Elara", 19).map((f) => f.object)).toEqual(["23"]);
      expect(db.getFactsAt("Elara", 20).map((f) => f.object)).toEqual(["24"]);
      const history = db.getFactHistory("Elara");
      expect(history).toHaveLength(2);
      expect(history[0]).toMatchObject({ object: "23", validFromChapter: 1, validUntilChapter: 20 });
      expect(history[1]).toMatchObject({ object: "24", validFromChapter: 20, validUntilChapter: null });
    } finally {
      db.close();
    }
  });
});
