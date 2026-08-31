import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { formatRecentSummaries, readSubplotBoard } from "../agents/planner-context.js";
import { readCharacterContext, readStoryFrame, readVolumeMap } from "../utils/outline-paths.js";

// Read-only view of the canonical book used as forecast input. Everything in
// here MUST stay side-effect free: building a forecast context never creates
// or repairs canonical files (that is why StateManager.loadControlDocuments,
// which seeds defaults, is deliberately not used).

const RECENT_SUMMARY_LIMIT = 8;

export interface ForecastContextSections {
  readonly authorIntent: string;
  readonly currentFocus: string;
  readonly currentState: string;
  readonly pendingHooks: string;
  readonly storyFrame: string;
  readonly volumeMap: string;
  readonly recentChapterSummaries: string;
  readonly characterContext: string;
  readonly subplotBoard: string;
}

export interface ForecastContext {
  readonly bookId: string;
  readonly bookTitle: string;
  readonly language: "vi" | "en";
  readonly baseChapter: number;
  readonly contextFingerprint: string;
  readonly sections: ForecastContextSections;
}

export async function buildForecastContext(params: {
  readonly bookDir: string;
  readonly bookId: string;
}): Promise<ForecastContext> {
  const { bookDir, bookId } = params;
  const storyDir = join(bookDir, "story");

  const [bookConfig, baseChapter, fingerprintFiles] = await Promise.all([
    readBookConfig(bookDir),
    resolveBaseChapter(bookDir),
    collectFingerprintFiles(bookDir),
  ]);

  const [authorIntent, currentFocus, currentState, pendingHooks] = await Promise.all([
    readOrEmpty(join(storyDir, "author_intent.md")),
    readOrEmpty(join(storyDir, "current_focus.md")),
    readOrEmpty(join(storyDir, "current_state.md")),
    readOrEmpty(join(storyDir, "pending_hooks.md")),
  ]);

  const [storyFrame, volumeMap, characterContext, subplotBoard, chapterSummariesRaw] = await Promise.all([
    readStoryFrame(bookDir),
    readVolumeMap(bookDir),
    readCharacterContext(bookDir),
    readSubplotBoard(storyDir),
    readOrEmpty(join(storyDir, "chapter_summaries.md")),
  ]);

  const contextFingerprint = computeContextFingerprint({
    baseChapter,
    files: fingerprintFiles,
  });

  return {
    bookId,
    bookTitle: bookConfig.title || bookId,
    language: bookConfig.language,
    baseChapter,
    contextFingerprint,
    sections: {
      authorIntent,
      currentFocus,
      currentState,
      pendingHooks,
      storyFrame,
      volumeMap,
      recentChapterSummaries: chapterSummariesRaw.trim()
        ? formatRecentSummaries(chapterSummariesRaw, baseChapter + 1, RECENT_SUMMARY_LIMIT)
        : "",
      characterContext,
      subplotBoard,
    },
  };
}

/**
 * Content hash over the canonical forecast inputs (chapter count + every file
 * this builder feeds into the prompt). Deliberately mtime-free and
 * order-independent so copies, checkouts and CI runs produce identical
 * fingerprints for identical canon.
 */
export function computeContextFingerprint(input: {
  readonly baseChapter: number;
  readonly files: ReadonlyArray<readonly [string, string]>;
}): string {
  const canonical = JSON.stringify({
    baseChapter: input.baseChapter,
    files: [...input.files].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

// Every fixed-path file buildForecastContext (directly or via its helpers)
// reads into the prompt, including the legacy fallbacks readStoryFrame /
// readVolumeMap / readCharacterContext may resolve to. story/runtime/** —
// where forecasts themselves live — is deliberately NOT part of this list,
// so a forecast can never invalidate itself.
const FINGERPRINT_FIXED_INPUTS: ReadonlyArray<string> = [
  "book.json",
  "story/author_intent.md",
  "story/chapter_summaries.md",
  "story/character_matrix.md",
  "story/current_focus.md",
  "story/current_state.md",
  "story/outline/story_frame.md",
  "story/outline/volume_map.md",
  "story/pending_hooks.md",
  "story/story_bible.md",
  "story/subplot_board.md",
  "story/volume_outline.md",
];

// Same tier directories readRoleCards enumerates.
const FINGERPRINT_ROLE_DIRS: ReadonlyArray<string> = ["主要角色", "次要角色", "major", "minor"];

/**
 * Enumerate every context input as [relative posix path, content] pairs.
 * A missing file contributes no entry while an existing empty file
 * contributes ["path", ""], so creating, deleting or renaming an input file
 * always changes the fingerprint — not only editing its content.
 */
async function collectFingerprintFiles(
  bookDir: string,
): Promise<ReadonlyArray<readonly [string, string]>> {
  const [fixedEntries, stateFiles, roleEntryGroups] = await Promise.all([
    Promise.all(FINGERPRINT_FIXED_INPUTS.map(async (relPath) => {
      const content = await readIfExists(join(bookDir, relPath));
      return content === null ? null : ([relPath, content] as const);
    })),
    readStateFiles(bookDir),
    Promise.all(FINGERPRINT_ROLE_DIRS.map(async (tier) => {
      const dir = join(bookDir, "story", "roles", tier);
      let names: string[];
      try {
        names = (await readdir(dir)).filter((name) => name.endsWith(".md"));
      } catch {
        return [];
      }
      return Promise.all(names.map(async (name) =>
        [`story/roles/${tier}/${name}`, await readOrEmpty(join(dir, name))] as const));
    })),
  ]);

  return [
    ...fixedEntries.filter((entry): entry is readonly [string, string] => entry !== null),
    ...stateFiles.map(({ name, content }) => [`story/state/${name}`, content] as const),
    ...roleEntryGroups.flat(),
  ];
}

/** Read a file's content, or null when it does not exist. */
async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function renderForecastContextMarkdown(context: ForecastContext): string {
  const zh = context.language === "vi";
  const sectionList: ReadonlyArray<readonly [string, string]> = [
    [zh ? "作者意图" : "Author intent", context.sections.authorIntent],
    [zh ? "当前聚焦" : "Current focus", context.sections.currentFocus],
    [zh ? "当前状态" : "Current state", context.sections.currentState],
    [zh ? "伏笔与钩子" : "Pending hooks", context.sections.pendingHooks],
    [zh ? "故事框架" : "Story frame", context.sections.storyFrame],
    [zh ? "卷映射" : "Volume map", context.sections.volumeMap],
    [zh ? "近期章节摘要" : "Recent chapter summaries", context.sections.recentChapterSummaries],
    [zh ? "人物与关系" : "Characters and relationships", context.sections.characterContext],
    [zh ? "支线看板" : "Subplot board", context.sections.subplotBoard],
  ];

  const blocks = [
    zh
      ? `# 正史上下文（《${context.bookTitle}》，已完成至第 ${context.baseChapter} 章）`
      : `# Canonical context ("${context.bookTitle}", written through chapter ${context.baseChapter})`,
    ...sectionList
      .filter(([, content]) => content.trim())
      .map(([heading, content]) => `## ${heading}\n\n${content.trim()}`),
  ];
  return blocks.join("\n\n");
}

async function readBookConfig(bookDir: string): Promise<{ readonly title: string; readonly language: "vi" | "en" }> {
  try {
    const raw = await readFile(join(bookDir, "book.json"), "utf-8");
    const parsed = JSON.parse(raw) as { title?: unknown; language?: unknown };
    return {
      title: typeof parsed.title === "string" ? parsed.title : "",
      language: parsed.language === "en" ? "en" : "vi",
    };
  } catch {
    return { title: "", language: "vi" };
  }
}

/**
 * Highest chapter number present on disk. Forecasts key their staleness on
 * this value: a new canonical chapter invalidates old forecasts.
 */
async function resolveBaseChapter(bookDir: string): Promise<number> {
  let files: string[];
  try {
    files = await readdir(join(bookDir, "chapters"));
  } catch {
    return 0;
  }
  let max = 0;
  for (const file of files) {
    const match = file.match(/^(\d+)[_-]?.*\.md$/);
    if (!match) continue;
    const number = Number.parseInt(match[1]!, 10);
    if (Number.isFinite(number) && number > max) max = number;
  }
  return max;
}

async function readStateFiles(bookDir: string): Promise<ReadonlyArray<{ readonly name: string; readonly content: string }>> {
  const stateDir = join(bookDir, "story", "state");
  let names: string[];
  try {
    names = (await readdir(stateDir)).filter((name) => name.endsWith(".json")).sort();
  } catch {
    return [];
  }
  return Promise.all(names.map(async (name) => ({
    name,
    content: await readOrEmpty(join(stateDir, name)),
  })));
}

async function readOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return "";
  }
}
