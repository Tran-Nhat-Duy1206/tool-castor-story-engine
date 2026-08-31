import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  archiveChapterVersion,
  listChapterVersions,
  readChapterPlanDocument,
  readChapterUserBrief,
  readChapterVersion,
  saveChapterUserBrief,
} from "../state/chapter-workspace.js";

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true).catch(() => false);
}

describe("chapter workspace", () => {
  it("persists, reads, and clears a per-chapter user brief", async () => {
    const bookDir = await mkdtemp(join(tmpdir(), "castor-chapter-workspace-"));

    await expect(readChapterUserBrief(bookDir, 3)).resolves.toBe("");
    await saveChapterUserBrief(bookDir, 3, "  mock_text，mock_text。  ");
    await expect(readChapterUserBrief(bookDir, 3)).resolves.toBe("mock_text，mock_text。");

    await saveChapterUserBrief(bookDir, 3, " \n ");
    await expect(readChapterUserBrief(bookDir, 3)).resolves.toBe("");
    await expect(exists(join(bookDir, "story", "runtime", "chapter-0003.user-brief.md")))
      .resolves.toBe(false);
  });

  it("reads the persisted system plan without requiring one to exist", async () => {
    const bookDir = await mkdtemp(join(tmpdir(), "castor-chapter-workspace-"));
    await expect(readChapterPlanDocument(bookDir, 2)).resolves.toBeNull();

    const runtimeDir = join(bookDir, "story", "runtime");
    await mkdir(runtimeDir, { recursive: true });
    await writeFile(join(runtimeDir, "chapter-0002.plan.md"), "# Chapter 2 Plan\n\nKeep the witness alive.", "utf-8");

    await expect(readChapterPlanDocument(bookDir, 2))
      .resolves.toBe("# Chapter 2 Plan\n\nKeep the witness alive.");
  });

  it("archives immutable chapter versions and lists newest first", async () => {
    const bookDir = await mkdtemp(join(tmpdir(), "castor-chapter-workspace-"));
    const first = await archiveChapterVersion(
      bookDir,
      4,
      "# Chương 4 mock_text\n\nmock_text。",
      "manual",
      new Date("2026-07-01T00:00:00.000Z"),
    );
    const second = await archiveChapterVersion(
      bookDir,
      4,
      "# Chương 4 mock_text\n\nmock_text。",
      "revision",
      new Date("2026-07-02T00:00:00.000Z"),
    );

    expect(first.id).not.toBe(second.id);
    await expect(readChapterVersion(bookDir, 4, first.id))
      .resolves.toBe("# Chương 4 mock_text\n\nmock_text。");
    await expect(readChapterVersion(bookDir, 4, second.id))
      .resolves.toBe("# Chương 4 mock_text\n\nmock_text。");

    const versions = await listChapterVersions(bookDir, 4);
    expect(versions.map((version) => version.id)).toEqual([second.id, first.id]);
    expect(versions.map((version) => version.source)).toEqual(["revision", "manual"]);
    expect(versions.map((version) => version.createdAt)).toEqual([
      "2026-07-02T00:00:00.000Z",
      "2026-07-01T00:00:00.000Z",
    ]);
    expect(versions.map((version) => version.characterCount)).toEqual([
      "# Chương 4 mock_text\n\nmock_text。".length,
      "# Chương 4 mock_text\n\nmock_text。".length,
    ]);
  });

  it("rejects unsafe version ids instead of reading outside the archive", async () => {
    const bookDir = await mkdtemp(join(tmpdir(), "castor-chapter-workspace-"));
    await expect(readChapterVersion(bookDir, 1, "../book.json"))
      .rejects.toThrow(/invalid chapter version id/i);
  });

  it("does not expose archives from another chapter", async () => {
    const bookDir = await mkdtemp(join(tmpdir(), "castor-chapter-workspace-"));
    const version = await archiveChapterVersion(
      bookDir,
      1,
      "# Chương 1",
      "regeneration",
      new Date("2026-07-03T00:00:00.000Z"),
    );

    await expect(readChapterVersion(bookDir, 2, version.id)).rejects.toThrow();
    await expect(readFile(
      join(bookDir, "chapters", ".versions", "0001", `${version.id}.md`),
      "utf-8",
    )).resolves.toBe("# Chương 1");
  });
});
