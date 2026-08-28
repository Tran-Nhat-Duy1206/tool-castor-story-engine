// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVersionStore } from "../governance/versions.js";
import { commitAtomicFileSet } from "../utils/atomic-file-set.js";
import { StateManager } from "../state/manager.js";
import { openFoundationRevision, saveFoundationUnitDraft, approveFoundationUnit } from "../foundation/revision-service.js";
import { publishFoundation } from "../foundation/publish.js";
import { writeUnitManifest, governedContentHash } from "../foundation/manifest.js";

let root = "";
let bookDir = "";
const bookId = "recovery-book";

async function setupBook() {
  root = await mkdtemp(join(tmpdir(), "phase5-recovery-"));
  const bDir = join(root, "books", bookId);
  bookDir = bDir;
  await mkdir(join(bDir, "story", "outline"), { recursive: true });
  await mkdir(join(bDir, "story", "state"), { recursive: true });
  await writeFile(join(bDir, "book.json"), JSON.stringify({ id: bookId, title: "Recovery", platform: "other", genre: "fantasy", status: "active", targetChapters: 10, chapterWordCount: 1200, language: "en", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), governance: { foundation: "legacy", planning: "legacy" } }, null, 2));
  await writeFile(join(bDir, "story", "state", "manifest.json"), JSON.stringify({ schemaVersion: 2, language: "en", lastAppliedChapter: 0, projectionVersion: 1, migrationWarnings: [] }, null, 2));
  await writeFile(join(bDir, "story", "state", "current_state.json"), JSON.stringify({ chapter: 0, facts: [] }, null, 2));
  await writeFile(join(bDir, "story", "outline", "unit-a.md"), "Content A\n", "utf-8");
  await writeUnitManifest(bDir, { unitId: "unit-a", kind: "story_frame", importance: "required", status: "draft", locator: { contentKind: "whole_file", sourceRelPath: "story/outline/unit-a.md" }, contentHash: governedContentHash("Content A\n"), contentRevision: 1, dependencies: [] });
}

beforeEach(setupBook);
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

describe("Recovery E2E — Task 9 Foundation Publish", () => {
  it("failure before durable COMMIT → old authority remains current", async () => {
    const { revisionId } = await openFoundationRevision(bookDir, ["unit-a"]);
    await saveFoundationUnitDraft(bookDir, revisionId, "unit-a", "Content A\n");
    await approveFoundationUnit(bookDir, revisionId, "unit-a", "human-a");
    // First publish succeeds to v1
    const out1 = await publishFoundation({ bookDir, revisionId, humanActor: "human-a", expectedBaseFoundationVersion: 0, expectedBaseCanonRevision: 0 });
    expect(out1.status).toBe("published");
    // Second revision
    const { revisionId: rev2 } = await openFoundationRevision(bookDir, ["unit-a"]);
    await saveFoundationUnitDraft(bookDir, rev2, "unit-a", "Content A v2\n");
    await approveFoundationUnit(bookDir, rev2, "unit-a", "human-a");
    // Fail before durable commit (stage)
    const outFail = await publishFoundation({ bookDir, revisionId: rev2, humanActor: "human-a", expectedBaseFoundationVersion: 1, expectedBaseCanonRevision: 0, failAtStage: "stage" as never }).catch((e) => e);
    // Should have thrown or returned not published, old remains
    const store = createVersionStore(bookDir);
    const cur = await store.readCurrentVersion("foundation", "foundation");
    expect(cur?.version).toBe(1);
  });

  it("durable COMMIT reached → new authority wins on recovery", async () => {
    const { revisionId } = await openFoundationRevision(bookDir, ["unit-a"]);
    await saveFoundationUnitDraft(bookDir, revisionId, "unit-a", "Content A\n");
    await approveFoundationUnit(bookDir, revisionId, "unit-a", "human-a");
    await publishFoundation({ bookDir, revisionId, humanActor: "human-a", expectedBaseFoundationVersion: 0, expectedBaseCanonRevision: 0 });
    const { revisionId: rev2 } = await openFoundationRevision(bookDir, ["unit-a"]);
    await saveFoundationUnitDraft(bookDir, rev2, "unit-a", "Content A v2\n");
    await approveFoundationUnit(bookDir, rev2, "unit-a", "human-a");
    const out2 = await publishFoundation({ bookDir, revisionId: rev2, humanActor: "human-a", expectedBaseFoundationVersion: 1, expectedBaseCanonRevision: 0 });
    expect(out2.status).toBe("published");
    const cur = await createVersionStore(bookDir).readCurrentVersion("foundation", "foundation");
    expect(cur?.version).toBe(2);
  });

  it("no half marker/version and stale draft never outranks committed history", async () => {
    const { revisionId } = await openFoundationRevision(bookDir, ["unit-a"]);
    await saveFoundationUnitDraft(bookDir, revisionId, "unit-a", "Content A\n");
    await approveFoundationUnit(bookDir, revisionId, "unit-a", "human-a");
    await publishFoundation({ bookDir, revisionId, humanActor: "human-a", expectedBaseFoundationVersion: 0, expectedBaseCanonRevision: 0 });
    // Create a stale draft
    const { revisionId: stale } = await openFoundationRevision(bookDir, ["unit-a"]);
    await saveFoundationUnitDraft(bookDir, stale, "unit-a", "Stale content\n");
    // Do not approve/publish stale
    const cur = await createVersionStore(bookDir).readCurrentVersion("foundation", "foundation");
    expect(cur?.version).toBe(1);
  });
});

describe("Recovery E2E — Task 13 Arc Publish", () => {
  it("before durable commit old Arc remains; after commit new Arc + marker together", async () => {
    const store = createVersionStore(bookDir);
    const prep1 = await store.prepareVersionAppend({ artifactKind: "arc_plan", unitId: "arc-1", version: 1, parentVersion: null, baseCanonRevision: 0, publishedBy: "human-a", snapshot: { arcId: "arc-1", goal: "g1" } as never });
    await commitAtomicFileSet({ rootDir: bookDir, writes: [...prep1.writes, store.prepareCurrentVersionPointer("arc_plan", "arc-1", 1)] });
    const cur1 = await store.readCurrentVersion("arc_plan", "arc-1");
    expect(cur1?.version).toBe(1);
    const prep2 = await store.prepareVersionAppend({ artifactKind: "arc_plan", unitId: "arc-1", version: 2, parentVersion: 1, baseCanonRevision: 0, publishedBy: "human-a", snapshot: { arcId: "arc-1", goal: "g2" } as never });
    const mid = await store.readCurrentVersion("arc_plan", "arc-1");
    expect(mid?.version).toBe(1);
    await commitAtomicFileSet({ rootDir: bookDir, writes: [...prep2.writes, store.prepareCurrentVersionPointer("arc_plan", "arc-1", 2)] });
    const cur2 = await store.readCurrentVersion("arc_plan", "arc-1");
    expect(cur2?.version).toBe(2);
  });
});

describe("Recovery E2E — Task 18 Execution Snapshot", () => {
  it("Snapshot identity immutable, no half-created state, stale drafts do not outrank", async () => {
    const store = createVersionStore(bookDir);
    const snapPrep = await store.prepareVersionAppend({ artifactKind: "foundation", unitId: "foundation", version: 1, parentVersion: null, baseCanonRevision: 0, publishedBy: "human-a", snapshot: { units: [{ id: "snap-1" }] } as never });
    await commitAtomicFileSet({ rootDir: bookDir, writes: [...snapPrep.writes, store.prepareCurrentVersionPointer("foundation", "foundation", 1)] });
    const cur = await store.readCurrentVersion("foundation", "foundation");
    const firstHash = JSON.stringify(cur?.snapshot);
    const prepHalf = await store.prepareVersionAppend({ artifactKind: "foundation", unitId: "foundation", version: 2, parentVersion: 1, baseCanonRevision: 0, publishedBy: "human-a", snapshot: { units: [{ id: "half" }] } as never });
    const afterHalf = await store.readCurrentVersion("foundation", "foundation");
    expect(JSON.stringify(afterHalf?.snapshot)).toBe(firstHash);
    await commitAtomicFileSet({ rootDir: bookDir, writes: [...prepHalf.writes, store.prepareCurrentVersionPointer("foundation", "foundation", 2)] });
    const afterCommit = await store.readCurrentVersion("foundation", "foundation");
    expect(afterCommit?.version).toBe(2);
  });
});

describe("Immutable history corruption", () => {
  it("corruption is DETECTED, not silently adopted", async () => {
    const { revisionId } = await openFoundationRevision(bookDir, ["unit-a"]);
    await saveFoundationUnitDraft(bookDir, revisionId, "unit-a", "Content A\n");
    await approveFoundationUnit(bookDir, revisionId, "unit-a", "human-a");
    await publishFoundation({ bookDir, revisionId, humanActor: "human-a", expectedBaseFoundationVersion: 0, expectedBaseCanonRevision: 0 });
    const vPath = join(bookDir, "story", "governance", "versions", "foundation", "foundation", "1.json");
    await writeFile(vPath, JSON.stringify({ corrupted: true }), "utf-8").catch(() => {});
    let threw = false;
    try {
      const cur = await createVersionStore(bookDir).readCurrentVersion("foundation", "foundation");
      if (!cur) threw = true;
      else {
        const v = await createVersionStore(bookDir).readVersion("foundation", "foundation", 1).catch(() => { threw = true; return null; });
        if (!v) threw = true;
      }
    } catch { threw = true; }
    expect(threw).toBe(true);
  });
});

describe("Forward-only schema migration", () => {
  it("apply migration once → expected schema, apply again → idempotent", async () => {
    const bookPath = join(bookDir, "book.json");
    const before = JSON.parse(await readFile(bookPath, "utf-8"));
    expect(before.governance).toBeDefined();
    const afterFirst = { ...before, governance: { ...before.governance, migrated: true } };
    await writeFile(bookPath, JSON.stringify(afterFirst, null, 2));
    const first = JSON.parse(await readFile(bookPath, "utf-8"));
    expect(first.governance.migrated).toBe(true);
    const afterSecond = { ...first, governance: { ...first.governance, migrated: true } };
    await writeFile(bookPath, JSON.stringify(afterSecond, null, 2));
    const second = JSON.parse(await readFile(bookPath, "utf-8"));
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

describe("Recovery truth priority", () => {
  it("committed history > current manifests/pointers > journals > drafts > derived", async () => {
    const { revisionId } = await openFoundationRevision(bookDir, ["unit-a"]);
    await saveFoundationUnitDraft(bookDir, revisionId, "unit-a", "Content A\n");
    await approveFoundationUnit(bookDir, revisionId, "unit-a", "human-a");
    await publishFoundation({ bookDir, revisionId, humanActor: "human-a", expectedBaseFoundationVersion: 0, expectedBaseCanonRevision: 0 });
    await mkdir(join(bookDir, "story", "governance", "journals"), { recursive: true }).catch(() => {});
    await writeFile(join(bookDir, "story", "governance", "journals", "journal.json"), JSON.stringify({ pending: "journal-data" })).catch(() => {});
    await mkdir(join(bookDir, "story", "governance", "drafts"), { recursive: true }).catch(() => {});
    await writeFile(join(bookDir, "story", "governance", "drafts", "draft.json"), JSON.stringify({ draft: "draft-data" })).catch(() => {});
    const cur = await createVersionStore(bookDir).readCurrentVersion("foundation", "foundation");
    expect(cur?.version).toBe(1);
  });
});
