import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPlayStartTool,
  createPlayReviseTool,
  createPlayStepTool,
  type PlayStartToolOptions,
} from "../agent/agent-tools.js";
import { PlayStore } from "../play/play-store.js";
import type { PlayReplayResult, PlayStepResult } from "../play/play-runner.js";
import type { PlayGraphDB } from "../play/play-db-factory.js";

const STEP_RESULT: PlayStepResult = {
  sceneText: "mock_text，mock_text。",
  suggestedActions: ["mock_text", "mock_text"],
  action: {
    actionKind: "look",
    intent: "mock_text",
    manner: "",
    risk: "",
    ambiguity: "",
    secondaryActions: [],
  },
  mutation: {
    eventId: "evt-1",
    turn: 1,
    actionKind: "look",
    summary: "mock_text。",
    entities: { upsert: [] },
    edges: { upsert: [], expire: [] },
    stateSlots: { upsert: [] },
    evidence: { transitions: [] },
    blocked: false,
    blockedReason: "",
    notes: [],
  },
};

const REPLAY_RESULT: PlayReplayResult = {
  ...STEP_RESULT,
  sceneText: "mock_text，mock_text。",
  suggestedActions: ["mock_text", "mock_text"],
  replayedInput: "mock_textKiem tra so sachmock_text",
  previousVariantId: "v-old",
  variantId: "v-new",
};

function pipelineStub() {
  return {
    createAgentContext: vi.fn(() => ({})),
    runWithAgentContext: vi.fn(async (_context: unknown, task: () => Promise<unknown>) => task()),
  } as any;
}

function seedReadyGraph(db: PlayGraphDB): void {
  db.upsertEntity({ id: "actor_player", type: "actor", label: "mock_text", summary: "mock_text。" });
  db.upsertEntity({ id: "location_opening", type: "location", label: "Mo daumock_text", summary: "Chương mock_text。" });
}

function readyRunnerFactory() {
  return ({ db }: { readonly db: PlayGraphDB }) => ({
    seedOpening: vi.fn(async () => {
      seedReadyGraph(db);
      return {
        mutation: {
          eventId: "evt-0",
          turn: 0,
          actionKind: "look" as const,
          summary: "mock_textMo daumock_text。",
          entities: { upsert: [] },
          edges: { upsert: [], expire: [] },
          stateSlots: { upsert: [] },
          evidence: { transitions: [] },
          blocked: false,
          blockedReason: "",
          notes: [],
        },
      };
    }),
  });
}

function createReadyPlayStartTool(
  root: string,
  sessionId: string,
  playMode?: "open" | "guided",
  options: PlayStartToolOptions = {},
) {
  return createPlayStartTool(pipelineStub(), root, sessionId, playMode, {
    ...options,
    runnerFactory: options.runnerFactory ?? readyRunnerFactory(),
  });
}

describe("agent play tools", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "castor-agent-play-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("binds the new play world to the chat session and persists the opening scene", async () => {
    const sessionId = "1700000000000-aaaa01";
    const tool = createReadyPlayStartTool(root, sessionId);
    const result = await tool.execute("tc-start", {
      title: "mock_text",
      premise: "mock_text，mock_text。",
      mode: "open",
      initialScene: "mock_text，mock_text。",
      suggestedActions: ["mock_text", "mock_text"],
    });

    // worldId is the sessionId — the world is bound 1:1 to this chat session.
    expect(result.details).toMatchObject({
      kind: "play_world_started",
      worldId: sessionId,
      runId: "main",
      title: "mock_text",
      sceneText: "mock_text，mock_text。",
      suggestedActions: ["mock_text", "mock_text"],
    });
    const resultText = result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(resultText).toBe("mock_text，mock_text。");
    expect(resultText).not.toContain("Interactive world");
    expect(resultText).not.toContain("Suggested actions");
    expect(resultText).not.toContain("mock_text");

    const store = new PlayStore(root);
    await expect(store.loadWorld(sessionId)).resolves.toMatchObject({
      title: "mock_text",
      mode: "open",
    });
    await expect(store.readTranscript(sessionId, "main")).resolves.toMatchObject([
      { role: "assistant", content: "mock_text，mock_text。" },
    ]);
    await expect(store.readProjection(sessionId, "main", "projections/scene.md"))
      .resolves.toContain("mock_text");
  });

  it("persists confirmed natural-language contracts from play_start", async () => {
    const sessionId = "1700000000000-contract";
    const tool = createReadyPlayStartTool(root, sessionId);
    const result = await tool.execute("tc-start-contract", {
      title: "mock_text",
      premise: "mock_text，mock_text。",
      mode: "open",
      worldContract: "mock_text/mock_text/mock_text，mock_text、mock_text。mock_text。",
      visualContract: "mock_text、mock_text、mock_text，mock_text。",
      initialScene: "mock_text，mock_text。",
      suggestedActions: ["mock_text", "mock_text"],
    } as any);

    expect(result.details).toMatchObject({
      kind: "play_world_started",
      worldContract: expect.stringContaining("mock_text"),
      visualContract: expect.stringContaining("mock_text"),
    });

    const store = new PlayStore(root);
    await expect(store.loadWorld(sessionId)).resolves.toMatchObject({
      worldContract: expect.stringContaining("mock_text"),
      visualContract: expect.stringContaining("mock_text、mock_text"),
    });
  });

  it("uses confirmed action-payload contracts over model tool params", async () => {
    const sessionId = "1700000000000-contract-payload";
    const tool = createReadyPlayStartTool(root, sessionId, undefined, {
      actionPayload: {
        playStart: {
          title: "mock_text",
          premise: "mock_text。",
          worldContract: "mock_text：NPC mock_text、mock_text。",
          visualContract: "mock_text：mock_text。",
          initialScene: "mock_textMo dau。",
        },
      } as any,
    });

    await tool.execute("tc-start-contract-payload", {
      title: "mock_text",
      premise: "mock_text。",
      worldContract: "mock_text。",
      visualContract: "mock_text。",
      initialScene: "mock_textMo dau。",
    } as any);

    const store = new PlayStore(root);
    await expect(store.loadWorld(sessionId)).resolves.toMatchObject({
      title: "mock_text",
      premise: "mock_text。",
      worldContract: expect.stringContaining("NPC mock_text"),
      visualContract: expect.stringContaining("mock_text"),
    });
  });

  it("normalizes object-shaped suggested actions at the tool boundary", async () => {
    const sessionId = "1700000000000-sug001";
    const tool = createReadyPlayStartTool(root, sessionId);
    const result = await tool.execute("tc-start-suggestions", {
      title: "mock_text",
      premise: "mock_text。",
      initialScene: "mock_text，mock_text。",
      suggestedActions: [
        { label: "mock_text", description: "mock_text" },
        { action: "mock_text" },
      ],
    });

    expect(result.details).toMatchObject({
      kind: "play_world_started",
      suggestedActions: ["mock_text", "mock_text"],
    });
  });

  it("seeds the opening graph through the play runner when a pipeline is available", async () => {
    const sessionId = "1700000000000-seed01";
    const seedOpening = vi.fn(async () => ({
      mutation: {
        eventId: "evt-0",
        turn: 0,
        actionKind: "look" as const,
        summary: "mock_textMo daumock_text。",
        entities: { upsert: [] },
        edges: { upsert: [], expire: [] },
        stateSlots: { upsert: [] },
        evidence: { transitions: [] },
        blocked: false,
        blockedReason: "",
        notes: [],
      },
    }));
    const runnerFactory = vi.fn(({ db }: { readonly db: PlayGraphDB }) => ({
      seedOpening: async (...args: Parameters<typeof seedOpening>) => {
        seedReadyGraph(db);
        return seedOpening(...args);
      },
    }));
    const tool = createPlayStartTool(pipelineStub(), root, sessionId, undefined, { runnerFactory });

    const result = await tool.execute("tc-start-seed", {
      title: "mock_text",
      premise: "mock_text。",
      initialScene: "mock_text。",
      suggestedActions: ["mock_text"],
    });

    expect(runnerFactory).toHaveBeenCalledWith(expect.objectContaining({
      worldId: sessionId,
      runId: "main",
    }));
    expect(seedOpening).toHaveBeenCalledWith({
      sceneText: "mock_text。",
      suggestedActions: ["mock_text"],
    });
    expect(result.details).toMatchObject({
      kind: "play_world_started",
      seedMutation: expect.objectContaining({ turn: 0 }),
    });
  });

  it("refuses to create a play world without the Pi worker pipeline", async () => {
    const sessionId = "1700000000000-no-pipeline";
    const tool = createPlayStartTool(null, root, sessionId);

    await expect(tool.execute("tc-start-no-pipeline", {
      title: "mock_text",
      premise: "mock_text。",
      initialScene: "mock_text từmock_text。",
    })).rejects.toThrow("pipeline");
    await expect(new PlayStore(root).loadWorld(sessionId)).resolves.toBeNull();
  });

  it("removes a new world when opening seeding does not produce a usable graph", async () => {
    const sessionId = "1700000000000-empty-graph";
    const tool = createPlayStartTool(pipelineStub(), root, sessionId, undefined, {
      runnerFactory: () => ({
        seedOpening: vi.fn(async () => ({
          mutation: {
            eventId: "evt-0",
            turn: 0,
            actionKind: "look" as const,
            summary: "mock_text。",
            entities: { upsert: [] },
            edges: { upsert: [], expire: [] },
            stateSlots: { upsert: [] },
            evidence: { transitions: [] },
            blocked: false,
            blockedReason: "",
            notes: [],
          },
        })),
      }),
    });

    await expect(tool.execute("tc-start-empty-graph", {
      title: "mock_text",
      premise: "mock_text。",
      initialScene: "mock_text。",
    })).rejects.toThrow("mock_text");
    await expect(new PlayStore(root).loadWorld(sessionId)).resolves.toBeNull();
  });

  it("runs opening seeding inside the abort scope and does not swallow user cancellation", async () => {
    const sessionId = "1700000000000-abort1";
    const controller = new AbortController();
    const runWithAgentContext = vi.fn(async (
      context: { readonly signal?: AbortSignal },
      task: () => Promise<unknown>,
    ) => {
      context.signal?.throwIfAborted();
      return task();
    });
    const pipeline = {
      createAgentContext: vi.fn(() => ({})),
      runWithAgentContext,
    };
    const seedOpening = vi.fn(async (_input: { sceneText: string; suggestedActions?: readonly string[] }) => null);
    const tool = createPlayStartTool(pipeline as never, root, sessionId, undefined, {
      runnerFactory: ({ db }) => ({
        seedOpening: async (...args) => {
          seedReadyGraph(db);
          return seedOpening(...args);
        },
      }),
    });

    await tool.execute("tc-start-abort-scope", {
      title: "mock_text",
      premise: "mock_text。",
      initialScene: "mock_text。",
    }, controller.signal);

    expect(runWithAgentContext).toHaveBeenCalledWith(
      { signal: controller.signal, activatedSkills: [] },
      expect.any(Function),
    );

    const cancelledSessionId = "1700000000000-abort2";
    const cancelled = new AbortController();
    cancelled.abort();
    const cancelledTool = createPlayStartTool(pipeline as never, root, cancelledSessionId);
    await expect(cancelledTool.execute("tc-start-aborted", {
      title: "mock_text",
      premise: "mock_text。",
    }, cancelled.signal)).rejects.toThrow();
    await expect(new PlayStore(root).loadWorld(cancelledSessionId)).resolves.toBeNull();
  });

  it("advances the play world bound to the session", async () => {
    const sessionId = "1700000000000-bbbb02";
    const store = new PlayStore(root);
    await store.createWorld({
      id: sessionId,
      title: "mock_text",
      premise: "mock_text。",
      mode: "open",
    });
    await store.ensureRun(sessionId, "main");
    await store.writeProjection(sessionId, "main", "projections/scene.md", "mock_text。\n");

    const runnerFactory = vi.fn(() => ({ step: vi.fn(async () => STEP_RESULT) }));
    const tool = createPlayStepTool(pipelineStub(), root, sessionId, { runnerFactory });

    const result = await tool.execute("tc-step", {
      input: "mock_text",
    });

    expect(runnerFactory).toHaveBeenCalledWith(expect.objectContaining({
      worldId: sessionId,
      runId: "main",
    }));
    expect(result.details).toMatchObject({
      kind: "play_turn_advanced",
      worldId: sessionId,
      runId: "main",
      sceneText: "mock_text，mock_text。",
    });
  });

  it("runs Play inside its own professional Skill context", async () => {
    const sessionId = "1700000000000-skilled";
    const store = new PlayStore(root);
    await store.createWorld({
      id: sessionId,
      title: "mock_text",
      premise: "mock_text。",
      mode: "open",
    });
    await store.ensureRun(sessionId, "main");
    const pipeline = pipelineStub();
    const playSkill = {
      skill: {
        id: "castor-play-world",
        name: "Interactive world play",
        description: "Play method.",
        body: "Advance one adjacent dramatic beat.",
        source: "builtin" as const,
      },
      resources: [],
    };
    const tool = createPlayStepTool(pipeline, root, sessionId, {
      defaultSkills: [playSkill],
      runnerFactory: () => ({ step: vi.fn(async () => STEP_RESULT) }),
    });

    const result = await tool.execute("tc-step-skilled", { input: "mock_text" });

    expect(pipeline.runWithAgentContext).toHaveBeenCalledWith(
      { signal: undefined, activatedSkills: [playSkill] },
      expect.any(Function),
    );
    expect(result.details).toMatchObject({
      kind: "play_turn_advanced",
      skillIds: ["castor-play-world"],
    });
  });

  it("revises the latest play turn through the session-bound world", async () => {
    const sessionId = "1700000000000-revise1";
    const store = new PlayStore(root);
    await store.createWorld({
      id: sessionId,
      title: "mock_text",
      premise: "mock_text。",
      mode: "open",
    });
    await store.ensureRun(sessionId, "main");

    const regenerateLastTurn = vi.fn(async () => REPLAY_RESULT);
    const restoreVariant = vi.fn();
    const runnerFactory = vi.fn(() => ({ regenerateLastTurn, restoreVariant }));
    const tool = createPlayReviseTool(pipelineStub(), root, sessionId, { runnerFactory });

    const result = await tool.execute("tc-revise", {
      action: "edit_last_input",
      input: "mock_textKiem tra so sachmock_text",
    });

    expect(runnerFactory).toHaveBeenCalledWith(expect.objectContaining({
      worldId: sessionId,
      runId: "main",
    }));
    expect(regenerateLastTurn).toHaveBeenCalledWith("mock_textKiem tra so sachmock_text");
    expect(result.details).toMatchObject({
      kind: "play_turn_revised",
      worldId: sessionId,
      runId: "main",
      sceneText: "mock_text，mock_text。",
      replayedInput: "mock_textKiem tra so sachmock_text",
      previousVariantId: "v-old",
      variantId: "v-new",
    });
  });

  it("restores a saved play turn variant through the revise tool", async () => {
    const sessionId = "1700000000000-revise2";
    const store = new PlayStore(root);
    await store.createWorld({
      id: sessionId,
      title: "mock_text",
      premise: "mock_text。",
      mode: "open",
    });
    await store.ensureRun(sessionId, "main");

    const regenerateLastTurn = vi.fn();
    const restoreVariant = vi.fn(async () => ({
      turn: 1,
      variantId: "v-old",
      sceneText: "mock_text：mock_text。",
    }));
    const tool = createPlayReviseTool(pipelineStub(), root, sessionId, {
      runnerFactory: vi.fn(() => ({ regenerateLastTurn, restoreVariant })),
    });

    const result = await tool.execute("tc-restore", {
      action: "restore_variant",
      turn: 1,
      variantId: "v-old",
    });

    expect(restoreVariant).toHaveBeenCalledWith({ turn: 1, variantId: "v-old" });
    expect(result.details).toMatchObject({
      kind: "play_variant_restored",
      turn: 1,
      variantId: "v-old",
      sceneText: "mock_text：mock_text。",
    });
  });

  it("uses the player-chosen playMode for the world, overriding the tool param", async () => {
    const sessionId = "1700000000000-cccc03";
    const tool = createReadyPlayStartTool(root, sessionId, "guided");
    await tool.execute("tc-mode", { title: "mock_text", initialScene: "Mo dau。" });
    const store = new PlayStore(root);
    await expect(store.loadWorld(sessionId)).resolves.toMatchObject({ mode: "guided" });
  });

  it("advances each session's own world, not the most recently created one", async () => {
    // Regression: play_step used to pick the globally newest world, so two
    // concurrent play sessions would advance each other's world. The world is
    // now bound to the session id, so session A always advances A's world even
    // when session B's world was created later.
    const sessionA = "1700000000000-aaaaaa";
    const sessionB = "1700000000001-bbbbbb";

    await createReadyPlayStartTool(root, sessionA).execute("tc-a", {
      title: "mock_textA",
      initialScene: "A mock_textMo dau。",
    });
    // World B is created AFTER A, so it is the most-recently-updated world.
    await createReadyPlayStartTool(root, sessionB).execute("tc-b", {
      title: "mock_textB",
      initialScene: "B mock_textMo dau。",
    });

    const runnerFactory = vi.fn(() => ({ step: vi.fn(async () => STEP_RESULT) }));
    const tool = createPlayStepTool(pipelineStub(), root, sessionA, { runnerFactory });
    const result = await tool.execute("tc-step-a", { input: "mock_text A mock_text" });

    expect(runnerFactory).toHaveBeenCalledWith(expect.objectContaining({
      worldId: sessionA,
    }));
    expect(result.details).toMatchObject({
      kind: "play_turn_advanced",
      worldId: sessionA,
    });
  });
});
