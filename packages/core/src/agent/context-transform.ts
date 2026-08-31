import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { UserMessage } from "@mariozechner/pi-ai";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { isNewLayoutBook } from "../utils/outline-paths.js";
import type { ContextCompressionCallback } from "../models/context-compression.js";
import { loadStoryGraph } from "../interactive-film/graph-store.js";

/** Files read in this order; anything else in story/ comes after, sorted alphabetically. */
const PRIORITY_FILES = [
  "outline/story_frame.md",
  "outline/volume_map.md",
  "story_bible.md",
  "volume_outline.md",
  "book_rules.md",
  "author_intent.md",
  "current_focus.md",
  "current_state.md",
];

const FULL_INLINE_CHAR_LIMIT = 6000;
const MAX_INDEX_HEADINGS_PER_FILE = 80;
const MAX_INDEX_HEADING_CHARS = 220;

const UPGRADE_HINT =
  "[Notice] The story architecture is in legacy format. If the author wants to upgrade to section format, sub_agent(architect, { revise: true }) can be used.";

export function createBookContextTransform(
  bookId: string | null,
  projectRoot: string,
  options: { readonly onContextCompression?: ContextCompressionCallback } = {},
): (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]> {
  if (bookId === null) {
    return async (messages) => messages;
  }

  const bookDir = join(projectRoot, "books", bookId);
  const storyDir = join(bookDir, "story");

  return async (messages) => {
    const sections = await readTruthFiles(storyDir);
    if (sections.length === 0) return messages;

    const isNew = await isNewLayoutBook(bookDir);
    const hintBlock = isNew ? "" : `\n\n${UPGRADE_HINT}`;
    const compactedSources = sections
      .filter((section) => section.content.length > FULL_INLINE_CHAR_LIMIT)
      .map((section) => section.name);

    if (compactedSources.length > 0) {
      options.onContextCompression?.({
        category: "session_context",
        phase: "start",
        sources: compactedSources,
      });
    }

    const body =
      "[The following is the context package for the current book, automatically generated from disk. Use these contents for reasoning and drafting; read individual files when full text is required.]" +
      hintBlock + "\n\n" +
      sections.map(renderContextSection).join("\n\n");

    if (compactedSources.length > 0) {
      options.onContextCompression?.({
        category: "session_context",
        phase: "end",
        sources: compactedSources,
      });
    }

    const injected: UserMessage = {
      role: "user",
      content: body,
      timestamp: Date.now(),
    };

    return [injected, ...messages];
  };
}

/**
 * Inject the complete authoritative interactive-film graph for authoring turns.
 * Node ids, choices, conditions and effects are execution state, so silently
 * excerpting them would make edits unsafe. Context-window guards remain the
 * explicit failure boundary until semantic graph compaction is introduced.
 */
export function createInteractiveFilmContextTransform(
  projectId: string,
  projectRoot: string,
): (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]> {
  return async (messages) => {
    const graph = await loadStoryGraph(projectRoot, projectId);
    if (!graph) return messages;
    const injected: UserMessage = {
      role: "user",
      content: [
        "[The following is the authoritative story graph for this interactive game. Always use valid node IDs, choice IDs, variables, and ending IDs.]",
        JSON.stringify(graph),
      ].join("\n"),
      timestamp: Date.now(),
    };
    return [injected, ...messages];
  };
}

interface TruthFileSection {
  name: string;
  content: string;
}

function renderContextSection(section: TruthFileSection): string {
  if (section.content.length <= FULL_INLINE_CHAR_LIMIT) {
    return `=== ${section.name} ===\n${section.content}`;
  }

  const index = buildMarkdownFileIndex(section.content);
  return [
    `=== ${section.name} ===`,
    `[Partial injection: original file ${section.content.length} chars / ${index.totalLines} lines. Below is Markdown table of contents.]`,
    index.lines.length > 0
      ? index.lines.join("\n")
      : "[No Markdown headings detected; read complete file when needed.]",
    index.omittedHeadings > 0 ? `[Omitted headings count: ${index.omittedHeadings}.]` : "",
  ].filter(Boolean).join("\n");
}

function buildMarkdownFileIndex(content: string): { readonly lines: ReadonlyArray<string>; readonly omittedHeadings: number; readonly totalLines: number } {
  const lines = content.split(/\r?\n/);
  const selected: string[] = [];
  let headingCount = 0;

  for (const rawLine of lines) {
    const heading = normalizeMarkdownHeading(rawLine);
    if (!heading) continue;
    headingCount += 1;
    if (selected.length < MAX_INDEX_HEADINGS_PER_FILE) selected.push(heading);
  }

  return {
    lines: selected,
    omittedHeadings: Math.max(0, headingCount - selected.length),
    totalLines: lines.length,
  };
}

function normalizeMarkdownHeading(line: string): string | null {
  const trimmed = line.trimStart();
  const match = /^(#{1,6})\s+(.+?)\s*$/.exec(trimmed);
  if (!match) return null;
  const marker = match[1]!;
  const title = match[2]!;
  return `${marker} ${title.length > MAX_INDEX_HEADING_CHARS ? `${title.slice(0, MAX_INDEX_HEADING_CHARS - 1)}…` : title}`;
}

async function readTruthFiles(storyDir: string): Promise<TruthFileSection[]> {
  let files: string[];
  try {
    files = await listTruthMarkdownFiles(storyDir);
  } catch {
    return [];
  }

  if (files.length === 0) return [];

  const prioritySet = new Set(PRIORITY_FILES);
  const prioritized = PRIORITY_FILES.filter((f) => files.includes(f));
  const rest = files.filter((f) => !prioritySet.has(f)).sort();
  const ordered = [...prioritized, ...rest];

  const sections: TruthFileSection[] = [];
  for (const fileName of ordered) {
    try {
      const content = await readFile(join(storyDir, fileName), "utf-8");
      sections.push({ name: fileName, content });
    } catch {
      // skip unreadable files
    }
  }
  return sections;
}

async function listTruthMarkdownFiles(storyDir: string): Promise<string[]> {
  const topEntries = await readdir(storyDir, { withFileTypes: true });
  const files = topEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name);

  for (const dirName of ["outline", "roles"]) {
    files.push(...await listNestedMarkdownFiles(storyDir, dirName));
  }

  return files;
}

async function listNestedMarkdownFiles(storyDir: string, relativeDir: string): Promise<string[]> {
  const dirPath = join(storyDir, relativeDir);
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const child = `${relativeDir}/${entry.name}`;
    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(child);
    } else if (entry.isDirectory()) {
      files.push(...await listNestedMarkdownFiles(storyDir, child));
    }
  }
  return files;
}
