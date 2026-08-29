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
    expect(defaultChapterWordsForLanguage("zh")).toBe("3000");
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
    expect(defaultBookCreateForm("zh")).toEqual({
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
      ...defaultBookCreateForm("zh"),
      title: "夜港账本",
      genre: "都市悬疑",
      brief: "近未来港口城，主角查账洗白。",
    };

    expect(isBookCreateFormReady(ready)).toBe(true);
    expect(isBookCreateFormReady({ ...ready, title: "" })).toBe(false);
    expect(isBookCreateFormReady({ ...ready, brief: " " })).toBe(false);
    expect(isBookCreateFormReady({ ...ready, targetChapters: "0" })).toBe(false);
  });

  it("builds a direct create payload without dropping the story brief", () => {
    expect(buildBookCreatePayload({
      title: " 夜港账本 ",
      genre: " 都市悬疑 ",
      platform: "qidian",
      targetChapters: "120",
      chapterWordCount: "2600",
      brief: " 主角查账洗白，旧案回潮。 ",
    }, "zh")).toEqual({
      title: "夜港账本",
      genre: "都市悬疑",
      platform: "qidian",
      language: "zh",
      targetChapters: 120,
      chapterWordCount: 2600,
      blurb: "主角查账洗白，旧案回潮。",
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
    expect(resolveDraftInstruction("我想写个港风商战悬疑", false)).toBe("我想写个港风商战悬疑");
    expect(resolveDraftInstruction("把世界观改成近未来港口城", true)).toBe("把世界观改成近未来港口城");
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
      concept: "港风商战悬疑",
      readyToCreate: true,
      missingFields: [],
    })).toBe(false);
  });

  it("accepts drafts that already have the staged creation minimum", () => {
    expect(canCreateFromDraft({
      concept: "港风商战悬疑",
      title: "夜港账本",
      genre: "urban",
      platform: "tomato",
      targetChapters: 120,
      chapterWordCount: 2800,
      worldPremise: "近未来港口城，账本牵出多方势力。",
      protagonist: "林砚，水货账房出身，擅长记账和看人。",
      conflictCore: "洗白与旧债回潮的对撞。",
      readyToCreate: false,
      missingFields: [],
    })).toBe(true);
  });

  it("creates from the six story-core fields without requiring length", () => {
    // Length is a run parameter with editable defaults — its absence must not block.
    expect(canCreateFromDraft({
      concept: "港风商战悬疑",
      title: "夜港账本",
      genre: "urban",
      platform: "tomato",
      worldPremise: "近未来港口城，账本牵出多方势力。",
      protagonist: "林砚，水货账房出身，擅长记账和看人。",
      conflictCore: "洗白与旧债回潮的对撞。",
      readyToCreate: false,
      missingFields: [],
    })).toBe(true);
  });

  it("rejects incomplete drafts", () => {
    expect(canCreateFromDraft({
      concept: "港风商战悬疑",
      title: "夜港账本",
      readyToCreate: false,
      missingFields: ["genre", "targetChapters"],
    })).toBe(false);
  });
});

describe("buildCreationDraftSummary", () => {
  it("groups the draft by creation stages so users do not create from a mixed blob", () => {
    const stages = buildCreationDraftStages({
      concept: "港风商战悬疑，主角从灰产洗白。",
      title: "夜港账本",
      genre: "urban",
      platform: "tomato",
      targetChapters: 120,
      chapterWordCount: 2800,
      worldPremise: "近未来港口城，账本牵出多方势力。",
      settingNotes: "账本、港口、灰产规则都要服务洗白压力。",
      protagonist: "林砚，水货账房出身，擅长记账和看人。",
      conflictCore: "洗白与旧债回潮的对撞。",
      volumeOutline: "卷一先查账，再暴露港口旧案。",
      missingFields: ["supportingCast"],
      readyToCreate: false,
    }, "zh");

    expect(stages.map((stage) => ({
      key: stage.key,
      label: stage.label,
      status: stage.status,
      rows: stage.rows.map((row) => row.key),
      missing: stage.missing,
    }))).toEqual([
      {
        key: "basic",
        label: "基础信息",
        status: "complete",
        rows: ["title", "genre", "platform", "targetChapters", "chapterWordCount"],
        missing: [],
      },
      {
        key: "world",
        label: "世界观与规则",
        status: "complete",
        rows: ["worldPremise", "settingNotes"],
        missing: [],
      },
      {
        key: "characters",
        label: "主角与角色",
        status: "partial",
        rows: ["protagonist"],
        missing: ["配角"],
      },
      {
        key: "conflict",
        label: "冲突与回报",
        status: "complete",
        rows: ["conflictCore"],
        missing: [],
      },
      {
        key: "structure",
        label: "结构与写作约束",
        status: "complete",
        rows: ["volumeOutline"],
        missing: [],
      },
    ]);
  });

  it("surfaces the shared foundation draft in a user-facing order", () => {
    expect(buildCreationDraftSummary({
      concept: "港风商战悬疑，主角从灰产洗白。",
      title: "夜港账本",
      worldPremise: "近未来港口城，账本牵出多方势力。",
      protagonist: "林砚，水货账房出身，擅长记账和看人。",
      conflictCore: "洗白与旧债回潮的对撞。",
      volumeOutline: "卷一先查账，再暴露港口旧案。",
      blurb: "一个做灰产生意的人，准备在夜港洗白，却先被旧账拖回去。",
      nextQuestion: "卷一先查账还是先砸场？",
      missingFields: ["targetChapters"],
      readyToCreate: false,
    }, "zh")).toEqual([
      { key: "title", label: "书名", value: "夜港账本" },
      { key: "worldPremise", label: "世界观", value: "近未来港口城，账本牵出多方势力。" },
      { key: "protagonist", label: "主角", value: "林砚，水货账房出身，擅长记账和看人。" },
      { key: "conflictCore", label: "核心冲突", value: "洗白与旧债回潮的对撞。" },
      { key: "volumeOutline", label: "卷纲方向", value: "卷一先查账，再暴露港口旧案。" },
      { key: "blurb", label: "简介", value: "一个做灰产生意的人，准备在夜港洗白，却先被旧账拖回去。" },
      { key: "nextQuestion", label: "下一步", value: "卷一先查账还是先砸场？" },
    ]);
  });
});
