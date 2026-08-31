import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ChapterMeta } from "../models/chapter.js";
import {
  classifyTruthAuthority,
  normalizeTruthFileName,
} from "../interaction/truth-authority.js";
import {
  executeEditTransaction,
  planEditTransaction,
  type EditRequest,
} from "../interaction/edit-controller.js";
import { listChapterVersions, readChapterVersion } from "../state/chapter-workspace.js";

let projectRoot: string;

beforeAll(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "castor-edit-controller-"));
  await mkdir(join(projectRoot, "books", "harbor", "story", "runtime"), { recursive: true });
  await mkdir(join(projectRoot, "books", "harbor", "chapters"), { recursive: true });
});

describe("truth authority", () => {
  it("normalizes supported truth files", () => {
    expect(normalizeTruthFileName("story_bible")).toBe("story_bible.md");
    expect(normalizeTruthFileName("current_state.md")).toBe("current_state.md");
  });

  it("classifies control and truth authority tiers", () => {
    expect(classifyTruthAuthority("author_intent.md")).toBe("direction");
    expect(classifyTruthAuthority("current_focus.md")).toBe("direction");
    expect(classifyTruthAuthority("story_bible.md")).toBe("foundation");
    expect(classifyTruthAuthority("book_rules.md")).toBe("rules");
    expect(classifyTruthAuthority("current_state.md")).toBe("runtime-truth");
  });
});

describe("edit controller", () => {
  it("plans entity rename transactions", () => {
    const result = planEditTransaction({
      kind: "entity-rename",
      bookId: "harbor",
      entityType: "protagonist",
      oldValue: "mock_text",
      newValue: "mock_text",
    });

    expect(result.transactionType).toBe("entity-rename");
    expect(result.affectedScope).toBe("book");
    expect(result.requiresTruthRebuild).toBe(true);
  });

  it("plans chapter rewrite transactions", () => {
    const result = planEditTransaction({
      kind: "chapter-rewrite",
      bookId: "harbor",
      chapterNumber: 3,
      instruction: "Keep the ending reveal.",
    });

    expect(result.transactionType).toBe("chapter-rewrite");
    expect(result.affectedScope).toBe("downstream");
    expect(result.requiresTruthRebuild).toBe(true);
  });

  it("plans whole-chapter replacement transactions as chapter-scoped edits", () => {
    const result = planEditTransaction({
      kind: "chapter-replace",
      bookId: "harbor",
      chapterNumber: 3,
      fullText: "# Chương 3 mock_text\n\nmock_text。",
    });

    expect(result.transactionType).toBe("chapter-replace");
    expect(result.affectedScope).toBe("chapter");
    expect(result.requiresTruthRebuild).toBe(true);
  });

  it("plans local text edits without forcing full-book rebuild", () => {
    const result = planEditTransaction({
      kind: "chapter-local-edit",
      bookId: "harbor",
      chapterNumber: 5,
      instruction: "Only rewrite the final paragraph.",
    });

    expect(result.transactionType).toBe("chapter-local-edit");
    expect(result.affectedScope).toBe("chapter");
    expect(result.requiresTruthRebuild).toBe(true);
  });

  it("plans truth-file edits with authority metadata", () => {
    const result = planEditTransaction({
      kind: "truth-file-edit",
      bookId: "harbor",
      fileName: "book_rules",
      instruction: "Lock the protagonist name to Lin Yan.",
    });

    expect(result.transactionType).toBe("truth-file-edit");
    expect(result.truthAuthority).toBe("rules");
    expect(result.affectedScope).toBe("book");
  });

  it("plans focus edits as direction-level transactions", () => {
    const result = planEditTransaction({
      kind: "focus-edit",
      bookId: "harbor",
      instruction: "Bring the story back to the old case.",
    });

    expect(result.transactionType).toBe("focus-edit");
    expect(result.truthAuthority).toBe("direction");
    expect(result.affectedScope).toBe("future");
    expect(result.requiresTruthRebuild).toBe(false);
  });

  it("executes entity rename across truth files and chapters", async () => {
    const bookDir = join(projectRoot, "books", "harbor");
    await writeFile(join(bookDir, "story", "story_bible.md"), "mock_text。", "utf-8");
    await writeFile(join(bookDir, "chapters", "0001_mock_text từ.md"), "# Chương 1 mock_text từ\n\nmock_text。", "utf-8");

    const result = await executeEditTransaction(
      {
        bookDir: (bookId) => join(projectRoot, "books", bookId),
        loadChapterIndex: async () => [],
        saveChapterIndex: async () => undefined,
      },
      {
        kind: "entity-rename",
        bookId: "harbor",
        entityType: "protagonist",
        oldValue: "mock_text",
        newValue: "mock_text",
      },
    );

    await expect(readFile(join(bookDir, "story", "story_bible.md"), "utf-8")).resolves.toContain("mock_text");
    await expect(readFile(join(bookDir, "chapters", "0001_mock_text từ.md"), "utf-8")).resolves.toContain("mock_text");
    expect(result.touchedFiles.length).toBeGreaterThan(0);
  });

  it("does not rewrite trashed chapters during entity rename", async () => {
    const bookDir = join(projectRoot, "books", "trashbook");
    await mkdir(join(bookDir, "story"), { recursive: true });
    await mkdir(join(bookDir, "chapters", ".trash"), { recursive: true });
    await writeFile(join(bookDir, "story", "story_bible.md"), "mock_text。", "utf-8");
    await writeFile(join(bookDir, "chapters", ".trash", "0009_mock_text.md"), "mock_text。", "utf-8");

    await executeEditTransaction(
      {
        bookDir: (bookId) => join(projectRoot, "books", bookId),
        loadChapterIndex: async () => [],
        saveChapterIndex: async () => undefined,
      },
      {
        kind: "entity-rename",
        bookId: "trashbook",
        entityType: "protagonist",
        oldValue: "mock_text",
        newValue: "mock_text",
      },
    );

    await expect(readFile(join(bookDir, "story", "story_bible.md"), "utf-8")).resolves.toContain("mock_text");
    await expect(readFile(join(bookDir, "chapters", ".trash", "0009_mock_text.md"), "utf-8")).resolves.toContain("mock_text");
  });

  it("does not rewrite story snapshots during entity rename", async () => {
    const bookDir = join(projectRoot, "books", "harbor");
    await writeFile(join(bookDir, "story", "story_bible.md"), "mock_text。", "utf-8");
    await mkdir(join(bookDir, "story", "snapshots", "1"), { recursive: true });
    await writeFile(join(bookDir, "story", "snapshots", "1", "current_state.md"), "mock_text。", "utf-8");

    await executeEditTransaction(
      {
        bookDir: (bookId) => join(projectRoot, "books", bookId),
        loadChapterIndex: async () => [],
        saveChapterIndex: async () => undefined,
      },
      {
        kind: "entity-rename",
        bookId: "harbor",
        entityType: "protagonist",
        oldValue: "mock_text",
        newValue: "mock_text",
      },
    );

    await expect(readFile(join(bookDir, "story", "story_bible.md"), "utf-8")).resolves.toContain("mock_text");
    await expect(readFile(join(bookDir, "story", "snapshots", "1", "current_state.md"), "utf-8")).resolves.toContain("mock_text");
  });

  it("renames entity files whose filename embeds the old name so path references don't dangle", async () => {
    const bookDir = join(projectRoot, "books", "rolebook");
    await mkdir(join(bookDir, "roles", "major"), { recursive: true });
    await mkdir(join(bookDir, "story"), { recursive: true });
    await writeFile(join(bookDir, "roles", "major", "mock_textdefault.md"), "# mock_textdefault\n\nmock_textdefaultmock_text。", "utf-8");
    // A manifest that references the role file by path — the path must follow the rename.
    await writeFile(join(bookDir, "story", "story_bible.md"), "mock_text roles/major/mock_textdefault.md。", "utf-8");

    const result = await executeEditTransaction(
      {
        bookDir: (bookId) => join(projectRoot, "books", bookId),
        loadChapterIndex: async () => [],
        saveChapterIndex: async () => undefined,
      },
      {
        kind: "entity-rename",
        bookId: "rolebook",
        entityType: "protagonist",
        oldValue: "mock_textdefault",
        newValue: "mock_text",
      },
    );

    // The file is renamed on disk and its content updated.
    await expect(readFile(join(bookDir, "roles", "major", "mock_text.md"), "utf-8")).resolves.toContain("mock_text");
    // The old filename is gone — no dangling reference.
    await expect(access(join(bookDir, "roles", "major", "mock_textdefault.md")).then(() => true).catch(() => false))
      .resolves.toBe(false);
    // The manifest's path reference now points at the renamed file.
    await expect(readFile(join(bookDir, "story", "story_bible.md"), "utf-8"))
      .resolves.toContain("roles/major/mock_text.md");
    expect(result.touchedFiles).toContain(join("roles", "major", "mock_text.md"));
    expect(result.summary).toContain("renamed on disk");
  });

  it("aborts an entity rename when the target filename already exists, without rewriting content", async () => {
    const bookDir = join(projectRoot, "books", "collisionbook");
    await mkdir(join(bookDir, "roles", "major"), { recursive: true });
    await writeFile(join(bookDir, "roles", "major", "mock_text.md"), "mock_text。", "utf-8");
    await writeFile(join(bookDir, "roles", "major", "mock_text.md"), "mock_text,mock_text。", "utf-8");

    await expect(executeEditTransaction(
      {
        bookDir: (bookId) => join(projectRoot, "books", bookId),
        loadChapterIndex: async () => [],
        saveChapterIndex: async () => undefined,
      },
      {
        kind: "entity-rename",
        bookId: "collisionbook",
        entityType: "character",
        oldValue: "mock_text",
        newValue: "mock_text",
      },
    )).rejects.toThrow(/already exists/);

    // The collision is detected before any write — content stays untouched (no partial application).
    await expect(readFile(join(bookDir, "roles", "major", "mock_text.md"), "utf-8")).resolves.toBe("mock_text,mock_text。");
  });

  it("rejects a rename target that contains a path separator", async () => {
    await expect(executeEditTransaction(
      {
        bookDir: (bookId) => join(projectRoot, "books", bookId),
        loadChapterIndex: async () => [],
        saveChapterIndex: async () => undefined,
      },
      {
        kind: "entity-rename",
        bookId: "harbor",
        entityType: "character",
        oldValue: "mock_text",
        newValue: "../evil",
      },
    )).rejects.toThrow(/path separators/);
  });

  it("executes chapter text patches and marks the chapter for review", async () => {
    const bookDir = join(projectRoot, "books", "harbor");
    await writeFile(join(bookDir, "chapters", "0003_mock_text.md"), "# Chương 3 mock_text\n\nmock_text từmock_text。", "utf-8");
    await writeFile(join(bookDir, "story", "runtime", "chapter-0003.intent.md"), "stale", "utf-8");
    const chapterIndex = [{
      number: 3,
      title: "mock_text",
      status: "ready-for-review" as const,
      wordCount: 12,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      auditIssues: [],
      lengthWarnings: [],
    }];

    let savedIndex: ChapterMeta[] = [...chapterIndex];
    const result = await executeEditTransaction(
      {
        bookDir: (bookId) => join(projectRoot, "books", bookId),
        loadChapterIndex: async () => chapterIndex,
        saveChapterIndex: async (_bookId, index) => {
          savedIndex = [...index];
        },
      },
      {
        kind: "chapter-local-edit",
        bookId: "harbor",
        chapterNumber: 3,
        instruction: "Replace old text",
        targetText: "mock_text từ",
        replacementText: "mock_text từ",
      },
    );

    await expect(readFile(join(bookDir, "chapters", "0003_mock_text.md"), "utf-8")).resolves.toContain("mock_text từ");
    const versions = await listChapterVersions(bookDir, 3);
    expect(versions).toHaveLength(1);
    await expect(readChapterVersion(bookDir, 3, versions[0]!.id))
      .resolves.toContain("mock_text từ");
    expect(savedIndex[0]?.status).toBe("audit-failed");
    expect(savedIndex[0]?.auditIssues.at(-1)).toContain("Manual text edit requires review");
    expect(result.reviewRequired).toBe(true);
  });

  it("updates the index word count when patching chapter text", async () => {
    const bookDir = join(projectRoot, "books", "harbor");
    await writeFile(join(bookDir, "chapters", "0005_mock_text.md"), "# Chương 5 mock_text\n\nmock_text。", "utf-8");
    const chapterIndex = [{
      number: 5,
      title: "mock_text",
      status: "ready-for-review" as const,
      wordCount: 999,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      auditIssues: [],
      lengthWarnings: [],
    }];

    let savedIndex: ChapterMeta[] = [...chapterIndex];
    await executeEditTransaction(
      {
        bookDir: (bookId) => join(projectRoot, "books", bookId),
        loadChapterIndex: async () => chapterIndex,
        saveChapterIndex: async (_bookId, index) => {
          savedIndex = [...index];
        },
      },
      {
        kind: "chapter-local-edit",
        bookId: "harbor",
        chapterNumber: 5,
        instruction: "Replace the recount detail",
        targetText: "mock_text",
        replacementText: "mock_text，mock_text",
      },
    );

    // Heading + whitespace stripped: "mock_text，mock_text。" → 14 chars.
    expect(savedIndex[0]?.wordCount).toBe(14);
  });

  it("patches chapter text when the target only differs by whitespace", async () => {
    const bookDir = join(projectRoot, "books", "harbor");
    await writeFile(
      join(bookDir, "chapters", "0004_mock_text.md"),
      "# Chương 4 mock_text\n\nmock_text\nmock_text，mock_text。",
      "utf-8",
    );
    const chapterIndex = [{
      number: 4,
      title: "mock_text",
      status: "ready-for-review" as const,
      wordCount: 18,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      auditIssues: [],
      lengthWarnings: [],
    }];

    const result = await executeEditTransaction(
      {
        bookDir: (bookId) => join(projectRoot, "books", bookId),
        loadChapterIndex: async () => chapterIndex,
        saveChapterIndex: async () => undefined,
      },
      {
        kind: "chapter-local-edit",
        bookId: "harbor",
        chapterNumber: 4,
        instruction: "Patch wrapped text",
        targetText: "mock_text mock_text",
        replacementText: "mock_text",
      },
    );

    await expect(readFile(join(bookDir, "chapters", "0004_mock_text.md"), "utf-8"))
      .resolves.toContain("mock_text，mock_text。");
    expect(result.reviewRequired).toBe(true);
  });

  it("executes whole-chapter replacement as one atomic state-relevant save", async () => {
    const bookDir = join(projectRoot, "books", "replacebook");
    await mkdir(join(bookDir, "chapters"), { recursive: true });
    await mkdir(join(bookDir, "story", "runtime"), { recursive: true });
    await writeFile(join(bookDir, "chapters", "0002_mock_text.md"), "# Chương 2 mock_text\n\nmock_text。", "utf-8");
    await writeFile(join(bookDir, "story", "runtime", "chapter-0002.plan.md"), "stale plan", "utf-8");
    await writeFile(
      join(bookDir, "story", "runtime", "chapter-0002.user-brief.md"),
      "mock_text。\n",
      "utf-8",
    );
    const chapterIndex = [{
      number: 2,
      title: "mock_text",
      status: "ready-for-review" as const,
      wordCount: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      auditIssues: [],
      lengthWarnings: [],
    }];

    const savedIndex: ChapterMeta[][] = [];
    const result = await executeEditTransaction(
      {
        bookDir: (bookId) => join(projectRoot, "books", bookId),
        loadChapterIndex: async () => chapterIndex,
        saveChapterIndex: async (_bookId, index) => {
          savedIndex.push([...index]);
        },
      },
      {
        kind: "chapter-replace",
        bookId: "replacebook",
        chapterNumber: 2,
        fullText: "# Chương 2 mock_text\n\nmock_text。",
      },
    );

    await expect(readFile(join(bookDir, "chapters", "0002_mock_text.md"), "utf-8")).resolves.toContain("mock_text");
    const versions = await listChapterVersions(bookDir, 2);
    expect(versions).toHaveLength(1);
    await expect(readChapterVersion(bookDir, 2, versions[0]!.id))
      .resolves.toContain("mock_text");
    await expect(access(join(bookDir, "story", "runtime", "chapter-0002.plan.md")).then(() => true).catch(() => false))
      .resolves.toBe(false);
    await expect(readFile(join(bookDir, "story", "runtime", "chapter-0002.user-brief.md"), "utf-8"))
      .resolves.toBe("mock_text。\n");
    // Task 9: index is written INSIDE the atomic set — saveChapterIndex is NOT
    // called and the lifecycle lands on needs-state-review on disk.
    expect(savedIndex).toEqual([]);
    const indexOnDisk = JSON.parse(await readFile(join(bookDir, "chapters", "index.json"), "utf-8"));
    expect(indexOnDisk[0].status).toBe("needs-state-review");
    expect(indexOnDisk[0].auditIssues).toEqual([]);
    // The review artifact becomes a non-confirmable rebuild_required shell.
    const shell = JSON.parse(
      await readFile(join(bookDir, "story", "runtime", "chapter-0002.state-review.json"), "utf-8"),
    );
    expect(shell.status).toBe("rebuild_required");
    expect(shell.sourceChapter).toBe(2);
    expect(result.reviewRequired).toBe(true);
    expect(result.summary).toContain("Replaced chapter 2");
  });

  it("does not swallow unexpected filesystem errors while collecting editable files", async () => {
    const invalidRoot = join(projectRoot, "invalid-root.txt");
    await writeFile(invalidRoot, "not a directory", "utf-8");

    await expect(executeEditTransaction(
      {
        bookDir: () => invalidRoot,
        loadChapterIndex: async () => [],
        saveChapterIndex: async () => undefined,
      },
      {
        kind: "entity-rename",
        bookId: "harbor",
        entityType: "protagonist",
        oldValue: "mock_text",
        newValue: "mock_text",
      },
    )).rejects.toThrow(/not a directory|ENOTDIR/i);
  });
});
