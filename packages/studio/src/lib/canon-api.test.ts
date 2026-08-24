import { describe, expect, it } from "vitest";
import type { CanonCommitRequestPayload } from "./canon-api";
import { buildCanonUrl, fetchCanon, fetchCanonSection, postCanonCommit, postCanonPreview } from "./canon-api";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("buildCanonUrl", () => {
  it("targets the book-scoped canon endpoint with no path parameters", () => {
    expect(buildCanonUrl("demo-canon-book")).toBe("/api/v1/books/demo-canon-book/canon");
  });

  it("appends only known sections as a query parameter", () => {
    expect(buildCanonUrl("demo-canon-book", "current_state")).toBe(
      "/api/v1/books/demo-canon-book/canon?section=current_state",
    );
    expect(buildCanonUrl("b", "hooks")).toBe("/api/v1/books/b/canon?section=hooks");
    expect(buildCanonUrl("b", "chapter_summaries")).toBe("/api/v1/books/b/canon?section=chapter_summaries");
  });

  it("refuses book ids that could traverse paths instead of emitting them", () => {
    expect(() => buildCanonUrl("../secret")).toThrow(/Invalid book id/);
    expect(() => buildCanonUrl("a/b")).toThrow(/Invalid book id/);
    expect(() => buildCanonUrl("a\\b")).toThrow(/Invalid book id/);
    expect(() => buildCanonUrl("")).toThrow(/Invalid book id/);
  });
});

describe("fetchCanon", () => {
  it("GETs the canon endpoint and returns the parsed view", async () => {
    const calls: string[] = [];
    const view = { bookId: "demo", manifest: { lastAppliedChapter: 12 } };
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return jsonResponse(view);
    }) as typeof fetch;

    const result = await fetchCanon("demo", { fetchImpl });

    expect(calls).toEqual(["/api/v1/books/demo/canon"]);
    expect(result.bookId).toBe("demo");
    expect(result.manifest.lastAppliedChapter).toBe(12);
  });

  it("propagates server errors with their message", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ error: 'Book "ghost" not found' }, 404)) as typeof fetch;

    await expect(fetchCanon("ghost", { fetchImpl })).rejects.toThrow(/not found/);
  });
});

describe("fetchCanonSection", () => {
  it("requests a single section and returns its envelope", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return jsonResponse({
        bookId: "demo",
        section: "hooks",
        data: { hooks: [{ hookId: "hook-1" }] },
      });
    }) as typeof fetch;

    const result = await fetchCanonSection<{ hooks: Array<{ hookId: string }> }>("demo", "hooks", { fetchImpl });

    expect(calls).toEqual(["/api/v1/books/demo/canon?section=hooks"]);
    expect(result.section).toBe("hooks");
    expect(result.data.hooks[0]?.hookId).toBe("hook-1");
  });
});

// --- T3B: manual canon editing client (mutation boundary) ---

function okResponse(body: unknown): Response {
  return jsonResponse(body);
}

describe("postCanonCommit", () => {
  const request: CanonCommitRequestPayload = {
    edits: [{ kind: "setFact", subject: "Elara", predicate: "age", object: "23" }],
    expectedRevision: "0123456789abcdef",
  };

  it("sends the exact Core wire payload to the commit endpoint and maps success", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return okResponse({
        bookId: "demo",
        ok: true,
        revision: "fedcba9876543210",
        appliedEdits: 1,
        effectiveChapter: 13,
        warnings: [],
      });
    }) as typeof fetch;

    const outcome = await postCanonCommit("demo", request, { fetchImpl });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/api/v1/books/demo/canon/current-state/commit");
    expect(calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual(request);
    expect(outcome.status).toBe("success");
    if (outcome.status === "success") {
      expect(outcome.revision).toBe("fedcba9876543210");
      expect(outcome.effectiveChapter).toBe(13);
      expect(outcome.appliedEdits).toBe(1);
      expect(outcome.warnings).toEqual([]);
    }
  });

  it("distinguishes canon_conflict and carries currentRevision", async () => {
    const fetchImpl = (async () =>
      jsonResponse(
        { error: "Canon changed", code: "canon_conflict", currentRevision: "1111222233334444" },
        409,
      )) as typeof fetch;
    const outcome = await postCanonCommit("demo", request, { fetchImpl });
    expect(outcome.status).toBe("canon_conflict");
    if (outcome.status === "canon_conflict") {
      expect(outcome.currentRevision).toBe("1111222233334444");
    }
  });

  it("distinguishes book_write_locked from other 409s", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ error: "locked by writer", code: "book_write_locked" }, 409)) as typeof fetch;
    const outcome = await postCanonCommit("demo", request, { fetchImpl });
    expect(outcome.status).toBe("book_write_locked");
  });

  it("maps canon_unavailable with its issue list", async () => {
    const fetchImpl = (async () =>
      jsonResponse(
        { error: "unavailable", code: "canon_unavailable", issues: [{ scope: "current_state.json", message: "bad json" }] },
        409,
      )) as typeof fetch;
    const outcome = await postCanonCommit("demo", request, { fetchImpl });
    expect(outcome.status).toBe("canon_unavailable");
    if (outcome.status === "canon_unavailable") {
      expect(outcome.issues[0]?.scope).toBe("current_state.json");
    }
  });

  it("maps validation failures to invalid_request with issues", async () => {
    const fetchImpl = (async () =>
      jsonResponse(
        { error: "Invalid canon edit request.", code: "invalid_request", issues: [{ scope: "edits.0.subject", message: "too small" }] },
        400,
      )) as typeof fetch;
    const outcome = await postCanonCommit("demo", request, { fetchImpl });
    expect(outcome.status).toBe("invalid_request");
    if (outcome.status === "invalid_request") {
      expect(outcome.issues[0]?.scope).toBe("edits.0.subject");
    }
  });

  it("never throws for unexpected statuses — returns an unexpected outcome", async () => {
    const fetchImpl = (async () => new Response("boom", { status: 503 })) as typeof fetch;
    const outcome = await postCanonCommit("demo", request, { fetchImpl });
    expect(outcome.status).toBe("unexpected");
  });
});

describe("postCanonPreview", () => {
  it("POSTs to the preview endpoint and returns the pure preview payload", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return okResponse({
        bookId: "demo",
        effectiveChapter: 13,
        revision: "0123456789abcdef",
        issues: [],
        warnings: ["1 active fact row(s) replaced forward from chapter 13"],
      });
    }) as typeof fetch;

    const outcome = await postCanonPreview(
      "demo",
      {
        edits: [{ kind: "removeFact", subject: "Elara", predicate: "age" }],
        expectedRevision: "0123456789abcdef",
      } as CanonCommitRequestPayload,
      { fetchImpl },
    );

    expect(calls).toEqual(["/api/v1/books/demo/canon/current-state/preview"]);
    expect(outcome.status).toBe("success");
    if (outcome.status === "success") {
      expect(outcome.effectiveChapter).toBe(13);
      expect(outcome.warnings).toHaveLength(1);
    }
  });

  it("maps unavailable canon on preview too", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ error: "missing", code: "canon_unavailable", issues: [] }, 409)) as typeof fetch;
    const outcome = await postCanonPreview(
      "demo",
      { edits: [], expectedRevision: "x" },
      { fetchImpl },
    );
    expect(outcome.status).toBe("canon_unavailable");
  });
});
