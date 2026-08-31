import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PlayStore } from "../play/play-store.js";

describe("PlayStore", () => {
  it("creates and lists worlds and runs with metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "castor-play-store-"));
    const store = new PlayStore(root);

    try {
      await store.createWorld({
        id: "rain-teahouse",
        title: "mock_text",
        premise: "mock_text。",
        mode: "open",
      });
      await store.ensureRun("rain-teahouse", "run-001");
      await store.ensureRun("rain-teahouse", "run-002");

      await expect(store.listWorlds()).resolves.toEqual([
        expect.objectContaining({
          id: "rain-teahouse",
          title: "mock_text",
          premise: "mock_text。",
          mode: "open",
        }),
      ]);
      const runs = await store.listRuns("rain-teahouse");
      expect(runs.map((run) => run.id).sort()).toEqual(["run-001", "run-002"]);
      expect(runs[0]).toMatchObject({ eventCount: 0, transcriptCount: 0 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("persists optional world and visual contracts as natural-language rules", async () => {
    const root = await mkdtemp(join(tmpdir(), "castor-play-store-"));
    const store = new PlayStore(root);

    try {
      await store.createWorld({
        id: "contract-world",
        title: "mock_text",
        premise: "mock_text，mock_textGiau giemmock_text。",
        mode: "open",
        worldContract: [
          "mock_text/mock_text/mock_text。",
          "mock_textGiau giemmock_text，mock_text。",
          "mock_text RPG mock_text，mock_text。",
        ].join("\n"),
        visualContract: "mock_text、mock_text、mock_text，mock_text UI。",
      } as any);

      await expect(store.loadWorld("contract-world")).resolves.toMatchObject({
        title: "mock_text",
        worldContract: expect.stringContaining("mock_text"),
        visualContract: expect.stringContaining("mock_text"),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("creates world/run storage and persists JSONL events", async () => {
    const root = await mkdtemp(join(tmpdir(), "castor-play-store-"));
    const store = new PlayStore(root);

    try {
      await store.ensureWorld("rain-teahouse");
      await store.ensureRun("rain-teahouse", "run-001");

      await store.appendEvent("rain-teahouse", "run-001", {
        id: "event-0001",
        turn: 1,
        actionKind: "look",
        rawInput: "mock_text",
        outcomeSummary: "mock_text。",
        createdAt: "2026-05-28T00:00:00.000Z",
      });

      await store.appendEvent("rain-teahouse", "run-001", {
        id: "event-0002",
        turn: 2,
        actionKind: "say",
        rawInput: "mock_text",
        outcomeSummary: "Xu Jinanmock_text。",
        createdAt: "2026-05-28T00:01:00.000Z",
      });

      const events = await store.readEvents("rain-teahouse", "run-001");
      expect(events.map((event) => event.id)).toEqual(["event-0001", "event-0002"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("persists transcripts, current state, and markdown projections", async () => {
    const root = await mkdtemp(join(tmpdir(), "castor-play-store-"));
    const store = new PlayStore(root);

    try {
      await store.ensureRun("rain-teahouse", "run-001");

      await store.appendTranscriptTurn("rain-teahouse", "run-001", {
        role: "user",
        content: "mock_text",
        timestamp: 1779916800000,
      });
      await store.appendTranscriptTurn("rain-teahouse", "run-001", {
        role: "assistant",
        content: "mock_text，mock_text。",
        timestamp: 1779916801000,
      });

      await store.saveCurrentState("rain-teahouse", "run-001", {
        turn: 1,
        activeSceneId: "scene-car",
        activeLocation: "mock_text",
        currentObjective: "mock_textXu Jinanmock_textGiau giemmock_text",
      });
      await store.writeProjection("rain-teahouse", "run-001", "state/current.md", "# mock_text\n\nmock_text。");

      expect(await store.readTranscript("rain-teahouse", "run-001")).toHaveLength(2);
      expect(await store.loadCurrentState("rain-teahouse", "run-001")).toMatchObject({
        activeSceneId: "scene-car",
      });
      await expect(store.readProjection("rain-teahouse", "run-001", "state/current.md"))
        .resolves.toContain("mock_text");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("ignores malformed JSONL rows when reading logs", async () => {
    const root = await mkdtemp(join(tmpdir(), "castor-play-store-"));
    const store = new PlayStore(root);

    try {
      await store.ensureRun("rain-teahouse", "run-001");
      await store.appendRawEventLine("rain-teahouse", "run-001", "{bad json");
      await store.appendEvent("rain-teahouse", "run-001", {
        id: "event-0001",
        turn: 1,
        actionKind: "wait",
        rawInput: "mock_text",
        outcomeSummary: "mock_text。",
        createdAt: "2026-05-28T00:00:00.000Z",
      });

      const events = await store.readEvents("rain-teahouse", "run-001");
      expect(events).toHaveLength(1);
      expect(events[0]?.actionKind).toBe("wait");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
