import { describe, expect, it } from "vitest";
import {
  FORECAST_MAX_BRANCHES,
  FORECAST_MIN_BRANCHES,
  NarrativeForecastSchema,
  parseForecastModelOutput,
} from "../forecast/schema.js";
import { makeForecast, makeForecastBranch } from "./helpers/forecast-fixture.js";

function modelBranches(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const { branchId: _branchId, ...rest } = makeForecastBranch({ title: `mock_text${index + 1}` });
    return rest;
  });
}

describe("narrative forecast schema", () => {
  it("accepts a complete forecast", () => {
    expect(() => NarrativeForecastSchema.parse(makeForecast())).not.toThrow();
  });

  it("rejects fewer than the minimum branch count", () => {
    const forecast = makeForecast({ branches: [makeForecastBranch()] });
    expect(() => NarrativeForecastSchema.parse(forecast)).toThrow();
    expect(FORECAST_MIN_BRANCHES).toBe(2);
  });

  it("rejects more than the maximum branch count", () => {
    const branches = Array.from({ length: 6 }, (_, index) =>
      makeForecastBranch({ branchId: `branch-${index + 1}` }));
    expect(() => NarrativeForecastSchema.parse(makeForecast({ branches }))).toThrow();
    expect(FORECAST_MAX_BRANCHES).toBe(5);
  });

  it("rejects duplicate branch ids so sibling branches stay isolated", () => {
    const forecast = makeForecast({
      branches: [makeForecastBranch(), makeForecastBranch({ title: "mock_text id mock_text" })],
    });
    expect(() => NarrativeForecastSchema.parse(forecast)).toThrow(/branch-1/);
  });

  it("rejects an intent alignment score outside 0-100", () => {
    const forecast = makeForecast({
      branches: [
        makeForecastBranch({ intentAlignment: { score: 101, rationale: "mock_text" } }),
        makeForecastBranch({ branchId: "branch-2" }),
      ],
    });
    expect(() => NarrativeForecastSchema.parse(forecast)).toThrow();
  });

  it("rejects unknown risk kinds", () => {
    const forecast = makeForecast({
      branches: [
        makeForecastBranch({ risks: [{ kind: "vibes" as never, description: "mock_text" }] }),
        makeForecastBranch({ branchId: "branch-2" }),
      ],
    });
    expect(() => NarrativeForecastSchema.parse(forecast)).toThrow();
  });

  it("rejects a branch with no beats", () => {
    const forecast = makeForecast({
      branches: [
        makeForecastBranch({ beats: [] }),
        makeForecastBranch({ branchId: "branch-2" }),
      ],
    });
    expect(() => NarrativeForecastSchema.parse(forecast)).toThrow();
  });
});

describe("parseForecastModelOutput", () => {
  it("parses a plain JSON object", () => {
    const output = parseForecastModelOutput(JSON.stringify({ branches: modelBranches(2) }));
    expect(output.branches).toHaveLength(2);
    expect(output.branches[0]?.title).toBe("mock_text1");
  });

  it("parses JSON wrapped in a code fence", () => {
    const raw = "```json\n" + JSON.stringify({ branches: modelBranches(3) }) + "\n```";
    expect(parseForecastModelOutput(raw).branches).toHaveLength(3);
  });

  it("parses JSON surrounded by prose", () => {
    const raw = `mock_text，mock_text：\n${JSON.stringify({ branches: modelBranches(2) })}\nmock_text。`;
    expect(parseForecastModelOutput(raw).branches).toHaveLength(2);
  });

  it("tolerates trailing commas", () => {
    const raw = JSON.stringify({ branches: modelBranches(2) }).replace(/\]\}$/, "],}");
    expect(parseForecastModelOutput(raw).branches).toHaveLength(2);
  });

  it("throws a JSON error on unparsable output", () => {
    expect(() => parseForecastModelOutput("mock_text JSON")).toThrow(/not valid JSON/);
  });

  it("throws a schema error on the wrong shape", () => {
    expect(() => parseForecastModelOutput(JSON.stringify({ branches: [{ title: "mock_text" }] })))
      .toThrow(/schema validation/);
  });

  it("throws a schema error when the model returns too few branches", () => {
    expect(() => parseForecastModelOutput(JSON.stringify({ branches: modelBranches(1) })))
      .toThrow(/schema validation/);
  });
});
