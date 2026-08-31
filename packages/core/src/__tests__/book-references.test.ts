import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ingestMaterial } from "../materials/ingest.js";
import {
  bindBookReference,
  listBookReferences,
  unbindBookReference,
} from "../references/book-references.js";
import { selectBookReferenceContext } from "../references/reference-context.js";

describe("book reference bindings", () => {
  let root: string;
  const bookId = "reference-book";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "castor-book-reference-"));
    await mkdir(join(root, "books", bookId, "story"), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("stores one project asset and only a purpose binding inside the target book", async () => {
    const asset = await createReferenceAsset(root, "mock_text", [
      "# mock_text",
      "mock_text。",
      "",
      "# mock_text",
      "mock_text，mock_text。",
    ].join("\n"));

    const first = await bindBookReference(root, bookId, {
      materialId: asset.id,
      uses: ["mock_text", "mock_text"],
      note: "mock_text，mock_text。",
    }, { now: () => new Date("2026-08-03T01:00:00.000Z") });
    const updated = await bindBookReference(root, bookId, {
      materialId: asset.id,
      uses: ["mock_text"],
    }, { now: () => new Date("2026-08-03T02:00:00.000Z") });

    expect(first.bindings).toHaveLength(1);
    expect(updated.bindings).toHaveLength(1);
    expect(updated.bindings[0]).toMatchObject({
      materialId: asset.id,
      uses: ["mock_text"],
      createdAt: "2026-08-03T01:00:00.000Z",
      updatedAt: "2026-08-03T02:00:00.000Z",
    });

    const bindingText = await readFile(
      join(root, "books", bookId, "story", "reference_bindings.json"),
      "utf-8",
    );
    expect(bindingText).not.toContain("mock_text");
    expect(bindingText).not.toContain("mock_text");
    expect(await readFile(join(root, asset.markdownPath), "utf-8")).toContain("mock_text");
  });

  it("lists resolved assets, surfaces missing assets, and unbinds without deleting the asset", async () => {
    const asset = await createReferenceAsset(root, "mock_text", "# mock_text\nmock_text。\n");
    await bindBookReference(root, bookId, { materialId: asset.id, uses: ["mock_text"] });
    await writeFile(
      join(root, "books", bookId, "story", "reference_bindings.json"),
      JSON.stringify({
        version: 1,
        bookId,
        bindings: [
          ...(await listBookReferences(root, bookId)).manifest.bindings,
          {
            materialId: "missing-material",
            uses: ["mock_text"],
            createdAt: "2026-08-03T00:00:00.000Z",
            updatedAt: "2026-08-03T00:00:00.000Z",
          },
        ],
      }, null, 2),
      "utf-8",
    );

    const listed = await listBookReferences(root, bookId);
    expect(listed.references).toEqual(expect.arrayContaining([
      expect.objectContaining({ materialId: asset.id, title: "mock_text", available: true }),
      expect.objectContaining({ materialId: "missing-material", available: false }),
    ]));

    const removed = await unbindBookReference(root, bookId, asset.id);
    expect(removed.removed).toBe(true);
    await expect(readFile(join(root, asset.markdownPath), "utf-8")).resolves.toContain("mock_text");
  });
});

describe("book reference context selection", () => {
  let root: string;
  const bookId = "selection-book";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "castor-reference-context-"));
    await mkdir(join(root, "books", bookId, "story"), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("lets the model select full sections from bound assets only", async () => {
    const bound = await createReferenceAsset(root, "mock_text", [
      "# mock_text",
      "Chương mock_text。",
      "Chương mock_text。",
      "",
      "# mock_text",
      "mock_text。",
    ].join("\n"));
    await createReferenceAsset(root, "mock_text", "# mock_text\nmock_text。\n");
    await bindBookReference(root, bookId, {
      materialId: bound.id,
      uses: ["mock_text"],
      note: "mock_text。",
    });

    const selector = vi.fn(async (request: Parameters<NonNullable<Parameters<typeof selectBookReferenceContext>[3]>>[0]) => {
      expect(request.candidates).toHaveLength(2);
      expect(request.candidates.every((candidate) => candidate.materialId === bound.id)).toBe(true);
      expect(request.candidates[0]?.uses).toEqual(["mock_text"]);
      expect(request.candidates.map((candidate) => candidate.heading)).not.toContain("mock_text");
      return [request.candidates.find((candidate) => candidate.heading === "mock_text")!.source];
    });

    const selected = await selectBookReferenceContext(root, bookId, {
      chapterNumber: 1,
      goal: "mock_text",
      outlineNode: "mock_text",
      mustKeep: ["Chương mock_text"],
      language: "vi",
    }, selector);

    expect(selector).toHaveBeenCalledOnce();
    expect(selected.notes).toEqual([]);
    expect(selected.entries).toEqual([
      expect.objectContaining({
        source: expect.stringMatching(new RegExp(`^reference/${bound.id}#`)),
        reason: expect.stringContaining("mock_text"),
        excerpt: "# mock_text\nChương mock_text。\nChương mock_text。",
      }),
    ]);
  });

  it("fails open when semantic selection is unavailable instead of dumping every reference into context", async () => {
    const asset = await createReferenceAsset(root, "mock_text", "# mock_text\nA\n\n# mock_text\nB\n");
    await bindBookReference(root, bookId, { materialId: asset.id, uses: ["mock_text"] });

    const selected = await selectBookReferenceContext(root, bookId, {
      chapterNumber: 8,
      goal: "mock_text",
      outlineNode: "Chương mock_text",
      mustKeep: [],
      language: "vi",
    }, async () => {
      throw new Error("selector unavailable");
    });

    expect(selected.entries).toEqual([]);
    expect(selected.notes).toEqual(["book-reference-selection-failed"]);
  });

  it("lets semantic selection exclude a single-section asset instead of injecting it into every chapter", async () => {
    const asset = await createReferenceAsset(root, "mock_text", "mock_text。\n");
    await bindBookReference(root, bookId, { materialId: asset.id, uses: ["mock_text"] });
    const selector = vi.fn(async () => []);

    const selected = await selectBookReferenceContext(root, bookId, {
      chapterNumber: 3,
      goal: "mock_text",
      outlineNode: "mock_text",
      mustKeep: [],
      language: "vi",
    }, selector);

    expect(selector).toHaveBeenCalledOnce();
    expect(selected.entries).toEqual([]);
    expect(selected.notes).toEqual([]);
  });
});

async function createReferenceAsset(root: string, title: string, content: string) {
  const sourcePath = `${title}.md`;
  await writeFile(join(root, sourcePath), content, "utf-8");
  return ingestMaterial(root, {
    sourceKind: "file",
    filePath: sourcePath,
    title,
    purpose: "reference",
  }, {
    now: () => new Date(`2026-08-03T00:00:0${title.length % 10}.000Z`),
  });
}
