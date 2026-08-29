import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  declareDependency,
  invalidateDirectDependents,
  validateDependencyGraph,
} from "../governance/dependencies.js";
import { readUnitManifests, writeUnitManifest } from "../foundation/manifest.js";
import { FoundationUnitManifest, FoundationUnitManifestSchema } from "../foundation/manifest.js";

let root = "";
let bookDir = "";

async function setupBook(units: ReadonlyArray<FoundationUnitManifest>): Promise<void> {
  root = await mkdtemp(join(tmpdir(), "castor-deps-"));
  bookDir = join(root, "books", "deps-book");
  await mkdir(join(bookDir, "story", "outline"), { recursive: true });
  await writeFile(join(bookDir, "story", "outline", "story_frame.md"), "## 主题与基调\nA\n\n## 核心冲突\nB\n\n## 世界观底色\nC\n\n## 终局方向\nD\n", "utf-8");
  for (const unit of units) {
    await writeUnitManifest(bookDir, unit);
  }
}

function unit(unitId: string, overrides: Record<string, unknown> = {}): FoundationUnitManifest {
  return FoundationUnitManifestSchema.parse({
    unitId,
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

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = "";
    bookDir = "";
  }
});

describe("declareDependency", () => {
  it("accepts Core-owned dependency kinds and rejects unknown kinds at runtime", () => {
    expect(() => declareDependency("u-a", "requires_character", "char-x")).not.toThrow();
    expect(() => declareDependency("u-a", "uses_hook", "hook-h1")).not.toThrow();
    // Unknown kind cannot enter through the runtime boundary.
    expect(() => declareDependency("u-a", "invented_kind" as never, "char-x")).toThrow();
  });
});

describe("validateDependencyGraph", () => {
  it("rejects dependency cycles (fail closed)", () => {
    const a = unit("u-a", { dependencies: [{ kind: "uses_hook", targetUnitId: "u-b" }] });
    const b = unit("u-b", { dependencies: [{ kind: "uses_hook", targetUnitId: "u-a" }] });
    const errors = validateDependencyGraph([a, b]);
    expect(errors.some((error) => /cycle/i.test(error))).toBe(true);
  });

  it("rejects dangling targets (unknown-kind entries are structurally impossible via the manifest schema)", () => {
    const dangling = unit("u-a", { dependencies: [{ kind: "uses_hook", targetUnitId: "ghost" }] });
    expect(validateDependencyGraph([dangling]).some((e) => /missing/i.test(e))).toBe(true);
  });

  it("accepts a clean acyclic graph", () => {
    const a = unit("u-a");
    const b = unit("u-b", { dependencies: [{ kind: "uses_hook", targetUnitId: "u-a" }] });
    const c = unit("u-c", { dependencies: [{ kind: "uses_hook", targetUnitId: "u-b" }] });
    expect(validateDependencyGraph([a, b, c])).toEqual([]);
  });
});

describe("invalidateDirectDependents — DIRECT-ONLY (A → B → C)", () => {
  it("invalidating A makes B stale but C stays NON-stale", async () => {
    await setupBook([
      unit("u-a"),
      unit("u-b", { dependencies: [{ kind: "uses_hook", targetUnitId: "u-a" }] }),
      unit("u-c", { dependencies: [{ kind: "uses_hook", targetUnitId: "u-b" }] }),
    ]);
    const marked = await invalidateDirectDependents(bookDir, "u-a");
    expect(marked).toContain("u-b");
    expect(marked).not.toContain("u-c");
    const manifests = await readUnitManifests(bookDir);
    expect(manifests.get("u-b")?.status).toBe("stale");
    expect(manifests.get("u-c")?.status).toBe("approved");
  });

  it("a later authoritative B change can invalidate C directly", async () => {
    await setupBook([
      unit("u-a"),
      unit("u-b", { dependencies: [{ kind: "uses_hook", targetUnitId: "u-a" }] }),
      unit("u-c", { dependencies: [{ kind: "uses_hook", targetUnitId: "u-b" }] }),
    ]);
    await invalidateDirectDependents(bookDir, "u-a");
    // B's own authoritative content actually changes (contentRevision bump);
    // invalidating B directly then stales C.
    const b = (await readUnitManifests(bookDir)).get("u-b")!;
    await writeUnitManifest(bookDir, { ...b, contentRevision: b.contentRevision + 1, status: "needs_review" });
    const marked = await invalidateDirectDependents(bookDir, "u-b");
    expect(marked).toContain("u-c");
    expect((await readUnitManifests(bookDir)).get("u-c")?.status).toBe("stale");
  });

  it("unrelated units remain unchanged", async () => {
    await setupBook([
      unit("u-a"),
      unit("u-b", { dependencies: [{ kind: "uses_hook", targetUnitId: "u-a" }] }),
      unit("u-x", { unitId: "u-x" }),
    ]);
    await invalidateDirectDependents(bookDir, "u-a");
    expect((await readUnitManifests(bookDir)).get("u-x")?.status).toBe("approved");
  });

  it("invalidating a unit with no dependents marks nothing", async () => {
    await setupBook([unit("u-a"), unit("u-b")]);
    const marked = await invalidateDirectDependents(bookDir, "u-b");
    expect(marked).toEqual([]);
  });

  it("invalidating twice is idempotent — the second call marks nothing new", async () => {
    await setupBook([
      unit("u-a"),
      unit("u-b", { dependencies: [{ kind: "uses_hook", targetUnitId: "u-a" }] }),
    ]);
    const first = await invalidateDirectDependents(bookDir, "u-a");
    const second = await invalidateDirectDependents(bookDir, "u-a");
    expect(first).toEqual(["u-b"]);
    expect(second).toEqual([]);
    expect((await readUnitManifests(bookDir)).get("u-b")?.status).toBe("stale");
  });

  it("invalidation does NOT modify Markdown or Canon", async () => {
    await setupBook([
      unit("u-a"),
      unit("u-b", { dependencies: [{ kind: "uses_hook", targetUnitId: "u-a" }] }),
    ]);
    const framePath = join(bookDir, "story", "outline", "story_frame.md");
    const before = await readFile(framePath, "utf-8");
    await invalidateDirectDependents(bookDir, "u-a");
    expect(await readFile(framePath, "utf-8")).toBe(before);
  });
});
