import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PlayActionIntentInput,
  PlayEdge,
  PlayEdgeInput,
  PlayEntity,
  PlayEntityInput,
  PlayEventInput,
  PlayMutationInput,
  PlayStateSlot,
  PlayStateSlotInput,
} from "../models/play.js";
import { PlayRunner } from "../play/play-runner.js";
import type { PlaySceneRender } from "../play/play-agents.js";
import { PlayStore, type PlayTranscriptTurn } from "../play/play-store.js";
import type { PlayGraphSnapshot } from "../play/play-file-db.js";

class FakePlayDB {
  entities = new Map<string, PlayEntity>();
  edges = new Map<string, PlayEdge>();
  stateSlots = new Map<string, PlayStateSlot>();
  events: PlayEventInput[] = [];

  transaction<T>(fn: () => T): T {
    return fn();
  }

  upsertEntity(entity: PlayEntityInput): void {
    this.entities.set(entity.id, { summary: "", status: "", ...entity });
  }

  getEntity(id: string): PlayEntity | null {
    return this.entities.get(id) ?? null;
  }

  upsertEdge(edge: PlayEdgeInput): void {
    this.edges.set(edge.id, {
      value: {},
      validUntilEventId: null,
      visibility: {},
      ...edge,
    });
  }

  expireEdge(edgeId: string, validUntilEventId: string): void {
    const edge = this.edges.get(edgeId);
    if (edge) this.edges.set(edgeId, { ...edge, validUntilEventId });
  }

  upsertStateSlot(slot: PlayStateSlotInput): void {
    this.stateSlots.set(slot.id, { ownerEntityId: null, ...slot });
  }

  getStateSlotsForEntity(entityId: string): PlayStateSlot[] {
    return [...this.stateSlots.values()].filter((slot) => slot.ownerEntityId === entityId);
  }

  recordEvent(event: PlayEventInput): void {
    this.events.push(event);
  }

  snapshot(): PlayGraphSnapshot {
    return {
      entities: [...this.entities.values()],
      edges: [...this.edges.values()],
      stateSlots: [...this.stateSlots.values()],
      events: this.events as PlayGraphSnapshot["events"],
    };
  }

  replaceWithSnapshot(snapshot: PlayGraphSnapshot): void {
    this.entities = new Map(snapshot.entities.map((entity) => [entity.id, entity]));
    this.edges = new Map(snapshot.edges.map((edge) => [edge.id, edge]));
    this.stateSlots = new Map(snapshot.stateSlots.map((slot) => [slot.id, slot]));
    this.events = [...snapshot.events];
  }
}

class FailingTranscriptStore extends PlayStore {
  private failed = false;

  override async appendTranscriptTurn(
    worldId: string,
    runId: string,
    turn: PlayTranscriptTurn,
  ): Promise<void> {
    if (!this.failed && turn.role === "assistant") {
      this.failed = true;
      throw new Error("simulated transcript persistence failure");
    }
    await super.appendTranscriptTurn(worldId, runId, turn);
  }
}

describe("PlayRunner", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "castor-play-runner-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("runs one player action end to end and persists event, transcript, and projections", async () => {
    const db = new FakePlayDB();
    const action: PlayActionIntentInput = {
      actionKind: "look",
      targetEntityLabel: "mock_text",
      intent: "mock_text",
    };
    const mutation: PlayMutationInput = {
      eventId: "evt-1",
      turn: 1,
      actionKind: "look",
      summary: "mock_text 187 mock_text。",
      timeAdvance: {
        elapsed: "mock_text",
        anchor: "mock_text",
        rationale: "mock_text。",
        synchronized: ["Xu Jinanmock_text，mock_text。"],
      },
      entities: {
        upsert: [
          { id: "player", type: "actor", label: "mock_text" },
          { id: "nav-stats", type: "evidence", label: "mock_text" },
        ],
      },
      edges: {
        upsert: [
          { fromId: "player", type: "mock_text", toId: "nav-stats", value: { role: "holding" } },
        ],
      },
      stateSlots: {
        upsert: [{
          id: "pressure:player:danger",
          ownerEntityId: "player",
          kind: "pressure",
          label: "mock_text",
          value: { current: 20, min: 0, max: 100 },
          updatedEventId: "evt-1",
        }],
      },
      evidence: {
        transitions: [{
          entityId: "nav-stats",
          to: "seen",
          reason: "mock_text。",
        }],
      },
    };
    const render: PlaySceneRender = {
      sceneText: "mock_text 187 mock_text，mock_text。",
      suggestedActions: ["mock_text", "mock_textXu Jinanmock_text"],
    };

    const renderSpy = vi.fn(async (_input: unknown) => render);
    const runner = new PlayRunner({
      projectRoot: root,
      worldId: "betrayal-car",
      runId: "run-1",
      db,
      agents: {
        actionInterpreter: { interpret: vi.fn(async () => action) },
        worldMutator: { proposeMutation: vi.fn(async () => mutation) },
        sceneRenderer: { render: renderSpy },
      },
    });

    const result = await runner.step("mock_text，mock_text");

    expect(result.sceneText).toContain("mock_text");
    expect(result.suggestedActions).toEqual(["mock_text", "mock_textXu Jinanmock_text"]);
    expect(db.events).toHaveLength(1);
    expect(db.entities.get("nav-stats")?.type).toBe("evidence");
    const renderInput = renderSpy.mock.calls[0]?.[0] as { stateBrief: string } | undefined;
    expect(renderInput?.stateBrief).toContain("player -[mock_text role=holding]-> nav-stats");
    expect(renderInput?.stateBrief).toContain("## Time");
    expect(renderInput?.stateBrief).toContain("elapsed: mock_text");
    expect(renderInput?.stateBrief).toContain("anchor: mock_text");
    expect(db.stateSlots.get("evidence:nav-stats:status")?.value).toMatchObject({ status: "seen" });

    const runDir = join(root, "worlds", "betrayal-car", "runs", "run-1");
    await expect(readFile(join(runDir, "events.jsonl"), "utf-8"))
      .resolves.toContain("\"id\":\"evt-1\"");
    await expect(readFile(join(runDir, "events.jsonl"), "utf-8"))
      .resolves.toContain("\"elapsed\":\"mock_text\"");
    await expect(readFile(join(runDir, "events.jsonl"), "utf-8"))
      .resolves.toContain("\"anchor\":\"mock_text\"");
    await expect(readFile(join(runDir, "transcript.jsonl"), "utf-8"))
      .resolves.toContain("mock_text");
    await expect(readFile(join(runDir, "projections", "state.md"), "utf-8"))
      .resolves.toContain("mock_text 187 mock_text");
    await expect(readFile(join(runDir, "state", "current.json"), "utf-8"))
      .resolves.toContain("\"elapsed\": \"mock_text\"");
    await expect(readFile(join(runDir, "state", "current.json"), "utf-8"))
      .resolves.toContain("\"anchor\": \"mock_text\"");
    await expect(readFile(join(runDir, "projections", "scene.md"), "utf-8"))
      .resolves.toContain("mock_text 187 mock_text");
    await expect(readFile(join(runDir, "status.json"), "utf-8"))
      .resolves.toContain('"status": "complete"');
  });

  it("rolls back graph and run files when a turn fails during persistence", async () => {
    const db = new FakePlayDB();
    const store = new FailingTranscriptStore(root);
    const runner = new PlayRunner({
      projectRoot: root,
      worldId: "rollback-world",
      runId: "main",
      store,
      db,
      agents: {
        actionInterpreter: { interpret: vi.fn(async () => ({ actionKind: "look", intent: "mock_text" })) },
        worldMutator: {
          proposeMutation: vi.fn(async () => ({
            eventId: "evt-1",
            turn: 1,
            actionKind: "look",
            summary: "mock_text。",
            entities: { upsert: [{ id: "ticket", type: "evidence", label: "mock_text" }] },
          })),
        },
        sceneRenderer: { render: vi.fn(async () => ({ sceneText: "mock_text。", suggestedActions: [] })) },
      },
    });

    await expect(runner.step("mock_text")).rejects.toThrow("simulated transcript persistence failure");
    expect(db.events).toHaveLength(0);
    expect(db.entities.has("ticket")).toBe(false);

    const runDir = join(root, "worlds", "rollback-world", "runs", "main");
    await expect(readFile(join(runDir, "events.jsonl"), "utf-8")).resolves.toBe("");
    await expect(readFile(join(runDir, "transcript.jsonl"), "utf-8")).resolves.toBe("");
    await expect(readFile(join(runDir, "status.json"), "utf-8"))
      .resolves.toContain('"status": "failed"');
  });

  it("does not commit state when scene rendering fails", async () => {
    const db = new FakePlayDB();
    const runner = new PlayRunner({
      projectRoot: root,
      worldId: "render-failure",
      runId: "main",
      db,
      agents: {
        actionInterpreter: {
          interpret: vi.fn(async () => ({ actionKind: "look" as const, intent: "mock_text" })),
        },
        worldMutator: {
          proposeMutation: vi.fn(async () => ({
            eventId: "evt-1",
            turn: 1,
            actionKind: "look" as const,
            summary: "mock_text。",
            entities: {
              upsert: [{ id: "evidence_seal", type: "evidence" as const, label: "mock_text" }],
            },
          })),
        },
        sceneRenderer: {
          render: vi.fn(async () => {
            throw new Error("Model did not submit_play_scene");
          }),
        },
      },
    });

    await expect(runner.step("mock_text")).rejects.toThrow("submit_play_scene");

    expect(db.events).toHaveLength(0);
    expect(db.entities.has("evidence_seal")).toBe(false);
    const runDir = join(root, "worlds", "render-failure", "runs", "main");
    await expect(readFile(join(runDir, "events.jsonl"), "utf-8")).rejects.toThrow();
    await expect(readFile(join(runDir, "projections", "scene.md"), "utf-8")).rejects.toThrow();
    await expect(readFile(join(runDir, "transcript.jsonl"), "utf-8")).rejects.toThrow();
  });

  it("seeds opening graph state without consuming the first player turn", async () => {
    const db = new FakePlayDB();
    const store = new PlayStore(root);
    await store.createWorld({
      id: "opening-seed",
      title: "mock_text",
      premise: "mock_text，mock_text。",
      language: "vi",
    });
    await store.ensureRun("opening-seed", "main");
    await store.writeProjection("opening-seed", "main", "projections/scene.md", "mock_text。\n");

    const seedMutation: PlayMutationInput = {
      eventId: "evt-0",
      turn: 0,
      actionKind: "look",
      summary: "mock_textMo daumock_text。",
      entities: {
        upsert: [
          { id: "actor_player", type: "actor", label: "mock_text", summary: "mock_text。", status: "mock_text", updatedEventId: "evt-0" },
          { id: "evidence_baby_photo", type: "evidence", label: "mock_text", summary: "mock_text。", status: "mock_text", updatedEventId: "evt-0" },
        ],
      },
      edges: {
        upsert: [
          { id: "edge_actor_player_mock_text_evidence_baby_photo", fromId: "actor_player", type: "mock_text", toId: "evidence_baby_photo", value: { role: "holding", physical: true }, validFromEventId: "evt-0", sourceEventId: "evt-0" },
        ],
      },
      stateSlots: {
        upsert: [
          { id: "slot_callback_timer", kind: "timer", label: "mock_text", value: 15, updatedEventId: "evt-0" },
        ],
      },
    };
    const runner = new PlayRunner({
      projectRoot: root,
      worldId: "opening-seed",
      runId: "main",
      store,
      db,
      agents: {
        actionInterpreter: { interpret: vi.fn(async () => ({ actionKind: "look", intent: "Mo daumock_text" })) },
        worldMutator: { proposeMutation: vi.fn(async () => seedMutation) },
        sceneRenderer: { render: vi.fn(async () => ({ sceneText: "mock_text", suggestedActions: [] })) },
      },
    });

    const result = await runner.seedOpening({
      sceneText: "mock_text。",
      suggestedActions: ["mock_text"],
    });

    expect(result?.mutation.turn).toBe(0);
    expect(db.entities.get("evidence_baby_photo")?.label).toBe("mock_text");
    expect([...db.edges.values()].some((edge) => edge.value?.role === "holding")).toBe(true);
    expect(db.stateSlots.get("slot_callback_timer")?.value).toBe(15);
    expect(db.events).toHaveLength(0);
    await expect(readFile(join(root, "worlds", "opening-seed", "runs", "main", "events.jsonl"), "utf-8"))
      .rejects
      .toThrow();
    await expect(readFile(join(root, "worlds", "opening-seed", "runs", "main", "projections", "state.md"), "utf-8"))
      .resolves
      .toContain("mock_text");
  });

  it("reconciles opening prose into the graph when the opening mutator returns no facts", async () => {
    const db = new FakePlayDB();
    const store = new PlayStore(root);
    await store.createWorld({
      id: "opening-reconcile",
      title: "mock_text",
      premise: "mock_text，mock_text。mock_text，mock_text。",
      language: "vi",
    });
    await store.ensureRun("opening-reconcile", "main");

    const reconcile = vi.fn(async () => ({
      eventId: "evt-0",
      turn: 0,
      actionKind: "look" as const,
      summary: "mock_textMo daumock_text、mock_text、mock_text。",
      entities: {
        upsert: [
          { id: "actor_player", type: "actor" as const, label: "mock_text", summary: "mock_text。", updatedEventId: "evt-0" },
          { id: "actor_mother", type: "actor" as const, label: "mock_text", summary: "mock_text。", updatedEventId: "evt-0" },
          { id: "actor_child", type: "actor" as const, label: "mock_text", summary: "mock_text。", updatedEventId: "evt-0" },
          { id: "actor_elder", type: "actor" as const, label: "mock_text", summary: "mock_text。", updatedEventId: "evt-0" },
        ],
      },
      edges: {
        upsert: [{
          id: "edge_actor_mother_mock_text_actor_child",
          fromId: "actor_mother",
          type: "mock_text",
          toId: "actor_child",
          value: { role: "relation" },
          validFromEventId: "evt-0",
          sourceEventId: "evt-0",
        }],
      },
    }));
    const runner = new PlayRunner({
      projectRoot: root,
      worldId: "opening-reconcile",
      runId: "main",
      store,
      db,
      agents: {
        actionInterpreter: { interpret: vi.fn(async () => ({ actionKind: "look", intent: "Mo daumock_text" })) },
        worldMutator: {
          proposeMutation: vi.fn(async () => ({ eventId: "evt-0", turn: 0, actionKind: "look" })),
        },
        sceneRenderer: { render: vi.fn(async () => ({ sceneText: "mock_text", suggestedActions: [] })) },
        sceneReconciler: { reconcile },
      },
    });

    const sceneText = "mock_text。Chương mock_text，mock_text。";
    const result = await runner.seedOpening({ sceneText, suggestedActions: [] });

    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({
      turn: 0,
      sceneText,
      context: expect.stringContaining("mock_text"),
    }));
    expect(result?.mutation.entities.upsert).toHaveLength(4);
    expect(db.entities.get("actor_child")?.summary).toContain("mock_text");
    expect([...db.edges.values()].some((edge) => edge.fromId === "actor_mother" && edge.toId === "actor_child")).toBe(true);
    expect(db.events).toHaveLength(0);
  });

  it("tells the opening seeder to turn already-held objects into holding edges", async () => {
    const db = new FakePlayDB();
    const store = new PlayStore(root);
    await store.createWorld({
      id: "opening-held-object",
      title: "mock_text",
      premise: "mock_text，Mo daumock_text。",
      language: "vi",
    });
    await store.ensureRun("opening-held-object", "main");
    await store.writeProjection("opening-held-object", "main", "projections/scene.md", "mock_text，mock_text。\n");

    let mutatorInput = "";
    const seedMutation: PlayMutationInput = {
      eventId: "evt-0",
      turn: 0,
      actionKind: "look",
      summary: "mock_textMo daumock_text。",
      entities: {
        upsert: [
          { id: "actor_player", type: "actor", label: "mock_text", summary: "mock_text。", status: "mock_text", updatedEventId: "evt-0" },
          { id: "item_spare_key", type: "item", label: "mock_text", summary: "mock_text。", status: "mock_text", updatedEventId: "evt-0" },
        ],
      },
      edges: {
        upsert: [
          { id: "edge_actor_player_mock_text_item_spare_key", fromId: "actor_player", type: "mock_text", toId: "item_spare_key", value: { role: "holding" }, validFromEventId: "evt-0", sourceEventId: "evt-0" },
        ],
      },
    };
    const runner = new PlayRunner({
      projectRoot: root,
      worldId: "opening-held-object",
      runId: "main",
      store,
      db,
      agents: {
        actionInterpreter: { interpret: vi.fn(async () => ({ actionKind: "look", intent: "Mo daumock_text" })) },
        worldMutator: {
          proposeMutation: vi.fn(async (input) => {
            mutatorInput = input.input;
            return seedMutation;
          }),
        },
        sceneRenderer: { render: vi.fn(async () => ({ sceneText: "mock_text", suggestedActions: [] })) },
      },
    });

    await runner.seedOpening({
      sceneText: "mock_text，mock_text。",
      suggestedActions: [],
    });

    expect(mutatorInput).toContain("mock_text");
    expect(mutatorInput).toContain("actor_player");
    expect(mutatorInput).toContain("value.role=\"holding\"");
    expect(mutatorInput).toContain("mock_text summary");
    expect([...db.edges.values()].some((edge) => edge.toId === "item_spare_key" && edge.value?.role === "holding")).toBe(true);
  });

  it("does not persist a one-sided user transcript when mutation application fails", async () => {
    const db = new FakePlayDB();
    const runner = new PlayRunner({
      projectRoot: root,
      worldId: "bad-turn",
      runId: "run-1",
      db,
      agents: {
        actionInterpreter: { interpret: vi.fn(async () => ({ actionKind: "look", intent: "mock_text" })) },
        worldMutator: {
          proposeMutation: vi.fn(async () => ({
            eventId: "evt-1",
            turn: 1,
            actionKind: "look",
            summary: "mock_text。",
            stateSlots: {
              upsert: [{
                id: "slot_missing",
                ownerEntityId: "missing_actor",
                kind: "pressure",
                label: "mock_text",
                value: 10,
                updatedEventId: "evt-1",
              }],
            },
          })),
        },
        sceneRenderer: { render: vi.fn(async () => ({ sceneText: "mock_text。", suggestedActions: [] })) },
      },
    });

    await expect(runner.step("mock_text")).rejects.toThrow(/missing entity/);
    await expect(readFile(join(root, "worlds", "bad-turn", "runs", "run-1", "transcript.jsonl"), "utf-8"))
      .resolves
      .toBe("");
  });

  it("feeds the world premise and existing entity roster to the mutator so it can reuse ids", async () => {
    const db = new FakePlayDB();
    db.upsertEntity({
      id: "actor_laochen",
      type: "actor",
      label: "mock_text",
      summary: "mock_text，mock_text。",
      status: "mock_text",
      updatedEventId: "evt-0",
    });
    db.upsertEntity({
      id: "org_tieshou_escort",
      type: "organization",
      label: "mock_text",
      summary: "mock_text，mock_text。",
      status: "mock_text",
      updatedEventId: "evt-0",
    });
    const store = new PlayStore(root);
    await store.createWorld({
      id: "rain-teahouse",
      title: "mock_text",
      premise: "mock_text，mock_text，mock_text。",
      language: "vi",
      worldContract: "mock_text：mock_text，mock_text，mock_text；mock_text，mock_text。",
      visualContract: "mock_text、mock_text，mock_text UI。",
    });
    await store.ensureRun("rain-teahouse", "run-1");
    await store.writeProjection("rain-teahouse", "run-1", "projections/scene.md", "mock_text，mock_text。\n");

    const action: PlayActionIntentInput = {
      actionKind: "say",
      targetEntityLabel: "mock_text",
      intent: "mock_text",
    };
    const mutation: PlayMutationInput = {
      eventId: "evt-1",
      turn: 1,
      actionKind: "say",
      summary: "mock_text。",
      edges: {
        upsert: [{
          id: "edge_ask_laochen",
          fromId: "actor_laochen",
          type: "mock_text",
          toId: "org_tieshou_escort",
          validFromEventId: "evt-1",
          sourceEventId: "evt-1",
        }],
      },
    };
    let mutatorContext = "";
    const proposeMutation = vi.fn(async (input: { readonly context: string }) => {
      mutatorContext = input.context;
      return mutation;
    });

    const renderSpy = vi.fn(async (_input: unknown) => ({ sceneText: "mock_text，mock_text。", suggestedActions: [] }));
    const runner = new PlayRunner({
      projectRoot: root,
      worldId: "rain-teahouse",
      runId: "run-1",
      store,
      db,
      agents: {
        actionInterpreter: { interpret: vi.fn(async () => action) },
        worldMutator: { proposeMutation },
        sceneRenderer: { render: renderSpy },
      },
    });

    await runner.step("mock_text，mock_text？");

    expect(mutatorContext).toContain("mock_text");
    expect(mutatorContext).toContain("mock_text");
    expect(mutatorContext).toContain("mock_text");
    expect(mutatorContext).toContain("mock_text");
    expect(mutatorContext).toContain("mock_text");
    expect(mutatorContext).toContain("mock_text UI");
    expect(mutatorContext).toContain("mock_text");
    expect(mutatorContext).toContain("actor_laochen [actor]: mock_text");
    expect(mutatorContext).toContain("org_tieshou_escort [organization]: mock_text");
    expect(renderSpy).toHaveBeenCalledWith(expect.objectContaining({
      worldPremise: expect.stringContaining("mock_text"),
      context: expect.stringContaining("actor_laochen [actor]: mock_text"),
    }));
  });

  it("does not duplicate a reconciler summary that repeats the mutator summary", async () => {
    const db = new FakePlayDB();
    const runner = new PlayRunner({
      projectRoot: root,
      worldId: "summary-dedupe",
      runId: "main",
      db,
      agents: {
        actionInterpreter: { interpret: vi.fn(async () => ({ actionKind: "wait", intent: "mock_text" })) },
        worldMutator: {
          proposeMutation: vi.fn(async () => ({
            eventId: "evt-1",
            turn: 1,
            actionKind: "wait",
            summary: "mock_text，mock_text。",
          })),
        },
        sceneRenderer: {
          render: vi.fn(async () => ({
            sceneText: "mock_text。",
            suggestedActions: [],
          })),
        },
        sceneReconciler: {
          reconcile: vi.fn(async () => ({
            eventId: "evt-1",
            turn: 1,
            actionKind: "wait",
            summary: "mock_text，mock_text。",
          })),
        },
      },
    });

    await runner.step("mock_text，mock_text。");

    expect(db.events[0]?.outcomeSummary).toBe("mock_text，mock_text。");
    await expect(readFile(join(root, "worlds", "summary-dedupe", "runs", "main", "events.jsonl"), "utf-8"))
      .resolves
      .not
      .toContain("；mock_text");
  });

  it("reconciles concrete entities introduced by renderer prose back into the graph", async () => {
    const db = new FakePlayDB();
    const action: PlayActionIntentInput = {
      actionKind: "look",
      intent: "mock_text",
    };
    const mutation: PlayMutationInput = {
      eventId: "evt-1",
      turn: 1,
      actionKind: "look",
      summary: "mock_text。",
      entities: {
        upsert: [{
          id: "actor_player",
          type: "actor",
          label: "mock_text",
          summary: "mock_text。",
          status: "mock_text",
          updatedEventId: "evt-1",
        }],
      },
    };
    const sceneText = "mock_textUmock_text，mock_text。";
    const reconcile = vi.fn(async () => ({
      eventId: "evt-1",
      turn: 1,
      actionKind: "look",
      summary: "mock_textUmock_text。",
      entities: {
        upsert: [{
          id: "item_black_usb",
          type: "item",
          label: "mock_textUmock_text",
          summary: "mock_text，mock_text。",
          status: "mock_text",
          updatedEventId: "evt-1",
        }],
      },
      edges: {
        upsert: [{
          id: "edge_actor_player_mock_text_item_black_usb",
          fromId: "actor_player",
          type: "mock_text",
          toId: "item_black_usb",
          value: { role: "holding" },
          validFromEventId: "evt-1",
          sourceEventId: "evt-1",
        }],
      },
    }));
    const runner = new PlayRunner({
      projectRoot: root,
      worldId: "renderer-noun",
      runId: "run-1",
      db,
      agents: {
        actionInterpreter: { interpret: vi.fn(async () => action) },
        worldMutator: { proposeMutation: vi.fn(async () => mutation) },
        sceneRenderer: { render: vi.fn(async () => ({ sceneText, suggestedActions: [] })) },
        sceneReconciler: { reconcile },
      },
    });

    await runner.step("mock_text");

    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({ sceneText }));
    expect(db.entities.get("item_black_usb")?.label).toBe("mock_textUmock_text");
    expect([...db.edges.values()].some((edge) => edge.toId === "item_black_usb" && edge.value?.role === "holding")).toBe(true);
    await expect(readFile(join(root, "worlds", "renderer-noun", "runs", "run-1", "projections", "state.md"), "utf-8"))
      .resolves
      .toContain("mock_textUmock_text");
  });

  it("deduplicates same-id entity updates before writing the state projection", async () => {
    const db = new FakePlayDB();
    const action: PlayActionIntentInput = {
      actionKind: "look",
      intent: "mock_text",
    };
    const mutation: PlayMutationInput = {
      eventId: "evt-1",
      turn: 1,
      actionKind: "look",
      summary: "mock_text。",
      entities: {
        upsert: [{
          id: "actor_white_sailboat",
          type: "actor",
          label: "mock_text",
          summary: "mock_text、mock_text。",
          status: "mock_text",
          updatedEventId: "evt-1",
        }],
      },
    };
    const reconcile = vi.fn(async () => ({
      eventId: "evt-1",
      turn: 1,
      actionKind: "look",
      summary: "mock_text。",
      entities: {
        upsert: [{
          id: "actor_white_sailboat",
          type: "actor",
          label: "mock_text",
          summary: "mock_text、mock_text，mock_text。",
          status: "mock_text",
          updatedEventId: "evt-1",
        }],
      },
    }));
    const runner = new PlayRunner({
      projectRoot: root,
      worldId: "dedupe-projection",
      runId: "run-1",
      db,
      agents: {
        actionInterpreter: { interpret: vi.fn(async () => action) },
        worldMutator: { proposeMutation: vi.fn(async () => mutation) },
        sceneRenderer: { render: vi.fn(async () => ({ sceneText: "mock_text。", suggestedActions: [] })) },
        sceneReconciler: { reconcile },
      },
    });

    await runner.step("mock_text");

    const state = await readFile(join(root, "worlds", "dedupe-projection", "runs", "run-1", "projections", "state.md"), "utf-8");
    expect(state.match(/actor_white_sailboat/g)?.length).toBe(1);
    expect(state).toContain("mock_text");
    expect(state).not.toContain("mock_text、mock_text。");
  });

  it("regenerates the latest turn from a checkpoint and keeps both variants", async () => {
    const db = new FakePlayDB();
    const store = new PlayStore(root);
    await store.createWorld({
      id: "regenerate-turn",
      title: "mock_text",
      premise: "mock_text。",
      language: "vi",
    });
    await store.ensureRun("regenerate-turn", "main");
    await store.writeProjection("regenerate-turn", "main", "projections/scene.md", "mock_text。\n");

    let version = "A";
    const renderInputs: unknown[] = [];
    const renderReplay = vi.fn(async (input: unknown) => {
      renderInputs.push(input);
      return {
        sceneText: `mock_text${version}：mock_text。`,
        suggestedActions: [`mock_text${version}`],
      };
    });
    const runner = new PlayRunner({
      projectRoot: root,
      worldId: "regenerate-turn",
      runId: "main",
      store,
      db,
      agents: {
        actionInterpreter: { interpret: vi.fn(async () => ({ actionKind: "look", intent: "mock_text" })) },
        worldMutator: {
          proposeMutation: vi.fn(async () => ({
            eventId: "evt-1",
            turn: 1,
            actionKind: "look",
            summary: `mock_text${version}mock_text。`,
            entities: {
              upsert: [{
                id: `evidence_ticket_${version.toLowerCase()}`,
                type: "evidence",
                label: `mock_text${version}mock_text`,
                summary: "mock_text。",
                status: "mock_text",
                updatedEventId: "evt-1",
              }],
            },
          })),
        },
        sceneRenderer: { render: renderReplay },
      },
    });

    await runner.step("mock_text");
    version = "B";
    const replay = await runner.regenerateLastTurn();

    expect(replay.replayedInput).toBe("mock_text");
    expect(replay.sceneText).toContain("mock_textB");
    expect(replay.previousVariantId).toBeTruthy();
    expect(replay.variantId).toBeTruthy();
    const replayRenderInput = renderInputs[1] as { replayContext?: string } | undefined;
    expect(replayRenderInput?.replayContext).toContain("mock_text");
    expect(replayRenderInput?.replayContext).toContain("mock_text");
    expect(replayRenderInput?.replayContext).toContain("mock_text");
    expect(db.events).toHaveLength(1);
    expect(db.entities.has("evidence_ticket_a")).toBe(false);
    expect(db.entities.has("evidence_ticket_b")).toBe(true);

    const runDir = join(root, "worlds", "regenerate-turn", "runs", "main");
    await expect(readFile(join(runDir, "events.jsonl"), "utf-8"))
      .resolves
      .toContain("mock_textBmock_text");
    await expect(readFile(join(runDir, "projections", "scene.md"), "utf-8"))
      .resolves
      .toContain("mock_textB");
    await expect(readFile(join(runDir, "variants", "turn-1", `${replay.previousVariantId}.json`), "utf-8"))
      .resolves
      .toContain("mock_textA");
    await expect(readFile(join(runDir, "variants", "turn-1", `${replay.variantId}.json`), "utf-8"))
      .resolves
      .toContain("mock_textB");
  });

  it("close() does not close a caller-provided db", () => {
    const db = new FakePlayDB() as FakePlayDB & { close: () => void };
    db.close = vi.fn();
    const runner = new PlayRunner({
      projectRoot: root,
      worldId: "close-owned-db",
      runId: "main",
      db,
      agents: {
        actionInterpreter: { interpret: vi.fn() },
        worldMutator: { proposeMutation: vi.fn() },
        sceneRenderer: { render: vi.fn() },
      },
    });

    runner.close();

    expect(db.close).not.toHaveBeenCalled();
  });

  it("close() releases the self-created db and is idempotent", async () => {
    const store = new PlayStore(root);
    await store.createWorld({
      id: "close-self-db",
      title: "mock_textTest",
      premise: "mock_text runner mock_text。",
      language: "vi",
      mode: "open",
    });
    await store.ensureRun("close-self-db", "main");
    const runner = new PlayRunner({
      projectRoot: root,
      worldId: "close-self-db",
      runId: "main",
      agents: {
        actionInterpreter: { interpret: vi.fn() },
        worldMutator: { proposeMutation: vi.fn() },
        sceneRenderer: { render: vi.fn() },
      },
    });

    runner.close();
    // Windows mock_text play.db mock_text；mock_text close mock_text。
    runner.close();

    await expect(rm(join(root, "worlds", "close-self-db"), { recursive: true })).resolves.toBeUndefined();
  });
});
