import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parsePendingHooksMarkdown,
  retrieveMemorySelection,
} from "../utils/memory-retrieval.js";
import { MemoryDB } from "../state/memory-db.js";

describe("retrieveMemorySelection", () => {
  let root = "";

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true });
      root = "";
    }
  });

  it("indexes current state facts into sqlite-backed memory selection", async () => {
    root = await mkdtemp(join(tmpdir(), "castor-memory-retrieval-test-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(
        join(storyDir, "current_state.md"),
        [
          "# Current State",
          "",
          "| Field | Value |",
          "| --- | --- |",
          "| Current Chapter | 9 |",
          "| Current Location | Ashen ferry crossing |",
          "| Protagonist State | Lin Yue hides the broken oath token and the old wound has reopened. |",
          "| Current Goal | Find the vanished mentor before the guild covers its tracks. |",
          "| Current Conflict | Mentor debt with the vanished teacher blocks every choice. |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(join(storyDir, "chapter_summaries.md"), "# Chapter Summaries\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
    ]);

    const result = await retrieveMemorySelection({
      bookDir,
      chapterNumber: 10,
      goal: "Bring the focus back to the vanished mentor conflict.",
      mustKeep: ["Lin Yue hides the broken oath token and the old wound has reopened."],
    });

    expect(result.facts.length).toBeGreaterThan(0);
    expect(result.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          predicate: "Current Conflict",
          object: "Mentor debt with the vanished teacher blocks every choice.",
          validFromChapter: 9,
          sourceChapter: 9,
        }),
      ]),
    );
    expect(result.dbPath).toContain("memory.db");
    expect(result.retrievalTrace.engine).toBe("sqlite-fts5-bm25");
  });

  it("does not treat unpromoted hook seeds as active debt", async () => {
    root = await mkdtemp(join(tmpdir(), "castor-memory-retrieval-hook-seeds-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(join(storyDir, "current_state.md"), "# Current State\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), "# Chapter Summaries\n", "utf-8"),
      writeFile(
        join(storyDir, "pending_hooks.md"),
        [
          "| hook_id | start_chapter | type | status | last_advanced | expected_payoff | payoff_timing | depends_on | pays_off_in_arc | core_hook | half_life | promoted | notes |",
          "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
          "| H-live | 3 | mock_text | open | 8 | Chương 12Cong khaimock_text | mock_text | mock_text | Chương mock_text | mock_text | 10 | mock_text | mock_text |",
          "| H-seed | 4 | mock_text | open | 0 | Chương 16mock_text | mock_text | mock_text | Chương mock_text | mock_text | 10 | mock_text | mock_text、mock_text |",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const result = await retrieveMemorySelection({
      bookDir,
      chapterNumber: 18,
      goal: "mock_text。",
      outlineNode: "mock_text。",
    });

    expect(result.activeHooks.map((hook) => hook.hookId)).toEqual(["H-live"]);
    expect(result.recyclableHooks.map((hook) => hook.hookId)).toEqual(["H-live"]);
    expect(result.hooks.map((hook) => hook.hookId)).not.toContain("H-seed");
  });

  it("retrieves a relevant deferred seed without promoting it to active debt", async () => {
    root = await mkdtemp(join(tmpdir(), "castor-memory-retrieval-deferred-seed-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(join(storyDir, "current_state.md"), "# mock_text\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), "# mock_text\n", "utf-8"),
      writeFile(
        join(storyDir, "pending_hooks.md"),
        [
          "| hook_id | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | depends_on | mock_text | mock_text | mock_text | mock_text | mock_text |",
          "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
          "| H012 | 0 | mock_text（mock_text） | deferred | 0 | Chương mock_text | mock_text | mock_text | Chương mock_text | mock_text | 10 | mock_text | mock_text，mock_text |",
          "| H099 | 0 | mock_text | deferred | 0 | Chương mock_text | mock_text | mock_text | Chương mock_text | mock_text | 30 | mock_text | mock_text |",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const result = await retrieveMemorySelection({
      bookDir,
      chapterNumber: 1,
      goal: "mock_text，mock_text。",
    });

    expect(result.activeHooks).toEqual([]);
    expect(result.recyclableHooks).toEqual([]);
    expect(result.hooks.map((hook) => hook.hookId)).toContain("H012");
    expect(result.hooks.map((hook) => hook.hookId)).not.toContain("H099");
    expect(result.retrievalTrace.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "hook:H012" }),
    ]));
  });

  it("prefers the mentor-debt recap chapter over nearby guild-noise chapters in English retrieval", async () => {
    root = await mkdtemp(join(tmpdir(), "castor-memory-retrieval-en-test-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(
        join(storyDir, "current_state.md"),
        [
          "| Field | Value |",
          "| --- | --- |",
          "| Current Chapter | 10 |",
          "| Current Goal | Continue tracing the mentor debt |",
          "| Current Conflict | Mentor debt mainline vs guild safe route |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "pending_hooks.md"),
        [
          "| hook_id | start_chapter | type | status | last_advanced | expected_payoff | notes |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| mentor-debt | 1 | relationship | open | 10 | 16 | The mentor debt remains unresolved |",
          "| guild-route | 1 | mystery | open | 9 | 12 | The guild keeps offering a safer road |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| 6 | Guild Pressure 6 | Lin Yue | Guild pressure keeps building around the safe route | Guild route remains noisy | guild-route probed | restrained | holding-pattern |",
          "| 7 | Guild Pressure 7 | Lin Yue | Guild pressure keeps building around the safe route | Guild route remains noisy | guild-route probed | restrained | holding-pattern |",
          "| 8 | Guild Pressure 8 | Lin Yue | Guild pressure keeps building around the safe route | Guild route remains noisy | guild-route probed | restrained | holding-pattern |",
          "| 9 | Guild Pressure 9 | Lin Yue | Guild pressure keeps building around the safe route | Guild route remains noisy | guild-route probed | restrained | holding-pattern |",
          "| 10 | Mentor Debt Echo 10 | Lin Yue | Lin Yue returns to the mentor debt trail and checks the oath token again | Commitment to the mentor debt hardens | mentor-debt advanced | tense | mainline |",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const result = await retrieveMemorySelection({
      bookDir,
      chapterNumber: 11,
      goal: "Pull focus back to the mentor debt and do not let the guild route overtake the mainline.",
      outlineNode: "Handle guild noise without letting the guild route overtake the mentor-debt mainline.",
      mustKeep: ["Lin Yue does not abandon the mentor debt."],
    });

    expect(result.summaries.map((summary) => summary.chapter)).toContain(10);
  });

  it("prefers the explicit mock_text chapter over nearby mock_text chapters in Chinese retrieval", async () => {
    root = await mkdtemp(join(tmpdir(), "castor-memory-retrieval-zh-test-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(
        join(storyDir, "current_state.md"),
        [
          "|  từmock_text | mock_text |",
          "| --- | --- |",
          "| mock_text | 50 |",
          "| mock_text | mock_text |",
          "| mock_text | mock_text vs mock_text |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "pending_hooks.md"),
        [
          "| hook_id | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| mentor-debt | 1 | relationship | open | 50 | 60 | mock_textSu thatmock_text |",
          "| guild-route | 1 | mystery | open | 49 | 55 | mock_text |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "| mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| 46 | mock_text46 | mock_text | mock_text | mock_text | guild-route mock_text | mock_text | mock_text |",
          "| 47 | mock_text47 | mock_text | mock_text | mock_text | guild-route mock_text | mock_text | mock_text |",
          "| 48 | mock_text48 | mock_text | mock_text | mock_text | guild-route mock_text | mock_text | mock_text |",
          "| 49 | mock_text49 | mock_text | mock_text | mock_text | guild-route mock_text | mock_text | mock_text |",
          "| 50 | mock_text50 | mock_text | mock_text，mock_text | mock_textSu thatmock_text | mentor-debt mock_text | mock_text | mock_text |",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const result = await retrieveMemorySelection({
      bookDir,
      chapterNumber: 51,
      goal: "Chương 51mock_text，mock_text。",
      outlineNode: "mock_text，mock_text。",
      mustKeep: ["mock_text。"],
    });

    expect(result.summaries.map((summary) => summary.chapter)).toContain(50);
  });

  it("backfills sqlite memory from structured state instead of stale markdown truth files", async () => {
    root = await mkdtemp(join(tmpdir(), "castor-memory-retrieval-db-structured-test-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    const stateDir = join(storyDir, "state");
    await mkdir(stateDir, { recursive: true });

    await Promise.all([
      writeFile(
        join(storyDir, "current_state.md"),
        [
          "| Field | Value |",
          "| --- | --- |",
          "| Current Chapter | 9 |",
          "| Current Conflict | Old markdown conflict |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "pending_hooks.md"),
        [
          "| hook_id | start_chapter | type | status | last_advanced | expected_payoff | notes |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| markdown-hook | 1 | mystery | open | 9 | 12 | Old markdown hook |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| 9 | Markdown Summary | Lin Yue | Old markdown events | Old markdown state | markdown-hook advanced | tense | fallback |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "manifest.json"),
        JSON.stringify({
          schemaVersion: 2,
          language: "en",
          lastAppliedChapter: 12,
          projectionVersion: 1,
          migrationWarnings: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "current_state.json"),
        JSON.stringify({
          chapter: 12,
          facts: [
            {
              subject: "protagonist",
              predicate: "Current Conflict",
              object: "Structured conflict should win.",
              validFromChapter: 12,
              validUntilChapter: null,
              sourceChapter: 12,
            },
          ],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "hooks.json"),
        JSON.stringify({
          hooks: [
            {
              hookId: "structured-hook",
              startChapter: 10,
              type: "relationship",
              status: "progressing",
              lastAdvancedChapter: 12,
              expectedPayoff: "Structured payoff",
              notes: "Structured hook should win.",
            },
          ],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "chapter_summaries.json"),
        JSON.stringify({
          rows: [
            {
              chapter: 12,
              title: "Structured Summary",
              characters: "Lin Yue",
              events: "Structured events should win.",
              stateChanges: "Structured state should win.",
              hookActivity: "structured-hook advanced",
              mood: "tight",
              chapterType: "mainline",
            },
          ],
        }, null, 2),
        "utf-8",
      ),
    ]);

    const result = await retrieveMemorySelection({
      bookDir,
      chapterNumber: 13,
      goal: "Bring the focus back to the structured hook.",
      mustKeep: ["Structured conflict should win."],
    });

    expect(result.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          object: "Structured conflict should win.",
          sourceChapter: 12,
        }),
      ]),
    );
    expect(result.hooks.map((hook) => hook.hookId)).toContain("structured-hook");
    expect(result.hooks.map((hook) => hook.hookId)).not.toContain("markdown-hook");
    expect(result.summaries.map((summary) => summary.chapter)).toContain(12);
    expect(result.summaries.map((summary) => summary.title)).toContain("Structured Summary");
  });

  it("bootstraps structured runtime state from legacy markdown truth files during retrieval", async () => {
    root = await mkdtemp(join(tmpdir(), "castor-memory-retrieval-bootstrap-test-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    const stateDir = join(storyDir, "state");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(
        join(storyDir, "current_state.md"),
        [
          "| Field | Value |",
          "| --- | --- |",
          "| Current Chapter | 12 |",
          "| Current Conflict | Mentor debt mainline vs guild safe route |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "pending_hooks.md"),
        [
          "| hook_id | start_chapter | type | status | last_advanced | expected_payoff | notes |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| mentor-debt | 1 | relationship | open | 12 | 16 | The mentor debt remains unresolved |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| 12 | Mentor Debt Echo | Lin Yue | Lin Yue returns to the mentor debt trail | Commitment hardens | mentor-debt advanced | tense | mainline |",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const result = await retrieveMemorySelection({
      bookDir,
      chapterNumber: 13,
      goal: "Pull focus back to the mentor debt.",
      mustKeep: ["Lin Yue does not abandon the mentor debt."],
    });

    const manifest = JSON.parse(await readFile(join(stateDir, "manifest.json"), "utf-8"));
    const currentState = JSON.parse(await readFile(join(stateDir, "current_state.json"), "utf-8"));
    const hooks = JSON.parse(await readFile(join(stateDir, "hooks.json"), "utf-8"));
    const summaries = JSON.parse(await readFile(join(stateDir, "chapter_summaries.json"), "utf-8"));

    expect(manifest.schemaVersion).toBe(2);
    expect(currentState.chapter).toBe(12);
    expect(hooks.hooks[0]?.hookId).toBe("mentor-debt");
    expect(summaries.rows[0]?.title).toBe("Mentor Debt Echo");
    expect(result.hooks.map((hook) => hook.hookId)).toContain("mentor-debt");
  });

  it("prefers structured state files over legacy markdown truth files when both exist", async () => {
    root = await mkdtemp(join(tmpdir(), "castor-memory-retrieval-structured-preferred-test-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    const stateDir = join(storyDir, "state");
    await mkdir(stateDir, { recursive: true });

    await Promise.all([
      writeFile(
        join(storyDir, "current_state.md"),
        [
          "| Field | Value |",
          "| --- | --- |",
          "| Current Chapter | 9 |",
          "| Current Conflict | Old markdown conflict |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "pending_hooks.md"),
        [
          "| hook_id | start_chapter | type | status | last_advanced | expected_payoff | notes |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| markdown-hook | 1 | mystery | open | 9 | 12 | Old markdown hook |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| 9 | Markdown Summary | Lin Yue | Old markdown event | Old markdown state | markdown-hook advanced | tense | fallback |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(join(stateDir, "manifest.json"), JSON.stringify({
        schemaVersion: 2,
        language: "en",
        lastAppliedChapter: 12,
        projectionVersion: 1,
        migrationWarnings: [],
      }, null, 2), "utf-8"),
      writeFile(join(stateDir, "current_state.json"), JSON.stringify({
        chapter: 12,
        facts: [
          {
            subject: "protagonist",
            predicate: "Current Conflict",
            object: "Structured conflict should win.",
            validFromChapter: 12,
            validUntilChapter: null,
            sourceChapter: 12,
          },
        ],
      }, null, 2), "utf-8"),
      writeFile(join(stateDir, "hooks.json"), JSON.stringify({
        hooks: [
          {
            hookId: "structured-hook",
            startChapter: 10,
            type: "relationship",
            status: "progressing",
            lastAdvancedChapter: 12,
            expectedPayoff: "Structured payoff",
            notes: "Structured hook should win.",
          },
        ],
      }, null, 2), "utf-8"),
      writeFile(join(stateDir, "chapter_summaries.json"), JSON.stringify({
        rows: [
          {
            chapter: 12,
            title: "Structured Summary",
            characters: "Lin Yue",
            events: "Structured events should win.",
            stateChanges: "Structured state should win.",
            hookActivity: "structured-hook advanced",
            mood: "tight",
            chapterType: "mainline",
          },
        ],
      }, null, 2), "utf-8"),
    ]);

    const result = await retrieveMemorySelection({
      bookDir,
      chapterNumber: 13,
      goal: "Bring the focus back to the structured hook.",
      mustKeep: ["Structured conflict should win."],
    });

    expect(result.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          object: "Structured conflict should win.",
          sourceChapter: 12,
        }),
      ]),
    );
    expect(result.hooks.map((hook) => hook.hookId)).toContain("structured-hook");
    expect(result.hooks.map((hook) => hook.hookId)).not.toContain("markdown-hook");
    expect(result.summaries.map((summary) => summary.chapter)).toContain(12);
    expect(result.summaries.map((summary) => summary.title)).toContain("Structured Summary");
  });

  it("recalls stale open hooks alongside recent governed memory selections", async () => {
    root = await mkdtemp(join(tmpdir(), "castor-memory-retrieval-stale-hook-test-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    const stateDir = join(storyDir, "state");
    await mkdir(stateDir, { recursive: true });

    await Promise.all([
      writeFile(
        join(stateDir, "manifest.json"),
        JSON.stringify({
          schemaVersion: 2,
          language: "en",
          lastAppliedChapter: 25,
          projectionVersion: 1,
          migrationWarnings: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "current_state.json"),
        JSON.stringify({
          chapter: 25,
          facts: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "chapter_summaries.json"),
        JSON.stringify({
          rows: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "hooks.json"),
        JSON.stringify({
          hooks: [
            {
              hookId: "recent-route",
              startChapter: 22,
              type: "route",
              status: "open",
              lastAdvancedChapter: 24,
              expectedPayoff: "Recent route payoff",
              notes: "Recent but not critical.",
            },
            {
              hookId: "stale-debt",
              startChapter: 3,
              type: "relationship",
              status: "open",
              lastAdvancedChapter: 8,
              expectedPayoff: "Mentor debt payoff",
              notes: "Long-stale but still unresolved.",
            },
          ],
        }, null, 2),
        "utf-8",
      ),
    ]);

    const result = await retrieveMemorySelection({
      bookDir,
      chapterNumber: 26,
      goal: "Keep the chapter on the mainline debt conflict.",
      mustKeep: ["The mentor debt is still unresolved."],
    });

    expect(result.hooks.map((hook) => hook.hookId)).toContain("recent-route");
    expect(result.hooks.map((hook) => hook.hookId)).toContain("stale-debt");
  });

  it("surfaces one stale unresolved hook beyond the primary quota while excluding stale resolved hooks", async () => {
    root = await mkdtemp(join(tmpdir(), "castor-memory-retrieval-stale-quota-test-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    const stateDir = join(storyDir, "state");
    await mkdir(stateDir, { recursive: true });

    await Promise.all([
      writeFile(
        join(stateDir, "manifest.json"),
        JSON.stringify({
          schemaVersion: 2,
          language: "en",
          lastAppliedChapter: 40,
          projectionVersion: 1,
          migrationWarnings: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "current_state.json"),
        JSON.stringify({
          chapter: 40,
          facts: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "chapter_summaries.json"),
        JSON.stringify({
          rows: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "hooks.json"),
        JSON.stringify({
          hooks: [
            {
              hookId: "recent-route",
              startChapter: 37,
              type: "route",
              status: "open",
              lastAdvancedChapter: 39,
              expectedPayoff: "Recent route payoff",
              notes: "Recent route remains active.",
            },
            {
              hookId: "recent-guild",
              startChapter: 36,
              type: "politics",
              status: "progressing",
              lastAdvancedChapter: 38,
              expectedPayoff: "Guild payoff",
              notes: "Recent guild pressure remains active.",
            },
            {
              hookId: "recent-token",
              startChapter: 35,
              type: "artifact",
              status: "open",
              lastAdvancedChapter: 37,
              expectedPayoff: "Token payoff",
              notes: "Recent token route remains active.",
            },
            {
              hookId: "stale-omega",
              startChapter: 3,
              type: "relationship",
              status: "open",
              lastAdvancedChapter: 8,
              expectedPayoff: "Old relic payoff",
              notes: "Dormant unresolved line.",
            },
            {
              hookId: "stale-resolved",
              startChapter: 2,
              type: "mystery",
              status: "resolved",
              lastAdvancedChapter: 7,
              expectedPayoff: "Already closed",
              notes: "Should not be resurfaced.",
            },
          ],
        }, null, 2),
        "utf-8",
      ),
    ]);

    const result = await retrieveMemorySelection({
      bookDir,
      chapterNumber: 41,
      goal: "Keep the chapter on the harbor confrontation.",
      mustKeep: ["The harbor confrontation must stay central."],
    });

    expect(result.hooks.map((hook) => hook.hookId)).toEqual([
      "recent-route",
      "recent-guild",
      "recent-token",
      "stale-omega",
    ]);
    expect(result.hooks.map((hook) => hook.hookId)).not.toContain("stale-resolved");
  });

  it("surfaces multiple stale hook families when debt pressure clusters instead of only one stale extra", async () => {
    root = await mkdtemp(join(tmpdir(), "castor-memory-retrieval-stale-cluster-test-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    const stateDir = join(storyDir, "state");
    await mkdir(stateDir, { recursive: true });

    await Promise.all([
      writeFile(
        join(stateDir, "manifest.json"),
        JSON.stringify({
          schemaVersion: 2,
          language: "en",
          lastAppliedChapter: 50,
          projectionVersion: 1,
          migrationWarnings: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "current_state.json"),
        JSON.stringify({
          chapter: 50,
          facts: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "chapter_summaries.json"),
        JSON.stringify({
          rows: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "hooks.json"),
        JSON.stringify({
          hooks: [
            {
              hookId: "recent-route",
              startChapter: 47,
              type: "route",
              status: "open",
              lastAdvancedChapter: 49,
              expectedPayoff: "Recent route payoff",
              notes: "Recent route remains active.",
            },
            {
              hookId: "recent-guild",
              startChapter: 46,
              type: "politics",
              status: "progressing",
              lastAdvancedChapter: 48,
              expectedPayoff: "Guild payoff",
              notes: "Recent guild pressure remains active.",
            },
            {
              hookId: "recent-token",
              startChapter: 45,
              type: "artifact",
              status: "open",
              lastAdvancedChapter: 47,
              expectedPayoff: "Token payoff",
              notes: "Recent token route remains active.",
            },
            {
              hookId: "stale-omega",
              startChapter: 6,
              type: "relationship",
              status: "open",
              lastAdvancedChapter: 12,
              expectedPayoff: "Old relic payoff",
              notes: "Dormant unresolved relationship line.",
            },
            {
              hookId: "stale-sable",
              startChapter: 8,
              type: "mystery",
              status: "open",
              lastAdvancedChapter: 14,
              expectedPayoff: "Archive payoff",
              notes: "Dormant unresolved mystery line.",
            },
          ],
        }, null, 2),
        "utf-8",
      ),
    ]);

    const result = await retrieveMemorySelection({
      bookDir,
      chapterNumber: 51,
      goal: "Keep the chapter on the debt cluster and route pressure together.",
      mustKeep: ["The old debt cluster must stay legible."],
    });

    expect(result.hooks.map((hook) => hook.hookId)).toEqual(expect.arrayContaining([
      "stale-omega",
      "stale-sable",
    ]));
  });

  it("does not surface far-future unstarted hooks in early chapter retrieval", async () => {
    root = await mkdtemp(join(tmpdir(), "castor-memory-retrieval-future-hook-gate-test-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    const stateDir = join(storyDir, "state");
    await mkdir(stateDir, { recursive: true });

    await Promise.all([
      writeFile(
        join(stateDir, "manifest.json"),
        JSON.stringify({
          schemaVersion: 2,
          language: "vi",
          lastAppliedChapter: 0,
          projectionVersion: 1,
          migrationWarnings: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "current_state.json"),
        JSON.stringify({
          chapter: 0,
          facts: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "chapter_summaries.json"),
        JSON.stringify({
          rows: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "hooks.json"),
        JSON.stringify({
          hooks: [
            {
              hookId: "future-gault",
              startChapter: 54,
              type: "threat",
              status: "open",
              lastAdvancedChapter: 0,
              expectedPayoff: "Late assembly loss",
              notes: "Far-future disruption only.",
            },
            {
              hookId: "future-ledger-trial",
              startChapter: 22,
              type: "institutional",
              status: "open",
              lastAdvancedChapter: 0,
              expectedPayoff: "Late court hearing",
              notes: "Far-future institutional clash.",
            },
            {
              hookId: "opening-call",
              startChapter: 1,
              type: "mystery",
              status: "open",
              lastAdvancedChapter: 0,
              expectedPayoff: "Trace the anonymous caller",
              notes: "Opening anonymous call.",
            },
            {
              hookId: "nearby-ledger",
              startChapter: 4,
              type: "evidence",
              status: "open",
              lastAdvancedChapter: 0,
              expectedPayoff: "Find the first ledger fragment",
              notes: "Near-future evidence reveal.",
            },
            {
              hookId: "future-final-choice",
              startChapter: 71,
              type: "climax",
              status: "open",
              lastAdvancedChapter: 0,
              expectedPayoff: "Final disclosure choice",
              notes: "Endgame only.",
            },
          ],
        }, null, 2),
        "utf-8",
      ),
    ]);

    const result = await retrieveMemorySelection({
      bookDir,
      chapterNumber: 1,
      goal: "mock_text，mock_text。",
      mustKeep: ["mock_text。"],
    });

    expect(result.hooks.map((hook) => hook.hookId).sort()).toEqual([
      "nearby-ledger",
      "opening-call",
    ]);
  });

  it("does not resurface a resolved hook just because mustKeep shares an artifact term", async () => {
    root = await mkdtemp(join(tmpdir(), "castor-memory-retrieval-resolved-artifact-test-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    const stateDir = join(storyDir, "state");
    await mkdir(stateDir, { recursive: true });

    await Promise.all([
      writeFile(
        join(stateDir, "manifest.json"),
        JSON.stringify({
          schemaVersion: 2,
          language: "en",
          lastAppliedChapter: 10,
          projectionVersion: 1,
          migrationWarnings: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "current_state.json"),
        JSON.stringify({
          chapter: 10,
          facts: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "chapter_summaries.json"),
        JSON.stringify({
          rows: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "hooks.json"),
        JSON.stringify({
          hooks: [
            {
              hookId: "mentor-oath",
              startChapter: 8,
              type: "relationship",
              status: "open",
              lastAdvancedChapter: 9,
              expectedPayoff: "Mentor oath payoff",
              notes: "Mentor oath debt with Lin Yue",
            },
            {
              hookId: "old-seal",
              startChapter: 3,
              type: "artifact",
              status: "resolved",
              lastAdvancedChapter: 3,
              expectedPayoff: "Seal already recovered",
              notes: "Jade seal already recovered.",
            },
          ],
        }, null, 2),
        "utf-8",
      ),
    ]);

    const result = await retrieveMemorySelection({
      bookDir,
      chapterNumber: 11,
      goal: "Bring the focus back to the mentor oath conflict with Lin Yue.",
      outlineNode: "Track the merchant guild's escape route.",
      mustKeep: ["The jade seal cannot be destroyed."],
    });

    expect(result.hooks.map((hook) => hook.hookId)).toContain("mentor-oath");
    expect(result.hooks.map((hook) => hook.hookId)).not.toContain("old-seal");
  });
});

describe("parsePendingHooksMarkdown", () => {
  it("strips markdown emphasis from hook ids in pending hooks tables", () => {
    const hooks = parsePendingHooksMarkdown([
      "| hook_id | start_chapter | type | status | last_advanced | expected_payoff | notes |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      "| **H009** | 3 | mystery | open | 3 | 9 | Bold markdown leaked into hook id |",
      "| **H010** | 3 | threat | open | 3 | 6 | Another emphasized hook id |",
      "",
    ].join("\n"));

    expect(hooks.map((hook) => hook.hookId)).toEqual(["H009", "H010"]);
  });

  it("parses semantic payoff timing from extended pending hooks tables", () => {
    const hooks = parsePendingHooksMarkdown([
      "| hook_id | start_chapter | type | status | last_advanced | expected_payoff | payoff_timing | notes |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      "| oath-debt | 8 | relationship | open | 12 | Reveal why the mentor broke the oath | slow-burn | Long-buried debt stays unresolved |",
      "| kiln-key | 15 | mystery | open | 15 | Find out what the kiln key opens next chapter | immediate | Fresh key with a fast local payoff |",
      "",
    ].join("\n"));

    expect(hooks).toEqual([
      expect.objectContaining({
        hookId: "oath-debt",
        payoffTiming: "slow-burn",
        notes: "Long-buried debt stays unresolved",
      }),
      expect.objectContaining({
        hookId: "kiln-key",
        payoffTiming: "immediate",
        notes: "Fresh key with a fast local payoff",
      }),
    ]);
  });

});

// ---------------------------------------------------------------------------
// Phase 9-2 — computeRecyclableHooks unit tests
// ---------------------------------------------------------------------------

import { computeRecyclableHooks } from "../utils/memory-retrieval.js";
import type { StoredHook } from "../state/memory-db.js";

function makeHook(overrides: Partial<StoredHook> & Pick<StoredHook, "hookId">): StoredHook {
  return {
    startChapter: 1,
    type: "foreshadow",
    status: "open",
    lastAdvancedChapter: 0,
    expectedPayoff: "",
    notes: "",
    ...overrides,
  };
}

describe("computeRecyclableHooks", () => {
  it("returns empty array when no hooks are stale", () => {
    const hooks = [
      makeHook({ hookId: "H1", startChapter: 8, lastAdvancedChapter: 9, status: "pressured" }),
      makeHook({ hookId: "H2", startChapter: 9, lastAdvancedChapter: 0, status: "open" }),
    ];
    expect(computeRecyclableHooks(hooks, 10)).toEqual([]);
  });

  it("flags pressured hooks silent ≥ 5 chapters", () => {
    const hooks = [
      makeHook({ hookId: "H1", startChapter: 3, lastAdvancedChapter: 4, status: "pressured" }),
      makeHook({ hookId: "H2", startChapter: 9, lastAdvancedChapter: 9, status: "pressured" }),
    ];
    const result = computeRecyclableHooks(hooks, 10);
    expect(result.map((h) => h.hookId)).toEqual(["H1"]);
  });

  it("flags near_payoff hooks silent ≥ 5 chapters", () => {
    const hooks = [
      makeHook({ hookId: "H1", startChapter: 3, lastAdvancedChapter: 4, status: "near_payoff" }),
    ];
    const result = computeRecyclableHooks(hooks, 10);
    expect(result.map((h) => h.hookId)).toEqual(["H1"]);
  });

  it("flags core hooks silent ≥ 8 chapters (not 10)", () => {
    const hooks = [
      makeHook({ hookId: "H-core", startChapter: 2, lastAdvancedChapter: 2, status: "open", coreHook: true }),
      makeHook({ hookId: "H-regular", startChapter: 2, lastAdvancedChapter: 2, status: "open" }),
    ];
    // silence = 10 - 2 = 8. core: qualifies (>=8). regular: does not (<10).
    const result = computeRecyclableHooks(hooks, 10);
    expect(result.map((h) => h.hookId)).toEqual(["H-core"]);
  });

  it("flags plain open hooks only when silent ≥ 10 chapters", () => {
    const hooks = [
      makeHook({ hookId: "H1", startChapter: 1, lastAdvancedChapter: 0, status: "open" }),
    ];
    expect(computeRecyclableHooks(hooks, 10).map((h) => h.hookId)).toEqual([]);
    expect(computeRecyclableHooks(hooks, 11).map((h) => h.hookId)).toEqual(["H1"]);
  });

  it("excludes resolved / deferred hooks regardless of silence", () => {
    const hooks = [
      makeHook({ hookId: "H1", startChapter: 1, lastAdvancedChapter: 1, status: "resolved" }),
      makeHook({ hookId: "H2", startChapter: 1, lastAdvancedChapter: 1, status: "deferred" }),
    ];
    expect(computeRecyclableHooks(hooks, 20)).toEqual([]);
  });

  it("excludes future-planted hooks that have not yet landed", () => {
    const hooks = [
      makeHook({ hookId: "H1", startChapter: 30, lastAdvancedChapter: 0, status: "open" }),
    ];
    expect(computeRecyclableHooks(hooks, 10)).toEqual([]);
  });

  it("sorts by silence DESC — most overdue hook first", () => {
    const hooks = [
      makeHook({ hookId: "H-mid", startChapter: 2, lastAdvancedChapter: 4, status: "pressured" }),
      makeHook({ hookId: "H-worst", startChapter: 1, lastAdvancedChapter: 1, status: "pressured" }),
      makeHook({ hookId: "H-mild", startChapter: 3, lastAdvancedChapter: 5, status: "pressured" }),
    ];
    const result = computeRecyclableHooks(hooks, 10);
    expect(result.map((h) => h.hookId)).toEqual(["H-worst", "H-mid", "H-mild"]);
  });
});
