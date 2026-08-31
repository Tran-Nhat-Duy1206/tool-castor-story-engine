import { describe, it, expect, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ToolExecution } from "../../../store/chat/types";
import { PipelineResultDetails, ToolExecutionSteps, UtilityExecutionRow, buildPlayRunStatusUrl, buildPlaySceneImageUrl, getChapterContextTraceDetails, getChapterRevisionDetails, getChapterStateResyncDetails, getExecutionSkillIds, getGeneratedArtifactDetails, getPlayEditDetails, getPlayToolDetails, getProposedActionContractRows, getProposedActionDetails, groupToolExecutionsChronologically } from "../ToolExecutionSteps";
import { usePreferencesStore } from "../../../store/preferences";
import { setAppLanguage } from "../../../lib/app-language";

const makeExec = (overrides: Partial<ToolExecution> & { id: string; tool: string }): ToolExecution => ({
  label: "test",
  status: "completed",
  startedAt: Date.now(),
  ...overrides,
});

describe("groupChronologically", () => {
  it("keeps read before pipeline when read happened first", () => {
    const execs: ToolExecution[] = [
      makeExec({ id: "1", tool: "read", label: "mock_val" }),
      makeExec({ id: "2", tool: "sub_agent", agent: "writer", label: "mock_val" }),
    ];

    const groups = groupToolExecutionsChronologically(execs);

    expect(groups).toHaveLength(2);
    expect(groups[0].type).toBe("utilities");
    expect(groups[1].type).toBe("pipeline");
  });

  it("groups consecutive utility tools together", () => {
    const execs: ToolExecution[] = [
      makeExec({ id: "1", tool: "read", label: "mock_val" }),
      makeExec({ id: "2", tool: "grep", label: "mock_val" }),
      makeExec({ id: "3", tool: "read", label: "mock_val" }),
    ];

    const groups = groupToolExecutionsChronologically(execs);

    expect(groups).toHaveLength(1);
    expect(groups[0].type).toBe("utilities");
    if (groups[0].type === "utilities") {
      expect(groups[0].execs).toHaveLength(3);
    }
  });

  it("interleaves utility groups around pipeline ops", () => {
    const execs: ToolExecution[] = [
      makeExec({ id: "1", tool: "read", label: "mock_val" }),
      makeExec({ id: "2", tool: "sub_agent", agent: "writer", label: "mock_val" }),
      makeExec({ id: "3", tool: "read", label: "mock_val" }),
      makeExec({ id: "4", tool: "grep", label: "mock_val" }),
    ];

    const groups = groupToolExecutionsChronologically(execs);

    expect(groups).toHaveLength(3);
    expect(groups[0].type).toBe("utilities");
    expect(groups[1].type).toBe("pipeline");
    expect(groups[2].type).toBe("utilities");
    if (groups[2].type === "utilities") {
      expect(groups[2].execs).toHaveLength(2);
    }
  });

  it("handles pipeline-only executions", () => {
    const execs: ToolExecution[] = [
      makeExec({ id: "1", tool: "sub_agent", agent: "writer", label: "mock_val" }),
    ];

    const groups = groupToolExecutionsChronologically(execs);

    expect(groups).toHaveLength(1);
    expect(groups[0].type).toBe("pipeline");
  });

  it("handles empty array", () => {
    expect(groupToolExecutionsChronologically([])).toHaveLength(0);
  });

  it("renders short fiction and cover tools as visible pipeline cards", () => {
    const execs: ToolExecution[] = [
      makeExec({ id: "1", tool: "read", label: "mock_val" }),
      makeExec({ id: "2", tool: "generate_cover", label: "mock_val" }),
      makeExec({ id: "3", tool: "short_fiction_run", label: "mock_val" }),
      makeExec({ id: "4", tool: "grep", label: "mock_val" }),
    ];

    const groups = groupToolExecutionsChronologically(execs);

    expect(groups).toHaveLength(4);
    expect(groups.map((group) => group.type)).toEqual(["utilities", "pipeline", "pipeline", "utilities"]);
    expect(groups[1].type === "pipeline" ? groups[1].exec.tool : "").toBe("generate_cover");
    expect(groups[2].type === "pipeline" ? groups[2].exec.tool : "").toBe("short_fiction_run");
  });

  it("renders play tools as visible pipeline cards", () => {
    const execs: ToolExecution[] = [
      makeExec({ id: "1", tool: "read", label: "mock_val" }),
      makeExec({ id: "2", tool: "play_start", label: "mock_val" }),
      makeExec({ id: "3", tool: "play_edit", label: "mock_val" }),
      makeExec({ id: "4", tool: "play_revise", label: "mock_val" }),
      makeExec({ id: "5", tool: "play_step", label: "mock_val" }),
      makeExec({ id: "6", tool: "grep", label: "mock_val" }),
    ];

    const groups = groupToolExecutionsChronologically(execs);

    expect(groups).toHaveLength(6);
    expect(groups.map((group) => group.type)).toEqual(["utilities", "pipeline", "pipeline", "pipeline", "pipeline", "utilities"]);
    expect(groups[1].type === "pipeline" ? groups[1].exec.tool : "").toBe("play_start");
    expect(groups[2].type === "pipeline" ? groups[2].exec.tool : "").toBe("play_edit");
    expect(groups[3].type === "pipeline" ? groups[3].exec.tool : "").toBe("play_revise");
    expect(groups[4].type === "pipeline" ? groups[4].exec.tool : "").toBe("play_step");
  });

  it("renders proposed actions as visible pipeline cards", () => {
    const execs: ToolExecution[] = [
      makeExec({ id: "1", tool: "read", label: "mock_val" }),
      makeExec({ id: "2", tool: "propose_action", label: "mock_val" }),
      makeExec({ id: "3", tool: "grep", label: "mock_val" }),
    ];

    const groups = groupToolExecutionsChronologically(execs);

    expect(groups).toHaveLength(3);
    expect(groups.map((group) => group.type)).toEqual(["utilities", "pipeline", "utilities"]);
    expect(groups[1].type === "pipeline" ? groups[1].exec.tool : "").toBe("propose_action");
  });

  it("renders context compression as a visible pipeline card", () => {
    const execs: ToolExecution[] = [
      makeExec({ id: "1", tool: "read", label: "mock_val" }),
      makeExec({ id: "2", tool: "context_compression", label: "mock_val" }),
      makeExec({ id: "3", tool: "grep", label: "mock_val" }),
    ];

    const groups = groupToolExecutionsChronologically(execs);

    expect(groups).toHaveLength(3);
    expect(groups.map((group) => group.type)).toEqual(["utilities", "pipeline", "utilities"]);
    expect(groups[1].type === "pipeline" ? groups[1].exec.tool : "").toBe("context_compression");
  });

  it("renders narrative forecast operations as visible pipeline cards", () => {
    const execs: ToolExecution[] = [
      makeExec({ id: "1", tool: "read", label: "mock_val" }),
      makeExec({ id: "2", tool: "create_narrative_forecast", label: "mock_val" }),
      makeExec({ id: "3", tool: "get_narrative_forecast", label: "mock_val" }),
      makeExec({ id: "4", tool: "select_narrative_branch", label: "mock_val" }),
      makeExec({ id: "5", tool: "grep", label: "mock_val" }),
    ];

    const groups = groupToolExecutionsChronologically(execs);

    expect(groups.map((group) => group.type)).toEqual([
      "utilities",
      "pipeline",
      "pipeline",
      "pipeline",
      "utilities",
    ]);
    expect(groups[1].type === "pipeline" ? groups[1].exec.tool : "").toBe("create_narrative_forecast");
    expect(groups[2].type === "pipeline" ? groups[2].exec.tool : "").toBe("get_narrative_forecast");
    expect(groups[3].type === "pipeline" ? groups[3].exec.tool : "").toBe("select_narrative_branch");
  });

  it("renders generic pipeline result text in an expandable details block", () => {
    const exec = makeExec({
      id: "writer-1",
      tool: "sub_agent",
      agent: "writer",
      label: "mock_val",
      result: "mock_valChương 1：mock_val。mock_val。",
    });

    const html = renderToStaticMarkup(React.createElement(ToolExecutionSteps, { executions: [exec] }));

    expect(html).toContain("Xem kết quả thao tác");
    expect(html).toContain("mock_valChương 1：mock_val");
  });

  it("renders applied revision audit status and concrete remaining issues", () => {
    const exec = makeExec({
      id: "revision-1",
      tool: "sub_agent",
      agent: "reviser",
      label: "mock_val",
      result: "Revision complete.",
      details: {
        kind: "chapter_revision",
        chapterNumber: 1,
        applied: true,
        status: "audit-failed",
        auditPassed: false,
        fixedIssues: ["mock_val"],
        auditIssues: [{
          severity: "warning",
          category: "continuity",
          description: "mock_val。",
          suggestion: "mock_val。",
        }],
      },
    });

    expect(getChapterRevisionDetails(exec)).toEqual(expect.objectContaining({
      chapterNumber: 1,
      applied: true,
      auditPassed: false,
    }));
    const html = renderToStaticMarkup(React.createElement(ToolExecutionSteps, { executions: [exec] }));
    expect(html).toContain("Chỉnh sửa chương 1");
    expect(html).toContain("Vẫn cần soát lại");
    expect(html).toContain("mock_val");
    expect(html).not.toContain("Xem kết quả thao tác");
  });

  it("renders chapter state resync audit status and concrete issues", () => {
    const exec = makeExec({
      id: "resync-1",
      tool: "resync_chapter_state",
      label: "mock_val",
      result: "State resynced.",
      details: {
        kind: "chapter_state_resynced",
        chapterNumber: 1,
        status: "audit-failed",
        auditPassed: false,
        summary: "mock_val，mock_val。",
        auditIssues: [{
          severity: "warning",
          category: "continuity",
          description: "mock_val H012 mock_val。",
          suggestion: "mock_val。",
        }],
      },
    });

    expect(getChapterStateResyncDetails(exec)).toEqual(expect.objectContaining({
      chapterNumber: 1,
      auditPassed: false,
    }));
    const html = renderToStaticMarkup(React.createElement(ToolExecutionSteps, { executions: [exec] }));
    expect(html).toContain("Đã đồng bộ trạng thái chương 1");
    expect(html).toContain("Vẫn cần chỉnh sửa");
    expect(html).toContain("mock_val H012 mock_val");
    expect(html).not.toContain("Xem kết quả thao tác");
  });

  it("renders the writer retrieval trace from structured tool details", () => {
    const exec = makeExec({
      id: "writer-trace",
      tool: "sub_agent",
      agent: "writer",
      label: "mock_val",
      details: {
        kind: "chapter_written",
        chapterNumber: 8,
        skillIds: ["longform-pacing"],
        contextTrace: {
          tracePath: "runtime/chapter-0008.trace.json",
          selectedSources: ["story/author_intent.md", "story/pending_hooks.md#H7"],
          protectedSources: ["story/author_intent.md"],
          compressibleSources: ["story/pending_hooks.md#H7"],
          tokenBudget: { protectedTokens: 1200, compressibleTokens: 800, totalSelectedTokens: 2000 },
          retrieval: {
            engine: "sqlite-fts5-bm25",
            query: "mock_val mock_val",
            candidates: [{ id: "H7", kind: "hook", source: "story/pending_hooks.md#H7", score: 1.4 }],
            semanticSelectedIds: ["H7"],
          },
          compression: {
            compiledSource: "runtime/compiled-compressible-context",
            protectedSources: ["story/author_intent.md"],
            compressedSources: ["story/pending_hooks.md#H7"],
            protectedTokens: 1200,
            compressibleTokens: 800,
            budgetTokens: 1800,
          },
        },
      },
    });

    expect(getChapterContextTraceDetails(exec)).toHaveLength(1);
    const html = renderToStaticMarkup(React.createElement(ToolExecutionSteps, { executions: [exec] }));
    expect(html).toContain("Ngữ cảnh dùng trong lượt này");
    expect(html).toContain("longform-pacing");
    expect(html).toContain("sqlite-fts5-bm25");
    expect(html).toContain("story/author_intent.md");
    expect(html).toContain("runtime/chapter-0008.trace.json");
    expect(html).toContain("Nén ngữ nghĩa");
  });

  it("shows the actual professional Skill for non-chapter production tools", () => {
    const exec = makeExec({
      id: "play-skilled",
      tool: "play_step",
      label: "mock_val",
      details: {
        kind: "play_turn_advanced",
        sceneText: "mock_val。",
        skillIds: ["castor-play-world"],
      },
    });

    expect(getExecutionSkillIds(exec)).toEqual(["castor-play-world"]);
    const html = renderToStaticMarkup(React.createElement(ToolExecutionSteps, { executions: [exec] }));
    expect(html).toContain("Skill chuyên dụng");
    expect(html).toContain("castor-play-world");
  });

  it("extracts generated cover details from public short fiction tools", () => {
    const exec = makeExec({
      id: "short-1",
      tool: "short_fiction_run",
      label: "mock_val",
      details: {
        kind: "short_fiction_created",
        storyId: "demo-story",
        finalMarkdownPath: "shorts/demo-story/final/full.md",
        salesPackagePath: "shorts/demo-story/final/sales-package.md",
        coverImagePath: "shorts/demo-story/final/cover.png",
      },
    });

    expect(getGeneratedArtifactDetails(exec)).toMatchObject({
      kind: "short_fiction_created",
      storyId: "demo-story",
      finalMarkdownPath: "shorts/demo-story/final/full.md",
      salesPackagePath: "shorts/demo-story/final/sales-package.md",
      coverImagePath: "shorts/demo-story/final/cover.png",
    });
  });

  it("extracts and renders interactive-film creation artifacts", () => {
    const exec = makeExec({
      id: "interactive-film-1",
      tool: "interactive_film_create",
      label: "mock_val",
      details: {
        kind: "interactive_film_created",
        title: "mock_val",
        projectId: "shengshi-branching",
        storyGraphPath: "interactive-films/shengshi-branching/story-graph.json",
        specPath: "interactive-films/shengshi-branching/interactive-spec.md",
        storyTreePath: "interactive-films/shengshi-branching/story-tree.md",
        flagsPath: "interactive-films/shengshi-branching/flags.md",
        scriptPath: "interactive-films/shengshi-branching/script.md",
        storyboardPath: "interactive-films/shengshi-branching/storyboard.md",
        imagePromptsPath: "interactive-films/shengshi-branching/image-prompts.md",
        assetsManifestPath: "interactive-films/shengshi-branching/assets.json",
      },
    });

    expect(getGeneratedArtifactDetails(exec)).toMatchObject({
      kind: "interactive_film_created",
      projectId: "shengshi-branching",
      storyGraphPath: "interactive-films/shengshi-branching/story-graph.json",
      storyTreePath: "interactive-films/shengshi-branching/story-tree.md",
      flagsPath: "interactive-films/shengshi-branching/flags.md",
      assetsManifestPath: "interactive-films/shengshi-branching/assets.json",
    });

    const html = renderToStaticMarkup(React.createElement(ToolExecutionSteps, { executions: [exec] }));
    expect(html).toContain("Đã tạo phim tương tác");
    expect(html).toContain("Đồ thị truyện");
    expect(html).toContain("Cây truyện");
    expect(html).toContain("Cờ biến");
    expect(html).toContain("Tài nguyên hình ảnh");
  });

  it("extracts play scene details from play tools", () => {
    const exec = makeExec({
      id: "play-1",
      tool: "play_step",
      label: "mock_val",
      details: {
        kind: "play_turn_advanced",
        title: "mock_val",
        worldId: "rain-teahouse",
        runId: "main",
        sceneText: "mock_val，mock_val。",
        suggestedActions: ["mock_val", "mock_val"],
        currentState: { turn: 3 },
      },
    });

    expect(getPlayToolDetails(exec)).toMatchObject({
      kind: "play_turn_advanced",
      title: "mock_val",
      worldId: "rain-teahouse",
      runId: "main",
      turn: 3,
      sceneText: "mock_val，mock_val。",
      suggestedActions: ["mock_val", "mock_val"],
    });
  });

  it("extracts revised play scene details", () => {
    const exec = makeExec({
      id: "play-revise-1",
      tool: "play_revise",
      label: "mock_val",
      details: {
        kind: "play_turn_revised",
        title: "mock_val",
        worldId: "rain-teahouse",
        runId: "main",
        sceneText: "mock_val，mock_val。",
        suggestedActions: ["mock_val", "mock_val"],
        variantId: "v-new",
      },
    });

    expect(getPlayToolDetails(exec)).toMatchObject({
      kind: "play_turn_revised",
      title: "mock_val",
      worldId: "rain-teahouse",
      runId: "main",
      sceneText: "mock_val，mock_val。",
      suggestedActions: ["mock_val", "mock_val"],
      variantId: "v-new",
    });
  });

  it("does not render suggested play actions as non-clickable text in the result card", () => {
    const html = renderToStaticMarkup(React.createElement(ToolExecutionSteps, {
      executions: [
        makeExec({
          id: "play-choices-1",
          tool: "play_step",
          label: "mock_val",
          details: {
            kind: "play_turn_advanced",
            worldId: "rain-teahouse",
            runId: "main",
            sceneText: "mock_val，mock_val。",
            suggestedActions: ["mock_val", "mock_val"],
            currentState: { turn: 3 },
          },
        }),
      ],
    }));

    expect(html).toContain("mock_val");
    expect(html).not.toContain("mock_val");
    expect(html).not.toContain("mock_val");
  });

  it("does not guess a scene image file path before the run manifest reports it ready", () => {
    const details = {
      kind: "play_turn_advanced" as const,
      worldId: "rain-teahouse",
      runId: "main",
      turn: 3,
      sceneText: "mock_val。",
    };

    expect(buildPlaySceneImageUrl(details)).toBeNull();
    expect(buildPlayRunStatusUrl(details)).toBe("/api/v1/play/runs/rain-teahouse/main");
  });

  it("extracts play edit details", () => {
    const exec = makeExec({
      id: "play-edit-1",
      tool: "play_edit",
      label: "mock_val",
      details: {
        kind: "play_world_updated",
        worldId: "rain-flat",
        runId: "main",
        updatedWorldContract: true,
        updatedVisualContract: true,
        updatedPremise: false,
        updatedEntities: 2,
      },
    });

    expect(getPlayEditDetails(exec)).toMatchObject({
      kind: "play_world_updated",
      worldId: "rain-flat",
      runId: "main",
      updatedWorldContract: true,
      updatedVisualContract: true,
      updatedPremise: false,
      updatedEntities: 2,
    });
  });

  it("extracts proposed action details", () => {
    const exec = makeExec({
      id: "proposal-1",
      tool: "propose_action",
      label: "mock_val",
      details: {
        kind: "proposed_action",
        action: "short_run",
        targetSessionKind: "short",
        sameSession: true,
        title: "mock_val",
        summary: "mock_val。",
        instruction: "mock_val",
        requestedSkills: ["writer-distillation"],
        actionPayload: {
          shortRun: {
            direction: "mock_val",
            chapters: 12,
            charsPerChapter: 1000,
            cover: true,
          },
        },
      },
    });

    expect(getProposedActionDetails(exec)).toMatchObject({
      kind: "proposed_action",
      execId: "proposal-1",
      action: "short_run",
      targetSessionKind: "short",
      sameSession: true,
      title: "mock_val",
      instruction: "mock_val",
      requestedSkills: ["writer-distillation"],
      actionPayload: {
        shortRun: {
          direction: "mock_val",
          chapters: 12,
          charsPerChapter: 1000,
          cover: true,
        },
      },
    });
  });

  it("extracts Play world and visual contracts for confirmation cards", () => {
    const exec = makeExec({
      id: "proposal-play-contract",
      tool: "propose_action",
      label: "mock_val",
      details: {
        kind: "proposed_action",
        action: "play_start",
        targetSessionKind: "play",
        title: "mock_val",
        instruction: "mock_val。",
        actionPayload: {
          playStart: {
            title: "mock_val",
            worldContract: "mock_val；mock_val；mock_val tick mock_val RPG mock_val。",
            visualContract: "mock_val、mock_val，mock_val。",
          },
        },
      },
    });

    const details = getProposedActionDetails(exec);
    expect(details).not.toBeNull();
    expect(getProposedActionContractRows(details!)).toEqual([
      {
        label: "Khế ước thế giới",
        value: expect.stringContaining("mock_val"),
      },
      {
        label: "Khế ước thị giác",
        value: expect.stringContaining("mock_val"),
      },
    ]);
  });

});

describe("tool details default-open preference", () => {
  beforeEach(() => {
    usePreferencesStore.setState({ toolDetailsDefaultOpen: true });
  });

  it("the preferences store defaults to expanded, keeping today's behavior", () => {
    expect(usePreferencesStore.getState().toolDetailsDefaultOpen).toBe(true);
  });

  it("renders the pipeline result details expanded when the preference is on (default)", () => {
    const exec = makeExec({
      id: "writer-1",
      tool: "sub_agent",
      agent: "writer",
      label: "mock_val",
      result: "mock_valChương 1：mock_val。mock_val。",
    });

    const html = renderToStaticMarkup(React.createElement(ToolExecutionSteps, { executions: [exec] }));

    expect(html).toContain("Xem kết quả thao tác");
    expect(html).toContain("<details open");
  });

  it("renders the pipeline result details collapsed when the preference is off", () => {
    const html = renderToStaticMarkup(React.createElement(PipelineResultDetails, {
      result: "mock_valChương 1：mock_val。mock_val。",
      defaultOpen: false,
    }));

    // The block is still there (manually expandable), just not open by default.
    expect(html).toContain("Xem kết quả thao tác");
    expect(html).toContain("mock_valChương 1：mock_val");
    expect(html).not.toContain("<details open");
  });

  it("renders the pipeline result details expanded when defaultOpen is true", () => {
    const html = renderToStaticMarkup(React.createElement(PipelineResultDetails, {
      result: "mock_valChương 1：mock_val。",
      defaultOpen: true,
    }));

    expect(html).toContain("<details open");
  });
});

describe("English app language", () => {
  beforeEach(() => {
    setAppLanguage("en");
  });

  afterEach(() => {
    setAppLanguage("vi");
  });

  it("renders pipeline status, result summary, and file-operation group in English", () => {
    const execs: ToolExecution[] = [
      makeExec({
        id: "writer-en-1",
        tool: "sub_agent",
        agent: "writer",
        label: "Write",
        result: "Chapter 1 finished.",
      }),
      makeExec({ id: "read-en-1", tool: "read", label: "Read file", args: { path: "books/demo/chapter-1.md" } }),
    ];

    const html = renderToStaticMarkup(React.createElement(ToolExecutionSteps, { executions: execs }));

    expect(html).toContain("Completed");
    expect(html).toContain("View result");
    expect(html).toContain("1 file operation");
    expect(html).not.toContain("mock_val");
    expect(html).not.toContain("Xem kết quả thao tác");
  });

  it("renders interactive-film artifacts and proposal contract rows in English", () => {
    const filmExec = makeExec({
      id: "interactive-film-en-1",
      tool: "interactive_film_create",
      label: "Interactive film",
      details: {
        kind: "interactive_film_created",
        projectId: "demo-branching",
        storyGraphPath: "interactive-films/demo-branching/story-graph.json",
        storyTreePath: "interactive-films/demo-branching/story-tree.md",
      },
    });

    const html = renderToStaticMarkup(React.createElement(ToolExecutionSteps, { executions: [filmExec] }));
    expect(html).toContain("Interactive film generated");
    expect(html).toContain("Story graph");
    expect(html).toContain("Story tree");
    expect(html).not.toContain("Đã tạo phim tương tác");

    const proposalExec = makeExec({
      id: "proposal-en-1",
      tool: "propose_action",
      label: "Confirm action",
      details: {
        kind: "proposed_action",
        action: "play_start",
        targetSessionKind: "play",
        instruction: "Start a cultivation open world.",
        actionPayload: {
          playStart: {
            title: "Outer Gate",
            worldContract: "Time is the shared world axis.",
            visualContract: "No colored rarity borders.",
          },
        },
      },
    });

    const details = getProposedActionDetails(proposalExec);
    expect(details).not.toBeNull();
    expect(getProposedActionContractRows(details!).map((row) => row.label)).toEqual([
      "World contract",
      "Visual contract",
    ]);
  });

  it("does not repeat raw results when a structured Play preview is available", () => {
    const exec = makeExec({
      id: "play-start-structured",
      tool: "play_start",
      label: "mock_val",
      status: "completed",
      result: "mock_valMo daumock_val",
      details: {
        kind: "play_world_started",
        worldId: "rain-world",
        runId: "run-1",
        sceneText: "mock_valMo daumock_val",
      },
    });

    const html = renderToStaticMarkup(React.createElement(ToolExecutionSteps, { executions: [exec] }));
    expect(html).toContain("Interactive world started");
    expect(html).not.toContain("View result");
  });
});

describe("UtilityExecutionRow", () => {
  it("renders an expandable, default-collapsed result body when the execution has a result", () => {
    const exec = makeExec({
      id: "read-1",
      tool: "read",
      label: "mock_val",
      args: { path: "books/demo/chapter-1.md" },
      result: "mock_val：mock_val，mock_val。",
    });

    const html = renderToStaticMarkup(React.createElement(UtilityExecutionRow, { exec }));

    expect(html).toContain("read books/demo/chapter-1.md");
    expect(html).toContain("mock_val：mock_val，mock_val。");
    expect(html).toContain("<details");
    expect(html).not.toContain("<details open");
  });

  it("renders a plain row without details when the execution has no result", () => {
    const exec = makeExec({
      id: "ls-1",
      tool: "ls",
      label: "mock_val",
      args: { path: "books/demo" },
    });

    const html = renderToStaticMarkup(React.createElement(UtilityExecutionRow, { exec }));

    expect(html).toContain("ls books/demo");
    expect(html).not.toContain("<details");
  });

  it("treats a whitespace-only result as no result", () => {
    const exec = makeExec({
      id: "grep-1",
      tool: "grep",
      label: "mock_val",
      args: { pattern: "mock_val" },
      result: "   \n  ",
    });

    const html = renderToStaticMarkup(React.createElement(UtilityExecutionRow, { exec }));

    expect(html).toContain("grep mock_val");
    expect(html).not.toContain("<details");
  });
});
