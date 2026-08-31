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
  await mkdir(join(bookDir, "story", "roles", "major"), { recursive: true });

  await writeFile(join(bookDir, "book.json"), JSON.stringify({ id: "demo", title: "Sach Thu Nghiem", language: "vi" }), "utf-8");
  await writeFile(join(bookDir, "chapters", "0001_mo_dau.md"), "Chuong 1", "utf-8");
  await writeFile(join(bookDir, "chapters", "0002_chuyen_bien.md"), "Chuong 2", "utf-8");
  await writeFile(join(bookDir, "story", "state", "current_state.json"), JSON.stringify({ facts: ["Nhan vat chinh o Dong Thanh"] }), "utf-8");
  await writeFile(join(bookDir, "story", "state", "hooks.json"), JSON.stringify({ hooks: [] }), "utf-8");
  await writeFile(join(bookDir, "story", "author_intent.md"), "# Y do tac gia\nTuyen bao thu", "utf-8");
  await writeFile(join(bookDir, "story", "current_focus.md"), "# Tieu diem hien tai\nDay manh bang chung", "utf-8");
  await writeFile(join(bookDir, "story", "current_state.md"), "# Trang thai hien tai\nNhan vat chinh o Dong Thanh", "utf-8");
  await writeFile(join(bookDir, "story", "pending_hooks.md"), "| hook_id | Mo ta |\n| --- | --- |\n| hook-03 | Di chuc |", "utf-8");
  await writeFile(join(bookDir, "story", "outline", "story_frame.md"), "# Khung cau chuyen\nDo thi bao thu", "utf-8");
  await writeFile(join(bookDir, "story", "outline", "volume_map.md"), "# So do quyen\nChuong 1-10", "utf-8");
  await writeFile(join(bookDir, "story", "roles", "major", "lu_xun.md"), "# Lu Xun\nVai chinh", "utf-8");
  await writeFile(join(bookDir, "story", "subplot_board.md"), "| Tuyến | Trạng thái |\n| --- | --- |\n| sub-01 | active |", "utf-8");
  await writeFile(
    join(bookDir, "story", "chapter_summaries.md"),
    [
      "| Chuong | Tieu de | Nhan vat | Su kien | Bien doi | Hook | Cam xuc | Loai |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      "| 1 | Mo dau | Lu Xun | Bat dau | Khoi hanh | hook-01 | Cang thang | Khoi dau |",
      "| 2 | Chuyen bien | Lu Xun | Bien co | Phat hien | hook-03 | Bat ngo | Xung dot |",
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

  it("extracts canonical base chapter and fingerprint from on-disk state", async () => {
    const context = await buildForecastContext({ bookDir, bookId: "demo" });

    expect(context.baseChapter).toBe(2);
    expect(context.language).toBe("vi");
    expect(context.bookTitle).toBe("Sach Thu Nghiem");
    expect(context.sections.authorIntent).toContain("Tuyen bao thu");
    expect(context.sections.currentFocus).toContain("Day manh bang chung");
    expect(context.sections.pendingHooks).toContain("hook-03");
    expect(context.sections.storyFrame).toContain("Do thi bao thu");
    expect(context.sections.recentChapterSummaries).toContain("hook-03");
    expect(context.contextFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for unchanged canon", async () => {
    const first = await buildForecastContext({ bookDir, bookId: "demo" });
    const second = await buildForecastContext({ bookDir, bookId: "demo" });
    expect(second.contextFingerprint).toBe(first.contextFingerprint);
  });

  it("changes the fingerprint when a structured state file changes", async () => {
    const before = await buildForecastContext({ bookDir, bookId: "demo" });
    await writeFile(join(bookDir, "story", "state", "current_state.json"), JSON.stringify({ facts: ["Nhan vat chinh o Tay Thanh"] }), "utf-8");
    const after = await buildForecastContext({ bookDir, bookId: "demo" });
    expect(after.contextFingerprint).not.toBe(before.contextFingerprint);
  });

  it("changes the fingerprint when a new canonical chapter lands", async () => {
    const before = await buildForecastContext({ bookDir, bookId: "demo" });
    await writeFile(join(bookDir, "chapters", "0003_phan_cong.md"), "Chuong 3", "utf-8");
    const after = await buildForecastContext({ bookDir, bookId: "demo" });
    expect(after.contextFingerprint).not.toBe(before.contextFingerprint);
    expect(after.baseChapter).toBe(3);
  });

  it("changes the fingerprint when a control document changes", async () => {
    const before = await buildForecastContext({ bookDir, bookId: "demo" });
    await writeFile(join(bookDir, "story", "current_focus.md"), "# Tieu diem moi\nThu thap manh moi", "utf-8");
    const after = await buildForecastContext({ bookDir, bookId: "demo" });
    expect(after.contextFingerprint).not.toBe(before.contextFingerprint);
  });

  it("changes the fingerprint when the story frame changes", async () => {
    const before = await buildForecastContext({ bookDir, bookId: "demo" });
    await writeFile(join(bookDir, "story", "outline", "story_frame.md"), "# Khung cau chuyen moi\nDo thi hien dai", "utf-8");
    const after = await buildForecastContext({ bookDir, bookId: "demo" });
    expect(after.contextFingerprint).not.toBe(before.contextFingerprint);
  });

  it("changes the fingerprint when the volume map changes", async () => {
    const before = await buildForecastContext({ bookDir, bookId: "demo" });
    await writeFile(join(bookDir, "story", "outline", "volume_map.md"), "# So do quyen moi\nChuong 1-20", "utf-8");
    const after = await buildForecastContext({ bookDir, bookId: "demo" });
    expect(after.contextFingerprint).not.toBe(before.contextFingerprint);
  });

  it("changes the fingerprint when a character role card changes", async () => {
    const before = await buildForecastContext({ bookDir, bookId: "demo" });
    await writeFile(join(bookDir, "story", "roles", "major", "lu_xun.md"), "# Lu Xun\nTrang thai moi da thay doi", "utf-8");
    const after = await buildForecastContext({ bookDir, bookId: "demo" });
    expect(after.contextFingerprint).not.toBe(before.contextFingerprint);
  });

  it("changes the fingerprint when the subplot board changes", async () => {
    const before = await buildForecastContext({ bookDir, bookId: "demo" });
    await writeFile(join(bookDir, "story", "subplot_board.md"), "| Tuyến | Trạng thái |\n| --- | --- |\n| sub-01 | resolved |", "utf-8");
    const after = await buildForecastContext({ bookDir, bookId: "demo" });
    expect(after.contextFingerprint).not.toBe(before.contextFingerprint);
  });

  it("changes the fingerprint when chapter summaries change", async () => {
    const before = await buildForecastContext({ bookDir, bookId: "demo" });
    await writeFile(
      join(bookDir, "story", "chapter_summaries.md"),
      [
        "| Chuong | Tieu de | Nhan vat | Su kien | Bien doi | Hook | Cam xuc | Loai |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| 1 | Mo dau | Lu Xun | Bat dau | Khoi hanh | hook-01 | Cang thang | Khoi dau |",
        "| 2 | Chuyen bien | Lu Xun | Bien co | Phat hien | hook-99 | Bat ngo | Xung dot |",
      ].join("\n"),
      "utf-8",
    );
    const after = await buildForecastContext({ bookDir, bookId: "demo" });
    expect(after.contextFingerprint).not.toBe(before.contextFingerprint);
  });

  it("changes the fingerprint when a new input file appears", async () => {
    const before = await buildForecastContext({ bookDir, bookId: "demo" });
    await writeFile(join(bookDir, "story", "roles", "major", "a_ning.md"), "# A Ning\nVai phu moi", "utf-8");
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
    await writeFile(join(bookDir, "story", "runtime", "scratch.md"), "ghi chu", "utf-8");
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

      expect(markdown).toContain("Tuyen bao thu");
      expect(markdown).toContain("Day manh bang chung");
      expect(markdown).toContain("hook-03");
      expect(markdown).not.toContain("undefined");
    } finally {
      await rm(bookDir, { recursive: true, force: true });
    }
  });
});
