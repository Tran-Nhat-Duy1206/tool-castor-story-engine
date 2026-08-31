import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArchitectAgent } from "../agents/architect.js";
import {
  readCurrentStateWithFallback,
  isCurrentStateSeedPlaceholder,
} from "../utils/outline-paths.js";
import type { BookConfig } from "../models/book.js";

// ---------------------------------------------------------------------------
// Phase 5 consolidation invariants (7 sections → 5 sections).
//
// A brief side-trip restored current_state as a 6th "narrow env/era" section,
// but the bench run showed the LLM emits an empty block for 3 out of 3 books
// (mock_text/mock_text/mock_text genres have no real year; urban/period genres already weave
// the era into world-tonal-ground naturally). The section is back to optional:
// architect may omit it entirely, writeFoundationFiles still seeds
// current_state.md with a placeholder so the consolidator has a file to
// append to.
//
// These tests lock in the 5-section contract so future edits can't silently
// regress back to the 7-section layout that was causing gpt-5.4 to drop tail
// sections:
//
//   1. The architect prompt advertises exactly 5 SECTION headers — no
//      current_state, no rhythm_principles.
//   2. The prompt FORBIDS duplication of protagonist-arc across story_frame
//      and roles, and forbids re-emitting rhythm_principles / current_state.
//   3. It carries explicit per-section budget markers (NO current_state
//      budget entry).
//   4. current_state section is NOT required in architect output — legacy
//      outputs that still carry it are accepted.
//   5. book_rules prompt asks for ordinary Markdown, not YAML frontmatter.
//   6. rhythm principles prompt allows mix of universal + concrete (≥3
//      concretized, rest may stay universal).
//   7. Legacy 7-section outputs still parse (backward compat).
//   8. writeFoundationFiles seeds current_state.md with a marker placeholder
//      when architect produced no initial state.
//   9. readCurrentStateWithFallback derives a substitute block from
//      roles/*.Current_State + pending_hooks startChapter=0 rows when the
//      seed placeholder is still on disk.
// ---------------------------------------------------------------------------

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
    id: "phase5-consolidated-book",
    title: "Phase5 mock_textTestmock_text",
    platform: "other",
    genre: "urban",
    status: "active",
    targetChapters: 60,
    chapterWordCount: 2200,
    language: "vi",
    createdAt: "2026-04-15T00:00:00.000Z",
    updatedAt: "2026-04-15T00:00:00.000Z",
  };
}

const CONSOLIDATED_RESPONSE = [
  "=== SECTION: story_frame ===",
  "## mock_text",
  "mock_text，mock_text：mock_text，mock_text roles/major/mock_text.md。",
  "## mock_text",
  "mock_text vs mock_text。mock_text。",
  "## mock_text",
  "mock_text，mock_text。mock_text：mock_text từmock_text。",
  "## mock_text",
  "mock_text：mock_text。",
  "",
  "=== SECTION: volume_map ===",
  "## mock_text",
  "mock_text。",
  "## mock_text",
  "Chương 17mock_text。",
  "## mock_text",
  "Chương  1 mock_text。",
  "## mock_text",
  "mock_text：mock_text。",
  "## mock_text",
  "mock_text。",
  "## mock_text（mock_text + mock_text）",
  "1. mock_text：mock_text 8-10 mock_text。",
  "2. mock_text：3 mock_text 1 mock_text。",
  "3. mock_text：mock_text 1 mock_text。",
  "4. mock_text：mock_text 1/3 mock_text 30%。",
  "5. mock_text：mock_text 5 mock_text。",
  "6. mock_text：mock_text 6 mock_text。",
  "",
  "=== SECTION: roles ===",
  "---ROLE---",
  "tier: major",
  "name: mock_text",
  "---CONTENT---",
  "## mock_text",
  "mock_text、mock_text",
  "## mock_text",
  "mock_text",
  "## mock_text",
  "mock_text。",
  "## mock_text（mock_text → mock_text → mock_text）",
  "mock_text——mock_text。",
  "## mock_text",
  "Chương 0mock_textPhong so sach，mock_text。",
  "## mock_text",
  "mock_text。",
  "## mock_text",
  "mock_text。",
  "## mock_text",
  "mock_text。",
  "---ROLE---",
  "tier: major",
  "name: mock_text",
  "---CONTENT---",
  "## mock_text",
  "mock_text、mock_text",
  "## mock_text",
  "mock_text",
  "## mock_text",
  "mock_text。",
  "## mock_text",
  "mock_text，Chương 0mock_text。",
  "## mock_text",
  "mock_text。",
  "## mock_text",
  "mock_text。",
  "## mock_text",
  "mock_text。",
  "",
  "=== SECTION: book_rules ===",
  "## mock_text",
  "- mock_text từ：mock_text",
  "- mock_text：mock_text、mock_text",
  "- mock_text：mock_text",
  "",
  "## mock_text",
  "- mock_text",
  "",
  "=== SECTION: pending_hooks ===",
  "| hook_id | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  "| H01 | 1 | mock_text | mock_text | 0 | mock_text | mock_text | mock_text | Chương 3mock_text | mock_text | 80 | mock_text |",
  "| H02 | 0 | mock_text | mock_text | 0 | mock_text | mock_text | mock_text | Chương 1mock_text | mock_text | 20 | mock_text：mock_text |",
].join("\n");

describe("Phase 5 consolidation — 7→5 sections, prompt contract", () => {
  it("the zh prompt advertises exactly 5 SECTION headers (NO current_state, NO rhythm_principles)", async () => {
    const agent = buildAgent();
    const chat = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({ content: CONSOLIDATED_RESPONSE, usage: ZERO_USAGE });

    await agent.generateFoundation(baseBook());

    const messages = chat.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    const system = messages[0]?.content ?? "";

    const headers = [...system.matchAll(/^=== SECTION: ([a-z_]+) ===$/gim)]
      .map((match) => match[1]);
    expect(headers).toEqual([
      "story_frame",
      "volume_map",
      "roles",
      "book_rules",
      "pending_hooks",
    ]);
    // rhythm_principles is explicitly NOT a standalone section — it still
    // lives inside the last paragraph of volume_map.
    expect(headers).not.toContain("rhythm_principles");
    // current_state is no longer emitted by the architect either — era/setting
    // context, when relevant, lives inside story_frame.mock_text.
    expect(headers).not.toContain("current_state");
  });

  it("the prompt forbids duplication across sections (dedup rule)", async () => {
    const agent = buildAgent();
    const chat = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({ content: CONSOLIDATED_RESPONSE, usage: ZERO_USAGE });

    await agent.generateFoundation(baseBook());
    const system = (chat.mock.calls[0]?.[0] as Array<{ content: string }>)[0]?.content ?? "";

    // Protagonist arc: authoritative home is roles
    expect(system).toContain("mock_text roles");
    // World hard rules: authoritative home is story_frame.mock_text
    expect(system).toContain("mock_text story_frame.mock_text");
    // Rhythm principles: authoritative home is volume_map's closing paragraph
    expect(system).toContain("mock_text volume_map mock_text");
    // Era/setting guidance: weave into story_frame.mock_text for year-anchored
    // genres, omit entirely for others. NOT a separate current_state section.
    expect(system).toContain("mock_text");
    expect(system).not.toContain("mock_text current_state");
  });

  it("the prompt carries explicit per-section char budget markers (NO current_state budget)", async () => {
    const agent = buildAgent();
    const chat = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({ content: CONSOLIDATED_RESPONSE, usage: ZERO_USAGE });

    await agent.generateFoundation(baseBook());
    const system = (chat.mock.calls[0]?.[0] as Array<{ content: string }>)[0]?.content ?? "";

    expect(system).toContain("story_frame ≤ 3000 chars");
    expect(system).toContain("volume_map ≤ 5000 chars");
    expect(system).toContain("roles mock_text ≤ 8000 chars");
    expect(system).toContain("book_rules ≤ 1000 chars");
    expect(system).toContain("pending_hooks ≤ 2000 chars");
    // current_state budget is gone — it's not a section any more.
    expect(system).not.toContain("current_state 500-800 chars");
  });

  it("the rhythm principles prompt allows a mix of universal + concrete (≥3 concretized, rest may stay universal)", async () => {
    const agent = buildAgent();
    const chat = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({ content: CONSOLIDATED_RESPONSE, usage: ZERO_USAGE });

    await agent.generateFoundation(baseBook());
    const system = (chat.mock.calls[0]?.[0] as Array<{ content: string }>)[0]?.content ?? "";

    // Header renamed to signal the mix is legal
    expect(system).toContain("mock_text（mock_text + mock_text）");
    // Rule: at least 3 of 6 must be concretized to this book
    expect(system).toContain("mock_text 3 mock_text");
    // Universal principles are explicitly allowed as examples
    expect(system).toContain("mock_text");
    // And the mix is explicitly called legal
    expect(system).toContain("mock_text + mock_text");
  });

  it("the English prompt also carries the 5-section / dedup / budget rules and rhythm universal allowance", async () => {
    const agent = buildAgent();
    const chat = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({ content: CONSOLIDATED_RESPONSE, usage: ZERO_USAGE });

    const enBook: BookConfig = { ...baseBook(), language: "en" };
    await agent.generateFoundation(enBook);
    const system = (chat.mock.calls[0]?.[0] as Array<{ content: string }>)[0]?.content ?? "";

    const headers = [...system.matchAll(/^=== SECTION: ([a-z_]+) ===$/gim)]
      .map((match) => match[1]);
    expect(headers).toEqual([
      "story_frame",
      "volume_map",
      "roles",
      "book_rules",
      "pending_hooks",
    ]);
    expect(system).toContain("story_frame ≤ 3000 chars");
    expect(system).not.toContain("current_state 500-800 chars");
    expect(system).toContain("ordinary Markdown");
    // Rhythm universal allowance
    expect(system).toContain("At least 3 must be concretized for this book");
    expect(system).toContain("no deus ex machina");
  });

  it("book_rules prompt block instructs ordinary markdown, not YAML frontmatter", async () => {
    const agent = buildAgent();
    const chat = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({ content: CONSOLIDATED_RESPONSE, usage: ZERO_USAGE });

    await agent.generateFoundation(baseBook());
    const system = (chat.mock.calls[0]?.[0] as Array<{ content: string }>)[0]?.content ?? "";

    expect(system).toContain("mock_text Markdown");
    expect(system).toContain("mock_text YAML frontmatter");
    expect(system).toMatch(/=== SECTION: book_rules ===[\s\S]*?## mock_text/);
    expect(system).toMatch(/=== SECTION: book_rules ===[\s\S]*?## mock_text/);
    expect(system).not.toContain("mock_text YAML frontmatter mock_text——mock_text");
    expect(system).not.toContain("YAML only");
  });
});

describe("Phase 5 consolidation — parser accepts 5-section output (current_state is optional)", () => {
  let bookDir: string;

  beforeEach(async () => {
    bookDir = await mkdtemp(join(tmpdir(), "castor-phase5-cons-"));
  });

  afterEach(async () => {
    await rm(bookDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("accepts a response with no current_state section and seeds the placeholder on disk", async () => {
    const agent = buildAgent();
    // CONSOLIDATED_RESPONSE already omits current_state — feed it straight in.
    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({ content: CONSOLIDATED_RESPONSE, usage: ZERO_USAGE });

    const out = await agent.generateFoundation(baseBook());
    await agent.writeFoundationFiles(bookDir, out, false, "vi");

    // Architect output has empty currentState — there's no section to parse.
    expect(out.currentState.trim()).toBe("");

    // writeFoundationFiles still writes current_state.md, but as a seed
    // placeholder the fallback reader can detect.
    const onDisk = await readFile(join(bookDir, "story/current_state.md"), "utf-8");
    expect(isCurrentStateSeedPlaceholder(onDisk)).toBe(true);
    expect(onDisk).toContain("mock_text");
  });

  it("accepts section markers when the model emits them as Markdown headings", async () => {
    const markdownHeadingResponse = CONSOLIDATED_RESPONSE.replace(
      /^=== SECTION:/gm,
      "# === SECTION:",
    );
    const agent = buildAgent();
    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({ content: markdownHeadingResponse, usage: ZERO_USAGE });

    const out = await agent.generateFoundation(baseBook());

    expect(out.storyFrame).toContain("mock_text");
    expect(out.storyBible).toContain("mock_text");
    expect(out.volumeOutline).toContain("mock_text");
    expect(out.bookRules).toContain("## mock_text");
    expect(out.pendingHooks).toContain("H01");
    expect(out.roles?.map((role) => role.name)).toContain("mock_text");
  });

  it("accepts plain Markdown section headings without SECTION markers", async () => {
    const agent = buildAgent();
    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "# mock_text",
          "## mock_text",
          "mock_text，Chương mock_text。",
          "",
          "# mock_text",
          "## Chương mock_text",
          "Chương 1mock_text。",
          "",
          "# mock_text",
          "---ROLE---",
          "tier: major",
          "name: mock_text",
          "---CONTENT---",
          "## mock_text",
          "mock_text，mock_text。",
          "",
          "# mock_text",
          "## mock_text",
          "- mock_text từ：mock_text",
          "## mock_text",
          "- Chương mock_text",
          "## mock_text",
          "- mock_text。",
          "",
          "# mock_text",
          "| hook_id | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| H01 | 0 | mock_text | open | 0 | mock_text | mock_text | mock_text |",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    const out = await agent.generateFoundation(baseBook());

    expect(out.storyFrame).toContain("mock_text");
    expect(out.volumeMap).toContain("mock_text");
    expect(out.bookRules).toContain("Chương mock_text");
    expect(out.pendingHooks).toContain("H01");
    expect(out.roles?.map((role) => role.name)).toContain("mock_text");
  });

  it("preserves legacy 7-section input (current_state + rhythm_principles still present)", async () => {
    const legacyResponse = [
      "=== SECTION: story_frame ===",
      "# frame",
      "=== SECTION: volume_map ===",
      "# map",
      "=== SECTION: rhythm_principles ===",
      "# legacy rhythm — accepted but no longer required",
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
      "## mock_text",
      "- mock_text từ：mock_text",
      "## mock_text",
      "- mock_text",
      "",
      "## mock_text",
      "Chương mock_text（legacy prose body — parser accepts but it no longer drives anything）",
      "=== SECTION: current_state ===",
      "|  từmock_text | mock_text |",
      "| --- | --- |",
      "| mock_text | 0 |",
      "| mock_text | mock_text |",
      "=== SECTION: pending_hooks ===",
      "| hook_id | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      "| H01 | 1 | mock_text | mock_text | 0 | mock_text | mock_text | mock_text |",
    ].join("\n");

    const agent = buildAgent();
    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({ content: legacyResponse, usage: ZERO_USAGE });

    const out = await agent.generateFoundation(baseBook());

    // Legacy content is preserved as-is
    expect(out.currentState).toContain("mock_text");
    expect(out.rhythmPrinciples).toContain("legacy rhythm");
    expect((out.roles ?? []).length).toBeGreaterThanOrEqual(1);
  });
});

describe("Phase 5 consolidation — readCurrentStateWithFallback derives initial state", () => {
  let bookDir: string;

  beforeEach(async () => {
    bookDir = await mkdtemp(join(tmpdir(), "castor-phase5-fallback-"));
  });

  afterEach(async () => {
    await rm(bookDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("returns a derived block built from roles/*.Current_State + seed hooks when current_state.md is a seed placeholder", async () => {
    // CONSOLIDATED_RESPONSE emits no current_state section — writeFoundationFiles
    // seeds the placeholder, which triggers the fallback reader.
    const agent = buildAgent();
    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({ content: CONSOLIDATED_RESPONSE, usage: ZERO_USAGE });

    const out = await agent.generateFoundation(baseBook());
    await agent.writeFoundationFiles(bookDir, out, false, "vi");

    const derived = await readCurrentStateWithFallback(bookDir, "(missing)");
    // Derived block should mention the role names and their Current_State text.
    expect(derived).toContain("mock_text");
    expect(derived).toContain("mock_text");
    expect(derived).toContain("mock_textPhong so sach");
    expect(derived).toContain("mock_text");
    expect(derived).toContain("mock_text");
    // Seed hook row startChapter=0 surfaces in the derived block.
    expect(derived).toContain("H02");
  });

  it("returns the file content as-is when current_state.md already has runtime content", async () => {
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });
    const runtime = "# mock_text\n\n- Chương 5mock_text。\n- mock_text：mock_text、mock_text。\n";
    await writeFile(join(storyDir, "current_state.md"), runtime, "utf-8");

    const derived = await readCurrentStateWithFallback(bookDir, "(missing)");
    expect(derived).toBe(runtime);
  });

  it("isCurrentStateSeedPlaceholder correctly identifies seeds vs real content", () => {
    expect(isCurrentStateSeedPlaceholder("")).toBe(true);
    expect(isCurrentStateSeedPlaceholder("# mock_text\n\n> mock_text。mock_text。\n")).toBe(true);
    expect(isCurrentStateSeedPlaceholder("# Current State\n\n> Seeded at book creation.\n")).toBe(true);
    // A real consolidator-appended block — no seed marker
    expect(isCurrentStateSeedPlaceholder("# mock_text\n\n- mock_text\n- mock_text\n")).toBe(false);
    // A long file that happens to contain the seed marker in prose — NOT a seed
    const longContent = "# mock_text\n\n" + "mock_text。".repeat(200) + "\nmock_text\n";
    expect(isCurrentStateSeedPlaceholder(longContent)).toBe(false);
  });
});
