import { access, mkdir, readdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ChapterMeta } from "../models/chapter.js";
import { toPosixPath } from "../utils/posix-path.js";

export interface ChapterDeleteDeps {
  bookDir(bookId: string): string;
  loadChapterIndex(bookId: string): Promise<ReadonlyArray<ChapterMeta>>;
  rollbackToChapter(bookId: string, targetChapter: number): Promise<ReadonlyArray<number>>;
}

export interface DeleteLatestChapterOptions {
  /** Must equal the latest chapter number; defaults to it. Middle chapters are not deletable. */
  readonly chapterNumber?: number;
}

export interface DeleteLatestChapterResult {
  readonly bookId: string;
  readonly deletedChapter: number;
  readonly title: string;
  /** Book-relative POSIX paths of chapter files preserved under chapters/.trash/. */
  readonly trashedFiles: ReadonlyArray<string>;
  readonly rolledBackTo: number;
  readonly discarded: ReadonlyArray<number>;
}

/**
 * Delete the latest chapter of a book: the chapter markdown is preserved under
 * chapters/.trash/ (never hard-deleted), then the index, snapshots, runtime
 * artifacts, and story state are rolled back to the previous chapter via the
 * same rollback mechanism the review-reject flow uses.
 *
 * Only the latest chapter is deletable — removing a middle chapter would
 * require renumbering every later chapter and replaying state on top of it.
 */
export async function deleteLatestChapter(
  deps: ChapterDeleteDeps,
  bookId: string,
  options: DeleteLatestChapterOptions = {},
): Promise<DeleteLatestChapterResult> {
  const index = await deps.loadChapterIndex(bookId);
  if (index.length === 0) {
    throw new Error(`Book "${bookId}" has no chapters to delete.`);
  }

  const latest = index.reduce((max, chapter) => Math.max(max, chapter.number), 0);
  const requested = options.chapterNumber ?? latest;
  if (requested !== latest) {
    throw new Error(
      `Only the latest chapter (${latest}) can be deleted, but chapter ${requested} was requested. `
      + "Deleting a middle chapter would require renumbering later chapters and replaying state.",
    );
  }

  const bookDir = deps.bookDir(bookId);
  const rollbackTarget = latest - 1;

  // Verify the rollback snapshot is usable BEFORE touching any file, so a
  // failed restore cannot leave the book half-deleted.
  for (const required of ["current_state.md", "pending_hooks.md"]) {
    const snapshotFile = join(bookDir, "story", "snapshots", String(rollbackTarget), required);
    try {
      await stat(snapshotFile);
    } catch {
      throw new Error(
        `Cannot delete chapter ${latest}: the state snapshot for chapter ${rollbackTarget} is missing `
        + `(story/snapshots/${rollbackTarget}/${required}). Nothing was changed.`,
      );
    }
  }

  // Preserve the chapter markdown in chapters/.trash/ instead of hard-deleting.
  const chaptersDir = join(bookDir, "chapters");
  const trashDir = join(chaptersDir, ".trash");
  const chapterFiles = (await readdir(chaptersDir)).filter((file) => {
    const match = file.match(/^(\d+)[_-]?.*\.md$/);
    return match !== null && parseInt(match[1]!, 10) === latest;
  });

  const trashedFiles: string[] = [];
  if (chapterFiles.length > 0) {
    await mkdir(trashDir, { recursive: true });
  }
  for (const file of chapterFiles) {
    const trashedName = await pickAvailableName(trashDir, file);
    await rename(join(chaptersDir, file), join(trashDir, trashedName));
    trashedFiles.push(toPosixPath(join("chapters", ".trash", trashedName)));
  }

  const discarded = await deps.rollbackToChapter(bookId, rollbackTarget);
  const entry = index.find((chapter) => chapter.number === latest);

  return {
    bookId,
    deletedChapter: latest,
    title: entry?.title ?? `Chương ${latest}`,
    trashedFiles,
    rolledBackTo: rollbackTarget,
    discarded,
  };
}

async function pickAvailableName(dir: string, fileName: string): Promise<string> {
  const dot = fileName.lastIndexOf(".");
  const base = dot === -1 ? fileName : fileName.slice(0, dot);
  const ext = dot === -1 ? "" : fileName.slice(dot);
  let candidate = fileName;
  for (let suffix = 2; await pathExists(join(dir, candidate)); suffix += 1) {
    candidate = `${base}-${suffix}${ext}`;
  }
  return candidate;
}

async function pathExists(path: string): Promise<boolean> {
  return access(path).then(() => true).catch(() => false);
}
