import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { PlayDB } from "../play/play-db.js";

const require = createRequire(import.meta.url);
let hasNodeSqlite = true;
try {
  require("node:sqlite");
} catch {
  hasNodeSqlite = false;
}

const sqliteIt = hasNodeSqlite ? it : it.skip;

describe("PlayDB", () => {
  sqliteIt("upserts entities and reopens persisted data", async () => {
    const root = await mkdtemp(join(tmpdir(), "castor-play-db-"));

    try {
      const db = new PlayDB(root);
      db.upsertEntity({
        id: "actor_songci",
        type: "actor",
        label: "mock_text",
        summary: "mock_text。",
        status: "active",
        createdEventId: "event-0001",
        updatedEventId: "event-0001",
      });
      db.close();

      const reopened = new PlayDB(root);
      expect(reopened.getEntity("actor_songci")).toMatchObject({
        label: "mock_text",
        type: "actor",
      });
      reopened.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  sqliteIt("stores temporal edges and excludes expired edges from current queries", async () => {
    const root = await mkdtemp(join(tmpdir(), "castor-play-db-"));
    const db = new PlayDB(root);

    try {
      db.upsertEntity({ id: "evidence_stats", type: "evidence", label: "mock_text" });
      db.upsertEntity({ id: "claim_cohabit", type: "claim", label: "mock_text" });
      db.upsertEdge({
        id: "edge-supports",
        fromId: "evidence_stats",
        type: "supports",
        toId: "claim_cohabit",
        validFromEventId: "event-0001",
        sourceEventId: "event-0001",
        visibility: { player: "seen" },
        strength: 0.7,
      });

      expect(db.getCurrentEdgesForEntity("evidence_stats")).toHaveLength(1);

      db.expireEdge("edge-supports", "event-0002");
      expect(db.getCurrentEdgesForEntity("evidence_stats")).toHaveLength(0);
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  sqliteIt("finds evidence supporting a claim", async () => {
    const root = await mkdtemp(join(tmpdir(), "castor-play-db-"));
    const db = new PlayDB(root);

    try {
      db.upsertEntity({ id: "evidence_stats", type: "evidence", label: "mock_text" });
      db.upsertEntity({ id: "claim_cohabit", type: "claim", label: "mock_text" });
      db.upsertEntity({ id: "evidence_recording", type: "evidence", label: "mock_text" });
      db.upsertEdge({
        id: "edge-supports-1",
        fromId: "evidence_stats",
        type: "supports",
        toId: "claim_cohabit",
        validFromEventId: "event-0001",
        sourceEventId: "event-0001",
        strength: 0.6,
      });
      db.upsertEdge({
        id: "edge-supports-2",
        fromId: "evidence_recording",
        type: "supports",
        toId: "claim_cohabit",
        validFromEventId: "event-0002",
        sourceEventId: "event-0002",
        strength: 0.8,
      });

      expect(db.getEvidenceForClaim("claim_cohabit").map((entity) => entity.id))
        .toEqual(["evidence_recording", "evidence_stats"]);
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  sqliteIt("persists state slots and events", async () => {
    const root = await mkdtemp(join(tmpdir(), "castor-play-db-"));
    const db = new PlayDB(root);

    try {
      db.upsertEntity({ id: "actor_husband", type: "actor", label: "Xu Jinan" });
      db.upsertStateSlot({
        id: "slot_husband_suspicion",
        ownerEntityId: "actor_husband",
        kind: "pressure",
        label: "mock_text",
        value: { current: 45, min: 0, max: 100 },
        updatedEventId: "event-0002",
      });
      db.recordEvent({
        id: "event-0002",
        turn: 2,
        actionKind: "say",
        rawInput: "mock_text",
        outcomeSummary: "mock_text。",
        createdAt: "2026-05-28T00:00:00.000Z",
      });

      expect(db.getStateSlotsForEntity("actor_husband")[0]?.label).toBe("mock_text");
      expect(db.getEvent("event-0002")?.actionKind).toBe("say");
      expect(db.snapshot()).toMatchObject({
        entities: [expect.objectContaining({ id: "actor_husband" })],
        stateSlots: [expect.objectContaining({ id: "slot_husband_suspicion" })],
        events: [expect.objectContaining({ id: "event-0002" })],
      });
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
