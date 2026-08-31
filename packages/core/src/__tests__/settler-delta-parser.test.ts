import { describe, expect, it } from "vitest";
import { parseSettlerDeltaOutput } from "../agents/settler-delta-parser.js";

describe("parseSettlerDeltaOutput", () => {
  it("parses a valid runtime-state delta block", () => {
    const result = parseSettlerDeltaOutput([
      "=== POST_SETTLEMENT ===",
      "| mock_text | mentor-oath mock_text | mock_text |",
      "",
      "=== RUNTIME_STATE_DELTA ===",
      "```json",
      JSON.stringify({
        chapter: 12,
        currentStatePatch: {
          currentGoal: "mock_text",
          currentConflict: "mock_text",
        },
        hookOps: {
          upsert: [
            {
              hookId: "mentor-oath",
              startChapter: 8,
              type: "relationship",
              status: "progressing",
              lastAdvancedChapter: 12,
              expectedPayoff: "mock_textSu that",
              notes: "mock_text",
            },
          ],
          resolve: [],
          defer: [],
        },
        chapterSummary: {
          chapter: 12,
          title: "mock_text",
          characters: "mock_text",
          events: "mock_text",
          stateChanges: "mock_text",
          hookActivity: "mentor-oath advanced",
          mood: "mock_text",
          chapterType: "mock_text",
        },
        notes: ["mock_text，mock_text"],
      }, null, 2),
      "```",
    ].join("\n"));

    expect(result.postSettlement).toContain("mentor-oath");
    expect(result.runtimeStateDelta.chapter).toBe(12);
    expect(result.runtimeStateDelta.hookOps.upsert[0]?.hookId).toBe("mentor-oath");
    expect(result.runtimeStateDelta.chapterSummary?.title).toBe("mock_text");
  });

  it("rejects invalid runtime-state delta payloads", () => {
    expect(() =>
      parseSettlerDeltaOutput([
        "=== RUNTIME_STATE_DELTA ===",
        "```json",
        JSON.stringify({
          chapter: 12,
          hookOps: {
            upsert: [
              {
                hookId: "mentor-oath",
                startChapter: 8,
                type: "relationship",
                status: "open",
                lastAdvancedChapter: "chapter twelve",
              },
            ],
            resolve: [],
            defer: [],
          },
        }),
        "```",
      ].join("\n")),
    ).toThrow(/runtime state delta/i);
  });

  it("parses hook resolve and defer operations", () => {
    const result = parseSettlerDeltaOutput([
      "=== RUNTIME_STATE_DELTA ===",
      "```json",
      JSON.stringify({
        chapter: 20,
        hookOps: {
          upsert: [],
          mention: ["mentor-oath"],
          resolve: ["old-seal"],
          defer: ["guild-route"],
        },
        notes: [],
      }),
      "```",
    ].join("\n"));

    expect(result.runtimeStateDelta.hookOps.mention).toEqual(["mentor-oath"]);
    expect(result.runtimeStateDelta.hookOps.resolve).toEqual(["old-seal"]);
    expect(result.runtimeStateDelta.hookOps.defer).toEqual(["guild-route"]);
  });

  it("parses new hook candidates separately from existing hook ops", () => {
    const result = parseSettlerDeltaOutput([
      "=== RUNTIME_STATE_DELTA ===",
      "```json",
      JSON.stringify({
        chapter: 21,
        hookOps: {
          upsert: [],
          mention: ["mentor-oath"],
          resolve: [],
          defer: [],
        },
        newHookCandidates: [
          {
            type: "source-risk",
            expectedPayoff: "Reveal what the anonymous source already knew about the route and address",
            notes: "This chapter opens a fresh unresolved question about source knowledge.",
          },
        ],
        notes: [],
      }),
      "```",
    ].join("\n"));

    expect(result.runtimeStateDelta.hookOps.upsert).toEqual([]);
    expect(result.runtimeStateDelta.newHookCandidates).toEqual([
      expect.objectContaining({
        type: "source-risk",
      }),
    ]);
  });
});
