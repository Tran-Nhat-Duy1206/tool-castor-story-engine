import { Command } from "commander";
import { StateManager, formatLengthCount, readGenreProfile, resolveLengthCountingMode } from "@actalk/castor-core";
import * as Core from "@actalk/castor-core";
import { findProjectRoot, getLegacyMigrationHint, log, logError } from "../utils.js";

export const statusCommand = new Command("status")
  .description("Show project status")
  .argument("[book-id]", "Book ID (optional, shows all if omitted)")
  .option("--chapters", "Show per-chapter status and issues")
  .option("--json", "Output JSON")
  .action(async (bookIdArg: string | undefined, opts) => {
    try {
      const root = findProjectRoot();
      const state = new StateManager(root);

      const allBookIds = await state.listBooks();
      const bookIds = bookIdArg ? [bookIdArg] : allBookIds;

      if (bookIdArg && !allBookIds.includes(bookIdArg)) {
        throw new Error(
          `Book "${bookIdArg}" not found. Available: ${allBookIds.join(", ") || "(none)"}`,
        );
      }

      const booksData: Array<Record<string, unknown>> = [];

      if (!opts.json) {
        log(`InkOS Project: ${root}`);
        log(`Books: ${allBookIds.length}`);
        log("");
      }

      for (const id of bookIds) {
        const book = await state.loadBookConfig(id);
        const index = await state.loadChapterIndex(id);
        const migrationHint = await getLegacyMigrationHint(root, id);
        const persistedChapterCount = await state.getPersistedChapterCount(id);
        const { profile: genreProfile } = await readGenreProfile(root, book.genre);
        const countingMode = resolveLengthCountingMode(book.language ?? genreProfile.language);

        const approved = index.filter((ch) => ch.status === "approved").length;
        const pending = index.filter(
          (ch) => ch.status === "ready-for-review",
        ).length;
        const failed = index.filter(
          (ch) => ch.status === "audit-failed",
        ).length;
        const degraded = index.filter(
          (ch) => ch.status === "state-degraded",
        ).length;
        const totalWords = index.reduce((sum, ch) => sum + ch.wordCount, 0);
        const avgWords = index.length > 0 ? Math.round(totalWords / index.length) : 0;

        // Phase 5 readiness — Core-owned evaluations (no CLI recalculation)
        let foundationReadiness: Record<string, unknown> | null = null;
        let planningGate: Record<string, unknown> | null = null;
        const bookDir = state.bookDir(id);
        const nextChapterNumber = persistedChapterCount + 1;
        try {
          const c = Core as unknown as Record<string, unknown>;
          if (typeof c.getFoundationReadiness === "function") {
            try {
              foundationReadiness = await (c.getFoundationReadiness as unknown as (p: Record<string, unknown>) => Promise<Record<string, unknown>>)({ bookId: id, bookDir });
            } catch {}
          }
          if (!foundationReadiness && typeof c.evaluateFoundationReadiness === "function") {
            try {
              if (typeof c.readUnitManifests === "function") {
                const m = await (c.readUnitManifests as unknown as (p: string) => Promise<unknown>)(bookDir);
                const manifests: unknown[] = m instanceof Map ? [...(m as Map<string, unknown>).values()] : Array.isArray(m) ? m as unknown[] : [];
                foundationReadiness = await (c.evaluateFoundationReadiness as unknown as (a: string, b: unknown[]) => Promise<Record<string, unknown>>)(bookDir, manifests as never[]);
              } else if (typeof c.evaluateChapter1Readiness === "function") {
                foundationReadiness = await (c.evaluateChapter1Readiness as unknown as (p: string) => Promise<Record<string, unknown>>)(bookDir);
              }
            } catch {}
          }
          if (!foundationReadiness && typeof c.evaluateChapter1Readiness === "function") {
            try {
              foundationReadiness = await (c.evaluateChapter1Readiness as unknown as (p: string) => Promise<Record<string, unknown>>)(bookDir);
            } catch {}
          }
        } catch {}
        try {
          const c = Core as unknown as Record<string, unknown>;
          if (typeof c.getPlanningGateReport === "function") {
            try {
              planningGate = await (c.getPlanningGateReport as unknown as (p: Record<string, unknown>) => Promise<Record<string, unknown>>)({ bookId: id, bookDir, chapter: nextChapterNumber, chapterNumber: nextChapterNumber });
            } catch {}
          }
          // evaluatePlanningGate requires exact planId content hash — do not synthesize; only try if wrapper unavailable and a plan exists
          if (!planningGate && typeof c.evaluatePlanningGate === "function" && typeof c.getPlanningGateReport !== "function") {
            // No safe fallback without planId; leave null to avoid false CONFLICT
          }
        } catch {}

        const baseEntry: Record<string, unknown> = {
          id,
          title: book.title,
          status: book.status,
          genre: book.genre,
          platform: book.platform,
          chapters: persistedChapterCount,
          targetChapters: book.targetChapters,
          totalWords,
          avgWordsPerChapter: avgWords,
          approved,
          pending,
          failed,
          degraded,
          ...(migrationHint ? { migrationHint } : {}),
          ...(opts.chapters ? {
            chapterList: index.map((ch) => ({
              number: ch.number,
              title: ch.title,
              status: ch.status,
              wordCount: ch.wordCount,
              ...(ch.status === "audit-failed" || ch.status === "state-degraded"
                ? { issues: ch.auditIssues }
                : {}),
            })),
          } : {}),
        };
        // Attach raw Core readiness/gate for JSON output (keep existing fields, add new)
        if (foundationReadiness) {
          baseEntry.foundationReadiness = foundationReadiness;
          // also surface alias-normalized blockers for consumers expecting blockers
          const br = (foundationReadiness as Record<string, unknown>).blockingReasons ?? (foundationReadiness as Record<string, unknown>).blockers;
          if (br !== undefined) baseEntry.foundationBlockers = br;
        }
        if (planningGate) {
          baseEntry.planningGate = planningGate;
        }
        booksData.push(baseEntry);

        if (!opts.json) {
          log(`  ${book.title} (${id})`);
          log(`    Status: ${book.status}`);
          log(`    Platform: ${book.platform} | Genre: ${book.genre}`);
          log(`    Chapters: ${persistedChapterCount} / ${book.targetChapters}`);
          log(`    Words: ${totalWords.toLocaleString()} (avg ${avgWords}/ch)`);
          log(`    Approved: ${approved} | Pending: ${pending} | Failed: ${failed} | Degraded: ${degraded}`);
          if (migrationHint) {
            log(`    Migration: ${migrationHint}`);
          }

          // Phase 5 readiness block — concise, display Core structured fields only
          try {
            if (foundationReadiness) {
              const fr = foundationReadiness as Record<string, unknown>;
              const blockingReasons = (fr.blockingReasons ?? fr.blockers ?? fr.blocking ?? []) as unknown;
              const warnings = (fr.warnings ?? fr.findings ?? fr.warningList ?? []) as unknown;
              const nextRecommendedAction = (fr.nextRecommendedAction ?? fr.nextAction ?? fr.recommendedAction ?? fr.nextRecommended ?? null) as unknown;
              const readyRaw = fr.ready as unknown;
              const brArr = Array.isArray(blockingReasons) ? blockingReasons as string[] : [];
              const warnArr = Array.isArray(warnings) ? warnings as string[] : [];
              let label: string;
              if (typeof readyRaw === "boolean") label = readyRaw ? "ready" : "blocked";
              else label = brArr.length === 0 ? "ready" : "blocked";
              log(`    Foundation: ${label}`);
              if (brArr.length > 0) log(`      Blockers: ${brArr.join("; ")}`);
              if (warnArr.length > 0) log(`      Warnings: ${warnArr.join("; ")}`);
              if (typeof nextRecommendedAction === "string" && nextRecommendedAction) log(`      Next: ${nextRecommendedAction}`);
            }
          } catch {}
          try {
            if (planningGate) {
              const pg = planningGate as Record<string, unknown>;
              const outcomeRaw = (pg.outcome ?? pg.verdict ?? pg.status ?? pg.result ?? "unknown") as string;
              const outcome = String(outcomeRaw);
              const evidence = (pg.evidence ?? pg.blockers ?? pg.concerns ?? pg.missing ?? pg.details ?? []) as unknown;
              const warnings = (pg.warnings ?? []) as unknown;
              const nextAct = (pg.nextRecommendedAction ?? pg.nextAction ?? null) as unknown;
              const evArr = Array.isArray(evidence) ? evidence as string[] : [];
              const warnArr = Array.isArray(warnings) ? warnings as string[] : [];
              log(`    Planning Gate: ${outcome.toUpperCase()}`);
              if (evArr.length > 0) log(`      Details: ${evArr.join("; ")}`);
              if (warnArr.length > 0) log(`      Warnings: ${warnArr.join("; ")}`);
              if (typeof nextAct === "string" && nextAct) log(`      Next: ${nextAct}`);
              const low = outcome.toLowerCase();
              if (low === "conflict" || low === "author_decision" || low === "uncertain") {
                log(`      (Open Studio to resolve blocking issues)`);
              }
            }
          } catch {}

          if (opts.chapters && index.length > 0) {
            log("");
            for (const ch of index) {
              const icon = ch.status === "approved"
                ? "+"
                : ch.status === "audit-failed"
                  ? "!"
                  : ch.status === "state-degraded"
                    ? "x"
                    : "~";
              log(`    [${icon}] Ch.${ch.number} "${ch.title}" | ${formatLengthCount(ch.wordCount, countingMode)} | ${ch.status}`);
              if ((ch.status === "audit-failed" || ch.status === "state-degraded") && ch.auditIssues.length > 0) {
                const criticals = ch.auditIssues.filter((i: string) => i.startsWith("[critical]"));
                const warnings = ch.auditIssues.filter((i: string) => i.startsWith("[warning]"));
                if (criticals.length > 0) {
                  for (const issue of criticals) {
                    log(`        ${issue}`);
                  }
                }
                if (warnings.length > 0) {
                  if (ch.status === "state-degraded") {
                    for (const issue of warnings) {
                      log(`        ${issue}`);
                    }
                  } else {
                    log(`        + ${warnings.length} warning(s)`);
                  }
                }
              }
            }
          }
          log("");
        }
      }

      if (opts.json) {
        log(JSON.stringify({ project: root, books: booksData }, null, 2));
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to get status: ${e}`);
      }
      process.exit(1);
    }
  });
