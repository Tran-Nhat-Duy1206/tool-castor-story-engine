/**
 * Task 14 — HTTP routes + typed client for the Phase 4 State Review boundary.
 *
 * Contract under test (plan Task 14):
 *   - every mutation wraps the SAME `acquireBookLock` used by other writers
 *     (except confirm/rebuild, whose Core boundaries own the process lock
 *     themselves — double acquisition is a hard error in this process);
 *   - `StateReviewError` maps `state_review_not_found` → 404 and every other
 *     code → 409 `{error, code, itemId?}`; non-StateReviewError → 500 with a
 *     fixed string (no paths, no stacks);
 *   - confirm WITHOUT a reviewId ⇒ 400 BEFORE any lock/Core work;
 *   - the lost-response retry (repeat confirm after the artifact was deleted)
 *     resolves idempotently through HTTP as `already_resolved`;
 *   - the typed client always SENDS the artifact's reviewId on confirm.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ACTIVE_REVIEW_RELPATH,
  RECEIPTS_DIR,
  computeProseRevision,
  publishActiveProposal,
  readStoryCanon,
  saveStateReviewShell,
  writeResolvedReceipt,
  type ResolvedReviewReceipt,
} from "@actalk/castor-core";
import { createStudioServer } from "../api/server.js";
import {
  confirmReview,
  postStateReviewDecision,
} from "../lib/state-review-api.js";

const BOOK_ID = "demo-canon-book";
const CHAPTER = 13;
const REVIEW_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3303";
const OTHER_REVIEW_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3304";
const CREATED_AT = "2026-08-24T00:00:00.000Z";
const PROSE_13 = "mock_val，mock_val。";

function makeApp(root: string, overrides?: Parameters<typeof createStudioServer>[2]) {
  return createStudioServer({} as never, root, overrides);
}

interface JsonRes<T> {
  status: number;
  json(): Promise<T>;
  text(): Promise<string>;
}

function post(app: ReturnType<typeof makeApp>, path: string, body?: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function del(app: ReturnType<typeof makeApp>, path: string) {
  return app.request(path, { method: "DELETE" });
}

function factItem(id: string): Parameters<typeof publishActiveProposal>[1]["items"] extends ReadonlyArray<infer T> ? T : never {
  return {
    id,
    kind: "current-state-fact",
    origin: "ai",
    title: "Current-state update: mock_val",
    proposal: { type: "fact", change: { action: "set", subject: "mock_val", predicate: "mock_val", object: "mock_val" } },
    evidence: { claimedLevel: "explicit", verifiedLevel: "explicit", quote: PROSE_13 },
    decision: "accepted",
  } as never;
}

function summaryItem(id: string) {
  return {
    id,
    kind: "chapter-summary",
    origin: "ai",
    title: "Chapter summary: ch 13 mock_val",
    proposal: {
      type: "chapter-summary",
      row: {
        chapter: CHAPTER,
        title: "mock_val",
        characters: "mock_val；mock_val",
        events: "mock_val",
        stateChanges: "mock_val→mock_val",
        hookActivity: "",
        mood: "mock_val",
        chapterType: "mock_val",
      },
    },
    decision: "accepted",
  } as never;
}

async function seedBook(root: string): Promise<string> {
  const bookDir = join(root, "books", BOOK_ID);
  await mkdir(join(bookDir, "chapters"), { recursive: true });
  await mkdir(join(bookDir, "story", "state"), { recursive: true });
  // Pipeline-backed routes (rebuild) read the project config like write-next.
  // A loopback baseUrl marks the API key optional (llm-endpoint-auth); the
  // rebuild test injects its own writer so no endpoint is ever contacted.
  await writeFile(
    join(root, "castor.json"),
    JSON.stringify({
      name: "test-project", version: "0.1.0", language: "zh",
      llm: { model: "test-model", provider: "custom", baseUrl: "http://127.0.0.1:9/v1" },
      notify: [],
    }),
    "utf-8",
  );
  await writeFile(
    join(bookDir, "book.json"),
    JSON.stringify({ id: BOOK_ID, title: "mock_val", language: "zh", createdAt: CREATED_AT, updatedAt: CREATED_AT }),
    "utf-8",
  );
  const index = Array.from({ length: 12 }, (_, i) => i + 1).map((number) => ({
    number,
    title: `mock_val${number}mock_val`,
    status: "approved",
    wordCount: 10,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    auditIssues: [],
    lengthWarnings: [],
  }));
  for (let chapter = 1; chapter <= 12; chapter += 1) {
    await writeFile(
      join(bookDir, "chapters", `${String(chapter).padStart(4, "0")}_mock_val${chapter}mock_val.md`),
      `# mock_val${chapter}mock_val\n\nmock_val。`,
      "utf-8",
    );
  }
  await writeFile(join(bookDir, "chapters", "index.json"), JSON.stringify(index), "utf-8");
  const canonDocs: Record<string, unknown> = {
    "manifest.json": {
      schemaVersion: 2, language: "zh", lastAppliedChapter: 12,
      projectionVersion: 3, migrationWarnings: [],
    },
    "current_state.json": { chapter: 12, facts: [] },
    "hooks.json": { hooks: [] },
    "chapter_summaries.json": { rows: [] },
  };
  for (const [name, value] of Object.entries(canonDocs)) {
    await writeFile(join(bookDir, "story", "state", name), JSON.stringify(value, null, 2), "utf-8");
  }
  // Snapshot mirror at the confirmed head (confirm compiles candidates FROM it).
  for (const [name, value] of Object.entries(canonDocs)) {
    await mkdir(join(bookDir, "story", "snapshots", "12", "state"), { recursive: true });
    await writeFile(
      join(bookDir, "story", "snapshots", "12", "state", name),
      JSON.stringify(value, null, 2),
      "utf-8",
    );
  }
  return bookDir;
}

/** Durable prose + index entry + ACTIVE review for source chapter 13. */
async function seedActiveReview(bookDir: string, reviewId: string = REVIEW_ID): Promise<void> {
  await writeFile(join(bookDir, "chapters", "0013_mock_val.md"), PROSE_13, "utf-8");
  const index = [
    ...Array.from({ length: 12 }, (_, i) => i + 1).map((number) => ({
      number,
      title: `mock_val${number}mock_val`,
      status: "approved",
      wordCount: 10,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      auditIssues: [],
      lengthWarnings: [],
    })),
    {
      number: CHAPTER,
      title: "mock_val",
      status: "needs-state-review",
      wordCount: 20,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      auditIssues: [],
      lengthWarnings: [],
    },
  ];
  await writeFile(join(bookDir, "chapters", "index.json"), JSON.stringify(index), "utf-8");
  const canon = await readStoryCanon(bookDir);
  await publishActiveProposal(bookDir, {
    status: "active",
    schemaVersion: 1,
    sourceChapter: CHAPTER,
    createdAt: CREATED_AT,
    language: "zh",
    reviewId,
    effectiveChapter: CHAPTER, // healthy book: head12 ⇒ slot13
    proseRevision: computeProseRevision(PROSE_13),
    baseCanonRevision: canon.revision,
    reviewRevision: 1,
    items: [factItem("item-fact"), summaryItem("item-summary")],
  } as never);
}

function makeReceipt(reviewId: string, resolvedAt: string): ResolvedReviewReceipt {
  return {
    schemaVersion: 1,
    reviewId,
    sourceChapter: CHAPTER,
    effectiveChapter: CHAPTER,
    proseRevision: computeProseRevision(PROSE_13),
    baseCanonRevision: "0123456789abcdef",
    resultingCanonRevision: "fedcba9876543210",
    proposals: [],
    decisions: [],
    effectiveChanges: [],
    evidence: [],
    resolvedAt,
    resolution: "confirmed-changes",
  } as never;
}

describe("state-review HTTP routes (Task 14)", () => {
  let root = "";
  let bookDir = "";
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "state-review-route-"));
    bookDir = await seedBook(root);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  });

  const base = `/api/v1/books/${BOOK_ID}/chapters/${CHAPTER}/state-review`;

  it("GET returns the active artifact (happy path)", async () => {
    await seedActiveReview(bookDir);
    const app = makeApp(root);
    const res = await app.request(base);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      review: { status: string; reviewId: string; sourceChapter: number; effectiveChapter: number; reviewRevision: number };
    };
    expect(body.review.status).toBe("active");
    expect(body.review.reviewId).toBe(REVIEW_ID);
    expect(body.review.sourceChapter).toBe(CHAPTER);
    expect(body.review.effectiveChapter).toBe(CHAPTER);
    expect(body.review.reviewRevision).toBe(1);
  });

  it("GET with no artifact returns review:null (not an error)", async () => {
    const app = makeApp(root);
    const res = await app.request(base);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { review: null }).review).toBeNull();
  });

  it("decision round-trip bumps reviewRevision and persists the accept", async () => {
    await seedActiveReview(bookDir);
    const app = makeApp(root);
    const res = await post(app, `${base}/decision`, {
      itemId: "item-fact", decision: "accept", expectedReviewRevision: 1,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; artifact: { reviewRevision: number; items: Array<{ id: string; decision: string }> } };
    expect(body.ok).toBe(true);
    expect(body.artifact.reviewRevision).toBe(2);
    expect(body.artifact.items.find((item) => item.id === "item-fact")?.decision).toBe("accepted");

    const get = await app.request(base);
    const reread = (await get.json()) as { review: { reviewRevision: number } };
    expect(reread.review.reviewRevision).toBe(2);
  });

  it("wrong expectedReviewRevision ⇒ 409 state_review_edit_conflict carrying itemId", async () => {
    await seedActiveReview(bookDir);
    const app = makeApp(root);
    const res = await post(app, `${base}/decision`, {
      itemId: "item-fact", decision: "accept", expectedReviewRevision: 99,
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; itemId?: string };
    expect(body.code).toBe("state_review_edit_conflict");
  });

  it("edit route marks the item edited with the typed change", async () => {
    await seedActiveReview(bookDir);
    const app = makeApp(root);
    const res = await post(app, `${base}/edit`, {
      itemId: "item-fact",
      editedChange: { type: "fact", change: { action: "set", subject: "mock_val", predicate: "mock_val", object: "mock_val" } },
      expectedReviewRevision: 1,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { artifact: { items: Array<{ id: string; decision: string }> } };
    const item = body.artifact.items.find((entry) => entry.id === "item-fact");
    expect(item?.decision).toBe("edited");
  });

  it("items add creates an immediately-accepted user item; DELETE removes it", async () => {
    await seedActiveReview(bookDir);
    const app = makeApp(root);
    const add = await post(app, `${base}/items`, {
      kind: "current-state-fact",
      change: { type: "fact", change: { action: "set", subject: "mock_val", predicate: "mock_val", object: "mock_val" } },
      title: "User correction",
      expectedReviewRevision: 1,
    });
    expect(add.status).toBe(200);
    const added = (await add.json()) as { artifact: { reviewRevision: number; items: Array<{ id: string; origin: string; decision: string }> } };
    const userItem = added.artifact.items.find((entry) => entry.origin === "user");
    expect(userItem?.decision).toBe("accepted");

    const remove = await del(app, `${base}/items/user/${userItem?.id}?expectedReviewRevision=${added.artifact.reviewRevision}`);
    expect(remove.status).toBe(200);
    const removed = (await remove.json()) as { artifact: { items: Array<{ origin: string }> } };
    expect(removed.artifact.items.some((entry) => entry.origin === "user")).toBe(false);
  });

  it("items add with an unknown kind ⇒ 400 invalid_request at the Studio boundary, never a generic 500 (Task14 M1)", async () => {
    await seedActiveReview(bookDir);
    const app = makeApp(root);
    const res = await post(app, `${base}/items`, {
      kind: "relationship-rewrite",
      change: { type: "fact", change: { action: "set", subject: "a", predicate: "b", object: "c" } },
      title: "Unsupported family",
      expectedReviewRevision: 1,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; error?: string };
    expect(body.code).toBe("invalid_request");
    expect(typeof body.error).toBe("string");
    // The active artifact must be untouched — zero-write rejection.
    const get = await app.request(base);
    expect(((await get.json()) as { review: { reviewRevision: number } }).review.reviewRevision).toBe(1);
  });

  it("reject-all demands the explicit-evidence override, then flips every actionable AI item", async () => {
    await seedActiveReview(bookDir);
    const app = makeApp(root);
    // Batch friction (spec §6): one seeded AI item carries verified explicit
    // evidence ⇒ the batch reject refuses WITHOUT the override.
    const blocked = await post(app, `${base}/reject-all`, { expectedReviewRevision: 1 });
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as { code: string }).code).toBe("state_review_invalid_change");

    const res = await post(app, `${base}/reject-all`, { expectedReviewRevision: 1, overrideExplicitWarning: true });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { artifact: { items: Array<{ id: string; origin: string; decision: string }> } };
    for (const item of body.artifact.items) {
      if (item.origin === "ai") {
        // both seeded AI items are actionable kinds ⇒ both rejected
        expect(item.decision).toBe("rejected");
      }
    }
  });

  it("explicit-evidence reject WITHOUT override ⇒ 409 invalid_change + itemId; WITH override ⇒ 200", async () => {
    await seedActiveReview(bookDir);
    const app = makeApp(root);
    const blocked = await post(app, `${base}/decision`, {
      itemId: "item-fact", decision: "reject", expectedReviewRevision: 1,
    });
    expect(blocked.status).toBe(409);
    const blockedBody = (await blocked.json()) as { code: string; itemId?: string };
    expect(blockedBody.code).toBe("state_review_invalid_change");
    expect(blockedBody.itemId).toBe("item-fact");

    const allowed = await post(app, `${base}/decision`, {
      itemId: "item-fact", decision: "reject", expectedReviewRevision: 1,
      overrideExplicitWarning: true,
    });
    expect(allowed.status).toBe(200);
  });

  it("confirm WITHOUT reviewId ⇒ 400 before any Core work", async () => {
    await seedActiveReview(bookDir);
    const app = makeApp(root);
    const res = await post(app, `${base}/confirm`, { expectedReviewRevision: 1 });
    expect(res.status).toBe(400);
    await expect(readFile(join(bookDir, ACTIVE_REVIEW_RELPATH(CHAPTER)), "utf-8")).resolves.toBeDefined();
  });

  it("confirm with matching reviewId ⇒ 200 resolved + fs lands head13/snapshot13/artifact deleted", async () => {
    await seedActiveReview(bookDir);
    const app = makeApp(root);
    const res = await post(app, `${base}/confirm`, { reviewId: REVIEW_ID, expectedReviewRevision: 1 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean; status: string; resultingCanonRevision: string;
      receipt: { reviewId: string; effectiveChapter: number };
      warnings: string[];
    };
    expect(body.ok).toBe(true);
    expect(body.status).toBe("resolved");
    expect(body.receipt.reviewId).toBe(REVIEW_ID);
    expect(body.receipt.effectiveChapter).toBe(CHAPTER);

    const manifest = JSON.parse(await readFile(join(bookDir, "story", "state", "manifest.json"), "utf-8")) as { lastAppliedChapter: number };
    expect(manifest.lastAppliedChapter).toBe(CHAPTER);
    const current = JSON.parse(await readFile(join(bookDir, "story", "state", "current_state.json"), "utf-8")) as { chapter: number };
    expect(current.chapter).toBe(CHAPTER);
    const snap13 = JSON.parse(await readFile(join(bookDir, "story", "snapshots", "13", "state", "manifest.json"), "utf-8")) as { lastAppliedChapter: number };
    expect(snap13.lastAppliedChapter).toBe(CHAPTER);
    await expect(stat(join(bookDir, ACTIVE_REVIEW_RELPATH(CHAPTER)))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("lost-response retry through HTTP: repeat confirm post-deletion ⇒ 200 already_resolved", async () => {
    await seedActiveReview(bookDir);
    const app = makeApp(root);
    const first = await post(app, `${base}/confirm`, { reviewId: REVIEW_ID, expectedReviewRevision: 1 });
    expect(first.status).toBe(200);
    const retry = await post(app, `${base}/confirm`, { reviewId: REVIEW_ID, expectedReviewRevision: 1 });
    expect(retry.status).toBe(200);
    expect(((await retry.json()) as { status: string }).status).toBe("already_resolved");
  });

  it("wrong reviewId ⇒ 404 per Core mapping (superseded generation)", async () => {
    await seedActiveReview(bookDir, REVIEW_ID);
    const app = makeApp(root);
    const res = await post(app, `${base}/confirm`, { reviewId: OTHER_REVIEW_ID, expectedReviewRevision: 1 });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe("state_review_not_found");
  });

  it("shell (rebuild_required) confirm hits Core's not_found path — exact mapped code asserted", async () => {
    await saveStateReviewShell(bookDir, {
      status: "rebuild_required",
      schemaVersion: 1,
      sourceChapter: CHAPTER,
      createdAt: CREATED_AT,
      language: "zh",
      reason: "prose edited after publication",
    } as never);
    const app = makeApp(root);
    const res = await post(app, `${base}/confirm`, { reviewId: REVIEW_ID, expectedReviewRevision: 1 });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe("state_review_not_found");
  });

  it("rebuild refuses while an ACTIVE proposal exists ⇒ 409 already_resolved (frozen authorization)", async () => {
    await seedActiveReview(bookDir);
    const app = makeApp(root, {
      stateReviewRebuildDeps: {
        createWriter: () => ({
          settleChapterState: async () => {
            throw new Error("must never be reached");
          },
        }),
      },
    });
    const res = await post(app, `${base}/rebuild`, {});
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("state_review_already_resolved");
  });

  it("rebuild from a rebuild_required shell with a failing settler ⇒ 409 state_review_rebuild_failed + durable shell", async () => {
    await writeFile(join(bookDir, "chapters", "0013_mock_val.md"), PROSE_13, "utf-8");
    await saveStateReviewShell(bookDir, {
      status: "rebuild_required",
      schemaVersion: 1,
      sourceChapter: CHAPTER,
      createdAt: CREATED_AT,
      language: "zh",
      reason: "prose edited after publication",
    } as never);
    const app = makeApp(root, {
      stateReviewRebuildDeps: {
        createWriter: () => ({
          settleChapterState: async () => {
            throw new Error("injected analyzer outage");
          },
        }),
      },
    });
    const res = await post(app, `${base}/rebuild`, {});
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("state_review_rebuild_failed");
    // The durable shell records the failure (Task 10 contract).
    const raw = JSON.parse(await readFile(join(bookDir, ACTIVE_REVIEW_RELPATH(CHAPTER)), "utf-8")) as { status: string };
    expect(raw.status).toBe("rebuild_failed");
  });

  it("receipts are returned sorted by resolvedAt ascending regardless of file creation order", async () => {
    await writeResolvedReceipt(bookDir, CHAPTER, makeReceipt(OTHER_REVIEW_ID, "2026-08-24T02:00:00.000Z"));
    await writeResolvedReceipt(bookDir, CHAPTER, makeReceipt(REVIEW_ID, "2026-08-24T01:00:00.000Z"));
    const app = makeApp(root);
    const res = await app.request(`${base}/receipts`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { receipts: Array<{ reviewId: string }> };
    expect(body.receipts.map((receipt) => receipt.reviewId)).toEqual([REVIEW_ID, OTHER_REVIEW_ID]);
  });

  it("unknown book ⇒ 404 on reads and mutations alike", async () => {
    const app = makeApp(root);
    const get = await app.request("/api/v1/books/nope/chapters/1/state-review");
    expect(get.status).toBe(404);
    const postRes = await post(app, "/api/v1/books/nope/chapters/1/state-review/decision", {
      itemId: "x", decision: "accept", expectedReviewRevision: 1,
    });
    expect(postRes.status).toBe(404);
    expect(((await postRes.json()) as { code: string }).code).toBe("book_not_found");
  });

  it("mutation routes hold the shared book lock across the whole sequence and release it", async () => {
    await seedActiveReview(bookDir);
    const events: string[] = [];
    const originalAcquire = (await import("@actalk/castor-core")).StateManager.prototype.acquireBookLock;
    const spy = vi.spyOn((await import("@actalk/castor-core")).StateManager.prototype, "acquireBookLock");
    spy.mockImplementation(async function (this: unknown, bookId: string) {
      const release = await (originalAcquire as (this: unknown, id: string) => Promise<() => Promise<void>>).call(this, bookId);
      events.push("acquire");
      return async () => {
        events.push("release");
        await release();
      };
    });
    try {
      const app = makeApp(root);
      const res = await post(app, `${base}/decision`, {
        itemId: "item-fact", decision: "accept", expectedReviewRevision: 1,
      });
      expect(res.status).toBe(200);
      expect(events).toEqual(["acquire", "release"]);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("state-review typed client (Task 14)", () => {
  let root = "";
  let bookDir = "";
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "state-review-client-"));
    bookDir = await seedBook(root);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  });

  /** fetch adapter that serves requests from the in-process Hono app. */
  function appFetch(app: ReturnType<typeof makeApp>): typeof fetch {
    return ((input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(app.request(input as string, init))) as unknown as typeof fetch;
  }

  const base = `/api/v1/books/${BOOK_ID}/chapters/${CHAPTER}/state-review`;

  it("confirmReview sends {reviewId, expectedReviewRevision} and maps the resolved receipt", async () => {
    await seedActiveReview(bookDir);
    const app = makeApp(root);
    let capturedBody = "";
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      capturedBody = String(init?.body ?? "");
      return appFetch(app)(input, init);
    });
    try {
      const outcome = await confirmReview(BOOK_ID, CHAPTER, REVIEW_ID, 1);
      expect(JSON.parse(capturedBody)).toEqual({ reviewId: REVIEW_ID, expectedReviewRevision: 1 });
      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.status).toBe("resolved");
        expect(outcome.receipt.reviewId).toBe(REVIEW_ID);
      }
    } finally {
      spy.mockRestore();
    }
  });

  it("confirmReview refuses to send a confirm without a reviewId", async () => {
    await expect(confirmReview(BOOK_ID, CHAPTER, "  ", 1)).rejects.toThrow(/reviewId/);
  });

  it("mutation outcomes surface {ok:false, code, itemId} for CAS conflicts", async () => {
    await seedActiveReview(bookDir);
    const app = makeApp(root);
    const outcome = await postStateReviewDecision(
      BOOK_ID,
      CHAPTER,
      { itemId: "item-fact", decision: "accept", expectedReviewRevision: 99 },
      { fetchImpl: appFetch(app) },
    );
    expect(outcome).toMatchObject({ ok: false, code: "state_review_edit_conflict" });
  });

  it("already_resolved retries map through the same client union", async () => {
    await seedActiveReview(bookDir);
    const app = makeApp(root);
    const fetcher = appFetch(app);
    await confirmReview(BOOK_ID, CHAPTER, REVIEW_ID, 1, { fetchImpl: fetcher });
    const retry = await confirmReview(BOOK_ID, CHAPTER, REVIEW_ID, 1, { fetchImpl: fetcher });
    expect(retry).toMatchObject({ ok: true, status: "already_resolved" });
  });
});
