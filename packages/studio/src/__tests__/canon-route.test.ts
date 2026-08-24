import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createStudioServer } from "../api/server.js";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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

const HOOKS = [
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
];

const SUMMARY_ROWS = [
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
];

async function seedBook(root: string, opts: { stateChapterAhead?: boolean; corruptState?: boolean; omitState?: boolean } = {}): Promise<string> {
  const bookDir = join(root, "books", BOOK_ID);
  await mkdir(join(bookDir, "chapters"), { recursive: true });
  if (!opts.omitState) {
    await mkdir(join(bookDir, "story", "state"), { recursive: true });
  }
  await writeFile(
    join(bookDir, "book.json"),
    JSON.stringify({ id: BOOK_ID, title: "回声协议", language: "zh", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
    "utf-8",
  );
  // Bootstrap re-derives manifest.lastAppliedChapter from the contiguous
  // chapter-file prefix, so chapters 1..12 must exist for lastAppliedChapter
  // 12 to stay valid.
  for (let chapter = 1; chapter <= 12; chapter += 1) {
    await writeFile(join(bookDir, "chapters", `${String(chapter).padStart(4, "0")}_第${chapter}章.md`), `# 第${chapter}章\n\n正文。`, "utf-8");
  }
  if (opts.omitState) {
    return bookDir;
  }
  const currentState = { chapter: opts.stateChapterAhead ? 20 : 12, facts: FACTS };
  const files: Record<string, unknown> = {
    "manifest.json": MANIFEST,
    "current_state.json": currentState,
    "hooks.json": { hooks: HOOKS },
    "chapter_summaries.json": { rows: SUMMARY_ROWS },
  };
  for (const [name, value] of Object.entries(files)) {
    await writeFile(join(bookDir, "story", "state", name), JSON.stringify(value, null, 2), "utf-8");
  }
  if (opts.corruptState) {
    await writeFile(join(bookDir, "story", "state", "current_state.json"), '{ this is not valid json', "utf-8");
  }
  return bookDir;
}

describe("GET /api/v1/books/:id/canon", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "canon-route-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("returns the full canonical view without exposing filesystem paths", async () => {
    await seedBook(root);
    const app = createStudioServer({} as never, root);

    const res = await app.request(`/api/v1/books/${BOOK_ID}/canon`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toMatch(/books[/\\]/);
    const body = JSON.parse(text) as {
      bookId: string;
      manifest: { lastAppliedChapter: number };
      currentState: { facts: Array<{ object: string }> };
      hooks: { hooks: Array<{ hookId: string; promoted?: boolean }> };
      chapterSummaries: { rows: Array<{ title: string }> };
      description: {
        chapter: number;
        slots: Array<{ key: string; label: string; value: string | null }>;
        additionalFacts: Array<{ subject: string }>;
      };
    };

    expect(body.bookId).toBe(BOOK_ID);
    expect(body.manifest.lastAppliedChapter).toBe(12);
    expect(body.currentState.facts.some((fact) => fact.object === "东城公寓")).toBe(true);
    // Core-computed display projection rides along so the UI never re-derives
    // slot semantics from raw facts.
    expect(body.description.chapter).toBe(12);
    expect(body.description.slots[0]).toMatchObject({ key: "currentLocation", label: "当前位置", value: "东城公寓" });
    expect(body.description.additionalFacts).toHaveLength(1);
    // Full-fidelity hook record: promotion metadata survives transport — no
    // lossy client-side markdown parsing anywhere in this path.
    expect(body.hooks.hooks.find((hook) => hook.hookId === "hook-core-missing-will")?.promoted).toBe(true);
    expect(body.chapterSummaries.rows[0]?.title).toBe("夜访东城");
  });

  it("filters to a single section via ?section=", async () => {
    await seedBook(root);
    const app = createStudioServer({} as never, root);

    const res = await app.request(`/api/v1/books/${BOOK_ID}/canon?section=current_state`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      bookId: string;
      section: string;
      data: { facts: Array<{ predicate: string }> };
    };

    expect(body.bookId).toBe(BOOK_ID);
    expect(body.section).toBe("current_state");
    expect(body.data.facts).toHaveLength(4);
    expect("hooks" in body).toBe(false);
  });

  it("returns 404 with a meaningful message for an unknown book and never touches the filesystem", async () => {
    await seedBook(root);
    const app = createStudioServer({} as never, root);

    const res = await app.request("/api/v1/books/nope/canon");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("nope");
    // Membership check runs BEFORE any read/bootstrap side effect: no state
    // files may be created for the unknown book.
    await expect(
      readFile(join(root, "books", "nope", "story", "state", "manifest.json")),
    ).rejects.toThrow();
  });

  it("returns 400 for a section that is not part of the canon schema", async () => {
    await seedBook(root);
    const app = createStudioServer({} as never, root);

    const res = await app.request(`/api/v1/books/${BOOK_ID}/canon?section=timeline`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("timeline");
  });

  it("returns 409 canon_unavailable for cross-file invalid state, naming the validator issue", async () => {
    await seedBook(root, { stateChapterAhead: true });
    const app = createStudioServer({} as never, root);

    const res = await app.request(`/api/v1/books/${BOOK_ID}/canon`);
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: string;
      code: string;
      issues: Array<{ scope: string; code: string; message: string }>;
    };
    expect(body.code).toBe("canon_unavailable");
    expect(body.error).toContain("current_state_ahead_of_manifest");
    expect(body.issues.some((issue) => issue.message.includes("current_state_ahead_of_manifest"))).toBe(true);
  });

  it("returns 409 canon_unavailable for corrupt canonical JSON and repairs NOTHING", async () => {
    const bookDir = await seedBook(root, { corruptState: true });
    const before = await snapshotBookFiles(bookDir);
    const app = createStudioServer({} as never, root);

    const res = await app.request(`/api/v1/books/${BOOK_ID}/canon`);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; issues: Array<{ scope: string }> };
    expect(body.code).toBe("canon_unavailable");
    expect(body.issues.some((issue) => issue.scope === "current_state.json")).toBe(true);

    // Zero healing: every book file byte- and mtime-identical after the GET.
    const after = await snapshotBookFiles(bookDir);
    expect(after).toEqual(before);
  });

  it("returns 409 canon_unavailable when canonical state is missing and bootstraps NOTHING", async () => {
    const bookDir = await seedBook(root, { omitState: true });
    const before = await snapshotBookFiles(bookDir);
    const app = createStudioServer({} as never, root);

    const res = await app.request(`/api/v1/books/${BOOK_ID}/canon`);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; issues: Array<{ scope: string }> };
    expect(body.code).toBe("canon_unavailable");
    expect(body.issues.map((issue) => issue.scope).sort()).toEqual([
      "chapter_summaries.json",
      "current_state.json",
      "hooks.json",
      "manifest.json",
    ]);

    // story/state must not have been created or seeded from markdown.
    const after = await snapshotBookFiles(bookDir);
    expect(after).toEqual(before);
    await expect(stat(join(bookDir, "story", "state", "manifest.json"))).rejects.toThrow();
  });

  it("does not modify any book file merely by viewing — hashes, sizes AND mtimes", async () => {
    const bookDir = await seedBook(root);
    const app = createStudioServer({} as never, root);
    // Warm-up (module caches etc.), then measure from a clean baseline.
    await app.request(`/api/v1/books/${BOOK_ID}/canon`);
    const before = await snapshotBookFiles(bookDir);

    await sleep(60);
    await app.request(`/api/v1/books/${BOOK_ID}/canon`);
    await sleep(60);
    await app.request(`/api/v1/books/${BOOK_ID}/canon?section=hooks`);
    const after = await snapshotBookFiles(bookDir);

    // Content equality alone cannot prove a GET is read-only — mtime must be
    // identical too, otherwise manifest.json was rewritten behind our back.
    expect(after).toEqual(before);
  });
});
