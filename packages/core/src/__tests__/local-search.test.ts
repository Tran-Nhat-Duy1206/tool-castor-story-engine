import { describe, expect, it } from "vitest";
import {
  LocalSearchIndex,
  splitMarkdownForSearch,
  tokenizeSearchText,
} from "../retrieval/local-search.js";

describe("LocalSearchIndex", () => {
  it("retrieves Chinese and English evidence with FTS5 BM25", () => {
    const index = new LocalSearchIndex(":memory:");
    try {
      index.replaceScope("story", [
        {
          id: "mentor-debt",
          scope: "story",
          kind: "hook",
          source: "pending_hooks.md#mentor-debt",
          title: "mock_text Mentor Debt",
          body: "mock_text，mock_text。",
        },
        {
          id: "guild-route",
          scope: "story",
          kind: "hook",
          source: "pending_hooks.md#guild-route",
          title: "mock_text Guild Route",
          body: "mock_text。",
        },
      ]);

      expect(index.search("mock_text mock_text mock_text", { scope: "story" })[0]?.id).toBe("mentor-debt");
      expect(index.search("mentor debt oath", { scope: "story" })[0]?.id).toBe("mentor-debt");
    } finally {
      index.close();
    }
  });

  it("replaces stale projection rows instead of retaining old evidence", () => {
    const index = new LocalSearchIndex(":memory:");
    try {
      index.replaceScope("materials", [{
        id: "old",
        scope: "materials",
        kind: "reference",
        source: "old.md",
        title: "mock_text",
        body: "0607 mock_text",
      }]);
      index.replaceScope("materials", [{
        id: "new",
        scope: "materials",
        kind: "reference",
        source: "new.md",
        title: "mock_text",
        body: "0812 mock_text",
      }]);

      expect(index.search("mock_text", { scope: "materials" })).toEqual([]);
      expect(index.search("mock_text", { scope: "materials" })[0]?.id).toBe("new");
    } finally {
      index.close();
    }
  });

  it("keeps identical document ids isolated across scopes", () => {
    const index = new LocalSearchIndex(":memory:");
    try {
      index.replaceScope("story", [{
        id: "shared",
        scope: "story",
        kind: "hook",
        source: "pending_hooks.md#shared",
        title: "mock_text",
        body: "mock_text。",
      }]);
      index.replaceScope("materials", [{
        id: "shared",
        scope: "materials",
        kind: "reference",
        source: "sample.md#shared",
        title: "mock_text",
        body: "mock_text。",
      }]);

      expect(index.search("mock_text", { scope: "story" })[0]?.source).toBe("pending_hooks.md#shared");
      expect(index.search("mock_text", { scope: "materials" })[0]?.source).toBe("sample.md#shared");
    } finally {
      index.close();
    }
  });

  it("segments Markdown without truncating the selected paragraphs", () => {
    const markdown = "# mock_text\n\nmock_text。\n\n## mock_text\n\nmock_text từ。";
    const segments = splitMarkdownForSearch(markdown);

    expect(segments.map((segment) => segment.body)).toEqual([
      "mock_text。",
      "mock_text từ。",
    ]);
    expect(markdown.slice(segments[1]!.charStart, segments[1]!.charEnd)).toBe("mock_text từ。");
    expect(tokenizeSearchText("mock_text mentor-debt")).toEqual(expect.arrayContaining(["mock_text", "mentor-debt"]));
  });
});
