import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FoundationUnitManifestSchema,
  isUnitApproved,
  readUnitManifests,
  unitContentEdited,
  writeUnitManifest,
  extractGovernedContent,
} from "../foundation/manifest.js";
import { SafeGovernanceIdSchema } from "../governance/contracts.js";

let root = "";
let bookDir = "";

async function setupBook(): Promise<void> {
  root = await mkdtemp(join(tmpdir(), "castor-foundation-manifest-"));
  bookDir = join(root, "books", "manifest-book");
  await mkdir(join(bookDir, "story", "outline"), { recursive: true });
  await mkdir(join(bookDir, "story", "roles", "major"), { recursive: true });
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
    join(bookDir, "story", "book_rules.md"),
    [
      "## 主角",
      "- 名字：林辞",
      "- 性格锁：冷静、执着",
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
  await writeFile(join(bookDir, "story", "roles", "major", "林辞.md"), "## 核心标签\n冷静、执着\n", "utf-8");
}

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = "";
    bookDir = "";
  }
});

function makeManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    unitId: "sf-theme_tone",
    kind: "story_frame",
    importance: "required",
    status: "needs_review",
    locator: { contentKind: "section", sourceRelPath: "story/outline/story_frame.md", sectionKey: "theme_tone" },
    contentHash: "abc123",
    contentRevision: 1,
    dependencies: [],
    ...overrides,
  };
}

describe("FoundationUnitManifestSchema runtime validation", () => {
  it("round-trips a valid manifest through write/read", async () => {
    await setupBook();
    const manifest = FoundationUnitManifestSchema.parse(makeManifest());
    await writeUnitManifest(bookDir, manifest);
    const loaded = await readUnitManifests(bookDir);
    expect(loaded.get("sf-theme_tone")).toEqual(manifest);
  });

  it("rejects unknown unit kind, status, importance and dependency kind", () => {
    expect(FoundationUnitManifestSchema.safeParse(makeManifest({ kind: "invented_kind" })).success).toBe(false);
    expect(FoundationUnitManifestSchema.safeParse(makeManifest({ status: "invented_status" })).success).toBe(false);
    expect(FoundationUnitManifestSchema.safeParse(makeManifest({ importance: "critical" })).success).toBe(false);
    expect(
      FoundationUnitManifestSchema.safeParse(makeManifest({ dependencies: [{ kind: "invented_kind", targetUnitId: "char-x" }] })).success,
    ).toBe(false);
  });

  it("requires unitId to satisfy SafeGovernanceIdSchema", () => {
    expect(FoundationUnitManifestSchema.safeParse(makeManifest({ unitId: "a/b" })).success).toBe(false);
    expect(FoundationUnitManifestSchema.safeParse(makeManifest({ unitId: "../x" })).success).toBe(false);
    expect(SafeGovernanceIdSchema.safeParse("sf-theme_tone").success).toBe(true);
  });

  it("rejects locators with absolute or traversing sourceRelPath", () => {
    expect(FoundationUnitManifestSchema.safeParse(
      makeManifest({ locator: { contentKind: "whole_file", sourceRelPath: "/etc/passwd" } }),
    ).success).toBe(false);
    expect(FoundationUnitManifestSchema.safeParse(
      makeManifest({ locator: { contentKind: "whole_file", sourceRelPath: "../../secrets.md" } }),
    ).success).toBe(false);
    expect(FoundationUnitManifestSchema.safeParse(
      makeManifest({ locator: { contentKind: "whole_file", sourceRelPath: "C:windows\\x.md" } }),
    ).success).toBe(false);
  });
});

describe("extractGovernedContent", () => {
  it("extracts the four Story Frame sections independently from one physical file", async () => {
    await setupBook();
    const base = { sourceRelPath: "story/outline/story_frame.md" };
    const theme = await extractGovernedContent(bookDir, { contentKind: "section", ...base, sectionKey: "theme_tone" });
    const conflict = await extractGovernedContent(bookDir, { contentKind: "section", ...base, sectionKey: "core_conflict" });
    const world = await extractGovernedContent(bookDir, { contentKind: "section", ...base, sectionKey: "world_setting" });
    const ending = await extractGovernedContent(bookDir, { contentKind: "section", ...base, sectionKey: "ending_direction" });
    expect(theme).toContain("主题段落");
    expect(theme).not.toContain("冲突段落");
    expect(conflict).toContain("冲突段落");
    expect(world).toContain("世界段落");
    expect(ending).toContain("结局段落");
    expect(conflict).not.toContain("主题段落");
  });

  it("changing one section changes only that unit's governed content", async () => {
    await setupBook();
    const base = { sourceRelPath: "story/outline/story_frame.md" };
    const beforeTheme = await extractGovernedContent(bookDir, { contentKind: "section", ...base, sectionKey: "theme_tone" });
    const beforeConflict = await extractGovernedContent(bookDir, { contentKind: "section", ...base, sectionKey: "core_conflict" });
    const framePath = join(bookDir, "story", "outline", "story_frame.md");
    const updated = (await readFile(framePath, "utf-8")).replace("主题段落：命运与选择。", "主题段落：抗争与救赎。");
    await writeFile(framePath, updated, "utf-8");
    const afterTheme = await extractGovernedContent(bookDir, { contentKind: "section", ...base, sectionKey: "theme_tone" });
    const afterConflict = await extractGovernedContent(bookDir, { contentKind: "section", ...base, sectionKey: "core_conflict" });
    expect(afterTheme).not.toEqual(beforeTheme);
    expect(afterTheme).toContain("抗争与救赎");
    expect(afterConflict).toEqual(beforeConflict);
  });

  it("fails closed when the Story Frame positional shape is not exactly four sections", async () => {
    await setupBook();
    const framePath = join(bookDir, "story", "outline", "story_frame.md");
    const base = { sourceRelPath: "story/outline/story_frame.md" };
    // 3 sections
    await writeFile(framePath, "## 主题与基调\nA\n\n## 核心冲突\nB\n\n## 世界观底色\nC\n", "utf-8");
    await expect(
      extractGovernedContent(bookDir, { contentKind: "section", ...base, sectionKey: "theme_tone" }),
    ).rejects.toThrow(/exactly 4/);
    // 5 sections
    await writeFile(framePath, "## A\n1\n\n## B\n2\n\n## C\n3\n\n## D\n4\n\n## E\n5\n", "utf-8");
    await expect(
      extractGovernedContent(bookDir, { contentKind: "section", ...base, sectionKey: "theme_tone" }),
    ).rejects.toThrow(/exactly 4/);
  });

  it("governs Book Rules per rule using the existing ## heading format", async () => {
    await setupBook();
    const protagonist = await extractGovernedContent(bookDir, { contentKind: "rule", sourceRelPath: "story/book_rules.md", ruleId: "主角" });
    const prohibitions = await extractGovernedContent(bookDir, { contentKind: "rule", sourceRelPath: "story/book_rules.md", ruleId: "禁止事项" });
    expect(protagonist).toContain("名字：林辞");
    expect(prohibitions).toContain("核心世界观");
    expect(prohibitions).not.toContain("林辞");
  });

  it("governs hooks per entry using the existing pending_hooks hook_id convention", async () => {
    await setupBook();
    const h01 = await extractGovernedContent(bookDir, { contentKind: "entry", sourceRelPath: "story/pending_hooks.md", entryKey: "H01" });
    const h02 = await extractGovernedContent(bookDir, { contentKind: "entry", sourceRelPath: "story/pending_hooks.md", entryKey: "H02" });
    expect(h01).toContain("H01");
    expect(h01).not.toContain("H02");
    expect(h02).toContain("H02");
  });

  it("reads a character role sheet as a whole-file locator", async () => {
    await setupBook();
    const content = await extractGovernedContent(bookDir, { contentKind: "whole_file", sourceRelPath: "story/roles/major/林辞.md" });
    expect(content).toContain("冷静、执着");
  });

  it("cannot escape the book root via traversal", async () => {
    await setupBook();
    await expect(
      extractGovernedContent(bookDir, { contentKind: "whole_file", sourceRelPath: "../secret.md" }),
    ).rejects.toThrow();
  });
});

describe("revision invariant", () => {
  it("rejects status approved when approvedRevision !== contentRevision", () => {
    expect(FoundationUnitManifestSchema.safeParse(
      makeManifest({ status: "approved", approvedRevision: 2, contentRevision: 1 }),
    ).success).toBe(false);
  });

  it("satisfies the Task 2 structural approval predicate only when revisions match", () => {
    const approved = FoundationUnitManifestSchema.parse(makeManifest({ status: "approved", approvedRevision: 1 }));
    expect(isUnitApproved(approved)).toBe(true);
    // approvedRevision !== contentRevision is STRUCTURALLY invalid (schema rejects
    // it in the "rejects status approved" test), so isUnitApproved can only be true
    // when revisions match by construction.
    const draft = FoundationUnitManifestSchema.parse(makeManifest());
    expect(isUnitApproved(draft)).toBe(false);
  });

  it("stale exists only as status — no durable stale flag", () => {
    const stale = FoundationUnitManifestSchema.parse(makeManifest({ status: "stale", contentRevision: 2 }));
    expect(stale.status).toBe("stale");
    expect("stale" in stale).toBe(false); // no stale boolean field in the manifest
    expect(isUnitApproved(stale)).toBe(false);
  });

  it("pure unitContentEdited increments contentRevision and returns needs_review without granting approval", () => {
    const approved = FoundationUnitManifestSchema.parse(makeManifest({ status: "approved", approvedRevision: 1 }));
    const edited = unitContentEdited(approved);
    expect(edited.contentRevision).toBe(2);
    expect(edited.status).toBe("needs_review");
    expect(edited.approvedRevision).toBeUndefined();
    expect(isUnitApproved(edited)).toBe(false);
  });
});

describe("no prose in governance JSON", () => {
  it("serialized manifest contains no creative content field", async () => {
    await setupBook();
    const manifest = FoundationUnitManifestSchema.parse(makeManifest());
    const json = JSON.stringify(manifest);
    expect(json).not.toContain("主题段落");
    expect(json).not.toContain('"content"');
    expect(json).not.toContain('"prose"');
  });

  it("manifest schema is strict and rejects stray prose fields", () => {
    expect(FoundationUnitManifestSchema.safeParse(makeManifest({ content: "主题段落" })).success).toBe(false);
  });

  it("rejects unexpected nested locator fields (no hidden prose in nested objects)", () => {
    expect(FoundationUnitManifestSchema.safeParse(makeManifest({
      locator: { contentKind: "whole_file", sourceRelPath: "story/outline/volume_map.md", prose: "hidden content" },
    })).success).toBe(false);
    expect(FoundationUnitManifestSchema.safeParse(makeManifest({
      locator: { contentKind: "section", sourceRelPath: "story/outline/story_frame.md", sectionKey: "theme_tone", unexpected: true },
    })).success).toBe(false);
  });

  it("rejects unexpected nested Foundation dependency fields", () => {
    expect(FoundationUnitManifestSchema.safeParse(makeManifest({
      dependencies: [{ kind: "requires_character", targetUnitId: "char-x", notes: "hidden" }],
    })).success).toBe(false);
  });

  it("readUnitManifests fails closed on persisted nested unknown data", async () => {
    await setupBook();
    const dir = join(bookDir, "story", "foundation-v2");
    await mkdir(dir, { recursive: true });
    const manifest = makeManifest();
    await writeFile(
      join(dir, "sf-theme_tone.gov.json"),
      JSON.stringify({ ...manifest, locator: { ...(manifest.locator as object), prose: "hidden content" } }),
      "utf-8",
    );
    await expect(readUnitManifests(bookDir)).rejects.toThrow();
  });

  it("provenance is a reserved empty envelope — free-form prose cannot persist through it", async () => {
    // Free-form payloads in the provenance envelope must be structurally rejected.
    expect(FoundationUnitManifestSchema.safeParse(
      makeManifest({ provenance: { prose: "Once upon a time..." } }),
    ).success).toBe(false);
    expect(FoundationUnitManifestSchema.safeParse(
      makeManifest({ provenance: { content: "creative story text" } }),
    ).success).toBe(false);
    expect(FoundationUnitManifestSchema.safeParse(
      makeManifest({ provenance: { anything: { text: "story prose" } } }),
    ).success).toBe(false);
    // Absent provenance remains valid; the empty reserved envelope remains valid.
    expect(FoundationUnitManifestSchema.safeParse(makeManifest()).success).toBe(true);
    expect(FoundationUnitManifestSchema.safeParse(makeManifest({ provenance: {} })).success).toBe(true);
  });

  it("readUnitManifests fails closed on persisted free-form provenance prose", async () => {
    await setupBook();
    const dir = join(bookDir, "story", "foundation-v2");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "sf-theme_tone.gov.json"),
      JSON.stringify({ ...makeManifest(), provenance: { prose: "Once upon a time..." } }),
      "utf-8",
    );
    await expect(readUnitManifests(bookDir)).rejects.toThrow();
  });
});

describe("rule locator source-key compatibility (real Castor headings)", () => {
  it("a rule locator targeting the real heading 数值/资源规则 must parse", async () => {
    await setupBook();
    // This is the exact real repository heading (architect book_rules card).
    const manifest = FoundationUnitManifestSchema.parse(makeManifest({
      unitId: "rule-numerical-system",              // stable SAFE logical unit id — never the raw heading
      kind: "book_rule",
      locator: { contentKind: "rule", sourceRelPath: "story/book_rules.md", ruleId: "数值/资源规则" },
    }));
    const content = await extractGovernedContent(bookDir, manifest.locator);
    expect(content).toContain("核心资源");
  });

  it("neighboring rule cards remain independently extractable", async () => {
    await setupBook();
    const protagonist = await extractGovernedContent(bookDir, { contentKind: "rule", sourceRelPath: "story/book_rules.md", ruleId: "主角" });
    const prohibitions = await extractGovernedContent(bookDir, { contentKind: "rule", sourceRelPath: "story/book_rules.md", ruleId: "禁止事项" });
    expect(protagonist).toContain("名字：林辞");
    expect(prohibitions).toContain("核心世界观");
    expect(prohibitions).not.toContain("林辞");
  });

  it("a safe unitId + slash-containing ruleId round-trips through the manifest store", async () => {
    await setupBook();
    const manifest = FoundationUnitManifestSchema.parse(makeManifest({
      unitId: "rule-numerical-system",
      kind: "book_rule",
      locator: { contentKind: "rule", sourceRelPath: "story/book_rules.md", ruleId: "数值/资源规则" },
    }));
    await writeUnitManifest(bookDir, manifest);
    const loaded = await readUnitManifests(bookDir);
    expect(loaded.get("rule-numerical-system")?.locator).toEqual(manifest.locator);
  });

  it("unitId still MUST reject '/' while ruleId may contain it", () => {
    expect(FoundationUnitManifestSchema.safeParse(makeManifest({ unitId: "rule/数值" })).success).toBe(false);
    expect(FoundationUnitManifestSchema.safeParse(makeManifest({ unitId: "rule-numerical-system" })).success).toBe(true);
  });

  it("ruleId with control characters or newlines fails closed", async () => {
    await setupBook();
    expect(FoundationUnitManifestSchema.safeParse(makeManifest({
      locator: { contentKind: "rule", sourceRelPath: "story/book_rules.md", ruleId: "坏\u0000规则" },
    })).success).toBe(false);
    expect(FoundationUnitManifestSchema.safeParse(makeManifest({
      locator: { contentKind: "rule", sourceRelPath: "story/book_rules.md", ruleId: "坏\n规则" },
    })).success).toBe(false);
  });

  it("ruleId is never used as a filesystem path component", async () => {
    await setupBook();
    // A slash-containing ruleId must not be interpreted as a path: the manifest
    // file must be created under story/foundation-v2/<safe-unit-id>.gov.json,
    // and no subdirectory from the heading may be created.
    const manifest = FoundationUnitManifestSchema.parse(makeManifest({
      unitId: "rule-numerical-system",
      kind: "book_rule",
      locator: { contentKind: "rule", sourceRelPath: "story/book_rules.md", ruleId: "数值/资源规则" },
    }));
    await writeUnitManifest(bookDir, manifest);
    const expected = join(bookDir, "story", "foundation-v2", "rule-numerical-system.gov.json");
    await expect(readFile(expected, "utf-8")).resolves.toContain("数值/资源规则");
  });
});

describe("manifest persistence safety", () => {
  it("writeUnitManifest does not modify source Markdown", async () => {
    await setupBook();
    const framePath = join(bookDir, "story", "outline", "story_frame.md");
    const rulesPath = join(bookDir, "story", "book_rules.md");
    const beforeFrame = await readFile(framePath, "utf-8");
    const beforeRules = await readFile(rulesPath, "utf-8");
    await writeUnitManifest(bookDir, FoundationUnitManifestSchema.parse(makeManifest()));
    await writeUnitManifest(bookDir, FoundationUnitManifestSchema.parse(makeManifest({ unitId: "rule-protagonist", kind: "book_rule", locator: { contentKind: "rule", sourceRelPath: "story/book_rules.md", ruleId: "主角" } })));
    expect(await readFile(framePath, "utf-8")).toBe(beforeFrame);
    expect(await readFile(rulesPath, "utf-8")).toBe(beforeRules);
  });

  it("malformed persisted manifest fails closed on read", async () => {
    await setupBook();
    await mkdir(join(bookDir, "story", "foundation-v2"), { recursive: true });
    await writeFile(join(bookDir, "story", "foundation-v2", "bad-unit.gov.json"), JSON.stringify({ unitId: "bad", kind: "invented" }), "utf-8");
    await expect(readUnitManifests(bookDir)).rejects.toThrow();
  });
});

describe("logical unit identity across one physical file", () => {
  it("two logical units may reference one physical Markdown file without merging", async () => {
    await setupBook();
    const theme = FoundationUnitManifestSchema.parse(makeManifest());
    const ending = FoundationUnitManifestSchema.parse(makeManifest({
      unitId: "sf-ending_direction",
      locator: { contentKind: "section", sourceRelPath: "story/outline/story_frame.md", sectionKey: "ending_direction" },
    }));
    expect(theme.locator.sourceRelPath).toBe(ending.locator.sourceRelPath);
    expect(theme.unitId).not.toBe(ending.unitId);
    await writeUnitManifest(bookDir, theme);
    await writeUnitManifest(bookDir, ending);
    const loaded = await readUnitManifests(bookDir);
    expect(loaded.size).toBe(2);
    expect(loaded.get("sf-theme_tone")?.locator).toEqual(theme.locator);
    expect(loaded.get("sf-ending_direction")?.locator).toEqual(ending.locator);
  });
});
