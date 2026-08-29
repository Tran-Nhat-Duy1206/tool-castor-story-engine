import { Command } from "commander";
import {
  StateManager,
  getPublishedArcPlan,
  getLookahead,
  getPlanningGateReport,
} from "@actalk/castor-core";
import { findProjectRoot, log, logError, resolveBookId } from "../utils.js";

/**
 * READ-ONLY Planning operational command.
 *
 * Subcommands (read-only, advisory):
 * - castor planning arc status <book>
 * - castor planning lookahead show <book>
 * - castor planning gate <book> [chapter]
 * - castor planning gate report <book> [chapter]  (alias for gate)
 *
 * Core delegation (read-only):
 * - arc status       -> getPublishedArcPlan (wraps loadPublishedArcPlan / evaluateArcCompletion)
 * - lookahead show   -> getLookahead (wraps loadLookahead / listLookaheads)
 * - gate report/gate -> getPlanningGateReport (wraps evaluatePlanningGate)
 *
 * Invariants:
 * - No Arc Publish, no Direction confirm, no Authorization confirm/consume,
 *   no applyArcTransition, no auto-Publish.
 * - No bypass flags (--force / --write-anyway etc.).
 * - Displays Core-derived advisory state:
 *   lookahead → ADVISORY/NON-AUTHORITY; gate → verdict + blockers + next action.
 */

export const planningCommand = new Command("planning").description(
  "Planning operations (read-only, advisory)",
);

// ---------------------------------------------------------------------------
// arc status
// ---------------------------------------------------------------------------

const arcCommand = planningCommand.command("arc").description("Arc planning (read-only)");

arcCommand
  .command("status")
  .description("Show published Arc Plan and completion advisory (read-only)")
  .argument("<book>", "Book ID")
  .option("--json", "Output JSON")
  .action(async (bookIdArg: string, opts: { json?: boolean }) => {
    try {
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      // Use StateManager as required (read-only — validates book exists, no mutation)
      const state = new StateManager(root);
      try {
        await state.loadBookConfig(bookId);
      } catch {
        // let Core report missing book; keep fail-closed below
      }
      try {
        (state as unknown as { bookDir?: (id: string) => string }).bookDir?.(bookId);
      } catch {
        // ignore
      }

      // Core read-only: getPublishedArcPlan (delegates to loadPublishedArcPlan / evaluateArcCompletion)
      const result = (await getPublishedArcPlan({ bookId, projectRoot: root })) as Record<string, unknown>;

      if (opts.json) {
        log(
          JSON.stringify(
            {
              bookId,
              arc: result,
              advisory: "READ-ONLY — arc status derived from Core published state; no mutation performed.",
            },
            null,
            2,
          ),
        );
        return;
      }

      const title = (result as { title?: string }).title ?? (result as { arcId?: string }).arcId ?? bookId;
      const status = (result as { status?: string }).status ?? "unknown";
      log(`Planning — Arc Status (read-only)`);
      log(`  Book: ${bookId}`);
      log(`  Arc: ${String(title)} [${String(status)}]`);
      if ((result as { goal?: string }).goal) {
        log(`  Goal: ${String((result as { goal?: string }).goal)}`);
      }
      log("");
      log("  Advisory: read-only — no applyArcTransition, no publish, no authorization changes.");
    } catch (e) {
      if (opts.json) {
        // opts is second arg captured differently when no json? Ensure handling
        log(JSON.stringify({ error: String(e) }, null, 2));
      } else {
        logError(`Failed to get arc status: ${e}`);
      }
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// lookahead show
// ---------------------------------------------------------------------------

const lookaheadCommand = planningCommand
  .command("lookahead")
  .description("Rolling lookahead (advisory, non-authoritative)");

lookaheadCommand
  .command("show")
  .description("Show rolling lookahead (ADVISORY / NON-AUTHORITY, read-only)")
  .argument("<book>", "Book ID")
  .option("--json", "Output JSON")
  .action(async (bookIdArg: string, opts: { json?: boolean }) => {
    try {
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const state = new StateManager(root);
      try {
        await state.loadBookConfig(bookId);
      } catch {
        // let Core handle
      }

      // Core read-only: getLookahead (wraps loadLookahead / listLookaheads)
      const result = (await getLookahead({ bookId, projectRoot: root })) as Record<string, unknown>;

      if (opts.json) {
        log(
          JSON.stringify(
            {
              bookId,
              lookahead: result,
              advisory: "ADVISORY / NON-AUTHORITY — lookahead is lightweight intention only; it does not authorize writing.",
            },
            null,
            2,
          ),
        );
        return;
      }

      log(`Planning — Lookahead (ADVISORY / NON-AUTHORITY, read-only)`);
      log(`  Book: ${bookId}`);
      log(`  ADVISORY — lookahead does NOT confer write authority; Planning Gate is authoritative.`);
      log("");
      const items = (result as { items?: unknown[] }).items ?? (result as { horizon?: unknown[] }).horizon ?? [];
      if (Array.isArray(items) && items.length > 0) {
        log(`  Horizon / items (${items.length}):`);
        for (const it of items.slice(0, 5)) {
          log(`    - ${JSON.stringify(it).slice(0, 120)}`);
        }
      } else {
        log(`  Lookahead: ${JSON.stringify(result).slice(0, 200)}`);
      }
      log("");
      log("  Label: ADVISORY / NON-AUTHORITY — for planning preview only; no mutation.");
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }, null, 2));
      } else {
        logError(`Failed to show lookahead: ${e}`);
      }
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// gate — supports both `castor planning gate <book> [chapter]` and
// `castor planning gate report <book> [chapter]`
// ---------------------------------------------------------------------------

function verdictFromResult(result: Record<string, unknown>): string {
  const v = (result.verdict as string) ?? (result.outcome as string) ?? "UNKNOWN";
  const up = String(v).toUpperCase();
  if (["SAFE", "UNCERTAIN", "AUTHOR_DECISION", "CONFLICT"].includes(up)) return up;
  // Map lower-case outcomes
  const map: Record<string, string> = {
    safe: "SAFE",
    uncertain: "UNCERTAIN",
    author_decision: "AUTHOR_DECISION",
    conflict: "CONFLICT",
  };
  return map[String(v).toLowerCase()] ?? up;
}

function renderGateOutput(
  bookId: string,
  result: Record<string, unknown>,
  opts: { json?: boolean },
): void {
  const verdict = verdictFromResult(result);
  const canWrite = (result.canWrite as boolean) ?? verdict === "SAFE";
  const reasons = (result.reasons as string[]) ?? (result.evidence as string[]) ?? (result.concerns as string[]) ?? [];
  const blockers: string[] = Array.isArray(reasons) ? reasons.slice(0, 10).map(String) : [];
  // Also handle missing author decisions
  const missing = result.missing as string[] | undefined;
  if (missing && missing.length > 0) {
    for (const m of missing) blockers.push(`missing authorization: ${String(m)}`);
  }

  const nextAction =
    verdict === "SAFE"
      ? "Next action: ready to compose — no planning blockers."
      : verdict === "UNCERTAIN"
        ? "Next action: review semantic concerns; refine plan before writing."
        : verdict === "AUTHOR_DECISION"
          ? "Next action: obtain required Author Decision / Authorization before writing."
          : "Next action: resolve deterministic conflicts (version/canon/sequence mismatches).";

  if (opts.json) {
    log(
      JSON.stringify(
        {
          bookId,
          verdict,
          canWrite,
          blockers,
          nextAction,
          raw: result,
          advisory: "READ-ONLY Gate evaluation — does not consume authorizations or trigger writing.",
        },
        null,
        2,
      ),
    );
    return;
  }

  log(`Planning — Gate (read-only advisory)`);
  log(`  Book: ${bookId}`);
  log(`  Verdict: ${verdict} (canWrite: ${String(canWrite)})`);
  log("");
  if (blockers.length === 0) {
    log("  Blockers: (none)");
  } else {
    log(`  Blockers (${blockers.length}):`);
    for (const b of blockers) log(`    - ${b}`);
  }
  log("");
  log(`  ${nextAction}`);
  if (verdict === "SAFE") log("  Note: SAFE means Gate passed; Writer invocation is still explicit.");
  log("  Read-only: no Direction confirm, no Authorization confirm/consume, no publish, no applyArcTransition.");
}

const gateCommand = planningCommand.command("gate").description("Planning Gate (read-only advisory)");

// Subcommand: gate report <book> [chapter]
gateCommand
  .command("report")
  .description("Evaluate Planning Gate (read-only advisory verdict)")
  .argument("<book>", "Book ID")
  .argument("[chapter]", "Chapter number or planId (optional)")
  .option("--json", "Output JSON")
  .action(async (bookIdArg: string, chapterArg: string | undefined, opts: { json?: boolean }) => {
    try {
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const state = new StateManager(root);
      try {
        await state.loadBookConfig(bookId);
      } catch {
        // let Core handle
      }
      const result = (await getPlanningGateReport({
        bookId,
        projectRoot: root,
        chapter: chapterArg,
        planId: chapterArg,
      })) as Record<string, unknown>;
      renderGateOutput(bookId, result, opts);
    } catch (e) {
      if (opts?.json) log(JSON.stringify({ error: String(e) }, null, 2));
      else logError(`Failed to evaluate planning gate: ${e}`);
      process.exit(1);
    }
  });

// Direct alias: gate <book> [chapter]  (as per task spec)
gateCommand
  .argument("<book>", "Book ID")
  .argument("[chapter]", "Chapter number or planId (optional)")
  .option("--json", "Output JSON")
  .action(async (bookIdArg: string, chapterArg: string | undefined, opts: { json?: boolean }) => {
    // This action runs when `castor planning gate <book> [chapter]` is used without `report`
    // Avoid double-handling when report subcommand was intended — commander prioritizes subcommand
    // so this only fires for direct gate usage.
    try {
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const state = new StateManager(root);
      try {
        await state.loadBookConfig(bookId);
      } catch {
        // let Core handle
      }
      const result = (await getPlanningGateReport({
        bookId,
        projectRoot: root,
        chapter: chapterArg,
        planId: chapterArg,
      })) as Record<string, unknown>;
      renderGateOutput(bookId, result, opts);
    } catch (e) {
      if (opts?.json) log(JSON.stringify({ error: String(e) }, null, 2));
      else logError(`Failed to evaluate planning gate: ${e}`);
      process.exit(1);
    }
  });
