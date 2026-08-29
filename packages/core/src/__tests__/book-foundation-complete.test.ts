import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isBookFoundationComplete } from "../utils/outline-paths.js";

async function writeFoundation(bookDir: string, parts: {
  bookJson?: boolean;
  storyFrame?: boolean;
  volumeMap?: boolean;
  bookRules?: boolean;
  pendingHooks?: boolean;
  role?: boolean;
}): Promise<void> {
  await mkdir(join(bookDir, "story", "outline"), { recursive: true });
  if (parts.bookJson) await writeFile(join(bookDir, "book.json"), "{}");
  if (parts.storyFrame) await writeFile(join(bookDir, "story", "outline", "story_frame.md"), "frame");
  if (parts.volumeMap) await writeFile(join(bookDir, "story", "outline", "volume_map.md"), "map");
  if (parts.bookRules) await writeFile(join(bookDir, "story", "book_rules.md"), "rules");
  if (parts.pendingHooks) await writeFile(join(bookDir, "story", "pending_hooks.md"), "hooks");
  if (parts.role) {
    await mkdir(join(bookDir, "story", "roles", "主要角色"), { recursive: true });
    await writeFile(join(bookDir, "story", "roles", "主要角色", "lead.md"), "lead");
  }
}

describe("isBookFoundationComplete", () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "castor-foundation-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("is true when every foundation file + a major-role sheet exists", async () => {
    await writeFoundation(dir, { bookJson: true, storyFrame: true, volumeMap: true, bookRules: true, pendingHooks: true, role: true });
    expect(await isBookFoundationComplete(dir)).toBe(true);
  });

  it("accepts the English-locale roles dir (major/)", async () => {
    await writeFoundation(dir, { bookJson: true, storyFrame: true, volumeMap: true, bookRules: true, pendingHooks: true });
    await mkdir(join(dir, "story", "roles", "major"), { recursive: true });
    await writeFile(join(dir, "story", "roles", "major", "lead.md"), "lead");
    expect(await isBookFoundationComplete(dir)).toBe(true);
  });

  it("is false for a non-existent book dir", async () => {
    expect(await isBookFoundationComplete(join(dir, "nope"))).toBe(false);
  });

  it("is false when any required foundation file is missing", async () => {
    await writeFoundation(dir, { bookJson: true, storyFrame: true, volumeMap: true, pendingHooks: true, role: true }); // no book_rules
    expect(await isBookFoundationComplete(dir)).toBe(false);
  });

  it("is false when neither a roles/ sheet nor character_matrix.md exists", async () => {
    await writeFoundation(dir, { bookJson: true, storyFrame: true, volumeMap: true, bookRules: true, pendingHooks: true });
    expect(await isBookFoundationComplete(dir)).toBe(false);
  });

  it("accepts roles persisted to legacy character_matrix.md (the runtime's fallback source)", async () => {
    // The architect routinely writes roles to character_matrix.md instead of the
    // roles/ dir; the runtime reads either, so this book IS complete/usable.
    await writeFoundation(dir, { bookJson: true, storyFrame: true, volumeMap: true, bookRules: true, pendingHooks: true });
    await writeFile(join(dir, "story", "character_matrix.md"), "## 林秋\n- 定位: 主角");
    expect(await isBookFoundationComplete(dir)).toBe(true);
  });

  it("does not treat an empty legacy character_matrix pointer as real roles", async () => {
    await writeFoundation(dir, { bookJson: true, storyFrame: true, volumeMap: true, bookRules: true, pendingHooks: true });
    await writeFile(join(dir, "story", "character_matrix.md"), [
      "# 角色矩阵",
      "",
      "兼容提示：新角色卡位于 `story/roles/`。",
      "",
      "## 主要角色",
      "(none)",
    ].join("\n"));
    expect(await isBookFoundationComplete(dir)).toBe(false);
  });
});
