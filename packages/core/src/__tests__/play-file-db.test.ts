import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PlayFileDB } from "../play/play-file-db.js";

describe("PlayFileDB", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "castor-play-file-db-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("persists graph state across instances", () => {
    const db = new PlayFileDB(dir);
    db.upsertEntity({ id: "player", type: "actor", label: "mock_text" });
    db.upsertEntity({ id: "claim-hidden-home", type: "claim", label: "Giau giemmock_text" });
    db.upsertEdge({
      id: "edge-player-claim",
      fromId: "player",
      type: "investigates",
      toId: "claim-hidden-home",
      validFromEventId: "evt-1",
      sourceEventId: "evt-1",
    });
    db.upsertStateSlot({
      id: "pressure-player-risk",
      ownerEntityId: "player",
      kind: "pressure",
      label: "mock_text",
      value: { current: 20, min: 0, max: 100 },
      updatedEventId: "evt-1",
    });
    db.recordEvent({
      id: "evt-1",
      turn: 1,
      actionKind: "look",
      rawInput: "mock_text",
      outcomeSummary: "mock_text",
      createdAt: "2026-05-28T00:00:00.000Z",
    });
    db.close();

    const reopened = new PlayFileDB(dir);
    expect(reopened.getEntity("player")?.label).toBe("mock_text");
    expect(reopened.getEvent("evt-1")?.rawInput).toBe("mock_text");
    expect(reopened.snapshot()).toMatchObject({
      entities: [expect.objectContaining({ id: "claim-hidden-home" }), expect.objectContaining({ id: "player" })],
      edges: [expect.objectContaining({ id: "edge-player-claim" })],
      stateSlots: [expect.objectContaining({ id: "pressure-player-risk" })],
      events: [expect.objectContaining({ id: "evt-1" })],
    });
  });

  it("rolls back transaction mutations when validation fails inside the transaction", () => {
    const db = new PlayFileDB(dir);

    expect(() => db.transaction(() => {
      db.upsertEntity({ id: "temp", type: "actor", label: "mock_text" });
      throw new Error("fail");
    })).toThrow("fail");

    expect(db.getEntity("temp")).toBeNull();
  });
});
