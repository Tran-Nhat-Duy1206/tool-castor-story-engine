import { describe, expect, it } from "vitest";
import { parseHash, routeToHash } from "./use-hash-route";

describe("hash route", () => {
  describe("parseHash", () => {
    it("parses empty hash as dashboard", () => {
      expect(parseHash("")).toEqual({ page: "dashboard" });
    });

    it("parses #/ as dashboard", () => {
      expect(parseHash("#/")).toEqual({ page: "dashboard" });
    });

    it("parses chat route", () => {
      expect(parseHash("#/chat")).toEqual({ page: "chat" });
    });

    it("parses book route", () => {
      expect(parseHash("#/book/my-novel")).toEqual({ page: "book", bookId: "my-novel" });
    });

    it("parses book settings route", () => {
      expect(parseHash("#/book/my-novel/settings")).toEqual({ page: "book-settings", bookId: "my-novel" });
    });

    it("decodes encoded bookId", () => {
      expect(parseHash("#/book/%E4%B9%9D%E9%BE%99")).toEqual({ page: "book", bookId: "mock_val" });
    });

    it("parses book/new as book-create", () => {
      expect(parseHash("#/book/new")).toEqual({ page: "book-create" });
    });

    it("parses config as services (redirect)", () => {
      expect(parseHash("#/config")).toEqual({ page: "services" });
    });

    it("parses services", () => {
      expect(parseHash("#/services")).toEqual({ page: "services" });
    });

    it("parses project settings", () => {
      expect(parseHash("#/settings")).toEqual({ page: "project-settings" });
    });

    it("parses service-detail", () => {
      expect(parseHash("#/services/openai")).toEqual({ page: "service-detail", serviceId: "openai" });
    });

    it("parses import tab routes", () => {
      expect(parseHash("#/import/fanfic")).toEqual({ page: "import", tab: "fanfic" });
    });

    it("parses #/translation", () => {
      expect(parseHash("#/translation")).toEqual({ page: "translation" });
    });

    it("decodes encoded serviceId", () => {
      expect(parseHash("#/services/%E8%87%AA%E5%AE%9A%E4%B9%89")).toEqual({ page: "service-detail", serviceId: "mock_val" });
    });

    it("falls back to dashboard for unknown hash", () => {
      expect(parseHash("#/unknown/route")).toEqual({ page: "dashboard" });
    });
  });

  describe("routeToHash", () => {
    it("dashboard -> #/", () => {
      expect(routeToHash({ page: "dashboard" })).toBe("#/");
    });

    it("chat -> #/chat", () => {
      expect(routeToHash({ page: "chat" })).toBe("#/chat");
    });

    it("book -> #/book/{id}", () => {
      expect(routeToHash({ page: "book", bookId: "novel-1" })).toBe("#/book/novel-1");
    });

    it("book-settings -> #/book/{id}/settings", () => {
      expect(routeToHash({ page: "book-settings", bookId: "novel-1" })).toBe("#/book/novel-1/settings");
    });

    it("encodes Chinese bookId", () => {
      const hash = routeToHash({ page: "book", bookId: "mock_val" });
      expect(hash).toContain("#/book/");
      expect(decodeURIComponent(hash)).toContain("mock_val");
    });

    it("book-create -> #/book/new", () => {
      expect(routeToHash({ page: "book-create" })).toBe("#/book/new");
    });

    it("services -> #/services", () => {
      expect(routeToHash({ page: "services" })).toBe("#/services");
    });

    it("project-settings -> #/settings", () => {
      expect(routeToHash({ page: "project-settings" })).toBe("#/settings");
    });

    it("service-detail -> #/services/{id}", () => {
      expect(routeToHash({ page: "service-detail", serviceId: "openai" })).toBe("#/services/openai");
    });

    it("import tab -> #/import/{tab}", () => {
      expect(routeToHash({ page: "import", tab: "chapters" })).toBe("#/import/chapters");
    });

    it("translation -> #/translation", () => {
      expect(routeToHash({ page: "translation" })).toBe("#/translation");
    });

    it("encodes Chinese serviceId", () => {
      const hash = routeToHash({ page: "service-detail", serviceId: "mock_val" });
      expect(hash).toContain("#/services/");
      expect(decodeURIComponent(hash)).toContain("mock_val");
    });

    it("non-hash pages return empty string", () => {
      expect(routeToHash({ page: "daemon" })).toBe("");
      expect(routeToHash({ page: "logs" })).toBe("");
    });
  });
});

describe("play route", () => {
  it("parses #/play/:id", () => {
    expect(parseHash("#/play/my-id")).toEqual({ page: "play", projectId: "my-id" });
  });
  it("round-trips to hash", () => {
    expect(routeToHash({ page: "play", projectId: "my-id" })).toBe("#/play/my-id");
  });
  it("decodes url-encoded ids", () => {
    expect(parseHash("#/play/a%20b")).toEqual({ page: "play", projectId: "a b" });
  });
});
