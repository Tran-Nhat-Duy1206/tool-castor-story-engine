import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createStudioServer } from "../api/server.js";
import {
  commitCanonEdits as coreCommitCanonEdits,
  StateManager,
} from "@actalk/inkos-core";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const DERIVED_MEMORY_WARNING = "derived memory invalidation failed; memory.db may be stale";

interface FileMeta {
  sha256: string;
  size: number;
  mtimeMs: number;
}

async function fileMeta(path: string): Promise<FileMeta> {
  const [buf, st] = await Promise.all([readFile(path), stat(path)]);
  return {
    sha256: createHash("sha256").update(buf).digest("hex"),
    size: buf.byteLength,
    mtimeMs: st.mtimeMs,
  };
}

async function snapshotBookFiles(bookDir: string): Promise<Record<string, FileMeta>> {
  const out: Record<string, FileMeta> = {};
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else {
        out[path.slice(bookDir.length + 1)] = await fileMeta(path);
      }
    }
  }
  await walk(bookDir);
  return out;
}

const BOOK_ID = "demo-canon-book";

const MANIFEST = {
  schemaVersion: 2,
  language: "zh",
  lastAppliedChapter: 12,
  projectionVersion: 3,
  migrationWarnings: [],
};

const FACTS = [
  { subject: "主角", predicate: "当前位置", object: "城南旧宅", validFromChapter: 1, validUntilChapter: 10, sourceChapter: 2 },
  { subject: "主角", predicate: "当前位置", object: "东城公寓", validFromChapter: 11, validUntilChapter: null, sourceChapter: 11 },
  { subject: "主角", predicate: "主角状态", object: "带伤潜行，避开了监控网络", validFromChapter: 12, validUntilChapter: null, sourceChapter: 12 },
  { subject: "林晚", predicate: "身份", object: "卧底记者", validFromChapter: 4, validUntilChapter: null, sourceChapter: 4 },
];

async function seedBook(root: string, opts: { corruptState?: boolean } = {}): Promise<string> {
  const bookDir = join(root, "books", BOOK_ID);
  await mkdir(join(bookDir, "chapters"), { recursive: true });
  await mkdir(join(bookDir, "story", "state"), { recursive: true });
  await writeFile(
    join(bookDir, "book.json"),
    JSON.stringify({ id: BOOK_ID, title: "回声协议", language: "zh", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
    "utf-8",
  );
  for (let chapter = 1; chapter <= 12; chapter += 1) {
    await writeFile(join(bookDir, "chapters", `${String(chapter).padStart(4, "0")}_第${chapter}章.md`), `# 第${chapter}章\n\n正文。`, "utf-8");
  }
  const currentState = { chapter: 12, facts: FACTS };
  const files: Record<string, unknown> = {
    "manifest.json": MANIFEST,
    "current_state.json": currentState,
    "hooks.json": { hooks: [] },
    "chapter_summaries.json": { rows: [] },
  };
  for (const [name, value] of Object.entries(files)) {
    await writeFile(join(bookDir, "story", "state", name), JSON.stringify(value, null, 2), "utf-8");
  }
  if (opts.corruptState) {
    await writeFile(join(bookDir, "story", "state", "current_state.json"), '{ this is not valid json', "utf-8");
  }
  return bookDir;
}

function makeApp(root: string, overrides?: Parameters<typeof createStudioServer>[2]) {
  return createStudioServer({} as never, root, overrides);
}

function post(app: ReturnType<typeof makeApp>, path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

interface JsonRes<T> {
  status: number;
  json(): Promise<T>;
  text(): Promise<string>;
}

describe("GET /api/v1/books/:id/canon — additive revision field", () => {
  let root = "";
  let bookDir = "";
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "canon-edits-route-"));
    bookDir = await seedBook(root);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("exposes the Core revision on the full view and section views", async () => {
    const app = makeApp(root);
    const full = (await app.request(`/api/v1/books/${BOOK_ID}/canon`)) as JsonRes<{ revision?: string }>;
    expect(full.status).toBe(200);
    const body = (await full.json()) as { revision?: string };
    expect(body.revision).toMatch(/^[0-9a-f]{16}$/);

    const section = (await app.request(`/api/v1/books/${BOOK_ID}/canon?section=current_state`)) as JsonRes<{ revision?: string }>;
    expect(((await section.json()) as { revision?: string }).revision).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("POST /api/v1/books/:id/canon/current-state/preview", () => {
  let root = "";
  let bookDir = "";
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "canon-edits-route-"));
    bookDir = await seedBook(root);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("returns effective chapter and revision without mutating the book", async () => {
    const before = await snapshotBookFiles(bookDir);
    const app = makeApp(root);

    const res = await post(app, `/api/v1/books/${BOOK_ID}/canon/current-state/preview`, {
      edits: [{ kind: "setFact", subject: "主角", predicate: "主角状态", object: "伤愈复出" }],
      expectedRevision: "does-not-matter-for-preview",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { effectiveChapter: number; revision: string; issues: unknown[] };
    expect(body.effectiveChapter).toBe(13);
    expect(body.revision).toMatch(/^[0-9a-f]{16}$/);
    expect(Array.isArray(body.issues)).toBe(true);
    // Preview stays PURE even though expectedRevision is irrelevant to it.
    await sleep(40);
    expect(await snapshotBookFiles(bookDir)).toEqual(before);
  });

  it("rejects a payload that fails the CORE schema with 400 + issues", async () => {
    const bookDirBefore = await snapshotBookFiles(bookDir);
    const app = makeApp(root);

    const res = await post(app, `/api/v1/books/${BOOK_ID}/canon/current-state/preview`, {
      edits: [{ kind: "setFact", subject: "", predicate: "主角状态", object: "x" }],
      expectedRevision: "0123456789abcdef",
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: Array<{ message: string }> };
    expect(body.issues.length).toBeGreaterThan(0);
    expect(await snapshotBookFiles(bookDir)).toEqual(bookDirBefore);
  });
});

describe("POST /api/v1/books/:id/canon/current-state/commit", () => {
  let root = "";
  let bookDir = "";
  let revisionA = "";
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "canon-edits-route-"));
    bookDir = await seedBook(root);
    const app = makeApp(root);
    const res = await app.request(`/api/v1/books/${BOOK_ID}/canon`);
    revisionA = ((await res.json()) as { revision: string }).revision;
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("commits a setFact round-trip: new revision, refreshed live+snapshot state, no fs paths leaked", async () => {
    const app = makeApp(root);

    const res = await post(app, `/api/v1/books/${BOOK_ID}/canon/current-state/commit`, {
      edits: [{ kind: "setFact", subject: "主角", predicate: "主角状态", object: "伤愈复出" }],
      expectedRevision: revisionA,
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(root); // never leak absolute filesystem paths
    const body = JSON.parse(text) as { ok: boolean; revision: string; effectiveChapter: number; appliedEdits: number; warnings: string[] };
    expect(body.ok).toBe(true);
    expect(body.revision).not.toBe(revisionA);
    expect(body.revision).toMatch(/^[0-9a-f]{16}$/);
    expect(body.effectiveChapter).toBe(13);
    expect(body.appliedEdits).toBe(1);

    // Live canon spliced forward.
    const live = JSON.parse(await readFile(join(bookDir, "story", "state", "current_state.json"), "utf-8")) as {
      facts: Array<{ predicate: string; object: string; validFromChapter: number; validUntilChapter: number | null }>;
    };
    const rows = live.facts.filter((f) => f.predicate === "主角状态");
    expect(rows.some((r) => r.object === "伤愈复出" && r.validFromChapter === 13 && r.validUntilChapter === null)).toBe(true);
    expect(rows.every((r) => r.object !== "带伤潜行，避开了监控网络" || r.validUntilChapter !== null)).toBe(true);

    // Head snapshot mirror refreshed inside the same transaction.
    const mirrored = await readFile(join(bookDir, "story", "snapshots", "12", "state", "current_state.json"), "utf-8");
    expect(mirrored.trim()).toBe(JSON.stringify(live, null, 2).trim());

    // GET now reports the new revision (server-authoritative refetch).
    const after = (await app.request(`/api/v1/books/${BOOK_ID}/canon`)) as JsonRes<{ revision: string }>;
    expect(((await after.json()) as { revision: string }).revision).toBe(body.revision);
  });

  it("rejects schema-invalid bodies with 400 + issues and writes NOTHING", async () => {
    const before = await snapshotBookFiles(bookDir);
    const app = makeApp(root);

    for (const bad of [
      { edits: [], expectedRevision: revisionA },
      { edits: [{ kind: "rewriteEverything" }], expectedRevision: revisionA },
      { edits: [{ kind: "setFact", subject: "主角", predicate: "主角状态", object: "x" }] },
      { edits: [{ kind: "setFact", subject: "主角", predicate: "主角状态", object: 42 }], expectedRevision: revisionA },
    ]) {
      const res = await post(app, `/api/v1/books/${BOOK_ID}/canon/current-state/commit`, bad);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; issues: Array<{ message: string }> };
      expect(body.issues.length).toBeGreaterThan(0);
    }

    expect(await snapshotBookFiles(bookDir)).toEqual(before);
  });

  it("maps a semantically empty-but-valid edit set through the full commit path", async () => {
    // NOTE: duplicate_active_fact / effective_chapter_mismatch are NOT
    // reachable through semantic API payloads — the reducer applies edits
    // sequentially, so same-key setFacts collapse to the last value and new
    // rows are always anchored by the server. invalid_canon_edits remains a
    // defensive server mapping (Core throws it for non-reducer inputs).
    const before = await snapshotBookFiles(bookDir);
    const app = makeApp(root);

    const res = await post(app, `/api/v1/books/${BOOK_ID}/canon/current-state/commit`, {
      edits: [
        { kind: "setFact", subject: "主角", predicate: "主角状态", object: "伤愈复出" },
        { kind: "setFact", subject: "主角", predicate: "主角状态", object: "旧伤复发" },
      ],
      expectedRevision: revisionA,
    });

    // Sequential application ⇒ last value wins as the single open row.
    expect(res.status).toBe(200);
    const body = (await res.json()) as { appliedEdits: number };
    expect(body.appliedEdits).toBe(2);
    const live = JSON.parse(await readFile(join(bookDir, "story", "state", "current_state.json"), "utf-8")) as {
      facts: Array<{ predicate: string; object: string; validUntilChapter: number | null }>;
    };
    const openRows = live.facts.filter((f) => f.predicate === "主角状态" && f.validUntilChapter === null);
    expect(openRows).toHaveLength(1);
    expect(openRows[0]?.object).toBe("旧伤复发");
    expect(before).toBeDefined();
  });

  it("treats removeFact of an absent key as a no-op success (approved reducer semantics)", async () => {
    const app = makeApp(root);
    const res = await post(app, `/api/v1/books/${BOOK_ID}/canon/current-state/commit`, {
      edits: [{ kind: "removeFact", subject: "不存在的人", predicate: "不存在的事" }],
      expectedRevision: revisionA,
    });
    // Reducer drops matching rows only; zero matches ⇒ fact rows unchanged.
    // The commit still lands (the regenerated projection document is part of
    // the revision fingerprint, so the revision MAY advance even though the
    // facts array is untouched).
    expect(res.status).toBe(200);
    const body = (await res.json()) as { appliedEdits: number; revision: string };
    expect(body.appliedEdits).toBe(1);
    expect(body.revision).toMatch(/^[0-9a-f]{16}$/);
    const live = JSON.parse(await readFile(join(bookDir, "story", "state", "current_state.json"), "utf-8")) as {
      facts: Array<{ subject?: string; predicate: string }>;
    };
    expect(live.facts.filter((f) => f.predicate === "主角状态")).toHaveLength(1);
    expect(live.facts.some((f) => f.subject === "不存在的人")).toBe(false);
  });

  it("returns 404 book_not_found for an unknown book without creating files", async () => {
    const app = makeApp(root);
    const res = await post(app, "/api/v1/books/nope/canon/current-state/commit", {
      edits: [{ kind: "setFact", subject: "x", predicate: "y", object: "z" }],
      expectedRevision: revisionA,
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe("book_not_found");
    await expect(stat(join(root, "books", "nope"))).rejects.toThrow();
  });

  it("maps corrupt canon to 409 canon_unavailable and writes NOTHING", async () => {
    await rm(bookDir, { recursive: true, force: true });
    bookDir = await seedBook(root, { corruptState: true });
    const before = await snapshotBookFiles(bookDir);
    const app = makeApp(root);

    const res = await post(app, `/api/v1/books/${BOOK_ID}/canon/current-state/commit`, {
      edits: [{ kind: "setFact", subject: "主角", predicate: "主角状态", object: "伤愈复出" }],
      expectedRevision: "0123456789abcdef",
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; issues: Array<{ scope: string }> };
    expect(body.code).toBe("canon_unavailable");
    expect(await snapshotBookFiles(bookDir)).toEqual(before);
  });

  it("stale expectedRevision ⇒ 409 canon_conflict carrying currentRevision, and the stale request mutates NOTHING", async () => {
    const app = makeApp(root);

    // Advance the book OUTSIDE the route (simulating another writer).
    await coreCommitCanonEdits(bookDir, {
      edits: [{ kind: "setFact", subject: "林晚", predicate: "身份", object: "自由记者" }],
      expectedRevision: revisionA,
    });
    const getAfterExternal = (await app.request(`/api/v1/books/${BOOK_ID}/canon`)) as JsonRes<{ revision: string }>;
    const revisionB = ((await getAfterExternal.json()) as { revision: string }).revision;

    const beforeStale = await snapshotBookFiles(bookDir);
    await sleep(40);
    const res = await post(app, `/api/v1/books/${BOOK_ID}/canon/current-state/commit`, {
      edits: [{ kind: "setFact", subject: "林晚", predicate: "身份", object: "曝光的记者" }],
      expectedRevision: revisionA,
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; currentRevision: string };
    expect(body.code).toBe("canon_conflict");
    expect(body.currentRevision).toBe(revisionB);
    await sleep(40);
    expect(await snapshotBookFiles(bookDir)).toEqual(beforeStale);
  });

  it("surfaces derived-memory failure as warnings while the Canon save still succeeds", async () => {
    // Real sequence: a REBUILD failure triggers invalidation; only when
    // invalidation itself reports failure does the exact warning surface.
    const app = makeApp(root, {
      canonCommitDeps: {
        rebuildNarrativeMemoryIndex: async () => {
          throw new Error("injected rebuild failure");
        },
        invalidateDerivedMemory: async () => ({
          invalidated: false,
          strategy: "failed" as const,
          warning: DERIVED_MEMORY_WARNING,
        }),
      },
    });

    const res = await post(app, `/api/v1/books/${BOOK_ID}/canon/current-state/commit`, {
      edits: [{ kind: "setFact", subject: "主角", predicate: "主角状态", object: "伤愈复出" }],
      expectedRevision: revisionA,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; warnings: string[] };
    expect(body.ok).toBe(true);
    expect(body.warnings).toContain(DERIVED_MEMORY_WARNING);
  });

  it("holds the existing book lock around the whole commit sequence and releases it afterwards", async () => {
    const events: string[] = [];
    // Capture BEFORE spyOn: the mock must call the ORIGINAL, never the spy
    // itself (recursion hazard if a later assertion skips mockRestore).
    const originalAcquire = StateManager.prototype.acquireBookLock;
    const spy = vi.spyOn(StateManager.prototype, "acquireBookLock");
    spy.mockImplementation(async function (this: StateManager, bookId: string) {
      const release = await originalAcquire.call(this, bookId);
      events.push("acquire");
      return async () => {
        events.push("release");
        await release();
      };
    });

    const app = makeApp(root, {
      canonCommitDeps: {
        rebuildCurrentStateFactHistory: async () => {
          events.push("commit-step");
        },
      },
    });

    try {
      const res = await post(app, `/api/v1/books/${BOOK_ID}/canon/current-state/commit`, {
        edits: [{ kind: "setFact", subject: "主角", predicate: "主角状态", object: "伤愈复出" }],
        expectedRevision: revisionA,
      });

      expect(res.status).toBe(200);
      expect(events).toEqual(["acquire", "commit-step", "release"]);
    } finally {
      spy.mockRestore();
    }
  });

  it("serializes concurrent identical commits: exactly one wins, the other fails safely", async () => {
    const app = makeApp(root);
    const payload = {
      edits: [{ kind: "setFact", subject: "主角", predicate: "主角状态", object: "伤愈复出" }],
      expectedRevision: revisionA,
    };

    const [a, b] = await Promise.all([
      post(app, `/api/v1/books/${BOOK_ID}/canon/current-state/commit`, payload),
      post(app, `/api/v1/books/${BOOK_ID}/canon/current-state/commit`, payload),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    const loser = a.status === 409 ? a : b;
    const loserBody = (await loser.json()) as { code: string };
    expect(["canon_conflict", "book_write_locked"]).toContain(loserBody.code);

    // Exactly ONE application landed.
    const live = JSON.parse(await readFile(join(bookDir, "story", "state", "current_state.json"), "utf-8")) as {
      facts: Array<{ predicate: string; object: string; validFromChapter: number; validUntilChapter: number | null }>;
    };
    const openWinnerRows = live.facts.filter(
      (f) => f.predicate === "主角状态" && f.object === "伤愈复出" && f.validUntilChapter === null,
    );
    expect(openWinnerRows).toHaveLength(1);
    expect(openWinnerRows[0]?.validFromChapter).toBe(13);
  });

  it("releases the lock even when the commit fails, so the next attempt can acquire it", async () => {
    const app = makeApp(root);
    // First attempt conflicts (stale), second identical attempt succeeds.
    const stale = await post(app, `/api/v1/books/${BOOK_ID}/canon/current-state/commit`, {
      edits: [{ kind: "setFact", subject: "主角", predicate: "主角状态", object: "伤愈复出" }],
      expectedRevision: "0000000000000000",
    });
    expect(stale.status).toBe(409);

    const freshView = (await app.request(`/api/v1/books/${BOOK_ID}/canon`)) as JsonRes<{ revision: string }>;
    const freshRevision = ((await freshView.json()) as { revision: string }).revision;
    const retry = await post(app, `/api/v1/books/${BOOK_ID}/canon/current-state/commit`, {
      edits: [{ kind: "setFact", subject: "主角", predicate: "主角状态", object: "伤愈复出" }],
      expectedRevision: freshRevision,
    });
    expect(retry.status).toBe(200);
  });

  it("refuses commits while another writer holds the lock (409 book_write_locked)", async () => {
    const manager = new StateManager(root);
    const release = await manager.acquireBookLock(BOOK_ID);
    try {
      const app = makeApp(root);
      const res = await post(app, `/api/v1/books/${BOOK_ID}/canon/current-state/commit`, {
        edits: [{ kind: "setFact", subject: "主角", predicate: "主角状态", object: "伤愈复出" }],
        expectedRevision: revisionA,
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("book_write_locked");

      const before = await snapshotBookFiles(bookDir);
      await sleep(20);
      const previewWhileLocked = await post(app, `/api/v1/books/${BOOK_ID}/canon/current-state/commit`, {
        edits: [{ kind: "setFact", subject: "主角", predicate: "主角状态", object: "伤愈复出" }],
        expectedRevision: revisionA,
      });
      expect(previewWhileLocked.status).toBe(409);
      expect(await snapshotBookFiles(bookDir)).toEqual(before);
    } finally {
      await release();
    }
  });
});
