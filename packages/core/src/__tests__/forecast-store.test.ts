import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { access, mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ForecastStore, assertSafeForecastId } from "../forecast/store.js";
import { makeForecast } from "./helpers/forecast-fixture.js";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("ForecastStore", () => {
  let bookDir: string;

  beforeEach(async () => {
    bookDir = await mkdtemp(join(tmpdir(), "castor-forecast-store-"));
  });
  afterEach(async () => {
    await rm(bookDir, { recursive: true, force: true });
  });

  it("saves forecast.json and comparison.md under story/runtime/narrative-forecasts/<id>/", async () => {
    const store = new ForecastStore(bookDir);
    const forecast = makeForecast();

    const saved = await store.save(forecast, "# mock_text\nmock_text");

    const expectedDir = join(bookDir, "story", "runtime", "narrative-forecasts", forecast.forecastId);
    expect(saved.forecastJsonPath).toBe(join(expectedDir, "forecast.json"));
    expect(saved.comparisonPath).toBe(join(expectedDir, "comparison.md"));
    expect(JSON.parse(await readFile(saved.forecastJsonPath, "utf-8")).forecastId).toBe(forecast.forecastId);
    expect(await readFile(saved.comparisonPath, "utf-8")).toContain("# mock_text");
  });

  it("round-trips a forecast through save and load", async () => {
    const store = new ForecastStore(bookDir);
    const forecast = makeForecast();
    await store.save(forecast, "cmp");

    const loaded = await store.load(forecast.forecastId);

    expect(loaded).toEqual(forecast);
  });

  it("refuses to save an invalid forecast and leaves no files behind", async () => {
    const store = new ForecastStore(bookDir);
    const invalid = { ...makeForecast(), branches: [] };

    await expect(store.save(invalid as never, "cmp")).rejects.toThrow();
    expect(await exists(join(bookDir, "story", "runtime", "narrative-forecasts"))).toBe(false);
  });

  it("throws a not-found error with the forecast id when loading a missing forecast", async () => {
    const store = new ForecastStore(bookDir);
    await expect(store.load("fc-missing")).rejects.toThrow(/fc-missing/);
  });

  it("throws when the stored forecast.json is corrupted", async () => {
    const store = new ForecastStore(bookDir);
    const dir = join(bookDir, "story", "runtime", "narrative-forecasts", "fc-bad");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "forecast.json"), "{ not json", "utf-8");

    await expect(store.load("fc-bad")).rejects.toThrow(/fc-bad/);
  });

  it("markStale persists a stale status without mutating the input object", async () => {
    const store = new ForecastStore(bookDir);
    const forecast = makeForecast();
    await store.save(forecast, "cmp");

    const stale = await store.markStale(forecast);

    expect(stale.status).toBe("stale");
    expect(forecast.status).toBe("active");
    expect((await store.load(forecast.forecastId)).status).toBe("stale");
  });

  it("writes selected-branch-plan.md next to forecast.json", async () => {
    const store = new ForecastStore(bookDir);
    const forecast = makeForecast();
    await store.save(forecast, "cmp");

    const planPath = await store.writeSelectedPlan(forecast.forecastId, "# mock_text");

    expect(planPath).toBe(join(
      bookDir, "story", "runtime", "narrative-forecasts", forecast.forecastId, "selected-branch-plan.md",
    ));
    expect(await readFile(planPath, "utf-8")).toContain("# mock_text");
  });

  it("derives deterministic forecast ids from the injected clock", async () => {
    const store = new ForecastStore(bookDir, { now: () => new Date("2026-07-15T08:09:10Z") });
    expect(await store.allocateForecastId()).toBe("fc-20260715-080910");
  });

  it("suffixes the forecast id when the directory already exists", async () => {
    const store = new ForecastStore(bookDir, { now: () => new Date("2026-07-15T08:09:10Z") });
    await store.save(makeForecast({ forecastId: "fc-20260715-080910" }), "cmp");

    expect(await store.allocateForecastId()).toBe("fc-20260715-080910-2");
  });

  it("prefers the injected id factory", async () => {
    const store = new ForecastStore(bookDir, { idFactory: () => "fc-custom" });
    expect(await store.allocateForecastId()).toBe("fc-custom");
  });

  it("rejects unsafe forecast ids", () => {
    expect(() => assertSafeForecastId("../escape")).toThrow();
    expect(() => assertSafeForecastId("a/b")).toThrow();
    expect(() => assertSafeForecastId("")).toThrow();
    expect(assertSafeForecastId("fc-20260715-080910")).toBe("fc-20260715-080910");
  });

  it("lists saved forecast ids", async () => {
    const store = new ForecastStore(bookDir);
    await store.save(makeForecast({ forecastId: "fc-b" }), "cmp");
    await store.save(makeForecast({ forecastId: "fc-a" }), "cmp");

    expect(await store.list()).toEqual(["fc-a", "fc-b"]);
  });
});
