import { Command } from "commander";
import { PipelineRunner, StateManager } from "@actalk/castor-core";
import { loadConfig, buildPipelineConfig, findProjectRoot, resolveBookId, log, logError } from "../utils.js";
import {
  formatNotifyAuditBody,
  formatNotifyCommandTitle,
  formatNotifyFailureBody,
  resolveCliLanguage,
  type CliLanguage,
} from "../localization.js";
import { sendCommandNotification } from "../notify-helper.js";

export const auditCommand = new Command("audit")
  .description("Audit a chapter for continuity issues")
  .argument("[book-id]", "Book ID (auto-detected if only one book)")
  .argument("[chapter]", "Chapter number (defaults to latest)")
  .option("--json", "Output JSON")
  .option("--notify", "Send a notification to configured notify channels when the command finishes")
  .action(async (bookIdArg: string | undefined, chapterStr: string | undefined, opts) => {
    let notifyLanguage: CliLanguage = "vi";
    let notifyBookName: string | undefined;
    try {
      const config = await loadConfig();
      const root = findProjectRoot();

      // If first arg looks like a number, treat it as chapter (auto-detect book)
      let bookId: string;
      let chapterNumber: number | undefined;
      if (bookIdArg && /^\d+$/.test(bookIdArg)) {
        bookId = await resolveBookId(undefined, root);
        chapterNumber = parseInt(bookIdArg, 10);
      } else {
        bookId = await resolveBookId(bookIdArg, root);
        chapterNumber = chapterStr ? parseInt(chapterStr, 10) : undefined;
      }

      const state = new StateManager(root);
      const book = await state.loadBookConfig(bookId);
      const language = resolveCliLanguage(book.language);
      notifyLanguage = language;
      notifyBookName = book.title ?? bookId;

      const pipeline = new PipelineRunner(buildPipelineConfig(config, root));

      if (!opts.json) log(`Auditing "${bookId}"${chapterNumber ? ` chapter ${chapterNumber}` : " (latest)"}...`);

      const result = await pipeline.auditDraft(bookId, chapterNumber);

      if (opts.json) {
        log(JSON.stringify(result, null, 2));
      } else {
        log(`  Chapter ${result.chapterNumber}: ${result.passed ? "PASSED" : "FAILED"}`);
        log(`  Summary: ${result.summary}`);
        if (result.issues.length > 0) {
          log("  Issues:");
          for (const issue of result.issues) {
            log(`    [${issue.severity}] ${issue.category}: ${issue.description}`);
          }
        }
      }

      // Unlike write commands, the pipeline sends no notification for
      // auditDraft, so --notify always sends the completion notification here.
      if (opts.notify) {
        await sendCommandNotification({
          title: formatNotifyCommandTitle(language, "audit", notifyBookName, true),
          body: formatNotifyAuditBody(language, {
            chapterNumber: result.chapterNumber,
            passed: result.passed,
            issueCount: result.issues.length,
            summary: result.summary,
          }),
        }, config);
      }
    } catch (e) {
      if (opts.notify) {
        await sendCommandNotification({
          title: formatNotifyCommandTitle(notifyLanguage, "audit", notifyBookName, false),
          body: formatNotifyFailureBody(notifyLanguage, e),
        });
      }
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Audit failed: ${e}`);
      }
      process.exit(1);
    }
  });
