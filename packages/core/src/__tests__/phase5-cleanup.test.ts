import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArchitectAgent } from "../agents/architect.js";
import { readBookRules as readStructuredBookRules } from "../agents/rules-reader.js";
import { readBookRules as readPlannerBookRules } from "../agents/planner-context.js";
import { readVolumeMap } from "../utils/outline-paths.js";
import { StateManager } from "../state/manager.js";
import type { BookConfig } from "../models/book.js";

// ---------------------------------------------------------------------------
// Phase 5 cleanup (4) — verifies the post-cleanup invariants:
//   (1) volume_outline.md mirror is NOT produced by the architect
//       — readVolumeMap() still resolves through outline/volume_map.md
//   (2) particle_ledger.md / subplot_board.md are NOT seeded by the architect
//   (3) book_rules.md is the authoritative human-readable Markdown rules file;
//       readBookRules() parses it into structured rules. Legacy story_frame
//       YAML frontmatter remains readable only as a fallback.
// ---------------------------------------------------------------------------

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

const SAMPLE_RESPONSE = [
  "=== SECTION: story_frame ===",
  "## mock_text",
  "mock_textTestmock_text。",
  "## mock_text",
  "mock_text A mock_text B。",
  "## mock_text",
  "mock_text X。",
  "## mock_text",
  "mock_text。",
  "## mock_text",
  "mock_text。",
  "",
  "=== SECTION: volume_map ===",
  "## mock_text",
  "mock_text。",
  "## mock_text",
  "Chương 10mock_text。",
  "## mock_text",
  "mock_text H01。",
  "## mock_text",
  "mock_text：mock_text。",
  "## mock_text",
  "mock_text。",
  "## mock_text",
  "mock_text 10 mock_text。",
  "",
  "=== SECTION: rhythm_principles ===",
  "## mock_text 1",
  "mock_text 8 mock_text。",
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
  "Testmock_text。",
  "## mock_text",
  "mock_textPhong so sach。",
  "## mock_text",
  "mock_text。",
  "## mock_text",
  "mock_textSu that。",
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
  "Chương mock_text。",
  "",
  "## mock_text",
  "- mock_text",
  "",
  "## mock_text",
  "- mock_text",
  "",
  "=== SECTION: current_state ===",
  "|  từmock_text | mock_text |",
  "| --- | --- |",
  "| mock_text | 0 |",
  "",
  "=== SECTION: pending_hooks ===",
  "| hook_id | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text |",
  "| --- | --- | --- | --- | --- | --- | --- | --- |",
  "| H01 | 1 | mock_text | mock_text | 0 | 32mock_text | mock_text | Testmock_text |",
].join("\n");

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
    id: "cleanup-book",
    title: "mock_textTestmock_text",
    platform: "other",
    genre: "urban",
    status: "active",
    targetChapters: 40,
    chapterWordCount: 2000,
    language: "vi",
    createdAt: "2026-04-15T00:00:00.000Z",
    updatedAt: "2026-04-15T00:00:00.000Z",
  };
}

describe("Phase 5 cleanup (1) — volume_outline.md mirror removed", () => {
  let bookDir: string;

  beforeEach(async () => {
    bookDir = await mkdtemp(join(tmpdir(), "castor-cleanup-1-"));
  });

  afterEach(async () => {
    await rm(bookDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("does not write volume_outline.md when running a fresh architect foundation", async () => {
    const agent = buildAgent();
    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({ content: SAMPLE_RESPONSE, usage: ZERO_USAGE });

    const output = await agent.generateFoundation(baseBook());
    await agent.writeFoundationFiles(bookDir, output, false, "vi");

    await expect(
      readFile(join(bookDir, "story/volume_outline.md"), "utf-8"),
    ).rejects.toThrow();

    const newOutline = await readFile(join(bookDir, "story/outline/volume_map.md"), "utf-8");
    expect(newOutline).toContain("mock_text");
  });

  it("readVolumeMap resolves the new path without needing the legacy mirror", async () => {
    await mkdir(join(bookDir, "story/outline"), { recursive: true });
    await writeFile(
      join(bookDir, "story/outline/volume_map.md"),
      "NEW map content",
      "utf-8",
    );

    const content = await readVolumeMap(bookDir, "(missing)");
    expect(content).toBe("NEW map content");
  });

  it("readVolumeMap still falls back to legacy volume_outline.md for pre-cleanup books", async () => {
    await mkdir(join(bookDir, "story"), { recursive: true });
    await writeFile(
      join(bookDir, "story/volume_outline.md"),
      "LEGACY outline content",
      "utf-8",
    );

    const content = await readVolumeMap(bookDir, "(missing)");
    expect(content).toBe("LEGACY outline content");
  });

  it("isCompleteBookDirectory accepts the new outline/ layout (no legacy mirror needed)", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "castor-cleanup-1-proj-"));
    try {
      const targetBookDir = join(projectRoot, "books", "cleanup-book");
      const storyDir = join(targetBookDir, "story");
      await mkdir(join(storyDir, "outline"), { recursive: true });
      await mkdir(join(targetBookDir, "chapters"), { recursive: true });

      await Promise.all([
        writeFile(join(targetBookDir, "book.json"), "{}", "utf-8"),
        writeFile(join(storyDir, "outline/story_frame.md"), "# frame", "utf-8"),
        writeFile(join(storyDir, "outline/volume_map.md"), "# map", "utf-8"),
        writeFile(join(storyDir, "book_rules.md"), "# rules", "utf-8"),
        writeFile(join(storyDir, "current_state.md"), "# state", "utf-8"),
        writeFile(join(storyDir, "pending_hooks.md"), "# hooks", "utf-8"),
        writeFile(join(targetBookDir, "chapters/index.json"), "[]", "utf-8"),
      ]);

      const state = new StateManager(projectRoot);
      await expect(state.isCompleteBookDirectory(targetBookDir)).resolves.toBe(true);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("isCompleteBookDirectory still accepts the pre-cleanup layout (legacy flat files)", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "castor-cleanup-1-legacy-"));
    try {
      const targetBookDir = join(projectRoot, "books", "legacy-book");
      const storyDir = join(targetBookDir, "story");
      await mkdir(storyDir, { recursive: true });
      await mkdir(join(targetBookDir, "chapters"), { recursive: true });

      await Promise.all([
        writeFile(join(targetBookDir, "book.json"), "{}", "utf-8"),
        writeFile(join(storyDir, "story_bible.md"), "# bible", "utf-8"),
        writeFile(join(storyDir, "volume_outline.md"), "# outline", "utf-8"),
        writeFile(join(storyDir, "book_rules.md"), "# rules", "utf-8"),
        writeFile(join(storyDir, "current_state.md"), "# state", "utf-8"),
        writeFile(join(storyDir, "pending_hooks.md"), "# hooks", "utf-8"),
        writeFile(join(targetBookDir, "chapters/index.json"), "[]", "utf-8"),
      ]);

      const state = new StateManager(projectRoot);
      await expect(state.isCompleteBookDirectory(targetBookDir)).resolves.toBe(true);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});

describe("Phase 5 cleanup (2) — architect no longer seeds runtime log files", () => {
  let bookDir: string;

  beforeEach(async () => {
    bookDir = await mkdtemp(join(tmpdir(), "castor-cleanup-2-"));
  });

  afterEach(async () => {
    await rm(bookDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("does not write particle_ledger.md or subplot_board.md even when the genre wants a numerical system", async () => {
    const agent = buildAgent();
    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({ content: SAMPLE_RESPONSE, usage: ZERO_USAGE });

    const output = await agent.generateFoundation(baseBook());
    // numericalSystem=true would previously seed particle_ledger.md
    await agent.writeFoundationFiles(bookDir, output, true, "vi");

    await expect(
      readFile(join(bookDir, "story/particle_ledger.md"), "utf-8"),
    ).rejects.toThrow();
    await expect(
      readFile(join(bookDir, "story/subplot_board.md"), "utf-8"),
    ).rejects.toThrow();
  });
});

describe("Phase 5 cleanup (3) — book_rules is authoritative Markdown", () => {
  let bookDir: string;

  beforeEach(async () => {
    bookDir = await mkdtemp(join(tmpdir(), "castor-cleanup-3-"));
  });

  afterEach(async () => {
    await rm(bookDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("writes prose-only story_frame.md and authoritative markdown book_rules.md", async () => {
    const agent = buildAgent();
    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({ content: SAMPLE_RESPONSE, usage: ZERO_USAGE });

    const output = await agent.generateFoundation(baseBook());
    await agent.writeFoundationFiles(bookDir, output, false, "vi");

    const storyFrame = await readFile(join(bookDir, "story/outline/story_frame.md"), "utf-8");
    expect(storyFrame.trimStart().startsWith("---")).toBe(false);
    expect(storyFrame).toContain("mock_text");

    const bookRules = await readFile(join(bookDir, "story/book_rules.md"), "utf-8");
    expect(bookRules).toContain("## mock_text");
    expect(bookRules).toContain("mock_text");
    expect(bookRules).toContain("## mock_text");
    expect(bookRules.trimStart().startsWith("---")).toBe(false);
  });

  it("readBookRules() parses authoritative markdown book_rules.md", async () => {
    const agent = buildAgent();
    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({ content: SAMPLE_RESPONSE, usage: ZERO_USAGE });

    const output = await agent.generateFoundation(baseBook());
    await agent.writeFoundationFiles(bookDir, output, false, "vi");

    const parsed = await readStructuredBookRules(bookDir);
    expect(parsed).not.toBeNull();
    expect(parsed?.rules.protagonist?.name).toBe("mock_text");
    expect(parsed?.rules.protagonist?.personalityLock).toEqual(["mock_text", "mock_text"]);
    expect(parsed?.rules.prohibitions).toEqual(["mock_text"]);
    expect(parsed?.rules.narrativePerson).toBe("third");
  });

  it("readBookRules() still accepts legacy YAML book_rules.md", async () => {
    const storyDir = join(bookDir, "story");
    await mkdir(join(storyDir, "outline"), { recursive: true });
    // story_frame.md exists but has NO frontmatter (pre-cleanup book)
    await writeFile(
      join(storyDir, "outline/story_frame.md"),
      "# Story Frame\n\nPure prose with no YAML.\n",
      "utf-8",
    );
    // Legacy book_rules.md carries the real frontmatter
    await writeFile(
      join(storyDir, "book_rules.md"),
      "---\nversion: \"1.0\"\nprotagonist:\n  name: LegacyHero\n  personalityLock: [stoic]\n  behavioralConstraints: []\nprohibitions:\n  - No lazy tropes\n---\n",
      "utf-8",
    );

    const parsed = await readStructuredBookRules(bookDir);
    expect(parsed?.rules.protagonist?.name).toBe("LegacyHero");
    expect(parsed?.rules.prohibitions).toEqual(["No lazy tropes"]);
  });

  it("readBookRules() returns null when neither source exists", async () => {
    const parsed = await readStructuredBookRules(bookDir);
    expect(parsed).toBeNull();
  });

  it("readBookRules() falls back to legacy story_frame.md frontmatter when book_rules.md is only a shim", async () => {
    const storyDir = join(bookDir, "story");
    await mkdir(join(storyDir, "outline"), { recursive: true });
    await writeFile(
      join(storyDir, "outline/story_frame.md"),
      [
        "---",
        "version: \"1.0\"",
        "protagonist:",
        "  name: LegacyFrameHero",
        "  personalityLock: [stoic]",
        "  behavioralConstraints: []",
        "prohibitions:",
        "  - No lazy tropes",
        "---",
        "",
        "# Story Frame",
      ].join("\n"),
      "utf-8",
    );
    await writeFile(
      join(storyDir, "book_rules.md"),
      "# Book Rules (compat pointer — deprecated)\n\n> This file is kept for external readers only.",
      "utf-8",
    );

    const parsed = await readStructuredBookRules(bookDir);
    expect(parsed?.rules.protagonist?.name).toBe("LegacyFrameHero");
    expect(parsed?.rules.prohibitions).toEqual(["No lazy tropes"]);
  });

  it("planner-context readBookRules renders structured fields as a markdown block", async () => {
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });
    await writeFile(
      join(storyDir, "book_rules.md"),
      [
        "## mock_text",
        "- mock_text từ：mock_text",
        "- mock_text：mock_text、mock_text",
        "- mock_text：mock_text",
        "## mock_text",
        "- mock_text",
        "- mock_text",
      ].join("\n"),
      "utf-8",
    );

    const rendered = await readPlannerBookRules(storyDir);
    expect(rendered).toContain("mock_text");
    expect(rendered).toContain("mock_text");
    expect(rendered).toContain("mock_text");
    expect(rendered).toContain("mock_text");
    expect(rendered).toContain("mock_text");
    expect(rendered).toContain("mock_text");
  });

  it("readBookRules() extracts fanfic, numerical, and era constraints from markdown rules", async () => {
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });
    await writeFile(
      join(storyDir, "book_rules.md"),
      [
        "## mock_text",
        "- mock_text từ：mock_text",
        "- mock_text：mock_text、mock_text",
        "- mock_text：mock_text",
        "## mock_text",
        "- mock_text：au",
        "- mock_text：mock_text、mock_text",
        "## mock_text/mock_text",
        "- mock_text：mock_text、mock_text",
        "- mock_text：mock_text",
        "## mock_text",
        "- mock_text：2003 mock_text",
        "- mock_text：mock_text",
        "- mock_text",
        "## mock_text",
        "- mock_text",
      ].join("\n"),
      "utf-8",
    );

    const parsed = await readStructuredBookRules(bookDir);
    expect(parsed?.rules.fanficMode).toBe("au");
    expect(parsed?.rules.allowedDeviations).toEqual(["mock_text", "mock_text"]);
    expect(parsed?.rules.numericalSystemOverrides?.resourceTypes).toEqual(["mock_text", "mock_text"]);
    expect(parsed?.rules.numericalSystemOverrides?.hardCap).toBe("mock_text");
    expect(parsed?.rules.eraConstraints).toEqual({
      enabled: true,
      period: "2003 mock_text",
      region: "mock_text",
    });
  });

  it("planner-context readBookRules returns empty string when no rules source exists", async () => {
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });
    const rendered = await readPlannerBookRules(storyDir);
    expect(rendered).toBe("");
  });
});
