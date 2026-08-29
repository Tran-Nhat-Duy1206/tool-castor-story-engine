import { Command } from "commander";
import {
  FORECAST_DEFAULT_BRANCHES,
  FORECAST_DEFAULT_HORIZON,
  FORECAST_MAX_BRANCHES,
  FORECAST_MAX_HORIZON,
  FORECAST_MIN_BRANCHES,
  FORECAST_MIN_HORIZON,
  PipelineRunner,
  createNarrativeForecast,
  getNarrativeForecast,
  selectNarrativeBranch,
  type NarrativeForecast,
} from "@actalk/castor-core";
import { buildPipelineConfig, findProjectRoot, loadConfig, log, logError, resolveBookId } from "../utils.js";

// CLI surface for RFC #342: create / show / select. All three operate only on
// story/runtime/narrative-forecasts/ artifacts; canonical files stay untouched.

export const forecastCommand = new Command("forecast")
  .description("Narrative forecast: compare non-canonical future branches before writing");

forecastCommand
  .command("create")
  .description("Create a narrative forecast (2-5 isolated candidate branches) from the current canon")
  .argument("[book-id]", "Book ID (auto-detected if only one book)")
  .requiredOption("--divergence <text>", "Divergence point to branch on, e.g. \"主角是否接受对手的合作提议\"")
  .option("--branches <n>", `Number of isolated candidate branches (${FORECAST_MIN_BRANCHES}-${FORECAST_MAX_BRANCHES})`, String(FORECAST_DEFAULT_BRANCHES))
  .option("--horizon <n>", `Future chapters each branch covers (${FORECAST_MIN_HORIZON}-${FORECAST_MAX_HORIZON})`, String(FORECAST_DEFAULT_HORIZON))
  .option("--model <model>", "Override the forecast model")
  .option("--llm-base-url <url>", "Override LLM base URL")
  .option("--json", "Output JSON")
  .action(async (bookIdArg: string | undefined, opts: ForecastCreateOptions) => {
    try {
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const branchCount = parseBoundedInteger(opts.branches, FORECAST_DEFAULT_BRANCHES, "branches", FORECAST_MIN_BRANCHES, FORECAST_MAX_BRANCHES);
      const horizon = parseBoundedInteger(opts.horizon, FORECAST_DEFAULT_HORIZON, "horizon", FORECAST_MIN_HORIZON, FORECAST_MAX_HORIZON);

      const config = await loadConfig({ projectRoot: root });
      if (opts.llmBaseUrl) config.llm.baseUrl = opts.llmBaseUrl;
      if (opts.model) config.llm.model = opts.model;
      const pipeline = new PipelineRunner(buildPipelineConfig(config, root, { quiet: Boolean(opts.json) }));

      const result = await createNarrativeForecast({
        projectRoot: root,
        bookId,
        divergence: opts.divergence,
        branchCount,
        horizon,
        runtime: pipeline.createAgentContext("forecast", bookId),
        onProgress: opts.json ? undefined : (message) => log(message),
      });

      if (opts.json) {
        log(JSON.stringify({
          forecast: result.forecast,
          forecastJsonPath: result.forecastJsonPath,
          comparisonPath: result.comparisonPath,
        }, null, 2));
        return;
      }
      log(`Forecast created: ${result.forecast.forecastId} (base chapter ${result.forecast.baseChapter})`);
      for (const line of formatBranchLines(result.forecast)) log(line);
      log(`Comparison: ${result.comparisonPath}`);
      log(`Select a branch with: castor forecast select ${bookId} ${result.forecast.forecastId} <branch-id>`);
    } catch (e) {
      failForecastCommand("Forecast create failed", e, opts.json);
    }
  });

forecastCommand
  .command("show")
  .description("Show a narrative forecast and re-check it against the current canon (marks it stale when canon changed)")
  .argument("<args...>", "[book-id] <forecast-id>")
  .option("--json", "Output JSON")
  .action(async (args: string[], opts: ForecastReadOptions) => {
    try {
      const { bookIdArg, forecastId } = parseForecastShowArgs(args);
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);

      const result = await getNarrativeForecast({ projectRoot: root, bookId, forecastId });

      if (opts.json) {
        log(JSON.stringify({
          forecast: result.forecast,
          stale: result.stale,
          forecastJsonPath: result.forecastJsonPath,
          comparisonPath: result.comparisonPath,
        }, null, 2));
        return;
      }
      log(`Forecast ${result.forecast.forecastId} — status: ${result.stale ? "stale" : result.forecast.status}`);
      log(`Divergence: ${result.forecast.divergence}`);
      log(`Base chapter: ${result.forecast.baseChapter}, horizon: ~${result.forecast.horizon} chapters`);
      if (result.stale) {
        log("WARNING: canon changed after this forecast was generated; regenerate before relying on it.");
      }
      for (const line of formatBranchLines(result.forecast)) log(line);
      log(`Comparison: ${result.comparisonPath}`);
    } catch (e) {
      failForecastCommand("Forecast show failed", e, opts.json);
    }
  });

forecastCommand
  .command("select")
  .description("Select a branch: writes only selected-branch-plan.md; canonical files are never modified")
  .argument("<args...>", "[book-id] <forecast-id> <branch-id>")
  .option("--json", "Output JSON")
  .action(async (args: string[], opts: ForecastReadOptions) => {
    try {
      const { bookIdArg, forecastId, branchId } = parseForecastSelectArgs(args);
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);

      const result = await selectNarrativeBranch({ projectRoot: root, bookId, forecastId, branchId });

      if (opts.json) {
        log(JSON.stringify({
          forecastId: result.forecast.forecastId,
          branchId: result.branch.branchId,
          branchTitle: result.branch.title,
          stale: result.stale,
          planPath: result.planPath,
        }, null, 2));
        return;
      }
      log(`Selected ${result.branch.branchId} "${result.branch.title}" from ${result.forecast.forecastId}.`);
      if (result.stale) {
        log("WARNING: this forecast is stale; the plan includes a stale warning.");
      }
      log(`Plan: ${result.planPath}`);
      log("Canonical files were not modified. Applying the plan to the outline is a separate, explicit step.");
    } catch (e) {
      failForecastCommand("Forecast select failed", e, opts.json);
    }
  });

interface ForecastCreateOptions {
  readonly divergence: string;
  readonly branches?: string;
  readonly horizon?: string;
  readonly model?: string;
  readonly llmBaseUrl?: string;
  readonly json?: boolean;
}

interface ForecastReadOptions {
  readonly json?: boolean;
}

export function parseForecastShowArgs(args: ReadonlyArray<string>): {
  readonly bookIdArg?: string;
  readonly forecastId: string;
} {
  if (args.length === 1) return { forecastId: args[0]! };
  if (args.length === 2) return { bookIdArg: args[0]!, forecastId: args[1]! };
  throw new Error("Usage: castor forecast show [book-id] <forecast-id>");
}

export function parseForecastSelectArgs(args: ReadonlyArray<string>): {
  readonly bookIdArg?: string;
  readonly forecastId: string;
  readonly branchId: string;
} {
  if (args.length === 2) return { forecastId: args[0]!, branchId: args[1]! };
  if (args.length === 3) return { bookIdArg: args[0]!, forecastId: args[1]!, branchId: args[2]! };
  throw new Error("Usage: castor forecast select [book-id] <forecast-id> <branch-id>");
}

function formatBranchLines(forecast: NarrativeForecast): string[] {
  return forecast.branches.map((branch) =>
    `- ${branch.branchId} "${branch.title}" — intent fit ${branch.intentAlignment.score}/100, ${branch.risks.length} risk(s)`);
}

function parseBoundedInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  min: number,
  max: number,
): number {
  const parsed = value ? Number.parseInt(value, 10) : fallback;
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

function failForecastCommand(prefix: string, error: unknown, json?: boolean): void {
  if (json) {
    log(JSON.stringify({ error: `${prefix}: ${String(error)}` }, null, 2));
  } else {
    logError(`${prefix}: ${String(error)}`);
  }
  process.exitCode = 1;
}
