import { z } from "zod";
import { readFile, writeFile, mkdir, rm, rename, access } from "node:fs/promises";
import { dirname, join, normalize, isAbsolute, sep, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { StateManager } from "../state/manager.js";
import type { AtomicFileWrite } from "../utils/atomic-file-set.js";

// ===========================================================================
// Phase 5 Task 9 — TransactionCoordinator
//
// Authoritative single transaction coordinator over atomic-file-set with:
// - Full Castor book lock integration (StateManager.acquireBookLock)
// - Inside-lock revalidation (no check-then-lock-then-commit)
// - Structured transaction stages: prepare -> validate -> stage -> journal -> commit -> materialize -> finalize
// - Durable multi-file journal for deterministic crash recovery
// - Guaranteed whole authority transition: old authority intact OR fully committed new authority
// ===========================================================================

export type TransactionStage =
  | "prepare"
  | "validate"
  | "stage"
  | "journal"
  | "commit"
  | "materialize"
  | "finalize";

export interface TransactionInput {
  readonly bookDir: string;
  readonly writes: ReadonlyArray<AtomicFileWrite>;
  readonly deletes?: ReadonlyArray<string>;
  readonly revalidate: () => Promise<ReadonlyArray<string>>;
  readonly failAtStage?: TransactionStage;
}

export type TransactionResult =
  | { status: "committed" }
  | { status: "revision_base_stale"; reasons: ReadonlyArray<string> };

const JournalItemSchema = z.object({
  relativePath: z.string(),
  stagedPath: z.string(),
  targetPath: z.string(),
  backupPath: z.string().optional(),
});

export const TransactionJournalSchema = z.object({
  txId: z.string(),
  bookDir: z.string(),
  stage: z.enum(["staged", "committed"]),
  stagingDir: z.string(),
  backupDir: z.string(),
  writes: z.array(JournalItemSchema),
  deletes: z.array(z.string()),
  createdAt: z.string(),
  committedAt: z.string().optional(),
}).strict();
export type TransactionJournal = z.infer<typeof TransactionJournalSchema>;

function safeRelativePath(relativePath: string): string {
  const normalized = normalize(relativePath);
  if (
    !relativePath.trim()
    || isAbsolute(relativePath)
    || normalized === ".."
    || normalized.startsWith(`..${sep}`)
  ) {
    throw new Error(`Atomic file path must stay inside rootDir: ${relativePath}`);
  }
  return normalized;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function journalPath(bookDir: string): string {
  return join(bookDir, "story", "governance", ".tx-journal.json");
}

export async function recoverTransaction(bookDir: string): Promise<void> {
  const jPath = journalPath(bookDir);
  let raw: string;
  try {
    raw = await readFile(jPath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  let journal: TransactionJournal;
  try {
    journal = TransactionJournalSchema.parse(JSON.parse(raw));
  } catch {
    // Corrupt journal: clean up to avoid blocking future operations
    await rm(jPath, { force: true });
    return;
  }

  if (journal.stage === "staged") {
    // Roll back to old authority
    for (const item of journal.writes) {
      if (item.backupPath && (await fileExists(item.backupPath))) {
        await mkdir(dirname(item.targetPath), { recursive: true });
        await rename(item.backupPath, item.targetPath);
      }
    }
    await rm(journal.stagingDir, { recursive: true, force: true }).catch(() => undefined);
    await rm(journal.backupDir, { recursive: true, force: true }).catch(() => undefined);
    await rm(jPath, { force: true });
  } else if (journal.stage === "committed") {
    // Roll forward to new authority
    for (const item of journal.writes) {
      if (await fileExists(item.stagedPath)) {
        await mkdir(dirname(item.targetPath), { recursive: true });
        await rename(item.stagedPath, item.targetPath);
      }
    }
    for (const delRel of journal.deletes) {
      const target = join(journal.bookDir, delRel);
      await rm(target, { recursive: true, force: true }).catch(() => undefined);
    }
    await rm(journal.stagingDir, { recursive: true, force: true }).catch(() => undefined);
    await rm(journal.backupDir, { recursive: true, force: true }).catch(() => undefined);
    await rm(jPath, { force: true });
  }
}

export async function runTransaction(input: TransactionInput): Promise<TransactionResult> {
  const { bookDir } = input;
  const writes = input.writes.map((w) => ({
    ...w,
    relativePath: safeRelativePath(w.relativePath),
  }));
  const deletes = (input.deletes ?? []).map(safeRelativePath);

  // Stage 1: prepare
  if (input.failAtStage === "prepare") {
    throw new Error("Injected fault at stage: prepare");
  }

  const projectRoot = dirname(bookDir);
  const bookId = basename(bookDir);
  const manager = new StateManager(projectRoot);

  // GLOBAL BOOK LOCK CONTRACT: acquire book lock first
  let releaseLock: (() => Promise<void>) | null = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      releaseLock = await manager.acquireBookLock(bookId);
      break;
    } catch (error) {
      if ((error as any).code === "BOOK_BUSY" && attempt < 7) {
        await new Promise((r) => setTimeout(r, 60));
        continue;
      }
      if ((error as any).code === "BOOK_BUSY") {
        return { status: "revision_base_stale", reasons: [(error as Error).message] };
      }
      throw error;
    }
  }

  if (!releaseLock) {
    return { status: "revision_base_stale", reasons: ["Could not acquire book lock"] };
  }

  try {
    // Check and recover any pending interrupted transaction under lock
    await recoverTransaction(bookDir);

    // Stage 2: validate / revalidate inside lock
    const failureReasons = await input.revalidate();
    if (failureReasons.length > 0) {
      return { status: "revision_base_stale", reasons: failureReasons };
    }

    if (input.failAtStage === "validate") {
      throw new Error("Injected fault at stage: validate");
    }

    // Stage 3: stage
    const txId = randomUUID();
    const stagingDir = join(bookDir, `.castor-tx-staging-${txId}`);
    const backupDir = join(bookDir, `.castor-tx-backup-${txId}`);

    await mkdir(stagingDir, { recursive: true });
    await mkdir(backupDir, { recursive: true });

    const journalWrites: Array<z.infer<typeof JournalItemSchema>> = [];

    for (const w of writes) {
      const stagedPath = join(stagingDir, w.relativePath);
      const targetPath = join(bookDir, w.relativePath);
      const backupPath = join(backupDir, w.relativePath);

      await mkdir(dirname(stagedPath), { recursive: true });
      await writeFile(stagedPath, w.content);

      journalWrites.push({
        relativePath: w.relativePath,
        stagedPath,
        targetPath,
        backupPath,
      });
    }

    if (input.failAtStage === "stage") {
      await rm(stagingDir, { recursive: true, force: true });
      await rm(backupDir, { recursive: true, force: true });
      throw new Error("Injected fault at stage: stage");
    }

    // Stage 4: journal (pre-commit)
    const journal: TransactionJournal = {
      txId,
      bookDir,
      stage: "staged",
      stagingDir,
      backupDir,
      writes: journalWrites,
      deletes,
      createdAt: new Date().toISOString(),
    };

    const jPath = journalPath(bookDir);
    await mkdir(dirname(jPath), { recursive: true });
    await writeFile(jPath, `${JSON.stringify(journal, null, 2)}\n`, "utf-8");

    if (input.failAtStage === "journal") {
      await rm(stagingDir, { recursive: true, force: true });
      await rm(backupDir, { recursive: true, force: true });
      await rm(jPath, { force: true });
      throw new Error("Injected fault at stage: journal");
    }

    // Stage 5: commit
    // Move existing targets to backup
    for (const item of journalWrites) {
      if (await fileExists(item.targetPath)) {
        await mkdir(dirname(item.backupPath!), { recursive: true });
        await rename(item.targetPath, item.backupPath!);
      }
    }

    for (const delRel of deletes) {
      const target = join(bookDir, delRel);
      const backup = join(backupDir, delRel);
      if (await fileExists(target)) {
        await mkdir(dirname(backup), { recursive: true });
        await rename(target, backup);
      }
    }

    // Move staged files to targets
    for (const item of journalWrites) {
      await mkdir(dirname(item.targetPath), { recursive: true });
      await rename(item.stagedPath, item.targetPath);
    }

    // Mark journal committed — AT THIS MOMENT, NEW AUTHORITY IS COMMITTED!
    journal.stage = "committed";
    journal.committedAt = new Date().toISOString();
    await writeFile(jPath, `${JSON.stringify(journal, null, 2)}\n`, "utf-8");

    if (input.failAtStage === "commit") {
      throw new Error("Injected fault at stage: commit");
    }

    // Stage 6: materialize (verification)
    for (const item of journalWrites) {
      if (!(await fileExists(item.targetPath))) {
        throw new Error(`Materialization verification failed for ${item.relativePath}`);
      }
    }

    if (input.failAtStage === "materialize") {
      throw new Error("Injected fault at stage: materialize");
    }

    // Stage 7: finalize
    await rm(stagingDir, { recursive: true, force: true });
    await rm(backupDir, { recursive: true, force: true });
    await rm(jPath, { force: true });

    if (input.failAtStage === "finalize") {
      throw new Error("Injected fault at stage: finalize");
    }

    return { status: "committed" };
  } finally {
    // GLOBAL BOOK LOCK CONTRACT: release lock in finally
    await releaseLock();
  }
}