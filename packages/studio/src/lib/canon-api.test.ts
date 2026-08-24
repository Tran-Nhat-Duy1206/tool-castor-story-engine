import { describe, expect, it } from "vitest";
import { buildCanonUrl, fetchCanon, fetchCanonSection } from "./canon-api";

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
