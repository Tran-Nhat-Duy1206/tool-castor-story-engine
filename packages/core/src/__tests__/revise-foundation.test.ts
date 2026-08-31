import { describe, it, expect, vi, afterEach } from "vitest";
import { ArchitectAgent } from "../agents/architect.js";
import { FoundationReviewerAgent } from "../agents/foundation-reviewer.js";
import type { ArchitectOutput } from "../agents/architect.js";
import type { BookConfig } from "../models/book.js";
import type { LLMClient } from "../llm/provider.js";

// Test stub：chat mock_text vi.spyOn mock_text，client.defaults mock_text。
// mock_text temperature / maxTokens mock_text từ，mock_textTestmock_text"mock_text"mock_text
// mock_text（mock_text maxTokens —— mock_text，mock_text CLAUDE.md mock_text
// maxTokens mock_text）。mock_text từmock_text。
const TEST_CLIENT: LLMClient = {
  provider: "openai",
  apiFormat: "chat",
  stream: false,
} as unknown as LLMClient;

const buildArchitect = (): ArchitectAgent =>
  new ArchitectAgent({
    client: TEST_CLIENT,
    model: "test-model",
    projectRoot: process.cwd(),
  });

const testBook = (): BookConfig => ({
  id: "test-book", title: "Testmock_text", platform: "qidian", genre: "xuanhuan",
  status: "active", targetChapters: 50, chapterWordCount: 3000, language: "vi",
  createdAt: "2026-04-19T00:00:00.000Z", updatedAt: "2026-04-19T00:00:00.000Z",
});

describe("architect generateFoundation with reviseFrom option", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("injects legacy content into the system prompt when reviseFrom is supplied", async () => {
    const agent = buildArchitect();
    const chatSpy = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== SECTION: story_frame ===",
          "## mock_text",
          "mock_text",
          "",
          "=== SECTION: volume_map ===",
          "## mock_text 1",
          "mock_text",
          "",
          "=== SECTION: roles ===",
          "---ROLE---",
          "tier: major",
          "name: mock_text",
          "---CONTENT---",
          "mock_text",
          "",
          "=== SECTION: book_rules ===",
          "---",
          "version: \"1.0\"",
          "---",
          "",
          "=== SECTION: pending_hooks ===",
          "| hook_id |",
        ].join("\n"),
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      });

    await agent.generateFoundation(testBook(), undefined, undefined, {
      reviseFrom: {
        storyBible: "- mock_text：mock_text\n- mock_text：mock_text",
        volumeOutline: "## Chương mock_text\n- 1. mock_text",
        bookRules: "## mock_text\n- mock_text",
        characterMatrix: "mock_text - mock_text",
        userFeedback: "mock_text",
      },
    });

    const systemMsg = (chatSpy.mock.calls[0]?.[0] as Array<{ role: string; content: string }>)[0]!;
    expect(systemMsg.content).toContain("mock_text");
    expect(systemMsg.content).toContain("mock_text：mock_text");
    expect(systemMsg.content).toContain("mock_text");
  });

  it("does not inject revisePrompt when reviseFrom is absent", async () => {
    const agent = buildArchitect();
    const chatSpy = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== SECTION: story_frame ===", "## mock_text", "mock_text",
          "=== SECTION: volume_map ===", "## mock_text 1", "mock_text",
          "=== SECTION: roles ===", "---ROLE---", "tier: major", "name: X", "---CONTENT---", "mock_text",
          "=== SECTION: book_rules ===", "---", "version: \"1.0\"", "---",
          "=== SECTION: pending_hooks ===", "| hook_id |",
        ].join("\n"),
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      });

    await agent.generateFoundation(testBook());

    const systemMsg = (chatSpy.mock.calls[0]?.[0] as Array<{ role: string; content: string }>)[0]!;
    expect(systemMsg.content).not.toContain("mock_text");
  });
});

describe("pipeline.reviseFoundation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("backs up legacy files and writes Phase 5 output", async () => {
    const { mkdtemp, writeFile, mkdir, rm, access, readdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { PipelineRunner } = await import("../pipeline/runner.js");
    const { StateManager } = await import("../state/manager.js");

    const root = await mkdtemp(join(tmpdir(), "castor-revise-e2e-"));
    const bookDir = join(root, "books", "legacy-book");

    try {
      // Construct a mock_text on disk with 4 legacy files
      await mkdir(join(bookDir, "story"), { recursive: true });
      await writeFile(join(bookDir, "story", "story_bible.md"), "# mock_text\n\n- mock_text\n- mock_text", "utf-8");
      await writeFile(join(bookDir, "story", "volume_outline.md"), "## Chương mock_text\n- mock_text", "utf-8");
      await writeFile(join(bookDir, "story", "book_rules.md"), "## mock_text\n- mock_text", "utf-8");
      await writeFile(join(bookDir, "story", "character_matrix.md"), "## mock_text\nmock_text - mock_text", "utf-8");
      await writeFile(join(bookDir, "book.json"), JSON.stringify({
        id: "legacy-book", title: "mock_text", platform: "qidian", genre: "xuanhuan",
        status: "active", targetChapters: 50, chapterWordCount: 3000, language: "vi",
        createdAt: "2026-04-01T00:00:00.000Z", updatedAt: "2026-04-01T00:00:00.000Z",
      }), "utf-8");

      // Stub architect.generateFoundation → Phase 5 output
      const mockFoundation: ArchitectOutput = {
        storyBible: "(shim)",
        volumeOutline: "(shim)",
        bookRules: "---\nversion: \"1.0\"\n---\n",
        currentState: "",
        pendingHooks: "| hook_id |",
        storyFrame: "## mock_text\n\nmock_text",
        volumeMap: "## mock_text 1\n\nmock_text",
        roles: [{ tier: "major", name: "mock_text", content: "mock_text" }],
      };
      vi.spyOn(ArchitectAgent.prototype, "generateFoundation").mockResolvedValue(mockFoundation);
      vi.spyOn(FoundationReviewerAgent.prototype, "review").mockResolvedValue({
        passed: true, totalScore: 90, dimensions: [], overallFeedback: "ok",
      } as unknown as Awaited<ReturnType<FoundationReviewerAgent["review"]>>);

      // Minimal config for PipelineRunner — mock_text TEST_CLIENT mock_text。
      const state = new StateManager(root);
      const runner = new PipelineRunner({
        state,
        projectRoot: root,
        client: TEST_CLIENT,
        model: "test-model",
      } as unknown as ConstructorParameters<typeof PipelineRunner>[0]);

      await runner.reviseFoundation("legacy-book", "mock_text");

      // New files created
      await expect(access(join(bookDir, "story", "outline", "story_frame.md"))).resolves.not.toThrow();
      await expect(access(join(bookDir, "story", "outline", "volume_map.md"))).resolves.not.toThrow();
      await expect(access(join(bookDir, "story", "roles", "major", "mock_text.md"))).resolves.not.toThrow();
      // Backup exists
      const storyEntries = await readdir(join(bookDir, "story"));
      const backupDir = storyEntries.find((e) => e.startsWith(".backup-phase4-"));
      expect(backupDir).toBeDefined();
      await expect(access(join(bookDir, "story", backupDir!, "story_bible.md"))).resolves.not.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // ---- Bug fix regression suite ----

  it("revise mock_text（current_state / pending_hooks / particle_ledger / subplot_board / emotional_arcs mock_text）", async () => {
    const { mkdtemp, writeFile, mkdir, rm, readFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { PipelineRunner } = await import("../pipeline/runner.js");
    const { StateManager } = await import("../state/manager.js");

    const root = await mkdtemp(join(tmpdir(), "castor-revise-runtime-"));
    const bookDir = join(root, "books", "live-book");

    try {
      // mock_text N mock_text legacy mock_text——mock_text + mock_text
      // mock_text"Chương  N mock_text"mock_text
      await mkdir(join(bookDir, "story"), { recursive: true });
      await writeFile(join(bookDir, "story", "story_bible.md"), "# mock_text\n- mock_text", "utf-8");
      await writeFile(join(bookDir, "story", "volume_outline.md"), "## mock_text", "utf-8");
      await writeFile(join(bookDir, "story", "book_rules.md"), "## mock_text", "utf-8");
      await writeFile(join(bookDir, "story", "character_matrix.md"), "## mock_text", "utf-8");
      // mock_text（mock_text consolidator mock_text 20 mock_text）
      await writeFile(join(bookDir, "story", "current_state.md"), "# mock_text\n\nChương 20mock_text：mock_text。", "utf-8");
      await writeFile(join(bookDir, "story", "pending_hooks.md"), "| H001 | 1 | mock_text | open | 15 | ... mock_text 15 mock_text ... |", "utf-8");
      await writeFile(join(bookDir, "story", "particle_ledger.md"), "# mock_text\n\n| 20 | 500 | mock_text | - | 10 | 510 | Chương 20 |", "utf-8");
      await writeFile(join(bookDir, "story", "subplot_board.md"), "# mock_text\n\n| S1 | mock_text | ... | 5 | 18 | 13 | active | mock_text 18 mock_text |", "utf-8");
      await writeFile(join(bookDir, "story", "emotional_arcs.md"), "# mock_text\n\n| mock_text | 15 | mock_text | mock_text | 8 | mock_text |", "utf-8");
      await writeFile(join(bookDir, "book.json"), JSON.stringify({
        id: "live-book", title: "mock_text 20 mock_text", platform: "qidian", genre: "xuanhuan",
        status: "active", targetChapters: 50, chapterWordCount: 3000, language: "vi",
        createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-04-01T00:00:00.000Z",
      }), "utf-8");

      const mockFoundation: ArchitectOutput = {
        storyBible: "(shim)", volumeOutline: "(shim)",
        bookRules: "---\nversion: \"1.0\"\n---\n",
        currentState: "", pendingHooks: "| hook_id | ...（mock_text，mock_text）|",
        storyFrame: "## mock_text\nmock_text",
        volumeMap: "## mock_text 1\nmock_text",
        roles: [{ tier: "major", name: "mock_text", content: "mock_text" }],
      };
      vi.spyOn(ArchitectAgent.prototype, "generateFoundation").mockResolvedValue(mockFoundation);
      vi.spyOn(FoundationReviewerAgent.prototype, "review").mockResolvedValue({
        passed: true, totalScore: 90, dimensions: [], overallFeedback: "ok",
      } as unknown as Awaited<ReturnType<FoundationReviewerAgent["review"]>>);

      const state = new StateManager(root);
      const runner = new PipelineRunner({
        state, projectRoot: root, client: TEST_CLIENT, model: "test-model",
      } as unknown as ConstructorParameters<typeof PipelineRunner>[0]);

      await runner.reviseFoundation("live-book", "mock_text");

      // 5 mock_text**mock_text**（mock_text"mock_text 20 mock_text"mock_text，
      // mock_text）
      const currentState = await readFile(join(bookDir, "story", "current_state.md"), "utf-8");
      expect(currentState).toContain("Chương 20mock_text：mock_text");
      expect(currentState).not.toContain("mock_text");  // init mock_text seed mock_text

      const pendingHooks = await readFile(join(bookDir, "story", "pending_hooks.md"), "utf-8");
      expect(pendingHooks).toContain("mock_text 15 mock_text");
      expect(pendingHooks).not.toContain("（mock_text，mock_text）");

      const ledger = await readFile(join(bookDir, "story", "particle_ledger.md"), "utf-8");
      expect(ledger).toContain("Chương 20");
      expect(ledger).not.toContain("| 0 | 0 | mock_text |");  // init mock_text

      const subplot = await readFile(join(bookDir, "story", "subplot_board.md"), "utf-8");
      expect(subplot).toContain("mock_text 18 mock_text");

      const emotional = await readFile(join(bookDir, "story", "emotional_arcs.md"), "utf-8");
      expect(emotional).toContain("mock_text");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("Phase 5 mock_text revise mock_text outline/roles mock_text（mock_text shim mock_text architect）", async () => {
    const { mkdtemp, writeFile, mkdir, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { PipelineRunner } = await import("../pipeline/runner.js");
    const { StateManager } = await import("../state/manager.js");

    const root = await mkdtemp(join(tmpdir(), "castor-revise-phase5-"));
    const bookDir = join(root, "books", "phase5-book");

    try {
      // mock_text Phase 5 mock_text
      await mkdir(join(bookDir, "story", "outline"), { recursive: true });
      await mkdir(join(bookDir, "story", "roles", "major"), { recursive: true });
      await mkdir(join(bookDir, "story", "roles", "minor"), { recursive: true });
      // outline/ mock_text，mock_text
      await writeFile(join(bookDir, "story", "outline", "story_frame.md"),
        "## mock_text\nmock_text，mock_text、mock_text、mock_text。" + "a".repeat(5000),
        "utf-8");
      await writeFile(join(bookDir, "story", "outline", "volume_map.md"),
        "## mock_text 1\nmock_text。" + "b".repeat(5000),
        "utf-8");
      // roles/ mock_text，mock_text
      await writeFile(join(bookDir, "story", "roles", "major", "mock_text.md"),
        "## mock_text\nmock_text、mock_text\n\n## mock_text\nmock_text，3000  từmock_text，mock_text" + "c".repeat(3000),
        "utf-8");
      // story_bible.md / character_matrix.md mock_text shim（mock_text）
      await writeFile(join(bookDir, "story", "story_bible.md"),
        "# mock_text（mock_text）\n\n> mock_text outline/story_frame.md\n\n## story_frame mock_text\n\nmock_text 2000  từ...",
        "utf-8");
      await writeFile(join(bookDir, "story", "character_matrix.md"),
        "# mock_text（mock_text）\n\n> mock_text roles/ mock_text\n\n## major\n\n- roles/major/mock_text.md",
        "utf-8");
      await writeFile(join(bookDir, "story", "book_rules.md"), "# mock_text shim", "utf-8");
      await writeFile(join(bookDir, "story", "volume_outline.md"), "## mock_text shim", "utf-8");
      await writeFile(join(bookDir, "book.json"), JSON.stringify({
        id: "phase5-book", title: "Phase 5 mock_text", platform: "qidian", genre: "xuanhuan",
        status: "active", targetChapters: 50, chapterWordCount: 3000, language: "vi",
        createdAt: "2026-04-01T00:00:00.000Z", updatedAt: "2026-04-10T00:00:00.000Z",
      }), "utf-8");

      const generateSpy = vi.spyOn(ArchitectAgent.prototype, "generateFoundation")
        .mockResolvedValue({
          storyBible: "(shim)", volumeOutline: "(shim)",
          bookRules: "---\nversion: \"1.0\"\n---\n",
          currentState: "", pendingHooks: "| hook_id |",
          storyFrame: "## mock_text\nmock_text v2",
          volumeMap: "## mock_text 1\nmock_text v2",
          roles: [{ tier: "major", name: "mock_text", content: "mock_text v2" }],
        });
      vi.spyOn(FoundationReviewerAgent.prototype, "review").mockResolvedValue({
        passed: true, totalScore: 90, dimensions: [], overallFeedback: "ok",
      } as unknown as Awaited<ReturnType<FoundationReviewerAgent["review"]>>);

      const state = new StateManager(root);
      const runner = new PipelineRunner({
        state, projectRoot: root, client: TEST_CLIENT, model: "test-model",
      } as unknown as ConstructorParameters<typeof PipelineRunner>[0]);

      await runner.reviseFoundation("phase5-book", "mock_text");

      // mock_text architect mock_text reviseFrom.storyBible mock_text characterMatrix mock_text，
      // mock_text shim mock_text
      const call = generateSpy.mock.calls[0];
      const options = call?.[3] as { reviseFrom?: { storyBible: string; characterMatrix: string } };
      expect(options?.reviseFrom?.storyBible).toContain("mock_text");
      expect(options?.reviseFrom?.storyBible).not.toContain("mock_text");
      expect(options?.reviseFrom?.characterMatrix).toContain("mock_text，3000  từmock_text");
      expect(options?.reviseFrom?.characterMatrix).not.toContain("roles/major/mock_text.md");  // shim mock_text
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("revise mock_text role mock_text（mock_text/mock_text）", async () => {
    const { mkdtemp, writeFile, mkdir, rm, access } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { PipelineRunner } = await import("../pipeline/runner.js");
    const { StateManager } = await import("../state/manager.js");

    const root = await mkdtemp(join(tmpdir(), "castor-revise-ghost-"));
    const bookDir = join(root, "books", "ghost-book");

    try {
      // mock_text：Phase 5 mock_text 3 mock_textmajor、2 mock_textminor
      await mkdir(join(bookDir, "story", "outline"), { recursive: true });
      await mkdir(join(bookDir, "story", "roles", "major"), { recursive: true });
      await mkdir(join(bookDir, "story", "roles", "minor"), { recursive: true });
      await writeFile(join(bookDir, "story", "outline", "story_frame.md"), "## mock_text", "utf-8");
      await writeFile(join(bookDir, "story", "outline", "volume_map.md"), "## mock_text 1", "utf-8");
      await writeFile(join(bookDir, "story", "roles", "major", "mock_text.md"), "mock_text", "utf-8");
      await writeFile(join(bookDir, "story", "roles", "major", "mock_text.md"), "mock_text", "utf-8");
      await writeFile(join(bookDir, "story", "roles", "major", "mock_textA.md"), "mock_text", "utf-8");
      await writeFile(join(bookDir, "story", "roles", "minor", "mock_text.md"), "mock_text", "utf-8");
      await writeFile(join(bookDir, "story", "roles", "minor", "mock_text.md"), "mock_text", "utf-8");
      await writeFile(join(bookDir, "story", "book_rules.md"), "", "utf-8");
      await writeFile(join(bookDir, "story", "character_matrix.md"), "", "utf-8");
      await writeFile(join(bookDir, "story", "story_bible.md"), "", "utf-8");
      await writeFile(join(bookDir, "story", "volume_outline.md"), "", "utf-8");
      await writeFile(join(bookDir, "book.json"), JSON.stringify({
        id: "ghost-book", title: "Test", platform: "qidian", genre: "xuanhuan",
        status: "active", targetChapters: 50, chapterWordCount: 3000, language: "vi",
        createdAt: "2026-04-01T00:00:00.000Z", updatedAt: "2026-04-10T00:00:00.000Z",
      }), "utf-8");

      // architect revise mock_text 2 mock_text role（mock_text、mock_text id、mock_text "mock_text"）
      vi.spyOn(ArchitectAgent.prototype, "generateFoundation").mockResolvedValue({
        storyBible: "(shim)", volumeOutline: "(shim)",
        bookRules: "---\nversion: \"1.0\"\n---\n",
        currentState: "", pendingHooks: "| hook_id |",
        storyFrame: "## mock_text\nmock_text", volumeMap: "## mock_text 1\nmock_text",
        roles: [
          { tier: "major", name: "mock_text", content: "mock_text" },
          { tier: "major", name: "mock_textB", content: "mock_text" },
        ],
      });
      vi.spyOn(FoundationReviewerAgent.prototype, "review").mockResolvedValue({
        passed: true, totalScore: 90, dimensions: [], overallFeedback: "ok",
      } as unknown as Awaited<ReturnType<FoundationReviewerAgent["review"]>>);

      const state = new StateManager(root);
      const runner = new PipelineRunner({
        state, projectRoot: root, client: TEST_CLIENT, model: "test-model",
      } as unknown as ConstructorParameters<typeof PipelineRunner>[0]);

      await runner.reviseFoundation("ghost-book", "mock_text");

      // mock_text 2 mock_text role mock_text
      await expect(access(join(bookDir, "story", "roles", "major", "mock_text.md"))).resolves.not.toThrow();
      await expect(access(join(bookDir, "story", "roles", "major", "mock_textB.md"))).resolves.not.toThrow();
      // mock_text 5 mock_text role mock_text，**mock_text**
      await expect(access(join(bookDir, "story", "roles", "major", "mock_text.md"))).rejects.toThrow();
      await expect(access(join(bookDir, "story", "roles", "major", "mock_textA.md"))).rejects.toThrow();
      await expect(access(join(bookDir, "story", "roles", "minor", "mock_text.md"))).rejects.toThrow();
      await expect(access(join(bookDir, "story", "roles", "minor", "mock_text.md"))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("revise mock_text + LLM mock_text legacy mock_text → mock_text", async () => {
    const { mkdtemp, writeFile, mkdir, rm, readFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { PipelineRunner } = await import("../pipeline/runner.js");
    const { StateManager } = await import("../state/manager.js");

    const root = await mkdtemp(join(tmpdir(), "castor-revise-legacyfallback-"));
    const bookDir = join(root, "books", "safe-book");

    try {
      // mock_text Phase 5 mock_text —— outline/ + roles/ mock_text
      await mkdir(join(bookDir, "story", "outline"), { recursive: true });
      await mkdir(join(bookDir, "story", "roles", "major"), { recursive: true });
      await writeFile(join(bookDir, "story", "outline", "story_frame.md"), "mock_text story_frame", "utf-8");
      await writeFile(join(bookDir, "story", "outline", "volume_map.md"), "mock_text volume_map", "utf-8");
      await writeFile(join(bookDir, "story", "roles", "major", "mock_text.md"), "mock_text", "utf-8");
      await writeFile(join(bookDir, "story", "story_bible.md"), "shim mock_text", "utf-8");
      await writeFile(join(bookDir, "story", "character_matrix.md"), "", "utf-8");
      await writeFile(join(bookDir, "story", "volume_outline.md"), "", "utf-8");
      await writeFile(join(bookDir, "story", "book_rules.md"), "", "utf-8");
      await writeFile(join(bookDir, "book.json"), JSON.stringify({
        id: "safe-book", title: "t", platform: "qidian", genre: "xuanhuan",
        status: "active", targetChapters: 50, chapterWordCount: 3000, language: "vi",
        createdAt: "2026-04-01T00:00:00.000Z", updatedAt: "2026-04-10T00:00:00.000Z",
      }), "utf-8");

      // Stub architect → mock_text LLM mock_text legacy mock_text（storyFrame mock_text / mock_text roles）
      vi.spyOn(ArchitectAgent.prototype, "generateFoundation").mockResolvedValue({
        storyBible: "LLM mock_text legacy story bible",
        volumeOutline: "LLM mock_text legacy volume outline",
        bookRules: "---\nversion: \"1.0\"\n---\n",
        currentState: "",
        pendingHooks: "| hook_id |",
        // mock_text storyFrame / volumeMap / roles —— mock_text LLM mock_text legacy
      } as unknown as Awaited<ReturnType<ArchitectAgent["generateFoundation"]>>);
      vi.spyOn(FoundationReviewerAgent.prototype, "review").mockResolvedValue({
        passed: true, totalScore: 90, dimensions: [], overallFeedback: "ok",
      } as unknown as Awaited<ReturnType<FoundationReviewerAgent["review"]>>);

      const state = new StateManager(root);
      const runner = new PipelineRunner({
        state, projectRoot: root, client: TEST_CLIENT, model: "test-model",
      } as unknown as ConstructorParameters<typeof PipelineRunner>[0]);

      // revise mock_text
      await expect(runner.reviseFoundation("safe-book", "mock_text"))
        .rejects.toThrow(/legacy-format output.*NOT been modified/);

      // mock_text**mock_text**（writeFoundationFiles mock_text）
      // mock_text：rolesMajorDir mock_text reviseFoundation mock_text Step 5 mock_text mkdir（mock_text），
      // mock_text loop mock_text，mock_text：mock_text rm + mkdir mock_text writeFile mock_text。
      // mock_text rm mock_text，mock_text runner.reviseFoundation mock_text
      // .backup-phase5-<ts>/ mock_text。mock_text。
      const storyFrame = await readFile(join(bookDir, "story", "outline", "story_frame.md"), "utf-8");
      expect(storyFrame).toBe("mock_text story_frame");  // outline/ mock_text

      const volumeMap = await readFile(join(bookDir, "story", "outline", "volume_map.md"), "utf-8");
      expect(volumeMap).toBe("mock_text volume_map");

      // story_bible.md mock_text（legacy mock_text "LLM mock_text legacy story bible" mock_text）
      const storyBible = await readFile(join(bookDir, "story", "story_bible.md"), "utf-8");
      expect(storyBible).toBe("shim mock_text");
      expect(storyBible).not.toContain("LLM mock_text legacy");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("Phase 5 revise mock_text phase5 tag mock_text outline/ + roles/", async () => {
    const { mkdtemp, writeFile, mkdir, rm, readdir, access } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { PipelineRunner } = await import("../pipeline/runner.js");
    const { StateManager } = await import("../state/manager.js");

    const root = await mkdtemp(join(tmpdir(), "castor-revise-backup-"));
    const bookDir = join(root, "books", "p5");

    try {
      await mkdir(join(bookDir, "story", "outline"), { recursive: true });
      await mkdir(join(bookDir, "story", "roles", "major"), { recursive: true });
      await writeFile(join(bookDir, "story", "outline", "story_frame.md"), "mock_text frame", "utf-8");
      await writeFile(join(bookDir, "story", "outline", "volume_map.md"), "mock_text map", "utf-8");
      await writeFile(join(bookDir, "story", "roles", "major", "A.md"), "mock_text A", "utf-8");
      await writeFile(join(bookDir, "story", "book_rules.md"), "", "utf-8");
      await writeFile(join(bookDir, "story", "character_matrix.md"), "", "utf-8");
      await writeFile(join(bookDir, "story", "story_bible.md"), "", "utf-8");
      await writeFile(join(bookDir, "story", "volume_outline.md"), "", "utf-8");
      await writeFile(join(bookDir, "book.json"), JSON.stringify({
        id: "p5", title: "t", platform: "qidian", genre: "xuanhuan",
        status: "active", targetChapters: 50, chapterWordCount: 3000, language: "vi",
        createdAt: "2026-04-01T00:00:00.000Z", updatedAt: "2026-04-10T00:00:00.000Z",
      }), "utf-8");

      vi.spyOn(ArchitectAgent.prototype, "generateFoundation").mockResolvedValue({
        storyBible: "(shim)", volumeOutline: "(shim)",
        bookRules: "---\nversion: \"1.0\"\n---\n",
        currentState: "", pendingHooks: "| hook_id |",
        storyFrame: "## mock_text", volumeMap: "## mock_text",
        roles: [{ tier: "major", name: "B", content: "mock_text" }],
      });
      vi.spyOn(FoundationReviewerAgent.prototype, "review").mockResolvedValue({
        passed: true, totalScore: 90, dimensions: [], overallFeedback: "ok",
      } as unknown as Awaited<ReturnType<FoundationReviewerAgent["review"]>>);

      const state = new StateManager(root);
      const runner = new PipelineRunner({
        state, projectRoot: root, client: TEST_CLIENT, model: "test-model",
      } as unknown as ConstructorParameters<typeof PipelineRunner>[0]);

      await runner.reviseFoundation("p5", "mock_text");

      const entries = await readdir(join(bookDir, "story"));
      const backupDir = entries.find((e) => e.startsWith(".backup-phase5-"));
      expect(backupDir).toBeDefined();
      // backup mock_text outline/ mock_text roles/（Phase 5 mock_text）
      await expect(access(join(bookDir, "story", backupDir!, "outline", "story_frame.md"))).resolves.not.toThrow();
      await expect(access(join(bookDir, "story", backupDir!, "outline", "volume_map.md"))).resolves.not.toThrow();
      await expect(access(join(bookDir, "story", backupDir!, "roles", "major", "A.md"))).resolves.not.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
