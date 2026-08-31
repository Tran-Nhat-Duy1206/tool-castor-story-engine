import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArchitectAgent } from "../agents/architect.js";
import type { BookConfig } from "../models/book.js";
import { parsePendingHooksMarkdown } from "../utils/story-markdown.js";

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

function buildAgent(): ArchitectAgent {
  return new ArchitectAgent({
    client: {
      provider: "openai",
      apiFormat: "chat",
      stream: false,
      defaults: {
        temperature: 0.7,
        maxTokens: 4096,
        thinkingBudget: 0,
        maxTokensCap: null,
        extra: {},
      },
    },
    model: "test-model",
    projectRoot: process.cwd(),
  });
}

function baseBook(): BookConfig {
  return {
    id: "phase7-book",
    title: "Phase7Testmock_text",
    platform: "other",
    genre: "urban",
    status: "active",
    targetChapters: 80,
    chapterWordCount: 2200,
    language: "vi",
    createdAt: "2026-04-15T00:00:00.000Z",
    updatedAt: "2026-04-15T00:00:00.000Z",
  };
}

const PHASE7_RESPONSE = [
  "=== SECTION: story_frame ===",
  "## mock_text",
  "mock_text。",
  "=== SECTION: volume_map ===",
  "## mock_text",
  "mock_text，Chương 1mock_text 1-20 mock_text。",
  "=== SECTION: rhythm_principles ===",
  "## mock_text 1",
  "mock_text 10 mock_text。",
  "=== SECTION: roles ===",
  "---ROLE---",
  "tier: major",
  "name: mock_text",
  "---CONTENT---",
  "## mock_text",
  "mock_text",
  "## mock_text",
  "mock_text",
  "## mock_text",
  "mock_text。",
  "## mock_text",
  "mock_textPhong so sach。",
  "## mock_text",
  "mock_text。",
  "## mock_text",
  "mock_textSu that。",
  "## mock_text",
  "mock_text。",
  "=== SECTION: book_rules ===",
  "---",
  "version: \"1.0\"",
  "---",
  "## mock_text",
  "Chương mock_text。",
  "=== SECTION: current_state ===",
  "|  từmock_text | mock_text |",
  "| --- | --- |",
  "| mock_text | 0 |",
  "",
  "=== SECTION: pending_hooks ===",
  "| hook_id | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  "| H01 | 1 | mock_text | mock_text | 0 | mock_text | mock_text | mock_text | Chương 3mock_text | mock_text | 80 | mock_text |",
  "| H02 | 3 | mock_text | mock_text | 0 | Chương 2mock_text | mock_text | [H01] | Chương 2mock_text | mock_text | 30 | mock_text |",
  "| H03 | 7 | mock_text | mock_text | 0 | 15mock_text | mock_text | mock_text | Chương 1mock_text | mock_text |  | mock_text |",
].join("\n");

describe("ArchitectAgent — Phase 7 extended hook frontmatter", () => {
  let bookDir: string;

  beforeEach(async () => {
    bookDir = await mkdtemp(join(tmpdir(), "castor-phase7-arch-"));
  });

  afterEach(async () => {
    await rm(bookDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("architect prompt instructs depends_on / pays_off_in_arc / core_hook / half_life", async () => {
    const agent = buildAgent();
    const chat = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({ content: PHASE7_RESPONSE, usage: ZERO_USAGE });

    await agent.generateFoundation(baseBook());

    const messages = chat.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    const system = messages[0]?.content ?? "";
    // The zh prompt must document all four new columns with clear rules.
    expect(system).toContain("mock_text");
    expect(system).toContain("mock_text");
    expect(system).toContain("mock_text");
    expect(system).toContain("mock_text");
    expect(system).toContain("mock_text open");
    // Core-hook budget guidance: 3-7 per book.
    expect(system).toContain("3-7 mock_text");
    // The extended table header must appear in the prompt example.
    expect(system).toContain("| hook_id | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text |");
  });

  it("round-trips extended columns through parseSections into the ledger", async () => {
    const agent = buildAgent();
    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({ content: PHASE7_RESPONSE, usage: ZERO_USAGE });

    const result = await agent.generateFoundation(baseBook());

    // Phase 7 hotfix 1: rendered ledger now includes a 12th column `mock_text`
    // (half_life) so architect-supplied values persist through the projection
    // roundtrip and are read by hook-stale-detection. Hooks without an explicit
    // half_life render an empty cell (parser falls back to timing default).
    // Hotfix 2 adds a 13th `mock_text` (promoted) column — architect computes it
    // from core_hook / depends_on / cross_volume at seed time. H01 (core=mock_text)
    // and H02 (depends_on=[H01]) both get promoted=mock_text; H03 has no rule firing.
    expect(result.pendingHooks).toContain("| hook_id | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text |");
    expect(result.pendingHooks).toContain("| H01 | 1 | mock_text | mock_text | 0 | mock_text | mock_text | mock_text | Chương 3mock_text | mock_text | 80 | mock_text | mock_text |");
    expect(result.pendingHooks).toContain("| H02 | 3 | mock_text | mock_text | 0 | Chương 2mock_text | mock_text | [H01] | Chương 2mock_text | mock_text | 30 | mock_text | mock_text |");
    // H03 omits half_life; cell renders empty. No rule fires so mock_text=mock_text.
    expect(result.pendingHooks).toContain("| H03 | 7 | mock_text | mock_text | 0 | 15mock_text | mock_text | mock_text | Chương 1mock_text | mock_text |  | mock_text | mock_text |");
  });

  it("pending_hooks.md on disk carries the Phase 7 columns", async () => {
    const agent = buildAgent();
    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({ content: PHASE7_RESPONSE, usage: ZERO_USAGE });

    const result = await agent.generateFoundation(baseBook());
    await agent.writeFoundationFiles(bookDir, result, false, "vi");

    const disk = await readFile(join(bookDir, "story", "pending_hooks.md"), "utf-8");
    expect(disk).toContain("mock_text");
    expect(disk).toContain("mock_text");
    expect(disk).toContain("mock_text");
    // Second row's depends_on column should be [H01].
    expect(disk).toMatch(/\| H02 \|.*\| \[H01\] \|/);
  });

  it("parsePendingHooksMarkdown reads the extended ledger shape", async () => {
    const agent = buildAgent();
    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({ content: PHASE7_RESPONSE, usage: ZERO_USAGE });

    const result = await agent.generateFoundation(baseBook());

    const hooks = parsePendingHooksMarkdown(result.pendingHooks);
    expect(hooks).toHaveLength(3);

    const h01 = hooks.find((h) => h.hookId === "H01")!;
    expect(h01.coreHook).toBe(true);
    expect(h01.paysOffInArc).toBe("Chương 3mock_text");
    expect(h01.dependsOn ?? []).toEqual([]);

    const h02 = hooks.find((h) => h.hookId === "H02")!;
    expect(h02.coreHook).toBe(false);
    expect(h02.dependsOn).toEqual(["H01"]);
    expect(h02.paysOffInArc).toBe("Chương 2mock_text");

    // Phase 7 hotfix 1: half_life survives the roundtrip.
    expect(h01.halfLifeChapters).toBe(80);
    expect(h02.halfLifeChapters).toBe(30);
    // H03 omitted half_life — falls back to undefined, not a default.
    const h03 = hooks.find((h) => h.hookId === "H03")!;
    expect(h03.halfLifeChapters).toBeUndefined();
  });

  it("legacy 8-column pending_hooks tables still parse without new fields (backward compat)", () => {
    const legacy = [
      "| hook_id | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      "| L01 | 1 | mock_text | mock_text | 0 | 15mock_text | mock_text | mock_text |",
    ].join("\n");

    const hooks = parsePendingHooksMarkdown(legacy);
    expect(hooks).toHaveLength(1);
    const hook = hooks[0]!;
    expect(hook.hookId).toBe("L01");
    expect(hook.coreHook).toBeUndefined();
    expect(hook.dependsOn).toBeUndefined();
    expect(hook.paysOffInArc).toBeUndefined();
    expect(hook.halfLifeChapters).toBeUndefined();
  });
});
