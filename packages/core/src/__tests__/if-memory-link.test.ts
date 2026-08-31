import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryDB } from "../state/memory-db.js";
import { writeCharacterFacts, readCharacterVoices } from "../interactive-film/memory-link.js";
import { buildUpsertCharactersDelta } from "../interactive-film/authoring-tools.js";

const require = createRequire(import.meta.url);
const hasNodeSqlite = (() => {
  try {
    require("node:sqlite");
    return true;
  } catch {
    return false;
  }
})();
const sqliteIt = hasNodeSqlite ? it : it.skip;

describe("memory-link", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "if-mem-"));
    await mkdir(join(dir, "story"), { recursive: true });
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  sqliteIt("writes character facts and reads them back by name", () => {
    const db = new MemoryDB(dir);
    writeCharacterFacts(db, [
      { id: "mei", name: "A Mei", role: "protagonist", motivation: "Kiem tra so sach", voiceProfile: { speakingRhythm: "mock_text", vocabulary: "mock_text", sampleLines: [] } },
    ], 1);
    const facts = readCharacterVoices(db, ["A Mei"]);
    db.close();
    const predicates = facts.map(f => f.predicate);
    expect(facts.some(f => f.subject === "A Mei")).toBe(true);
    expect(predicates).toContain("motivation");
  });

  it("buildUpsertCharactersDelta puts characters in characters.upsert", () => {
    const d = buildUpsertCharactersDelta([{ id: "mei", name: "A Mei", role: "other", motivation: "" }]);
    expect(d.characters?.upsert?.[0].id).toBe("mei");
  });
});
