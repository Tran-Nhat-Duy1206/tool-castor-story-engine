import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * P3A single snapshot contract (T3A.3).
 *
 * This module is the ONE maintained definition of what a chapter snapshot
 * contains. `StateManager.snapshotStateAt` delegates to it, and the Canon
 * commit engine (canon-service.ts) uses it for in-memory reconstruction —
 * the two can never drift apart.
 *
 * Contract (verbatim from the original snapshotStateAt implementation):
 * - a FIXED list of story markdown slots, copied when the live source exists
 *   and silently skipped when it does not (skip-if-source-missing);
 * - EVERY file currently under `story/state/` mirrored into the snapshot's
 *   `state/` subdirectory.
 *
 * PURE: this module only READS. It never writes, mkdirs or bootstraps.
 */

export const SNAPSHOT_STORY_FILE_NAMES = [
  "current_state.md",
  "particle_ledger.md",
  "pending_hooks.md",
  "chapter_summaries.md",
  "subplot_board.md",
  "emotional_arcs.md",
  "character_matrix.md",
] as const;

export interface SnapshotFileWrite {
  readonly relativePath: string;
  readonly content: string;
}

/**
 * Compute the complete intended contents of `story/snapshots/<chapterNumber>/`
 * from the CURRENT live project state, without writing anything.
 */
export async function buildSnapshotFileSet(
  bookDir: string,
  chapterNumber: number,
): Promise<SnapshotFileWrite[]> {
  const storyDir = join(bookDir, "story");
  const prefix = `story/snapshots/${chapterNumber}`;
  const writes: SnapshotFileWrite[] = [];

  for (const name of SNAPSHOT_STORY_FILE_NAMES) {
    try {
      const content = await readFile(join(storyDir, name), "utf-8");
      writes.push({ relativePath: `${prefix}/${name}`, content });
    } catch {
      // Source slot absent — skipped, matching the historical contract.
    }
  }

  const stateDir = join(storyDir, "state");
  let stateEntries: string[] = [];
  try {
    stateEntries = await readdir(stateDir);
  } catch {
    // state directory missing — nothing to mirror (historical contract).
  }
  for (const entry of stateEntries) {
    const source = join(stateDir, entry);
    try {
      const info = await stat(source);
      if (!info.isFile()) continue;
      writes.push({ relativePath: `${prefix}/state/${entry}`, content: await readFile(source, "utf-8") });
    } catch {
      // Vanished between readdir and read — skip.
    }
  }

  return writes;
}

/**
 * True when `story/snapshots/<chapterNumber>/` already contains every file the
 * contract derives from the current live project state.
 */
export async function isSnapshotComplete(
  bookDir: string,
  chapterNumber: number,
): Promise<boolean> {
  const required = await buildSnapshotFileSet(bookDir, chapterNumber);
  if (required.length === 0) return false;
  for (const write of required) {
    try {
      const info = await stat(join(bookDir, write.relativePath));
      if (!info.isFile()) return false;
    } catch {
      return false;
    }
  }
  return true;
}
