import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildForecastContext,
  computeContextFingerprint,
  renderForecastContextMarkdown,
} from "../forecast/context-builder.js";

async function writeFixtureBook(bookDir: string): Promise<void> {
  await mkdir(join(bookDir, "chapters"), { recursive: true });
  await mkdir(join(bookDir, "story", "state"), { recursive: true });
  await mkdir(join(bookDir, "story", "outline"), { recursive: true });
  await mkdir(join(bookDir, "story", "roles", "主要角色"), { recursive: true });

  await writeFile(join(bookDir, "book.json"), JSON.stringify({ id: "demo", title: "示例书", language: "vi" }), "utf-8");
  await writeFile(join(bookDir, "chapters", "0001_开局.md"), "第一章正文", "utf-8");
  await writeFile(join(bookDir, "chapters", "0002_升级.md"), "第二章正文", "utf-8");
  await writeFile(join(bookDir, "story", "state", "current_state.json"), JSON.stringify({ facts: ["主角在东城"] }), "utf-8");
  await writeFile(join(bookDir, "story", "state", "hooks.json"), JSON.stringify({ hooks: [] }), "utf-8");
  await writeFile(join(bookDir, "story", "author_intent.md"), "# 作者意图\n复仇主线", "utf-8");
  await writeFile(join(bookDir, "story", "current_focus.md"), "# 当前聚焦\n推进证据链", "utf-8");
  await writeFile(join(bookDir, "story", "current_state.md"), "# 当前状态\n主角在东城", "utf-8");
  await writeFile(join(bookDir, "story", "pending_hooks.md"), "| hook_id | 描述 |\n| --- | --- |\n| hook-03 | 遗嘱 |", "utf-8");
  await writeFile(join(bookDir, "story", "outline", "story_frame.md"), "# 故事框架\n都市复仇", "utf-8");
  await writeFile(join(bookDir, "story", "outline", "volume_map.md"), "# 卷映射\n第一卷", "utf-8");
  await writeFile(join(bookDir, "story", "roles", "主要角色", "林潜.md"), "# 林潜\n人设锁：绝不妥协", "utf-8");
  await writeFile(join(bookDir, "story", "subplot_board.md"), "| 支线 | 状态 |\n| --- | --- |\n| 遗产争夺 | active |", "utf-8");
  await writeFile(
    join(bookDir, "story", "chapter_summaries.md"),
    [
      "| 章节 | 标题 | 出场人物 | 关键事件 | 状态变化 | 伏笔动态 | 情绪基调 | 章节类型 |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      "| 1 | 开局 | 主角 | 遭背叛 | 低谷 | hook-01 埋下 | 压抑 | 铺垫 |",
      "| 2 | 升级 | 主角 | 拿到证据 | 反击开始 | hook-03 埋下 | 上扬 | 推进 |",
    ].join("\n"),
    "utf-8",
  );
}

describe("buildForecastContext", () => {
  let bookDir: string;

  beforeEach(async () => {
    bookDir = await mkdtemp(join(tmpdir(), "castor-forecast-ctx-"));
    await writeFixtureBook(bookDir);
  });
  afterEach(async () => {
    await rm(bookDir, { recursive: true, force: true });
  });

  it("collects canonical sections, base chapter and language", async () => {
    const context = await buildForecastContext({ bookDir, bookId: "demo" });

    expect(context.baseChapter).toBe(2);
    expect(context.language).toBe("vi");
    expect(context.bookTitle).toBe("示例书");
    expect(context.sections.authorIntent).toContain("复仇主线");
    expect(context.sections.currentFocus).toContain("推进证据链");
    expect(context.sections.pendingHooks).toContain("hook-03");
    expect(context.sections.storyFrame).toContain("都市复仇");
    expect(context.sections.recentChapterSummaries).toContain("拿到证据");
    expect(context.contextFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for unchanged canon", async () => {
    const first = await buildForecastContext({ bookDir, bookId: "demo" });
    const second = await buildForecastContext({ bookDir, bookId: "demo" });
    expect(second.contextFingerprint).toBe(first.contextFingerprint);
  });

  it("changes the fingerprint when a structured state file changes", async () => {
    const before = await buildForecastContext({ bookDir, bookId: "demo" });
    await writeFile(join(bookDir, "story", "state", "current_state.json"), JSON.stringify({ facts: ["主角离开东城"] }), "utf-8");
    const after = await buildForecastContext({ bookDir, bookId: "demo" });
    expect(after.contextFingerprint).not.toBe(before.contextFingerprint);
  });

  it("changes the fingerprint when a new canonical chapter lands", async () => {
    const before = await buildForecastContext({ bookDir, bookId: "demo" });
    await writeFile(join(bookDir, "chapters", "0003_反击.md"), "第三章正文", "utf-8");
    const after = await buildForecastContext({ bookDir, bookId: "demo" });
    expect(after.contextFingerprint).not.toBe(before.contextFingerprint);
    expect(after.baseChapter).toBe(3);
  });

  it("changes the fingerprint when a control document changes", async () => {
    const before = await buildForecastContext({ bookDir, bookId: "demo" });
    await writeFile(join(bookDir, "story", "current_focus.md"), "# 当前聚焦\n转向感情线", "utf-8");
    const after = await buildForecastContext({ bookDir, bookId: "demo" });
    expect(after.contextFingerprint).not.toBe(before.contextFingerprint);
  });

  it("changes the fingerprint when the story frame changes", async () => {
    const before = await buildForecastContext({ bookDir, bookId: "demo" });
    await writeFile(join(bookDir, "story", "outline", "story_frame.md"), "# 故事框架\n都市复仇改为悬疑探案", "utf-8");
    const after = await buildForecastContext({ bookDir, bookId: "demo" });
    expect(after.contextFingerprint).not.toBe(before.contextFingerprint);
  });

  it("changes the fingerprint when the volume map changes", async () => {
    const before = await buildForecastContext({ bookDir, bookId: "demo" });
    await writeFile(join(bookDir, "story", "outline", "volume_map.md"), "# 卷映射\n第一卷改写：提前决战", "utf-8");
    const after = await buildForecastContext({ bookDir, bookId: "demo" });
    expect(after.contextFingerprint).not.toBe(before.contextFingerprint);
  });

  it("changes the fingerprint when a character role card changes", async () => {
    const before = await buildForecastContext({ bookDir, bookId: "demo" });
    await writeFile(join(bookDir, "story", "roles", "主要角色", "林潜.md"), "# 林潜\n人设锁改动：可以妥协", "utf-8");
    const after = await buildForecastContext({ bookDir, bookId: "demo" });
    expect(after.contextFingerprint).not.toBe(before.contextFingerprint);
  });

  it("changes the fingerprint when the subplot board changes", async () => {
    const before = await buildForecastContext({ bookDir, bookId: "demo" });
    await writeFile(join(bookDir, "story", "subplot_board.md"), "| 支线 | 状态 |\n| --- | --- |\n| 遗产争夺 | resolved |", "utf-8");
    const after = await buildForecastContext({ bookDir, bookId: "demo" });
    expect(after.contextFingerprint).not.toBe(before.contextFingerprint);
  });

  it("changes the fingerprint when chapter summaries change", async () => {
    const before = await buildForecastContext({ bookDir, bookId: "demo" });
    await writeFile(
      join(bookDir, "story", "chapter_summaries.md"),
      [
        "| 章节 | 标题 | 出场人物 | 关键事件 | 状态变化 | 伏笔动态 | 情绪基调 | 章节类型 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| 1 | 开局 | 主角 | 遭背叛 | 低谷 | hook-01 埋下 | 压抑 | 铺垫 |",
        "| 2 | 升级 | 主角 | 证据被毁 | 反击受挫 | hook-03 引爆 | 低沉 | 转折 |",
      ].join("\n"),
      "utf-8",
    );
    const after = await buildForecastContext({ bookDir, bookId: "demo" });
    expect(after.contextFingerprint).not.toBe(before.contextFingerprint);
  });

  it("changes the fingerprint when a new input file appears", async () => {
    const before = await buildForecastContext({ bookDir, bookId: "demo" });
    await writeFile(join(bookDir, "story", "roles", "主要角色", "沈疏影.md"), "# 沈疏影\n身份：盟友", "utf-8");
    const after = await buildForecastContext({ bookDir, bookId: "demo" });
    expect(after.contextFingerprint).not.toBe(before.contextFingerprint);
  });

  it("distinguishes an emptied control document from a deleted one", async () => {
    await writeFile(join(bookDir, "story", "author_intent.md"), "", "utf-8");
    const emptied = await buildForecastContext({ bookDir, bookId: "demo" });
    await unlink(join(bookDir, "story", "author_intent.md"));
    const deleted = await buildForecastContext({ bookDir, bookId: "demo" });
    expect(deleted.contextFingerprint).not.toBe(emptied.contextFingerprint);
  });

  it("ignores non-canonical runtime files, including forecast artifacts", async () => {
    const before = await buildForecastContext({ bookDir, bookId: "demo" });
    await mkdir(join(bookDir, "story", "runtime", "narrative-forecasts", "fc-001"), { recursive: true });
    await writeFile(join(bookDir, "story", "runtime", "scratch.md"), "无关内容", "utf-8");
    await writeFile(
      join(bookDir, "story", "runtime", "narrative-forecasts", "fc-001", "forecast.json"),
      JSON.stringify({ forecastId: "fc-001" }),
      "utf-8",
    );
    const after = await buildForecastContext({ bookDir, bookId: "demo" });
    expect(after.contextFingerprint).toBe(before.contextFingerprint);
  });

  it("never creates missing canonical files on an empty book", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "castor-forecast-empty-"));
    try {
      const context = await buildForecastContext({ bookDir: emptyDir, bookId: "empty" });
      expect(context.baseChapter).toBe(0);
      expect(context.sections.authorIntent).toBe("");
      expect(await readdir(emptyDir)).toEqual([]);
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });
});

describe("computeContextFingerprint", () => {
  it("is independent of file ordering", () => {
    const a = computeContextFingerprint({ baseChapter: 3, files: [["a.md", "1"], ["b.md", "2"]] });
    const b = computeContextFingerprint({ baseChapter: 3, files: [["b.md", "2"], ["a.md", "1"]] });
    expect(a).toBe(b);
  });

  it("changes with base chapter", () => {
    const a = computeContextFingerprint({ baseChapter: 3, files: [["a.md", "1"]] });
    const b = computeContextFingerprint({ baseChapter: 4, files: [["a.md", "1"]] });
    expect(a).not.toBe(b);
  });
});

describe("renderForecastContextMarkdown", () => {
  it("renders populated sections and skips empty ones", async () => {
    const bookDir = await mkdtemp(join(tmpdir(), "castor-forecast-md-"));
    try {
      await writeFixtureBook(bookDir);
      const context = await buildForecastContext({ bookDir, bookId: "demo" });
      const markdown = renderForecastContextMarkdown(context);

      expect(markdown).toContain("复仇主线");
      expect(markdown).toContain("推进证据链");
      expect(markdown).toContain("hook-03");
      expect(markdown).not.toContain("undefined");
    } finally {
      await rm(bookDir, { recursive: true, force: true });
    }
  });
});
