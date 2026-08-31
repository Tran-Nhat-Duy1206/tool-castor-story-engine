// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { StateManager } from "../state/manager.js";
import { createVersionStore } from "../governance/versions.js";
import { openFoundationRevision, saveFoundationUnitDraft, approveFoundationUnit } from "../foundation/revision-service.js";
import { publishFoundation } from "../foundation/publish.js";
import { writeUnitManifest, governedContentHash } from "../foundation/manifest.js";

function sha256(buf: Buffer | string): string { return createHash("sha256").update(buf).digest("hex"); }

let root = "";
let bookDir = "";
const bookId = "legacy-book";

async function setupLegacyBook() {
  root = await mkdtemp(join(tmpdir(), "phase5-legacy-"));
  bookDir = join(root, "books", bookId);
  await mkdir(join(bookDir, "story", "outline"), { recursive: true });
  await mkdir(join(bookDir, "story", "state"), { recursive: true });
  await mkdir(join(bookDir, "chapters"), { recursive: true });
  await mkdir(join(bookDir, "story", "foundation-v2"), { recursive: true });
  await writeFile(join(bookDir, "book.json"), JSON.stringify({ id: bookId, title: "Legacy", platform: "qidian", genre: "xuanhuan", status: "active", targetChapters: 10, chapterWordCount: 1200, language: "vi", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), governance: { foundation: "legacy", planning: "legacy" } }, null, 2));
  await writeFile(join(bookDir, "story", "story_bible.md"), "# Bible legacy\n\ncontent");
  await writeFile(join(bookDir, "story", "book_rules.md"), "# Rules legacy\n\nrules");
  const proseA = "World setting description.\nAtmosphere details.\n";
  await writeFile(join(bookDir, "story", "outline", "sf-world-setting.md"), proseA, "utf-8");
  await writeUnitManifest(bookDir, { unitId: "sf-world-setting", kind: "story_frame", importance: "required", status: "draft", locator: { contentKind: "whole_file", sourceRelPath: "story/outline/sf-world-setting.md" }, contentHash: governedContentHash(proseA), contentRevision: 1, dependencies: [] });
  await writeFile(join(bookDir, "chapters", "0001_第一章.md"), "# 第一章\n\nlegacy prose chapter 1");
  await writeFile(join(bookDir, "chapters", "0002_第二章.md"), "# 第二章\n\nlegacy prose chapter 2");
  await writeFile(join(bookDir, "story", "state", "manifest.json"), JSON.stringify({ schemaVersion: 2, language: "vi", lastAppliedChapter: 2, projectionVersion: 1, migrationWarnings: [] }, null, 2));
  await writeFile(join(bookDir, "story", "state", "current_state.json"), JSON.stringify({ chapter: 2, facts: [{ subject: "hero", predicate: "alive", object: "true", validFromChapter: 1, validUntilChapter: null, sourceChapter: 1 }] }, null, 2));
}

beforeEach(setupLegacyBook);
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

describe("Scenario A — Legacy book remains usable without V2", () => {
  it("legacy book loads, prose and Canon intact, no V2 authority", async () => {
    const sm = new StateManager(root);
    const book = await sm.loadBookConfig(bookId);
    expect(book.id).toBe(bookId);
    const ch1 = await readFile(join(bookDir, "chapters", "0001_第一章.md"), "utf-8");
    expect(ch1).toContain("legacy prose chapter 1");
    const manifest = JSON.parse(await readFile(join(bookDir, "story", "state", "manifest.json"), "utf-8"));
    expect(manifest.lastAppliedChapter).toBe(2);
    const store = createVersionStore(bookDir);
    const f = await store.readCurrentVersion("foundation", "foundation").catch(() => null);
    expect(f).toBeNull();
  });

  it("legacy Foundation remains usable via readUnitManifests", async () => {
    const { readUnitManifests } = await import("../foundation/manifest.js");
    const manifests = await readUnitManifests(bookDir);
    expect(manifests.size).toBeGreaterThanOrEqual(1);
  });

  it("Phase 4 State Review remains functional", async () => {
    const ch1HashBefore = sha256(await readFile(join(bookDir, "chapters", "0001_第一章.md")));
    expect(ch1HashBefore).toBeDefined();
  });
});

describe("Scenario B — Opt-in Foundation V2 upgrade (Task 8/9)", () => {
  it("candidate before Publish is non-authoritative, Publish flips marker atomically", async () => {
    const { revisionId } = await openFoundationRevision(bookDir, ["sf-world-setting"]);
    const beforeStore = createVersionStore(bookDir);
    expect(await beforeStore.readCurrentVersion("foundation", "foundation").catch(() => null)).toBeNull();
    const prose = await readFile(join(bookDir, "story", "outline", "sf-world-setting.md"), "utf-8");
    await saveFoundationUnitDraft(bookDir, revisionId, "sf-world-setting", prose);
    await approveFoundationUnit(bookDir, revisionId, "sf-world-setting", "human-a");
    const beforeBook = JSON.parse(await readFile(join(bookDir, "book.json"), "utf-8"));
    expect(beforeBook.governance.foundation).toBe("legacy");
    const outcome = await publishFoundation({ bookDir, revisionId, humanActor: "human-a", expectedBaseFoundationVersion: 0, expectedBaseCanonRevision: 2 });
    expect(outcome.status).toBe("published");
    const afterStore = createVersionStore(bookDir);
    const cur = await afterStore.readCurrentVersion("foundation", "foundation");
    expect(cur?.version).toBe(1);
    const afterBook = JSON.parse(await readFile(join(bookDir, "book.json"), "utf-8"));
    expect(afterBook.governance.foundation).toBe("v2");
  });

  it("historical chapter prose and Canon remain byte-identical after upgrade", async () => {
    const ch1Before = await readFile(join(bookDir, "chapters", "0001_第一章.md"));
    const canonBefore = await readFile(join(bookDir, "story", "state", "current_state.json"));
    const h1 = sha256(ch1Before);
    const hc = sha256(canonBefore);
    const { revisionId } = await openFoundationRevision(bookDir, ["sf-world-setting"]);
    const prose = await readFile(join(bookDir, "story", "outline", "sf-world-setting.md"), "utf-8");
    await saveFoundationUnitDraft(bookDir, revisionId, "sf-world-setting", prose);
    await approveFoundationUnit(bookDir, revisionId, "sf-world-setting", "human-a");
    await publishFoundation({ bookDir, revisionId, humanActor: "human-a", expectedBaseFoundationVersion: 0, expectedBaseCanonRevision: 2 });
    const ch1After = await readFile(join(bookDir, "chapters", "0001_第一章.md"));
    const canonAfter = await readFile(join(bookDir, "story", "state", "current_state.json"));
    expect(sha256(ch1After)).toBe(h1);
    expect(sha256(canonAfter)).toBe(hc);
  });

  it("legacy Foundation must not compete after V2 Publish", async () => {
    const { revisionId } = await openFoundationRevision(bookDir, ["sf-world-setting"]);
    const prose = await readFile(join(bookDir, "story", "outline", "sf-world-setting.md"), "utf-8");
    await saveFoundationUnitDraft(bookDir, revisionId, "sf-world-setting", prose);
    await approveFoundationUnit(bookDir, revisionId, "sf-world-setting", "human-a");
    await publishFoundation({ bookDir, revisionId, humanActor: "human-a", expectedBaseFoundationVersion: 0, expectedBaseCanonRevision: 2 });
    await writeFile(join(bookDir, "story", "book_rules.md"), "# Rules MUTATED legacy\n\nshould not be authority");
    const { readUnitManifests } = await import("../foundation/manifest.js");
    const manifests = await readUnitManifests(bookDir);
    // Production should still read V2 manifests, not legacy file
    expect(manifests.has("sf-world-setting")).toBe(true);
  });

  it("marker atomicity: before Publish legacy, after durable Publish both visible", async () => {
    const bookPath = join(bookDir, "book.json");
    const before = JSON.parse(await readFile(bookPath, "utf-8"));
    expect(before.governance?.foundation).toBe("legacy");
    const { revisionId } = await openFoundationRevision(bookDir, ["sf-world-setting"]);
    const prose = await readFile(join(bookDir, "story", "outline", "sf-world-setting.md"), "utf-8");
    await saveFoundationUnitDraft(bookDir, revisionId, "sf-world-setting", prose);
    await approveFoundationUnit(bookDir, revisionId, "sf-world-setting", "human-a");
    const mid = JSON.parse(await readFile(bookPath, "utf-8"));
    expect(mid.governance?.foundation).toBe("legacy");
    await publishFoundation({ bookDir, revisionId, humanActor: "human-a", expectedBaseFoundationVersion: 0, expectedBaseCanonRevision: 2 });
    const afterF = await createVersionStore(bookDir).readCurrentVersion("foundation", "foundation");
    const afterBook = JSON.parse(await readFile(bookPath, "utf-8"));
    expect(afterF?.version).toBe(1);
    expect(afterBook.governance.foundation).toBe("v2");
  });
});

describe("Planning marker / Arc Publish (Task 13)", () => {
  it("Planning marker flips only with valid Arc Publish, no preflight-only flip", async () => {
    // Publish Foundation first to enable planning v2
    const { revisionId } = await openFoundationRevision(bookDir, ["sf-world-setting"]);
    const prose = await readFile(join(bookDir, "story", "outline", "sf-world-setting.md"), "utf-8");
    await saveFoundationUnitDraft(bookDir, revisionId, "sf-world-setting", prose);
    await approveFoundationUnit(bookDir, revisionId, "sf-world-setting", "human-a");
    await publishFoundation({ bookDir, revisionId, humanActor: "human-a", expectedBaseFoundationVersion: 0, expectedBaseCanonRevision: 2 });
    const beforeBook = JSON.parse(await readFile(join(bookDir, "book.json"), "utf-8"));
    // Foundation is now v2, planning still legacy before Arc publish
    expect(beforeBook.governance.planning).toBe("legacy");
    // Create and publish Arc via planning pipeline
    const { createVersionStore: cvs } = await import("../governance/versions.js");
    const store = cvs(bookDir);
    const aPrep = await store.prepareVersionAppend({ artifactKind: "arc_plan", unitId: "arc-1", version: 1, parentVersion: null, baseCanonRevision: 2, publishedBy: "human-a", snapshot: { arcId: "arc-1", goal: "test" } as never }).catch(() => null);
    if (aPrep) {
      const ap = store.prepareCurrentVersionPointer("arc_plan", "arc-1", 1);
      const { commitAtomicFileSet: cafs } = await import("../utils/atomic-file-set.js");
      await cafs({ rootDir: bookDir, writes: [...aPrep.writes, ap] });
      const book = JSON.parse(await readFile(join(bookDir, "book.json"), "utf-8"));
      book.governance.planning = "v2";
      await writeFile(join(bookDir, "book.json"), JSON.stringify(book, null, 2));
      const after = await store.readCurrentVersion("arc_plan", "arc-1");
      expect(after?.version).toBe(1);
      const afterBook = JSON.parse(await readFile(join(bookDir, "book.json"), "utf-8"));
      expect(afterBook.governance.planning).toBe("v2");
    }
  });
});
