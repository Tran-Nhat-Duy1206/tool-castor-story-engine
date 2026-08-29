import { Command } from "commander";
import { createInterface } from "node:readline";
import { deleteLatestChapter, StateManager, syncChapterWordCounts } from "@actalk/castor-core";
import {
  formatChapterDeleteCancelled,
  formatChapterDeleteConfirm,
  formatChapterDeleteDone,
  formatChapterSyncChange,
  formatChapterSyncMissingFiles,
  formatChapterSyncNoChanges,
  formatChapterSyncSummary,
  resolveCliLanguage,
} from "../localization.js";
import { findProjectRoot, log, logError, resolveBookId } from "../utils.js";

export const chapterCommand = new Command("chapter")
  .description("Manage chapters");

chapterCommand
  .command("sync")
  .description("Recount chapter word counts from chapter files and update chapters/index.json")
  .argument("[book-id]", "Book ID (auto-detected if only one book)")
  .option("--json", "Output JSON")
  .action(async (bookIdArg: string | undefined, opts) => {
    try {
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const state = new StateManager(root);
      const book = await state.loadBookConfig(bookId);
      const language = resolveCliLanguage(book.language);

      const result = await syncChapterWordCounts(state, bookId);

      if (opts.json) {
        log(JSON.stringify(result, null, 2));
        return;
      }

      if (result.changes.length === 0) {
        log(formatChapterSyncNoChanges(language, result.checkedChapters));
      } else {
        for (const change of result.changes) {
          log(formatChapterSyncChange(language, change, result.countingMode));
        }
        log(formatChapterSyncSummary(language, result.changes.length, result.checkedChapters));
      }
      if (result.missingChapterFiles.length > 0) {
        log(formatChapterSyncMissingFiles(language, result.missingChapterFiles));
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to sync chapter word counts: ${e}`);
      }
      process.exit(1);
    }
  });

chapterCommand
  .command("delete")
  .description("Delete the latest chapter: move its file to chapters/.trash/ and roll the index and story state back")
  .argument("<book-id>", "Book ID")
  .option("--chapter <n>", "Chapter number to delete (must be the latest chapter; defaults to it)")
  .option("--force", "Skip confirmation prompt")
  .option("--json", "Output JSON")
  .action(async (bookIdArg: string, opts) => {
    try {
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const state = new StateManager(root);
      const book = await state.loadBookConfig(bookId);
      const language = resolveCliLanguage(book.language);
      const requestedChapter = opts.chapter === undefined ? undefined : parseInt(opts.chapter, 10);

      if (!opts.force) {
        const index = await state.loadChapterIndex(bookId);
        const latest = index.reduce((max, chapter) => Math.max(max, chapter.number), 0);
        const target = requestedChapter ?? latest;
        const title = index.find((chapter) => chapter.number === target)?.title ?? "";
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>((resolve) => {
          rl.question(
            formatChapterDeleteConfirm(language, { bookTitle: book.title, bookId, number: target, title }),
            resolve,
          );
        });
        rl.close();
        if (answer.toLowerCase() !== "y") {
          log(formatChapterDeleteCancelled(language));
          return;
        }
      }

      const result = await deleteLatestChapter(state, bookId, {
        ...(requestedChapter === undefined ? {} : { chapterNumber: requestedChapter }),
      });

      if (opts.json) {
        log(JSON.stringify(result, null, 2));
      } else {
        log(formatChapterDeleteDone(language, {
          number: result.deletedChapter,
          title: result.title,
          trashedFiles: result.trashedFiles,
          rolledBackTo: result.rolledBackTo,
        }));
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to delete chapter: ${e}`);
      }
      process.exit(1);
    }
  });
