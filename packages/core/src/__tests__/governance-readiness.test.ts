import { describe, expect, it } from "vitest";
import { afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateChapter1Readiness, evaluateFoundationReadiness } from "../governance/readiness.js";
import { FoundationUnitManifest, FoundationUnitManifestSchema } from "../foundation/manifest.js";
import { writeUnitManifest } from "../foundation/manifest.js";

function unit(overrides: Record<string, unknown> = {}): FoundationUnitManifest {
  return FoundationUnitManifestSchema.parse({
    unitId: "u-1",
    kind: "story_frame",
    importance: "required",
    status: "approved",
    locator: { contentKind: "section", sourceRelPath: "story/outline/story_frame.md", sectionKey: "theme_tone" },
    contentHash: "abc123",
    contentRevision: 1,
    approvedRevision: 1,
    dependencies: [],
    ...overrides,
  });
}

const notReady: (u: FoundationUnitManifest) => boolean = (u) =>
  u.status !== "approved" || u.approvedRevision !== u.contentRevision;

// keep notReady referenced in a way that documents the readiness predicate
describe("readiness predicate", () => {
  it("documents that approved requires matching revisions", () => {
    expect(notReady(unit({ status: "approved", approvedRevision: 1 }))).toBe(false);
    // An approved unit with a mismatch is STRUCTURALLY impossible (Task 2 schema
    // rejects it); the honest expression is a needs_review unit whose approved
    // revision lags the current content revision.
    expect(notReady(unit({ status: "needs_review", contentRevision: 2, approvedRevision: 1 }))).toBe(true);
  });
});

describe("evaluateFoundationReadiness", () => {
  it("a required unit whose declared dependency target is MISSING blocks readiness", async () => {
    const report = await evaluateFoundationReadiness("/unused", [
      unit({ unitId: "sf-theme-tone", dependencies: [{ kind: "uses_hook", targetUnitId: "hook-ghost" }] }),
      unit({ unitId: "char-protagonist", kind: "character", importance: "required" }),
    ]);
    expect(report.blockingReasons.length).toBeGreaterThan(0);
  });

  it("a required draft/needs_review/stale unit blocks readiness", async () => {
    for (const status of ["draft", "needs_review", "stale"] as const) {
      const report = await evaluateFoundationReadiness("/unused", [unit({ status })]);
      expect(report.blockingReasons.length).toBeGreaterThan(0);
    }
  });

  it("a valid approved required unit does not block readiness", async () => {
    const report = await evaluateFoundationReadiness("/unused", [
      unit({ unitId: "sf-theme-tone" }),
      unit({ unitId: "char-protagonist", kind: "character", importance: "required" }),
    ]);
    expect(report.blockingReasons).toEqual([]);
  });

  it("approvedRevision lagging contentRevision fails readiness", async () => {
    // A unit that was approved at revision 1 whose content moved to revision 2
    // is structurally needs_review (Task 2 schema forbids approved with a
    // mismatch) and must block readiness.
    const report = await evaluateFoundationReadiness("/unused", [
      unit({ unitId: "u-b", status: "needs_review", contentRevision: 2, approvedRevision: 1 }),
      unit({ unitId: "char-protagonist", kind: "character", importance: "required" }),
    ]);
    expect(report.blockingReasons.length).toBeGreaterThan(0);
  });

  it("an optional unreferenced unit does not block readiness", async () => {
    const report = await evaluateFoundationReadiness("/unused", [
      unit({ unitId: "sf-theme-tone" }),
      unit({ unitId: "char-protagonist", kind: "character", importance: "required" }),
      unit({ unitId: "char-extra", kind: "character", importance: "optional", status: "draft" }),
    ]);
    expect(report.blockingReasons).toEqual([]);
  });

  it("an optional unit that a required unit depends on blocks readiness", async () => {
    const report = await evaluateFoundationReadiness("/unused", [
      unit({ unitId: "sf-theme-tone", dependencies: [{ kind: "uses_hook", targetUnitId: "hook-mentor" }] }),
      unit({ unitId: "char-protagonist", kind: "character", importance: "required" }),
      unit({ unitId: "hook-mentor", kind: "foundation_hook", importance: "optional", status: "draft" }),
    ]);
    expect(report.blockingReasons.length).toBeGreaterThan(0);
  });

  it("protagonist is always required — no required character unit blocks readiness", async () => {
    const report = await evaluateFoundationReadiness("/unused", [
      unit({ unitId: "sf-theme-tone" }),
      unit({ unitId: "char-x", kind: "character", importance: "optional", status: "approved" }),
    ]);
    expect(report.blockingReasons.length).toBeGreaterThan(0);
    expect(report.nextRecommendedAction).toContain("protagonist");
  });

  it("legacy_established is never treated as approved", async () => {
    const report = await evaluateFoundationReadiness("/unused", [
      unit({ unitId: "sf-theme-tone", status: "legacy_established" }),
      unit({ unitId: "char-protagonist", kind: "character", importance: "required" }),
    ]);
    expect(report.blockingReasons.length).toBeGreaterThan(0);
  });

  it("readiness returns a recommended next action", async () => {
    const report = await evaluateFoundationReadiness("/unused", [
      unit({ unitId: "sf-theme-tone", status: "draft" }),
    ]);
    expect(report.nextRecommendedAction).toBeTruthy();
    expect(Array.isArray(report.warnings)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// evaluateChapter1Readiness — loads real book state (V2 manifests or legacy
// bootstrap) and enforces the §3.6 authority set.
// ---------------------------------------------------------------------------

let c1Root = "";
let c1BookDir = "";

async function setupChapter1Book(units: ReadonlyArray<FoundationUnitManifest>, legacyMarkdown = false): Promise<void> {
  c1Root = await mkdtemp(join(tmpdir(), "castor-c1-"));
  c1BookDir = join(c1Root, "books", "c1-book");
  await mkdir(join(c1BookDir, "story", "outline"), { recursive: true });
  await mkdir(join(c1BookDir, "story", "state"), { recursive: true });
  if (legacyMarkdown) {
    await writeFile(join(c1BookDir, "story", "outline", "story_frame.md"), "## A\n1\n\n## B\n2\n\n## C\n3\n\n## D\n4\n", "utf-8");
    await writeFile(join(c1BookDir, "story", "outline", "volume_map.md"), "## 卷一\n卷。\n", "utf-8");
    await writeFile(join(c1BookDir, "story", "book_rules.md"), "## 主角\n- 名字：X\n", "utf-8");
    await writeFile(join(c1BookDir, "story", "pending_hooks.md"), "| hook_id |\n| --- |\n| H1 |\n", "utf-8");
    await writeFile(join(c1BookDir, "book.json"), JSON.stringify({ id: "c1-book", title: "C1", platform: "tomato", genre: "xuanhuan", status: "active", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }), "utf-8");
  } else {
    for (const manifest of units) {
      await writeUnitManifest(c1BookDir, manifest);
    }
  }
}

afterEach(() => {
  if (c1Root) {
    void rm(c1Root, { recursive: true, force: true });
    c1Root = "";
    c1BookDir = "";
  }
});

const c1AuthoritySet = [
  { unitId: "sf-theme-tone", locator: { contentKind: "section", sourceRelPath: "story/outline/story_frame.md", sectionKey: "theme_tone" } },
  { unitId: "sf-core-conflict", locator: { contentKind: "section", sourceRelPath: "story/outline/story_frame.md", sectionKey: "core_conflict" } },
  { unitId: "sf-world-setting", locator: { contentKind: "section", sourceRelPath: "story/outline/story_frame.md", sectionKey: "world_setting" } },
  { unitId: "sf-ending-direction", locator: { contentKind: "section", sourceRelPath: "story/outline/story_frame.md", sectionKey: "ending_direction" } },
  { unitId: "arc-direction", locator: { contentKind: "whole_file", sourceRelPath: "story/outline/volume_map.md" } },
] as const;

function chapter1Units(overrides: Record<string, unknown> = {}): ReadonlyArray<FoundationUnitManifest> {
  return [
    ...c1AuthoritySet.map((entry) => unit({ ...entry, ...overrides })),
    unit({ unitId: "char-protagonist", kind: "character", importance: "required", ...overrides }),
  ];
}

describe("evaluateChapter1Readiness", () => {
  it("a full approved V2 authority set passes with no blockers", async () => {
    await setupChapter1Book(chapter1Units());
    const report = await evaluateChapter1Readiness(c1BookDir);
    expect(report.blockingReasons).toEqual([]);
  });

  it("a missing authority member blocks", async () => {
    const units = chapter1Units().filter((manifest) => manifest.unitId !== "arc-direction");
    await setupChapter1Book(units);
    const report = await evaluateChapter1Readiness(c1BookDir);
    expect(report.blockingReasons.some((reason) => reason.includes("arc-direction"))).toBe(true);
  });

  it("a non-approved authority member blocks", async () => {
    const units = chapter1Units().map((manifest) =>
      manifest.unitId === "sf-theme-tone" ? { ...manifest, status: "draft" as const } : manifest);
    await setupChapter1Book(units);
    const report = await evaluateChapter1Readiness(c1BookDir);
    expect(report.blockingReasons.some((reason) => reason.includes("sf-theme-tone"))).toBe(true);
  });

  it("legacy bootstrap books block (legacy_established is never approved, protagonist required)", async () => {
    await setupChapter1Book([], true);
    const report = await evaluateChapter1Readiness(c1BookDir);
    expect(report.blockingReasons.length).toBeGreaterThan(0);
    expect(report.blockingReasons.some((reason) => /protagonist/i.test(reason))).toBe(true);
  });
});
