import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ingestMaterial } from "../materials/ingest.js";

describe("material ingestion", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "castor-material-ingest-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("archives a project text file as traceable markdown material", async () => {
    await writeFile(join(root, "brief.md"), "# Brief\n\nChương mock_text，mock_text。", "utf-8");

    const asset = await ingestMaterial(root, {
      sourceKind: "file",
      filePath: "brief.md",
      mimeType: "text/markdown",
      purpose: "worldbuilding",
    }, {
      now: () => new Date("2026-07-03T00:00:00.000Z"),
    });

    expect(asset.kind).toBe("text");
    expect(asset.markdownPath).toMatch(/^\.castor\/materials\//);
    expect(asset.source).toBe("brief.md");
    expect(asset.excerpt).toContain("mock_text");
    const markdown = await readFile(join(root, asset.markdownPath), "utf-8");
    expect(markdown).toContain("## Metadata");
    expect(markdown).toContain("- purpose: worldbuilding");
    expect(markdown).toContain("Chương mock_text，mock_text。");
    const manifest = JSON.parse(await readFile(join(root, asset.manifestPath), "utf-8")) as { markdownPath?: string };
    expect(manifest.markdownPath).toBe(asset.markdownPath);
  });

  it("extracts and archives HTML fetched from a URL", async () => {
    const fetchImpl = async () => new Response(
      "<html><head><title>mock_text</title><style>x{}</style></head><body><h1>mock_text</h1><script>bad()</script><p>mock_text từ。</p></body></html>",
      { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
    );

    const asset = await ingestMaterial(root, {
      sourceKind: "url",
      url: "https://example.com/cold-storage",
      purpose: "research",
    }, {
      fetch: fetchImpl as typeof fetch,
      now: () => new Date("2026-07-03T00:00:00.000Z"),
    });

    expect(asset.kind).toBe("webpage");
    expect(asset.title).toBe("mock_text");
    expect(asset.source).toBe("https://example.com/cold-storage");
    expect(asset.excerpt).toContain("mock_text từ");
    expect(asset.excerpt).not.toContain("bad()");
  });
});
