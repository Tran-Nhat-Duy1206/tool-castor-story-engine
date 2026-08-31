import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadChaptersFromPath } from "../agent/chapter-import-source.js";

describe("loadChaptersFromPath", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("loads unpadded chapter files in natural numeric order", async () => {
    const root = await mkdtemp(join(tmpdir(), "castor-chapter-import-"));
    roots.push(root);
    const source = join(root, "chapters");
    await mkdir(source);
    await Promise.all([
      writeFile(join(source, "10_mock_text.md"), "ten"),
      writeFile(join(source, "2_mock_text.md"), "two"),
      writeFile(join(source, "1_mock_text.md"), "one"),
    ]);

    const chapters = await loadChaptersFromPath(source);

    expect(chapters.map((chapter) => chapter.title)).toEqual(["mock_text", "mock_text", "mock_text"]);
    expect(chapters.map((chapter) => chapter.content)).toEqual(["one", "two", "ten"]);
  });
});
