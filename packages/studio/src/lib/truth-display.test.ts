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
      protagonist: { name: "陈烬" },
      genreLock: { primary: "都市悬疑" },
      prohibitions: ["不写穿越", "不洗白反派"],
      fanficMode: "au",
    });
    expect(cards).toEqual([
      { label: "Nhân vật chính", values: ["陈烬"] },
      { label: "Thể loại", values: ["都市悬疑"] },
      { label: "Giới hạn cứng", values: ["不写穿越", "不洗白反派"] },
      { label: "Chế độ fanfic", values: ["Thế giới song song (AU)"] },
    ]);
  });

  it("includes era only when enabled and drops engineering/tuning fields", () => {
    const cards = frontmatterToCards({
      protagonist: { name: "林" },
      eraConstraints: { enabled: true, period: "1985 年", region: "南方港城" },
      // engineering fields that must NOT surface to a reader:
      ...({ version: "1.0", fatigueWordsOverride: ["突然"], enableFullCastTracking: true } as object),
    });
    expect(cards).toContainEqual({ label: "Bối cảnh thời đại", values: ["1985 年", "南方港城"] });
    expect(cards.map((c) => c.label)).not.toContain("version");
    expect(cards.map((c) => c.label)).not.toContain("fatigueWordsOverride");
  });

  it("omits era when not enabled", () => {
    const cards = frontmatterToCards({
      eraConstraints: { enabled: false, period: "1985 年" },
    });
    expect(cards.map((c) => c.label)).not.toContain("时代背景");
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
      "# 世界观",
      "潮湿的港口城市。",
      "",
      "---ROLE---",
      "陈烬",
      "---CONTENT---",
      "他的故事。",
      "",
      "---",
      "结尾。",
    ].join("\n");
    const out = stripStructuralMarkers(input);
    expect(out).not.toContain("=== SECTION");
    expect(out).not.toContain("---ROLE---");
    expect(out).not.toContain("---CONTENT---");
    expect(out).toContain("潮湿的港口城市");
    expect(out).toContain("他的故事");
    // A plain markdown horizontal rule is left intact.
    expect(out).toContain("\n---\n");
  });
});

describe("firstParagraph", () => {
  it("returns the first prose paragraph, skipping a leading heading", () => {
    const body = "# 世界观底色\n\n潮湿的港口城市，规则只对穷人生效。\n\n第二段。";
    expect(firstParagraph(body)).toBe("潮湿的港口城市，规则只对穷人生效。");
  });

  it("drops a heading that shares the paragraph with prose", () => {
    const body = "# 世界观\n这一段紧跟标题。\n\n下一段。";
    expect(firstParagraph(body)).toBe("这一段紧跟标题。");
  });

  it("returns empty string for heading-only or empty input", () => {
    expect(firstParagraph("# 只有标题")).toBe("");
    expect(firstParagraph("")).toBe("");
  });
});

describe("roleFromPath", () => {
  it("parses zh and en role dirs with the right tier", () => {
    expect(roleFromPath("roles/主要角色/陈烬.md")).toEqual({ path: "roles/主要角色/陈烬.md", name: "陈烬", tier: "major" });
    expect(roleFromPath("roles/次要角色/朋友乙.md")).toEqual({ path: "roles/次要角色/朋友乙.md", name: "朋友乙", tier: "minor" });
    expect(roleFromPath("roles/major/Mara.md")).toEqual({ path: "roles/major/Mara.md", name: "Mara", tier: "major" });
    expect(roleFromPath("roles/minor/Kit.md")).toEqual({ path: "roles/minor/Kit.md", name: "Kit", tier: "minor" });
  });

  it("returns null for non-role paths", () => {
    expect(roleFromPath("outline/story_frame.md")).toBeNull();
    expect(roleFromPath("roles/其他/x.md")).toBeNull();
    expect(roleFromPath("story_bible.md")).toBeNull();
  });
});

describe("relabelOkrJargon", () => {
  it("replaces OKR/Objective/KR labels with plain Chinese in a Chinese outline", () => {
    const input = [
      "## 各卷OKR（Objective + Key Results）",
      "",
      "**全书Objective：** 陈烬送周岳山入狱。",
      "**第一卷 Objective：** 完成原始积累。",
      "KR1：账户达到80万。",
      "KR2：注册公司。",
    ].join("\n");
    const out = relabelOkrJargon(input);
    expect(out).toContain("## 各卷目标与关键节点");
    expect(out).toContain("**全书目标：**");
    expect(out).toContain("**第一卷目标：**");
    expect(out).toContain("关键结果1：账户达到80万");
    expect(out).toContain("关键结果2：注册公司");
    expect(out).not.toMatch(/Objective|OKR|\bKR\d/);
  });

  it("leaves English content untouched (no zh labels spliced into English prose)", () => {
    const en = "## Per-Volume OKRs\n\n**Book Objective:** put the antagonist in prison.\nKR1: reach 800k.";
    expect(relabelOkrJargon(en)).toBe(en);
  });

  it("is a no-op for empty or jargon-free text", () => {
    expect(relabelOkrJargon("")).toBe("");
    expect(relabelOkrJargon("## 各卷主题与情绪曲线\n第一卷压抑。")).toBe("## 各卷主题与情绪曲线\n第一卷压抑。");
  });
});

describe("presentCurrentState", () => {
  it("reports empty and strips the engineering seed note when no chapters are written", () => {
    const seed = "# 当前状态\n\n> 建书时占位。运行时每章之后由 consolidator 追加最新状态。每个角色的初始状态详见 roles/*.当前现状；承重的初始世界设定见 pending_hooks 里 startChapter=0 的行。\n";
    const result = presentCurrentState(seed);
    expect(result.isEmpty).toBe(true);
    expect(result.body).not.toContain("consolidator");
    expect(result.body).not.toContain("建书时占位");
    expect(result.body).not.toContain("pending_hooks");
  });

  it("keeps real appended state and still drops the seed note", () => {
    const withState = [
      "# 当前状态",
      "",
      "> 建书时占位。运行时每章之后由 consolidator 追加最新状态。",
      "",
      "## 第 1 章后",
      "陈烬确认重生，拿到父亲专利复印件。",
    ].join("\n");
    const result = presentCurrentState(withState);
    expect(result.isEmpty).toBe(false);
    expect(result.body).toContain("陈烬确认重生");
    expect(result.body).not.toContain("consolidator");
  });
});

describe("parsePendingHooks", () => {
  const table = [
    "| hook_id | 起始章节 | 类型 | 状态 | 预期回收 | 回收卷 | 核心 | 备注 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    "| H001 | 0 | 主线伏笔 | 未正式推进 | 200 | 第五卷中段 | 是 | 初始世界状态：陈烬从噩梦惊醒，确认重生。 |",
    "| H004 | 0 | 次要伏笔 | 未正式推进 | 70 | 第二卷中段 | 否 | 室友李浩沉迷游戏，对前途迷茫。 |",
  ].join("\n");

  it("parses each hook's reader-facing fields and drops bookkeeping columns", () => {
    const hooks = parsePendingHooks(table);
    expect(hooks).toHaveLength(2);
    expect(hooks[0]).toEqual({
      id: "H001",
      type: "主线伏笔",
      content: "初始世界状态：陈烬从噩梦惊醒，确认重生。",
      payoff: "第五卷中段",
      core: true,
    });
    expect(hooks[1].core).toBe(false);
    expect(hooks[1].payoff).toBe("第二卷中段");
  });

  it("parses promoted state so seed hooks are not confused with active hook debt", () => {
    const phase7 = [
      "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 回收节奏 | 上游依赖 | 回收卷 | 核心 | 半衰期 | 升级 | 备注 |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      "| H001 | 0 | 主线伏笔 | open | 0 | 200 | slow-burn | 无 | 第五卷 | 是 | 10 | 是 | 父亲专利的黑箱。 |",
      "| H004 | 0 | 次要伏笔 | open | 0 | 70 | near-term | 无 | 第二卷 | 否 | 10 | 否 | 室友游戏债。 |",
    ].join("\n");

    const hooks = parsePendingHooks(phase7);
    expect(hooks[0]).toMatchObject({ id: "H001", promoted: true });
    expect(hooks[1]).toMatchObject({ id: "H004", promoted: false });
  });

  it("is robust to column reordering (parses by header name)", () => {
    const reordered = [
      "| 备注 | 类型 | hook_id | 核心 |",
      "| --- | --- | --- | --- |",
      "| 内容 X | 情感线伏笔 | H007 | 否 |",
    ].join("\n");
    const hooks = parsePendingHooks(reordered);
    expect(hooks[0]).toMatchObject({ id: "H007", type: "情感线伏笔", content: "内容 X", core: false });
  });

  it("returns an empty array for non-table content", () => {
    expect(parsePendingHooks("# 伏笔池\n暂无伏笔。")).toEqual([]);
    expect(parsePendingHooks("")).toEqual([]);
  });
});

describe("hasTableRows", () => {
  it("returns false for a header-only seed table (emotional_arcs.md at creation)", () => {
    const seed = "# 情感弧线\n\n| 角色 | 章节 | 情绪状态 | 触发事件 | 强度(1-10) | 弧线方向 |\n|------|------|----------|----------|------------|----------|\n";
    expect(hasTableRows(seed)).toBe(false);
  });

  it("returns true once data rows are present", () => {
    const filled = [
      "| 角色 | 章节 | 情绪状态 |",
      "| --- | --- | --- |",
      "| 陈烬 | 1 | 压抑 |",
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
    const zhDoc = "## 各卷OKR（Objective + Key Results）\nKR1：账户达到80万。";
    expect(relabelOkrJargon(zhDoc)).toBe(zhDoc);

    expect(foundationFileLabel("outline/story_frame.md")).toBe("Story Foundation");
    expect(foundationFileLabel("character_matrix.md")).toBeUndefined();
    setAppLanguage("vi");
    expect(foundationFileLabel("outline/story_frame.md")).toBe("Nền tảng truyện");
  });
});
