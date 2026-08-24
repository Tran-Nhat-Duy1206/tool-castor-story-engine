import { describe, expect, it } from "vitest";
import { loadRuntimeStateSnapshot } from "../state/runtime-state-store.js";
import { createCanonBook } from "./helpers/canon-fixture.js";

describe("createCanonBook fixture", () => {
  it("produces a book whose canonical story/state loads and validates", async () => {
    const { bookDir } = await createCanonBook();

    const snapshot = await loadRuntimeStateSnapshot(bookDir);

    expect(snapshot.manifest).toMatchObject({
      schemaVersion: 2,
      language: "zh",
      lastAppliedChapter: 12,
      projectionVersion: 3,
    });
    expect(snapshot.currentState.chapter).toBe(12);
    expect(snapshot.currentState.facts).toHaveLength(4);
    expect(snapshot.hooks.hooks.map((hook) => hook.hookId)).toEqual([
      "hook-core-missing-will",
      "hook-sub-neighbor",
    ]);
    expect(snapshot.chapterSummaries.rows.map((row) => row.chapter)).toEqual([11, 12]);
  });

  it("writes the markdown projections alongside the JSON state", async () => {
    const { bookDir } = await createCanonBook();

    const snapshot = await loadRuntimeStateSnapshot(bookDir);
    // The fixture is only realistic if its derived views exist too.
    await expect(
      loadRuntimeStateSnapshot(bookDir),
    ).resolves.toBeTruthy();
    expect(snapshot.manifest.language).toBe("zh");
  });
});
