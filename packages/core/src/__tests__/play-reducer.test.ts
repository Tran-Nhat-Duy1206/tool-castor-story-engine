import { describe, expect, it } from "vitest";
import type {
  PlayEdgeInput,
  PlayEntity,
  PlayEntityInput,
  PlayEventInput,
  PlayStateSlot,
  PlayStateSlotInput,
} from "../models/play.js";
import { applyPlayMutation, seedPlayGraph } from "../play/play-reducer.js";

class FakePlayDB {
  entities = new Map<string, PlayEntity>();
  edges = new Map<string, PlayEdgeInput>();
  stateSlots = new Map<string, PlayStateSlot>();
  events: PlayEventInput[] = [];
  transactionCalls = 0;

  transaction<T>(fn: () => T): T {
    this.transactionCalls += 1;
    return fn();
  }

  upsertEntity(entity: PlayEntityInput): void {
    this.entities.set(entity.id, {
      summary: "",
      status: "",
      ...entity,
    });
  }

  getEntity(id: string): PlayEntity | null {
    return this.entities.get(id) ?? null;
  }

  upsertEdge(edge: PlayEdgeInput): void {
    this.edges.set(edge.id, edge);
  }

  expireEdge(edgeId: string, validUntilEventId: string): void {
    const edge = this.edges.get(edgeId);
    if (edge) this.edges.set(edgeId, { ...edge, validUntilEventId });
  }

  upsertStateSlot(slot: PlayStateSlotInput): void {
    this.stateSlots.set(slot.id, {
      ownerEntityId: null,
      ...slot,
      value: slot.value,
    });
  }

  getStateSlotsForEntity(entityId: string): PlayStateSlot[] {
    return [...this.stateSlots.values()].filter((slot) => slot.ownerEntityId === entityId);
  }

  recordEvent(event: PlayEventInput): void {
    this.events.push(event);
  }

  snapshot() {
    return {
      entities: [...this.entities.values()],
      edges: [...this.edges.values()] as never[],
      stateSlots: [...this.stateSlots.values()],
      events: this.events as never[],
    };
  }
}

describe("applyPlayMutation", () => {
  it("canonicalizes the model's legacy player id to actor_player before applying graph changes", () => {
    const db = new FakePlayDB();

    applyPlayMutation({
      db,
      mutation: {
        eventId: "evt-player",
        turn: 1,
        actionKind: "look",
        summary: "mock_text。",
        entities: {
          upsert: [
            { id: "player", type: "actor", label: "mock_text（mock_text）" },
            { id: "copper_token", type: "item", label: "mock_text" },
          ],
        },
        edges: {
          upsert: [
            { id: "edge_player_mock_text_copper_token", fromId: "player", type: "mock_text", toId: "copper_token", value: { role: "holding" } },
          ],
        },
        stateSlots: {
          upsert: [
            {
              id: "pressure:player:danger",
              ownerEntityId: "player",
              kind: "pressure",
              label: "mock_text",
              value: { current: 20, min: 0, max: 100 },
              updatedEventId: "evt-player",
            },
          ],
        },
      },
      rawInput: "mock_text",
    });

    expect(db.entities.has("player")).toBe(false);
    expect(db.entities.get("actor_player")).toMatchObject({
      type: "actor",
      label: "mock_text（mock_text）",
    });
    expect(db.edges.get("edge_player_mock_text_copper_token")).toMatchObject({
      fromId: "actor_player",
      toId: "copper_token",
      value: { role: "holding" },
    });
    expect(db.stateSlots.get("pressure:player:danger")?.ownerEntityId).toBe("actor_player");
  });

  it("canonicalizes the player id when seeding the opening graph", () => {
    const db = new FakePlayDB();

    seedPlayGraph({
      db,
      mutation: {
        eventId: "evt-0",
        turn: 0,
        actionKind: "look",
        summary: "Mo daumock_text。",
        entities: {
          upsert: [
            { id: "player", type: "actor", label: "mock_text" },
            { id: "copper_token", type: "item", label: "mock_text" },
          ],
        },
        edges: {
          upsert: [
            { id: "edge_player_mock_text_copper_token", fromId: "player", type: "mock_text", toId: "copper_token", value: { role: "holding" } },
          ],
        },
      },
    });

    expect(db.entities.has("player")).toBe(false);
    expect(db.entities.get("actor_player")?.label).toBe("mock_text");
    expect(db.edges.get("edge_player_mock_text_copper_token")?.fromId).toBe("actor_player");
  });

  it("records the event and applies entity, edge, state, and evidence changes atomically", () => {
    const db = new FakePlayDB();

    const result = applyPlayMutation({
      db,
      mutation: {
        eventId: "evt-1",
        turn: 1,
        actionKind: "look",
        summary: "mock_text。",
        entities: {
          upsert: [
            { id: "player", type: "actor", label: "mock_text" },
            { id: "ledger", type: "evidence", label: "mock_text" },
            { id: "claim-affair", type: "claim", label: "Xu Jinanmock_text" },
          ],
        },
        edges: {
          upsert: [{
            id: "edge-ledger-claim",
            fromId: "ledger",
            type: "supports",
            toId: "claim-affair",
            validFromEventId: "evt-1",
            sourceEventId: "evt-1",
            strength: 0.7,
          }],
        },
        stateSlots: {
          upsert: [{
            id: "pressure:player:danger",
            ownerEntityId: "player",
            kind: "pressure",
            label: "mock_text",
            value: { current: 120, min: 0, max: 100 },
            updatedEventId: "evt-1",
          }],
        },
        evidence: {
          transitions: [{
            entityId: "ledger",
            to: "seen",
            reason: "mock_text。",
          }],
        },
      },
      rawInput: "mock_text",
      createdAt: "2026-05-28T00:00:00.000Z",
    });

    expect(result.event).toMatchObject({
      id: "evt-1",
      turn: 1,
      actionKind: "look",
      rawInput: "mock_text",
      outcomeSummary: "mock_text。",
    });
    expect(db.transactionCalls).toBe(1);
    expect(db.events).toHaveLength(1);
    expect(db.entities.get("ledger")?.type).toBe("evidence");
    expect(db.edges.get("edge-ledger-claim")?.toId).toBe("claim-affair");
    expect(db.stateSlots.get("pressure:player:danger")?.value).toEqual({ current: 100, min: 0, max: 100 });
    expect(db.stateSlots.get("evidence:ledger:status")?.value).toEqual({
      previous: "unknown",
      status: "seen",
      reason: "mock_text。",
    });
  });

  it("skips edges that point at missing entities (fail-open) while applying the rest of the turn (C3)", () => {
    const db = new FakePlayDB();

    const result = applyPlayMutation({
      db,
      mutation: {
        eventId: "evt-2",
        turn: 2,
        actionKind: "do",
        entities: { upsert: [
          { id: "lin", type: "actor", label: "mock_text" },
          { id: "clerk", type: "actor", label: "Phong so sachmock_text" },
        ] },
        edges: {
          upsert: [
            // valid: both endpoints exist this turn
            { id: "good-edge", fromId: "lin", type: "mock_text", toId: "clerk", validFromEventId: "evt-2", sourceEventId: "evt-2" },
            // dangling: must be skipped, NOT crash the turn (which used to wipe everything)
            { id: "bad-edge", fromId: "lin", type: "knows", toId: "ghost", validFromEventId: "evt-2", sourceEventId: "evt-2" },
          ],
        },
      },
      rawInput: "mock_text",
    });

    expect(result.event.id).toBe("evt-2");
    expect(db.events).toHaveLength(1);          // turn was NOT wiped
    expect(db.entities.size).toBe(2);           // entities applied
    expect(db.edges.get("good-edge")?.toId).toBe("clerk"); // valid edge kept
    expect(db.edges.has("bad-edge")).toBe(false);          // dangling edge dropped
  });

  it("resolves edge endpoints that reference existing entities by label", () => {
    const db = new FakePlayDB();
    db.upsertEntity({ id: "actor_afu", type: "actor", label: "mock_text" });
    db.upsertEntity({ id: "actor_laochen", type: "actor", label: "mock_text" });

    applyPlayMutation({
      db,
      mutation: {
        eventId: "evt-4",
        turn: 4,
        actionKind: "say",
        summary: "mock_text。",
        edges: {
          upsert: [{
            id: "edge_ask",
            fromId: "mock_text",
            type: "mock_text",
            toId: "mock_text",
            validFromEventId: "evt-4",
            sourceEventId: "evt-4",
          }],
        },
      },
      rawInput: "mock_text",
    });

    expect(db.edges.get("edge_ask")).toMatchObject({
      fromId: "actor_afu",
      toId: "actor_laochen",
      type: "mock_text",
    });
  });

  it("downgrades holding edges for observed intangible evidence", () => {
    const db = new FakePlayDB();

    applyPlayMutation({
      db,
      mutation: {
        eventId: "evt-5",
        turn: 5,
        actionKind: "look",
        summary: "mock_text。",
        entities: {
          upsert: [
            { id: "actor_player", type: "actor", label: "mock_text" },
            { id: "evidence_grass", type: "evidence", label: "mock_text" },
            { id: "evidence_note", type: "evidence", label: "mock_text" },
            { id: "item_amulet", type: "item", label: "mock_text" },
          ],
        },
        edges: {
          upsert: [
            { id: "edge-grass", fromId: "actor_player", type: "mock_text", toId: "evidence_grass", value: { role: "holding" } },
            { id: "edge-note", fromId: "actor_player", type: "mock_text", toId: "evidence_note", value: { role: "holding", physical: true } },
            { id: "edge-amulet", fromId: "actor_player", type: "mock_text", toId: "item_amulet", value: { role: "holding" } },
          ],
        },
      },
      rawInput: "mock_text，mock_text",
    });

    expect(db.edges.get("edge-grass")?.value).toMatchObject({ role: "observed" });
    expect(db.edges.get("edge-note")?.value).toMatchObject({ role: "holding", physical: true });
    expect(db.edges.get("edge-amulet")?.value).toMatchObject({ role: "holding" });
  });

  it("rejects evidence status regressions", () => {
    const db = new FakePlayDB();
    db.upsertEntity({ id: "receipt", type: "evidence", label: "mock_text" });
    db.upsertStateSlot({
      id: "evidence:receipt:status",
      ownerEntityId: "receipt",
      kind: "evidence",
      label: "mock_text",
      value: { status: "verified" },
      updatedEventId: "evt-old",
    });

    expect(() => applyPlayMutation({
      db,
      mutation: {
        eventId: "evt-3",
        turn: 3,
        actionKind: "do",
        evidence: {
          transitions: [{
            entityId: "receipt",
            to: "seen",
          }],
        },
      },
      rawInput: "mock_text",
    })).toThrow(/regress/i);

    expect(db.events).toHaveLength(0);
  });
});
