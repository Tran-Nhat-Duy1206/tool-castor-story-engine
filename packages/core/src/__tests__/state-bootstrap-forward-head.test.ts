/**
 * Task 13 follow-up (review M1) — DIRECT loader-level coverage for the
 * forward-head reconciliation rule added to `bootstrapStructuredStateFromMarkdown`.
 *
 * Authority rule under test:
 *   - durable artifact progress (contiguous chapter files + index) is the
 *     default head;
 *   - a CONFIRMED semantic head ABOVE the prefix is preserved ONLY when the
 *     structured documents agree (`current_state.chapter === manifest.head`);
 *   - markdown numbers can NEVER manufacture or promote a head;
 *   - behind-prefix structured heads still normalize UP to the prefix;
 *   - initial books are unaffected.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bootstrapStructuredStateFromMarkdown } from "../state/state-bootstrap.js";
import { StateManifestSchema } from "../models/runtime-state.js";

const CREATED = "2026-08-24T00:00:00.000Z";

async function writeIf(path: string, content: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content, "utf-8");
}

interface SeedOptions {
  readonly prefixThrough: number;
  readonly manifestHead?: number;
  readonly currentStateChapter?: number;
  readonly markdownSummariesRow999?: boolean;
}

async function seedBook(root: string, options: SeedOptions): Promise<string> {
  const bookDir = join(root, "books", "demo-canon-book");
  const storyDir = join(bookDir, "story");
  await mkdir(join(bookDir, "chapters"), { recursive: true });
  await mkdir(join(storyDir, "state"), { recursive: true });
  await writeIf(join(bookDir, "book.json"), JSON.stringify({
    id: "demo-canon-book", title: "mock_text", genre: "urban", language: "vi",
    platform: "other", createdAt: CREATED, updatedAt: CREATED,
  }));
  const index = Array.from({ length: options.prefixThrough }, (_, i) => i + 1).map((number) => ({
    number,
    title: `Chương ${number}mock_text`,
    status: "approved",
    wordCount: 100,
    createdAt: CREATED,
    updatedAt: CREATED,
  }));
  await writeIf(join(bookDir, "chapters", "index.json"), JSON.stringify(index));
  for (let chapter = 1; chapter <= options.prefixThrough; chapter += 1) {
    await writeIf(
      join(bookDir, "chapters", `${String(chapter).padStart(4, "0")}_Chương ${chapter}mock_text.md`),
      `# Chương ${chapter}mock_text\n\nmock_text。\n`,
    );
  }
  if (options.manifestHead !== undefined) {
    await writeIf(join(storyDir, "state", "manifest.json"), JSON.stringify({
      schemaVersion: 2,
      language: "vi",
      lastAppliedChapter: options.manifestHead,
      projectionVersion: 3,
      migrationWarnings: [],
    }, null, 2));
  }
  if (options.currentStateChapter !== undefined) {
    await writeIf(join(storyDir, "state", "current_state.json"), JSON.stringify({
      chapter: options.currentStateChapter,
      facts: [{
        subject: "protagonist",
        predicate: "mock_text",
        object: "mock_text",
        validFromChapter: options.currentStateChapter,
        validUntilChapter: null,
        sourceChapter: options.currentStateChapter,
      }],
    }, null, 2));
  }
  if (options.markdownSummariesRow999) {
    // Hallucinated markdown row FAR beyond the durable prefix.
    await writeIf(join(storyDir, "chapter_summaries.md"), [
      "# mock_text",
      "",
      "| mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      "| 999 | mock_text | mock_text | mock_text | mock_text | | mock_text | mock_text |",
      "",
    ].join("\n"));
  }
  return bookDir;
}

async function loadResultManifest(bookDir: string) {
  return StateManifestSchema.parse(JSON.parse(
    await readFile(join(bookDir, "story", "state", "manifest.json"), "utf-8"),
  ));
}

describe("state-bootstrap forward-head authority matrix (Task 13 follow-up)", () => {
  let root = "";

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true }).catch(() => undefined);
    root = "";
  });

  it("A. prefix25 / manifest25 / current25 → stays 25 (no warning)", async () => {
    root = await mkdtemp(join(tmpdir(), "castor-boot-a-"));
    const bookDir = await seedBook(root, {
      prefixThrough: 25, manifestHead: 25, currentStateChapter: 25,
    });
    const result = await bootstrapStructuredStateFromMarkdown({ bookDir });
    expect(result.manifest.lastAppliedChapter).toBe(25);
    expect(result.warnings.join("\n")).not.toMatch(/normalized/);
  });

  it("B. prefix25 / manifest26 / current26 → CONFIRMED structured head preserved at 26, no normalization warning", async () => {
    root = await mkdtemp(join(tmpdir(), "castor-boot-b-"));
    const bookDir = await seedBook(root, {
      prefixThrough: 25, manifestHead: 26, currentStateChapter: 26,
    });
    const result = await bootstrapStructuredStateFromMarkdown({ bookDir });
    expect(result.manifest.lastAppliedChapter).toBe(26);
    expect(result.warnings.join("\n")).not.toMatch(/lastAppliedChapter normalized/);
    expect((await loadResultManifest(bookDir)).lastAppliedChapter).toBe(26);
  });

  it("C. prefix25 / manifest26 / current25 → disagreement is NOT trusted; clamped back to 25 WITH warning", async () => {
    root = await mkdtemp(join(tmpdir(), "castor-boot-c-"));
    const bookDir = await seedBook(root, {
      prefixThrough: 25, manifestHead: 26, currentStateChapter: 25,
    });
    const result = await bootstrapStructuredStateFromMarkdown({ bookDir });
    expect(result.manifest.lastAppliedChapter).toBe(25);
    expect(result.warnings.join("\n")).toMatch(/lastAppliedChapter normalized from 26 to 25/);
  });

  it("D. prefix25 / structured25 / markdown claims chapter 999 → stays 25 (markdown can never lead)", async () => {
    root = await mkdtemp(join(tmpdir(), "castor-boot-d-"));
    const bookDir = await seedBook(root, {
      prefixThrough: 25, manifestHead: 25, currentStateChapter: 25,
      markdownSummariesRow999: true,
    });
    const result = await bootstrapStructuredStateFromMarkdown({ bookDir });
    expect(result.manifest.lastAppliedChapter).toBe(25);
    expect((await loadResultManifest(bookDir)).lastAppliedChapter).toBe(25);
  });

  it("E. prefix25 / structured20 → existing normalization UP to the durable prefix still works", async () => {
    root = await mkdtemp(join(tmpdir(), "castor-boot-e-"));
    const bookDir = await seedBook(root, {
      prefixThrough: 25, manifestHead: 20, currentStateChapter: 20,
    });
    const result = await bootstrapStructuredStateFromMarkdown({ bookDir });
    expect(result.manifest.lastAppliedChapter).toBe(25);
  });

  it("F. initial/empty book → unchanged initial semantics (head 0, file created)", async () => {
    root = await mkdtemp(join(tmpdir(), "castor-boot-f-"));
    const bookDir = join(root, "books", "empty-book");
    await mkdir(join(bookDir), { recursive: true });
    await writeIf(join(bookDir, "book.json"), JSON.stringify({
      id: "empty-book", title: "mock_text", genre: "urban", language: "vi",
      platform: "other", createdAt: CREATED, updatedAt: CREATED,
    }));
    const result = await bootstrapStructuredStateFromMarkdown({ bookDir });
    expect(result.manifest.lastAppliedChapter).toBe(0);
    expect(result.createdFiles).toContain("manifest.json");
  });
});
