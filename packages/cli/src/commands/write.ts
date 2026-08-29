import { Command } from "commander";
import { PipelineRunner, StateManager, resolveChapterReviewMode } from "@actalk/castor-core";
import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { loadConfig, buildPipelineConfig, findProjectRoot, getLegacyMigrationHint, resolveContext, resolveBookId, log, logError } from "../utils.js";
import {
  formatNotifyBatchWriteBody,
  formatNotifyCommandTitle,
  formatNotifyFailureBody,
  formatWriteNextComplete,
  formatWriteNextProgress,
  formatWriteNextResultLines,
  resolveCliLanguage,
  type CliLanguage,
} from "../localization.js";
import { sendCommandNotification } from "../notify-helper.js";

export const writeCommand = new Command("write")
  .description("Write chapters");

writeCommand
  .command("next")
  .description("Write the next chapter for a book")
  .argument("[book-id]", "Book ID (auto-detected if only one book)")
  .option("--count <n>", "Number of chapters to write", "1")
  .option("--words <n>", "Words per chapter (overrides book config)")
  .option("--context <text>", "Creative guidance (natural language)")
  .option("--context-file <path>", "Read guidance from file")
  .option("--json", "Output JSON")
  .option("-q, --quiet", "Suppress console output")
  .option("--notify", "Send a notification to configured notify channels when the command finishes")
  .action(async (bookIdArg: string | undefined, opts, command) => {
    // Reject bypass flags that must never exist for governance (Task 24)
    const bypassFlags = ["--force", "--ignore-canon", "--skip-authority", "--bypass-gate", "--no-verify", "--write-anyway", "--unsafe", "--skip-gate", "--ignore-conflict", "--bypass-planning"];
    const rawArgs: string[] = [
      ...process.argv.slice(2),
      String(bookIdArg ?? ""),
      ...(Array.isArray((command as any)?.args) ? (command as any).args as string[] : []),
      ...Object.keys(opts ?? {}).map((k) => `--${k}`),
    ];
    for (const f of bypassFlags) {
      if (rawArgs.includes(f) || String(bookIdArg) === f) {
        logError(`Unknown option ${f}`);
        process.exit(1);
        return;
      }
    }
    if (bookIdArg && String(bookIdArg).startsWith("-")) {
      logError(`Unknown option ${bookIdArg}`);
      process.exit(1);
      return;
    }
    let notifyLanguage: CliLanguage = "vi";
    let notifyBookName: string | undefined;
    try {
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      // Pre-check Planning Gate (Task 16) before invoking Writer — CONFLICT/AUTHOR_DECISION/UNCERTAIN must not call writeNextChapter
      try {
        const { getPlanningGateReport } = await import("@actalk/castor-core") as unknown as { getPlanningGateReport?: (p: unknown) => Promise<unknown> };
        if (getPlanningGateReport) {
          const gate: any = await getPlanningGateReport({ bookId, bookDir: new StateManager(root).bookDir(bookId) }).catch(() => null);
          const verdict = String(gate?.verdict ?? gate?.outcome ?? "").toUpperCase();
          if (verdict === "CONFLICT" || verdict === "AUTHOR_DECISION" || verdict === "UNCERTAIN") {
            const msg = verdict === "CONFLICT" ? "Gate CONFLICT — writing blocked. Open Studio to resolve." : verdict === "AUTHOR_DECISION" ? "Gate AUTHOR_DECISION — Human authorization required. Open Studio." : "Gate UNCERTAIN — Human input required. Open Studio.";
            if (opts.json) log(JSON.stringify({ error: msg, blocked: true, verdict }, null, 2));
            else logError(msg);
            process.exit(1);
            return;
          }
        }
      } catch { /* gate check is best-effort; Core will still enforce */ }
      const context = await resolveContext(opts);
      const state = new StateManager(root);
      const book = await state.loadBookConfig(bookId);
      const language = resolveCliLanguage(book.language);
      notifyLanguage = language;
      notifyBookName = book.title ?? bookId;
      const migrationHint = await getLegacyMigrationHint(root, bookId);
      if (migrationHint && !opts.json) {
        log(`[migration] ${migrationHint}`);
      }
      const config = await loadConfig();

      const pipeline = new PipelineRunner(buildPipelineConfig(config, root, {
        externalContext: context,
        quiet: opts.quiet,
        chapterReviewMode: resolveChapterReviewMode(book, config.writing),
      }));

      const count = parseInt(opts.count, 10);
      const wordCount = opts.words ? parseInt(opts.words, 10) : undefined;

      const results: Awaited<ReturnType<PipelineRunner["writeNextChapter"]>>[] = [];
      let blockedError: unknown = null;
      for (let i = 0; i < count; i++) {
        if (!opts.json) log(formatWriteNextProgress(language, i + 1, count, bookId));

        // Core-owned governance gate: MUST call the same PipelineRunner.writeNextChapter (Task 19).
        // Writer invocation is gated inside Core (Planning Gate SAFE, Context Bundle, Snapshot).
        // CLI does not duplicate governance logic and does not add bypass flags.
        let result: Awaited<ReturnType<PipelineRunner["writeNextChapter"]>> | null = null;
        try {
          result = await pipeline.writeNextChapter(bookId, wordCount);
        } catch (err) {
          const msg = String(err);
          const lower = msg.toLowerCase();
          const isGateBlocked = /planning gate blocked/i.test(msg) || lower.includes('outcome="conflict"') || lower.includes("outcome='conflict'") || msg.includes("CONFLICT") || msg.includes("AUTHOR_DECISION") || msg.includes("UNCERTAIN") || lower.includes('outcome="author_decision"') || lower.includes('outcome="uncertain"') || lower.includes("invalid governance state") || lower.includes("transition state");
          const isContextBudget = lower.includes("contextbundle") || lower.includes("is stale") || lower.includes("context_budget") || lower.includes("budget") && lower.includes("exceeded") || lower.includes("execution snapshot") || lower.includes("freeze") || lower.includes("stale") && lower.includes("bundle");
          const isPlanDefect = lower.includes("plan defect") || lower.includes("exhausted maximum 2 automatic replans") || lower.includes("human intervention required") && lower.includes("plan");
          const isLegacyMatrix = lower.includes("cannot use planning v2 with legacy foundation") || lower.includes("foundation v2 but planning legacy");
          // Legacy/v2 matrix is also a Core outcome — just surface it, no CLI recalculation.
          if (opts.json) {
            log(JSON.stringify({ error: msg, blocked: true, outcome: isGateBlocked ? "blocked" : undefined }, null, 2));
          } else {
            logError(msg);
            if (isGateBlocked || isLegacyMatrix) {
              log(`  Gate blocked — no prose was written.`);
              log(`  Open Studio to resolve Foundation / Planning blockers (CONFLICT / AUTHOR_DECISION / UNCERTAIN).`);
            } else if (isContextBudget) {
              log(`  Context/budget/prepare failure — no prose was written.`);
              log(`  Open Studio to resolve.`);
            } else if (isPlanDefect) {
              log(`  Plan defect (Core already attempted initial + 2 replans) — no prose written.`);
              log(`  Open Studio to review/repair plan.`);
            } else if (lower.includes("blocked") || lower.includes("not ready") || lower.includes("not approved") || lower.includes("protagonist")) {
              log(`  Blocked — no prose was written.`);
              log(`  Open Studio to resolve.`);
            } else {
              log(`  No prose was written. Open Studio to resolve.`);
            }
          }
          blockedError = err;
          break;
        }

        if (!result) break;
        results.push(result);

        if (!opts.json) {
          for (const line of formatWriteNextResultLines(language, {
            chapterNumber: result.chapterNumber,
            title: result.title,
            wordCount: result.wordCount,
            auditPassed: result.auditResult.passed,
            revised: result.revised,
            status: result.status,
            issues: result.auditResult.issues,
          })) {
            log(line);
          }
          log("");
        }

        if (result.status === "state-degraded") {
          if (!opts.json) {
            log(language === "en"
              ? "State repair required before continuing. Stopping batch."
              : "Cần sửa lại state trước khi tiếp tục, đã dừng viết hàng loạt các chương sau.");
          }
          break;
        }
      }

      if (blockedError) {
        if (opts.notify) {
          await sendCommandNotification({
            title: formatNotifyCommandTitle(notifyLanguage, "write-next", notifyBookName, false),
            body: formatNotifyFailureBody(notifyLanguage, blockedError),
          }, config);
        }
        // Ensure non-zero exit, no prose side-effect already guaranteed by Core gate.
        process.exit(1);
      }

      if (opts.json) {
        log(JSON.stringify(results, null, 2));
      } else {
        log(formatWriteNextComplete(language));
      }

      // The pipeline itself already sends one notification per completed
      // chapter whenever notify channels are configured (runner.ts, end of
      // writeNextChapter). A single-chapter run would therefore duplicate that
      // exact notification — only send a command-level batch summary when this
      // run wrote more than one chapter.
      if (opts.notify && results.length > 1) {
        await sendCommandNotification({
          title: formatNotifyCommandTitle(language, "write-next", notifyBookName, true),
          body: formatNotifyBatchWriteBody(language, results.map((r) => ({
            chapterNumber: r.chapterNumber,
            title: r.title,
            wordCount: r.wordCount,
            auditPassed: r.auditResult.passed,
          }))),
        }, config);
      }
    } catch (e) {
      if (opts.notify) {
        await sendCommandNotification({
          title: formatNotifyCommandTitle(notifyLanguage, "write-next", notifyBookName, false),
          body: formatNotifyFailureBody(notifyLanguage, e),
        });
      }
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to write chapter: ${e}`);
      }
      process.exit(1);
    }
  });

writeCommand
  .command("rewrite")
  .description("Re-generate a specific chapter: rewrite [book-id] <chapter>")
  .argument("<args...>", "Book ID (optional) and chapter number")
  .option("--force", "Skip confirmation prompt")
  .option("--words <n>", "Words per chapter (overrides book config)")
  .option("--brief <text>", "One-off creative guidance for this rewrite only")
  .option("--json", "Output JSON")
  .option("--notify", "Send a notification to configured notify channels when the command finishes")
  .action(async (args: ReadonlyArray<string>, opts) => {
    let notifyLanguage: CliLanguage = "vi";
    let notifyBookName: string | undefined;
    try {
      const root = findProjectRoot();

      let bookId: string;
      let chapter: number;
      if (args.length === 1) {
        chapter = parseInt(args[0]!, 10);
        if (isNaN(chapter)) throw new Error(`Expected chapter number, got "${args[0]}"`);
        bookId = await resolveBookId(undefined, root);
      } else if (args.length === 2) {
        chapter = parseInt(args[1]!, 10);
        if (isNaN(chapter)) throw new Error(`Expected chapter number, got "${args[1]}"`);
        bookId = await resolveBookId(args[0], root);
      } else {
        throw new Error("Usage: castor write rewrite [book-id] <chapter>");
      }

      if (!opts.force) {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>((resolve) => {
          rl.question(`Rewrite chapter ${chapter} of "${bookId}"? This will delete chapter ${chapter} and all later chapters. (y/N) `, resolve);
        });
        rl.close();
        if (answer.toLowerCase() !== "y") {
          log("Cancelled.");
          return;
        }
      }

      const state = new StateManager(root);
      const book = await state.loadBookConfig(bookId);
      notifyLanguage = resolveCliLanguage(book.language);
      notifyBookName = book.title ?? bookId;
      const bookDir = state.bookDir(bookId);
      const chaptersDir = join(bookDir, "chapters");
      const restoreFrom = chapter - 1;
      const restoreSnapshotDir = join(bookDir, "story", "snapshots", String(restoreFrom));
      await stat(restoreSnapshotDir).catch(() => {
        throw new Error(`Cannot rewrite chapter ${chapter}: missing snapshot for chapter ${restoreFrom}`);
      });
      const migrationHint = await getLegacyMigrationHint(root, bookId);
      if (migrationHint && !opts.json) {
        log(`[migration] ${migrationHint}`);
      }

      // Remove existing chapter file
      const files = await readdir(chaptersDir);
      const paddedNum = String(chapter).padStart(4, "0");
      const existing = files.filter((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
      for (const f of existing) {
        await unlink(join(chaptersDir, f));
        if (!opts.json) log(`Removed: ${f}`);
      }

      // Remove from index (and all chapters after it)
      const index = await state.loadChapterIndex(bookId);
      const trimmed = index.filter((ch) => ch.number < chapter);
      await state.saveChapterIndex(bookId, trimmed);

      // Also remove later chapter files since state will be rolled back
      const laterFiles = files.filter((f) => {
        const num = parseInt(f.slice(0, 4), 10);
        return num > chapter && f.endsWith(".md");
      });
      for (const f of laterFiles) {
        await unlink(join(chaptersDir, f));
        if (!opts.json) log(`Removed later chapter: ${f}`);
      }

      // Restore state to previous chapter's end-state (chapter 1 uses snapshot-0 from initBook)
      const restored = await state.restoreState(bookId, restoreFrom);
      if (!restored) {
        throw new Error(`Cannot rewrite chapter ${chapter}: failed to restore snapshot for chapter ${restoreFrom}`);
      }
      if (!opts.json) log(`State restored from chapter ${restoreFrom} snapshot.`);

      const nextChapter = await state.getNextChapterNumber(bookId);
      if (nextChapter !== chapter) {
        throw new Error(`Cannot rewrite chapter ${chapter}: expected next chapter to be ${chapter}, but resolved to ${nextChapter}`);
      }

      if (!opts.json) log(`Regenerating chapter ${chapter}...`);

      const wordCount = opts.words ? parseInt(opts.words, 10) : undefined;

      const config = await loadConfig();
      const pipeline = new PipelineRunner(buildPipelineConfig(config, root, {
        externalContext: opts.brief,
        chapterReviewMode: resolveChapterReviewMode(book, config.writing),
      }));

      const result = await pipeline.writeNextChapter(bookId, wordCount);
      const language = resolveCliLanguage(book.language);

      if (opts.json) {
        log(JSON.stringify(result, null, 2));
      } else {
        for (const line of formatWriteNextResultLines(language, {
          chapterNumber: result.chapterNumber,
          title: result.title,
          wordCount: result.wordCount,
          auditPassed: result.auditResult.passed,
          revised: result.revised,
          status: result.status,
          issues: result.auditResult.issues,
        })) {
          log(line);
        }
      }

      // Success notification intentionally skipped: the pipeline already sent
      // the per-chapter notification for this exact chapter (runner.ts, end of
      // writeNextChapter) — a command-level one would be a duplicate. --notify
      // only adds the failure notification for this command.
    } catch (e) {
      if (opts.notify) {
        await sendCommandNotification({
          title: formatNotifyCommandTitle(notifyLanguage, "write-rewrite", notifyBookName, false),
          body: formatNotifyFailureBody(notifyLanguage, e),
        });
      }
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to rewrite chapter: ${e}`);
      }
      process.exit(1);
    }
  });

writeCommand
  .command("sync")
  .description("Rebuild truth files and SQLite indexes from the latest edited chapter body")
  .argument("<args...>", "Book ID (optional) and chapter number")
  .option("--brief <text>", "One-off guidance for how to interpret the edited chapter while syncing")
  .option("--json", "Output JSON")
  .action(async (args: ReadonlyArray<string>, opts) => {
    try {
      const root = findProjectRoot();

      let bookId: string;
      let chapter: number;
      if (args.length === 1) {
        chapter = parseInt(args[0]!, 10);
        if (isNaN(chapter)) throw new Error(`Expected chapter number, got "${args[0]}"`);
        bookId = await resolveBookId(undefined, root);
      } else if (args.length === 2) {
        chapter = parseInt(args[1]!, 10);
        if (isNaN(chapter)) throw new Error(`Expected chapter number, got "${args[1]}"`);
        bookId = await resolveBookId(args[0], root);
      } else {
        throw new Error("Usage: castor write sync [book-id] <chapter>");
      }

      const state = new StateManager(root);
      const book = await state.loadBookConfig(bookId);
      const language = resolveCliLanguage(book.language);
      const config = await loadConfig();
      const pipeline = new PipelineRunner(buildPipelineConfig(config, root, {
        externalContext: opts.brief,
      }));
      const result = await pipeline.resyncChapterArtifacts(bookId, chapter);

      if (opts.json) {
        log(JSON.stringify(result, null, 2));
      } else {
        for (const line of formatWriteNextResultLines(language, {
          chapterNumber: result.chapterNumber,
          title: result.title,
          wordCount: result.wordCount,
          auditPassed: result.auditResult.passed,
          revised: result.revised,
          status: result.status,
          issues: result.auditResult.issues,
        })) {
          log(line);
        }
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to sync chapter artifacts: ${e}`);
      }
      process.exit(1);
    }
  });

writeCommand
  .command("repair-state")
  .description("Rebuild truth files for a persisted state-degraded chapter without rewriting body text")
  .argument("<args...>", "Book ID (optional) and chapter number")
  .option("--json", "Output JSON")
  .action(async (args: ReadonlyArray<string>, opts) => {
    try {
      const root = findProjectRoot();

      let bookId: string;
      let chapter: number;
      if (args.length === 1) {
        chapter = parseInt(args[0]!, 10);
        if (isNaN(chapter)) throw new Error(`Expected chapter number, got "${args[0]}"`);
        bookId = await resolveBookId(undefined, root);
      } else if (args.length === 2) {
        chapter = parseInt(args[1]!, 10);
        if (isNaN(chapter)) throw new Error(`Expected chapter number, got "${args[1]}"`);
        bookId = await resolveBookId(args[0], root);
      } else {
        throw new Error("Usage: castor write repair-state [book-id] <chapter>");
      }

      const state = new StateManager(root);
      const book = await state.loadBookConfig(bookId);
      const language = resolveCliLanguage(book.language);
      const config = await loadConfig();
      const pipeline = new PipelineRunner(buildPipelineConfig(config, root));
      const result = await pipeline.repairChapterState(bookId, chapter);

      if (opts.json) {
        log(JSON.stringify(result, null, 2));
      } else {
        for (const line of formatWriteNextResultLines(language, {
          chapterNumber: result.chapterNumber,
          title: result.title,
          wordCount: result.wordCount,
          auditPassed: result.auditResult.passed,
          revised: result.revised,
          status: result.status,
          issues: result.auditResult.issues,
        })) {
          log(line);
        }
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to repair chapter state: ${e}`);
      }
      process.exit(1);
    }
  });
