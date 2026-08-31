import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { NarrativeForecast } from "@actalk/castor-core/forecast/schema";
import type { ToolExecution } from "../../../store/chat/types";
import {
  NarrativeForecastPreview,
  buildNarrativeForecastRecheckInstruction,
  buildNarrativeForecastSelectionInstruction,
  getNarrativeForecastPreviewDetails,
} from "../NarrativeForecastPreview";

const forecast: NarrativeForecast = {
  version: 1,
  forecastId: "fc-20260715-120234",
  bookId: "mock_val",
  createdAt: "2026-07-15T12:02:34.979Z",
  language: "vi",
  divergence: "mock_valCong khaimock_val",
  horizon: 3,
  baseChapter: 3,
  contextFingerprint: "fingerprint",
  status: "active",
  branches: [
    {
      branchId: "branch-1",
      title: "mock_val",
      premise: "mock_val，mock_valCong khai。",
      beats: [
        { chapter: 4, summary: "mock_val。" },
        { chapter: 5, summary: "mock_val。" },
      ],
      characterDecisions: [{ character: "mock_val", decision: "mock_valCong khai" }],
      projectedChanges: {
        characters: ["mock_val"],
        relationships: ["mock_val"],
        world: ["mock_val"],
        hooks: ["mock_val"],
      },
      risks: [{ kind: "continuity", description: "mock_val" }],
      uncertainties: ["mock_val"],
      intentAlignment: { score: 75, rationale: "mock_val" },
    },
    {
      branchId: "branch-2",
      title: "mock_val",
      premise: "mock_val。",
      beats: [{ chapter: 4, summary: "mock_val。" }],
      characterDecisions: [{ character: "mock_val", decision: "mock_val" }],
      projectedChanges: { characters: [], relationships: [], world: [], hooks: [] },
      risks: [{ kind: "causality", description: "mock_val" }],
      uncertainties: [],
      intentAlignment: { score: 82, rationale: "mock_val" },
    },
  ],
};

function exec(details: unknown, tool = "create_narrative_forecast"): ToolExecution {
  return {
    id: "forecast-tool-1",
    tool,
    label: "Narrative Forecast",
    status: "completed",
    details,
    startedAt: 1,
    completedAt: 2,
  };
}

describe("NarrativeForecastPreview", () => {
  it("extracts create and get tool details without accepting malformed payloads", () => {
    expect(getNarrativeForecastPreviewDetails(exec({
      kind: "narrative_forecast_created",
      forecastId: forecast.forecastId,
      forecast,
    }))).toMatchObject({ kind: "forecast", stale: false, forecast });

    expect(getNarrativeForecastPreviewDetails(exec({
      kind: "narrative_forecast",
      stale: true,
      forecast: { ...forecast, status: "stale" },
    }, "get_narrative_forecast"))).toMatchObject({ kind: "forecast", stale: true });

    expect(getNarrativeForecastPreviewDetails(exec({ kind: "narrative_forecast_created" }))).toBeNull();
  });

  it("extracts a selected branch result", () => {
    expect(getNarrativeForecastPreviewDetails(exec({
      kind: "narrative_branch_selected",
      stale: false,
      branchId: "branch-2",
      planPath: "story/runtime/narrative-forecasts/fc-1/selected-branch-plan.md",
    }, "select_narrative_branch"))).toEqual({
      kind: "selected",
      stale: false,
      branchId: "branch-2",
      planPath: "story/runtime/narrative-forecasts/fc-1/selected-branch-plan.md",
    });
  });

  it("renders the divergence, branches, beats, risks and non-canonical boundary", () => {
    const html = renderToStaticMarkup(React.createElement(NarrativeForecastPreview, {
      exec: exec({ kind: "narrative_forecast_created", forecastId: forecast.forecastId, forecast }),
      onSelectBranch: vi.fn(),
      onRecheck: vi.fn(),
    }));

    expect(html).toContain("Dự báo truyện đa nhánh");
    expect(html).toContain("KHÔNG CHÍNH THỐNG");
    expect(html).toContain("Dựa trên sau chương 3");
    expect(html).toContain("mock_valCong khaimock_val");
    expect(html).toContain("mock_val");
    expect(html).toContain("mock_val");
    expect(html).toContain("Chương 4");
    expect(html).toContain("Tính liên tục");
    expect(html).toContain("Dùng nhánh này");
    expect(html).toContain(`data-forecast-id="${forecast.forecastId}"`);
    expect(html).toContain("data-branch-id=\"branch-1\"");
  });

  it("disables selection when the forecast is stale", () => {
    const html = renderToStaticMarkup(React.createElement(NarrativeForecastPreview, {
      exec: exec({ kind: "narrative_forecast", stale: true, forecast: { ...forecast, status: "stale" } }, "get_narrative_forecast"),
      onSelectBranch: vi.fn(),
      onRecheck: vi.fn(),
    }));

    expect(html).toContain("Chính thống đã thay đổi");
    expect(html).toMatch(/data-branch-id="branch-1"[^>]*disabled/);
    expect(html).toContain("Kiểm tra lại");
  });

  it("builds explicit existing-tool instructions from structured ids", () => {
    expect(buildNarrativeForecastSelectionInstruction(forecast.forecastId, "branch-2", "vi"))
      .toContain(`select_narrative_branch`);
    expect(buildNarrativeForecastSelectionInstruction(forecast.forecastId, "branch-2", "vi"))
      .toContain(`${forecast.forecastId}`);
    expect(buildNarrativeForecastSelectionInstruction(forecast.forecastId, "branch-2", "vi"))
      .toContain("branch-2");
    expect(buildNarrativeForecastRecheckInstruction(forecast.forecastId, "en"))
      .toBe(`Call get_narrative_forecast for forecast ${forecast.forecastId} and report whether it is stale.`);
  });
});
