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
  bookId: "雨账簿",
  createdAt: "2026-07-15T12:02:34.979Z",
  language: "vi",
  divergence: "主角是否立刻公开第三章发现的关键证据",
  horizon: 3,
  baseChapter: 3,
  contextFingerprint: "fingerprint",
  status: "active",
  branches: [
    {
      branchId: "branch-1",
      title: "沉默的铁锈",
      premise: "继续独自秘密调查，不向任何人公开。",
      beats: [
        { chapter: 4, summary: "重访档案架。" },
        { chapter: 5, summary: "拜访退休维修工。" },
      ],
      characterDecisions: [{ character: "陈雨声", decision: "暂不公开" }],
      projectedChanges: {
        characters: ["主角更加警惕"],
        relationships: ["与王师傅互相提防"],
        world: ["档案室换锁"],
        hooks: ["老周笔记本进入视野"],
      },
      risks: [{ kind: "continuity", description: "关键物证可能被清理" }],
      uncertainties: ["是否存在副本"],
      intentAlignment: { score: 75, rationale: "符合谨慎调查的作者意图" },
    },
    {
      branchId: "branch-2",
      title: "试探深水",
      premise: "只向站长有限汇报。",
      beats: [{ chapter: 4, summary: "私下汇报并观察反应。" }],
      characterDecisions: [{ character: "陈雨声", decision: "有限汇报" }],
      projectedChanges: { characters: [], relationships: [], world: [], hooks: [] },
      risks: [{ kind: "causality", description: "站长反应需要合理铺垫" }],
      uncertainties: [],
      intentAlignment: { score: 82, rationale: "兼顾安全和推进速度" },
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
    expect(html).toContain("主角是否立刻公开第三章发现的关键证据");
    expect(html).toContain("沉默的铁锈");
    expect(html).toContain("试探深水");
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
