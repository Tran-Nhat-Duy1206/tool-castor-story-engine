import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBookBackup, listBookBackups, restoreBookBackup } from "../book-backup.js";

const logMock = vi.fn();
const logErrorMock = vi.fn();
let projectRoot = "";

vi.mock("../utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils.js")>()),
  findProjectRoot: () => projectRoot,
  log: (message: string) => logMock(message),
  logError: (message: string) => logErrorMock(message),
}));

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true).catch(() => false);
}

async function setupBook(bookId: string): Promise<string> {
  projectRoot = await mkdtemp(join(tmpdir(), "castor-book-backup-"));
  const bookDir = join(projectRoot, "books", bookId);
  await mkdir(join(bookDir, "chapters"), { recursive: true });
  await mkdir(join(bookDir, "story"), { recursive: true });
  await writeFile(join(bookDir, "book.json"), JSON.stringify({ id: bookId, title: bookId, language: "zh" }), "utf-8");
  await writeFile(join(bookDir, "chapters", "0001_Gió Nổi.md"), "Nội dung gốc Chương 1.", "utf-8");
  await writeFile(join(bookDir, "story", "current_state.md"), "Trạng thái gốc", "utf-8");
  return bookDir;
}

const fixedClock = (iso: string) => () => new Date(iso);

describe("book backup module", () => {
  it("snapshots the whole book directory into .castor/backups/<bookId>/<stamp>/", async () => {
    const bookDir = await setupBook("backbook");

    const result = await createBookBackup(projectRoot, "backbook", { now: fixedClock("2026-07-15T08:12:33Z") });

    expect(result.backupId).toBe("20260715-081233");
    const backupDir = join(projectRoot, ".castor", "backups", "backbook", "20260715-081233");
    await expect(readFile(join(backupDir, "chapters", "0001_Gió Nổi.md"), "utf-8")).resolves.toBe("Nội dung gốc Chương 1.");
    await expect(readFile(join(backupDir, "story", "current_state.md"), "utf-8")).resolves.toBe("Trạng thái gốc");
    // The original book stays in place.
    await expect(exists(join(bookDir, "book.json"))).resolves.toBe(true);
  });

  it("produces distinct ids for two backups taken at the same clock instant", async () => {
    await setupBook("twinbook");
    const now = fixedClock("2026-07-15T08:12:33Z");

    const first = await createBookBackup(projectRoot, "twinbook", { now });
    const second = await createBookBackup(projectRoot, "twinbook", { now });

    expect(first.backupId).toBe("20260715-081233");
    expect(second.backupId).toBe("20260715-081233-2");
  });

  it("lists backups newest first", async () => {
    await setupBook("listbook");
    await createBookBackup(projectRoot, "listbook", { now: fixedClock("2026-07-14T10:00:00Z") });
    await createBookBackup(projectRoot, "listbook", { now: fixedClock("2026-07-15T10:00:00Z") });

    const backups = await listBookBackups(projectRoot, "listbook");

    expect(backups.map((b) => b.id)).toEqual(["20260715-100000", "20260714-100000"]);
    expect(backups[0]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns an empty list for a book without backups", async () => {
    await setupBook("nobackups");
    await expect(listBookBackups(projectRoot, "nobackups")).resolves.toEqual([]);
  });

  it("restores a backup and auto-backs-up the current state first", async () => {
    const bookDir = await setupBook("restorebook");
    const backup = await createBookBackup(projectRoot, "restorebook", { now: fixedClock("2026-07-15T08:00:00Z") });

    await writeFile(join(bookDir, "chapters", "0001_Gió Nổi.md"), "Chương 1 bị sửa hỏng.", "utf-8");
    await writeFile(join(bookDir, "chapters", "0002_Chương Thừa.md"), "Chương thừa được viết thêm.", "utf-8");

    const result = await restoreBookBackup(projectRoot, "restorebook", backup.backupId, {
      now: fixedClock("2026-07-15T09:00:00Z"),
    });

    expect(result.restoredFrom).toBe("20260715-080000");
    expect(result.preRestoreBackupId).toBe("20260715-090000-pre-restore");

    // Content is back to the backup point, including removal of extra files.
    await expect(readFile(join(bookDir, "chapters", "0001_Gió Nổi.md"), "utf-8")).resolves.toBe("Nội dung gốc Chương 1.");
    await expect(exists(join(bookDir, "chapters", "0002_Chương Thừa.md"))).resolves.toBe(false);

    // The pre-restore auto-backup preserves the botched state.
    const preRestoreDir = join(projectRoot, ".castor", "backups", "restorebook", "20260715-090000-pre-restore");
    await expect(readFile(join(preRestoreDir, "chapters", "0001_Gió Nổi.md"), "utf-8")).resolves.toBe("Chương 1 bị sửa hỏng.");
    await expect(readFile(join(preRestoreDir, "chapters", "0002_Chương Thừa.md"), "utf-8")).resolves.toBe("Chương thừa được viết thêm.");
  });

  it("rejects backing up a book that does not exist", async () => {
    await setupBook("realbook");
    await expect(createBookBackup(projectRoot, "ghostbook")).rejects.toThrow(/not found/i);
  });

  it("rejects restoring an unknown backup id", async () => {
    await setupBook("orphanbook");
    await expect(restoreBookBackup(projectRoot, "orphanbook", "20990101-000000"))
      .rejects.toThrow(/not found/i);
  });

  it("rejects backup ids containing path separators", async () => {
    await setupBook("evilbook");
    await expect(restoreBookBackup(projectRoot, "evilbook", "../../books/evilbook"))
      .rejects.toThrow(/backup id/i);
  });
});

describe("castor book backup / restore commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a backup, lists it, and restores it via the CLI", async () => {
    const bookDir = await setupBook("cliflow");
    const { bookCommand } = await import("../commands/book.js");

    await bookCommand.parseAsync(["node", "book", "backup", "cliflow", "--json"], { from: "node" });
    expect(logErrorMock).not.toHaveBeenCalled();
    const created = JSON.parse(logMock.mock.calls.at(-1)?.[0] as string) as { backupId: string };
    expect(created.backupId).toMatch(/^\d{8}-\d{6}/);

    await bookCommand.parseAsync(["node", "book", "backup", "cliflow", "--list", "--json"], { from: "node" });
    const listed = JSON.parse(logMock.mock.calls.at(-1)?.[0] as string) as {
      backups: ReadonlyArray<{ id: string }>;
    };
    expect(listed.backups.map((b) => b.id)).toContain(created.backupId);

    await writeFile(join(bookDir, "chapters", "0001_Gió Nổi.md"), "Nội dung bị hỏng.", "utf-8");

    await bookCommand.parseAsync(["node", "book", "restore", "cliflow", created.backupId, "--json"], { from: "node" });
    expect(logErrorMock).not.toHaveBeenCalled();
    const restored = JSON.parse(logMock.mock.calls.at(-1)?.[0] as string) as {
      restoredFrom: string;
      preRestoreBackupId: string | null;
    };
    expect(restored.restoredFrom).toBe(created.backupId);
    expect(restored.preRestoreBackupId).not.toBeNull();

    await expect(readFile(join(bookDir, "chapters", "0001_Gió Nổi.md"), "utf-8")).resolves.toBe("Nội dung gốc Chương 1.");
  });

  it("fails with exit code 1 when restoring a backup that does not exist", async () => {
    await setupBook("clibroken");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    try {
      const { bookCommand } = await import("../commands/book.js");
      await bookCommand.parseAsync(["node", "book", "restore", "clibroken", "20990101-000000"], { from: "node" });

      expect(logErrorMock).toHaveBeenCalledWith(expect.stringContaining("not found"));
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore();
    }
  });
});
