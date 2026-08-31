import { afterEach, describe, expect, it } from "vitest";
import { setAppLanguage } from "./app-language";
import {
  FOUNDATION_FILE_LABELS,
  firstParagraph,
  foundationFileLabel,
  frontmatterToCards,
  hasTableRows,
  parsePendingHooks,
  presentCurrentState,
  relabelOkrJargon,
  roleFromPath,
  stripStructuralMarkers,
} from "./truth-display";

describe("frontmatterToCards", () => {
  it("maps story-meaningful fields to friendly Chinese cards", () => {
    const cards = frontmatterToCards({
      protagonist: { name: "mock_val" },
      genreLock: { primary: "mock_val" },
      prohibitions: ["mock_val", "mock_val"],
      fanficMode: "au",
    });
    expect(cards).toEqual([
      { label: "Nhân vật chính", values: ["mock_val"] },
      { label: "Thể loại", values: ["mock_val"] },
      { label: "Giới hạn cứng", values: ["mock_val", "mock_val"] },
      { label: "Chế độ fanfic", values: ["Thế giới song song (AU)"] },
    ]);
  });

  it("includes era only when enabled and drops engineering/tuning fields", () => {
    const cards = frontmatterToCards({
      protagonist: { name: "mock_val" },
      eraConstraints: { enabled: true, period: "1985 mock_val", region: "mock_val" },
      // engineering fields that must NOT surface to a reader:
      ...({ version: "1.0", fatigueWordsOverride: ["mock_val"], enableFullCastTracking: true } as object),
    });
    expect(cards).toContainEqual({ label: "Bối cảnh thời đại", values: ["1985 mock_val", "mock_val"] });
    expect(cards.map((c) => c.label)).not.toContain("version");
    expect(cards.map((c) => c.label)).not.toContain("fatigueWordsOverride");
  });

  it("omits era when not enabled", () => {
    const cards = frontmatterToCards({
      eraConstraints: { enabled: false, period: "1985 mock_val" },
    });
    expect(cards.map((c) => c.label)).not.toContain("mock_val");
  });

  it("returns an empty list for null/empty frontmatter", () => {
    expect(frontmatterToCards(null)).toEqual([]);
    expect(frontmatterToCards({})).toEqual([]);
  });
});

describe("stripStructuralMarkers", () => {
  it("removes SECTION / ROLE / CONTENT scaffolding but keeps prose and markdown rules", () => {
    const input = [
      "=== SECTION: story_frame ===",
      "# mock_val",
      "mock_val。",
      "",
      "---ROLE---",
      "mock_val",
      "---CONTENT---",
      "mock_val。",
      "",
      "---",
      "mock_val。",
    ].join("\n");
    const out = stripStructuralMarkers(input);
    expect(out).not.toContain("=== SECTION");
    expect(out).not.toContain("---ROLE---");
    expect(out).not.toContain("---CONTENT---");
    expect(out).toContain("mock_val");
    expect(out).toContain("mock_val");
    // A plain markdown horizontal rule is left intact.
    expect(out).toContain("\n---\n");
  });
});

describe("firstParagraph", () => {
  it("returns the first prose paragraph, skipping a leading heading", () => {
    const body = "# mock_val\n\nmock_val，mock_val。\n\nmock_val。";
    expect(firstParagraph(body)).toBe("mock_val，mock_val。");
  });

  it("drops a heading that shares the paragraph with prose", () => {
    const body = "# mock_val\nmock_val。\n\nmock_val。";
    expect(firstParagraph(body)).toBe("mock_val。");
  });

  it("returns empty string for heading-only or empty input", () => {
    expect(firstParagraph("# mock_val")).toBe("");
    expect(firstParagraph("")).toBe("");
  });
});

describe("roleFromPath", () => {
  it("parses zh and en role dirs with the right tier", () => {
    expect(roleFromPath("roles/major/mock_val.md")).toEqual({ path: "roles/major/mock_val.md", name: "mock_val", tier: "major" });
    expect(roleFromPath("roles/minor/mock_val.md")).toEqual({ path: "roles/minor/mock_val.md", name: "mock_val", tier: "minor" });
    expect(roleFromPath("roles/major/Mara.md")).toEqual({ path: "roles/major/Mara.md", name: "Mara", tier: "major" });
    expect(roleFromPath("roles/minor/Kit.md")).toEqual({ path: "roles/minor/Kit.md", name: "Kit", tier: "minor" });
  });

  it("returns null for non-role paths", () => {
    expect(roleFromPath("outline/story_frame.md")).toBeNull();
    expect(roleFromPath("roles/mock_val/x.md")).toBeNull();
    expect(roleFromPath("story_bible.md")).toBeNull();
  });
});

describe("relabelOkrJargon", () => {
  it("replaces OKR/Objective/KR labels with plain Chinese in a Chinese outline", () => {
    const input = [
      "## mock_valOKR（Objective + Key Results）",
      "",
      "**mock_valObjective：** mock_val。",
      "**mock_val Objective：** mock_val。",
      "KR1：mock_val80mock_val。",
      "KR2：mock_val。",
    ].join("\n");
    const out = relabelOkrJargon(input);
    expect(out).toContain("## mock_val");
    expect(out).toContain("**mock_val：**");
    expect(out).toContain("**mock_val：**");
    expect(out).toContain("mock_val1：mock_val80mock_val");
    expect(out).toContain("mock_val2：mock_val");
    expect(out).not.toMatch(/Objective|OKR|\bKR\d/);
  });

  it("leaves English content untouched (no zh labels spliced into English prose)", () => {
    const en = "## Per-Volume OKRs\n\n**Book Objective:** put the antagonist in prison.\nKR1: reach 800k.";
    expect(relabelOkrJargon(en)).toBe(en);
  });

  it("is a no-op for empty or jargon-free text", () => {
    expect(relabelOkrJargon("")).toBe("");
    expect(relabelOkrJargon("## mock_val\nmock_val。")).toBe("## mock_val\nmock_val。");
  });
});

describe("presentCurrentState", () => {
  it("reports empty and strips the engineering seed note when no chapters are written", () => {
    const seed = "# mock_val\n\n> mock_val。mock_val consolidator mock_val。mock_val roles/*.mock_val；mock_val pending_hooks mock_val startChapter=0 mock_val。\n";
    const result = presentCurrentState(seed);
    expect(result.isEmpty).toBe(true);
    expect(result.body).not.toContain("consolidator");
    expect(result.body).not.toContain("mock_val");
    expect(result.body).not.toContain("pending_hooks");
  });

  it("keeps real appended state and still drops the seed note", () => {
    const withState = [
      "# mock_val",
      "",
      "> mock_val。mock_val consolidator mock_val。",
      "",
      "## Chương 1mock_val",
      "mock_val，mock_val。",
    ].join("\n");
    const result = presentCurrentState(withState);
    expect(result.isEmpty).toBe(false);
    expect(result.body).toContain("mock_val");
    expect(result.body).not.toContain("consolidator");
  });
});

describe("parsePendingHooks", () => {
  const table = [
    "| hook_id | mock_val | mock_val | mock_val | mock_val | mock_val | mock_val | mock_val |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    "| H001 | 0 | mock_val | mock_val | 200 | mock_val | mock_val | mock_val：mock_val，mock_val。 |",
    "| H004 | 0 | mock_val | mock_val | 70 | mock_val | mock_val | mock_val，mock_val。 |",
  ].join("\n");

  it("parses each hook's reader-facing fields and drops bookkeeping columns", () => {
    const hooks = parsePendingHooks(table);
    expect(hooks).toHaveLength(2);
    expect(hooks[0]).toEqual({
      id: "H001",
      type: "mock_val",
      content: "mock_val：mock_val，mock_val。",
      payoff: "mock_val",
      core: true,
    });
    expect(hooks[1].core).toBe(false);
    expect(hooks[1].payoff).toBe("mock_val");
  });

  it("parses promoted state so seed hooks are not confused with active hook debt", () => {
    const phase7 = [
      "| hook_id | mock_val | mock_val | mock_val | mock_val | mock_val | mock_val | mock_val | mock_val | mock_val | mock_val | mock_val | mock_val |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      "| H001 | 0 | mock_val | open | 0 | 200 | slow-burn | mock_val | mock_val | mock_val | 10 | mock_val | mock_val。 |",
      "| H004 | 0 | mock_val | open | 0 | 70 | near-term | mock_val | mock_val | mock_val | 10 | mock_val | mock_val。 |",
    ].join("\n");

    const hooks = parsePendingHooks(phase7);
    expect(hooks[0]).toMatchObject({ id: "H001", promoted: true });
    expect(hooks[1]).toMatchObject({ id: "H004", promoted: false });
  });

  it("is robust to column reordering (parses by header name)", () => {
    const reordered = [
      "| mock_val | mock_val | hook_id | mock_val |",
      "| --- | --- | --- | --- |",
      "| mock_val X | mock_val | H007 | mock_val |",
    ].join("\n");
    const hooks = parsePendingHooks(reordered);
    expect(hooks[0]).toMatchObject({ id: "H007", type: "mock_val", content: "mock_val X", core: false });
  });

  it("returns an empty array for non-table content", () => {
    expect(parsePendingHooks("# mock_val\nChua comock_val。")).toEqual([]);
    expect(parsePendingHooks("")).toEqual([]);
  });
});

describe("hasTableRows", () => {
  it("returns false for a header-only seed table (emotional_arcs.md at creation)", () => {
    const seed = "# mock_val\n\n| mock_val | mock_val | mock_val | mock_val | mock_val(1-10) | mock_val |\n|------|------|----------|----------|------------|----------|\n";
    expect(hasTableRows(seed)).toBe(false);
  });

  it("returns true once data rows are present", () => {
    const filled = [
      "| mock_val | mock_val | mock_val |",
      "| --- | --- | --- |",
      "| mock_val | 1 | mock_val |",
    ].join("\n");
    expect(hasTableRows(filled)).toBe(true);
  });
});

describe("FOUNDATION_FILE_LABELS", () => {
  it("labels the authoritative Phase 5 files and excludes character files", () => {
    expect(FOUNDATION_FILE_LABELS["outline/story_frame.md"]).toBe("Nền tảng truyện");
    expect(FOUNDATION_FILE_LABELS["outline/volume_map.md"]).toBe("Kế hoạch tập");
    // character files do not belong to the foundation list
    expect(FOUNDATION_FILE_LABELS["character_matrix.md"]).toBeUndefined();
  });
});

describe("English UI (app language = en)", () => {
  afterEach(() => {
    setAppLanguage("vi");
  });

  it("frontmatterToCards emits English labels and fanfic-mode names", () => {
    setAppLanguage("en");
    const cards = frontmatterToCards({
      protagonist: { name: "Mara" },
      genreLock: { primary: "Urban Mystery" },
      prohibitions: ["No time travel"],
      fanficMode: "au",
    });
    expect(cards).toEqual([
      { label: "Protagonist", values: ["Mara"] },
      { label: "Genre", values: ["Urban Mystery"] },
      { label: "Hard Lines", values: ["No time travel"] },
      { label: "Fanfic Mode", values: ["Alternate Universe"] },
    ]);
  });

  it("relabelOkrJargon leaves documents untouched (no zh labels in the English UI) and foundationFileLabel switches language", () => {
    setAppLanguage("en");
    const zhDoc = "## mock_valOKR（Objective + Key Results）\nKR1：mock_val80mock_val。";
    expect(relabelOkrJargon(zhDoc)).toBe(zhDoc);

    expect(foundationFileLabel("outline/story_frame.md")).toBe("Story Foundation");
    expect(foundationFileLabel("character_matrix.md")).toBeUndefined();
    setAppLanguage("vi");
    expect(foundationFileLabel("outline/story_frame.md")).toBe("Nền tảng truyện");
  });
});
