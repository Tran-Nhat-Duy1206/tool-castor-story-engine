import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateManager } from "../state/manager.js";
import { ArchitectIncompleteFoundationError } from "../agents/architect.js";
import {
  createReadTool,
  createGenerateCoverTool,
  createSubAgentTool,
  createShortFictionRunTool,
  createPatchChapterTextTool,
  createReplaceChapterTextTool,
  createResyncChapterStateTool,
  createDeleteLatestChapterTool,
  createPlayEditTool,
  createPlayStartTool,
  createProposeActionTool,
  createRenameEntityTool,
  createScriptCreationTool,
  createStoryboardCreationTool,
  createInteractiveFilmCreationTool,
  createManageBookReferenceTool,
  createWriteFileTool,
  createWriteTruthFileTool,
} from "../agent/agent-tools.js";
import { ingestMaterial } from "../materials/ingest.js";
import { createPlayDB } from "../play/play-db-factory.js";
import { PlayStore } from "../play/play-store.js";

function contextPipeline<T extends object>(pipeline: T): T & {
  readonly runWithAgentContext: ReturnType<typeof vi.fn>;
} {
  return {
    runWithAgentContext: vi.fn(async (
      context: { readonly signal?: AbortSignal },
      task: () => Promise<unknown>,
    ) => {
      context.signal?.throwIfAborted();
      return task();
    }),
    ...pipeline,
  };
}

describe("agent deterministic writing tools", () => {
  let root: string;
  let state: StateManager;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "castor-agent-tools-"));
    state = new StateManager(root);

    await state.saveBookConfig("harbor", {
      id: "harbor",
      title: "Harbor",
      platform: "tomato",
      genre: "other",
      status: "active",
      targetChapters: 20,
      chapterWordCount: 3000,
      createdAt: "2026-04-16T00:00:00.000Z",
      updatedAt: "2026-04-16T00:00:00.000Z",
    });

    await mkdir(join(state.bookDir("harbor"), "story", "runtime"), { recursive: true });
    await mkdir(join(state.bookDir("harbor"), "chapters"), { recursive: true });
    await writeFile(join(state.bookDir("harbor"), "story", "story_bible.md"), "# Story Bible\n\nLin Yue guards the jade seal.\n", "utf-8");
    await writeFile(
      join(state.bookDir("harbor"), "chapters", "0003_Storm.md"),
      "# Chương 3 mock_text\n\nLin Yue kept the jade seal hidden under wet burlap, and she did not tell the guild.\n",
      "utf-8",
    );
    await state.saveChapterIndex("harbor", [{
      number: 3,
      title: "mock_text",
      status: "ready-for-review",
      wordCount: 120,
      createdAt: "2026-04-16T00:00:00.000Z",
      updatedAt: "2026-04-16T00:00:00.000Z",
      auditIssues: [],
      lengthWarnings: [],
    }]);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("writes truth files through the deterministic tool path", async () => {
    const tool = createWriteTruthFileTool({} as never, root, "harbor");

    const result = await tool.execute("tool-1", {
      fileName: "story_bible.md",
      content: "# Story Bible\n\nLin Yue now distrusts the guild.\n",
    });

    expect(result.content[0]?.type).toBe("text");
    await expect(readFile(join(state.bookDir("harbor"), "story", "story_bible.md"), "utf-8"))
      .resolves.toContain("distrusts the guild");
  });

  it("binds, lists, and unbinds project reference assets for the active book", async () => {
    await writeFile(join(root, "reference.md"), "# mock_text\nmock_text。\n", "utf-8");
    const asset = await ingestMaterial(root, {
      sourceKind: "file",
      filePath: "reference.md",
      title: "mock_text",
      purpose: "reference",
    });
    const tool = createManageBookReferenceTool(root, "harbor");

    const bound = await tool.execute("bind-reference", {
      action: "bind",
      materialId: asset.id,
      uses: ["mock_text"],
      note: "mock_text。",
    });
    expect(bound.details).toMatchObject({
      kind: "book_reference_bound",
      bookId: "harbor",
      materialId: asset.id,
      uses: ["mock_text"],
    });

    const listed = await tool.execute("list-references", { action: "list" });
    expect(listed.details).toMatchObject({
      kind: "book_reference_list",
      bookId: "harbor",
      references: [expect.objectContaining({ title: "mock_text", available: true })],
    });

    const unbound = await tool.execute("unbind-reference", {
      action: "unbind",
      materialId: asset.id,
    });
    expect(unbound.details).toMatchObject({
      kind: "book_reference_unbound",
      removed: true,
      materialId: asset.id,
    });
  });

  it("deletes only the latest chapter through the deterministic tool path", async () => {
    const snapshotDir = join(state.bookDir("harbor"), "story", "snapshots", "2");
    await mkdir(snapshotDir, { recursive: true });
    await writeFile(join(snapshotDir, "current_state.md"), "# Current State\n\nChapter 2.", "utf-8");
    await writeFile(join(snapshotDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8");
    await writeFile(join(state.bookDir("harbor"), "story", "current_state.md"), "# Current State\n\nChapter 3.", "utf-8");
    await writeFile(join(state.bookDir("harbor"), "story", "pending_hooks.md"), "# Pending Hooks\n", "utf-8");

    const tool = createDeleteLatestChapterTool(root, "harbor");
    const result = await tool.execute("tool-delete", { chapterNumber: 3 });

    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Deleted latest chapter 3"),
    });
    expect(result.details).toMatchObject({
      kind: "chapter_deleted",
      bookId: "harbor",
      deletedChapter: 3,
      rolledBackTo: 2,
    });
    await expect(state.loadChapterIndex("harbor")).resolves.toEqual([]);
    await expect(readFile(
      join(state.bookDir("harbor"), "chapters", ".trash", "0003_Storm.md"),
      "utf-8",
    )).resolves.toContain("jade seal");
  });

  it("writes role cards through the deterministic truth-file tool path", async () => {
    const tool = createWriteTruthFileTool({} as never, root, "harbor");

    const result = await tool.execute("tool-role", {
      fileName: "roles/major/mock_text.md",
      content: "# mock_text\n\n- mock_text：mock_text，mock_text。\n",
    });

    expect(result.content[0]?.type).toBe("text");
    await expect(readFile(join(state.bookDir("harbor"), "story", "roles", "major", "mock_text.md"), "utf-8"))
      .resolves.toContain("mock_text");
  });

  it("renames entities through the deterministic edit controller", async () => {
    const tool = createRenameEntityTool({} as never, root, "harbor");

    await tool.execute("tool-3", {
      oldValue: "Lin Yue",
      newValue: "Lin Yan",
    });

    await expect(readFile(join(state.bookDir("harbor"), "story", "story_bible.md"), "utf-8"))
      .resolves.toContain("Lin Yan");
    await expect(readFile(join(state.bookDir("harbor"), "chapters", "0003_Storm.md"), "utf-8"))
      .resolves.toContain("Lin Yan");
  });

  it("patches chapter text through the deterministic edit controller", async () => {
    const tool = createPatchChapterTextTool({} as never, root, "harbor");

    await tool.execute("tool-4", {
      chapterNumber: 3,
      targetText: "jade seal hidden",
      replacementText: "jade seal locked beneath the altar",
    });

    await expect(readFile(join(state.bookDir("harbor"), "chapters", "0003_Storm.md"), "utf-8"))
      .resolves.toContain("locked beneath the altar");
    await expect(state.loadChapterIndex("harbor")).resolves.toEqual([
      expect.objectContaining({
        number: 3,
        status: "audit-failed",
        auditIssues: expect.arrayContaining([
          expect.stringContaining("Manual text edit requires review"),
        ]),
      }),
    ]);
  });

  it("patches a high-confidence paragraph match when the model paraphrases the target text", async () => {
    const tool = createPatchChapterTextTool({} as never, root, "harbor");

    await tool.execute("tool-4-fuzzy", {
      chapterNumber: 3,
      targetText: "Lin Yue kept the jade seal under wet burlap and told no one from the guild.",
      replacementText: "Lin Yue locked the jade seal beneath the altar and let the guild keep guessing.",
    });

    const updated = await readFile(join(state.bookDir("harbor"), "chapters", "0003_Storm.md"), "utf-8");
    expect(updated).toContain("beneath the altar");
    expect(updated).not.toContain("wet burlap");
  });

  it("replaces whole chapter text through the deterministic edit controller", async () => {
    const tool = createReplaceChapterTextTool({} as never, root, "harbor");

    await tool.execute("tool-4b", {
      chapterNumber: 3,
      fullText: "# Chương 3 mock_text\n\nmock_text。",
    });

    await expect(readFile(join(state.bookDir("harbor"), "chapters", "0003_Storm.md"), "utf-8"))
      .resolves.toContain("mock_text");
    // Phase 4 (Task 9): a manual whole-chapter replacement is state-relevant,
    // so the edit transaction publishes the new prose AND lands the lifecycle
    // on needs-state-review inside one atomic set — no post-transaction
    // saveChapterIndex, no fabricated audit-failed marker. The prior review
    // artifact is replaced by a non-confirmable rebuild_required shell.
    const indexOnDisk = JSON.parse(
      await readFile(join(state.bookDir("harbor"), "chapters", "index.json"), "utf-8"),
    ) as Array<{ number: number; status: string; auditIssues: string[] }>;
    expect(indexOnDisk).toEqual([
      expect.objectContaining({
        number: 3,
        status: "needs-state-review",
        wordCount: expect.any(Number),
        auditIssues: [],
      }),
    ]);
    const shell = JSON.parse(
      await readFile(join(state.bookDir("harbor"), "story", "runtime", "chapter-0003.state-review.json"), "utf-8"),
    ) as { status: string; sourceChapter: number };
    expect(shell.status).toBe("rebuild_required");
    expect(shell.sourceChapter).toBe(3);
  });

  it("resyncs derived chapter state and returns the fresh audit result without rewriting prose", async () => {
    const pipeline = contextPipeline({
      resyncChapterStateAndAudit: vi.fn(async () => ({
        chapter: {
          chapterNumber: 3,
          title: "mock_text",
          wordCount: 120,
          status: "ready-for-review",
        },
        audit: {
          chapterNumber: 3,
          passed: false,
          summary: "one continuity issue remains",
          issues: [{
            severity: "warning" as const,
            category: "continuity",
            description: "The recovered hook is not yet reflected in the final paragraph.",
            suggestion: "Align the final paragraph with the persisted hook.",
          }],
        },
      })),
    });
    const tool = createResyncChapterStateTool(pipeline as never, "harbor", { language: "en" });

    const result = await tool.execute("resync-3", { chapterNumber: 3, allowNewHooks: false });

    expect(pipeline.resyncChapterStateAndAudit).toHaveBeenCalledWith("harbor", 3, { allowNewHooks: false });
    expect(result.details).toMatchObject({
      kind: "chapter_state_resynced",
      chapterNumber: 3,
      auditPassed: false,
      status: "audit-failed",
    });
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("recovered hook"),
    });
  });

  it("requires an explicit title when the architect sub-agent creates a book", async () => {
    const pipeline = {
      initBook: vi.fn(async () => undefined),
    };
    const tool = createSubAgentTool(pipeline as never, null);

    const result = await tool.execute("tool-5", {
      agent: "architect",
      instruction: "mock_text",
    });

    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("title is required");
    }
    expect(pipeline.initBook).not.toHaveBeenCalled();
  });

  it("localizes propose_action fallback copy", async () => {
    const zhTool = createProposeActionTool("vi");
    const enTool = createProposeActionTool("en");

    const zh = await zhTool.execute("proposal-zh", {
      action: "create_book",
      instruction: "mock_text",
      createBook: {
        title: "mock_text",
      },
    });
    const en = await enTool.execute("proposal-en", {
      action: "generate_cover",
      instruction: "Generate a cover for Night Ledger.",
      generateCover: {
        title: "Night Ledger",
      },
    });

    expect(zh.content[0]?.type).toBe("text");
    expect(en.content[0]?.type).toBe("text");
    if (zh.content[0]?.type === "text") {
      expect(zh.content[0].text).toContain("mock_text");
      expect(zh.content[0].text).toContain("mock_text");
      expect(zh.content[0].text).toContain("mock_text");
    }
    if (en.content[0]?.type === "text") {
      expect(en.content[0].text).toContain("Generate cover");
      expect(en.content[0].text).toContain("After confirmation");
    }
  });

  it("marks in-surface confirmation proposals when requested", async () => {
    const tool = createProposeActionTool("vi", { sameSession: true });

    const result = await tool.execute("proposal-same-session", {
      action: "short_run",
      instruction: "mock_text",
      shortRun: { title: "mock_text", direction: "mock_text" },
    });

    expect(result.details).toMatchObject({
      kind: "proposed_action",
      action: "short_run",
      targetSessionKind: "short",
      sameSession: true,
    });
  });

  it("carries skills activated by the agent into the confirmed action", async () => {
    const activatedSkillIds = ["writer-distillation"];
    const tool = createProposeActionTool("vi", {
      requestedSkillIds: () => activatedSkillIds,
    });

    const result = await tool.execute("proposal-with-skill", {
      action: "short_run",
      instruction: "mock_text",
      shortRun: { title: "mock_text", direction: "mock_text" },
    });

    expect(result.details).toMatchObject({
      kind: "proposed_action",
      action: "short_run",
      requestedSkills: ["writer-distillation"],
    });
  });

  it("requires a host-owned title and direction before proposing short production", async () => {
    const tool = createProposeActionTool("vi");

    await expect(tool.execute("proposal-missing-short-title", {
      action: "short_run",
      instruction: "mock_text",
      shortRun: { direction: "mock_text" } as any,
    })).rejects.toThrow(/shortRun\.title/);
  });

  it("carries structured execution payloads in proposed actions", async () => {
    const tool = createProposeActionTool("vi");

    const result = await tool.execute("proposal-book", {
      action: "create_book",
      instruction: "mock_text《mock_text》，mock_text，100mock_text，mock_text2600 từ。",
      createBook: {
        title: "mock_text",
        genre: "urban",
        platform: "tomato",
        targetChapters: 100,
        chapterWordCount: 2600,
        language: "vi",
      },
    });

    expect(result.details).toMatchObject({
      kind: "proposed_action",
      action: "create_book",
      actionPayload: {
        createBook: {
          title: "mock_text",
          genre: "urban",
          platform: "tomato",
          targetChapters: 100,
          chapterWordCount: 2600,
          language: "vi",
        },
      },
    });
  });

  it("preserves the model-proposed Play scene without semantic template filtering", async () => {
    const tool = createProposeActionTool("vi");

    const result = await tool.execute("proposal-play", {
      action: "play_start",
      instruction: "mock_text，mock_text。",
      playStart: {
        title: "mock_text",
        premise: "mock_text，mock_text。",
        mode: "open",
        initialScene: "mock_text《mock_text》，mock_text từmock_text",
        suggestedActions: ["mock_text", "mock_text"],
      },
    });

    expect(result.details).toMatchObject({
      actionPayload: {
        playStart: {
          initialScene: "mock_text《mock_text》，mock_text từmock_text",
        },
      },
    });
  });

  it("keeps play world and visual contracts in the structured confirmation payload", async () => {
    const tool = createProposeActionTool("vi");

    const result = await tool.execute("proposal-play-contract", {
      action: "play_start",
      instruction: "mock_text，mock_text。",
      playStart: {
        title: "mock_text",
        premise: "mock_text，mock_textGiau giemmock_text。",
        mode: "open",
        worldContract: "mock_text；mock_text；mock_text，mock_text RPG mock_text。",
        visualContract: "mock_text、mock_text、mock_text，mock_text UI。",
        initialScene: "mock_text，mock_text từmock_text。",
        suggestedActions: ["mock_text", "mock_text"],
      },
    });

    expect(result.details).toMatchObject({
      kind: "proposed_action",
      action: "play_start",
      actionPayload: {
        playStart: {
          worldContract: expect.stringContaining("mock_text"),
          visualContract: expect.stringContaining("mock_text"),
        },
      },
    });
  });

  it("keeps script creation specs in the structured confirmation payload", async () => {
    const tool = createProposeActionTool("vi");

    const result = await tool.execute("proposal-script", {
      action: "script_create",
      instruction: "mock_text 12 mock_text，mock_text、mock_text。",
      scriptCreate: {
        title: "mock_text",
        sourceKind: "mock_text",
        targetFormat: "vertical_short_drama",
        requirements: "mock_text、mock_text、mock_text。",
        episodeCount: 12,
        episodeDuration: "2mock_text",
      },
    });

    expect(result.details).toMatchObject({
      kind: "proposed_action",
      action: "script_create",
      targetSessionKind: "script",
      actionPayload: {
        scriptCreate: {
          title: "mock_text",
          targetFormat: "vertical_short_drama",
          episodeCount: 12,
        },
      },
    });
  });

  it("keeps storyboard specs in the structured confirmation payload", async () => {
    const tool = createProposeActionTool("vi");

    const result = await tool.execute("proposal-storyboard", {
      action: "storyboard_create",
      instruction: "mock_text 9:16 mock_text，mock_text，mock_text。",
      storyboardCreate: {
        title: "mock_text",
        sourceKind: "mock_text",
        visualStyle: "mock_text",
        aspectRatio: "9:16",
        granularity: "mock_text",
        maxShots: 18,
      },
    });

    expect(result.details).toMatchObject({
      kind: "proposed_action",
      action: "storyboard_create",
      targetSessionKind: "storyboard",
      actionPayload: {
        storyboardCreate: {
          title: "mock_text",
          visualStyle: "mock_text",
          maxShots: 18,
        },
      },
    });
  });

  it("keeps interactive-film specs in the structured confirmation payload", async () => {
    const tool = createProposeActionTool("vi");

    const result = await tool.execute("proposal-interactive-film", {
      action: "interactive_film_create",
      instruction: "mock_text，mock_text、mock_text、mock_text。",
      interactiveFilmCreate: {
        title: "mock_text",
        sourceKind: "mock_text",
        requirements: "mock_text，mock_text，mock_textQuyet dinh。",
        targetAudience: "mock_text",
        budget: "5000mock_text",
        referenceMode: "mock_text",
      },
    });

    expect(result.details).toMatchObject({
      kind: "proposed_action",
      action: "interactive_film_create",
      targetSessionKind: "interactive-film",
      actionPayload: {
        interactiveFilmCreate: {
          title: "mock_text",
          budget: "5000mock_text",
        },
      },
    });
  });

  it("declares executable proposal fields as required in the model-facing schema", () => {
    const tool = createProposeActionTool("vi");
    const schema = tool.parameters as {
      properties?: Record<string, { required?: string[] }>;
    };

    expect(schema.properties?.interactiveFilmCreate?.required).toContain("title");
    expect(schema.properties?.shortRun?.required).toEqual(expect.arrayContaining(["title", "direction"]));
    expect(schema.properties?.playStart?.required).toEqual(expect.arrayContaining(["title", "premise", "initialScene"]));
    expect(schema.properties?.translationCreate?.required).toEqual(expect.arrayContaining([
      "filePath",
      "sourceLanguage",
      "targetLanguage",
    ]));
  });

  it("drops non-positive placeholder counts from interactive-film confirmation payloads", async () => {
    const tool = createProposeActionTool("vi");

    const result = await tool.execute("proposal-interactive-film-zero-count", {
      action: "interactive_film_create",
      instruction: "mock_text。",
      interactiveFilmCreate: {
        title: "Chương mock_text",
        requirements: "mock_text，mock_text，mock_text。",
        episodeCount: 0,
      },
    });

    expect(result.details).toMatchObject({
      kind: "proposed_action",
      action: "interactive_film_create",
      actionPayload: {
        interactiveFilmCreate: {
          title: "Chương mock_text",
          requirements: "mock_text，mock_text，mock_text。",
        },
      },
    });
    expect(JSON.stringify(result.details)).not.toContain("episodeCount");
  });

  it("uses the confirmed Play scene as the execution source of truth", async () => {
    let seededScene = "";
    const pipeline = contextPipeline({
      createAgentContext: vi.fn(() => ({})),
    });
    const tool = createPlayStartTool(pipeline as never, root, "play-session-truncated", "open", {
      actionPayload: {
        playStart: {
          title: "mock_text",
          premise: "mock_text，mock_text。",
          mode: "open",
          initialScene: "mock_text《mock_text》，mock_text từmock_text",
          suggestedActions: ["mock_text"],
        },
      },
      runnerFactory: ({ db }) => ({
        async seedOpening(input) {
          seededScene = input.sceneText;
          db.upsertEntity({
            id: "actor_player",
            type: "actor",
            label: "mock_text",
            summary: "mock_text。",
          });
          db.upsertEntity({
            id: "location_theater",
            type: "location",
            label: "mock_text",
            summary: "Mo daumock_text。",
          });
          return null;
        },
      }),
    });

    await tool.execute("play-start", {
      title: "mock_text",
      premise: "mock_text，mock_text。",
      mode: "open",
      initialScene: "mock_text，mock_text，mock_text。",
      suggestedActions: ["mock_text"],
    });

    expect(seededScene).toContain("mock_text từmock_text");
    await expect(readFile(join(root, "worlds", "play-session-truncated", "runs", "main", "projections", "scene.md"), "utf-8"))
      .resolves.toContain("mock_text từmock_text");
  });

  it("does not emit a confirmation card when the proposed action payload is invalid", async () => {
    const tool = createProposeActionTool("vi");

    await expect(tool.execute("proposal-invalid", {
      action: "create_book",
      instruction: "mock_text《mock_text》",
      createBook: {
        title: "mock_text",
        platform: "tomato",
        unsafeExtra: "must not reach the UI",
      },
    } as never)).rejects.toThrow("Invalid proposed action payload");
  });

  it("rejects Play confirmation cards without structured execution payload", async () => {
    const tool = createProposeActionTool("vi");

    await expect(tool.execute("proposal-play-missing-payload", {
      action: "play_start",
      title: "mock_text",
      summary: "mock_text。",
      instruction: "mock_text，mock_text，mock_text。",
    })).rejects.toThrow("playStart.title");
  });

  it("proposes derivative production with structured payloads and no form route", async () => {
    const tool = createProposeActionTool("vi");

    const cases = [
      {
        action: "fanfic_init",
        payload: { fanficCreate: { title: "mock_text", sourceText: "mock_text", sourceName: "mock_text" } },
        title: "mock_text",
      },
      {
        action: "continuation_import",
        payload: { continuationImport: { title: "mock_text", sourcePath: ".castor/uploads/novel.txt" } },
        title: "mock_text",
      },
      {
        action: "spinoff_create",
        payload: { spinoffCreate: { title: "mock_text", parentBookId: "harbor", direction: "mock_text" } },
        title: "mock_text",
      },
      {
        action: "style_imitation",
        payload: { imitationCreate: { title: "mock_text", referenceText: "mock_text", storyIdea: "mock_text" } },
        title: "mock_text",
      },
    ] as const;

    for (const item of cases) {
      const result = await tool.execute(`proposal-${item.action}`, {
        action: item.action,
        instruction: "mock_text。",
        ...item.payload,
      });

      expect(result.content[0]?.type).toBe("text");
      if (result.content[0]?.type === "text") {
        expect(result.content[0].text).toContain(item.title);
        expect(result.content[0].text).toContain("mock_text");
      }
      expect(result.details).toMatchObject({
        kind: "proposed_action",
        action: item.action,
        targetSessionKind: "chat",
        actionPayload: item.payload,
      });
      expect(result.details).not.toHaveProperty("targetRoute");
    }
  });

  it("uses the single host-provided attachment as the derivative source when the model omits its path", async () => {
    const attachmentPath = ".castor/uploads/session/style-source.md";
    const tool = createProposeActionTool("vi", {
      attachmentPaths: () => [attachmentPath],
    });

    const result = await tool.execute("proposal-imitation-attachment", {
      action: "style_imitation",
      instruction: "mock_text。",
      imitationCreate: {
        title: "mock_text",
        storyIdea: "mock_text。",
      },
    });

    expect(result.details).toMatchObject({
      kind: "proposed_action",
      action: "style_imitation",
      actionPayload: {
        imitationCreate: {
          title: "mock_text",
          storyIdea: "mock_text。",
          referencePath: attachmentPath,
        },
      },
    });
  });

  it("replaces a truncated uploaded-file path with the single host-provided attachment", async () => {
    const attachmentPath = ".castor/uploads/session/style-source.md";
    const tool = createProposeActionTool("vi", {
      attachmentPaths: () => [attachmentPath],
    });

    const result = await tool.execute("proposal-imitation-truncated-attachment", {
      action: "style_imitation",
      instruction: "mock_text。",
      imitationCreate: {
        title: "mock_text",
        storyIdea: "mock_text。",
        referencePath: ".castor/uploads/1786846...",
      },
    });

    expect(result.details).toMatchObject({
      actionPayload: {
        imitationCreate: {
          referencePath: attachmentPath,
        },
      },
    });
  });

  it("does not guess among multiple attachment paths", async () => {
    const tool = createProposeActionTool("vi", {
      attachmentPaths: () => [
        ".castor/uploads/session/one.md",
        ".castor/uploads/session/two.md",
      ],
    });

    await expect(tool.execute("proposal-imitation-ambiguous-attachments", {
      action: "style_imitation",
      instruction: "mock_text。",
      imitationCreate: {
        title: "mock_text",
        storyIdea: "mock_text。",
      },
    })).rejects.toThrow(/referenceText or referencePath/);
  });

  it("passes the explicit architect title straight into initBook", async () => {
    const pipeline = contextPipeline({
      initBook: vi.fn(async () => undefined),
    });
    const tool = createSubAgentTool(pipeline as never, null);

    await tool.execute("tool-6", {
      agent: "architect",
      title: "mock_text",
      instruction: "mock_text",
    });

    expect(pipeline.initBook).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "mock_text",
      }),
      expect.objectContaining({
        externalContext: "mock_text",
      }),
    );
  });

  it("uses confirmed create-book payload when architect tool args drift or omit defaults", async () => {
    const pipeline = contextPipeline({
      initBook: vi.fn(async () => undefined),
    });
    const tool = createSubAgentTool(pipeline as never, null, undefined, {
      actionPayload: {
        createBook: {
          title: "mock_text",
          genre: "urban",
          platform: "tomato",
          targetChapters: 100,
          chapterWordCount: 2600,
          language: "vi",
        },
      },
    });

    await tool.execute("tool-confirmed-book", {
      agent: "architect",
      title: "mock_text",
      platform: "other",
      targetChapters: 200,
      instruction: "mock_text《mock_text》，mock_text，100mock_text。",
    } as any);

    expect(pipeline.initBook).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "mock_text",
        genre: "urban",
        platform: "tomato",
        targetChapters: 100,
        chapterWordCount: 2600,
      }),
      expect.objectContaining({
        externalContext: "mock_text《mock_text》，mock_text，100mock_text。",
      }),
    );
  });

  it("derives the confirmed book id from the confirmed title instead of model-supplied bookId", async () => {
    const pipeline = contextPipeline({
      initBook: vi.fn(async () => undefined),
    });
    const tool = createSubAgentTool(pipeline as never, null, undefined, {
      actionPayload: {
        createBook: {
          title: "Night Delivery",
          genre: "urban",
          platform: "tomato",
          language: "en",
        },
      },
    });

    const result = await tool.execute("tool-confirmed-book-id", {
      agent: "architect",
      bookId: "rogue-book",
      title: "Wrong Title",
      instruction: "Create Night Delivery.",
    } as any);

    expect(pipeline.initBook).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "night-delivery",
        title: "Night Delivery",
      }),
      expect.anything(),
    );
    expect(result.details).toMatchObject({
      kind: "book_created",
      bookId: "night-delivery",
      title: "Night Delivery",
    });
  });

  it("returns an architect incomplete result instead of throwing when foundation repair fails", async () => {
    const pipeline = contextPipeline({
      initBook: vi.fn(async () => {
        throw new ArchitectIncompleteFoundationError(
          ["roles", "pending_hooks"],
          "=== SECTION: story_frame ===\nmock_text",
          "mock_text。",
        );
      }),
    });
    const tool = createSubAgentTool(pipeline as never, null);

    const result = await tool.execute("tool-architect-incomplete", {
      agent: "architect",
      title: "mock_text",
      instruction: "mock_text",
    });

    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("mock_text");
      expect(result.content[0].text).toContain("roles");
      expect(result.content[0].text).toContain("pending_hooks");
      expect(result.content[0].text).toContain("mock_text");
    }
    expect(result.details).toMatchObject({
      kind: "architect_incomplete",
      missing: ["roles", "pending_hooks"],
      partialContent: expect.stringContaining("mock_text"),
    });
  });

  it("passes chapterWordCount through the writer sub-agent", async () => {
    const pipeline = contextPipeline({
      writeNextChapter: vi.fn(async () => ({
        chapterNumber: 4,
        wordCount: 2600,
      })),
    });
    const tool = createSubAgentTool(pipeline as never, "harbor");

    await tool.execute("tool-7", {
      agent: "writer",
      bookId: "harbor",
      chapterWordCount: 2600,
      instruction: "mock_text，mock_text 2600  từ",
    } as any);

    expect(pipeline.writeNextChapter).toHaveBeenCalledWith(
      "harbor",
      2600,
      undefined,
      "mock_text，mock_text 2600  từ",
    );
  });

  it("runs a requested chapter batch through one writer operation", async () => {
    const pipeline = contextPipeline({
      writeNextChapter: vi.fn(),
      writeChapters: vi.fn(async () => [
        { chapterNumber: 4, title: "Chương mock_text", wordCount: 2600, status: "ready-for-review" },
        { chapterNumber: 5, title: "Chương mock_text", wordCount: 2550, status: "ready-for-review" },
        { chapterNumber: 6, title: "Chương mock_text", wordCount: 2490, status: "audit-failed" },
      ]),
    });
    const tool = createSubAgentTool(pipeline as never, "harbor");

    const result = await tool.execute("tool-writer-batch", {
      agent: "writer",
      bookId: "harbor",
      chapterCount: 5,
      chapterWordCount: 2600,
      instruction: "mock_text",
    } as any);

    expect(pipeline.writeChapters).toHaveBeenCalledWith(
      "harbor",
      5,
      expect.objectContaining({ wordCount: 2600 }),
    );
    expect(pipeline.writeNextChapter).not.toHaveBeenCalled();
    expect(result.details).toMatchObject({
      kind: "chapters_written",
      requestedCount: 5,
      completedCount: 3,
      stoppedStatus: "audit-failed",
    });
  });

  it("runs the writer pipeline inside the shared AgentContext scope", async () => {
    const controller = new AbortController();
    const pipeline = contextPipeline({
      writeNextChapter: vi.fn(async () => ({ chapterNumber: 4, wordCount: 2600 })),
    });
    const tool = createSubAgentTool(pipeline as never, "harbor");

    await tool.execute("tool-writer-abort", {
      agent: "writer",
      bookId: "harbor",
      instruction: "mock_text",
    } as any, controller.signal);

    expect(pipeline.runWithAgentContext).toHaveBeenCalledWith(
      { signal: controller.signal, activatedSkills: [] },
      expect.any(Function),
    );
    expect(pipeline.writeNextChapter).toHaveBeenCalledOnce();
  });

  it("passes activated Skill guidance and the exact user instruction into the writer", async () => {
    const activatedSkills = [{
      skill: {
        id: "longform-pacing",
        name: "Long-form pacing",
        description: "Keep scene-level cause and effect visible.",
        body: "Every turn must alter pressure, evidence, or relationship state.",
        source: "external" as const,
      },
      resources: [{
        path: "references/pacing.md",
        heading: "Pressure chain",
        body: "Escalate through consequences rather than arbitrary surprises.",
        charStart: 12,
        charEnd: 88,
      }],
    }];
    const pipeline = {
      runWithAgentContext: vi.fn(async (_context: unknown, task: () => Promise<unknown>) => task()),
      writeNextChapter: vi.fn(async () => ({ chapterNumber: 4, wordCount: 2600 })),
    };
    const instruction = "mock_text：mock_text，mock_text。";
    const tool = createSubAgentTool(pipeline as never, "harbor", undefined, {
      activeSkills: () => activatedSkills,
    });

    const result = await tool.execute("tool-writer-skill", {
      agent: "writer",
      instruction,
    } as any);

    expect(pipeline.runWithAgentContext).toHaveBeenCalledWith(
      { signal: undefined, activatedSkills },
      expect.any(Function),
    );
    expect(pipeline.writeNextChapter).toHaveBeenCalledWith("harbor", undefined, undefined, instruction);
    expect(result.details).toMatchObject({
      kind: "chapter_written",
      skillIds: ["longform-pacing"],
    });
  });

  it("injects the host-selected long-writing Skill into the worker without relying on agent intent", async () => {
    const longWritingSkill = {
      skill: {
        id: "castor-long-writing",
        name: "Long-form narrative craft",
        description: "Shared long-form worker method.",
        body: "Build scenes through objective, resistance, turn, and consequence.",
        source: "builtin" as const,
      },
      resources: [],
    };
    const pipeline = {
      runWithAgentContext: vi.fn(async (_context: unknown, task: () => Promise<unknown>) => task()),
      writeNextChapter: vi.fn(async () => ({ chapterNumber: 2, wordCount: 2400 })),
    };
    const tool = createSubAgentTool(pipeline as never, "harbor", undefined, {
      workerSkills: (agent) => agent === "writer" ? [longWritingSkill] : [],
    });

    const result = await tool.execute("tool-writer-default-skill", {
      agent: "writer",
      instruction: "mock_text。",
    } as any);

    expect(pipeline.runWithAgentContext).toHaveBeenCalledWith(
      { signal: undefined, activatedSkills: [longWritingSkill] },
      expect.any(Function),
    );
    expect(result.details).toMatchObject({
      kind: "chapter_written",
      skillIds: ["castor-long-writing"],
    });
  });

  it("does not claim writer success when the chapter audit failed", async () => {
    const pipeline = contextPipeline({
      writeNextChapter: vi.fn(async () => ({
        chapterNumber: 1,
        title: "mock_text",
        wordCount: 971,
        status: "audit-failed",
      })),
    });
    const tool = createSubAgentTool(pipeline as never, "harbor");

    const result = await tool.execute("tool-writer-audit-failed", {
      agent: "writer",
      bookId: "harbor",
      instruction: "mock_text",
    } as any);

    expect(result.details).toMatchObject({
      kind: "chapter_written",
      bookId: "harbor",
      chapterNumber: 1,
      status: "audit-failed",
    });
    expect((result as typeof result & { isError?: boolean }).isError).toBe(true);
    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("audit-failed");
      expect(result.content[0].text).toContain("mock_text");
      expect(result.content[0].text).not.toContain("Chapter written");
    }
  });

  it("surfaces writer sub-agent pipeline failures as tool errors", async () => {
    const pipeline = contextPipeline({
      writeNextChapter: vi.fn(async () => {
        throw new Error("disk write failed");
      }),
    });
    const tool = createSubAgentTool(pipeline as never, "harbor");

    await expect(tool.execute("tool-writer-fails", {
      agent: "writer",
      bookId: "harbor",
      instruction: "mock_text",
    } as any)).rejects.toThrow("disk write failed");
  });

  it("surfaces unchanged reviser results instead of claiming completion", async () => {
    const pipeline = contextPipeline({
      reviseDraft: vi.fn(async () => ({
        chapterNumber: 1,
        wordCount: 11132,
        fixedIssues: [],
        applied: false,
        status: "unchanged",
        skippedReason: "Manual revision kept original chapter: before blocking=2, critical=1, aiTell=3; after blocking=2, critical=1, aiTell=3.",
        revisionDiagnostics: {
          standard: "A revision is applied only when blocking, critical, and AI-tell counts do not worsen, and at least blocking or AI-tell issues improve.",
          before: { blockingCount: 2, criticalCount: 1, aiTellCount: 3 },
          after: { blockingCount: 2, criticalCount: 1, aiTellCount: 3 },
          remainingIssues: [
            { severity: "critical", category: "Chapter Memo Drift", description: "mock_text。", suggestion: "mock_text。" },
          ],
        },
      })),
    });
    const tool = createSubAgentTool(pipeline as never, "harbor");

    const result = await tool.execute("tool-reviser-unchanged", {
      agent: "reviser",
      bookId: "harbor",
      chapterNumber: 1,
      mode: "rewrite",
      instruction: "mock_textChương mock_text",
    } as any);

    expect(pipeline.reviseDraft).toHaveBeenCalledWith("harbor", 1, "rewrite", "mock_textChương mock_text");
    expect(result.details).toMatchObject({
      kind: "chapter_revision",
      bookId: "harbor",
      chapterNumber: 1,
      mode: "rewrite",
      applied: false,
      status: "unchanged",
      skippedReason: expect.stringContaining("before blocking=2"),
      revisionDiagnostics: expect.objectContaining({
        before: { blockingCount: 2, criticalCount: 1, aiTellCount: 3 },
        after: { blockingCount: 2, criticalCount: 1, aiTellCount: 3 },
      }),
    });
    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("Revision not applied");
      expect(result.content[0].text).toContain("Revision gate");
      expect(result.content[0].text).toContain("Chapter Memo Drift");
      expect(result.content[0].text).not.toContain("Revision (rewrite) complete");
    }
  });

  it("uses the active book for writer when bookId is omitted", async () => {
    const pipeline = contextPipeline({
      writeNextChapter: vi.fn(async () => ({
        chapterNumber: 4,
        wordCount: 2600,
      })),
    });
    const tool = createSubAgentTool(pipeline as never, "harbor");

    await tool.execute("tool-writer-active", {
      agent: "writer",
      chapterWordCount: 2600,
      instruction: "mock_text",
    } as any);

    expect(pipeline.writeNextChapter).toHaveBeenCalledWith(
      "harbor",
      2600,
      undefined,
      "mock_text",
    );
  });

  it("uses structured exporter arguments instead of parsing natural-language instruction", async () => {
    const tool = createSubAgentTool({} as never, "harbor", root);

    const result = await tool.execute("tool-export-defaults", {
      agent: "exporter",
      instruction: "mock_text EPUB，mock_text",
    } as any);

    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain(".txt");
      expect(result.content[0].text).not.toContain(".epub");
    }
  });

  it("documents sub_agent bookId as an optional active-book override", () => {
    const tool = createSubAgentTool({} as never, "harbor");
    const schemaText = JSON.stringify(tool.parameters);

    expect(schemaText).toContain("current active book");
    expect(schemaText).not.toContain("required for all agents except architect");
  });

  it("blocks non-architect sub-agents when no book is active", async () => {
    const pipeline = {
      writeNextChapter: vi.fn(async () => ({
        chapterNumber: 4,
        wordCount: 2600,
      })),
    };
    const tool = createSubAgentTool(pipeline as never, null);

    const result = await tool.execute("tool-writer-no-book", {
      agent: "writer",
      instruction: "mock_text",
    } as any);

    expect(pipeline.writeNextChapter).not.toHaveBeenCalled();
    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("No active book");
    }
  });

  it("exposes a standalone short fiction tool without benchmark inputs", () => {
    const pipeline = {
      createAgentContext: vi.fn(),
    };
    const tool = createShortFictionRunTool(pipeline as never, root);
    const schemaText = JSON.stringify(tool.parameters);
    const toolText = JSON.stringify({ description: tool.description, parameters: tool.parameters });

    expect(tool.name).toBe("short_fiction_run");
    expect(schemaText).toContain("direction");
    expect(schemaText).toContain("coverModel");
    expect(schemaText).toContain("charsPerChapter");
    expect(schemaText).not.toContain("\"chars\"");
    expect(toolText).not.toContain("benchmark");
    expect(toolText).not.toContain("deconstruction");
  });

  it("exposes standalone cover generation as its own tool", () => {
    const tool = createGenerateCoverTool(root);
    const schemaText = JSON.stringify(tool.parameters);
    const toolText = JSON.stringify({ description: tool.description, parameters: tool.parameters });

    expect(tool.name).toBe("generate_cover");
    expect(schemaText).toContain("title");
    expect(schemaText).toContain("outputDir");
    expect(schemaText).toContain("coverPrompt");
    expect(toolText).toContain("revise the cover prompt");
    expect(schemaText).toContain("coverModel");
    expect(toolText).not.toContain("short_fiction_run");
  });

  it("exposes script, storyboard, and interactive-film creation as standalone production tools", () => {
    const pipeline = {
      createAgentContext: vi.fn(() => ({})),
    };
    const scriptTool = createScriptCreationTool(pipeline as never, root);
    const storyboardTool = createStoryboardCreationTool(pipeline as never, root);
    const interactiveFilmTool = createInteractiveFilmCreationTool(pipeline as never, root);

    expect(scriptTool.name).toBe("script_create");
    expect(JSON.stringify(scriptTool.parameters)).toContain("targetFormat");
    expect(JSON.stringify(scriptTool.parameters)).toContain("episodeCount");
    expect(JSON.stringify({ description: scriptTool.description, parameters: scriptTool.parameters }))
      .not.toContain("short_fiction_run");

    expect(storyboardTool.name).toBe("storyboard_create");
    expect(JSON.stringify(storyboardTool.parameters)).toContain("visualStyle");
    expect(JSON.stringify(storyboardTool.parameters)).toContain("maxShots");
    expect(JSON.stringify({ description: storyboardTool.description, parameters: storyboardTool.parameters }))
      .not.toContain("short_fiction_run");

    expect(interactiveFilmTool.name).toBe("interactive_film_create");
    expect(JSON.stringify(interactiveFilmTool.parameters)).toContain("referenceMode");
    expect(JSON.stringify(interactiveFilmTool.parameters)).toContain("budget");
    expect(JSON.stringify({ description: interactiveFilmTool.description, parameters: interactiveFilmTool.parameters }))
      .not.toContain("play_start");
  });

  it("allows architect revise mode to use the active book", async () => {
    const pipeline = contextPipeline({
      reviseFoundation: vi.fn(async () => undefined),
    });
    const tool = createSubAgentTool(pipeline as never, "harbor");

    const result = await tool.execute("tool-architect-revise-active", {
      agent: "architect",
      revise: true,
      feedback: "mock_text",
      instruction: "mock_text",
    } as any);

    expect(pipeline.reviseFoundation).toHaveBeenCalledWith("harbor", "mock_text");
    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("harbor");
    }
  });

  it("blocks architect revise mode when no book is active", async () => {
    const pipeline = {
      reviseFoundation: vi.fn(async () => undefined),
    };
    const tool = createSubAgentTool(pipeline as never, null);

    const result = await tool.execute("tool-architect-revise-no-book", {
      agent: "architect",
      bookId: "harbor",
      revise: true,
      feedback: "mock_text",
      instruction: "mock_text",
    } as any);

    expect(pipeline.reviseFoundation).not.toHaveBeenCalled();
    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("Open the book first");
    }
  });

  it("prefers explicit reviser mode over instruction guessing", async () => {
    const pipeline = contextPipeline({
      reviseDraft: vi.fn(async () => ({
        chapterNumber: 3,
        wordCount: 120,
        fixedIssues: [],
        applied: true,
        status: "ready-for-review" as const,
      })),
    });
    const tool = createSubAgentTool(pipeline as never, "harbor");

    await tool.execute("tool-8", {
      agent: "reviser",
      bookId: "harbor",
      chapterNumber: 3,
      mode: "spot-fix",
      instruction: "mock_textChương 3",
    } as any);

    expect(pipeline.reviseDraft).toHaveBeenCalledWith("harbor", 3, "spot-fix", "mock_textChương 3");
  });

  it("uses explicit exporter params instead of guessing from instruction", async () => {
    const pipeline = {};
    const tool = createSubAgentTool(pipeline as never, "harbor", root);

    const result = await tool.execute("tool-9", {
      agent: "exporter",
      bookId: "harbor",
      format: "md",
      approvedOnly: false,
      instruction: "mock_text epub",
    } as any);

    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain(".md");
    }
  });

  it("keeps read tool scoped to books by default", async () => {
    const outsidePath = join(root, "outside.md");
    await writeFile(outsidePath, "outside secret", "utf-8");
    const tool = createReadTool(root);

    const result = await tool.execute("tool-read-default", {
      path: outsidePath,
    });

    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("Path traversal blocked");
      expect(result.content[0].text).not.toContain("outside secret");
    }
  });

  it("does not silently truncate long read results", async () => {
    const longContent = `# Long File\n\n${"A".repeat(10_500)}TAIL`;
    await writeFile(join(state.bookDir("harbor"), "story", "long.md"), longContent, "utf-8");
    const tool = createReadTool(root);

    const result = await tool.execute("tool-read-long", {
      path: "harbor/story/long.md",
    });

    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toBe(longContent);
      expect(result.content[0].text).not.toContain("[truncated");
    }
  });

  it("reads project-local production sources without escaping the project root", async () => {
    const filmDir = join(root, "interactive-films", "storm-eye");
    await mkdir(filmDir, { recursive: true });
    await writeFile(join(filmDir, "script.md"), "# Storm Eye\n\nAuthoritative source.", "utf-8");
    const tool = createReadTool(root, { scope: "project" });

    const result = await tool.execute("tool-read-project", {
      path: "interactive-films/storm-eye/script.md",
    });
    expect(result.content[0]).toEqual({
      type: "text",
      text: "# Storm Eye\n\nAuthoritative source.",
    });

    const escaped = await tool.execute("tool-read-project-escape", {
      path: "../outside.md",
    });
    expect(escaped.content[0]?.type).toBe("text");
    if (escaped.content[0]?.type === "text") {
      expect(escaped.content[0].text).toContain("Path traversal blocked");
    }
  });

  it("reads absolute system paths when explicitly enabled", async () => {
    const outsidePath = join(root, "outside.md");
    await writeFile(outsidePath, "outside secret", "utf-8");
    const tool = createReadTool(root, { allowSystemPaths: true });

    const result = await tool.execute("tool-read-system", {
      path: outsidePath,
    });

    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("outside secret");
    }
  });

  it("creates nested files through the generic write tool", async () => {
    const tool = createWriteFileTool(root);

    const result = await tool.execute("tool-10", {
      path: "harbor/story/runtime/notes.md",
      content: "# Notes\n\nWatch the harbor ledger.\n",
    });

    expect(result.content[0]?.type).toBe("text");
    await expect(readFile(join(state.bookDir("harbor"), "story", "runtime", "notes.md"), "utf-8"))
      .resolves.toContain("Watch the harbor ledger");
  });

  it("writes Phase 5 outline truth files through write_truth_file", async () => {
    const tool = createWriteTruthFileTool({} as never, root, "harbor");

    const result = await tool.execute("tool-truth-outline", {
      fileName: "outline/story_frame.md",
      content: "# Story Frame\n\nThe harbor debt is the central pressure.\n",
    });

    expect(result.content[0]?.type).toBe("text");
    await expect(readFile(join(state.bookDir("harbor"), "story", "outline", "story_frame.md"), "utf-8"))
      .resolves.toContain("central pressure");
  });

  it("writes Phase 5 role truth files through write_truth_file", async () => {
    const tool = createWriteTruthFileTool({} as never, root, "harbor");

    const result = await tool.execute("tool-truth-role", {
      fileName: "roles/major/Lin Yan.md",
      content: "# Lin Yan\n\nKeeps the ledger hidden.\n",
    });

    expect(result.content[0]?.type).toBe("text");
    await expect(readFile(join(state.bookDir("harbor"), "story", "roles", "major", "Lin Yan.md"), "utf-8"))
      .resolves.toContain("ledger hidden");
  });

  it("rejects unsafe truth file names", async () => {
    const tool = createWriteTruthFileTool({} as never, root, "harbor");

    const result = await tool.execute("tool-truth-unsafe", {
      fileName: "../escape.md",
      content: "escape",
    });

    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("Invalid truth file name");
    }
  });

  it("persists Play world, visual, player persona, and entity edits without advancing a turn", async () => {
    const store = new PlayStore(root);
    await store.createWorld({
      id: "play-edit-session",
      title: "mock_text",
      premise: "mock_text。",
      mode: "open",
      worldContract: "mock_text。",
      visualContract: "mock_text，mock_text UI。",
    });
    await store.ensureRun("play-edit-session", "main");
    await store.saveCurrentState("play-edit-session", "main", {
      scene: "mock_text。",
    });
    const seedDb = createPlayDB(store.runDir("play-edit-session", "main"));
    seedDb.upsertEntity({
      id: "actor_player",
      type: "actor",
      label: "mock_text",
      summary: "mock_text。",
      status: "mock_text",
    });
    seedDb.upsertEntity({
      id: "actor_linqing",
      type: "actor",
      label: "mock_text",
      summary: "mock_text",
      status: "mock_text",
    });
    seedDb.close?.();

    const tool = createPlayEditTool(root, "play-edit-session");
    const result = await tool.execute("play-edit-1", {
      worldContractAppend: "mock_text，mock_text。",
      visualContract: "mock_text、mock_text、mock_text。",
      playerPersona: "mock_text，mock_text。",
      entityUpdates: [{
        label: "mock_text",
        type: "actor",
        summary: "Giau giemmock_textSu that，mock_text。",
        status: "mock_text",
      }],
      note: "mock_text。",
    });

    expect(result.content[0]?.type).toBe("text");
    expect(result.details).toMatchObject({
      kind: "play_world_updated",
      worldId: "play-edit-session",
      runId: "main",
      updatedWorldContract: true,
      updatedVisualContract: true,
      updatedEntities: 2,
    });
    const world = await store.loadWorld("play-edit-session");
    expect(world?.worldContract).toContain("mock_text");
    expect(world?.visualContract).toContain("mock_text");
    const stateJson = JSON.parse(await readFile(join(root, "worlds", "play-edit-session", "runs", "main", "state", "current.json"), "utf-8"));
    expect(stateJson.worldContract).toContain("mock_text");
    expect(stateJson.visualContract).toContain("mock_text");
    const db = createPlayDB(store.runDir("play-edit-session", "main"));
    const snapshot = db.snapshot();
    db.close?.();
    expect(snapshot.entities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "actor_player",
        label: "mock_text",
        summary: "mock_text，mock_text。",
      }),
      expect.objectContaining({
        id: "actor_linqing",
        label: "mock_text",
        summary: "Giau giemmock_textSu that，mock_text。",
        status: "mock_text",
      }),
    ]));
  });

  it("replaces Play contract wording instead of appending conflicting rules", async () => {
    const store = new PlayStore(root);
    await store.createWorld({
      id: "play-contract-replace",
      title: "mock_text",
      premise: "mock_text。",
      mode: "open",
      worldContract: "mock_text：mock_text / mock_text / mock_text / mock_textCong khai。mock_text。",
      visualContract: "mock_text。",
    });
    await store.ensureRun("play-contract-replace", "main");
    await store.saveCurrentState("play-contract-replace", "main", {
      turn: 0,
      worldContract: "mock_text：mock_text / mock_text / mock_text / mock_textCong khai。mock_text。",
    });

    const tool = createPlayEditTool(root, "play-contract-replace");
    const result = await tool.execute("play-edit-replace", {
      worldContractReplacements: [{
        from: "mock_text / mock_text / mock_text / mock_textCong khai",
        to: "mock_text / mock_text / mock_text / mock_text từ",
      }],
      note: "mock_text。",
    });

    expect(result.details).toMatchObject({
      kind: "play_world_updated",
      updatedWorldContract: true,
    });
    const world = await store.loadWorld("play-contract-replace");
    expect(world?.worldContract).toContain("mock_text / mock_text / mock_text / mock_text từ");
    expect(world?.worldContract).not.toContain("mock_text / mock_textCong khai");
    const stateJson = JSON.parse(await readFile(join(root, "worlds", "play-contract-replace", "runs", "main", "state", "current.json"), "utf-8"));
    expect(stateJson.turn).toBe(0);
    expect(stateJson.worldContract).toContain("mock_text / mock_text / mock_text / mock_text từ");
    expect(stateJson.worldContract).not.toContain("mock_text / mock_textCong khai");
  });
});
