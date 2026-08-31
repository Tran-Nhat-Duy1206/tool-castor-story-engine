import { describe, expect, it, vi } from "vitest";
import { buildStudioBookConfig, normalizeStudioPlatform, waitForStudioBookReady } from "./book-create";

describe("normalizeStudioPlatform", () => {
  it("keeps supported chinese platform ids and folds unsupported values to other", () => {
    expect(normalizeStudioPlatform("tomato")).toBe("tomato");
    expect(normalizeStudioPlatform("mock_val")).toBe("tomato");
    expect(normalizeStudioPlatform("qidian")).toBe("qidian");
    expect(normalizeStudioPlatform("feilu")).toBe("feilu");
    expect(normalizeStudioPlatform("royal-road")).toBe("other");
    expect(normalizeStudioPlatform(undefined)).toBe("other");
  });
});

describe("buildStudioBookConfig", () => {
  it("preserves supported platform selections from studio create requests", () => {
    const config = buildStudioBookConfig(
      {
        title: "Testmock_val",
        genre: "xuanhuan",
        platform: "qidian",
        language: "zh",
        chapterWordCount: 2500,
        targetChapters: 120,
      },
      "2026-03-30T00:00:00.000Z",
    );

    expect(config).toMatchObject({
      title: "Testmock_val",
      genre: "xuanhuan",
      platform: "qidian",
      language: "zh",
      chapterWordCount: 2500,
      targetChapters: 120,
    });
  });

  it("normalizes unsupported platform ids to other for storage", () => {
    const config = buildStudioBookConfig(
      {
        title: "English Book",
        genre: "other",
        platform: "royal-road",
        language: "en",
      },
      "2026-03-30T00:00:00.000Z",
    );

    expect(config.platform).toBe("other");
    expect(config.language).toBe("en");
    expect(config.id).toBe("english-book");
  });
});

describe("waitForStudioBookReady", () => {
  it("retries until the created book becomes readable", async () => {
    let bookDetailCalls = 0;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/create-status")) {
        return new Response(JSON.stringify({ error: "Book status not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      bookDetailCalls += 1;
      if (bookDetailCalls === 1) {
        return new Response(JSON.stringify({ error: "Book not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        book: { id: "new-book" },
        chapters: [],
        nextChapter: 1,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const wait = vi.fn(async () => {});

    const result = await waitForStudioBookReady("new-book", {
      fetchImpl,
      wait,
      maxAttempts: 2,
      retryDelayMs: 1,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      book: { id: "new-book" },
      nextChapter: 1,
    });
  });

  it("waits on create-status while async LLM book creation is still running", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.endsWith("/create-status")) {
          const statusCall = fetchImpl.mock.calls.filter(([called]) => String(called).endsWith("/create-status")).length;
          return new Response(JSON.stringify({ status: statusCall < 3 ? "creating" : "ready" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.endsWith("/books/new-book")) {
          return new Response(JSON.stringify({
            book: { id: "new-book" },
            chapters: [],
            nextChapter: 1,
          }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      });
    const wait = vi.fn(async () => {});

    const result = await waitForStudioBookReady("new-book", {
      fetchImpl,
      wait,
      maxAttempts: 4,
      retryDelayMs: 1,
    });

    expect(wait).toHaveBeenCalledTimes(2);
    expect(result.book.id).toBe("new-book");
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      "/api/v1/books/new-book/create-status",
      "/api/v1/books/new-book/create-status",
      "/api/v1/books/new-book/create-status",
      "/api/v1/books/new-book",
    ]);
  });

  it("throws a clear error when the book never becomes readable", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: "Book not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(waitForStudioBookReady("missing-book", {
      fetchImpl,
      wait: async () => {},
      maxAttempts: 2,
      retryDelayMs: 1,
    })).rejects.toThrow('Book "missing-book" was not ready after 2 attempts.');
  });
});
