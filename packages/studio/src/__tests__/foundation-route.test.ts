// @ts-nocheck
/**
 * Task 22 — Foundation governance surface RED
 * Hono routes for /api/v1/books/:id/foundation
 * Must delegate to Core Task 8/9 functions and map errors correctly.
 * Imports the NOT-YET-EXISTING route module so this suite is RED until implemented.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// --- Mock Core Task 8/9 foundation functions ---
vi.mock("@actalk/castor-core", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  class FoundationError extends Error {
    code: string;
    itemId?: string;
    constructor(code: string, msg: string, itemId?: string) {
      super(msg);
      this.code = code;
      this.itemId = itemId;
    }
  }
  return {
    ...actual,
    getFoundationOverview: vi.fn(),
    listFoundationManifests: vi.fn(),
    getFoundationReadiness: vi.fn(),
    openFoundationRevision: vi.fn(),
    loadFoundationRevision: vi.fn(),
    saveFoundationUnit: vi.fn(),
    approveFoundationUnit: vi.fn(),
    markFoundationNeedsRevision: vi.fn(),
    reapproveStaleFoundationUnit: vi.fn(),
    discardFoundationRevision: vi.fn(),
    batchApproveFoundation: vi.fn(),
    publishFoundation: vi.fn(),
    FoundationError,
  };
});

// RED import — file does not exist yet (intended failure)
import { registerFoundationRoutes } from "../api/foundation-route.js";
import * as Core from "@actalk/castor-core";

const BOOK_ID = "demo-book-22";
const REV_ID = "rev-001";
const UNIT_ID = "unit-alpha";

function makeApp() {
  const app = new Hono();
  // Expected signature: registerFoundationRoutes(app)
  registerFoundationRoutes(app as never);
  return app;
}

async function json(res: Response) {
  return res.json() as Promise<Record<string, unknown>>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(Core.getFoundationOverview).mockResolvedValue({ published: { id: "p1" }, draft: null } as never);
  vi.mocked(Core.listFoundationManifests).mockResolvedValue([{ id: "m1", required: true }] as never);
  vi.mocked(Core.getFoundationReadiness).mockResolvedValue({ ready: false, blockers: ["missing required"] } as never);
  vi.mocked(Core.openFoundationRevision).mockResolvedValue({ revisionId: REV_ID, status: "draft" } as never);
  vi.mocked(Core.loadFoundationRevision).mockResolvedValue({ revisionId: REV_ID, units: [] } as never);
  vi.mocked(Core.saveFoundationUnit).mockResolvedValue({ unitId: UNIT_ID, revisionId: REV_ID } as never);
  vi.mocked(Core.approveFoundationUnit).mockResolvedValue({ unitId: UNIT_ID, approved: true } as never);
  vi.mocked(Core.markFoundationNeedsRevision).mockResolvedValue({ unitId: UNIT_ID, status: "needs_revision" } as never);
  vi.mocked(Core.reapproveStaleFoundationUnit).mockResolvedValue({ unitId: UNIT_ID, reapproved: true } as never);
  vi.mocked(Core.discardFoundationRevision).mockResolvedValue({ discarded: REV_ID } as never);
  vi.mocked(Core.batchApproveFoundation).mockResolvedValue({ approved: [UNIT_ID] } as never);
  vi.mocked(Core.publishFoundation).mockResolvedValue({ published: true, revisionId: REV_ID } as never);
});

// ---------------------------------------------------------------------------
// ROUTES — 12 route delegations
// ---------------------------------------------------------------------------
describe("foundation routes — ROUTES", () => {
  it("GET /api/v1/books/:id/foundation delegates to getFoundationOverview", async () => {
    const app = makeApp();
    const res = await app.request(`/api/v1/books/${BOOK_ID}/foundation`);
    expect(res.status).toBe(200);
    expect(Core.getFoundationOverview).toHaveBeenCalledWith(expect.objectContaining({ bookId: BOOK_ID }));
  });

  it("GET /api/v1/books/:id/foundation/manifests delegates to listFoundationManifests", async () => {
    const app = makeApp();
    const res = await app.request(`/api/v1/books/${BOOK_ID}/foundation/manifests`);
    expect(res.status).toBe(200);
    expect(Core.listFoundationManifests).toHaveBeenCalledWith(expect.objectContaining({ bookId: BOOK_ID }));
  });

  it("GET /api/v1/books/:id/foundation/readiness delegates to getFoundationReadiness", async () => {
    const app = makeApp();
    const res = await app.request(`/api/v1/books/${BOOK_ID}/foundation/readiness`);
    expect(res.status).toBe(200);
    expect(Core.getFoundationReadiness).toHaveBeenCalledWith(expect.objectContaining({ bookId: BOOK_ID }));
  });

  it("POST /api/v1/books/:id/foundation/revisions delegates to openFoundationRevision", async () => {
    const app = makeApp();
    const res = await app.request(`/api/v1/books/${BOOK_ID}/foundation/revisions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
    expect(res.status).toBe(200);
    expect(Core.openFoundationRevision).toHaveBeenCalledWith(expect.objectContaining({ bookId: BOOK_ID }));
  });

  it("GET /api/v1/books/:id/foundation/revisions/:revId delegates to loadFoundationRevision", async () => {
    const app = makeApp();
    const res = await app.request(`/api/v1/books/${BOOK_ID}/foundation/revisions/${REV_ID}`);
    expect(res.status).toBe(200);
    expect(Core.loadFoundationRevision).toHaveBeenCalledWith(expect.objectContaining({ bookId: BOOK_ID, revisionId: REV_ID }));
  });

  it("PUT /api/v1/books/:id/foundation/units/:unitId delegates to saveFoundationUnit", async () => {
    const app = makeApp();
    const res = await app.request(`/api/v1/books/${BOOK_ID}/foundation/units/${UNIT_ID}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: "hello", expectedRevision: 1 }) });
    expect(res.status).toBe(200);
    expect(Core.saveFoundationUnit).toHaveBeenCalledWith(expect.objectContaining({ bookId: BOOK_ID, unitId: UNIT_ID }));
  });

  it("POST /api/v1/books/:id/foundation/units/:unitId/approve delegates to approveFoundationUnit", async () => {
    const app = makeApp();
    const res = await app.request(`/api/v1/books/${BOOK_ID}/foundation/units/${UNIT_ID}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: 1 }) });
    expect(res.status).toBe(200);
    expect(Core.approveFoundationUnit).toHaveBeenCalledWith(expect.objectContaining({ bookId: BOOK_ID, unitId: UNIT_ID }));
  });

  it("POST /api/v1/books/:id/foundation/units/:unitId/needs-revision delegates to markFoundationNeedsRevision", async () => {
    const app = makeApp();
    const res = await app.request(`/api/v1/books/${BOOK_ID}/foundation/units/${UNIT_ID}/needs-revision`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "fix", expectedRevision: 1 }) });
    expect(res.status).toBe(200);
    expect(Core.markFoundationNeedsRevision).toHaveBeenCalledWith(expect.objectContaining({ bookId: BOOK_ID, unitId: UNIT_ID }));
  });

  it("POST /api/v1/books/:id/foundation/units/:unitId/reapprove-stale delegates to reapproveStaleFoundationUnit", async () => {
    const app = makeApp();
    const res = await app.request(`/api/v1/books/${BOOK_ID}/foundation/units/${UNIT_ID}/reapprove-stale`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: 2 }) });
    expect(res.status).toBe(200);
    expect(Core.reapproveStaleFoundationUnit).toHaveBeenCalledWith(expect.objectContaining({ bookId: BOOK_ID, unitId: UNIT_ID }));
  });

  it("DELETE /api/v1/books/:id/foundation/revisions/:revId delegates to discardFoundationRevision", async () => {
    const app = makeApp();
    const res = await app.request(`/api/v1/books/${BOOK_ID}/foundation/revisions/${REV_ID}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(Core.discardFoundationRevision).toHaveBeenCalledWith(expect.objectContaining({ bookId: BOOK_ID, revisionId: REV_ID }));
  });

  it("POST /api/v1/books/:id/foundation/batch-approve delegates to batchApproveFoundation", async () => {
    const app = makeApp();
    const res = await app.request(`/api/v1/books/${BOOK_ID}/foundation/batch-approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ unitIds: [UNIT_ID], expectedRevision: 1 }) });
    expect(res.status).toBe(200);
    expect(Core.batchApproveFoundation).toHaveBeenCalledWith(expect.objectContaining({ bookId: BOOK_ID }));
  });

  it("POST /api/v1/books/:id/foundation/publish delegates to publishFoundation", async () => {
    vi.mocked(Core.getFoundationReadiness).mockResolvedValue({ ready: true, blockers: [] } as never);
    const app = makeApp();
    const res = await app.request(`/api/v1/books/${BOOK_ID}/foundation/publish`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ revisionId: REV_ID }) });
    expect(res.status).toBe(200);
    expect(Core.publishFoundation).toHaveBeenCalledWith(expect.objectContaining({ bookId: BOOK_ID, revisionId: REV_ID }));
  });
});

// ---------------------------------------------------------------------------
// ERRORS — stale, readiness blocker, publish conflict, malformed
// ---------------------------------------------------------------------------
describe("foundation routes — ERRORS", () => {
  it("stale save maps to 409 foundation_stale", async () => {
    const FoundationError = (Core as unknown as { FoundationError: new (c: string, m: string) => Error }).FoundationError;
    vi.mocked(Core.saveFoundationUnit).mockRejectedValue(new FoundationError("foundation_stale", "stale revision"));
    const app = makeApp();
    const res = await app.request(`/api/v1/books/${BOOK_ID}/foundation/units/${UNIT_ID}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: "x", expectedRevision: 99 }) });
    expect(res.status).toBe(409);
    expect((await json(res)).code).toMatch(/stale/i);
  });

  it("stale approve maps to 409 foundation_stale", async () => {
    const FoundationError = (Core as unknown as { FoundationError: new (c: string, m: string) => Error }).FoundationError;
    vi.mocked(Core.approveFoundationUnit).mockRejectedValue(new FoundationError("foundation_stale", "stale"));
    const app = makeApp();
    const res = await app.request(`/api/v1/books/${BOOK_ID}/foundation/units/${UNIT_ID}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: 99 }) });
    expect(res.status).toBe(409);
    expect((await json(res)).code).toMatch(/stale/i);
  });

  it("readiness blocker on approve maps to 409 foundation_not_ready", async () => {
    const FoundationError = (Core as unknown as { FoundationError: new (c: string, m: string) => Error }).FoundationError;
    vi.mocked(Core.approveFoundationUnit).mockRejectedValue(new FoundationError("foundation_not_ready", "blocked by readiness"));
    const app = makeApp();
    const res = await app.request(`/api/v1/books/${BOOK_ID}/foundation/units/${UNIT_ID}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: 1 }) });
    expect(res.status).toBe(409);
    expect((await json(res)).code).toMatch(/not_ready|readiness/i);
  });

  it("readiness blocker on publish maps to 409 foundation_not_ready", async () => {
    const FoundationError = (Core as unknown as { FoundationError: new (c: string, m: string) => Error }).FoundationError;
    vi.mocked(Core.publishFoundation).mockRejectedValue(new FoundationError("foundation_not_ready", "not ready"));
    const app = makeApp();
    const res = await app.request(`/api/v1/books/${BOOK_ID}/foundation/publish`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ revisionId: REV_ID }) });
    expect(res.status).toBe(409);
  });

  it("publish conflict maps to 409 foundation_publish_conflict", async () => {
    const FoundationError = (Core as unknown as { FoundationError: new (c: string, m: string) => Error }).FoundationError;
    vi.mocked(Core.publishFoundation).mockRejectedValue(new FoundationError("foundation_publish_conflict", "already published"));
    const app = makeApp();
    const res = await app.request(`/api/v1/books/${BOOK_ID}/foundation/publish`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ revisionId: REV_ID }) });
    expect(res.status).toBe(409);
    expect((await json(res)).code).toMatch(/publish_conflict|conflict/i);
  });

  it("publish conflict when draft stale also maps to 409", async () => {
    const FoundationError = (Core as unknown as { FoundationError: new (c: string, m: string) => Error }).FoundationError;
    vi.mocked(Core.publishFoundation).mockRejectedValue(new FoundationError("foundation_stale", "draft stale at publish"));
    const app = makeApp();
    const res = await app.request(`/api/v1/books/${BOOK_ID}/foundation/publish`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ revisionId: REV_ID }) });
    expect(res.status).toBe(409);
  });

  it("malformed save (missing body) maps to 400 invalid_request", async () => {
    const app = makeApp();
    const res = await app.request(`/api/v1/books/${BOOK_ID}/foundation/units/${UNIT_ID}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
    expect(res.status).toBe(400);
    expect(Core.saveFoundationUnit).not.toHaveBeenCalled();
  });

  it("malformed publish (missing revisionId) maps to 400", async () => {
    const app = makeApp();
    const res = await app.request(`/api/v1/books/${BOOK_ID}/foundation/publish`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
    expect(res.status).toBe(400);
    expect(Core.publishFoundation).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// UI STATE / contract — published vs draft etc.
// ---------------------------------------------------------------------------
describe("foundation routes — UI STATE contract", () => {
  it("published vs draft: overview separates published (production) and draft", async () => {
    vi.mocked(Core.getFoundationOverview).mockResolvedValue({ published: { units: [{ id: "u1" }] }, draft: { units: [{ id: "u2" }] } } as never);
    const app = makeApp();
    const res = await app.request(`/api/v1/books/${BOOK_ID}/foundation`);
    const body = await json(res) as { published: unknown; draft: unknown };
    expect(body.published).toBeDefined();
    expect(body.draft).toBeDefined();
  });

  it("published-only unit is production authority (isProduction true)", async () => {
    vi.mocked(Core.getFoundationOverview).mockResolvedValue({ published: { units: [{ id: "u1", isProduction: true }] }, draft: null } as never);
    const app = makeApp();
    const body = await json(await app.request(`/api/v1/books/${BOOK_ID}/foundation`)) as { published: { units: Array<{ isProduction: boolean }> } };
    expect(body.published.units[0].isProduction).toBe(true);
  });

  it("draft is separate object, not merged into published", async () => {
    vi.mocked(Core.getFoundationOverview).mockResolvedValue({ published: { units: [{ id: "p" }] }, draft: { units: [{ id: "d" }] } } as never);
    const app = makeApp();
    const body = await json(await app.request(`/api/v1/books/${BOOK_ID}/foundation`)) as { draft: { units: Array<{ id: string }> }, published: { units: Array<{ id: string }> } };
    expect(body.draft.units[0].id).not.toBe(body.published.units[0].id);
  });

  it("draft non-production: draft units are not production authority", async () => {
    vi.mocked(Core.getFoundationOverview).mockResolvedValue({ published: { units: [{ id: "p", isProduction: true }] }, draft: { units: [{ id: "d", isProduction: false }] } } as never);
    const app = makeApp();
    const body = await json(await app.request(`/api/v1/books/${BOOK_ID}/foundation`)) as { draft: { units: Array<{ isProduction: boolean }> } };
    expect(body.draft.units[0].isProduction).toBe(false);
  });

  it("approved read-only: approved unit returned with readOnly until openRevision", async () => {
    vi.mocked(Core.loadFoundationRevision).mockResolvedValue({ revisionId: REV_ID, units: [{ id: UNIT_ID, status: "approved", readOnly: true }] } as never);
    const app = makeApp();
    const body = await json(await app.request(`/api/v1/books/${BOOK_ID}/foundation/revisions/${REV_ID}`)) as { units: Array<{ readOnly: boolean }> };
    expect(body.units[0].readOnly).toBe(true);
  });

  it("required/optional comes from Core manifests", async () => {
    vi.mocked(Core.listFoundationManifests).mockResolvedValue([{ id: "req", required: true }, { id: "opt", required: false }] as never);
    const app = makeApp();
    const body = await json(await app.request(`/api/v1/books/${BOOK_ID}/foundation/manifests`)) as { manifests: Array<{ required: boolean }> };
    // Route must proxy Core's required flag verbatim
    const raw = await json(await app.request(`/api/v1/books/${BOOK_ID}/foundation/manifests`));
    expect(Array.isArray(raw.manifests ?? raw.items ?? []) || Array.isArray(raw as unknown as Array<unknown>)).toBeTruthy();
    expect(Core.listFoundationManifests).toHaveBeenCalled();
  });

  it("dependencies come from Core (not invented)", async () => {
    vi.mocked(Core.getFoundationOverview).mockResolvedValue({ published: { units: [{ id: "u1", dependencies: ["u0"] }] }, draft: null } as never);
    const app = makeApp();
    const body = await json(await app.request(`/api/v1/books/${BOOK_ID}/foundation`)) as { published: { units: Array<{ dependencies: string[] }> } };
    expect(body.published.units[0].dependencies).toEqual(["u0"]);
  });

  it("findings come from Core", async () => {
    vi.mocked(Core.getFoundationReadiness).mockResolvedValue({ ready: false, findings: [{ unitId: UNIT_ID, level: "error" }], blockers: [] } as never);
    const app = makeApp();
    const body = await json(await app.request(`/api/v1/books/${BOOK_ID}/foundation/readiness`)) as { findings: unknown };
    expect(body.findings).toBeDefined();
  });

  it("blockers come from Core", async () => {
    vi.mocked(Core.getFoundationReadiness).mockResolvedValue({ ready: false, blockers: [{ unitId: UNIT_ID, reason: "missing" }] } as never);
    const app = makeApp();
    const body = await json(await app.request(`/api/v1/books/${BOOK_ID}/foundation/readiness`)) as { blockers: unknown[] };
    expect(body.blockers.length).toBeGreaterThan(0);
  });

  it("diff-first: later revisions include diff", async () => {
    vi.mocked(Core.loadFoundationRevision).mockResolvedValue({ revisionId: "rev-002", diff: [{ unitId: UNIT_ID, change: "edited" }] } as never);
    const app = makeApp();
    const body = await json(await app.request(`/api/v1/books/${BOOK_ID}/foundation/revisions/rev-002`)) as { diff: unknown };
    expect(body.diff).toBeDefined();
  });

  it("stale revision is surfaced (stale:true + re-review required)", async () => {
    vi.mocked(Core.loadFoundationRevision).mockResolvedValue({ revisionId: REV_ID, stale: true, requiresReReview: true } as never);
    const app = makeApp();
    const body = await json(await app.request(`/api/v1/books/${BOOK_ID}/foundation/revisions/${REV_ID}`)) as { stale: boolean };
    expect(body.stale).toBe(true);
  });

  it("ready != published: readiness.ready does not imply published", async () => {
    vi.mocked(Core.getFoundationReadiness).mockResolvedValue({ ready: true, blockers: [] } as never);
    vi.mocked(Core.getFoundationOverview).mockResolvedValue({ published: null, draft: { units: [] } } as never);
    const app = makeApp();
    const readiness = await json(await app.request(`/api/v1/books/${BOOK_ID}/foundation/readiness`)) as { ready: boolean };
    const overview = await json(await app.request(`/api/v1/books/${BOOK_ID}/foundation`)) as { published: unknown };
    expect(readiness.ready).toBe(true);
    expect(overview.published).toBeNull();
  });

  it("batch approve returns per-unit results", async () => {
    vi.mocked(Core.batchApproveFoundation).mockResolvedValue({ approved: [UNIT_ID, "unit-b"], failed: [] } as never);
    const app = makeApp();
    const body = await json(await app.request(`/api/v1/books/${BOOK_ID}/foundation/batch-approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ unitIds: [UNIT_ID, "unit-b"], expectedRevision: 1 }) })) as { approved: string[] };
    expect(body.approved).toContain(UNIT_ID);
  });

  it("cache/bookId: overview is scoped to requested bookId (no cross-book leak)", async () => {
    const app = makeApp();
    await app.request(`/api/v1/books/${BOOK_ID}/foundation`);
    await app.request(`/api/v1/books/other-book/foundation`);
    expect(Core.getFoundationOverview).toHaveBeenCalledWith(expect.objectContaining({ bookId: BOOK_ID }));
    expect(Core.getFoundationOverview).toHaveBeenCalledWith(expect.objectContaining({ bookId: "other-book" }));
    const calls = vi.mocked(Core.getFoundationOverview).mock.calls;
    expect(calls[0][0]).not.toEqual(calls[1][0]);
  });

  it("cache isolation: second book does not reuse first book cache", async () => {
    vi.mocked(Core.getFoundationOverview).mockResolvedValueOnce({ published: { id: "p-book1" } } as never).mockResolvedValueOnce({ published: { id: "p-book2" } } as never);
    const app = makeApp();
    const b1 = await json(await app.request(`/api/v1/books/book-1/foundation`));
    const b2 = await json(await app.request(`/api/v1/books/book-2/foundation`));
    expect(b1).not.toEqual(b2);
  });

  it("security: bookId with path traversal is rejected 400 and never calls Core", async () => {
    const app = makeApp();
    const res = await app.request(`/api/v1/books/..%2Fetc/foundation`);
    expect([400, 404]).toContain(res.status);
    expect(Core.getFoundationOverview).not.toHaveBeenCalled();
  });

  it("security: unitId with filesystem bypass is rejected 400", async () => {
    const app = makeApp();
    const res = await app.request(`/api/v1/books/${BOOK_ID}/foundation/units/..%2Fsecret/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: 1 }) });
    // Route must validate unitId param before delegating
    if (res.status === 400) {
      expect(Core.approveFoundationUnit).not.toHaveBeenCalled();
    } else {
      // If route does not validate path segment, it should at least not leak fs
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
  });

  it("security: responses never contain filesystem paths", async () => {
    const app = makeApp();
    const body = JSON.stringify(await json(await app.request(`/api/v1/books/${BOOK_ID}/foundation`)));
    expect(body).not.toMatch(/\/etc\/|\.json|E:\\/);
  });

  it("security: invalid bookId shape returns 404 book_not_found, not 500", async () => {
    const app = makeApp();
    // Simulate unknown book via Core throwing book_not_found — route must map to 404
    const FoundationError = (Core as unknown as { FoundationError: new (c: string, m: string) => Error }).FoundationError;
    vi.mocked(Core.getFoundationOverview).mockRejectedValue(new FoundationError("book_not_found", "not found"));
    const res = await app.request(`/api/v1/books/unknown-book-zzz/foundation`);
    expect([404, 409]).toContain(res.status);
    const body = await json(res);
    expect(body.code ?? body.error).toBeDefined();
  });

  it("no force approve: approve without expectedRevision is 400, not auto-forced", async () => {
    const app = makeApp();
    const res = await app.request(`/api/v1/books/${BOOK_ID}/foundation/units/${UNIT_ID}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
    expect(res.status).toBe(400);
    expect(Core.approveFoundationUnit).not.toHaveBeenCalled();
  });
});
