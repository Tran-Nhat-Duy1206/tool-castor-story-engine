import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArchitectAgent } from "../agents/architect.js";
import type { BookConfig } from "../models/book.js";

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
    id: "phase5-book",
    title: "Phase5Testmock_text",
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

const SAMPLE_RESPONSE = [
  "=== SECTION: story_frame ===",
  "## mock_text",
  "mock_text。",
  "## mock_text",
  "mock_text——mock_text。",
  "## mock_text",
  "mock_textSu thatmock_text，mock_textSu thatmock_text。",
  "## mock_text",
  "mock_text，mock_text：mock_text từmock_text。",
  "## mock_text",
  "mock_text。",
  "",
  "=== SECTION: volume_map ===",
  "## mock_text",
  "mock_text，Chương mock_text，Chương mock_text，Chương mock_text。",
  "## mock_text",
  "Chương 17mock_text——mock_text。Chương 32mock_text。Chương 55mock_text。",
  "## mock_text",
  "Chương mock_text，Chương 32mock_text。",
  "## mock_text",
  "Chương mock_text：mock_text。",
  "## mock_text",
  "Chương mock_text：mock_text。",
  "## mock_text",
  "mock_text 10 mock_text。",
  "",
  "=== SECTION: rhythm_principles ===",
  "## mock_text 1：mock_text",
  "mock_text 8-10 mock_text。",
  "## mock_text 2：mock_text",
  "mock_text 3 mock_text 1 mock_text。",
  "## mock_text 3：mock_text",
  "mock_text 1 mock_text，mock_text 5 mock_text。",
  "## mock_text 4：mock_text",
  "mock_text 1/3 mock_text 30%，mock_text 40%，mock_text 30%。",
  "## mock_text 5：mock_text",
  "mock_text 5 mock_text。",
  "## mock_text 6：mock_text",
  "mock_text 6 mock_text。",
  "",
  "=== SECTION: roles ===",
  "---ROLE---",
  "tier: major",
  "name: mock_text",
  "---CONTENT---",
  "## mock_text",
  "mock_text、mock_text、mock_text",
  "## mock_text",
  "mock_text",
  "## mock_text",
  "mock_text，mock_text。",
  "## mock_text",
  "mock_textPhong so sach。",
  "## mock_text",
  "mock_text。",
  "## mock_text",
  "mock_text。",
  "## mock_text",
  "mock_textSu thatmock_text。",
  "---ROLE---",
  "tier: major",
  "name: mock_text",
  "---CONTENT---",
  "## mock_text",
  "mock_text、mock_text、mock_text",
  "## mock_text",
  "mock_text",
  "## mock_text",
  "mock_text。",
  "## mock_text",
  "mock_text。",
  "## mock_text",
  "mock_text。",
  "## mock_text",
  "mock_text。",
  "## mock_text",
  "mock_text。",
  "---ROLE---",
  "tier: minor",
  "name: mock_text",
  "---CONTENT---",
  "## mock_text",
  "mock_text、mock_text",
  "## mock_text",
  "mock_text",
  "## mock_text",
  "mock_text。",
  "## mock_text",
  "mock_text。",
  "",
  "=== SECTION: book_rules ===",
  "---",
  "version: \"1.0\"",
  "protagonist:",
  "  name: mock_text",
  "  personalityLock: [mock_text, mock_text, mock_text]",
  "  behavioralConstraints: [mock_text]",
  "genreLock:",
  "  primary: urban",
  "  forbidden: [mock_text]",
  "prohibitions:",
  "  - mock_text",
  "chapterTypesOverride: []",
  "fatigueWordsOverride: []",
  "additionalAuditDimensions: []",
  "enableFullCastTracking: false",
  "---",
  "## mock_text",
  "Chương mock_text，mock_text。",
  "## mock_text",
  "mock_text outline/story_frame.md mock_text 3。",
  "",
  "=== SECTION: current_state ===",
  "|  từmock_text | mock_text |",
  "| --- | --- |",
  "| mock_text | 0 |",
  "| mock_text | mock_text |",
  "| mock_text | mock_text |",
  "| mock_text | mock_text |",
  "| mock_text | mock_text |",
  "| mock_text | mock_text |",
  "| mock_text | mock_text |",
  "",
  "=== SECTION: pending_hooks ===",
  "| hook_id | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text |",
  "| --- | --- | --- | --- | --- | --- | --- | --- |",
  "| H01 | 1 | mock_text | mock_text | 0 | 32mock_text | mock_text | mock_text |",
].join("\n");

describe("ArchitectAgent — Phase 5 prose output", () => {
  let bookDir: string;

  beforeEach(async () => {
    bookDir = await mkdtemp(join(tmpdir(), "castor-phase5-arch-"));
  });

  afterEach(async () => {
    await rm(bookDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("parses storyFrame / volumeMap / rhythmPrinciples / roles from the response", async () => {
    const agent = buildAgent();
    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({ content: SAMPLE_RESPONSE, usage: ZERO_USAGE });

    const result = await agent.generateFoundation(baseBook());

    expect(result.storyFrame).toContain("mock_text");
    expect(result.volumeMap).toContain("Chương 17mock_text");
    expect(result.rhythmPrinciples).toContain("mock_text");
    expect(result.roles).toBeDefined();
    expect(result.roles).toHaveLength(3);

    const majors = (result.roles ?? []).filter((role) => role.tier === "major");
    const minors = (result.roles ?? []).filter((role) => role.tier === "minor");
    expect(majors.map((role) => role.name)).toEqual(["mock_text", "mock_text"]);
    expect(minors.map((role) => role.name)).toEqual(["mock_text"]);
    expect(majors[0]?.content).toContain("mock_text");
    expect(majors[0]?.content).toContain("mock_text");
  });

  it("writes outline/* prose files, roles/*, and compat shims for story_bible/character_matrix", async () => {
    const agent = buildAgent();
    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({ content: SAMPLE_RESPONSE, usage: ZERO_USAGE });

    const result = await agent.generateFoundation(baseBook());
    await agent.writeFoundationFiles(bookDir, result, false, "vi");

    const storyDir = join(bookDir, "story");
    const storyFrame = await readFile(join(storyDir, "outline/story_frame.md"), "utf-8");
    expect(storyFrame).toContain("mock_text");

    const volumeMap = await readFile(join(storyDir, "outline/volume_map.md"), "utf-8");
    expect(volumeMap).toContain("Chương 17mock_text");

    const rhythm = await readFile(join(storyDir, "outline/mock_text.md"), "utf-8");
    expect(rhythm).toContain("mock_text");

    // Role files — one per character, grouped by tier
    const majorFiles = await readdir(join(storyDir, "roles", "major"));
    expect(majorFiles.sort()).toEqual(["mock_text.md", "mock_text.md"]);
    const minorFiles = await readdir(join(storyDir, "roles", "minor"));
    expect(minorFiles).toEqual(["mock_text.md"]);

    // Compat shim: story_bible.md must exist and point at outline/story_frame.md
    const storyBibleShim = await readFile(join(storyDir, "story_bible.md"), "utf-8");
    expect(storyBibleShim).toContain("mock_text");
    expect(storyBibleShim).toContain("outline/story_frame.md");

    // Compat shim: character_matrix.md points at roles/ directory
    const matrixShim = await readFile(join(storyDir, "character_matrix.md"), "utf-8");
    expect(matrixShim).toContain("mock_text");
    expect(matrixShim).toContain("roles/major/mock_text.md");
    expect(matrixShim).toContain("roles/minor/mock_text.md");

    // Runtime state files still produced
    const currentState = await readFile(join(storyDir, "current_state.md"), "utf-8");
    expect(currentState).toContain("mock_text");
    const pendingHooks = await readFile(join(storyDir, "pending_hooks.md"), "utf-8");
    expect(pendingHooks).toContain("H01");

    // Cleanup #1: volume_outline.md mirror is NOT written anymore. All
    // readers flow through readVolumeMap() which falls back to the legacy
    // path only for pre-Phase-5 books that still have the file on disk.
    await expect(readFile(join(storyDir, "volume_outline.md"), "utf-8")).rejects.toThrow();
  });

  it("still requires book_rules / roles / pending_hooks to be present (current_state is optional after consolidation)", async () => {
    const agent = buildAgent();
    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== SECTION: story_frame ===",
          "# frame",
          "=== SECTION: volume_map ===",
          "# map",
          "=== SECTION: pending_hooks ===",
          "# hooks",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    // book_rules + roles both missing — the error message lists them.
    await expect(agent.generateFoundation(baseBook())).rejects.toThrow(/book_rules/i);
    await expect(agent.generateFoundation(baseBook())).rejects.toThrow(/roles/i);
    // current_state is NOT in the missing list — it's optional now.
    try {
      await agent.generateFoundation(baseBook());
      throw new Error("should have rejected");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toMatch(/current_state/i);
    }
  });

  it("repairs missing architect sections once before failing the book creation flow", async () => {
    const agent = buildAgent();
    const chat = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValueOnce({
        content: [
          "=== SECTION: story_frame ===",
          "# frame",
          "=== SECTION: volume_map ===",
          "# map",
          "=== SECTION: pending_hooks ===",
          "# hooks",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({ content: SAMPLE_RESPONSE, usage: ZERO_USAGE });

    const out = await agent.generateFoundation(baseBook());

    expect(chat).toHaveBeenCalledTimes(2);
    const repairMessages = chat.mock.calls[1]?.[0] as Array<{ role: string; content: string }>;
    expect(repairMessages[0]?.content).toContain("mock_text Castor architect");
    expect(repairMessages[1]?.content).toContain("mock_text section");
    expect(out.storyFrame).toContain("mock_text");
    expect(out.bookRules).toContain("version");
    expect(out.roles?.length).toBeGreaterThan(0);
  });

  it("requires at least one of story_frame or legacy story_bible", async () => {
    const agent = buildAgent();
    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== SECTION: volume_map ===",
          "# map",
          "=== SECTION: roles ===",
          "---ROLE---",
          "tier: major",
          "name: X",
          "---CONTENT---",
          "## mock_text",
          "mock_text",
          "=== SECTION: book_rules ===",
          "---\nversion: \"1.0\"\n---",
          "=== SECTION: pending_hooks ===",
          "| hook_id | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text |",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    await expect(agent.generateFoundation(baseBook())).rejects.toThrow(/story_frame/i);
  });

  it("system prompt emphasises volume-level prose for volume_map and contrast-detail for roles", async () => {
    const agent = buildAgent();
    const chat = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({ content: SAMPLE_RESPONSE, usage: ZERO_USAGE });

    await agent.generateFoundation(baseBook());

    const messages = chat.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    const system = messages[0]?.content ?? "";
    expect(system).toContain("mock_text");
    // Post-refactor: architect stays at volume level; chapter-level planning is planner's job.
    expect(system).toContain("mock_text prose");
    expect(system).toContain("mock_text");
    expect(system).toContain("mock_text");
    expect(system).toContain("=== SECTION: story_frame ===");
    expect(system).toContain("=== SECTION: volume_map ===");
    // Phase 5 consolidation: rhythm_principles is merged into volume_map's
    // closing paragraph and is NOT a standalone SECTION header.
    expect(system).not.toContain("=== SECTION: rhythm_principles ===");
    // current_state is also no longer produced by the architect — era/setting
    // anchors (when the genre pins to a real year) are woven into
    // story_frame.mock_text; other genres omit them entirely.
    expect(system).not.toContain("=== SECTION: current_state ===");
    expect(system).toContain("=== SECTION: roles ===");
    expect(system).toContain("=== SECTION: book_rules ===");
    expect(system).toContain("=== SECTION: pending_hooks ===");
  });
});

describe("writeFoundationFiles — rhythm file is skipped when rhythmPrinciples is empty", () => {
  let bookDir: string;

  beforeEach(async () => {
    bookDir = await mkdtemp(join(tmpdir(), "castor-phase5-rhythm-skip-"));
  });

  afterEach(async () => {
    await rm(bookDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("does not write outline/mock_text.md when the architect output carries no rhythm block", async () => {
    // CONSOLIDATED_RESPONSE (trimmed) has rhythm merged into volume_map tail
    // and no standalone rhythm_principles section — rhythmPrinciples ends up
    // an empty string.
    const noRhythmResponse = [
      "=== SECTION: story_frame ===",
      "## mock_text",
      "mock_text。",
      "## mock_text",
      "mock_text vs mock_text。",
      "## mock_text",
      "mock_text。",
      "## mock_text",
      "mock_text。",
      "",
      "=== SECTION: volume_map ===",
      "## mock_text",
      "mock_text。",
      "## mock_text",
      "Chương 17mock_text。",
      "## mock_text",
      "mock_text H01。",
      "## mock_text",
      "mock_text：mock_text。",
      "## mock_text",
      "mock_text。",
      "## mock_text（mock_text + mock_text）",
      "1-6. mock_text merged into volume_map tail.",
      "",
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
      "Phong so sach。",
      "## mock_text",
      "mock_text。",
      "## mock_text",
      "mock_textSu that。",
      "## mock_text",
      "mock_text。",
      "",
      "=== SECTION: book_rules ===",
      "---",
      "version: \"1.0\"",
      "---",
      "",
      "=== SECTION: pending_hooks ===",
      "| hook_id | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      "| H01 | 1 | mock_text | mock_text | 0 | mock_text | mock_text | mock_text |",
    ].join("\n");

    const agent = buildAgent();
    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({ content: noRhythmResponse, usage: ZERO_USAGE });

    const out = await agent.generateFoundation(baseBook());
    expect((out.rhythmPrinciples ?? "").trim()).toBe("");

    await agent.writeFoundationFiles(bookDir, out, false, "vi");

    // No standalone rhythm file on disk — rhythm content lives in
    // volume_map's closing paragraph.
    await expect(
      readFile(join(bookDir, "story/outline/mock_text.md"), "utf-8"),
    ).rejects.toThrow();

    // But volume_map still exists and carries the rhythm tail.
    const volumeMap = await readFile(
      join(bookDir, "story/outline/volume_map.md"),
      "utf-8",
    );
    expect(volumeMap).toContain("mock_text（mock_text + mock_text）");
  });

  it("still writes outline/rhythm_principles.md (en) when the architect emits a standalone block (legacy path)", async () => {
    // Simulate a legacy-shaped output that DOES carry an explicit
    // rhythm_principles section — writeFoundationFiles must still honour it
    // for back-compat.
    const withRhythmResponse = SAMPLE_RESPONSE;
    const agent = buildAgent();
    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({ content: withRhythmResponse, usage: ZERO_USAGE });

    const out = await agent.generateFoundation(baseBook());
    expect((out.rhythmPrinciples ?? "").trim().length).toBeGreaterThan(0);

    await agent.writeFoundationFiles(bookDir, out, false, "vi");

    const rhythm = await readFile(
      join(bookDir, "story/outline/mock_text.md"),
      "utf-8",
    );
    expect(rhythm).toContain("mock_text");
  });
});
