import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { buildSnapshotFileSet, isSnapshotComplete, SNAPSHOT_STORY_FILE_NAMES } from "../state/snapshot-set.js";
import { StateManager } from "../state/manager.js";

let root = "";
let bookDir = "";

const STORY_FILES_SEEDED = ["current_state.md", "pending_hooks.md", "chapter_summaries.md", "character_matrix.md"] as const;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "castor-snapshot-set-"));
  bookDir = join(root, "books", "demo");
  await mkdir(join(bookDir, "story", "state"), { recursive: true });
  // Seed only SOME of the fixed slots — the rest must be skipped by the
  // shared skip-if-source-missing rule.
  for (const name of STORY_FILES_SEEDED) {
    await writeFile(join(bookDir, "story", name), `live ${name}`, "utf-8");
  }
  await writeFile(join(bookDir, "story", "state", "manifest.json"), "{}", "utf-8");
  await writeFile(join(bookDir, "story", "state", "hooks.json"), "{}", "utf-8");
  // Unexpected extra state file must still be mirrored (mirror-everything rule).
  await writeFile(join(bookDir, "story", "state", "extra.bin"), "extra-bytes", "utf-8");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("buildSnapshotFileSet (single snapshot contract)", () => {
  it("exports the exact fixed 7-slot list", () => {
    expect([...SNAPSHOT_STORY_FILE_NAMES]).toEqual([
      "current_state.md", "particle_ledger.md", "pending_hooks.md",
      "chapter_summaries.md", "subplot_board.md", "emotional_arcs.md", "character_matrix.md",
    ]);
  });

  it("performs zero filesystem mutations", async () => {
    const snapDir = join(bookDir, "story", "snapshots");
    expect(existsSync(snapDir)).toBe(false);
    await buildSnapshotFileSet(bookDir, 5);
    expect(existsSync(snapDir)).toBe(false);
  });

  it("returns seeded slots plus every state file, skipping absent sources", async () => {
    const set = await buildSnapshotFileSet(bookDir, 5);
    const paths = set.map((w) => w.relativePath);

    expect(paths).toContain("story/snapshots/5/current_state.md");
    expect(paths).toContain("story/snapshots/5/pending_hooks.md");
    expect(paths).toContain("story/snapshots/5/chapter_summaries.md");
    expect(paths).toContain("story/snapshots/5/character_matrix.md");
    // Absent source slots skipped.
    expect(paths).not.toContain("story/snapshots/5/particle_ledger.md");
    expect(paths).not.toContain("story/snapshots/5/subplot_board.md");
    expect(paths).not.toContain("story/snapshots/5/emotional_arcs.md");
    // Every state file mirrored, including the unexpected extra.
    expect(paths).toContain("story/snapshots/5/state/manifest.json");
    expect(paths).toContain("story/snapshots/5/state/hooks.json");
    expect(paths).toContain("story/snapshots/5/state/extra.bin");

    const extraEntry = set.find((w) => w.relativePath.endsWith("extra.bin"))!;
    expect(extraEntry.content).toBe("extra-bytes");
  });

  it("is byte-for-byte at parity with StateManager.snapshotStateAt output", async () => {
    const manager = new StateManager(root);
    await manager.snapshotStateAt(bookDir, 8);

    const set = await buildSnapshotFileSet(bookDir, 8);
    const produced = new Map(set.map((w) => [w.relativePath, w.content]));

    const snapshotDir = join(bookDir, "story", "snapshots", "8");
    const onDisk = new Map<string, string>();
    async function walk(dir: string): Promise<void> {
      const { readdir } = await import("node:fs/promises");
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) await walk(p);
        else {
          const { readFile } = await import("node:fs/promises");
          onDisk.set(p.slice(bookDir.length + 1).replaceAll("\\", "/"), await readFile(p, "utf-8"));
        }
      }
    }
    await walk(snapshotDir);

    expect(onDisk.size).toBeGreaterThan(0);
    expect([...produced.keys()].sort()).toEqual([...onDisk.keys()].sort());
    for (const [rel, content] of produced) {
      expect(onDisk.get(rel), rel).toBe(content);
    }
  });

  it("completeness flag tracks the derivable contract", async () => {
    expect(await isSnapshotComplete(bookDir, 5)).toBe(false); // nothing written yet
    const manager = new StateManager(root);
    await manager.snapshotStateAt(bookDir, 5);
    expect(await isSnapshotComplete(bookDir, 5)).toBe(true);

    // Remove one mirrored state file ⇒ incomplete again.
    const { unlink } = await import("node:fs/promises");
    await unlink(join(bookDir, "story", "snapshots", "5", "state", "extra.bin"));
    expect(await isSnapshotComplete(bookDir, 5)).toBe(false);
  });

  it("treats a fully absent snapshot directory as incomplete", async () => {
    expect(await isSnapshotComplete(bookDir, 42)).toBe(false);
  });
});
