import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanonBook, captureBookMetadata, type CanonBookFixture } from "./helpers/canon-fixture.js";
import { WriterAgent, type WriteChapterOutput } from "../agents/writer.js";
import { RuntimeStateDeltaSchema } from "../models/runtime-state.js";
import { ACTIVE_REVIEW_RELPATH } from "../state/state-review-store.js";
import type { AtomicFileSet } from "../utils/atomic-file-set.js";

// ---------------------------------------------------------------------------
// Failure-injection seam: wrap the REAL commitAtomicFileSet so tests can
// inject a failing renameFile (mid-set failure) and capture every invocation.
// The real transaction/rollback implementation always executes.
// ---------------------------------------------------------------------------

const seam = vi.hoisted(() => ({
  renameInjection: undefined as undefined | ((from: string, to: string) => Promise<void>),
  invocations: [] as Array<AtomicFileSet>,
}));

vi.mock("../utils/atomic-file-set.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/atomic-file-set.js")>();
  return {
    ...actual,
    async commitAtomicFileSet(input: AtomicFileSet) {
      seam.invocations.push(input);
      return actual.commitAtomicFileSet({
        ...input,
        ...(seam.renameInjection ? { renameFile: seam.renameInjection } : {}),
      });
    },
  };
});

const ZERO_USAGE = { promptTokens: 0, completionTokens: 0, totalTokens: 0 } as const;

function deferredDelta(chapter = 13) {
  return RuntimeStateDeltaSchema.parse({
    chapter,
    currentStatePatch: { currentGoal: "NEW-PROPOSED-GOAL-B" },
    hookOps: { upsert: [], mention: [], resolve: [], defer: [] },
  });
}

function chapterOutput(chapter = 13, delta = deferredDelta(chapter)): WriteChapterOutput {
  return {
    chapterNumber: chapter,
    title: "雨夜提案",
    content: `第${chapter}章正文。`,
    wordCount: 10,
    preWriteCheck: "",
    postSettlement: "",
    updatedState: "# 当前状态\n\n- PROPOSED-STATE-B\n",
    updatedHooks: "# 伏笔池\n",
    chapterSummary: `| ${chapter} | 雨夜提案 | 林秋 | 提案内容 | 待审 | H13 提案 | 平静 | 调查 |`,
    updatedLedger: "# 粒子账本\n",
    updatedSubplots: "# 支线进度\n",
    updatedEmotionalArcs: "# 情感弧线\n",
    updatedCharacterMatrix: "# 角色矩阵\n",
    postWriteErrors: [],
    postWriteWarnings: [],
    runtimeStateDelta: delta,
  };
}

function makeAgent(root: string): WriterAgent {
  return new WriterAgent({
    client: {
      provider: "openai",
      apiFormat: "chat",
      stream: false,
      defaults: { temperature: 0.7, maxTokens: 4096, thinkingBudget: 0, extra: {} },
    },
    model: "test-model",
    projectRoot: root,
  });
}

const INDEX_JSON = JSON.stringify([
  { number: 13, title: "雨夜提案", status: "needs-state-review", createdAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:00.000Z" },
  { number: 12, title: "旧档与新伤", status: "approved", createdAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:00.000Z" },
]);
const ARTIFACT_JSON = JSON.stringify({ placeholder: "Task 7 supplies a real ACTIVE artifact" });

describe("WriterAgent.saveChapter deferred publication", () => {
  let fixture: CanonBookFixture;
  let agent: WriterAgent;
  const deferredOptions = { deferStateApplication: true } as const;

  beforeEach(async () => {
    fixture = await createCanonBook({ seedSnapshotsThrough: 12, chapterCount: 12 });
    agent = makeAgent(fixture.root);
    seam.renameInjection = undefined;
    seam.invocations.length = 0;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(fixture.root, { recursive: true, force: true }).catch(() => undefined);
  });

  it("LEGACY DEFAULT: persists prose plus runtime state exactly as before", async () => {
    await agent.saveChapter(fixture.bookDir, chapterOutput(), false, "zh");

    expect(await readFile(join(fixture.bookDir, "chapters", "0013_雨夜提案.md"), "utf-8"))
      .toContain("第13章正文");
    const currentState = await readFile(
      join(fixture.bookDir, "story", "state", "current_state.json"), "utf-8",
    );
    expect(currentState).toContain("NEW-PROPOSED-GOAL-B");
    expect(JSON.parse(currentState).chapter).toBe(13);
    // No index option ⇒ index untouched/absent.
    await expect(readFile(join(fixture.bookDir, "chapters", "index.json"), "utf-8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("DEFERRED STATE PATH: publishes prose while Canon stays at A with zero semantic leaks", async () => {
    const beforeState = await readFile(join(fixture.bookDir, "story", "state", "current_state.json"), "utf-8");
    const beforeProjection = await readFile(join(fixture.bookDir, "story", "current_state.md"), "utf-8");
    const treeBefore = await captureBookMetadata(fixture.root);

    await agent.saveChapter(fixture.bookDir, chapterOutput(), false, "zh", deferredOptions);

    expect(await readFile(join(fixture.bookDir, "chapters", "0013_雨夜提案.md"), "utf-8"))
      .toContain("第13章正文");
    // Canon unchanged — proposed state B must not leak anywhere authoritative.
    expect(await readFile(join(fixture.bookDir, "story", "state", "current_state.json"), "utf-8"))
      .toBe(beforeState);
    expect(await readFile(join(fixture.bookDir, "story", "current_state.md"), "utf-8"))
      .toBe(beforeProjection);
    expect(beforeState).not.toContain("NEW-PROPOSED-GOAL-B");

    const after = await captureBookMetadata(fixture.root);
    const changedKeys = Object.keys(after)
      .filter((key) => JSON.stringify(after[key]) !== JSON.stringify(treeBefore[key]));
    const normalized = changedKeys.map((key) => key.replace(/\\/g, "/"));
    expect(normalized).toEqual(["books/demo-canon-book/chapters/0013_雨夜提案.md"]);
  });

  it("UPDATED INDEX PARTICIPATES: chapters/index.json equals the exact supplied bytes", async () => {
    await agent.saveChapter(fixture.bookDir, chapterOutput(), false, "zh", {
      deferStateApplication: true,
      updatedChapterIndexJson: INDEX_JSON,
    });
    expect(await readFile(join(fixture.bookDir, "chapters", "index.json"), "utf-8")).toBe(INDEX_JSON);
  });

  it("INDEX OPTION ABSENT: pre-existing index keeps identical content AND mtime", async () => {
    await mkdir(join(fixture.bookDir, "chapters"), { recursive: true });
    const oldIndex = '[{"number":12,"status":"approved"}]';
    await writeFile(join(fixture.bookDir, "chapters", "index.json"), oldIndex, "utf-8");
    const before = await captureBookMetadata(fixture.root);
    const indexKey = Object.keys(before).find((key) => key.replace(/\\/g, "/").endsWith("chapters/index.json"))!;

    await agent.saveChapter(fixture.bookDir, chapterOutput(), false, "zh", deferredOptions);

    const after = await captureBookMetadata(fixture.root);
    expect((after[indexKey] as { sha256: string; mtimeMs: number }).sha256)
      .toBe((before[indexKey] as { sha256: string; mtimeMs: number }).sha256);
    expect((after[indexKey] as { mtimeMs: number }).mtimeMs)
      .toBe((before[indexKey] as { mtimeMs: number }).mtimeMs);
    expect(await readFile(join(fixture.bookDir, "chapters", "index.json"), "utf-8")).toBe(oldIndex);
  });

  it("STATE REVIEW ARTIFACT SEAM: supplied artifact joins the same commit at the canonical path", async () => {
    await agent.saveChapter(fixture.bookDir, chapterOutput(), false, "zh", {
      deferStateApplication: true,
      stateReviewJson: ARTIFACT_JSON,
      updatedChapterIndexJson: INDEX_JSON,
    });
    expect(await readFile(join(fixture.bookDir, ACTIVE_REVIEW_RELPATH(13)), "utf-8")).toBe(ARTIFACT_JSON);
  });

  it("SINGLE COMMIT: index/prose/artifact ride ONE commitAtomicFileSet invocation", async () => {
    await agent.saveChapter(fixture.bookDir, chapterOutput(), false, "zh", {
      deferStateApplication: true,
      stateReviewJson: ARTIFACT_JSON,
      updatedChapterIndexJson: INDEX_JSON,
    });

    expect(seam.invocations).toHaveLength(1);
    const paths = seam.invocations[0]!.writes.map((entry) => entry.relativePath.replace(/\\/g, "/"));
    expect(paths).toContain("chapters/0013_雨夜提案.md");
    expect(paths).toContain("chapters/index.json");
    expect(paths).toContain(ACTIVE_REVIEW_RELPATH(13));
    // Deferred mode excludes every CANONICAL-STATE story/** write; only the
    // caller-supplied State Review artifact under story/runtime/ may appear.
    expect(paths.filter((path) => path.startsWith("story/") && !path.startsWith("story/runtime/chapter-")))
      .toEqual([]);
  });

  it("ATOMIC FAILURE: injected mid-set rename failure rolls back prose AND index", async () => {
    await mkdir(join(fixture.bookDir, "chapters"), { recursive: true });
    const oldIndex = '[{"number":12,"status":"approved"}]';
    await writeFile(join(fixture.bookDir, "chapters", "index.json"), oldIndex, "utf-8");
    const treeBefore = await captureBookMetadata(fixture.root);

    let renameCalls = 0;
    seam.renameInjection = async (from: string, to: string) => {
      renameCalls += 1;
      if (renameCalls === 2) throw new Error("injected mid-set rename failure");
      await (await import("node:fs/promises")).rename(from, to);
    };

    await expect(
      agent.saveChapter(fixture.bookDir, chapterOutput(), false, "zh", {
        deferStateApplication: true,
        updatedChapterIndexJson: INDEX_JSON,
      }),
    ).rejects.toThrow(/injected mid-set rename failure/);

    expect(await captureBookMetadata(fixture.root)).toEqual(treeBefore);
    const runtimeDir = join(fixture.bookDir, ".inkos-file-txn-");
    void runtimeDir; // transaction dir lives under bookDir root; verify no residue:
    const residue = (await readdir(fixture.bookDir)).filter((name) => name.startsWith(".inkos-file-txn-"));
    expect(residue).toEqual([]);
    // Old index intact byte-for-byte.
    expect(await readFile(join(fixture.bookDir, "chapters", "index.json"), "utf-8")).toBe(oldIndex);
  });

  it("DEFERRED MODE EXCLUDES the state-application path from the authoritative set entirely", async () => {
    await agent.saveChapter(fixture.bookDir, chapterOutput(), false, "zh", {
      deferStateApplication: true,
      updatedChapterIndexJson: INDEX_JSON,
    });
    const input = seam.invocations[0]!;
    const paths = input.writes.map((entry) => entry.relativePath.replace(/\\/g, "/"));
    for (const banned of [
      "story/current_state.md",
      "story/pending_hooks.md",
      "story/chapter_summaries.md",
      "story/subplot_board.md",
      "story/emotional_arcs.md",
      "story/character_matrix.md",
      "story/particle_ledger.md",
      "story/state/manifest.json",
      "story/state/current_state.json",
      "story/state/hooks.json",
      "story/state/chapter_summaries.json",
    ]) {
      expect(paths).not.toContain(banned);
    }
    expect(paths).toEqual([
      expect.stringContaining("chapters/0013_"),
      "chapters/index.json",
    ]);
  });

  it("LEGACY REGRESSION: non-deferred save still writes runtime-state artifacts as before", async () => {
    await agent.saveChapter(fixture.bookDir, chapterOutput(), true, "zh");
    const manifest = JSON.parse(
      await readFile(join(fixture.bookDir, "story", "state", "manifest.json"), "utf-8"),
    );
    expect(manifest.lastAppliedChapter).toBe(13);
    expect(await readFile(join(fixture.bookDir, "story", "pending_hooks.md"), "utf-8"))
      .toBeDefined();
  });
});

void ZERO_USAGE;
