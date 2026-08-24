import { readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { MemoryDB, type Fact } from "./memory-db.js";
import { loadNarrativeMemorySeed, loadSnapshotCurrentStateFacts } from "./runtime-state-store.js";
import { CurrentStateStateSchema } from "../models/runtime-state.js";

/**
 * P3A derived-memory synchronization (T3A.6/T3A.7/T3A.8).
 *
 * Extracted VERBATIM from `pipeline/runner.ts` internals so pipeline writes
 * and manual Canon commits share ONE implementation:
 * - SQLITE_BUSY/LOCKED retry ladder for narrative-memory access;
 * - snapshot-chain replay for current-state fact history;
 * - LIVE-TRUTH RECONCILIATION (T3A.7): open rows of live
 *   `story/state/current_state.json` are authoritative for the present — a
 *   rebuilt history always ends with the live interval anchored at the live
 *   row's own `validFromChapter`;
 * - failure invalidation (T3A.8): when reconciliation cannot run, the stale
 *   memory.db is removed or quarantined rather than left silently wrong.
 */

const MEMORY_INDEX_RETRY_DELAYS_MS = [0, 25, 75] as const;

function isMemoryIndexBusyError(error: unknown): boolean {
  if (!error) return false;

  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  const message = error instanceof Error
    ? error.message
    : String(error);

  return code === "SQLITE_BUSY"
    || code === "SQLITE_LOCKED"
    || /\bSQLITE_BUSY\b/i.test(message)
    || /\bSQLITE_LOCKED\b/i.test(message)
    || /database is locked/i.test(message)
    || /database is busy/i.test(message);
}

async function withMemoryIndexRetry<T>(operation: () => Promise<T> | T): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MEMORY_INDEX_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isMemoryIndexBusyError(error) || attempt === MEMORY_INDEX_RETRY_DELAYS_MS.length - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, MEMORY_INDEX_RETRY_DELAYS_MS[attempt + 1]!));
    }
  }

  throw lastError;
}

/** Stable fact identity inside the derived store (`subject::predicate`). */
export function factKey(fact: Pick<Fact, "subject" | "predicate">): string {
  return `${fact.subject}::${fact.predicate}`;
}

interface LiveOpenFact {
  readonly subject: string;
  readonly predicate: string;
  readonly object: string;
  readonly validFromChapter: number;
  readonly sourceChapter: number;
}

/**
 * Open rows of the LIVE current_state.json, keyed by factKey.
 *
 * Read failures yield an EMPTY map (never throws): a book without structured
 * state simply has no live truth to reconcile, matching the historical
 * replay-only behavior.
 */
async function loadLiveOpenFacts(bookDir: string): Promise<Map<string, LiveOpenFact>> {
  const result = new Map<string, LiveOpenFact>();
  try {
    const raw = JSON.parse(await readFile(join(bookDir, "story", "state", "current_state.json"), "utf-8"));
    const state = CurrentStateStateSchema.safeParse(raw);
    if (!state.success) return result;
    for (const fact of state.data.facts) {
      if (fact.validUntilChapter !== null) continue;
      result.set(factKey(fact), {
        subject: fact.subject,
        predicate: fact.predicate,
        object: fact.object,
        validFromChapter: fact.validFromChapter,
        sourceChapter: fact.sourceChapter,
      });
    }
  } catch {
    // No readable live state — nothing to reconcile.
  }
  return result;
}

/**
 * Rebuild the current-state FACT HISTORY by replaying chapter snapshots.
 *
 * Reconciliation (T3A.7): keys present as OPEN rows in live
 * current_state.json are managed by the live document at the final replayed
 * chapter — their snapshot entry there is skipped, and after the replay the
 * history is forced to end with the live row's OWN interval
 * `[live.validFromChapter, null]`, closing any conflicting replayed value at
 * that boundary (exclusive `valid_until_chapter`, per memory-db convention).
 * A healthy book whose snapshots agree with live truth reconciles to a no-op.
 */
export async function rebuildCurrentStateFactHistory(bookDir: string, uptoChapter: number): Promise<void> {
  const liveOpenFacts = await loadLiveOpenFacts(bookDir);

  const memoryDb = await withMemoryIndexRetry(async () => {
    const db = new MemoryDB(bookDir);
    try {
      db.resetFacts();

      const activeFacts = new Map<string, { id: number; fact: Omit<Fact, "id"> }>();

      for (let chapter = 0; chapter <= uptoChapter; chapter++) {
        const snapshotFacts = await loadSnapshotCurrentStateFacts(bookDir, chapter);
        if (snapshotFacts.length === 0) continue;
        const nextFacts = new Map<string, Omit<Fact, "id">>();
        // Keys whose final-chapter snapshot entry is withheld from replay —
        // their interval end/start is owned exclusively by the reconciliation
        // pass below and must not be touched by the chapter-removal logic.
        const reconciledKeys = new Set<string>();

        for (const fact of snapshotFacts) {
          const key = factKey(fact);
          // Live-truth keys at the final chapter are reconciled below instead
          // of being replay-attributed to that chapter.
          if (chapter === uptoChapter && liveOpenFacts.has(key)) {
            reconciledKeys.add(key);
            continue;
          }
          nextFacts.set(key, {
            subject: fact.subject,
            predicate: fact.predicate,
            object: fact.object,
            validFromChapter: chapter,
            validUntilChapter: null,
            sourceChapter: chapter,
          });
        }

        for (const [key, previous] of activeFacts.entries()) {
          if (reconciledKeys.has(key)) continue;
          const next = nextFacts.get(key);
          if (!next || next.object !== previous.fact.object) {
            db.invalidateFact(previous.id, chapter);
            activeFacts.delete(key);
          }
        }

        for (const [key, fact] of nextFacts.entries()) {
          if (activeFacts.has(key)) continue;
          const id = db.addFact(fact);
          activeFacts.set(key, { id, fact });
        }
      }

      // --- T3A.7 reconciliation pass -------------------------------------
      for (const [key, live] of liveOpenFacts.entries()) {
        const existing = activeFacts.get(key);
        const liveRow: Omit<Fact, "id"> = {
          subject: live.subject,
          predicate: live.predicate,
          object: live.object,
          validFromChapter: live.validFromChapter,
          validUntilChapter: null,
          sourceChapter: live.sourceChapter,
        };
        if (
          existing
          && existing.fact.object === live.object
          && existing.fact.validFromChapter === live.validFromChapter
        ) {
          continue; // healthy no-op
        }
        if (existing) {
          db.invalidateFact(existing.id, live.validFromChapter);
        }
        const id = db.addFact(liveRow);
        activeFacts.set(key, { id, fact: liveRow });
      }

      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  });

  try {
    // No-op: keep the db open only for the duration of the rebuild.
  } finally {
    memoryDb.close();
  }
}

/** Rebuild summaries + hooks in the narrative-memory index from live state. */
export async function rebuildNarrativeMemoryIndex(bookDir: string): Promise<void> {
  const memorySeed = await loadNarrativeMemorySeed(bookDir);

  const memoryDb = await withMemoryIndexRetry(() => {
    const db = new MemoryDB(bookDir);
    try {
      db.replaceSummaries(memorySeed.summaries);
      db.replaceHooks(memorySeed.hooks);
      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  });

  try {
    // No-op: keep the db open only for the duration of the rebuild.
  } finally {
    memoryDb.close();
  }
}

// --- T3A.8 derived-memory failure invalidation -------------------------------

export interface DerivedMemoryInvalidationIo {
  readonly rm: typeof rm;
  readonly rename: typeof rename;
}

export interface DerivedMemoryInvalidationResult {
  readonly invalidated: boolean;
  readonly strategy: "deleted" | "quarantined" | "failed";
  /** Present only when strategy === "failed"; exact string is part of the contract. */
  readonly warning?: string;
}

/**
 * Best-effort invalidation of a possibly-stale derived memory database.
 *
 * Order: delete the db trio; on failure quarantine-rename it; if even the
 * rename fails, report the exact honest warning string — the caller must not
 * claim freshness it cannot guarantee.
 */
export async function invalidateDerivedMemory(
  bookDir: string,
  io: DerivedMemoryInvalidationIo = { rm, rename },
): Promise<DerivedMemoryInvalidationResult> {
  const runtimeDir = join(bookDir, "story", "runtime");
  const dbFiles = ["memory.db", "memory.db-shm", "memory.db-wal"].map((name) => join(runtimeDir, name));

  try {
    for (const file of dbFiles) {
      await io.rm(file, { force: true });
    }
    return { invalidated: true, strategy: "deleted" };
  } catch {
    // fall through to quarantine
  }

  try {
    const stamp = Date.now();
    await io.rename(dbFiles[0]!, `${dbFiles[0]}.stale-${stamp}`);
    for (let i = 1; i < dbFiles.length; i += 1) {
      await io.rename(dbFiles[i]!, `${dbFiles[i]}.stale-${stamp}`).catch(() => undefined);
    }
    return { invalidated: true, strategy: "quarantined" };
  } catch {
    return {
      invalidated: false,
      strategy: "failed",
      warning: "derived memory invalidation failed; memory.db may be stale",
    };
  }
}
