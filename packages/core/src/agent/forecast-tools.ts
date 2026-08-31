import { Type, type Static } from "@mariozechner/pi-ai";
import type { AgentTool, AgentToolResult, AgentToolUpdateCallback } from "@mariozechner/pi-agent-core";
import type { PipelineRunner } from "../pipeline/runner.js";
import {
  createNarrativeForecast,
  getNarrativeForecast,
  selectNarrativeBranch,
} from "../forecast/runner.js";
import type { ForecastBranch, NarrativeForecast } from "../forecast/schema.js";
import { assertSafeBookId } from "../utils/book-id.js";

// Narrative forecast tools (RFC #342). All three operate strictly on
// story/runtime/narrative-forecasts/ — they never modify canonical prose,
// state, or control documents. The v1 create call runs synchronously inside
// the chat turn (Studio confirmed background execution is a v2 follow-up).

// ---------------------------------------------------------------------------
// Local helpers (textResult / book resolution are not exported by agent-tools)
// ---------------------------------------------------------------------------

function textResult(text: string): AgentToolResult<undefined>;
function textResult<T>(text: string, details: T): AgentToolResult<T>;
function textResult<T = undefined>(text: string, details?: T): AgentToolResult<T> {
  return { content: [{ type: "text", text }], details: details as T };
}

function resolveForecastBookId(
  toolName: string,
  paramsBookId: string | undefined,
  activeBookId: string | null,
): string {
  const resolvedBookId = paramsBookId ?? activeBookId ?? undefined;
  if (!resolvedBookId) {
    throw new Error(`${toolName} requires bookId when there is no active book.`);
  }
  const safeBookId = assertSafeBookId(resolvedBookId, `${toolName}.bookId`);
  if (paramsBookId && activeBookId && safeBookId !== activeBookId) {
    throw new Error(`${toolName}.bookId must match the active book.`);
  }
  return safeBookId;
}

function describeBranch(branch: ForecastBranch): string {
  return `${branch.branchId} "${branch.title}" — intent fit ${branch.intentAlignment.score}/100, `
    + `${branch.risks.length} risk(s), premise: ${branch.premise}`;
}

function describeForecast(forecast: NarrativeForecast, stale: boolean): string[] {
  return [
    `Forecast ${forecast.forecastId} (book ${forecast.bookId}) — status: ${stale ? "stale" : forecast.status}.`,
    `Divergence: ${forecast.divergence}`,
    `Base chapter: ${forecast.baseChapter}, horizon: ~${forecast.horizon} chapters.`,
    ...(stale
      ? ["WARNING: canonical chapters or state changed after this forecast was generated; regenerate before relying on it."]
      : []),
    "Branches:",
    ...forecast.branches.map((branch) => `- ${describeBranch(branch)}`),
  ];
}

// ---------------------------------------------------------------------------
// create_narrative_forecast
// ---------------------------------------------------------------------------

const ForecastCreateParams = Type.Object({
  bookId: Type.Optional(Type.String({
    description: "All forecast tools: book id to forecast. Defaults to the active book; must match it when both are present.",
  })),
  divergence: Type.String({
    description: "Required divergence point: the open decision or fork the author wants to compare, e.g. whether the protagonist accepts or rejects the partnership proposal. Include the competing options when known.",
  }),
  branchCount: Type.Optional(Type.Number({
    description: "create_narrative_forecast only: number of mutually isolated candidate branches, integer 2-5. Default 3.",
  })),
  horizon: Type.Optional(Type.Number({
    description: "create_narrative_forecast only: how many future chapters each branch should cover, integer 1-10. Default 5.",
  })),
});

type ForecastCreateParamsType = Static<typeof ForecastCreateParams>;

export function createNarrativeForecastCreateTool(
  pipeline: PipelineRunner,
  activeBookId: string | null,
  projectRoot: string,
): AgentTool<typeof ForecastCreateParams> {
  return {
    name: "create_narrative_forecast",
    description:
      "Create a non-canonical narrative forecast for the current long-form book: reads the canonical context "
      + "(structured state, author intent, current focus, outline, hooks, recent summaries, characters) and projects "
      + "2-5 mutually isolated candidate futures from a divergence point. Writes forecast.json and comparison.md under "
      + "story/runtime/narrative-forecasts/<forecastId>/ and never modifies canonical chapters or state.",
    label: "Narrative Forecast",
    parameters: ForecastCreateParams,
    async execute(
      _toolCallId: string,
      params: ForecastCreateParamsType,
      _signal?: AbortSignal,
      onUpdate?: AgentToolUpdateCallback,
    ): Promise<AgentToolResult<unknown>> {
      const bookId = resolveForecastBookId("create_narrative_forecast", params.bookId, activeBookId);
      const baseRuntime = pipeline.createAgentContext("forecast", bookId);
      const result = await createNarrativeForecast({
        projectRoot,
        bookId,
        divergence: params.divergence,
        branchCount: params.branchCount,
        horizon: params.horizon,
        runtime: _signal ? { ...baseRuntime, signal: _signal } : baseRuntime,
        onProgress: (message) => onUpdate?.(textResult(message)),
      });

      return textResult(
        [
          `Narrative forecast ${result.forecast.forecastId} created with ${result.forecast.branches.length} isolated branches.`,
          ...result.forecast.branches.map((branch) => `- ${describeBranch(branch)}`),
          `Comparison: ${result.comparisonPath}`,
          `Forecast data: ${result.forecastJsonPath}`,
          "These branches are non-canonical planning material. Use select_narrative_branch with the forecastId and a branchId "
          + "to write selected-branch-plan.md, or get_narrative_forecast to re-check staleness later.",
        ].join("\n"),
        { kind: "narrative_forecast_created", forecastId: result.forecast.forecastId, ...result },
      );
    },
  };
}

// ---------------------------------------------------------------------------
// get_narrative_forecast
// ---------------------------------------------------------------------------

const ForecastGetParams = Type.Object({
  bookId: Type.Optional(Type.String({
    description: "All forecast tools: book id. Defaults to the active book; must match it when both are present.",
  })),
  forecastId: Type.String({
    description: "get_narrative_forecast only: forecast id returned by create_narrative_forecast, e.g. fc-20260715-080910.",
  }),
});

type ForecastGetParamsType = Static<typeof ForecastGetParams>;

export function createNarrativeForecastGetTool(
  activeBookId: string | null,
  projectRoot: string,
): AgentTool<typeof ForecastGetParams> {
  return {
    name: "get_narrative_forecast",
    description:
      "Read an existing narrative forecast, re-check it against the current canonical context, and mark it stale when "
      + "canonical chapters, structured state, or control documents changed after it was generated. Read-only apart from "
      + "persisting the stale marker inside the forecast's own directory.",
    label: "Get Narrative Forecast",
    parameters: ForecastGetParams,
    async execute(
      _toolCallId: string,
      params: ForecastGetParamsType,
    ): Promise<AgentToolResult<unknown>> {
      const bookId = resolveForecastBookId("get_narrative_forecast", params.bookId, activeBookId);
      const result = await getNarrativeForecast({ projectRoot, bookId, forecastId: params.forecastId });

      return textResult(
        [
          ...describeForecast(result.forecast, result.stale),
          `Comparison: ${result.comparisonPath}`,
        ].join("\n"),
        { kind: "narrative_forecast", stale: result.stale, forecast: result.forecast },
      );
    },
  };
}

// ---------------------------------------------------------------------------
// select_narrative_branch
// ---------------------------------------------------------------------------

const ForecastSelectParams = Type.Object({
  bookId: Type.Optional(Type.String({
    description: "All forecast tools: book id. Defaults to the active book; must match it when both are present.",
  })),
  forecastId: Type.String({
    description: "select_narrative_branch only: forecast id containing the branch to select.",
  }),
  branchId: Type.String({
    description: "select_narrative_branch only: branch id to select, e.g. branch-2. Must exist in the forecast.",
  }),
});

type ForecastSelectParamsType = Static<typeof ForecastSelectParams>;

export function createNarrativeForecastSelectTool(
  activeBookId: string | null,
  projectRoot: string,
): AgentTool<typeof ForecastSelectParams> {
  return {
    name: "select_narrative_branch",
    description:
      "Select one branch of a narrative forecast. Writes only selected-branch-plan.md inside the forecast directory — "
      + "it does NOT apply the plan to the outline, chapter intents, or canonical state; that is a separate, "
      + "user-confirmed operation.",
    label: "Select Narrative Branch",
    parameters: ForecastSelectParams,
    async execute(
      _toolCallId: string,
      params: ForecastSelectParamsType,
    ): Promise<AgentToolResult<unknown>> {
      const bookId = resolveForecastBookId("select_narrative_branch", params.bookId, activeBookId);
      const result = await selectNarrativeBranch({
        projectRoot,
        bookId,
        forecastId: params.forecastId,
        branchId: params.branchId,
      });

      return textResult(
        [
          `Selected ${result.branch.branchId} "${result.branch.title}" from forecast ${result.forecast.forecastId}.`,
          ...(result.stale
            ? ["WARNING: this forecast is stale — canon changed after it was generated. The plan includes a stale warning; verify before applying."]
            : []),
          `Plan written: ${result.planPath}`,
          "Canonical files were not modified. Applying this plan to the outline or chapter intents requires explicit user confirmation.",
        ].join("\n"),
        { kind: "narrative_branch_selected", stale: result.stale, planPath: result.planPath, branchId: result.branch.branchId },
      );
    },
  };
}
