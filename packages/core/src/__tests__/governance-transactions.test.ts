import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import {
  runTransaction,
  recoverTransaction,
  type TransactionInput,
} from "../governance/transactions.js";
import { StateManager } from "../state/manager.js";

let root = "";
let bookDir = "";

async function setupBook(): Promise<void> {
  root = await mkdtemp(join(tmpdir(), "castor-tx-test-"));
  bookDir = join(root, "books", "tx-book");
  await mkdir(join(bookDir, "story"), { recursive: true });
  await writeFile(join(bookDir, "book.json"), JSON.stringify({ id: "tx-book", title: "Tx Book" }), "utf-8");
  await writeFile(join(bookDir, "story", "original.txt"), "Original content\n", "utf-8");
}

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
  bookDir = "";
});

async function fileText(relPath: string): Promise<string | null> {
  try {
    return await readFile(join(bookDir, relPath), "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

describe("TransactionCoordinator (Task 9)", () => {
  it("commits valid writes and deletes atomically", async () => {
    await setupBook();
    const result = await runTransaction({
      bookDir,
      writes: [
        { relativePath: "story/new_file.txt", content: "New file content\n" },
        { relativePath: "story/original.txt", content: "Updated content\n" },
      ],
      deletes: [],
      revalidate: async () => [],
    });

    expect(result.status).toBe("committed");
    expect(await fileText("story/new_file.txt")).toBe("New file content\n");
    expect(await fileText("story/original.txt")).toBe("Updated content\n");
  });

  it("handles file deletion in transaction", async () => {
    await setupBook();
    const result = await runTransaction({
      bookDir,
      writes: [{ relativePath: "story/replacement.txt", content: "Replacement\n" }],
      deletes: ["story/original.txt"],
      revalidate: async () => [],
    });

    expect(result.status).toBe("committed");
    expect(await fileText("story/original.txt")).toBeNull();
    expect(await fileText("story/replacement.txt")).toBe("Replacement\n");
  });

  it("revalidation failure returns revision_base_stale without committing any changes", async () => {
    await setupBook();
    const result = await runTransaction({
      bookDir,
      writes: [{ relativePath: "story/original.txt", content: "Should not be written\n" }],
      deletes: [],
      revalidate: async () => ["Base revision was modified concurrently"],
    });

    expect(result.status).toBe("revision_base_stale");
    if (result.status === "revision_base_stale") {
      expect(result.reasons).toEqual(["Base revision was modified concurrently"]);
    }
    expect(await fileText("story/original.txt")).toBe("Original content\n");
  });

  it("releases book lock on revalidation failure", async () => {
    await setupBook();
    await runTransaction({
      bookDir,
      writes: [{ relativePath: "story/test.txt", content: "test" }],
      deletes: [],
      revalidate: async () => ["Failed"],
    });

    // Should be able to acquire lock immediately because runTransaction released it
    const manager = new StateManager(dirname(bookDir));
    const release = await manager.acquireBookLock(basename(bookDir));
    expect(release).toBeDefined();
    await release();
  });

  it("fault before staging leaves old state intact", async () => {
    await setupBook();
    await expect(
      runTransaction({
        bookDir,
        writes: [{ relativePath: "story/original.txt", content: "Corrupted write\n" }],
        deletes: [],
        revalidate: async () => [],
        failAtStage: "prepare",
      }),
    ).rejects.toThrow(/prepare/i);

    expect(await fileText("story/original.txt")).toBe("Original content\n");
  });

  it("fault during staging leaves old state intact", async () => {
    await setupBook();
    await expect(
      runTransaction({
        bookDir,
        writes: [{ relativePath: "story/original.txt", content: "Corrupted write\n" }],
        deletes: [],
        revalidate: async () => [],
        failAtStage: "stage",
      }),
    ).rejects.toThrow(/stage/i);

    expect(await fileText("story/original.txt")).toBe("Original content\n");
  });

  it("fault before durable commit leaves old state intact", async () => {
    await setupBook();
    await expect(
      runTransaction({
        bookDir,
        writes: [{ relativePath: "story/original.txt", content: "Corrupted write\n" }],
        deletes: [],
        revalidate: async () => [],
        failAtStage: "journal",
      }),
    ).rejects.toThrow(/journal/i);

    expect(await fileText("story/original.txt")).toBe("Original content\n");
  });

  it("fault after durable commit recovers fully to committed state", async () => {
    await setupBook();
    await expect(
      runTransaction({
        bookDir,
        writes: [{ relativePath: "story/original.txt", content: "Committed new content\n" }],
        deletes: [],
        revalidate: async () => [],
        failAtStage: "commit",
      }),
    ).rejects.toThrow(/commit/i);

    // Call recovery explicitly
    await recoverTransaction(bookDir);

    expect(await fileText("story/original.txt")).toBe("Committed new content\n");
  });

  it("fault during materialize recovers fully to committed state", async () => {
    await setupBook();
    await expect(
      runTransaction({
        bookDir,
        writes: [{ relativePath: "story/original.txt", content: "Committed new content\n" }],
        deletes: [],
        revalidate: async () => [],
        failAtStage: "materialize",
      }),
    ).rejects.toThrow(/materialize/i);

    await recoverTransaction(bookDir);

    expect(await fileText("story/original.txt")).toBe("Committed new content\n");
  });

  it("fault during finalize recovers fully and cleans journal", async () => {
    await setupBook();
    await expect(
      runTransaction({
        bookDir,
        writes: [{ relativePath: "story/original.txt", content: "Committed new content\n" }],
        deletes: [],
        revalidate: async () => [],
        failAtStage: "finalize",
      }),
    ).rejects.toThrow(/finalize/i);

    await recoverTransaction(bookDir);

    expect(await fileText("story/original.txt")).toBe("Committed new content\n");
    expect(await fileText("story/governance/.tx-journal.json")).toBeNull();
  });
});