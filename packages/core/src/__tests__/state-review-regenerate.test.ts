import { join } from "node:path";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureBookMetadata, createCanonBook, type CanonBookFixture } from "./helpers/canon-fixture.js";
import {
  ACTIVE_REVIEW_RELPATH,
  loadStateReview,
  publishActiveProposal,
} from "../state/state-review-store.js";
import { buildStateReviewItems } from "../state/state-review-items.js";
import { readStoryCanon } from "../state/canon-service.js";
import { resolveDurableStoryProgress } from "../state/state-bootstrap.js";
import { computeProseRevision } from "../utils/prose-revision.js";
import { addUserStateReviewItem, decideStateReviewItem, rebuildStateReview } from "../state/state-review-service.js";
import { executeEditTransaction } from "../interaction/edit-controller.js";
import { PipelineRunner } from "../pipeline/runner.js";
import { ChapterAnalyzerAgent } from "../agents/chapter-analyzer.js";
import type { WriterAgent } from "../agents/writer.js";
import type { ReviewItem } from "../models/state-review.js";
import type { RuntimeStateDelta } from "../models/runtime-state.js";
import { RuntimeStateDeltaSchema } from "../models/runtime-state.js";

// Real-publication-seam injection: delegate to the actual store unless a test
// arms exactly one injected failure (used by the PART V atomicity test).
let armedPublishFailures = 0;
vi.mock("../state/state-review-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../state/state-review-store.js")>();
  return {
    ...actual,
    publishActiveProposal: async (
      ...args: Parameters<typeof actual.publishActiveProposal>
    ): Promise<void> => {
      if (armedPublishFailures > 0) {
        armedPublishFailures -= 1;
        throw new Error("injected active-publication failure");
      }
      return actual.publishActiveProposal(...args);
    },
  };
});

const CREATED_AT = "2026-08-24T00:00:00.000Z";
const REVIEW_ID_R1 = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const SHELL_RELPATH = ACTIVE_REVIEW_RELPATH(16);
const PROSE_P2 = "# 第16章 反转\n\n林秋在黎明烧毁了账本。";

function expectOnlyPathsChanged(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  allowedRelativePaths: ReadonlyArray<string>,
): void {
  const normalizeKey = (key: string): string => key.replace(/\\/g, "/");
  const allowed = new Set(allowedRelativePaths.map(normalizeKey));
  const keys = new Set([...Object.keys(before), ...Object.keys(after)].map(normalizeKey));
  const unexpected: string[] = [];
  for (const key of keys) {
    if (allowed.has(key)) continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) unexpected.push(key);
  }
  expect(unexpected).toEqual([]);
}

async function seedChapters(fixture: CanonBookFixture, numbers: ReadonlyArray<number>): Promise<void> {
  await mkdir(join(fixture.bookDir, "chapters"), { recursive: true });
  for (const number of numbers) {
    await writeFile(
      join(fixture.bookDir, "chapters", `${String(number).padStart(4, "0")}_旧.md`),
      `# 第${number}章 旧\n\n这是第${number}章的旧正文。`,
      "utf-8",
    );
  }
}

async function readDurableProse(fixture: CanonBookFixture, chapter: number): Promise<string> {
  const entries = await readdir(join(fixture.bookDir, "chapters"));
  const fileName = entries.find((name) => name.startsWith(`${String(chapter).padStart(4, "0")}_`) && name.endsWith(".md"));
  if (!fileName) throw new Error(`missing prose for chapter ${chapter}`);
  return readFile(join(fixture.bookDir, "chapters", fileName), "utf-8");
}

async function saveViaTask9(
  fixture: CanonBookFixture,
  fullText: string,
  chapterNumber = 16,
): Promise<void> {
  await executeEditTransaction(
    {
      bookDir: () => fixture.bookDir,
      loadChapterIndex: async () =>
        JSON.parse(await readFile(join(fixture.bookDir, "chapters", "index.json"), "utf-8")) as never,
      saveChapterIndex: async () => undefined,
    },
    { kind: "chapter-replace", bookId: "demo-canon-book", chapterNumber, fullText },
  );
}

async function setConfirmedHead(fixture: CanonBookFixture, lastAppliedChapter: number): Promise<void> {
  const manifestPath = join(fixture.bookDir, "story", "state", "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as { lastAppliedChapter: number };
  manifest.lastAppliedChapter = lastAppliedChapter;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
}

function factDelta(chapter: number, object: string): RuntimeStateDelta {
  return RuntimeStateDeltaSchema.parse({
    chapter,
    currentStatePatch: { currentLocation: object },
  });
}

describe("state-review-regenerate", () => {
  let fixture: CanonBookFixture;

  beforeEach(async () => {
    fixture = await createCanonBook({ seedSnapshotsThrough: 12 });
    await seedChapters(fixture, [16]);
    await writeFile(
      join(fixture.bookDir, "chapters", "index.json"),
      JSON.stringify([{
        number: 16, title: "旧", status: "needs-state-review", wordCount: 12,
        createdAt: CREATED_AT, updatedAt: CREATED_AT, auditIssues: [], lengthWarnings: [],
      }], null, 2),
      "utf-8",
    );
  });

  afterEach(async () => {
    await rm(fixture.root, { recursive: true, force: true }).catch(() => undefined);
  });

  it("(R1) active R1 → Task 9 invalidation → rebuild yields fresh R2 with no decision carry-forward and zero receipts", async () => {
    await publishActiveProposal(fixture.bookDir, {
      schemaVersion: 1, status: "active", reviewId: REVIEW_ID_R1, sourceChapter: 16,
      effectiveChapter: 13, proseRevision: "0123456789abcdef", baseCanonRevision: "fedcba9876543210",
      reviewRevision: 2,
      items: [{
        id: "current-state-fact:0:a", kind: "current-state-fact", origin: "ai", title: "goal",
        proposal: { type: "fact", change: { action: "set", subject: "主角", predicate: "当前目标", object: "查账" } },
        decision: "accepted" as const,
      }],
      createdAt: CREATED_AT, language: "zh",
    });
    await addUserStateReviewItem({
      bookDir: fixture.bookDir, chapter: 16, expectedReviewRevision: 2,
      kind: "current-state-fact", title: "user item",
      change: { type: "fact", change: { action: "set", subject: "主角", predicate: "当前位置", object: "西郊仓库" } },
    });
    await saveViaTask9(fixture, PROSE_P2);
    const before = await captureBookMetadata(fixture.root);

    let analyzedContent = "";
    const { artifact } = await rebuildStateReview({
      bookDir: fixture.bookDir, chapter: 16, language: "zh",
      analyze: async (input) => { analyzedContent = input.chapterContent; return factDelta(16, "北岸灯塔"); },
    });
    const after = await captureBookMetadata(fixture.root);
    // Rebuild touches ONLY the review artifact — prose/index/Canon/receipts frozen.
    expectOnlyPathsChanged(before, after, [SHELL_RELPATH]);

    expect(artifact.status).toBe("active");
    expect(artifact.reviewId).not.toBe(REVIEW_ID_R1);
    // Analyzer received EXACTLY the latest durable prose.
    const durableP2 = await readDurableProse(fixture, 16);
    expect(analyzedContent).toBe(durableP2);
    // Anchors are freshly computed. Fixture Canon confirmed through ch12;
    // source 16 is AHEAD of confirmed head ⇒ §20 keeps effective = source.
    expect(artifact.proseRevision).toBe(computeProseRevision(durableP2));
    expect(artifact.baseCanonRevision).toBe((await readStoryCanon(fixture.bookDir)).revision);
    expect(artifact.effectiveChapter).toBe(16);
    expect(artifact.sourceChapter).toBe(16);
    expect(artifact.reviewRevision).toBe(1);
    // Items come ONLY from Task 4 over the fresh delta — fresh undecided AI
    // items; old accepted decisions and the old user-added item NOT carried.
    const expectedItems = buildStateReviewItems(factDelta(16, "北岸灯塔"), {
      chapterContent: durableP2, language: "zh",
    });
    const shape = (items: ReadonlyArray<ReviewItem>) =>
      items.map((item) => ({ id: item.id, kind: item.kind, origin: item.origin, decision: item.decision }));
    expect(shape(artifact.items)).toEqual(shape(expectedItems));
    expect(artifact.items.every((item) => item.decision === "undecided")).toBe(true);
    expect(artifact.items.every((item) => item.origin === "ai")).toBe(true);
    // Reload from disk matches; NO receipts were created by the whole cycle.
    const reloaded = await loadStateReview(fixture.bookDir, 16);
    expect(reloaded?.status).toBe("active");
    if (reloaded?.status === "active") {
      expect(reloaded.reviewId).toBe(artifact.reviewId);
      expect(reloaded.reviewRevision).toBe(1);
    }
    expect((await readdir(join(fixture.bookDir, "story", "runtime"), { recursive: true }))
      .map((entry) => entry.replace(/\\/g, "/"))
      .filter((entry) => entry.includes("state-review-receipts")))
      .toEqual([]);
  });

  it("(R2/R17/R22) retry after failure reads LATEST Canon C2 and LATEST prose P3, not cached failed-attempt inputs", async () => {
    await saveViaTask9(fixture, PROSE_P2);
    const canonC1 = (await readStoryCanon(fixture.bookDir)).revision;

    const seenContents: string[] = [];
    const seenCanonRevisions: string[] = [];
    const failing = async (input: { readonly chapterContent: string }): Promise<RuntimeStateDelta> => {
      seenContents.push(input.chapterContent);
      seenCanonRevisions.push((await readStoryCanon(fixture.bookDir)).revision);
      throw new Error("analyzer offline");
    };
    await expect(rebuildStateReview({
      bookDir: fixture.bookDir, chapter: 16, language: "zh", analyze: failing,
    })).rejects.toMatchObject({ code: "state_review_rebuild_failed" });
    const failedShell = await loadStateReview(fixture.bookDir, 16);
    expect(failedShell?.status).toBe("rebuild_failed");

    // Legitimate Canon mutation to C2 WITHOUT touching prose…
    const currentStatePath = join(fixture.bookDir, "story", "state", "current_state.json");
    const currentState = JSON.parse(await readFile(currentStatePath, "utf-8")) as {
      chapter: number; facts: Array<Record<string, unknown>>;
    };
    currentState.facts.push({
      subject: "主角", predicate: "当前位置", object: "中转安全屋",
      validFromChapter: 13, validUntilChapter: null, sourceChapter: 12,
    });
    await writeFile(currentStatePath, JSON.stringify(currentState, null, 2), "utf-8");
    const canonC2 = (await readStoryCanon(fixture.bookDir)).revision;
    expect(canonC2).not.toBe(canonC1);

    // …and a Task 9 prose edit P2 → P3 which returns workflow to rebuild_required.
    const PROSE_P3 = `${PROSE_P2}\n\n她决定留守伦敦。`;
    await saveViaTask9(fixture, PROSE_P3);
    expect((await loadStateReview(fixture.bookDir, 16))?.status).toBe("rebuild_required");

    let retryContent = "";
    let retryCanon = "";
    const { artifact } = await rebuildStateReview({
      bookDir: fixture.bookDir, chapter: 16, language: "zh",
      analyze: async (input) => {
        retryContent = input.chapterContent;
        retryCanon = (await readStoryCanon(fixture.bookDir)).revision;
        return factDelta(16, "北岸灯塔");
      },
    });

    // Retry analyzed the NEWEST inputs — nothing cached from the failed attempt.
    const durableP3 = await readDurableProse(fixture, 16);
    expect(retryContent).toBe(durableP3);
    expect(durableP3).toContain("留守伦敦");
    expect(seenContents.at(-1)).toBe(`${PROSE_P2}\n`);
    expect(retryCanon).toBe(canonC2);
    expect(seenCanonRevisions.at(-1)).toBe(canonC1);
    expect(artifact.baseCanonRevision).toBe(canonC2);
    expect(artifact.proseRevision).toBe(computeProseRevision(durableP3));
    expect(artifact.status).toBe("active");
    expect(artifact.reviewRevision).toBe(1);
  });

  it("(R3/W) analyze failure → durable rebuild_failed shell, prose survives, Canon frozen, shell non-confirmable", async () => {
    await saveViaTask9(fixture, PROSE_P2);
    const before = await captureBookMetadata(fixture.root);

    await expect(rebuildStateReview({
      bookDir: fixture.bookDir, chapter: 16, language: "zh",
      analyze: async () => { throw new Error("provider exploded"); },
    })).rejects.toMatchObject({
      code: "state_review_rebuild_failed",
      message: expect.stringContaining("provider exploded"),
    });

    // Prose byte-identical, Canon untouched, only the artifact flipped.
    expect(await readDurableProse(fixture, 16)).toBe(`${PROSE_P2}\n`);
    const after = await captureBookMetadata(fixture.root);
    expectOnlyPathsChanged(before, after, [SHELL_RELPATH]);
    const reloaded = await loadStateReview(fixture.bookDir, 16);
    expect(reloaded?.status).toBe("rebuild_failed");
    if (reloaded?.status === "rebuild_failed") {
      expect(reloaded.reason).toContain("provider exploded");
      expect(reloaded.sourceChapter).toBe(16);
    }
    const indexOnDisk = JSON.parse(await readFile(join(fixture.bookDir, "chapters", "index.json"), "utf-8"));
    expect(indexOnDisk[0].status).toBe("needs-state-review");

    // Failure shell is NON-CONFIRMABLE through real Task 8 with ZERO writes.
    await expect(decideStateReviewItem({
      bookDir: fixture.bookDir, chapter: 16, itemId: "whatever",
      decision: "accept", expectedReviewRevision: 1,
    })).rejects.toMatchObject({ code: "state_review_stale" });
    expect(await captureBookMetadata(fixture.root)).toEqual(after);
  });

  it("(R7/O) repeated failures stay failed without consuming a reviewId; success mints a fresh one each time", async () => {
    await saveViaTask9(fixture, PROSE_P2);
    const failing = async (): Promise<RuntimeStateDelta> => { throw new Error("down again"); };
    await expect(rebuildStateReview({ bookDir: fixture.bookDir, chapter: 16, language: "zh", analyze: failing }))
      .rejects.toMatchObject({ code: "state_review_rebuild_failed" });
    await expect(rebuildStateReview({ bookDir: fixture.bookDir, chapter: 16, language: "zh", analyze: failing }))
      .rejects.toMatchObject({ code: "state_review_rebuild_failed" });
    expect((await loadStateReview(fixture.bookDir, 16))?.status).toBe("rebuild_failed");

    const first = await rebuildStateReview({
      bookDir: fixture.bookDir, chapter: 16, language: "zh",
      analyze: async () => factDelta(16, "北岸灯塔"),
    });
    expect(first.artifact.status).toBe("active");

    // Full second generation cycle: invalidate → fail → succeed ⇒ yet another id.
    await saveViaTask9(fixture, `${PROSE_P2}\n\n续写。`);
    await expect(rebuildStateReview({ bookDir: fixture.bookDir, chapter: 16, language: "zh", analyze: failing }))
      .rejects.toMatchObject({ code: "state_review_rebuild_failed" });
    const second = await rebuildStateReview({
      bookDir: fixture.bookDir, chapter: 16, language: "zh",
      analyze: async () => factDelta(16, "南岸仓库"),
    });
    expect(second.artifact.reviewId).not.toBe(first.artifact.reviewId);
    expect(second.artifact.reviewRevision).toBe(1);
    expect(second.artifact.items.every((item) => item.decision === "undecided")).toBe(true);
  });

  it("(R6/N) wrong preconditions fail closed with ZERO writes: already-active / stale / missing", async () => {
    // Already-active ⇒ already_resolved.
    await publishActiveProposal(fixture.bookDir, {
      schemaVersion: 1, status: "active", reviewId: REVIEW_ID_R1, sourceChapter: 16,
      effectiveChapter: 13, proseRevision: "0123456789abcdef", baseCanonRevision: "fedcba9876543210",
      reviewRevision: 1, items: [], createdAt: CREATED_AT, language: "zh",
    });
    const beforeActive = await captureBookMetadata(fixture.root);
    await expect(rebuildStateReview({
      bookDir: fixture.bookDir, chapter: 16, language: "zh", analyze: async () => factDelta(16, "x"),
    })).rejects.toMatchObject({ code: "state_review_already_resolved" });
    expect(await captureBookMetadata(fixture.root)).toEqual(beforeActive);

    // Stale ⇒ stale.
    await saveViaTask9(fixture, PROSE_P2); // replaces active with rebuild_required
    const staleArtifact = JSON.parse(await readFile(join(fixture.bookDir, SHELL_RELPATH), "utf-8")) as Record<string, unknown>;
    await writeFile(join(fixture.bookDir, SHELL_RELPATH), JSON.stringify({
      ...staleArtifact, status: "stale", reviewId: REVIEW_ID_R1, effectiveChapter: 13,
      proseRevision: "0123456789abcdef", baseCanonRevision: "fedcba9876543210",
      reviewRevision: 1, items: [],
    }, null, 2), "utf-8");
    const beforeStale = await captureBookMetadata(fixture.root);
    await expect(rebuildStateReview({
      bookDir: fixture.bookDir, chapter: 16, language: "zh", analyze: async () => factDelta(16, "x"),
    })).rejects.toMatchObject({ code: "state_review_stale" });
    expect(await captureBookMetadata(fixture.root)).toEqual(beforeStale);

    // Missing artifact entirely ⇒ not_found.
    await rm(join(fixture.bookDir, SHELL_RELPATH));
    const beforeMissing = await captureBookMetadata(fixture.root);
    await expect(rebuildStateReview({
      bookDir: fixture.bookDir, chapter: 16, language: "zh", analyze: async () => factDelta(16, "x"),
    })).rejects.toMatchObject({ code: "state_review_not_found" });
    expect(await captureBookMetadata(fixture.root)).toEqual(beforeMissing);
  });

  it("(R11/I) zero-effect delta still yields an ACTIVE review that keeps awaiting human confirmation", async () => {
    await saveViaTask9(fixture, PROSE_P2);
    const before = await captureBookMetadata(fixture.root);
    const { artifact } = await rebuildStateReview({
      bookDir: fixture.bookDir, chapter: 16, language: "zh",
      analyze: async () => RuntimeStateDeltaSchema.parse({ chapter: 16 }),
    });
    expect(artifact.status).toBe("active");
    expect(artifact.items).toEqual([]);
    expectOnlyPathsChanged(before, await captureBookMetadata(fixture.root), [SHELL_RELPATH]);
    const indexOnDisk = JSON.parse(await readFile(join(fixture.bookDir, "chapters", "index.json"), "utf-8"));
    expect(indexOnDisk[0].status).toBe("needs-state-review");
  });

  it("(PART H) identical semantic payload across generations keeps deterministic Task 4 item IDs while identity stays per-generation", async () => {
    await saveViaTask9(fixture, PROSE_P2);
    const first = await rebuildStateReview({
      bookDir: fixture.bookDir, chapter: 16, language: "zh",
      analyze: async () => factDelta(16, "北岸灯塔"),
    });
    await saveViaTask9(fixture, `${PROSE_P2}\n\n微调一句。`);
    const second = await rebuildStateReview({
      bookDir: fixture.bookDir, chapter: 16, language: "zh",
      analyze: async () => factDelta(16, "北岸灯塔"),
    });
    expect(second.artifact.reviewId).not.toBe(first.artifact.reviewId);
    expect(second.artifact.items.map((item) => item.id))
      .toEqual(first.artifact.items.map((item) => item.id));
    expect(second.artifact.items.every((item) => item.decision === "undecided")).toBe(true);
  });

  it("(R20/J) historical rebuild binds sourceChapter=edited but effectiveChapter=confirmedHead+1", async () => {
    // Confirmed Canon semantics applied through ch25; editing historical ch16.
    await setConfirmedHead(fixture, 25);
    await seedChapters(fixture, Array.from({ length: 15 }, (_, index) => index + 1)
      .concat([17, 18, 19, 20, 21, 22, 23, 24, 25]));
    await writeFile(
      join(fixture.bookDir, "chapters", "index.json"),
      JSON.stringify(Array.from({ length: 25 }, (_, index) => ({
        number: index + 1,
        title: `第${index + 1}章`,
        status: (index + 1) === 16 ? "needs-state-review" : "approved",
        wordCount: 10, createdAt: CREATED_AT, updatedAt: CREATED_AT,
        auditIssues: [], lengthWarnings: [],
      })), null, 2),
      "utf-8",
    );
    await saveViaTask9(fixture, PROSE_P2);

    const { artifact } = await rebuildStateReview({
      bookDir: fixture.bookDir, chapter: 16, language: "zh",
      analyze: async () => factDelta(16, "北岸灯塔"),
    });
    expect(artifact.sourceChapter).toBe(16);
    expect(artifact.effectiveChapter).toBe(26);
  });

  it("(V) active-publication failure leaves prior shell and all authoritative state safe", async () => {
    await saveViaTask9(fixture, PROSE_P2);
    const before = await captureBookMetadata(fixture.root);

    armedPublishFailures = 1;
    await expect(rebuildStateReview({
      bookDir: fixture.bookDir, chapter: 16, language: "zh",
      analyze: async () => factDelta(16, "北岸灯塔"),
    })).rejects.toThrow(/injected active-publication failure/);

    // No false success and NO state change at all: the rebuild_required shell
    // from Task 9 remains, prose/Canon/index untouched, no temp residue.
    expect((await loadStateReview(fixture.bookDir, 16))?.status).toBe("rebuild_required");
    expectOnlyPathsChanged(before, await captureBookMetadata(fixture.root), []);
    expect(await readDurableProse(fixture, 16)).toBe(`${PROSE_P2}\n`);
    expect((await readdir(join(fixture.bookDir, "story", "runtime")))
      .filter((name) => name.startsWith(".tmp") || name.includes(".castor-")))
      .toEqual([]);
  });
  // -------------------------------------------------------------------------
  // Fix-up (C-10.1 / I-10.1 / I-10.2 / I-10.3): production adapter, semantic
  // Canon basis, and the public mutation-lock boundary.
  // -------------------------------------------------------------------------

  function makeRunner(): PipelineRunner {
    return new PipelineRunner({
      client: {
        provider: "openai", apiFormat: "chat", stream: false,
        defaults: { temperature: 0.7, maxTokens: 4096, thinkingBudget: 0 },
      } as ConstructorParameters<typeof PipelineRunner>[0]["client"],
      model: "test-model",
      projectRoot: fixture.root,
    });
  }

  interface SettleProbe {
    readonly calls: string[];
    readonly settledContents: string[];
    readonly settledCanonRevisions: string[];
  }

  function makeFakeWriter(
    probe: SettleProbe,
    mode: "valid" | "missing-delta" | "invalid-delta",
  ): Pick<WriterAgent, "settleChapterState"> {
    return {
      settleChapterState: async (input) => {
        probe.calls.push("settle");
        probe.settledContents.push(input.content);
        // The settlement semantic basis is LIVE Canon read from disk — the
        // fake mirrors what WriterAgent.settleChapterState really does.
        probe.settledCanonRevisions.push((await readStoryCanon(fixture.bookDir)).revision);
        if (mode === "missing-delta") return {} as never;
        if (mode === "invalid-delta") {
          return { runtimeStateDelta: { chapter: "not-a-number" } } as never;
        }
        return {
          runtimeStateDelta: factDelta(16, `灯塔目标-第${probe.settledCanonRevisions.length}次`),
        } as never;
      },
    };
  }

  it("(B/C/D/J) public wrapper delegates to canonical settleChapterState under ONE mutation lock; analyzer is not the provider", async () => {
    await saveViaTask9(fixture, PROSE_P2);
    const runner = makeRunner();
    const probe: SettleProbe = { calls: [], settledContents: [], settledCanonRevisions: [] };
    const stateAny = runner as unknown as {
      state: {
        acquireBookLock: (bookId: string) => Promise<() => void>;
        loadBookConfig: (bookId: string) => Promise<unknown>;
      };
    };
    const realAcquire = stateAny.state.acquireBookLock.bind(stateAny.state);
    vi.spyOn(stateAny.state, "acquireBookLock").mockImplementation(async (bookId) => {
      probe.calls.push("acquire");
      const release = await realAcquire(bookId);
      return () => {
        probe.calls.push("release");
        release();
      };
    });
    vi.spyOn(stateAny.state, "loadBookConfig").mockResolvedValue({ language: "zh" } as never);
    // Guard: the impossible analyzer path must NEVER be exercised.
    const analyzerSpy = vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter")
      .mockRejectedValue(new Error("analyzer must not be the proposal provider"));

    let settleInput: { readonly content: string; readonly chapterNumber: number } | undefined;
    const writer = makeFakeWriter(probe, "valid");
    const wrappedWriter: Pick<WriterAgent, "settleChapterState"> = {
      settleChapterState: async (input) => {
        settleInput = { content: input.content, chapterNumber: input.chapterNumber };
        return writer.settleChapterState(input);
      },
    };

    const { artifact } = await runner.regenerateStateReview("demo-canon-book", 16, {
      createWriter: () => wrappedWriter,
    });

    expect(analyzerSpy).not.toHaveBeenCalled();
    expect(settleInput?.chapterNumber).toBe(16);
    expect(settleInput?.content).toBe(await readDurableProse(fixture, 16));
    expect(artifact.status).toBe("active");
    expect(artifact.items.length).toBeGreaterThan(0);
    // Lock acquired exactly once; settlement happened INSIDE the boundary.
    expect(probe.calls).toEqual(["acquire", "settle", "release"]);
    // Proposal semantics derive from the SAME live Canon as the anchor (I-10.2).
    expect(artifact.baseCanonRevision).toBe(probe.settledCanonRevisions[0]);
  });

  it("(M2/M3) missing or invalid settlement delta fails safely into rebuild_failed", async () => {
    await saveViaTask9(fixture, PROSE_P2);
    const runner = makeRunner();
    const stateAny = runner as unknown as {
      state: { loadBookConfig: (bookId: string) => Promise<unknown> };
    };
    vi.spyOn(stateAny.state, "loadBookConfig").mockResolvedValue({ language: "zh" } as never);

    for (const mode of ["missing-delta", "invalid-delta"] as const) {
      const probe: SettleProbe = { calls: [], settledContents: [], settledCanonRevisions: [] };
      const proseAtStart = await readDurableProse(fixture, 16);
      await expect(runner.regenerateStateReview("demo-canon-book", 16, {
        createWriter: () => makeFakeWriter(probe, mode),
      })).rejects.toMatchObject({ code: "state_review_rebuild_failed" });
      expect((await loadStateReview(fixture.bookDir, 16))?.status).toBe("rebuild_failed");
      // Failure never touches prose.
      expect(await readDurableProse(fixture, 16)).toBe(proseAtStart);
      // Retry authorization requires a shell ⇒ flip back via Task 9 for round 2.
      if (mode === "missing-delta") {
        await saveViaTask9(fixture, `${PROSE_P2}\n\n重试前再改一笔。`);
      }
    }
  });

  it("(G/F-B) pending CURRENT chapter over confirmed head anchors effective at its OWN source (26), not 27", async () => {
    // Confirmed Canon head = 25 (semantics APPLIED through ch25), while ch26
    // exists only as a pending gated review awaiting human confirmation.
    await setConfirmedHead(fixture, 25);
    await seedChapters(fixture, [26]);
    await writeFile(
      join(fixture.bookDir, "chapters", "index.json"),
      JSON.stringify([
        ...Array.from({ length: 25 }, (_, index) => ({
          number: index + 1, title: `第${index + 1}章`, status: "approved",
          wordCount: 10, createdAt: CREATED_AT, updatedAt: CREATED_AT,
          auditIssues: [], lengthWarnings: [],
        })),
        {
          number: 26, title: "第26章", status: "needs-state-review",
          wordCount: 10, createdAt: CREATED_AT, updatedAt: CREATED_AT,
          auditIssues: [], lengthWarnings: [],
        },
      ], null, 2),
      "utf-8",
    );
    await saveViaTask9(fixture, "# 第26章 反转\n\n林秋烧毁了账本。", 26);

    const { artifact } = await rebuildStateReview({
      bookDir: fixture.bookDir, chapter: 26, language: "zh",
      analyze: async () => factDelta(26, "北岸灯塔"),
    });

    // Design §20 literal result — NOT resolveDurableStoryProgress()+1 (=27).
    expect(artifact.sourceChapter).toBe(26);
    expect(artifact.effectiveChapter).toBe(26);
  });

  it("(F-C) edited READY-head source re-anchors at confirmedHead+1", async () => {
    await setConfirmedHead(fixture, 25);
    await seedChapters(fixture, Array.from({ length: 25 }, (_, index) => index + 1));
    await writeFile(
      join(fixture.bookDir, "chapters", "index.json"),
      JSON.stringify(Array.from({ length: 25 }, (_, index) => ({
        number: index + 1, title: `第${index + 1}章`,
        status: (index + 1) === 16 ? "needs-state-review" : "approved",
        wordCount: 10, createdAt: CREATED_AT, updatedAt: CREATED_AT,
        auditIssues: [], lengthWarnings: [],
      })), null, 2),
      "utf-8",
    );
    await saveViaTask9(fixture, PROSE_P2); // source 16 <= confirmed head 25

    const { artifact } = await rebuildStateReview({
      bookDir: fixture.bookDir, chapter: 16, language: "zh",
      analyze: async () => factDelta(16, "北岸灯塔"),
    });
    expect(artifact.sourceChapter).toBe(16);
    expect(artifact.effectiveChapter).toBe(26);
  });
});
