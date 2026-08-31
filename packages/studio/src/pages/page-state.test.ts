import { describe, expect, it, vi } from "vitest";
import {
  buildBookCreateAgentRequest,
  buildBookCreatePayload,
  buildCreationDraftStages,
  buildCreationDraftSummary,
  canCreateFromDraft,
  defaultBookCreateForm,
  defaultChapterWordsForLanguage,
  ensureBookCreateSessionId,
  isBookCreateFormReady,
  platformOptionsForLanguage,
  pickValidValue,
  resolveDraftInstruction,
  waitForBookReady,
} from "./BookCreate";

describe("pickValidValue", () => {
  it("keeps the current value when it is still available", () => {
    expect(pickValidValue("mystery", ["mystery", "romance"])).toBe("mystery");
  });

  it("falls back to the first available value when current is blank or invalid", () => {
    expect(pickValidValue("", ["mystery", "romance"])).toBe("mystery");
    expect(pickValidValue("invalid", ["mystery", "romance"])).toBe("mystery");
    expect(pickValidValue("", [])).toBe("");
  });
});

describe("defaultChapterWordsForLanguage", () => {
  it("uses 3000 for chinese projects and 2000 for english projects", () => {
    expect(defaultChapterWordsForLanguage("vi")).toBe("3000");
    expect(defaultChapterWordsForLanguage("en")).toBe("2000");
  });
});

describe("platformOptionsForLanguage", () => {
  it("uses stable, unique values for english platform choices", () => {
    const values = platformOptionsForLanguage("en").map((option) => option.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values).toEqual(["royal-road", "kindle-unlimited", "scribble-hub", "other"]);
  });
});

describe("book create form", () => {
  it("starts with sensible defaults for chinese projects", () => {
    expect(defaultBookCreateForm("vi")).toEqual({
      title: "",
      genre: "",
      platform: "tomato",
      targetChapters: "200",
      chapterWordCount: "3000",
      brief: "",
    });
  });

  it("requires title, genre, brief, and positive numeric targets before creating", () => {
    const ready = {
      ...defaultBookCreateForm("vi"),
      title: "mock_val",
      genre: "mock_val",
      brief: "mock_val，mock_valKiem tra so sachmock_val。",
    };

    expect(isBookCreateFormReady(ready)).toBe(true);
    expect(isBookCreateFormReady({ ...ready, title: "" })).toBe(false);
    expect(isBookCreateFormReady({ ...ready, brief: " " })).toBe(false);
    expect(isBookCreateFormReady({ ...ready, targetChapters: "0" })).toBe(false);
  });

  it("builds a direct create payload without dropping the story brief", () => {
    expect(buildBookCreatePayload({
      title: " mock_val ",
      genre: " mock_val ",
      platform: "qidian",
      targetChapters: "120",
      chapterWordCount: "2600",
      brief: " mock_valKiem tra so sachmock_val，mock_val。 ",
    }, "zh")).toEqual({
      title: "mock_val",
      genre: "mock_val",
      platform: "qidian",
      language: "zh",
      targetChapters: 120,
      chapterWordCount: 2600,
      blurb: "mock_valKiem tra so sachmock_val，mock_val。",
    });
  });
});

describe("waitForBookReady", () => {
  it("retries until the created book becomes readable", async () => {
    let attempts = 0;

    await expect(waitForBookReady("fresh-book", {
      fetchBook: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error("Book not found");
        }
      },
      fetchStatus: async () => ({ status: "creating" }),
      delayMs: 0,
      waitImpl: async () => undefined,
    })).resolves.toBeUndefined();

    expect(attempts).toBe(3);
  });

  it("keeps polling while the server still reports the book as creating", async () => {
    let attempts = 0;

    await expect(waitForBookReady("slow-book", {
      fetchBook: async () => {
        attempts += 1;
        if (attempts < 25) {
          throw new Error("Book not found");
        }
      },
      fetchStatus: async () => ({ status: "creating" }),
      delayMs: 0,
      waitImpl: async () => undefined,
    })).resolves.toBeUndefined();

    expect(attempts).toBe(25);
  });

  it("surfaces a clear timeout when the book is still being created", async () => {
    await expect(waitForBookReady("missing-book", {
      fetchBook: async () => {
        throw new Error("Book not found");
      },
      fetchStatus: async () => ({ status: "creating" }),
      maxAttempts: 2,
      delayMs: 0,
      waitImpl: async () => undefined,
    })).rejects.toThrow('Book "missing-book" is still being created. Wait a moment and refresh.');
  });

  it("prefers the server-reported create failure over a polling timeout", async () => {
    await expect(waitForBookReady("broken-book", {
      fetchBook: async () => {
        throw new Error("Book not found");
      },
      fetchStatus: async () => ({ status: "error", error: "CASTOR_LLM_API_KEY not set" }),
      delayMs: 0,
      waitImpl: async () => undefined,
    })).rejects.toThrow("CASTOR_LLM_API_KEY not set");
  });
});

describe("resolveDraftInstruction", () => {
  it("keeps the user's first ideation turn untouched", () => {
    expect(resolveDraftInstruction("mock_val", false)).toBe("mock_val");
    expect(resolveDraftInstruction("mock_val", true)).toBe("mock_val");
  });
});

describe("book create agent session", () => {
  it("includes the orphan session id in agent requests", () => {
    expect(buildBookCreateAgentRequest("/create", "123456-abcdef")).toEqual({
      instruction: "/create",
      sessionId: "123456-abcdef",
      sessionKind: "book-create",
      actionSource: "slash",
      requestedIntent: "create_book",
    });
  });

  it("rejects agent requests before a session is ready", () => {
    expect(() => buildBookCreateAgentRequest("/create", " ")).toThrow("Book create session is not ready.");
  });

  it("reuses a stored orphan session", async () => {
    const createSession = vi.fn();
    const setStoredSessionId = vi.fn();

    await expect(ensureBookCreateSessionId({
      getStoredSessionId: () => "123456-abcdef",
      fetchSession: async () => ({ session: { sessionId: "123456-abcdef", bookId: null } }),
      createSession,
      setStoredSessionId,
    })).resolves.toBe("123456-abcdef");

    expect(createSession).not.toHaveBeenCalled();
    expect(setStoredSessionId).not.toHaveBeenCalled();
  });

  it("replaces a stale stored session before sending agent requests", async () => {
    const clearStoredSessionId = vi.fn();
    const setStoredSessionId = vi.fn();

    await expect(ensureBookCreateSessionId({
      getStoredSessionId: () => "old-session",
      fetchSession: async () => {
        throw new Error("Session not found");
      },
      createSession: async () => ({ session: { sessionId: "123456-newone", bookId: null } }),
      clearStoredSessionId,
      setStoredSessionId,
    })).resolves.toBe("123456-newone");

    expect(clearStoredSessionId).toHaveBeenCalledOnce();
    expect(setStoredSessionId).toHaveBeenCalledWith("123456-newone");
  });
});

describe("canCreateFromDraft", () => {
  it("does not let readyToCreate bypass the staged creation minimum", () => {
    expect(canCreateFromDraft({
      concept: "mock_val",
      readyToCreate: true,
      missingFields: [],
    })).toBe(false);
  });

  it("accepts drafts that already have the staged creation minimum", () => {
    expect(canCreateFromDraft({
      concept: "mock_val",
      title: "mock_val",
      genre: "urban",
      platform: "tomato",
      targetChapters: 120,
      chapterWordCount: 2800,
      worldPremise: "mock_val，mock_val。",
      protagonist: "mock_val，mock_valPhong so sachmock_val，mock_val。",
      conflictCore: "mock_val。",
      readyToCreate: false,
      missingFields: [],
    })).toBe(true);
  });

  it("creates from the six story-core fields without requiring length", () => {
    // Length is a run parameter with editable defaults — its absence must not block.
    expect(canCreateFromDraft({
      concept: "mock_val",
      title: "mock_val",
      genre: "urban",
      platform: "tomato",
      worldPremise: "mock_val，mock_val。",
      protagonist: "mock_val，mock_valPhong so sachmock_val，mock_val。",
      conflictCore: "mock_val。",
      readyToCreate: false,
      missingFields: [],
    })).toBe(true);
  });

  it("rejects incomplete drafts", () => {
    expect(canCreateFromDraft({
      concept: "mock_val",
      title: "mock_val",
      readyToCreate: false,
      missingFields: ["genre", "targetChapters"],
    })).toBe(false);
  });
});

describe("buildCreationDraftSummary", () => {
  it("groups the draft by creation stages so users do not create from a mixed blob", () => {
    const stages = buildCreationDraftStages({
      concept: "mock_val，mock_val。",
      title: "mock_val",
      genre: "urban",
      platform: "tomato",
      targetChapters: 120,
      chapterWordCount: 2800,
      worldPremise: "mock_val，mock_val。",
      settingNotes: "mock_val、mock_val、mock_val。",
      protagonist: "mock_val，mock_valPhong so sachmock_val，mock_val。",
      conflictCore: "mock_val。",
      volumeOutline: "mock_valKiem tra so sach，mock_val。",
      missingFields: ["supportingCast"],
      readyToCreate: false,
    }, "vi");

    expect(stages.map((stage) => ({
      key: stage.key,
      label: stage.label,
      status: stage.status,
      rows: stage.rows.map((row) => row.key),
      missing: stage.missing,
    }))).toEqual([
      {
        key: "basic",
        label: "Thông tin cơ bản",
        status: "complete",
        rows: ["title", "genre", "platform", "targetChapters", "chapterWordCount"],
        missing: [],
      },
      {
        key: "world",
        label: "Thế giới quan & quy tắc",
        status: "complete",
        rows: ["worldPremise", "settingNotes"],
        missing: [],
      },
      {
        key: "characters",
        label: "Nhân vật chính & dàn nhân vật",
        status: "partial",
        rows: ["protagonist"],
        missing: ["Nhân vật phụ"],
      },
      {
        key: "conflict",
        label: "Xung đột & phần thưởng",
        status: "complete",
        rows: ["conflictCore"],
        missing: [],
      },
      {
        key: "structure",
        label: "Cấu trúc & ràng buộc viết",
        status: "complete",
        rows: ["volumeOutline"],
        missing: [],
      },
    ]);
  });

  it("surfaces the shared foundation draft in a user-facing order", () => {
    expect(buildCreationDraftSummary({
      concept: "mock_val，mock_val。",
      title: "mock_val",
      worldPremise: "mock_val，mock_val。",
      protagonist: "mock_val，mock_valPhong so sachmock_val，mock_val。",
      conflictCore: "mock_val。",
      volumeOutline: "mock_valKiem tra so sach，mock_val。",
      blurb: "mock_val，mock_val，mock_val。",
      nextQuestion: "mock_valKiem tra so sachmock_val？",
      missingFields: ["targetChapters"],
      readyToCreate: false,
    }, "vi")).toEqual([
      { key: "title", label: "Tên sách", value: "mock_val" },
      { key: "worldPremise", label: "Thế giới quan", value: "mock_val，mock_val。" },
      { key: "protagonist", label: "Nhân vật chính", value: "mock_val，mock_valPhong so sachmock_val，mock_val。" },
      { key: "conflictCore", label: "Xung đột cốt lõi", value: "mock_val。" },
      { key: "volumeOutline", label: "Hướng dàn ý tập", value: "mock_valKiem tra so sach，mock_val。" },
      { key: "blurb", label: "Tóm tắt", value: "mock_val，mock_val，mock_val。" },
      { key: "nextQuestion", label: "Bước tiếp theo", value: "mock_valKiem tra so sachmock_val？" },
    ]);
  });
});
