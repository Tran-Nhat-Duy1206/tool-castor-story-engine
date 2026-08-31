import { access, cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

export interface BookBackupInfo {
  readonly id: string;
  readonly createdAt: string;
}

export interface CreateBookBackupOptions {
  /** Injectable clock so tests do not depend on real time. */
  readonly now?: () => Date;
  /** Appended to the backup id, e.g. "pre-restore". */
  readonly suffix?: string;
}

export interface CreateBookBackupResult {
  readonly bookId: string;
  readonly backupId: string;
  readonly path: string;
}

export interface RestoreBookBackupOptions {
  readonly now?: () => Date;
}

export interface RestoreBookBackupResult {
  readonly bookId: string;
  readonly restoredFrom: string;
  /** Auto-backup of the pre-restore state; null when the book directory did not exist. */
  readonly preRestoreBackupId: string | null;
}

/**
 * Whole-book backups live OUTSIDE books/ (at .castor/backups/<bookId>/<backupId>/),
 * so a backup never recursively contains other backups.
 */
export function bookBackupsDir(root: string, bookId: string): string {
  return join(root, ".castor", "backups", bookId);
}

export async function createBookBackup(
  root: string,
  bookId: string,
  options: CreateBookBackupOptions = {},
): Promise<CreateBookBackupResult> {
  const bookDir = join(root, "books", bookId);
  const bookInfo = await stat(bookDir).catch(() => null);
  if (!bookInfo?.isDirectory()) {
    throw new Error(`Book "${bookId}" not found at books/${bookId}/.`);
  }

  const backupsDir = bookBackupsDir(root, bookId);
  await mkdir(backupsDir, { recursive: true });

  const clock = options.now ?? (() => new Date());
  const base = options.suffix ? `${formatStamp(clock())}-${options.suffix}` : formatStamp(clock());
  let backupId = base;
  for (let attempt = 2; await pathExists(join(backupsDir, backupId)); attempt += 1) {
    backupId = `${base}-${attempt}`;
  }

  const backupPath = join(backupsDir, backupId);
  await cp(bookDir, backupPath, { recursive: true });
  return { bookId, backupId, path: backupPath };
}

export async function listBookBackups(
  root: string,
  bookId: string,
): Promise<ReadonlyArray<BookBackupInfo>> {
  async function listDir(dir: string): Promise<BookBackupInfo[]> {
    const entries = await readdir(dir, { withFileTypes: true }).catch((error) => {
      if ((error as { code?: unknown }).code === "ENOENT") {
        return [];
      }
      throw error;
    });
    return Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const info = await stat(join(dir, entry.name));
          return { id: entry.name, createdAt: info.mtime.toISOString() };
        }),
    );
  }

  // Canonical backups plus a read-only view of pre-rename legacy backups.
  const backups = [
    ...(await listDir(bookBackupsDir(root, bookId))),
    ...(await listDir(join(root, ".castor", "backups", bookId))),
  ];
  // Dedupe by id (canonical and legacy point to same dir after rename)
  const deduped = [...new Map(backups.map((b) => [b.id, b])).values()];
  // Backup ids start with a UTC timestamp, so a descending id sort is newest-first.
  return deduped.sort((a, b) => b.id.localeCompare(a.id));
}

export async function restoreBookBackup(
  root: string,
  bookId: string,
  backupId: string,
  options: RestoreBookBackupOptions = {},
): Promise<RestoreBookBackupResult> {
  // backupId comes from CLI input and is joined into a path — keep it a single
  // safe path component.
  if (!/^[A-Za-z0-9._-]+$/.test(backupId) || backupId === "." || backupId === "..") {
    throw new Error(`Invalid backup id "${backupId}": a backup id must be a single directory name.`);
  }

  const backupPath = join(bookBackupsDir(root, bookId), backupId);
  const backupInfo = await stat(backupPath).catch(() => null);
  // Legacy backups created before the Castor rename remain restorable in place
  // (read-only compatibility; they are never copied or rewritten).
  let resolvedBackupPath = backupPath;
  if (!backupInfo?.isDirectory()) {
    const legacyBackupPath = join(root, ".castor", "backups", bookId, backupId);
    const legacyBackupInfo = await stat(legacyBackupPath).catch(() => null);
    if (legacyBackupInfo?.isDirectory()) {
      resolvedBackupPath = legacyBackupPath;
    } else {
      throw new Error(
        `Backup "${backupId}" not found for book "${bookId}". `
        + `List available backups with: castor book backup ${bookId} --list`,
      );
    }
  }

  const bookDir = join(root, "books", bookId);
  const bookExists = await stat(bookDir).then((info) => info.isDirectory()).catch(() => false);
  let preRestoreBackupId: string | null = null;
  if (bookExists) {
    const preRestore = await createBookBackup(root, bookId, { now: options.now, suffix: "pre-restore" });
    preRestoreBackupId = preRestore.backupId;
  }

  await rm(bookDir, { recursive: true, force: true });
  await cp(resolvedBackupPath, bookDir, { recursive: true });

  return { bookId, restoredFrom: backupId, preRestoreBackupId };
}

function formatStamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
}

async function pathExists(path: string): Promise<boolean> {
  return access(path).then(() => true).catch(() => false);
}
