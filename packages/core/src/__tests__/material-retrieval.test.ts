import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ingestMaterial } from "../materials/ingest.js";
import { retrieveMaterials } from "../materials/retrieve.js";

describe("material retrieval", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "castor-material-retrieve-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("returns traceable snippets from archived materials", async () => {
    await writeFile(join(root, "cold.md"), [
      "# mock_text",
      "",
      "mock_text 0607 mock_text。",
      "mock_text。",
    ].join("\n"), "utf-8");
    await writeFile(join(root, "romance.md"), [
      "# mock_text",
      "",
      "mock_text，mock_text。",
    ].join("\n"), "utf-8");

    await ingestMaterial(root, {
      sourceKind: "file",
      filePath: "cold.md",
      purpose: "research",
    }, { now: () => new Date("2026-07-03T00:00:00.000Z") });
    await ingestMaterial(root, {
      sourceKind: "file",
      filePath: "romance.md",
      purpose: "reference",
    }, { now: () => new Date("2026-07-03T00:01:00.000Z") });

    const results = await retrieveMaterials(root, {
      query: "mock_text mock_text 0607 mock_text",
      limit: 2,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe("cold");
    expect(results[0]?.excerpt).toContain("mock_text");
    expect(results[0]?.markdownPath).toMatch(/^\.castor\/materials\//);
    expect(results[0]?.charStart).toBeGreaterThanOrEqual(0);
    expect(results[0]?.charEnd).toBeGreaterThan(results[0]?.charStart ?? 0);
  });

  it("can filter retrieval by material purpose", async () => {
    await writeFile(join(root, "research.md"), "mock_text、mock_text。", "utf-8");
    await writeFile(join(root, "script.md"), "mock_text、mock_text。", "utf-8");

    await ingestMaterial(root, {
      sourceKind: "file",
      filePath: "research.md",
      purpose: "research",
    }, { now: () => new Date("2026-07-03T00:00:00.000Z") });
    await ingestMaterial(root, {
      sourceKind: "file",
      filePath: "script.md",
      purpose: "script",
    }, { now: () => new Date("2026-07-03T00:01:00.000Z") });

    const results = await retrieveMaterials(root, {
      query: "mock_text mock_text mock_text",
      purpose: "script",
      limit: 3,
    });

    expect(results.map((result) => result.purpose)).toEqual(["script"]);
    expect(results[0]?.excerpt).toContain("mock_text");
  });
});
