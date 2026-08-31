import { describe, expect, it } from "vitest";
import { applyRuntimeStateDelta } from "../state/state-reducer.js";
import { RuntimeStateDeltaSchema } from "../models/runtime-state.js";

describe("applyRuntimeStateDelta", () => {
  it("applies a chapter-local delta into structured state", () => {
    const result = applyRuntimeStateDelta({
      snapshot: {
        manifest: {
          schemaVersion: 2,
          language: "en",
          lastAppliedChapter: 11,
          projectionVersion: 1,
          migrationWarnings: [],
        },
        currentState: {
          chapter: 11,
          facts: [],
        },
        hooks: {
          hooks: [
            {
              hookId: "mentor-debt",
              startChapter: 1,
              type: "relationship",
              status: "open",
              lastAdvancedChapter: 11,
              expectedPayoff: "Reveal the debt.",
              notes: "Still unresolved.",
            },
          ],
        },
        chapterSummaries: {
          rows: [
            {
              chapter: 11,
              title: "Old Ledger",
              characters: "Lin Yue",
              events: "Lin Yue finds the old ledger.",
              stateChanges: "The debt trail tightens.",
              hookActivity: "mentor-debt advanced",
              mood: "tense",
              chapterType: "mainline",
            },
          ],
        },
      },
      delta: RuntimeStateDeltaSchema.parse({
        chapter: 12,
        currentStatePatch: {
          currentGoal: "Trace the debt through the river-port ledger.",
        },
        hookOps: {
          upsert: [
            {
              hookId: "mentor-debt",
              startChapter: 1,
              type: "relationship",
              status: "progressing",
              lastAdvancedChapter: 12,
              expectedPayoff: "Reveal the debt.",
              notes: "The river-port ledger sharpens the clue.",
            },
          ],
          resolve: [],
          defer: [],
        },
        chapterSummary: {
          chapter: 12,
          title: "River-Port Ledger",
          characters: "Lin Yue",
          events: "Lin Yue cross-checks the river-port ledger.",
          stateChanges: "The debt trail narrows.",
          hookActivity: "mentor-debt advanced",
          mood: "tight",
          chapterType: "investigation",
        },
        notes: [],
      }),
    });

    expect(result.manifest.lastAppliedChapter).toBe(12);
    expect(result.currentState.chapter).toBe(12);
    expect(result.currentState.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          predicate: "Current Goal",
          object: "Trace the debt through the river-port ledger.",
          sourceChapter: 12,
        }),
      ]),
    );
    expect(result.hooks.hooks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          hookId: "mentor-debt",
          status: "progressing",
          lastAdvancedChapter: 12,
        }),
      ]),
    );
    expect(result.chapterSummaries.rows.map((row) => row.chapter)).toEqual([11, 12]);
  });

  it("rejects duplicate summary rows for the same chapter", () => {
    expect(() =>
      applyRuntimeStateDelta({
        snapshot: {
          manifest: {
            schemaVersion: 2,
            language: "vi",
            lastAppliedChapter: 11,
            projectionVersion: 1,
            migrationWarnings: [],
          },
          currentState: {
            chapter: 11,
            facts: [],
          },
          hooks: {
            hooks: [],
          },
          chapterSummaries: {
            rows: [
              {
                chapter: 12,
                title: "mock_text",
                characters: "mock_text",
                events: "mock_text。",
                stateChanges: "mock_text。",
                hookActivity: "mentor-debt mock_text",
                mood: "mock_text",
                chapterType: "mock_text",
              },
            ],
          },
        },
        delta: RuntimeStateDeltaSchema.parse({
          chapter: 12,
          hookOps: {
            upsert: [],
            resolve: [],
            defer: [],
          },
          chapterSummary: {
            chapter: 12,
            title: "mock_text",
            characters: "mock_text",
            events: "mock_text。",
            stateChanges: "mock_text。",
            hookActivity: "mentor-debt mock_text",
            mood: "mock_text",
            chapterType: "mock_text",
          },
          notes: [],
        }),
      }),
    ).toThrow(/duplicate summary/i);
  });

  it("allows reapplying the same chapter when explicitly enabled", () => {
    const result = applyRuntimeStateDelta({
      snapshot: {
        manifest: {
          schemaVersion: 2,
          language: "vi",
          lastAppliedChapter: 12,
          projectionVersion: 1,
          migrationWarnings: [],
        },
        currentState: {
          chapter: 12,
          facts: [],
        },
        hooks: {
          hooks: [],
        },
        chapterSummaries: {
          rows: [
            {
              chapter: 12,
              title: "mock_text",
              characters: "mock_text",
              events: "mock_text。",
              stateChanges: "mock_text。",
              hookActivity: "mock_text",
              mood: "mock_text",
              chapterType: "mock_text",
            },
          ],
        },
      },
      delta: RuntimeStateDeltaSchema.parse({
        chapter: 12,
        hookOps: {
          upsert: [],
          resolve: [],
          defer: [],
        },
        chapterSummary: {
          chapter: 12,
          title: "mock_text",
          characters: "mock_text",
          events: "mock_text。",
          stateChanges: "mock_text。",
          hookActivity: "mock_text",
          mood: "mock_text",
          chapterType: "mock_text",
        },
        notes: [],
      }),
      allowReapply: true,
    });

    expect(result.manifest.lastAppliedChapter).toBe(12);
    expect(result.chapterSummaries.rows).toEqual([
      expect.objectContaining({
        chapter: 12,
        title: "mock_text",
        events: "mock_text。",
      }),
    ]);
  });

  it("ignores resolve and defer operations for unknown hooks", () => {
    const result = applyRuntimeStateDelta({
      snapshot: {
        manifest: {
          schemaVersion: 2,
          language: "en",
          lastAppliedChapter: 11,
          projectionVersion: 1,
          migrationWarnings: [],
        },
        currentState: {
          chapter: 11,
          facts: [],
        },
        hooks: {
          hooks: [],
        },
        chapterSummaries: {
          rows: [],
        },
      },
      delta: RuntimeStateDeltaSchema.parse({
        chapter: 12,
        hookOps: {
          upsert: [],
          resolve: ["mentor-debt"],
          defer: ["mentor-debt-later"],
        },
        notes: [],
      }),
    });

    expect(result.manifest.lastAppliedChapter).toBe(12);
    expect(result.hooks.hooks).toEqual([]);
  });

  it("keeps mention-only hooks from mutating lastAdvancedChapter", () => {
    const result = applyRuntimeStateDelta({
      snapshot: {
        manifest: {
          schemaVersion: 2,
          language: "en",
          lastAppliedChapter: 11,
          projectionVersion: 1,
          migrationWarnings: [],
        },
        currentState: {
          chapter: 11,
          facts: [],
        },
        hooks: {
          hooks: [
            {
              hookId: "mentor-debt",
              startChapter: 1,
              type: "relationship",
              status: "open",
              lastAdvancedChapter: 8,
              expectedPayoff: "Reveal the debt.",
              notes: "Still unresolved.",
            },
          ],
        },
        chapterSummaries: {
          rows: [],
        },
      },
      delta: RuntimeStateDeltaSchema.parse({
        chapter: 12,
        hookOps: {
          upsert: [],
          mention: ["mentor-debt"],
          resolve: [],
          defer: [],
        },
        notes: [],
      }),
    });

    expect(result.hooks.hooks).toEqual([
      expect.objectContaining({
        hookId: "mentor-debt",
        lastAdvancedChapter: 8,
        status: "open",
      }),
    ]);
  });

  it("does not downgrade an existing progressed hook when the next delta restates it as open", () => {
    const result = applyRuntimeStateDelta({
      snapshot: {
        manifest: {
          schemaVersion: 2,
          language: "vi",
          lastAppliedChapter: 2,
          projectionVersion: 1,
          migrationWarnings: [],
        },
        currentState: {
          chapter: 2,
          facts: [],
        },
        hooks: {
          hooks: [
            {
              hookId: "pressure-record",
              startChapter: 1,
              type: "evidence",
              status: "progressing",
              lastAdvancedChapter: 2,
              expectedPayoff: "Cong khaimock_text từmock_text。",
              notes: "Chương 2mock_text。",
            },
          ],
        },
        chapterSummaries: {
          rows: [],
        },
      },
      delta: RuntimeStateDeltaSchema.parse({
        chapter: 3,
        hookOps: {
          upsert: [
            {
              hookId: "pressure-record",
              startChapter: 1,
              type: "evidence",
              status: "open",
              lastAdvancedChapter: 2,
              expectedPayoff: "Cong khaimock_text từmock_text。",
              notes: "Chương 3mock_text，mock_text。",
            },
          ],
          mention: [],
          resolve: [],
          defer: [],
        },
        notes: [],
      }),
    });

    expect(result.hooks.hooks).toEqual([
      expect.objectContaining({
        hookId: "pressure-record",
        status: "progressing",
        lastAdvancedChapter: 2,
      }),
    ]);
  });

  it("does not resurrect a resolved hook when the next delta restates it as open", () => {
    const result = applyRuntimeStateDelta({
      snapshot: {
        manifest: {
          schemaVersion: 2,
          language: "vi",
          lastAppliedChapter: 8,
          projectionVersion: 1,
          migrationWarnings: [],
        },
        currentState: {
          chapter: 8,
          facts: [],
        },
        hooks: {
          hooks: [
            {
              hookId: "sealed-toolbox",
              startChapter: 1,
              type: "evidence",
              status: "resolved",
              lastAdvancedChapter: 8,
              expectedPayoff: "mock_text。",
              notes: "Chương 8mock_text。",
            },
          ],
        },
        chapterSummaries: {
          rows: [],
        },
      },
      delta: RuntimeStateDeltaSchema.parse({
        chapter: 9,
        hookOps: {
          upsert: [
            {
              hookId: "sealed-toolbox",
              startChapter: 1,
              type: "evidence",
              status: "open",
              lastAdvancedChapter: 8,
              expectedPayoff: "mock_text。",
              notes: "Chương 9mock_text，mock_text。",
            },
          ],
          mention: [],
          resolve: [],
          defer: [],
        },
        notes: [],
      }),
    });

    expect(result.hooks.hooks).toEqual([
      expect.objectContaining({
        hookId: "sealed-toolbox",
        status: "resolved",
        lastAdvancedChapter: 8,
      }),
    ]);
  });

  it("does not infer semantic identity between different hook ids", () => {
    const result = applyRuntimeStateDelta({
      snapshot: {
        manifest: {
          schemaVersion: 2,
          language: "en",
          lastAppliedChapter: 11,
          projectionVersion: 1,
          migrationWarnings: [],
        },
        currentState: {
          chapter: 11,
          facts: [],
        },
        hooks: {
          hooks: [
            {
              hookId: "anonymous-source-scope",
              startChapter: 3,
              type: "source-risk",
              status: "open",
              lastAdvancedChapter: 8,
              expectedPayoff: "Reveal how much the anonymous source already knew about the route and address.",
              notes: "Still unresolved anonymous source knowledge question.",
            },
          ],
        },
        chapterSummaries: {
          rows: [],
        },
      },
      delta: RuntimeStateDeltaSchema.parse({
        chapter: 12,
        hookOps: {
          upsert: [
            {
              hookId: "anonymous-source-restated",
              startChapter: 12,
              type: "source-risk",
              status: "open",
              lastAdvancedChapter: 12,
              expectedPayoff: "Reveal how much the anonymous source already knew about the route.",
              notes: "Anonymous source knowledge question restated with slightly different wording.",
            },
          ],
          mention: [],
          resolve: [],
          defer: [],
        },
        notes: [],
      }),
    });

    expect(result.hooks.hooks).toHaveLength(2);
    expect(result.hooks.hooks.map((hook) => hook.hookId)).toEqual([
      "anonymous-source-scope",
      "anonymous-source-restated",
    ]);
  });
});
