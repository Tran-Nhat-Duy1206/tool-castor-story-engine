import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  renderChapterSummariesProjection,
  renderCurrentStateProjection,
  renderHooksProjection,
} from "../../state/state-projections.js";
import type {
  ChapterSummariesState,
  CurrentStateState,
  HooksState,
  StateManifest,
} from "../../models/runtime-state.js";

/**
 * Canonical structured state used by every canon-boundary test. Shape mirrors
 * what the engine persists after Phase 7: slot facts plus additional facts,
 * a closed historical interval on 当前位置, and a fully-populated promoted hook.
 */
export const CANON_FIXTURE_MANIFEST: StateManifest = {
  schemaVersion: 2,
  language: "vi",
  lastAppliedChapter: 12,
  projectionVersion: 3,
  migrationWarnings: [],
};

export const CANON_FIXTURE_CURRENT_STATE: CurrentStateState = {
  chapter: 12,
  facts: [
    // Closed historical interval: must stay visible as superseded history.
    { subject: "主角", predicate: "当前位置", object: "城南旧宅", validFromChapter: 1, validUntilChapter: 10, sourceChapter: 2 },
    { subject: "主角", predicate: "当前位置", object: "东城公寓", validFromChapter: 11, validUntilChapter: null, sourceChapter: 11 },
    { subject: "主角", predicate: "主角状态", object: "带伤潜行，避开了监控网络", validFromChapter: 12, validUntilChapter: null, sourceChapter: 12 },
    { subject: "林晚", predicate: "身份", object: "卧底记者", validFromChapter: 4, validUntilChapter: null, sourceChapter: 4 },
  ],
};

export const CANON_FIXTURE_HOOKS: HooksState = {
  hooks: [
    {
      hookId: "hook-core-missing-will",
      startChapter: 3,
      type: "core_mystery",
      status: "progressing",
      lastAdvancedChapter: 12,
      expectedPayoff: "遗嘱真伪揭晓",
      payoffTiming: "mid-arc",
      notes: "与林晚身份线交织",
      dependsOn: ["hook-sub-neighbor"],
      paysOffInArc: "第二卷",
      coreHook: true,
      halfLifeChapters: 6,
      advancedCount: 5,
      promoted: true,
    },
    {
      hookId: "hook-sub-neighbor",
      startChapter: 5,
      type: "subplot",
      status: "open",
      lastAdvancedChapter: 9,
      expectedPayoff: "邻居目击证词",
      payoffTiming: "near-term",
      notes: "",
    },
  ],
};

export const CANON_FIXTURE_SUMMARIES: ChapterSummariesState = {
  rows: [
    {
      chapter: 11,
      title: "夜访东城",
      characters: "主角；房东",
      events: "主角搬入东城公寓",
      stateChanges: "当前位置→东城公寓",
      hookActivity: "",
      mood: "压抑",
      chapterType: "过渡",
    },
    {
      chapter: 12,
      title: "旧档与新伤",
      characters: "主角；林晚",
      events: "发现遗嘱副本",
      stateChanges: "主角状态→带伤潜行",
      hookActivity: "hook-core-missing-will 推进",
      mood: "紧张",
      chapterType: "调查",
    },
  ],
};

export interface CanonBookFixture {
  readonly root: string;
  readonly bookDir: string;
}

export interface CreateCanonBookOptions {
  /** Valid JSON but currentState.chapter > manifest.lastAppliedChapter: survives bootstrap, fails validateRuntimeState. */
  readonly stateChapterAhead?: boolean;
  /** Skip the four story/state/*.json files; markdown projections only (bootstrap seeding path). */
  readonly omitStateJson?: boolean;
  /** Overwrite one canonical state file with non-JSON garbage (implies the state files exist). */
  readonly corruptFile?: "manifest" | "current_state" | "hooks" | "chapter_summaries";
  /**
   * P3A fixtures: number of contiguous chapter files AND lastAppliedChapter
   * (default 12, matching the original fixture constants).
   */
  readonly chapterCount?: number;
  /** Seed snapshots/<n>/state for every chapter 1..n with the fixture facts. */
  readonly seedSnapshotsThrough?: number;
  /** Write an inflated manifest.lastAppliedChapter (durable progress must win over it). */
  readonly inflateManifestTo?: number;
  /** Additional open facts merged into live current_state.json. */
  readonly extraFacts?: CurrentStateState["facts"];
}

export interface FileMetadata {
  readonly sha256: string;
  readonly size: number;
  readonly mtimeMs: number;
}

/** SHA-256 + size + mtimeMs for every file under root, keyed by relative path. */
export async function captureBookMetadata(root: string): Promise<Record<string, FileMetadata>> {
  const out: Record<string, FileMetadata> = {};
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else {
        const [buf, st] = await Promise.all([readFile(path), stat(path)]);
        out[path.slice(root.length + 1)] = {
          sha256: createHash("sha256").update(buf).digest("hex"),
          size: buf.byteLength,
          mtimeMs: st.mtimeMs,
        };
      }
    }
  }
  await walk(root);
  return out;
}

interface FixtureDocs {
  readonly manifest: StateManifest;
  readonly currentState: CurrentStateState;
  readonly hooks: HooksState;
  readonly summaries: ChapterSummariesState;
}

function buildFixtureDocs(options: CreateCanonBookOptions): FixtureDocs {
  const chapterCount = options.chapterCount ?? 12;
  const manifest: StateManifest = {
    ...CANON_FIXTURE_MANIFEST,
    lastAppliedChapter: options.inflateManifestTo ?? chapterCount,
  };
  const currentState: CurrentStateState = options.stateChapterAhead
    ? { ...CANON_FIXTURE_CURRENT_STATE, chapter: 20 }
    : {
        ...CANON_FIXTURE_CURRENT_STATE,
        chapter: chapterCount,
        facts: [...CANON_FIXTURE_CURRENT_STATE.facts, ...(options.extraFacts ?? [])],
      };
  return { manifest, currentState, hooks: CANON_FIXTURE_HOOKS, summaries: CANON_FIXTURE_SUMMARIES };
}

function stateJsonFiles(docs: FixtureDocs): Record<string, string> {
  return {
    "manifest.json": JSON.stringify(docs.manifest, null, 2),
    "current_state.json": JSON.stringify(docs.currentState, null, 2),
    "hooks.json": JSON.stringify(docs.hooks, null, 2),
    "chapter_summaries.json": JSON.stringify(docs.summaries, null, 2),
  };
}

/**
 * Minimal canonical book on disk whose story/state/*.json is valid v2 runtime
 * state. Markdown projections are rendered through the real projection
 * functions, so bootstrap-from-markdown variants round-trip through the
 * engine's own format instead of hand-written fixtures.
 */
export async function createCanonBook(options: CreateCanonBookOptions = {}): Promise<CanonBookFixture> {
  const root = await mkdtemp(join(tmpdir(), "castor-canon-"));
  const bookDir = join(root, "books", "demo-canon-book");
  const storyDir = join(bookDir, "story");
  const chapterCount = options.chapterCount ?? 12;
  const docs = buildFixtureDocs(options);

  await mkdir(join(storyDir, "state"), { recursive: true });
  await mkdir(join(bookDir, "chapters"), { recursive: true });

  await writeFile(
    join(bookDir, "book.json"),
    JSON.stringify({
      id: "demo-canon-book",
      title: "回声协议",
      genre: "urban",
      language: "vi",
      platform: "other",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    }),
    "utf-8",
  );
  // Durable artifact authority: bootstrap re-derives manifest
  // lastAppliedChapter from the contiguous chapter-file prefix on every
  // load, so the fixture must contain chapters 1..chapterCount for
  // lastAppliedChapter to survive validation.
  const chapterTitles: Record<number, string> = { 11: "夜访东城", 12: "旧档与新伤" };
  for (let chapter = 1; chapter <= chapterCount; chapter += 1) {
    const title = chapterTitles[chapter] ?? `第${chapter}章`;
    await writeFile(join(bookDir, "chapters", `${String(chapter).padStart(4, "0")}_${title}.md`), `# 第${chapter}章 ${title}\n\n正文。`, "utf-8");
  }

  if (!options.omitStateJson) {
    for (const [name, content] of Object.entries(stateJsonFiles(docs))) {
      await writeFile(join(storyDir, "state", name), content, "utf-8");
    }
  }
  if (options.corruptFile && !options.omitStateJson) {
    await writeFile(join(storyDir, "state", `${options.corruptFile}.json`), '{ this is not valid json', "utf-8");
  }

  // Derived projections are always present — they are views over the same data.
  await writeFile(
    join(storyDir, "current_state.md"),
    renderCurrentStateProjection(docs.currentState, "vi"),
    "utf-8",
  );
  await writeFile(
    join(storyDir, "pending_hooks.md"),
    renderHooksProjection(docs.hooks, "vi", { currentChapter: chapterCount }),
    "utf-8",
  );
  await writeFile(
    join(storyDir, "chapter_summaries.md"),
    renderChapterSummariesProjection(docs.summaries, "vi"),
    "utf-8",
  );

  // Chapter snapshot realism: snapshots/<N>/state mirrors live state. By
  // default only the head snapshot (chapterCount) exists — exactly like the
  // original fixture; P3A tests may request a full replay chain.
  if (options.seedSnapshotsThrough !== undefined) {
    for (let c = 1; c <= options.seedSnapshotsThrough; c += 1) {
      const dir = join(storyDir, "snapshots", String(c), "state");
      await mkdir(dir, { recursive: true });
      const chainDocs = buildFixtureDocs({ ...options, chapterCount: c });
      for (const [name, content] of Object.entries(stateJsonFiles(chainDocs))) {
        await writeFile(join(dir, name), content, "utf-8");
      }
    }
  } else {
    const snapshotStateDir = join(storyDir, "snapshots", String(chapterCount), "state");
    await mkdir(snapshotStateDir, { recursive: true });
    for (const [name, content] of Object.entries(stateJsonFiles(docs))) {
      await writeFile(join(snapshotStateDir, name), content, "utf-8");
    }
  }

  return { root, bookDir };
}
