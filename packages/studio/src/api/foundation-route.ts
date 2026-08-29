// @ts-nocheck
import { Hono } from "hono";
import { isSafeBookId } from "./safety.js";
import * as Core from "@actalk/castor-core";
const getFoundationOverview = (Core as unknown as { getFoundationOverview: unknown }).getFoundationOverview as unknown as (p: Record<string, unknown>) => Promise<unknown>;
const listFoundationManifests = (Core as unknown as { listFoundationManifests: unknown }).listFoundationManifests as unknown as (p: Record<string, unknown>) => Promise<unknown>;
const getFoundationReadiness = (Core as unknown as { getFoundationReadiness: unknown }).getFoundationReadiness as unknown as (p: Record<string, unknown>) => Promise<unknown>;
const openFoundationRevision = (Core as unknown as { openFoundationRevision: unknown }).openFoundationRevision as unknown as (p: Record<string, unknown>) => Promise<unknown>;
const loadFoundationRevision = (Core as unknown as { loadFoundationRevision: unknown }).loadFoundationRevision as unknown as (p: Record<string, unknown>) => Promise<unknown>;
const saveFoundationUnit = (Core as unknown as { saveFoundationUnit: unknown }).saveFoundationUnit as unknown as (p: Record<string, unknown>) => Promise<unknown>;
const approveFoundationUnit = (Core as unknown as { approveFoundationUnit: unknown }).approveFoundationUnit as unknown as (p: Record<string, unknown>) => Promise<unknown>;
const markFoundationNeedsRevision = (Core as unknown as { markFoundationNeedsRevision: unknown }).markFoundationNeedsRevision as unknown as (p: Record<string, unknown>) => Promise<unknown>;
const reapproveStaleFoundationUnit = (Core as unknown as { reapproveStaleFoundationUnit: unknown }).reapproveStaleFoundationUnit as unknown as (p: Record<string, unknown>) => Promise<unknown>;
const discardFoundationRevision = (Core as unknown as { discardFoundationRevision: unknown }).discardFoundationRevision as unknown as (p: Record<string, unknown>) => Promise<unknown>;
const batchApproveFoundation = (Core as unknown as { batchApproveFoundation: unknown }).batchApproveFoundation as unknown as (p: Record<string, unknown>) => Promise<unknown>;
const publishFoundation = (Core as unknown as { publishFoundation: unknown }).publishFoundation as unknown as (p: Record<string, unknown>) => Promise<unknown>;

function isSafeGovernanceId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) && !value.includes("..") && !value.includes("/") && !value.includes("\\");
}

function mapFoundationError(e: unknown): { status: number; body: Record<string, unknown> } {
  const maybe = e as { code?: string; message?: string };
  const code = typeof maybe.code === "string" ? maybe.code : "";
  const msg = typeof maybe.message === "string" ? maybe.message : String(e);
  const lower = msg.toLowerCase();
  if (code === "book_not_found" || lower.includes("book_not_found") || lower.includes("book") && lower.includes("not found")) {
    return { status: 404, body: { error: msg, code: code || "book_not_found" } };
  }
  if (code.includes("stale") || lower.includes("stale")) {
    return { status: 409, body: { error: msg, code: code || "foundation_stale" } };
  }
  if (code.includes("not_ready") || lower.includes("not ready") || lower.includes("not_ready") || lower.includes("readiness")) {
    return { status: 409, body: { error: msg, code: code || "foundation_not_ready" } };
  }
  if (code.includes("publish_conflict") || lower.includes("publish_conflict") || lower.includes("already published") || lower.includes("publish conflict")) {
    return { status: 409, body: { error: msg, code: code || "foundation_publish_conflict" } };
  }
  if (code.includes("conflict") || lower.includes("conflict")) {
    return { status: 409, body: { error: msg, code } };
  }
  if (lower.includes("invalid") || lower.includes("must not be empty") || lower.includes("duplicate")) {
    return { status: 400, body: { error: msg, code: code || "invalid_request" } };
  }
  return { status: 500, body: { error: "Internal error while processing foundation request." } };
}

export function registerFoundationRoutes(app: Hono): void {
  const base = "/api/v1/books/:id/foundation";

  // Validation helper
  async function ensureBook(c: { req: { param: (k: string) => string } }, app: Hono): Promise<string | null> { return null; }

  app.get(base, async (c) => {
    const id = c.req.param("id");
    if (!isSafeBookId(id)) return c.json({ error: `Invalid book ID: "${id}"`, code: "invalid_request" }, 400);
    try {
      const result = await (getFoundationOverview as unknown as (p: Record<string, unknown>) => Promise<unknown>)({ bookId: id });
      return c.json(result as Record<string, unknown>);
    } catch (e) {
      const m = mapFoundationError(e);
      return c.json(m.body, m.status as 400);
    }
  });

  app.get(`${base}/manifests`, async (c) => {
    const id = c.req.param("id");
    if (!isSafeBookId(id)) return c.json({ error: `Invalid book ID: "${id}"`, code: "invalid_request" }, 400);
    try {
      const result = await (listFoundationManifests as unknown as (p: Record<string, unknown>) => Promise<unknown>)({ bookId: id });
      // Normalize to shape expected by tests: { manifests: [...] }
      if (Array.isArray(result)) return c.json({ manifests: result });
      return c.json(result as Record<string, unknown>);
    } catch (e) {
      const m = mapFoundationError(e);
      return c.json(m.body, m.status as 400);
    }
  });

  app.get(`${base}/readiness`, async (c) => {
    const id = c.req.param("id");
    if (!isSafeBookId(id)) return c.json({ error: `Invalid book ID: "${id}"`, code: "invalid_request" }, 400);
    try {
      const result = await (getFoundationReadiness as unknown as (p: Record<string, unknown>) => Promise<unknown>)({ bookId: id });
      return c.json(result as Record<string, unknown>);
    } catch (e) {
      const m = mapFoundationError(e);
      return c.json(m.body, m.status as 400);
    }
  });

  app.post(`${base}/revisions`, async (c) => {
    const id = c.req.param("id");
    if (!isSafeBookId(id)) return c.json({ error: `Invalid book ID: "${id}"`, code: "invalid_request" }, 400);
    try {
      const body = await c.req.json().catch(() => ({}));
      const result = await (openFoundationRevision as unknown as (p: Record<string, unknown>) => Promise<unknown>)({ bookId: id, ...(body as Record<string, unknown>) });
      return c.json(result as Record<string, unknown>);
    } catch (e) {
      const m = mapFoundationError(e);
      return c.json(m.body, m.status as 400);
    }
  });

  app.get(`${base}/revisions/:revId`, async (c) => {
    const id = c.req.param("id");
    const revId = c.req.param("revId");
    if (!isSafeBookId(id)) return c.json({ error: `Invalid book ID: "${id}"`, code: "invalid_request" }, 400);
    if (!isSafeGovernanceId(revId)) return c.json({ error: "Invalid revisionId", code: "invalid_request" }, 400);
    try {
      const result = await (loadFoundationRevision as unknown as (p: Record<string, unknown>) => Promise<unknown>)({ bookId: id, revisionId: revId });
      return c.json(result as Record<string, unknown>);
    } catch (e) {
      const m = mapFoundationError(e);
      return c.json(m.body, m.status as 400);
    }
  });

  app.put(`${base}/units/:unitId`, async (c) => {
    const id = c.req.param("id");
    const unitId = c.req.param("unitId");
    if (!isSafeBookId(id)) return c.json({ error: `Invalid book ID: "${id}"`, code: "invalid_request" }, 400);
    if (!isSafeGovernanceId(unitId)) return c.json({ error: "Invalid unitId", code: "invalid_request" }, 400);
    let body: Record<string, unknown> | undefined;
    try { body = await c.req.json() as Record<string, unknown>; } catch { body = {}; }
    if (typeof body?.content !== "string" || (typeof body?.expectedRevision !== "number" && typeof body?.expectedRevision !== "string" && body?.content !== undefined && body?.expectedRevision === undefined && false)) {
      // For malformed save (missing content) -> 400 before delegation
      if (typeof body?.content !== "string") return c.json({ error: "save requires content and expectedRevision", code: "invalid_request" }, 400);
    }
    // Require content at minimum; expectedRevision is optional for save but test requires batch approve guard
    if (typeof body?.content !== "string") return c.json({ error: "save requires content", code: "invalid_request" }, 400);
    try {
      const result = await (saveFoundationUnit as unknown as (p: Record<string, unknown>) => Promise<unknown>)({ bookId: id, unitId, ...body });
      return c.json(result as Record<string, unknown>);
    } catch (e) {
      const m = mapFoundationError(e);
      return c.json(m.body, m.status as 400);
    }
  });

  app.post(`${base}/units/:unitId/approve`, async (c) => {
    const id = c.req.param("id");
    const unitId = c.req.param("unitId");
    if (!isSafeBookId(id)) return c.json({ error: `Invalid book ID: "${id}"`, code: "invalid_request" }, 400);
    if (!isSafeGovernanceId(unitId)) return c.json({ error: "Invalid unitId", code: "invalid_request" }, 400);
    let body: Record<string, unknown> | undefined;
    try { body = await c.req.json() as Record<string, unknown>; } catch { body = {}; }
    const expected = body?.expectedRevision;
    if (expected === undefined || expected === null || (typeof expected !== "number" && typeof expected !== "string") || (typeof expected === "string" && !expected.trim()) || (typeof expected === "number" && (!Number.isInteger(expected) || expected < 1)) || (typeof expected === "string" && (!Number.isInteger(Number.parseInt(expected, 10)) || Number.parseInt(expected, 10) < 1))) {
      return c.json({ error: "approve requires expectedRevision", code: "invalid_request" }, 400);
    }
    try {
      const result = await (approveFoundationUnit as unknown as (p: Record<string, unknown>) => Promise<unknown>)({ bookId: id, unitId, ...body });
      return c.json(result as Record<string, unknown>);
    } catch (e) {
      const m = mapFoundationError(e);
      return c.json(m.body, m.status as 400);
    }
  });

  app.post(`${base}/units/:unitId/needs-revision`, async (c) => {
    const id = c.req.param("id");
    const unitId = c.req.param("unitId");
    if (!isSafeBookId(id)) return c.json({ error: `Invalid book ID: "${id}"`, code: "invalid_request" }, 400);
    if (!isSafeGovernanceId(unitId)) return c.json({ error: "Invalid unitId", code: "invalid_request" }, 400);
    let body: Record<string, unknown> | undefined;
    try { body = await c.req.json() as Record<string, unknown>; } catch { body = {}; }
    try {
      const result = await (markFoundationNeedsRevision as unknown as (p: Record<string, unknown>) => Promise<unknown>)({ bookId: id, unitId, ...body });
      return c.json(result as Record<string, unknown>);
    } catch (e) {
      const m = mapFoundationError(e);
      return c.json(m.body, m.status as 400);
    }
  });

  app.post(`${base}/units/:unitId/reapprove-stale`, async (c) => {
    const id = c.req.param("id");
    const unitId = c.req.param("unitId");
    if (!isSafeBookId(id)) return c.json({ error: `Invalid book ID: "${id}"`, code: "invalid_request" }, 400);
    if (!isSafeGovernanceId(unitId)) return c.json({ error: "Invalid unitId", code: "invalid_request" }, 400);
    let body: Record<string, unknown> | undefined;
    try { body = await c.req.json() as Record<string, unknown>; } catch { body = {}; }
    const expected = body?.expectedRevision;
    if (expected === undefined || expected === null) return c.json({ error: "reapprove-stale requires expectedRevision", code: "invalid_request" }, 400);
    try {
      const result = await (reapproveStaleFoundationUnit as unknown as (p: Record<string, unknown>) => Promise<unknown>)({ bookId: id, unitId, ...body });
      return c.json(result as Record<string, unknown>);
    } catch (e) {
      const m = mapFoundationError(e);
      return c.json(m.body, m.status as 400);
    }
  });

  app.delete(`${base}/revisions/:revId`, async (c) => {
    const id = c.req.param("id");
    const revId = c.req.param("revId");
    if (!isSafeBookId(id)) return c.json({ error: `Invalid book ID: "${id}"`, code: "invalid_request" }, 400);
    if (!isSafeGovernanceId(revId)) return c.json({ error: "Invalid revisionId", code: "invalid_request" }, 400);
    try {
      const result = await (discardFoundationRevision as unknown as (p: Record<string, unknown>) => Promise<unknown>)({ bookId: id, revisionId: revId });
      return c.json(result as Record<string, unknown>);
    } catch (e) {
      const m = mapFoundationError(e);
      return c.json(m.body, m.status as 400);
    }
  });

  app.post(`${base}/batch-approve`, async (c) => {
    const id = c.req.param("id");
    if (!isSafeBookId(id)) return c.json({ error: `Invalid book ID: "${id}"`, code: "invalid_request" }, 400);
    let body: Record<string, unknown> | undefined;
    try { body = await c.req.json() as Record<string, unknown>; } catch { body = {}; }
    try {
      const result = await (batchApproveFoundation as unknown as (p: Record<string, unknown>) => Promise<unknown>)({ bookId: id, ...body });
      return c.json(result as Record<string, unknown>);
    } catch (e) {
      const m = mapFoundationError(e);
      return c.json(m.body, m.status as 400);
    }
  });

  app.post(`${base}/publish`, async (c) => {
    const id = c.req.param("id");
    if (!isSafeBookId(id)) return c.json({ error: `Invalid book ID: "${id}"`, code: "invalid_request" }, 400);
    let body: Record<string, unknown> | undefined;
    try { body = await c.req.json() as Record<string, unknown>; } catch { body = {}; }
    if (!body?.revisionId || typeof body.revisionId !== "string" || !isSafeGovernanceId(body.revisionId as string)) {
      return c.json({ error: "publish requires revisionId", code: "invalid_request" }, 400);
    }
    try {
      const result = await (publishFoundation as unknown as (p: Record<string, unknown>) => Promise<unknown>)({ bookId: id, ...body });
      return c.json(result as Record<string, unknown>);
    } catch (e) {
      const m = mapFoundationError(e);
      return c.json(m.body, m.status as 400);
    }
  });
}
