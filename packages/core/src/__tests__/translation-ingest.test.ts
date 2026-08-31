import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import JSZip from "jszip";
import { createTranslationProjectFromFile } from "../translation/index.js";
import { segmentTranslationText } from "../translation/text.js";

vi.mock("unpdf", () => ({
  getDocumentProxy: vi.fn(async () => ({ fake: true })),
  extractText: vi.fn(async () => ({
    text: "# Chương mock_text mock_text\n\nPDF Chương mock_text。\n\nPDF Chương mock_text。",
    totalPages: 2,
  })),
}));

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf-8")) as T;
}

async function writeMinimalEpub(path: string): Promise<void> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file(
    "META-INF/container.xml",
    [
      `<?xml version="1.0"?>`,
      `<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">`,
      `<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>`,
      `</container>`,
    ].join(""),
  );
  zip.file(
    "OEBPS/content.opf",
    [
      `<?xml version="1.0"?>`,
      `<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="2.0">`,
      `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>mock_text</dc:title></metadata>`,
      `<manifest>`,
      `<item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>`,
      `<item id="c2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>`,
      `</manifest>`,
      `<spine><itemref idref="c1"/><itemref idref="c2"/></spine>`,
      `</package>`,
    ].join(""),
  );
  zip.file("OEBPS/chapter1.xhtml", `<html><body><h1>Chapter One</h1><p>Hello world.</p></body></html>`);
  zip.file("OEBPS/chapter2.xhtml", `<html><body><h1>Chapter Two</h1><p>Second gate.</p></body></html>`);
  await writeFile(path, await zip.generateAsync({ type: "nodebuffer" }));
}

describe("translation ingestion", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "castor-translation-"));
    await mkdir(join(root, "inputs"), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("segments long prose at semantic sentence or word boundaries without truncation", () => {
    const english = "The courier crossed the frozen bridge before dawn. She kept the sealed letter inside her coat. Nobody at the gate knew her name.";
    const englishSegments = segmentTranslationText(english, 58);
    expect(englishSegments.length).toBeGreaterThan(1);
    expect(englishSegments.join(" ").replace(/\s+/g, " ")).toBe(english);
    expect(englishSegments.every((segment) => !/\w$/.test(segment) || segment.endsWith("name"))).toBe(true);

    const chinese = "mock_text。mock_text。mock_text。";
    const chineseSegments = segmentTranslationText(chinese, 16);
    expect(chineseSegments).toEqual([
      "mock_text。",
      "mock_text。",
      "mock_text。",
    ]);
    expect(chineseSegments.join("")).toBe(chinese);
  });

  it("creates a persistent translation project from Markdown chapters", async () => {
    await writeFile(
      join(root, "inputs", "source.md"),
      [
        "# Chương mock_text mock_text",
        "",
        "Chương mock_text。",
        "",
        "Chương mock_text。",
        "",
        "# Chương mock_text mock_text",
        "",
        "Chương mock_text。",
      ].join("\n"),
    );

    const created = await createTranslationProjectFromFile(root, {
      filePath: "inputs/source.md",
      sourceLanguage: "zh",
      targetLanguage: "en",
      segmentMaxChars: 18,
    });

    expect(created.manifest.source.kind).toBe("markdown");
    expect(created.manifest.sourceLanguage).toBe("zh");
    expect(created.manifest.targetLanguage).toBe("en");
    expect(created.manifest.chapters).toHaveLength(2);
    expect(created.manifest.chapters[0]?.segmentCount).toBeGreaterThanOrEqual(2);

    const persisted = await readJson<typeof created.manifest>(join(root, created.manifestPath));
    expect(persisted.id).toBe(created.manifest.id);

    const firstChapter = await readJson<{
      title: string;
      segments: Array<{ index: number; source: string }>;
    }>(join(root, created.manifest.chapters[0]!.sourcePath));
    expect(firstChapter.title).toBe("mock_text");
    expect(firstChapter.segments.map((segment) => segment.source)).toContain("Chương mock_text。");
  });

  it("creates a translation project from plain TXT", async () => {
    await writeFile(
      join(root, "inputs", "source.txt"),
      [
        "Chương mock_text Markdown mock_text。",
        "",
        "Chương mock_text。",
      ].join("\n"),
    );

    const created = await createTranslationProjectFromFile(root, {
      filePath: "inputs/source.txt",
      sourceLanguage: "zh",
      targetLanguage: "ko",
    });

    expect(created.manifest.source.kind).toBe("text");
    expect(created.manifest.targetLanguage).toBe("ko");
    expect(created.manifest.chapters).toHaveLength(1);

    const chapter = await readJson<{ segments: Array<{ source: string }> }>(
      join(root, created.manifest.chapters[0]!.sourcePath),
    );
    expect(chapter.segments.map((segment) => segment.source)).toContain("Chương mock_text。");
  });

  it("extracts PDF text and records page count", async () => {
    await writeFile(join(root, "inputs", "scan.pdf"), Buffer.from("%PDF fake"));

    const created = await createTranslationProjectFromFile(root, {
      filePath: "inputs/scan.pdf",
      sourceLanguage: "ja",
      targetLanguage: "zh",
    });

    expect(created.manifest.source.kind).toBe("pdf");
    expect(created.manifest.source.totalPages).toBe(2);
    expect(created.manifest.chapters[0]?.title).toBe("mock_text");
  });

  it("reads EPUB chapters in spine order", async () => {
    await writeMinimalEpub(join(root, "inputs", "book.epub"));

    const created = await createTranslationProjectFromFile(root, {
      filePath: "inputs/book.epub",
      sourceLanguage: "en",
      targetLanguage: "zh",
    });

    expect(created.manifest.title).toBe("mock_text");
    expect(created.manifest.source.kind).toBe("epub");
    expect(created.manifest.chapters.map((chapter) => chapter.title)).toEqual(["Chapter One", "Chapter Two"]);
  });
});
