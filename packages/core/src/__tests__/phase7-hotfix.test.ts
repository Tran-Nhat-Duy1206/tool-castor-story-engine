/**
 * Phase 7 hotfix 4 — edge-case coverage for hotfixes 1/2/3.
 *
 * These tests pin down the hotfix-specific invariants that the pre-existing
 * Phase 7 suites did not cover:
 *
 *   hotfix 1: half_life roundtrips through render/parse (12-col), empty cell
 *             falls back to undefined, legacy 11-col still parses.
 *   hotfix 2: architect tags core_hook seeds as promoted=true at seed time;
 *             consolidator re-promotes seeds whose advancedCount>=2 at volume
 *             boundary; reviewer prompt gates critical severity on promoted.
 *   hotfix 3: blocked-distance computation embeds the mock_text N mock_text token.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StoredHook } from "../state/memory-db.js";
import {
  normalizeHookId,
  parsePendingHooksMarkdown,
  renderHookSnapshot,
} from "../utils/story-markdown.js";
import { computeHookDiagnostics, renderHookDiagnosticMarker } from "../utils/hook-stale-detection.js";
import { ArchitectAgent } from "../agents/architect.js";
import { ConsolidatorAgent } from "../agents/consolidator.js";
import type { BookConfig } from "../models/book.js";

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

// ---------------------------------------------------------------------------
// Hotfix 1: half_life roundtrip
// ---------------------------------------------------------------------------

describe("Phase 7 hotfix 1 — half_life roundtrip", () => {
  it("drops punctuation-only hook ids instead of preserving generated dashes", () => {
    expect(normalizeHookId("--")).toBe("");
    expect(normalizeHookId("**H--07**")).toBe("H-07");
  });

  it("renders the mock_text column and parses it back with the original value", () => {
    const hooks: StoredHook[] = [
      {
        hookId: "H-explicit",
        startChapter: 5,
        type: "mock_text",
        status: "open",
        lastAdvancedChapter: 0,
        expectedPayoff: "mock_text",
        notes: "mock_text",
        payoffTiming: "endgame",
        halfLifeChapters: 45,
      },
      {
        hookId: "H-implicit",
        startChapter: 7,
        type: "mock_text",
        status: "open",
        lastAdvancedChapter: 0,
        expectedPayoff: "15mock_text",
        notes: "mock_text",
        payoffTiming: "near-term",
      },
    ];

    const rendered = renderHookSnapshot(hooks, "vi");
    expect(rendered).toContain("| mock_text |");
    expect(rendered).toContain("| H-explicit | 5 | mock_text | open | 0 | mock_text | mock_text | mock_text |  | mock_text | 45 |  | mock_text |");
    expect(rendered).toContain("| H-implicit | 7 | mock_text | open | 0 | 15mock_text | mock_text | mock_text |  | mock_text |  |  | mock_text |");

    const parsed = parsePendingHooksMarkdown(rendered);
    const hExplicit = parsed.find((h) => h.hookId === "H-explicit")!;
    expect(hExplicit.halfLifeChapters).toBe(45);
    const hImplicit = parsed.find((h) => h.hookId === "H-implicit")!;
    expect(hImplicit.halfLifeChapters).toBeUndefined();
  });

  it("legacy 11-column pending_hooks.md still parses (half_life stays undefined)", () => {
    const legacy11 = [
      "| hook_id | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      "| L01 | 1 | mock_text | mock_text | 0 | mock_text | mock_text | mock_text | Chương 3mock_text | mock_text | mock_text |",
    ].join("\n");

    const parsed = parsePendingHooksMarkdown(legacy11);
    expect(parsed).toHaveLength(1);
    const h = parsed[0]!;
    expect(h.hookId).toBe("L01");
    expect(h.coreHook).toBe(true);
    expect(h.halfLifeChapters).toBeUndefined();
    // promoted should also be undefined on legacy 11-col data.
    expect(h.promoted).toBeUndefined();
  });

  it("hook-stale-detection honors explicit halfLifeChapters after roundtrip", () => {
    const hooks: StoredHook[] = [
      {
        hookId: "H-late",
        startChapter: 5,
        type: "mock_text",
        status: "open",
        lastAdvancedChapter: 0,
        expectedPayoff: "terminal",
        notes: "",
        payoffTiming: "near-term", // default would be 10
        halfLifeChapters: 60,
      },
    ];

    const rendered = renderHookSnapshot(hooks, "vi");
    const parsed = parsePendingHooksMarkdown(rendered);

    // distance 40 vs halfLife 60 → not stale (would have been stale with the
    // near-term default of 10).
    const diag = computeHookDiagnostics({ hooks: parsed, currentChapter: 45 }).get("H-late")!;
    expect(diag.halfLife).toBe(60);
    expect(diag.stale).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Hotfix 2: promotion wiring
// ---------------------------------------------------------------------------

function buildPhase7Response(language: "vi" = "vi"): string {
  // zh-only for brevity — we care about the promoted flag logic, not language.
  void language;
  return [
    "=== SECTION: story_frame ===",
    "## mock_text",
    "mock_text。",
    "=== SECTION: volume_map ===",
    "## mock_text",
    "### Chương mock_text：mock_text (1-20mock_text)",
    "mock_text。",
    "### Chương mock_text：mock_text (21-40mock_text)",
    "mock_text。",
    "### Chương mock_text：mock_text (41-60mock_text)",
    "mock_text。",
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
    // core_hook=mock_text → promoted mock_text
    "| H-core | 1 | mock_text | mock_text | 0 | mock_text | mock_text | mock_text | Chương 3mock_text | mock_text | 80 | mock_text |",
    // depends_on non-empty → promoted mock_text
    "| H-dep | 5 | mock_text | mock_text | 0 | Chương 2mock_text | mock_text | [H-core] | Chương 2mock_text | mock_text | 30 | mock_text |",
    // cross_volume via slow-burn in vol 1 → promoted mock_text
    "| H-slow | 3 | mock_text | mock_text | 0 | mock_text | mock_text | mock_text | Chương 3mock_text | mock_text |  | mock_text |",
    // local, no rule firing → promoted mock_text
    "| H-local | 8 | mock_text | mock_text | 0 | 15mock_text | mock_text | mock_text | Chương 1mock_text | mock_text |  | mock_text |",
  ].join("\n");
}

function buildArchitectAgent(): ArchitectAgent {
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
    id: "phase7-hotfix-book",
    title: "hotfixTestmock_text",
    platform: "other",
    genre: "urban",
    status: "active",
    targetChapters: 60,
    chapterWordCount: 2000,
    language: "vi",
    createdAt: "2026-04-15T00:00:00.000Z",
    updatedAt: "2026-04-15T00:00:00.000Z",
  };
}

describe("Phase 7 hotfix 2 — architect pre-promotes structural seeds", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("tags core_hook / depends_on / cross_volume seeds as promoted=mock_text, others as promoted=mock_text", async () => {
    const agent = buildArchitectAgent();
    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({ content: buildPhase7Response(), usage: ZERO_USAGE });

    const result = await agent.generateFoundation(baseBook());

    // H-core: core_hook=mock_text → mock_text=mock_text
    expect(result.pendingHooks).toMatch(/\| H-core \|.*\| mock_text \| mock_text \|/);
    // H-dep: depends_on=[H-core] → mock_text=mock_text
    expect(result.pendingHooks).toMatch(/\| H-dep \|.*\| mock_text \| mock_text \|/);
    // H-slow: slow-burn in vol 1 → mock_text=mock_text (cross_volume)
    expect(result.pendingHooks).toMatch(/\| H-slow \|.*\| mock_text \| mock_text \|/);
    // H-local: no rule firing → mock_text=mock_text
    expect(result.pendingHooks).toMatch(/\| H-local \|.*\| mock_text \| mock_text \|/);

    const parsed = parsePendingHooksMarkdown(result.pendingHooks);
    expect(parsed.find((h) => h.hookId === "H-core")!.promoted).toBe(true);
    expect(parsed.find((h) => h.hookId === "H-dep")!.promoted).toBe(true);
    expect(parsed.find((h) => h.hookId === "H-slow")!.promoted).toBe(true);
    expect(parsed.find((h) => h.hookId === "H-local")!.promoted).toBe(false);
  });
});

describe("Phase 7 hotfix 2 — consolidator re-promotes advancedCount>=2", () => {
  let bookDir: string;

  beforeEach(async () => {
    bookDir = await mkdtemp(join(tmpdir(), "castor-phase7-hf-consolid-"));
    await mkdir(join(bookDir, "story"), { recursive: true });
  });

  afterEach(async () => {
    await rm(bookDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("flips promoted=false → true when chapter_summaries mentions the hook in 2+ chapters", async () => {
    // Seed ledger: H-slept was architect-emitted as mock_text (no rule firing at
    // seed time), but subsequent chapter summaries mention it 3 times.
    // Consolidator must re-promote via the derived advancedCount path.
    const seededHooks: StoredHook[] = [
      {
        hookId: "H-slept",
        startChapter: 3,
        type: "mock_text",
        status: "open",
        lastAdvancedChapter: 9,
        expectedPayoff: "15mock_text",
        payoffTiming: "near-term",
        notes: "mock_text",
        dependsOn: [],
        paysOffInArc: "Chương 1mock_text",
        coreHook: false,
        promoted: false,
      },
      {
        hookId: "H-cold",
        startChapter: 4,
        type: "mock_text",
        status: "open",
        lastAdvancedChapter: 0,
        expectedPayoff: "",
        payoffTiming: "mid-arc",
        notes: "",
        dependsOn: [],
        paysOffInArc: "",
        coreHook: false,
        promoted: false,
      },
    ];
    const ledgerPath = join(bookDir, "story", "pending_hooks.md");
    await writeFile(ledgerPath, renderHookSnapshot(seededHooks, "vi"), "utf-8");

    // chapter_summaries mentions H-slept in 3 chapters (>=2 → promote).
    // H-cold mentioned in only 1 chapter (below threshold).
    await writeFile(
      join(bookDir, "story", "chapter_summaries.md"),
      [
        "| mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| 4 | mock_text | mock_text | mock_text | mock_text | H-slept mock_text | mock_text | mock_text |",
        "| 5 | mock_text | mock_text | mock_text | mock_text | H-cold mock_text | mock_text | mock_text |",
        "| 7 | mock_text | mock_text | Kiem tra so sach | mock_text | H-slept mock_text | mock_text | mock_text |",
        "| 9 | mock_text | mock_text | mock_text | mock_text | H-slept mock_text | mock_text | mock_text |",
      ].join("\n"),
      "utf-8",
    );

    const agent = new ConsolidatorAgent({
      client: {} as ConstructorParameters<typeof ConsolidatorAgent>[0]["client"],
      model: "test-model",
      projectRoot: bookDir,
    });

    const result = await agent.consolidate(bookDir);
    expect(result.promotedHookCount).toBe(1);

    const next = await readFile(ledgerPath, "utf-8");
    const parsed = parsePendingHooksMarkdown(next);
    expect(parsed.find((h) => h.hookId === "H-slept")!.promoted).toBe(true);
    expect(parsed.find((h) => h.hookId === "H-cold")!.promoted).toBe(false);
  });

  it("leaves ledger untouched when no hook crosses the threshold", async () => {
    const hooks: StoredHook[] = [
      {
        hookId: "H-still",
        startChapter: 3,
        type: "mock_text",
        status: "open",
        lastAdvancedChapter: 0,
        expectedPayoff: "",
        payoffTiming: "mid-arc",
        notes: "",
        promoted: false,
      },
    ];
    const ledgerPath = join(bookDir, "story", "pending_hooks.md");
    const before = renderHookSnapshot(hooks, "vi");
    await writeFile(ledgerPath, before, "utf-8");

    const agent = new ConsolidatorAgent({
      client: {} as ConstructorParameters<typeof ConsolidatorAgent>[0]["client"],
      model: "test-model",
      projectRoot: bookDir,
    });

    const result = await agent.consolidate(bookDir);
    expect(result.promotedHookCount).toBe(0);
    const after = await readFile(ledgerPath, "utf-8");
    expect(after).toBe(before);
  });
});

describe("Phase 7 hotfix 2 — reviewer gates critical severity on promoted", () => {
  it("zh reviewer prompt references mock_text=mock_text as critical gate and the mock_text N mock_text token", async () => {
    // We drive the reviewer end-to-end against a minimal book fixture and
    // assert the system prompt carries the hotfix language. This mirrors the
    // continuity.test.ts style so we're exercising the actual prompt builder
    // rather than a decoupled unit.
    const { ContinuityAuditor } = await import("../agents/continuity.js");
    const root = await mkdtemp(join(tmpdir(), "castor-hf-reviewer-zh-"));
    const bookDirLocal = join(root, "book");
    const storyDir = join(bookDirLocal, "story");
    await mkdir(storyDir, { recursive: true });

    try {
      await writeFile(
        join(bookDirLocal, "book.json"),
        JSON.stringify({
          id: "hf-zh",
          title: "hotfix-zh",
          genre: "urban",
          platform: "other",
          chapterWordCount: 2000,
          targetChapters: 60,
          status: "active",
          language: "vi",
          createdAt: "2026-04-15T00:00:00.000Z",
          updatedAt: "2026-04-15T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );
      await Promise.all([
        writeFile(join(storyDir, "current_state.md"), "# mock_text\n", "utf-8"),
        writeFile(join(storyDir, "pending_hooks.md"), "# mock_text\n", "utf-8"),
        writeFile(join(storyDir, "chapter_summaries.md"), "# mock_text\n", "utf-8"),
        writeFile(join(storyDir, "subplot_board.md"), "# mock_text\n", "utf-8"),
        writeFile(join(storyDir, "emotional_arcs.md"), "# mock_text\n", "utf-8"),
        writeFile(join(storyDir, "character_matrix.md"), "# mock_text\n", "utf-8"),
        writeFile(join(storyDir, "volume_outline.md"), "# mock_text\n", "utf-8"),
        writeFile(join(storyDir, "style_guide.md"), "# mock_text\n", "utf-8"),
      ]);

      const auditor = new ContinuityAuditor({
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
        projectRoot: root,
      });

      // Mock both possible paths — eraResearch genres go through chatWithSearch,
      // others use chat. The two spies share a capture so whichever runs wins.
      const stub = vi.fn().mockResolvedValue({
        content: JSON.stringify({ passed: true, issues: [], summary: "ok" }),
        usage: ZERO_USAGE,
      });
      vi.spyOn(ContinuityAuditor.prototype as never, "chatWithSearch" as never).mockImplementation(stub as never);
      vi.spyOn(ContinuityAuditor.prototype as never, "chat" as never).mockImplementation(stub as never);

      await auditor.auditChapter(bookDirLocal, "mock_text。", 1, "urban");

      const messages = stub.mock.calls[0]?.[0] as ReadonlyArray<{ content: string }> | undefined;
      const systemPrompt = messages?.[0]?.content ?? "";

      // Critical severity gated on mock_text=mock_text.
      expect(systemPrompt).toContain("mock_text");
      expect(systemPrompt).toContain("mock_text=mock_text");
      // The mock_text N mock_text literal token reviewer reads verbatim (from hotfix 3).
      expect(systemPrompt).toContain("mock_text");
      // Non-promoted stale hooks stay at info.
      expect(systemPrompt).toMatch(/mock_text=mock_text.*info|mock_text.*info/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("en reviewer prompt gates on promoted=true and references 'blocked N chapters'", async () => {
    const { ContinuityAuditor } = await import("../agents/continuity.js");
    const root = await mkdtemp(join(tmpdir(), "castor-hf-reviewer-en-"));
    const bookDirLocal = join(root, "book");
    const storyDir = join(bookDirLocal, "story");
    await mkdir(storyDir, { recursive: true });

    try {
      await writeFile(
        join(bookDirLocal, "book.json"),
        JSON.stringify({
          id: "hf-en",
          title: "hotfix-en",
          genre: "other",
          platform: "royalroad",
          chapterWordCount: 800,
          targetChapters: 60,
          status: "active",
          language: "en",
          createdAt: "2026-04-15T00:00:00.000Z",
          updatedAt: "2026-04-15T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );
      await Promise.all([
        writeFile(join(storyDir, "current_state.md"), "# Current State\n", "utf-8"),
        writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
        writeFile(join(storyDir, "chapter_summaries.md"), "# Chapter Summaries\n", "utf-8"),
        writeFile(join(storyDir, "subplot_board.md"), "# Subplot Board\n", "utf-8"),
        writeFile(join(storyDir, "emotional_arcs.md"), "# Emotional Arcs\n", "utf-8"),
        writeFile(join(storyDir, "character_matrix.md"), "# Character Matrix\n", "utf-8"),
        writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n", "utf-8"),
        writeFile(join(storyDir, "style_guide.md"), "# Style Guide\n", "utf-8"),
      ]);

      const auditor = new ContinuityAuditor({
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
        projectRoot: root,
      });

      // Mock both possible paths — eraResearch genres go through chatWithSearch,
      // others use chat. The two spies share a capture so whichever runs wins.
      const stub = vi.fn().mockResolvedValue({
        content: JSON.stringify({ passed: true, issues: [], summary: "ok" }),
        usage: ZERO_USAGE,
      });
      vi.spyOn(ContinuityAuditor.prototype as never, "chatWithSearch" as never).mockImplementation(stub as never);
      vi.spyOn(ContinuityAuditor.prototype as never, "chat" as never).mockImplementation(stub as never);

      await auditor.auditChapter(bookDirLocal, "Chapter body.", 1, "other");

      const messages = stub.mock.calls[0]?.[0] as ReadonlyArray<{ content: string }> | undefined;
      const systemPrompt = messages?.[0]?.content ?? "";

      expect(systemPrompt).toContain("promoted=true");
      expect(systemPrompt).toContain("blocked ");
      // info-only for non-promoted.
      expect(systemPrompt).toMatch(/non-promoted.*info/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Hotfix 3: blocked distance
// ---------------------------------------------------------------------------

describe("Phase 7 hotfix 3 — blocked distance embeds mock_text N mock_text token", () => {
  it("reports blocked distance = currentChapter - upstream.startChapter when upstream is planted but unresolved", () => {
    // H01 planted ch 3 (open, unresolved).
    // H02 depends on H01, planted ch 5.
    // current ch 12 → H02 has been blocked since upstream planting (ch 3).
    // Expected: mock_text 9 mock_text (12 - 3).
    const upstream: StoredHook = {
      hookId: "H01",
      startChapter: 3,
      type: "mock_text",
      status: "open",
      lastAdvancedChapter: 0,
      expectedPayoff: "",
      notes: "",
    };
    const downstream: StoredHook = {
      hookId: "H02",
      startChapter: 5,
      type: "mock_text",
      status: "open",
      lastAdvancedChapter: 0,
      expectedPayoff: "",
      notes: "",
      dependsOn: ["H01"],
    };

    const diag = computeHookDiagnostics({
      hooks: [upstream, downstream],
      currentChapter: 12,
    }).get("H02")!;

    expect(diag.blocked).toBe(true);
    expect(diag.blockedDistance).toBe(9);
    expect(renderHookDiagnosticMarker(diag, "vi")).toContain("mock_text 9 mock_text");
    expect(renderHookDiagnosticMarker(diag, "en")).toContain("blocked 9 chapters");
  });

  it("uses hook.startChapter as the reference when upstream is missing from the ledger entirely", () => {
    // Upstream ghost id → blocked since hook's own planting.
    const hook: StoredHook = {
      hookId: "H-orphan",
      startChapter: 4,
      type: "",
      status: "open",
      lastAdvancedChapter: 0,
      expectedPayoff: "",
      notes: "",
      dependsOn: ["H-ghost"],
    };

    const diag = computeHookDiagnostics({
      hooks: [hook],
      currentChapter: 11,
    }).get("H-orphan")!;

    expect(diag.blocked).toBe(true);
    expect(diag.blockedDistance).toBe(7); // 11 - 4
    expect(renderHookDiagnosticMarker(diag, "vi")).toContain("mock_text 7 mock_text");
  });

  it("blockedDistance is 0 when hook is not blocked", () => {
    const upstream: StoredHook = {
      hookId: "U",
      startChapter: 2,
      type: "",
      status: "resolved",
      lastAdvancedChapter: 5,
      expectedPayoff: "",
      notes: "",
    };
    const downstream: StoredHook = {
      hookId: "D",
      startChapter: 4,
      type: "",
      status: "open",
      lastAdvancedChapter: 0,
      expectedPayoff: "",
      notes: "",
      dependsOn: ["U"],
    };
    const diag = computeHookDiagnostics({ hooks: [upstream, downstream], currentChapter: 10 }).get("D")!;
    expect(diag.blocked).toBe(false);
    expect(diag.blockedDistance).toBe(0);
    expect(renderHookDiagnosticMarker(diag, "vi")).toBe("");
  });
});
