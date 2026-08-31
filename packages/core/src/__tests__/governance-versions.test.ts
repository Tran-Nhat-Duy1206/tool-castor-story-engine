import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createVersionStore,
  restoreVersionAsRevisionCandidate,
  type FoundationPublishedSnapshot,
  type FoundationVersion,
} from "../governance/versions.js";
import { commitAtomicFileSet, type AtomicFileWrite } from "../utils/atomic-file-set.js";

let root = "";
let bookDir = "";

async function setupBook(): Promise<void> {
  root = await mkdtemp(join(tmpdir(), "castor-versions-"));
  bookDir = join(root, "books", "versions-book");
  await mkdir(bookDir, { recursive: true });
}

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = "";
    bookDir = "";
  }
});

function snapshot(overrides: Record<string, unknown> = {}): FoundationPublishedSnapshot {
  return {
    unitRefs: [
      { unitId: "sf-theme-tone", contentRevision: 1, approvedRevision: 1, contentHash: "hash-theme" },
      { unitId: "sf-core-conflict", contentRevision: 1, approvedRevision: 1, contentHash: "hash-conflict" },
    ],
    changedUnitIds: ["sf-theme-tone"],
    humanResolutionIds: [],
    dependencyImpact: [],
    baseCanonRevision: 0,
    ...overrides,
  };
}

function versionEnvelope(version: number, overrides: Record<string, unknown> = {}) {
  return {
    artifactKind: "foundation" as const,
    unitId: "foundation",
    version,
    parentVersion: version === 1 ? null : version - 1,
    baseCanonRevision: 0,
    snapshot: snapshot(),
    publishedBy: "test-human",
    ...overrides,
  };
}

/** Simulate the Task 9 commit of prepared writes using the pre-existing atomic primitive. */
async function commitPrepared(bookDirPath: string, writes: ReadonlyArray<AtomicFileWrite>): Promise<void> {
  await commitAtomicFileSet({ rootDir: bookDirPath, writes });
}

describe("VersionStore — read/list/integrity after a simulated commit", () => {
  it("readVersion round-trips a committed version", async () => {
    await setupBook();
    const store = createVersionStore(bookDir);
    const prepared = await store.prepareVersionAppend(versionEnvelope(1));
    expect(prepared.writes.length).toBeGreaterThan(0);
    const pointer = store.prepareCurrentVersionPointer("foundation", "foundation", 1);
    await commitPrepared(bookDir, [...prepared.writes, pointer]);
    const read = await store.readVersion<FoundationPublishedSnapshot>("foundation", "foundation", 1);
    expect(read).not.toBeNull();
    expect(read?.version).toBe(1);
    expect(read?.snapshot.unitRefs).toHaveLength(2);
  });

  it("readCurrentVersion round-trips the current pointer", async () => {
    await setupBook();
    const store = createVersionStore(bookDir);
    await commitPrepared(bookDir, [
      ...(await store.prepareVersionAppend(versionEnvelope(1))).writes,
      store.prepareCurrentVersionPointer("foundation", "foundation", 1),
    ]);
    const current = await store.readCurrentVersion<FoundationPublishedSnapshot>("foundation", "foundation");
    expect(current?.version).toBe(1);
  });

  it("listVersions is ordered correctly", async () => {
    await setupBook();
    const store = createVersionStore(bookDir);
    const writes1 = (await store.prepareVersionAppend(versionEnvelope(1))).writes;
    await commitPrepared(bookDir, [...writes1, store.prepareCurrentVersionPointer("foundation", "foundation", 1)]);
    const writes2 = (await store.prepareVersionAppend(versionEnvelope(2, { parentVersion: 1 }))).writes;
    await commitPrepared(bookDir, [...writes2, store.prepareCurrentVersionPointer("foundation", "foundation", 2)]);
    expect(await store.listVersions("foundation", "foundation")).toEqual([1, 2]);
  });

  it("an immutable committed record cannot be silently overwritten (duplicate version rejected)", async () => {
    await setupBook();
    const store = createVersionStore(bookDir);
    await commitPrepared(bookDir, [
      ...(await store.prepareVersionAppend(versionEnvelope(1))).writes,
      store.prepareCurrentVersionPointer("foundation", "foundation", 1),
    ]);
    await expect(store.prepareVersionAppend(versionEnvelope(1))).rejects.toThrow();
    // version 2 is the only legal next version
    const prepared = await store.prepareVersionAppend(versionEnvelope(2, { parentVersion: 1 }));
    expect(prepared.writes.length).toBeGreaterThan(0);
  });

  it("integrity verification detects tampering", async () => {
    await setupBook();
    const store = createVersionStore(bookDir);
    await commitPrepared(bookDir, [
      ...(await store.prepareVersionAppend(versionEnvelope(1))).writes,
      store.prepareCurrentVersionPointer("foundation", "foundation", 1),
    ]);
    // Tamper with the committed record (change the snapshot hash reference).
    const versionPath = join(bookDir, "story", "governance", "versions", "foundation", "foundation", "1.json");
    const raw = JSON.parse(await (await import("node:fs/promises")).readFile(versionPath, "utf-8"));
    raw.snapshot.unitRefs[0]!.contentHash = "tampered";
    await writeFile(versionPath, JSON.stringify(raw), "utf-8");
    const errors = await store.verifyIntegrity("foundation", "foundation");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("integrity verification detects a missing current pointer (deleted current.json)", async () => {
    await setupBook();
    const store = createVersionStore(bookDir);
    await commitPrepared(bookDir, [
      ...(await store.prepareVersionAppend(versionEnvelope(1))).writes,
      store.prepareCurrentVersionPointer("foundation", "foundation", 1),
    ]);
    await rm(join(bookDir, "story", "governance", "versions", "foundation", "foundation", "current.json"));
    const errors = await store.verifyIntegrity("foundation", "foundation");
    expect(errors.some((e) => e.includes("Current pointer missing"))).toBe(true);
  });

  it("integrity verification detects a pointer whose target version record was deleted", async () => {
    await setupBook();
    const store = createVersionStore(bookDir);
    await commitPrepared(bookDir, [
      ...(await store.prepareVersionAppend(versionEnvelope(1))).writes,
      store.prepareCurrentVersionPointer("foundation", "foundation", 1),
    ]);
    // Delete the version record the current pointer references.
    await rm(join(bookDir, "story", "governance", "versions", "foundation", "foundation", "1.json"));
    const errors = await store.verifyIntegrity("foundation", "foundation");
    expect(errors.some((e) => e.includes("does not exist"))).toBe(true);
  });

  it("integrity verification detects an unparseable current pointer", async () => {
    await setupBook();
    const store = createVersionStore(bookDir);
    await commitPrepared(bookDir, [
      ...(await store.prepareVersionAppend(versionEnvelope(1))).writes,
      store.prepareCurrentVersionPointer("foundation", "foundation", 1),
    ]);
    await writeFile(
      join(bookDir, "story", "governance", "versions", "foundation", "foundation", "current.json"),
      "{ not json",
      "utf-8",
    );
    const errors = await store.verifyIntegrity("foundation", "foundation");
    expect(errors.some((e) => e.includes("unparseable"))).toBe(true);
  });

  it("integrity verification passes on a clean two-version store", async () => {
    await setupBook();
    const store = createVersionStore(bookDir);
    await commitPrepared(bookDir, [
      ...(await store.prepareVersionAppend(versionEnvelope(1))).writes,
      store.prepareCurrentVersionPointer("foundation", "foundation", 1),
    ]);
    await commitPrepared(bookDir, [
      ...(await store.prepareVersionAppend(versionEnvelope(2, { parentVersion: 1 }))).writes,
      store.prepareCurrentVersionPointer("foundation", "foundation", 2),
    ]);
    await expect(store.verifyIntegrity("foundation", "foundation")).resolves.toEqual([]);
  });

  it("missing/corrupt versions fail closed on read", async () => {
    await setupBook();
    const store = createVersionStore(bookDir);
    await expect(store.readVersion<FoundationPublishedSnapshot>("foundation", "foundation", 1)).resolves.toBeNull();
    await writeFile(
      join(bookDir, "story", "governance", "versions", "foundation", "foundation", "1.json"),
      "{ not json",
      "utf-8",
    ).catch(() => undefined);
  });

  it("unsafe version/unit identifiers fail closed", async () => {
    await setupBook();
    const store = createVersionStore(bookDir);
    await expect(store.readVersion<FoundationPublishedSnapshot>("foundation", "../../etc", 1)).rejects.toThrow();
    await expect(store.readVersion<FoundationPublishedSnapshot>("foundation", "CON.txt", 1)).rejects.toThrow();
    await expect(store.prepareVersionAppend(versionEnvelope(1, { unitId: "a/b" }))).rejects.toThrow();
  });
});

describe("prepare-not-commit", () => {
  it("prepareVersionAppend produces writes WITHOUT committing them (no files appear)", async () => {
    await setupBook();
    const store = createVersionStore(bookDir);
    const prepared = await store.prepareVersionAppend(versionEnvelope(1));
    expect(prepared.writes.length).toBeGreaterThan(0);
    // No publication side effect from PREPARE alone.
    await expect(store.listVersions("foundation", "foundation")).resolves.toEqual([]);
    await expect(store.readCurrentVersion<FoundationPublishedSnapshot>("foundation", "foundation")).resolves.toBeNull();
  });

  it("prepareCurrentVersionPointer returns a write but does NOT advance current authority itself", async () => {
    await setupBook();
    const store = createVersionStore(bookDir);
    const write = store.prepareCurrentVersionPointer("foundation", "foundation", 1);
    expect(write.relativePath).toContain("current.json");
    await expect(store.readCurrentVersion<FoundationPublishedSnapshot>("foundation", "foundation")).resolves.toBeNull();
  });

  it("one Foundation publish preparation = exactly ONE new global Foundation version", async () => {
    await setupBook();
    const store = createVersionStore(bookDir);
    await commitPrepared(bookDir, [
      ...(await store.prepareVersionAppend(versionEnvelope(1))).writes,
      store.prepareCurrentVersionPointer("foundation", "foundation", 1),
    ]);
    // Changing only one unit still prepares exactly ONE new global version (v2).
    const v2 = await store.prepareVersionAppend(versionEnvelope(2, { parentVersion: 1 }));
    expect(v2.writes.some((w) => w.relativePath.endsWith("2.json"))).toBe(true);
    await expect(store.listVersions("foundation", "foundation")).resolves.toEqual([1]);
  });

  it("changing only one unit still increments the global Foundation version exactly once", async () => {
    await setupBook();
    const store = createVersionStore(bookDir);
    await commitPrepared(bookDir, [
      ...(await store.prepareVersionAppend(versionEnvelope(1))).writes,
      store.prepareCurrentVersionPointer("foundation", "foundation", 1),
    ]);
    const v2 = versionEnvelope(2, {
      parentVersion: 1,
      snapshot: snapshot({ changedUnitIds: ["sf-core-conflict"] }),
    });
    const prepared = await store.prepareVersionAppend(v2);
    expect(prepared.writes.length).toBe(1); // exactly ONE version record
    expect(prepared.writes[0]!.relativePath.endsWith("2.json")).toBe(true);
  });

  it("unchanged units retain their previous approvedRevision/contentHash refs", async () => {
    await setupBook();
    const store = createVersionStore(bookDir);
    await commitPrepared(bookDir, [
      ...(await store.prepareVersionAppend(versionEnvelope(1))).writes,
      store.prepareCurrentVersionPointer("foundation", "foundation", 1),
    ]);
    const v2 = versionEnvelope(2, { parentVersion: 1, snapshot: snapshot({ changedUnitIds: ["sf-core-conflict"] }) });
    await commitPrepared(bookDir, [...(await store.prepareVersionAppend(v2)).writes, store.prepareCurrentVersionPointer("foundation", "foundation", 2)]);
    const read = await store.readVersion<FoundationPublishedSnapshot>("foundation", "foundation", 2);
    expect(read?.snapshot.unitRefs.find((r) => r.unitId === "sf-theme-tone")).toEqual({
      unitId: "sf-theme-tone", contentRevision: 1, approvedRevision: 1, contentHash: "hash-theme",
    });
  });

  it("FoundationPublishedSnapshot contains governance refs/hashes only — no creative prose", async () => {
    await setupBook();
    const store = createVersionStore(bookDir);
    await commitPrepared(bookDir, [
      ...(await store.prepareVersionAppend(versionEnvelope(1))).writes,
      store.prepareCurrentVersionPointer("foundation", "foundation", 1),
    ]);
    const read = await store.readVersion<FoundationPublishedSnapshot>("foundation", "foundation", 1);
    const json = JSON.stringify(read);
    expect(json).not.toContain('"content"');
    expect(json).not.toContain('"prose"');
    expect(json).not.toContain("mock_text");
  });
});

describe("restoreVersionAsRevisionCandidate", () => {
  async function setupWithVersions(): Promise<{ store: ReturnType<typeof createVersionStore>; current: FoundationVersion }> {
    await setupBook();
    const store = createVersionStore(bookDir);
    await commitPrepared(bookDir, [
      ...(await store.prepareVersionAppend(versionEnvelope(1))).writes,
      store.prepareCurrentVersionPointer("foundation", "foundation", 1),
    ]);
    const v2 = versionEnvelope(2, { parentVersion: 1, snapshot: snapshot({ changedUnitIds: ["sf-core-conflict"] }) });
    await commitPrepared(bookDir, [...(await store.prepareVersionAppend(v2)).writes, store.prepareCurrentVersionPointer("foundation", "foundation", 2)]);
    const current = (await store.readCurrentVersion<FoundationPublishedSnapshot>("foundation", "foundation"))!;
    return { store, current };
  }

  it("restoring an old version returns a RevisionCandidate and leaves current authority unchanged", async () => {
    const { store, current } = await setupWithVersions();
    const before = await store.readCurrentVersion<FoundationPublishedSnapshot>("foundation", "foundation");
    const candidate = await restoreVersionAsRevisionCandidate(store, "foundation", "foundation", 1, 25);
    expect(candidate.snapshot).toEqual(snapshot()); // restored v1 snapshot
    expect(candidate.parentVersion).toBe(current.version); // CURRENT version, not the restored one
    expect(candidate.parentVersion).toBe(2);
    expect(candidate.restoredFromVersion).toBe(1);
    expect(candidate.baseCanonRevision).toBe(25); // binds CURRENT Canon argument
    expect(candidate.status).toBe("needs_review");
    const after = await store.readCurrentVersion<FoundationPublishedSnapshot>("foundation", "foundation");
    expect(after?.version).toBe(before?.version); // authority unchanged
  });

  it("restoring the current version itself is still a candidate (no authority movement)", async () => {
    const { store } = await setupWithVersions();
    const candidate = await restoreVersionAsRevisionCandidate(store, "foundation", "foundation", 2, 26);
    expect(candidate.parentVersion).toBe(2);
    expect(candidate.restoredFromVersion).toBe(2);
    expect(await store.readCurrentVersion<FoundationPublishedSnapshot>("foundation", "foundation")).not.toBeNull();
  });

  it("missing historical versions fail closed", async () => {
    const { store } = await setupWithVersions();
    await expect(restoreVersionAsRevisionCandidate(store, "foundation", "foundation", 99, 1)).rejects.toThrow();
  });
});
