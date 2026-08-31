import { describe, expect, it } from "vitest";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import {
  readStoryCanon,
  readCanonSection,
  CANON_SECTIONS,
  CanonUnavailableError,
} from "../state/canon-service.js";
import { describeCurrentState } from "../state/state-projections.js";
import { captureBookMetadata, createCanonBook } from "./helpers/canon-fixture.js";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function expectCanonUnavailable(promise: Promise<unknown>): Promise<CanonUnavailableError> {
  const err = await promise.then(() => null, (e) => e);
  expect(err).toBeInstanceOf(CanonUnavailableError);
  const canonErr = err as CanonUnavailableError;
  expect(canonErr.code).toBe("canon_unavailable");
  return canonErr;
}

describe("readStoryCanon (pure validated read)", () => {
  it("returns the validated canonical view: manifest, current state, hooks, chapter summaries", async () => {
    const { bookDir } = await createCanonBook();

    const view = await readStoryCanon(bookDir);

    expect(view.manifest.schemaVersion).toBe(2);
    expect(view.manifest.lastAppliedChapter).toBe(12);
    expect(view.currentState.facts.some((f) => f.predicate === "mock_text" && f.object === "mock_text")).toBe(true);
    const promoted = view.hooks.hooks.find((h) => h.hookId === "hook-core-missing-will");
    expect(promoted?.promoted).toBe(true);
    expect(promoted?.dependsOn).toEqual(["hook-sub-neighbor"]);
    expect(view.chapterSummaries.rows[0]?.title).toBe("mock_text");
  });

  it("performs ZERO filesystem writes on healthy canon across repeated reads", async () => {
    const { bookDir } = await createCanonBook();
    await readStoryCanon(bookDir); // warm-up

    const before = await captureBookMetadata(bookDir);
    await sleep(60);
    await readStoryCanon(bookDir);
    await sleep(60);
    await readStoryCanon(bookDir);
    const after = await captureBookMetadata(bookDir);

    // Hash AND size AND mtime must all be untouched — content equality alone
    // cannot prove a file was not rewritten.
    expect(after).toEqual(before);
  });

  it("rejects missing canonical files as canon_unavailable and creates nothing", async () => {
    const { bookDir } = await createCanonBook({ omitStateJson: true });

    const before = await captureBookMetadata(bookDir);
    const err = await expectCanonUnavailable(readStoryCanon(bookDir));
    const after = await captureBookMetadata(bookDir);

    expect(err.issues.map((issue) => issue.scope).sort()).toEqual([
      "chapter_summaries.json",
      "current_state.json",
      "hooks.json",
      "manifest.json",
    ]);
    // Markdown projections exist but MUST NOT become fallback canon, and no
    // state JSON may be seeded by a read.
    expect(after).toEqual(before);
    await expect(stat(join(bookDir, "story", "state", "manifest.json"))).rejects.toThrow();
  });

  it("rejects corrupt canonical JSON as canon_unavailable without healing it", async () => {
    const { bookDir } = await createCanonBook({ corruptFile: "current_state" });

    const before = await captureBookMetadata(bookDir);
    const err = await expectCanonUnavailable(readStoryCanon(bookDir));
    const after = await captureBookMetadata(bookDir);

    expect(err.issues).toHaveLength(1);
    expect(err.issues[0]).toMatchObject({ scope: "current_state.json" });
    // The corrupt file stays byte- and mtime-identical; nothing regenerated.
    expect(after).toEqual(before);
  });

  it("rejects cross-file inconsistent structured state via canon_unavailable", async () => {
    // Valid JSON on disk but current_state chapter ahead of manifest.
    const { bookDir } = await createCanonBook({ stateChapterAhead: true });

    const err = await expectCanonUnavailable(readStoryCanon(bookDir));

    expect(JSON.stringify(err.issues)).toContain("current_state_ahead_of_manifest");
  });
});

describe("readCanonSection", () => {
  it("exposes the four canonical sections and rejects unknown ones", async () => {
    const { bookDir } = await createCanonBook();
    const view = await readStoryCanon(bookDir);

    expect(CANON_SECTIONS).toEqual(["manifest", "current_state", "hooks", "chapter_summaries"]);
    expect((readCanonSection(view, "manifest") as typeof view.manifest).lastAppliedChapter).toBe(12);
    expect((readCanonSection(view, "hooks") as typeof view.hooks).hooks).toHaveLength(2);

    expect(() => readCanonSection(view, "timeline" as never)).toThrow(/Unknown canon section/);
  });
});

describe("describeCurrentState", () => {
  it("maps slot facts to labeled slots, preferring the open interval and keeping closed history visible", async () => {
    const { bookDir } = await createCanonBook();
    const view = await readStoryCanon(bookDir);

    const described = describeCurrentState(view.currentState, "vi");

    expect(described.chapter).toBe(12);
    expect(described.slots).toHaveLength(6);

    const location = described.slots[0]!;
    expect(location.key).toBe("currentLocation");
    expect(location.label).toBe("mock_text");
    expect(location.value).toBe("mock_text");
    expect(location.selected?.object).toBe("mock_text");
    expect(location.superseded).toHaveLength(1);
    expect(location.superseded[0]?.object).toBe("mock_text");
    expect(location.superseded[0]?.validUntilChapter).toBe(10);

    const protagonist = described.slots.find((slot) => slot.key === "protagonistState")!;
    expect(protagonist.value).toBe("mock_text，mock_text");

    // Unset slots surface as null values without inventing data.
    const goal = described.slots.find((slot) => slot.key === "currentGoal")!;
    expect(goal.value).toBeNull();
    expect(goal.selected).toBeNull();
    expect(goal.superseded).toHaveLength(0);
  });

  it("keeps every non-slot fact visible under additionalFacts", async () => {
    const { bookDir } = await createCanonBook();
    const view = await readStoryCanon(bookDir);

    const described = describeCurrentState(view.currentState, "vi");

    expect(described.additionalFacts).toHaveLength(1);
    expect(described.additionalFacts[0]).toMatchObject({
      subject: "mock_text",
      predicate: "mock_text",
      object: "mock_text",
      validFromChapter: 4,
      validUntilChapter: null,
      sourceChapter: 4,
    });
  });

  it("localizes labels and honors alternate aliases (Current Relationships → alliances)", async () => {
    const { bookDir } = await createCanonBook();
    const view = await readStoryCanon(bookDir);

    const en = describeCurrentState(view.currentState, "en");
    expect(en.slots[0]!.label).toBe("Current Location");

    const enDescribed = describeCurrentState(
      {
        chapter: 3,
        facts: [
          {
            subject: "Kara",
            predicate: "Current Relationships",
            object: "allied with Mori",
            validFromChapter: 2,
            validUntilChapter: null,
            sourceChapter: 2,
          },
        ],
      },
      "en",
    );
    const alliances = enDescribed.slots.find((slot) => slot.key === "currentAlliances")!;
    expect(alliances.value).toBe("allied with Mori");
    expect(alliances.selected?.predicate).toBe("Current Relationships");
  });
});
