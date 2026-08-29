import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bootstrapFoundation,
  deleteUpgradeCandidate,
  loadUpgradeCandidate,
  prepareFoundationV2Upgrade,
} from "../foundation/bootstrap.js";
import { readUnitManifests } from "../foundation/manifest.js";
import { SafeGovernanceIdSchema } from "../governance/contracts.js";

let root = "";
let bookDir = "";

async function setupLegacyBook(governance?: Record<string, string>): Promise<void> {
  root = await mkdtemp(join(tmpdir(), "castor-bootstrap-"));
  bookDir = join(root, "books", "bootstrap-book");
  await mkdir(join(bookDir, "story", "outline"), { recursive: true });
  await mkdir(join(bookDir, "story", "roles", "major"), { recursive: true });
  await mkdir(join(bookDir, "story", "roles", "主要角色"), { recursive: true });
  await mkdir(join(bookDir, "story", "state"), { recursive: true });
  await writeFile(
    join(bookDir, "book.json"),
    JSON.stringify({
      id: "bootstrap-book",
      title: "Bootstrap Book",
      platform: "tomato",
      genre: "xuanhuan",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      ...(governance ? { governance } : {}),
    }),
    "utf-8",
  );
  await writeFile(
    join(bookDir, "story", "outline", "story_frame.md"),
    [
      "## 主题与基调",
      "主题段落：命运与选择。",
      "",
      "## 核心冲突",
      "冲突段落：家族债务与个人自由。",
      "",
      "## 世界观底色",
      "世界段落：河港城，商会与帮派。",
      "",
      "## 终局方向",
      "结局段落：主角在平衡中收束。",
      "",
    ].join("\n"),
    "utf-8",
  );
  await writeFile(
    join(bookDir, "story", "outline", "volume_map.md"),
    "## 卷一\n第一卷追出站台背后的旧案。\n",
    "utf-8",
  );
  await writeFile(
    join(bookDir, "story", "book_rules.md"),
    [
      "## 主角",
      "- 名字：林辞",
      "",
      "## 数值/资源规则",
      "- 核心资源：灵石",
      "- 硬上限：筑基不可突破",
      "",
      "## 禁止事项",
      "- 不得破坏核心世界观",
      "",
    ].join("\n"),
    "utf-8",
  );
  await writeFile(
    join(bookDir, "story", "pending_hooks.md"),
    [
      "| hook_id | 起始章节 | 类型 | 状态 |",
      "| --- | --- | --- | --- |",
      "| H01 | 1 | 主线 | 未开启 |",
      "| H02 | 3 | 支线 | 未开启 |",
      "",
    ].join("\n"),
    "utf-8",
  );
  await writeFile(join(bookDir, "story", "roles", "major", "LinYue.md"), "## 核心标签\n冷静、执着\n", "utf-8");
  await writeFile(join(bookDir, "story", "roles", "主要角色", "林辞.md"), "## 核心标签\n沉稳、果决\n", "utf-8");
  await mkdir(join(bookDir, "chapters"), { recursive: true });
  await writeFile(
    join(bookDir, "chapters", "0003_第三章.md"),
    "第三章正文：债务与选择。\n",
    "utf-8",
  );
  await writeFile(
    join(bookDir, "story", "state", "manifest.json"),
    JSON.stringify({
      schemaVersion: 2,
      language: "zh",
      lastAppliedChapter: 3,
      projectionVersion: 1,
      migrationWarnings: [],
    }),
    "utf-8",
  );
}

async function snapshotFingerprint(): Promise<Record<string, string>> {
  const files = [
    join(bookDir, "book.json"),
    join(bookDir, "chapters", "0003_第三章.md"),
    join(bookDir, "story", "outline", "story_frame.md"),
    join(bookDir, "story", "outline", "volume_map.md"),
    join(bookDir, "story", "book_rules.md"),
    join(bookDir, "story", "pending_hooks.md"),
    join(bookDir, "story", "roles", "major", "LinYue.md"),
    join(bookDir, "story", "roles", "主要角色", "林辞.md"),
    join(bookDir, "story", "state", "manifest.json"),
  ];
  const out: Record<string, string> = {};
  for (const file of files) {
    out[file.replace(root, "<root>")] = await readFile(file, "utf-8");
  }
  return out;
}

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = "";
    bookDir = "";
  }
});

describe("bootstrapFoundation — legacy book", () => {
  it("materializes legacy_established units that are NEVER approved", async () => {
    await setupLegacyBook();
    const result = await bootstrapFoundation(bookDir);
    expect(result.mode).toBe("legacy");
    expect(result.units.length).toBeGreaterThan(0);
    for (const unit of result.units) {
      expect(unit.status).toBe("legacy_established");
      expect(unit.approvedRevision).toBeUndefined();
      expect(unit.importance).toBeTruthy();
    }
  });

  it("maps Story Frame into four independent logical units", async () => {
    await setupLegacyBook();
    const result = await bootstrapFoundation(bookDir);
    const storyFrameUnits = result.units.filter((unit) => unit.kind === "story_frame");
    expect(storyFrameUnits.map((unit) => (unit.locator as { sectionKey?: string }).sectionKey).sort())
      .toEqual(["core_conflict", "ending_direction", "theme_tone", "world_setting"]);
    expect(storyFrameUnits.every((unit) => unit.locator.sourceRelPath === "story/outline/story_frame.md")).toBe(true);
    expect(storyFrameUnits.every((unit) => unit.importance === "required")).toBe(true);
  });

  it("bootstraps the real Book Rule heading containing '/'", async () => {
    await setupLegacyBook();
    const result = await bootstrapFoundation(bookDir);
    const rules = result.units.filter((unit) => unit.kind === "book_rule");
    const locators = rules.map((unit) => (unit.locator as { ruleId?: string }).ruleId);
    expect(locators).toContain("数值/资源规则");
    for (const unit of rules) {
      expect(SafeGovernanceIdSchema.safeParse(unit.unitId).success).toBe(true);
      expect(unit.unitId).not.toBe((unit.locator as { ruleId?: string }).ruleId); // unitId never the raw heading
    }
  });

  it("uses whole_file for Volume Map, never a pipe-table entry", async () => {
    await setupLegacyBook();
    const result = await bootstrapFoundation(bookDir);
    const arc = result.units.find((unit) => unit.kind === "arc_direction");
    expect(arc).toBeDefined();
    expect(arc?.locator.contentKind).toBe("whole_file");
    expect(arc?.locator.sourceRelPath).toBe("story/outline/volume_map.md");
  });

  it("keeps every generated unitId a SafeGovernanceId", async () => {
    await setupLegacyBook();
    const result = await bootstrapFoundation(bookDir);
    for (const unit of result.units) {
      expect(SafeGovernanceIdSchema.safeParse(unit.unitId).success, unit.unitId).toBe(true);
    }
  });
});

describe("prepareFoundationV2Upgrade — durable, non-authoritative candidate", () => {
  it("returns a durable 'prepared' candidate that reloads by candidateId and survives restart", async () => {
    await setupLegacyBook();
    const candidate = await prepareFoundationV2Upgrade(bookDir);
    expect(candidate.status).toBe("prepared");
    expect(SafeGovernanceIdSchema.safeParse(candidate.candidateId).success).toBe(true);
    expect(candidate.canonRevision).toBe(3);
    // reload from persistence (simulates process restart)
    const reloaded = await loadUpgradeCandidate(bookDir, candidate.candidateId);
    expect(reloaded).toEqual(candidate);
    expect(reloaded.revisionDraft.length).toBeGreaterThan(0);
    // delete works
    await deleteUpgradeCandidate(bookDir, candidate.candidateId);
    await expect(loadUpgradeCandidate(bookDir, candidate.candidateId)).rejects.toThrow();
  });

  it("rejects unsafe candidate ids at the load boundary", async () => {
    await setupLegacyBook();
    await expect(loadUpgradeCandidate(bookDir, "../../etc/passwd")).rejects.toThrow();
    await expect(loadUpgradeCandidate(bookDir, "CON.txt")).rejects.toThrow();
  });

  it("preparing a candidate creates ZERO authority side effects", async () => {
    await setupLegacyBook();
    const before = await snapshotFingerprint();
    await prepareFoundationV2Upgrade(bookDir);
    const after = await snapshotFingerprint();
    expect(after).toEqual(before); // book.json, chapters, Canon manifest, all Markdown unchanged
    // no Published Foundation manifests appeared
    await expect(readUnitManifests(bookDir)).resolves.toEqual(new Map());
  });

  it("candidate contains no creative prose / shadow content", async () => {
    await setupLegacyBook();
    const candidate = await prepareFoundationV2Upgrade(bookDir);
    const json = JSON.stringify(candidate);
    expect(json).not.toContain("主题段落");
    expect(json).not.toContain("核心资源：灵石");
    expect(json).not.toContain('"content"');
  });
});

describe("governance mode handling", () => {
  it("explicit foundation=v2 does NOT run the legacy bootstrap path", async () => {
    await setupLegacyBook({ foundation: "v2", planning: "legacy" });
    const result = await bootstrapFoundation(bookDir);
    expect(result.mode).toBe("v2");
    // no legacy_established units synthesized from the legacy Markdown
    expect(result.units.every((unit) => unit.status !== "legacy_established")).toBe(true);
    expect(result.upgradeCandidateReady).toBe(false);
  });

  it("unknown governance marker fails closed", async () => {
    await setupLegacyBook({ foundation: "v3" } as never);
    await expect(bootstrapFoundation(bookDir)).rejects.toThrow();
    await expect(prepareFoundationV2Upgrade(bookDir)).rejects.toThrow();
  });

  it("preparing an upgrade on an already-v2 book fails closed", async () => {
    await setupLegacyBook({ foundation: "v2", planning: "v2" });
    await expect(prepareFoundationV2Upgrade(bookDir)).rejects.toThrow();
  });
});
