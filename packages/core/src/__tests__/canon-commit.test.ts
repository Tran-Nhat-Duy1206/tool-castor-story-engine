import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rename as realRename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import {
  CanonConflictError,
  commitCanonEdits,
  previewCanonEdits,
  readStoryCanon,
} from "../state/canon-service.js";
import { StateManager } from "../state/manager.js";
import { MemoryDB } from "../state/memory-db.js";
import { renderCurrentStateProjection } from "../state/state-projections.js";
import { captureBookMetadata, createCanonBook } from "./helpers/canon-fixture.js";

let root = "";
let bookDir = "";

beforeEach(async () => {
  const fixture = await createCanonBook({ seedSnapshotsThrough: 12 });
  root = fixture.root;
  bookDir = fixture.bookDir;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function readText(relPath: string): Promise<string> {
  return readFile(join(bookDir, relPath), "utf-8");
}

async function residuePaths(): Promise<string[]> {
  const hits: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".inkos-file-txn-")) hits.push(p);
        else await walk(p);
      }
    }
  }
  await walk(bookDir);
  return hits;
}

const SET_EDIT = { kind: "setFact", subject: "主角", predicate: "当前位置", object: "北塔" } as const;

describe("previewCanonEdits (pure, zero side effects)", () => {
  it("anchors the effective chapter at durable progress + 1, never the inflated manifest", async () => {
    // Fixture with chapters only up to a lower count would break validation,
    // so simulate inflation via a manifest rewrite on the standard 12-chapter
    // book instead.
    const statePath = join(bookDir, "story", "state", "manifest.json");
    const manifest = JSON.parse(await readFile(statePath, "utf-8"));
    manifest.lastAppliedChapter = 99;
    await writeFile(statePath, JSON.stringify(manifest, null, 2), "utf-8");

    const preview = await previewCanonEdits(bookDir, [SET_EDIT]);
    expect(preview.effectiveChapter).toBe(13); // durable contiguous = 12
    expect(preview.issues).toEqual([]);
  });

  it("performs zero filesystem mutations and reports splice warnings", async () => {
    const beforeMeta = await captureBookMetadata(root);
    const preview = await previewCanonEdits(bookDir, [SET_EDIT]);

    expect(await captureBookMetadata(root)).toEqual(beforeMeta);
    expect(preview.after.currentState.facts.some((f) => f.object === "东城公寓")).toBe(false);
    expect(preview.warnings.join(" ")).toMatch(/replac|clos/i);
  });
});

describe("commitCanonEdits (single atomic integrity transaction)", () => {
  it("commits live canon + projection + snapshot mirrors in ONE transaction and returns the new revision", async () => {
    const viewBefore = await readStoryCanon(bookDir);

    const result = await commitCanonEdits(bookDir, {
      edits: [SET_EDIT],
      expectedRevision: viewBefore.revision,
    });

    // Live JSON spliced per reducer convention.
    const liveJson = await readText("story/state/current_state.json");
    const live = JSON.parse(liveJson);
    const rows = live.facts.filter((f: { subject: string; predicate: string }) => f.subject === "主角" && f.predicate === "当前位置");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ object: "北塔", validFromChapter: 13, validUntilChapter: null, sourceChapter: 13 });

    // Projection regenerated and byte-equal to renderer output.
    const liveMd = await readText("story/current_state.md");
    expect(liveMd).toContain("北塔");
    expect(liveMd).toBe(renderCurrentStateProjection(live, "zh"));

    // Snapshot N mirrors BOTH files.
    expect(await readText("story/snapshots/12/state/current_state.json")).toBe(liveJson);
    expect(await readText("story/snapshots/12/current_state.md")).toBe(liveMd);

    // Untouched documents stay byte-identical.
    expect(await readText("story/state/manifest.json")).toBe(JSON.stringify(viewBefore.manifest, null, 2));
    expect(await readText("story/state/hooks.json")).toContain("hook-core-missing-will");
    expect(await readText("story/pending_hooks.md")).toBe(await readText("story/snapshots/12/pending_hooks.md"));

    expect(result.revision).not.toBe(viewBefore.revision);
    expect(result.revision).toMatch(/^[0-9a-f]{16}$/);
    expect(result.effectiveChapter).toBe(13);

    // Re-read revision matches returned value.
    const viewAfter = await readStoryCanon(bookDir);
    expect(viewAfter.revision).toBe(result.revision);
  });

  it("rejects stale expectedRevision with canon_conflict BEFORE touching disk", async () => {
    const beforeMeta = await captureBookMetadata(root);

    await expect(
      commitCanonEdits(bookDir, { edits: [SET_EDIT], expectedRevision: "0000000000000000" }),
    ).rejects.toBeInstanceOf(CanonConflictError);

    expect(await captureBookMetadata(root)).toEqual(beforeMeta);
    expect(await residuePaths()).toEqual([]);
  });

  it("maps an unreadable book to canon_unavailable without writing", async () => {
    const { createCanonBook: fresh } = await import("./helpers/canon-fixture.js");
    const broken = await fresh({ corruptFile: "current_state" });
    try {
      const beforeMeta = await captureBookMetadata(broken.root);
      await expect(
        commitCanonEdits(broken.bookDir, { edits: [SET_EDIT], expectedRevision: "x".repeat(16) }),
      ).rejects.toMatchObject({ code: "canon_unavailable" });
      expect(await captureBookMetadata(broken.root)).toEqual(beforeMeta);
    } finally {
      await rm(broken.root, { recursive: true, force: true });
    }
  });

  it("reconstructs a missing snapshot inside the SAME transaction (no pre-step)", async () => {
    await rm(join(bookDir, "story", "snapshots"), { recursive: true, force: true });
    const viewBefore = await readStoryCanon(bookDir);

    const result = await commitCanonEdits(bookDir, { edits: [SET_EDIT], expectedRevision: viewBefore.revision });

    expect(result.effectiveChapter).toBe(13);
    // Full contract set now present under snapshots/12 — including slots the
    // reconstruction had to copy from live story files.
    for (const rel of [
      "story/snapshots/12/current_state.md",
      "story/snapshots/12/chapter_summaries.md",
      "story/snapshots/12/state/current_state.json",
      "story/snapshots/12/state/chapter_summaries.json",
    ]) {
      expect(existsSync(join(bookDir, rel)), rel).toBe(true);
    }
  });

  it("proves no side-effecting snapshot pre-step runs before the transaction", async () => {
    const spy = vi.spyOn(StateManager.prototype, "snapshotStateAt");
    const viewBefore = await readStoryCanon(bookDir);

    await commitCanonEdits(bookDir, { edits: [SET_EDIT], expectedRevision: viewBefore.revision });

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("failure during live-canon backup leaves EVERYTHING intact with no txn residue", async () => {
    const beforeMeta = await captureBookMetadata(root);

    await expect(
      commitCanonEdits(
        bookDir,
        { edits: [SET_EDIT], expectedRevision: (await readStoryCanon(bookDir)).revision },
        {
          renameFile: async (from, to) => {
            if (from.endsWith(join("story", "state", "current_state.json")) && !from.includes(".inkos-file-txn-")) {
              throw new Error("injected backup failure");
            }
            await realRename(from, to);
          },
        },
      ),
    ).rejects.toThrow("injected backup failure");

    expect(await captureBookMetadata(root)).toEqual(beforeMeta);
    expect(await residuePaths()).toEqual([]);
  });

  it("failure while moving a snapshot mirror rolls back the WHOLE set with no residue", async () => {
    const beforeMeta = await captureBookMetadata(root);

    await expect(
      commitCanonEdits(
        bookDir,
        { edits: [SET_EDIT], expectedRevision: (await readStoryCanon(bookDir)).revision },
        {
          // Fire only on the FORWARD staged→target move of the snapshot
          // markdown mirror (the last write, a brand-new file — so no backup
          // restore path can ever trip the injector). Passthrough calls
          // delegate to the REAL rename.
          renameFile: async (from, to) => {
            if (
              from.includes(".inkos-file-txn-")
              && to.includes(join("snapshots", "12"))
              && to.endsWith("current_state.md")
            ) {
              throw new Error("injected stage-2 failure");
            }
            await realRename(from, to);
          },
        },
      ),
    ).rejects.toThrow("injected stage-2 failure");

    expect(await captureBookMetadata(root)).toEqual(beforeMeta);
    expect(await residuePaths()).toEqual([]);
  });

  it("wires derived memory: fact history reflects the edit; narrative index rebuilt", async () => {
    const viewBefore = await readStoryCanon(bookDir);
    await commitCanonEdits(bookDir, { edits: [SET_EDIT], expectedRevision: viewBefore.revision });

    const db = new MemoryDB(bookDir);
    try {
      const at12 = db.getFactsAt("主角", 12).filter((f) => f.predicate === "当前位置");
      const at13 = db.getFactsAt("主角", 13).filter((f) => f.predicate === "当前位置");
      expect(at12.map((f) => f.object)).toEqual(["东城公寓"]);
      expect(at13.map((f) => f.object)).toEqual(["北塔"]);
      const history = db.getFactHistory("主角").filter((f) => f.predicate === "当前位置");
      expect(history[history.length - 2]).toMatchObject({ object: "东城公寓", validUntilChapter: 13 });
      expect(history[history.length - 1]).toMatchObject({ object: "北塔", validFromChapter: 13, validUntilChapter: null });
      expect(db.getSummaries(11, 12).length).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it("invalidates derived memory when reconciliation fails, and warns honestly when even that fails", async () => {
    // Pre-seed a fake runtime db so deletion is observable.
    const runtimeDir = join(bookDir, "story", "runtime");
    await mkdir(runtimeDir, { recursive: true });
    await writeFile(join(runtimeDir, "memory.db"), "stale", "utf-8");

    const viewBefore = await readStoryCanon(bookDir);
    const result = await commitCanonEdits(
      bookDir,
      { edits: [SET_EDIT], expectedRevision: viewBefore.revision },
      { rebuildNarrativeMemoryIndex: async () => { throw new Error("SQLITE_BUSY"); } },
    );

    expect(result.warnings).toEqual([]); // invalidation SUCCEEDED → no false warning
    expect(existsSync(join(runtimeDir, "memory.db"))).toBe(false);

    // Now both mechanisms fail → exact warning surfaces, commit still lands.
    const viewMid = await readStoryCanon(bookDir);
    const failing = await commitCanonEdits(
      bookDir,
      { edits: [{ kind: "setFact", subject: "主角", predicate: "当前位置", object: "南港" }], expectedRevision: viewMid.revision },
      {
        rebuildNarrativeMemoryIndex: async () => { throw new Error("SQLITE_BUSY"); },
        invalidateDerivedMemory: async () => ({ invalidated: false, strategy: "failed", warning: "derived memory invalidation failed; memory.db may be stale" }),
      },
    );
    expect(failing.warnings).toEqual(["derived memory invalidation failed; memory.db may be stale"]);
    expect(failing.revision).not.toBe(viewMid.revision);
  });

  it("removeFact commits forward-only: the fact vanishes from live state and future reads", async () => {
    // Note: duplicate/inverted/mismatch rejections are unreachable through
    // the reducer (splice convention anchors every new open row at E), and
    // are pinned as defense-in-depth in canon-edits.test.ts
    // §validateCanonEditedState. Here we prove the reachable happy removal.
    const viewBefore = await readStoryCanon(bookDir);

    const result = await commitCanonEdits(bookDir, {
      edits: [{ kind: "removeFact", subject: "林晚", predicate: "身份" }],
      expectedRevision: viewBefore.revision,
    });

    expect(result.effectiveChapter).toBe(13);
    const live = JSON.parse(await readText("story/state/current_state.json"));
    expect(live.facts.some((f: { subject: string }) => f.subject === "林晚")).toBe(false);

    const db = new MemoryDB(bookDir);
    try {
      // Forward-only removal, as reflected in derived memory: the REFRESHED
      // head snapshot (chapter 12) no longer carries the fact, so replay
      // closes its interval exactly at 12 — chapters ≥ 13 never see it.
      expect(db.getFactsAt("林晚", 11).map((f) => f.object)).toEqual(["卧底记者"]);
      expect(db.getFactsAt("林晚", 12)).toEqual([]);
      const history = db.getFactHistory("林晚");
      expect(history).toHaveLength(1);
      // Replay attributes validFrom to the first snapshot carrying the key
      // (chapter 1 in this fixture) — the engine's standing convention.
      expect(history[0]).toMatchObject({ object: "卧底记者", validFromChapter: 1, validUntilChapter: 12 });
    } finally {
      db.close();
    }
  });
});

