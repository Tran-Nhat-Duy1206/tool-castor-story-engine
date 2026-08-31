import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadStudioTaskSnapshot,
  saveStudioTaskSnapshot,
  studioTaskSnapshotPath,
} from "./task-store.js";

describe("Studio task snapshots", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "castor-studio-task-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("persists a running task so a refreshed Studio session can restore it", async () => {
    await saveStudioTaskSnapshot(root, {
      version: 1,
      sessionId: "session-1",
      sourceRequestId: "request-1",
      requestedIntent: "short_run",
      updatedAt: 20,
      execution: {
        id: "task-1",
        tool: "short_fiction_run",
        label: "mock_val",
        status: "running",
        startedAt: 10,
        logs: ["mock_val"],
      },
    });

    await expect(loadStudioTaskSnapshot(root, "session-1")).resolves.toEqual({
      version: 1,
      sessionId: "session-1",
      sourceRequestId: "request-1",
      requestedIntent: "short_run",
      updatedAt: 20,
      execution: {
        id: "task-1",
        tool: "short_fiction_run",
        label: "mock_val",
        status: "running",
        startedAt: 10,
        logs: ["mock_val"],
      },
    });
  });

  it("serializes overlapping progress writes and keeps the newest snapshot", async () => {
    const base = {
      version: 1 as const,
      sessionId: "session-2",
      requestedIntent: "script_create" as const,
      execution: {
        id: "task-2",
        tool: "script_create",
        label: "mock_val",
        status: "running" as const,
        startedAt: 10,
      },
    };

    await Promise.all([
      saveStudioTaskSnapshot(root, { ...base, updatedAt: 20, execution: { ...base.execution, logs: ["mock_val"] } }),
      saveStudioTaskSnapshot(root, { ...base, updatedAt: 30, execution: { ...base.execution, logs: ["mock_val", "mock_val"] } }),
    ]);

    await expect(loadStudioTaskSnapshot(root, "session-2")).resolves.toMatchObject({
      updatedAt: 30,
      execution: { logs: ["mock_val", "mock_val"] },
    });
  });

  it("treats a corrupt snapshot as unavailable instead of crashing session restore", async () => {
    const path = studioTaskSnapshotPath(root, "session-3");
    await saveStudioTaskSnapshot(root, {
      version: 1,
      sessionId: "session-3",
      requestedIntent: "short_run",
      updatedAt: 20,
      execution: {
        id: "task-3",
        tool: "short_fiction_run",
        label: "mock_val",
        status: "running",
        startedAt: 10,
      },
    });
    await writeFile(path, "{broken", "utf-8");

    await expect(loadStudioTaskSnapshot(root, "session-3")).resolves.toBeNull();
    await expect(readFile(path, "utf-8")).resolves.toBe("{broken");
  });
});
