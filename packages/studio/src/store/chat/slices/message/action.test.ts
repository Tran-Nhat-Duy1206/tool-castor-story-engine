import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createStore } from "zustand/vanilla";
import type { ChatStore } from "../../types";
import { initialChatState } from "../../initialState";
import { createCreateSlice } from "../create/action";
import { createMessageSlice } from "./action";

const { fetchJson } = vi.hoisted(() => ({
  fetchJson: vi.fn(),
}));

vi.mock("../../../../hooks/use-api", () => ({ fetchJson }));

class FakeEventSource {
  readonly url: string;
  readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  closed = false;
  constructor(url: string) {
    this.url = url;
    fakeEventSources.push(this);
  }
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const current = this.listeners.get(type) ?? [];
    current.push(listener);
    this.listeners.set(type, current);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JSON.stringify(data) } as MessageEvent);
    }
  }
}

const fakeEventSources: FakeEventSource[] = [];

function createTestStore() {
  return createStore<ChatStore>()((...args) => ({
    ...initialChatState,
    ...createMessageSlice(...args),
    ...createCreateSlice(...args),
  }));
}

describe("chat message actions", () => {
  const originalEventSource = globalThis.EventSource;

  beforeEach(() => {
    fetchJson.mockReset();
    fetchJson.mockResolvedValue({});
    fakeEventSources.length = 0;
    (globalThis as any).EventSource = FakeEventSource;
  });

  afterEach(() => {
    (globalThis as any).EventSource = originalEventSource;
  });

  it("aborts only the previous chat round when activating another session", async () => {
    const store = createTestStore();
    const previousId = store.getState().createDraftSession(null, "chat");
    const nextId = store.getState().createDraftSession(null, "chat");
    const stream = new FakeEventSource(`/api/v1/events?sessionId=${previousId}`);
    store.setState((state) => ({
      activeSessionId: previousId,
      sessions: {
        ...state.sessions,
        [previousId]: {
          ...state.sessions[previousId]!,
          isStreaming: true,
          isChatStreaming: true,
          stream: stream as unknown as EventSource,
        },
      },
    }));
    fetchJson.mockClear();

    store.getState().activateSession(nextId);

    expect(store.getState().activeSessionId).toBe(nextId);
    expect(store.getState().sessions[previousId]).toMatchObject({
      isStreaming: false,
      isChatStreaming: false,
      stream: null,
    });
    expect(stream.closed).toBe(true);
    await vi.waitFor(() => {
      expect(fetchJson).toHaveBeenCalledWith(`/sessions/${previousId}/abort?scope=chat`, { method: "POST" });
    });
  });

  it("keeps a background production task alive when navigation aborts its parallel chat round", async () => {
    const store = createTestStore();
    const previousId = store.getState().createDraftSession(null, "short");
    const nextId = store.getState().createDraftSession(null, "chat");
    const stream = new FakeEventSource(`/api/v1/events?sessionId=${previousId}`);
    store.setState((state) => ({
      activeSessionId: previousId,
      sessions: {
        ...state.sessions,
        [previousId]: {
          ...state.sessions[previousId]!,
          isStreaming: true,
          isChatStreaming: true,
          stream: stream as unknown as EventSource,
          messages: [{
            role: "assistant",
            content: "",
            timestamp: 10,
            toolExecutions: [{
              id: "short-task-1",
              tool: "short_fiction_run",
              label: "mock_val",
              status: "running",
              startedAt: 10,
              background: true,
            }],
          }],
        },
      },
    }));
    fetchJson.mockClear();

    store.getState().activateSession(nextId);

    expect(store.getState().sessions[previousId]).toMatchObject({
      isStreaming: true,
      isChatStreaming: false,
      stream,
    });
    expect(store.getState().sessions[previousId]?.messages[0]?.toolExecutions?.[0]).toMatchObject({
      status: "running",
      background: true,
    });
    expect(stream.closed).toBe(false);
    await vi.waitFor(() => {
      expect(fetchJson).toHaveBeenCalledWith(`/sessions/${previousId}/abort?scope=chat`, { method: "POST" });
    });
  });

  it("keeps play mode local for draft sessions until the first message persists them", () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession(null, "play", "open");

    store.getState().setSessionPlayMode(sessionId, "guided");

    expect(store.getState().sessions[sessionId]?.playMode).toBe("guided");
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("syncs the created book id returned by /agent back into the current runtime session", async () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession(null, "book-create");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");
    fetchJson
      .mockResolvedValueOnce({ session: { sessionId, bookId: null, sessionKind: "book-create" } })
      .mockResolvedValueOnce({
        response: "mock_val。",
        session: { sessionId, activeBookId: "new-book", sessionKind: "book" },
      });

    await store.getState().sendMessage(sessionId, "mock_val", { sessionKind: "book-create" });

    expect(store.getState().sessions[sessionId]).toMatchObject({
      bookId: "new-book",
      sessionKind: "book",
      isDraft: false,
    });
    expect(store.getState().sessionIdsByBook["new-book"]).toContain(sessionId);
  });

  it("sends the session-bound book id when no explicit activeBookId option is provided", async () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession("harbor-book", "book");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");
    store.getState().setSelectedModel("MiniMax-M2.7", "minimax");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");
    fetchJson
      .mockResolvedValueOnce({ session: { sessionId, bookId: "harbor-book", sessionKind: "book" } })
      .mockResolvedValueOnce({
        response: "ok",
        session: { sessionId, activeBookId: "harbor-book", sessionKind: "book" },
      });

    await store.getState().sendMessage(sessionId, "mock_valChương 1");

    const agentCall = fetchJson.mock.calls.find(([path]) => path === "/agent");
    expect(agentCall).toBeDefined();
    const body = JSON.parse((agentCall?.[1] as { body: string }).body);
    expect(body.activeBookId).toBe("harbor-book");
    expect(body.sessionKind).toBe("book");
    expect(body.service).toBe("kkaiapi");
    expect(body.model).toBe("deepseek-v4-flash");
  });

  it("parses @skill directives into requestedSkills and strips them from the agent instruction", async () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession(null, "play", "open");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");
    fetchJson
      .mockResolvedValueOnce({ session: { sessionId, bookId: null, sessionKind: "play" } })
      .mockResolvedValueOnce({
        response: "ok",
        session: { sessionId, bookId: null, sessionKind: "play" },
      });

    await store.getState().sendMessage(sessionId, "@open-world-play mock_val", {
      sessionKind: "play",
    });

    const agentCall = fetchJson.mock.calls.find(([path]) => path === "/agent");
    expect(agentCall).toBeDefined();
    const body = JSON.parse((agentCall?.[1] as { body: string }).body);
    expect(body.instruction).toBe("mock_val");
    expect(body.requestedSkills).toEqual(["open-world-play"]);
  });

  it("keeps a tool-only stream when /agent returns an empty response after a proposal", async () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession(null, "book-create");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");

    let resolveAgent!: (value: unknown) => void;
    fetchJson
      .mockResolvedValueOnce({ session: { sessionId, bookId: null, sessionKind: "book-create" } })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveAgent = resolve;
      }));

    const sent = store.getState().sendMessage(sessionId, "mock_val", { sessionKind: "book-create" });
    await vi.waitFor(() => expect(fakeEventSources).toHaveLength(1));

    fakeEventSources[0].emit("tool:start", {
      sessionId,
      id: "proposal-1",
      tool: "propose_action",
    });
    fakeEventSources[0].emit("tool:end", {
      sessionId,
      id: "proposal-1",
      tool: "propose_action",
      details: {
        kind: "proposed_action",
        action: "create_book",
        targetSessionKind: "book-create",
        sameSession: true,
        title: "mock_val",
        instruction: "mock_val",
      },
    });

    resolveAgent({ response: "", session: { sessionId, sessionKind: "book-create" } });
    await sent;

    const messages = store.getState().sessions[sessionId]?.messages ?? [];
    const assistant = messages.find((message) => message.role === "assistant");
    expect(assistant?.content).not.toContain("mock_val");
    expect(assistant?.parts).toEqual([
      expect.objectContaining({
        type: "tool",
        execution: expect.objectContaining({
          tool: "propose_action",
          status: "completed",
        }),
      }),
    ]);
  });

  it("restores confirmed proposal cards when loading persisted session messages", () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession(null, "play", "open");

    store.getState().loadSessionMessages(sessionId, [
      {
        role: "assistant",
        content: "",
        timestamp: 1,
        toolExecutions: [
          {
            id: "proposal-1",
            tool: "propose_action",
            label: "mock_val",
            status: "completed",
            startedAt: 1,
            details: {
              kind: "proposed_action",
              action: "play_start",
              targetSessionKind: "play",
              instruction: "mock_val",
            },
          },
        ],
      },
      {
        role: "assistant",
        content: "",
        timestamp: 2,
        toolExecutions: [
          {
            id: "play-1",
            tool: "play_start",
            label: "mock_val",
            status: "completed",
            startedAt: 2,
            details: { kind: "play_world_started" },
          },
        ],
      },
    ]);

    expect(store.getState().resolvedProposals).toEqual({ "proposal-1": "confirmed" });
  });

  it("does not replace an active local stream while session detail is loading", async () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession(null, "short");
    const stream = new FakeEventSource(`/api/v1/events?sessionId=${sessionId}`);
    store.setState((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...state.sessions[sessionId]!,
          isDraft: false,
          isStreaming: true,
          stream: stream as unknown as EventSource,
        },
      },
    }));
    fetchJson.mockClear();

    await store.getState().loadSessionDetail(sessionId);

    expect(fetchJson).not.toHaveBeenCalled();
    expect(store.getState().sessions[sessionId]).toMatchObject({
      isStreaming: true,
      stream,
    });
  });

  it("restores and reconnects a running production task when session detail reloads", async () => {
    const store = createTestStore();
    fetchJson.mockResolvedValueOnce({
      session: { sessionId: "short-session-1", bookId: null, sessionKind: "short", title: "mock_val" },
    });
    const sessionId = await store.getState().createSession(null, "short");
    fetchJson.mockResolvedValueOnce({
      session: {
        sessionId,
        bookId: null,
        sessionKind: "short",
        title: "mock_val",
        messages: [],
      },
      task: {
        version: 1,
        sessionId,
        requestedIntent: "short_run",
        updatedAt: 20,
        execution: {
          id: "short-task-1",
          tool: "short_fiction_run",
          label: "mock_val",
          status: "running",
          startedAt: 10,
          logs: ["mock_val"],
        },
      },
    });

    await store.getState().loadSessionDetail(sessionId);

    expect(store.getState().sessions[sessionId]).toMatchObject({ isStreaming: true });
    expect(store.getState().sessions[sessionId]?.messages[0]?.toolExecutions?.[0]).toMatchObject({
      id: "short-task-1",
      status: "running",
      logs: ["mock_val"],
    });
    expect(fakeEventSources).toHaveLength(1);
    expect(fakeEventSources[0]?.url).toBe(`/api/v1/events?sessionId=${encodeURIComponent(sessionId)}`);

    fakeEventSources[0]?.emit("task:snapshot", {
      version: 1,
      sessionId,
      requestedIntent: "short_run",
      updatedAt: 30,
      execution: {
        id: "short-task-1",
        tool: "short_fiction_run",
        label: "mock_val",
        status: "completed",
        startedAt: 10,
        completedAt: 30,
        result: "mock_val",
      },
    });

    expect(store.getState().sessions[sessionId]).toMatchObject({ isStreaming: false, stream: null });
    expect(store.getState().sessions[sessionId]?.messages).toHaveLength(1);
    expect(store.getState().sessions[sessionId]?.messages[0]?.toolExecutions?.[0]).toMatchObject({
      id: "short-task-1",
      status: "completed",
      result: "mock_val",
    });
  });

  it("restores the transcript user bubble alongside the running task card without duplication", async () => {
    const store = createTestStore();
    fetchJson.mockResolvedValueOnce({
      session: { sessionId: "short-session-2", bookId: null, sessionKind: "short", title: null },
    });
    const sessionId = await store.getState().createSession(null, "short");
    fetchJson.mockResolvedValueOnce({
      session: {
        sessionId,
        bookId: null,
        sessionKind: "short",
        title: null,
        // mock_val transcript mock_val
        messages: [{ role: "user", content: "mock_val。", timestamp: 5 }],
      },
      task: {
        version: 1,
        sessionId,
        requestedIntent: "short_run",
        updatedAt: 20,
        execution: {
          id: "short-task-2",
          tool: "short_fiction_run",
          label: "mock_val",
          status: "running",
          startedAt: 10,
        },
      },
    });

    await store.getState().loadSessionDetail(sessionId);

    const messages = store.getState().sessions[sessionId]?.messages ?? [];
    // mock_val（mock_val transcript）+ mock_val（mock_val merge）mock_val
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: "user", content: "mock_val。" });
    expect(messages[1]?.toolExecutions?.[0]).toMatchObject({ id: "short-task-2", status: "running" });
    expect(
      messages.filter((message) => message.role === "user" && message.content === "mock_val。"),
    ).toHaveLength(1);
  });

  it("ignores a stale terminal task snapshot replayed onto a new agent stream", async () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession(null, "short");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");

    let resolveAgent!: (value: unknown) => void;
    fetchJson
      .mockResolvedValueOnce({ session: { sessionId, bookId: null, sessionKind: "short" } })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveAgent = resolve;
      }));

    const sent = store.getState().sendMessage(sessionId, "mock_val", { sessionKind: "short" });
    await vi.waitFor(() => expect(fakeEventSources).toHaveLength(1));

    // mock_val SSE mock_val；
    // mock_val。
    fakeEventSources[0]?.emit("task:snapshot", {
      sessionId,
      execution: {
        id: "finished-task-9",
        tool: "short_fiction_run",
        label: "mock_val",
        status: "completed",
        startedAt: 100,
        completedAt: 200,
        result: "mock_val",
      },
    });

    expect(store.getState().sessions[sessionId]).toMatchObject({ isStreaming: true });
    expect(store.getState().sessions[sessionId]?.stream).not.toBeNull();
    const staleExecutions = (store.getState().sessions[sessionId]?.messages ?? [])
      .flatMap((message) => message.toolExecutions ?? [])
      .filter((execution) => execution.id === "finished-task-9");
    expect(staleExecutions).toHaveLength(0);

    resolveAgent({ response: "ok", session: { sessionId, sessionKind: "short" } });
    await sent;
  });

  it("marks the active tool card as stopped without requiring a refresh", async () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession(null, "short");
    store.getState().loadSessionMessages(sessionId, [{
      role: "assistant",
      content: "",
      timestamp: 10,
      toolExecutions: [{
        id: "short-task-1",
        tool: "short_fiction_run",
        label: "mock_val",
        status: "running",
        startedAt: 10,
      }],
    }]);

    await store.getState().abortSession(sessionId);

    expect(store.getState().sessions[sessionId]?.messages[0]?.toolExecutions?.[0]).toMatchObject({
      status: "error",
      error: "Người dùng đã dừng",
      completedAt: expect.any(Number),
    });
    expect(fetchJson).toHaveBeenCalledWith(`/sessions/${sessionId}/abort`, { method: "POST" });
  });

  it("keeps one stopped task card when the aborted agent request later rejects", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession(null, "short");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");

    let rejectAgent!: (error: Error) => void;
    fetchJson
      .mockResolvedValueOnce({ session: { sessionId, bookId: null, sessionKind: "short" } })
      .mockImplementationOnce(() => new Promise((_resolve, reject) => {
        rejectAgent = reject;
      }))
      .mockResolvedValueOnce({});

    const sent = store.getState().sendMessage(sessionId, "mock_val", { sessionKind: "short" });
    await vi.waitFor(() => expect(fakeEventSources).toHaveLength(1));
    fakeEventSources[0]?.emit("task:snapshot", {
      sessionId,
      execution: {
        id: "short-task-1",
        tool: "short_fiction_run",
        label: "mock_val",
        status: "running",
        startedAt: 1_100,
      },
    });

    now.mockReturnValue(2_000);
    await store.getState().abortSession(sessionId);
    rejectAgent(new Error("This operation was aborted"));
    await sent;

    const taskExecutions = (store.getState().sessions[sessionId]?.messages ?? [])
      .flatMap((message) => message.toolExecutions ?? [])
      .filter((execution) => execution.id === "short-task-1");
    expect(taskExecutions).toEqual([
      expect.objectContaining({
        status: "error",
        error: "Người dùng đã dừng",
      }),
    ]);
    expect(store.getState().sessions[sessionId]?.messages).not.toContainEqual(
      expect.objectContaining({ content: expect.stringContaining("This operation was aborted") }),
    );
    now.mockRestore();
  });

  // mock_val"mock_val"mock_val：mock_val running mock_val，mock_val
  // mock_val merge mock_val、mock_val SSE mock_val isStreaming mock_val true。
  async function setupRunningTaskSession(store: ReturnType<typeof createTestStore>): Promise<string> {
    fetchJson.mockResolvedValueOnce({
      session: { sessionId: "task-session-1", bookId: null, sessionKind: "short", title: "mock_val" },
    });
    const sessionId = await store.getState().createSession(null, "short");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");
    fetchJson.mockResolvedValueOnce({
      session: { sessionId, bookId: null, sessionKind: "short", title: "mock_val", messages: [] },
      task: {
        version: 1,
        sessionId,
        requestedIntent: "short_run",
        updatedAt: 20,
        execution: {
          id: "direct-short_run-1",
          tool: "short_fiction_run",
          label: "mock_val",
          status: "running",
          startedAt: 10,
        },
      },
    });
    await store.getState().loadSessionDetail(sessionId);
    expect(fakeEventSources).toHaveLength(1);
    return sessionId;
  }

  function findTaskExecution(store: ReturnType<typeof createTestStore>, sessionId: string) {
    return (store.getState().sessions[sessionId]?.messages ?? [])
      .flatMap((message) => message.toolExecutions ?? [])
      .find((execution) => execution.id === "direct-short_run-1");
  }

  it("sends a chat message while a production task is running without aborting the task", async () => {
    const store = createTestStore();
    const sessionId = await setupRunningTaskSession(store);

    fetchJson.mockClear();
    fetchJson.mockResolvedValueOnce({ response: "mock_val。", session: { sessionId, sessionKind: "short" } });

    await store.getState().sendMessage(sessionId, "mock_val？");

    // mock_val、mock_val abort mock_val
    const calledPaths = fetchJson.mock.calls.map(([path]) => path);
    expect(calledPaths).toContain("/agent");
    expect(calledPaths).not.toContain(`/sessions/${sessionId}/abort`);
    // mock_val：mock_val
    expect(fakeEventSources).toHaveLength(2);
    expect(fakeEventSources[0]?.closed).toBe(true);
    expect(fakeEventSources[1]?.closed).toBe(false);
    // mock_val：isStreaming mock_val true、mock_val、mock_val running
    expect(store.getState().sessions[sessionId]).toMatchObject({ isStreaming: true, isChatStreaming: false });
    expect(store.getState().sessions[sessionId]?.stream).not.toBeNull();
    expect(findTaskExecution(store, sessionId)).toMatchObject({ status: "running" });
    // mock_val
    expect(store.getState().sessions[sessionId]?.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "mock_val。",
    });
  });

  it("keeps the task stream open when the chat round completes while the task is still running", async () => {
    const store = createTestStore();
    const sessionId = await setupRunningTaskSession(store);

    let resolveAgent!: (value: unknown) => void;
    fetchJson.mockClear();
    fetchJson.mockImplementationOnce(() => new Promise((resolve) => {
      resolveAgent = resolve;
    }));

    const sent = store.getState().sendMessage(sessionId, "mock_val");
    await vi.waitFor(() => expect(fakeEventSources).toHaveLength(2));

    // mock_val agent:complete mock_val：mock_val
    fakeEventSources[1]?.emit("agent:complete", { sessionId });
    expect(fakeEventSources[1]?.closed).toBe(false);
    expect(store.getState().sessions[sessionId]).toMatchObject({ isStreaming: true });

    resolveAgent({ response: "mock_val。", session: { sessionId, sessionKind: "short" } });
    await sent;

    expect(fakeEventSources[1]?.closed).toBe(false);
    expect(store.getState().sessions[sessionId]).toMatchObject({ isStreaming: true, isChatStreaming: false });

    // mock_val：tool:end mock_val execution id mock_val，mock_val agent:complete mock_val
    fakeEventSources[1]?.emit("tool:end", {
      sessionId,
      id: "direct-short_run-1",
      tool: "short_fiction_run",
      result: { content: [{ type: "text", text: "mock_val" }] },
    });
    fakeEventSources[1]?.emit("agent:complete", { sessionId });

    expect(findTaskExecution(store, sessionId)).toMatchObject({ status: "completed" });
    expect(fakeEventSources[1]?.closed).toBe(true);
    expect(store.getState().sessions[sessionId]).toMatchObject({ isStreaming: false, stream: null });
  });

  it("keeps the streaming chat open when a terminal task snapshot lands mid-chat", async () => {
    const store = createTestStore();
    const sessionId = await setupRunningTaskSession(store);

    let resolveAgent!: (value: unknown) => void;
    fetchJson.mockClear();
    fetchJson.mockImplementationOnce(() => new Promise((resolve) => {
      resolveAgent = resolve;
    }));

    const sent = store.getState().sendMessage(sessionId, "mock_val");
    await vi.waitFor(() => expect(fakeEventSources).toHaveLength(2));

    // mock_val：mock_val、mock_val in-flight mock_val，mock_val
    // mock_val。mock_val，mock_val。
    fakeEventSources[1]?.emit("task:snapshot", {
      sessionId,
      execution: {
        id: "direct-short_run-1",
        tool: "short_fiction_run",
        label: "mock_val",
        status: "completed",
        startedAt: 10,
        completedAt: 40,
        result: "mock_val",
      },
    });

    // mock_val completed
    expect(findTaskExecution(store, sessionId)).toMatchObject({
      status: "completed",
      result: "mock_val",
    });
    // mock_val：mock_val、mock_val
    expect(fakeEventSources[1]?.closed).toBe(false);
    expect(store.getState().sessions[sessionId]).toMatchObject({ isStreaming: true, isChatStreaming: true });
    expect(store.getState().sessions[sessionId]?.stream).not.toBeNull();

    resolveAgent({ response: "mock_val。", session: { sessionId, sessionKind: "short" } });
    await sent;

    // mock_val：mock_val，mock_val
    expect(store.getState().sessions[sessionId]).toMatchObject({
      isStreaming: false,
      isChatStreaming: false,
      stream: null,
    });
    expect(fakeEventSources[1]?.closed).toBe(true);
  });

  it("closes the stream after a plain chat round when no production task is running", async () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession(null, "chat");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");

    let resolveAgent!: (value: unknown) => void;
    fetchJson
      .mockResolvedValueOnce({ session: { sessionId, bookId: null, sessionKind: "chat" } })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveAgent = resolve;
      }));

    const sent = store.getState().sendMessage(sessionId, "mock_val");
    await vi.waitFor(() => expect(fakeEventSources).toHaveLength(1));
    expect(store.getState().sessions[sessionId]).toMatchObject({ isStreaming: true, isChatStreaming: true });

    resolveAgent({ response: "mock_val！", session: { sessionId, sessionKind: "chat" } });
    await sent;

    expect(store.getState().sessions[sessionId]).toMatchObject({
      isStreaming: false,
      isChatStreaming: false,
      stream: null,
    });
    expect(fakeEventSources[0]?.closed).toBe(true);
  });

  it("aborts the chat round and its running production workflow together", async () => {
    const store = createTestStore();
    const sessionId = await setupRunningTaskSession(store);

    let rejectAgent!: (error: Error) => void;
    fetchJson.mockClear();
    fetchJson
      .mockImplementationOnce(() => new Promise((_resolve, reject) => {
        rejectAgent = reject;
      }))
      .mockResolvedValueOnce({ ok: true, aborted: true });

    const sent = store.getState().sendMessage(sessionId, "mock_val");
    await vi.waitFor(() => expect(fakeEventSources).toHaveLength(2));

    await store.getState().abortSession(sessionId);

    const abortCall = fetchJson.mock.calls.find(([path]) => path === `/sessions/${sessionId}/abort`);
    expect(abortCall?.[1]).toEqual({ method: "POST" });
    expect(findTaskExecution(store, sessionId)).toMatchObject({ status: "error" });
    expect(fakeEventSources[1]?.closed).toBe(true);
    expect(store.getState().sessions[sessionId]).toMatchObject({
      isStreaming: false,
      isChatStreaming: false,
      stream: null,
    });

    rejectAgent(new Error("This operation was aborted"));
    await sent;

    expect(findTaskExecution(store, sessionId)).toMatchObject({ status: "error" });
    expect(store.getState().sessions[sessionId]).toMatchObject({ isStreaming: false });
  });

  function findChatToolExecution(store: ReturnType<typeof createTestStore>, sessionId: string) {
    return (store.getState().sessions[sessionId]?.messages ?? [])
      .flatMap((message) => message.toolExecutions ?? [])
      .find((execution) => execution.id === "chat-tool-1");
  }

  it("routes executionId-tagged logs to the task card while untagged logs follow the latest running card", async () => {
    const store = createTestStore();
    const sessionId = await setupRunningTaskSession(store);

    let resolveAgent!: (value: unknown) => void;
    fetchJson.mockClear();
    fetchJson.mockImplementationOnce(() => new Promise((resolve) => {
      resolveAgent = resolve;
    }));
    const sent = store.getState().sendMessage(sessionId, "mock_val");
    await vi.waitFor(() => expect(fakeEventSources).toHaveLength(2));

    // mock_val：mock_val"mock_val"
    fakeEventSources[1]?.emit("tool:start", {
      sessionId,
      id: "chat-tool-1",
      tool: "sub_agent",
      args: { agent: "auditor" },
    });

    // mock_val executionId mock_val：mock_val，mock_val
    fakeEventSources[1]?.emit("log", {
      sessionId,
      executionId: "direct-short_run-1",
      level: "info",
      tag: "studio",
      message: "Chương 2mock_val",
    });
    // mock_val executionId mock_val：mock_val，mock_val
    fakeEventSources[1]?.emit("log", {
      sessionId,
      level: "info",
      tag: "studio",
      message: "mock_val",
    });

    expect(findTaskExecution(store, sessionId)?.logs).toEqual(["Chương 2mock_val"]);
    expect(findChatToolExecution(store, sessionId)?.logs).toEqual(["mock_val"]);

    resolveAgent({ response: "mock_val。", session: { sessionId, sessionKind: "short" } });
    await sent;
  });

  it("reclassifies a free-text turn as a production task when the server starts a background task", async () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession("demo-book", "book");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");

    let resolveAgent!: (value: unknown) => void;
    fetchJson
      .mockResolvedValueOnce({ session: { sessionId, bookId: "demo-book", sessionKind: "book" } })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveAgent = resolve;
      }));

    // free-text mock_val：mock_val，mock_val
    const sent = store.getState().sendMessage(sessionId, "mock_val");
    await vi.waitFor(() => expect(fakeEventSources).toHaveLength(1));
    expect(store.getState().sessions[sessionId]).toMatchObject({ isStreaming: true, isChatStreaming: true });
    const agentRequest = fetchJson.mock.calls.find(([path]) => path === "/agent");
    const sourceRequestId = JSON.parse(String(agentRequest?.[1]?.body)).clientRequestId as string;

    // mock_val（mock_val background mock_val）mock_val
    fakeEventSources[0]?.emit("tool:start", { sessionId, id: "chat-tool-0", tool: "read" });
    expect(store.getState().sessions[sessionId]).toMatchObject({ isChatStreaming: true });
    fakeEventSources[0]?.emit("tool:end", { sessionId, id: "chat-tool-0", tool: "read", result: "ok" });

    // mock_val background mock_val tool:start：mock_val
    fakeEventSources[0]?.emit("tool:start", {
      sessionId,
      id: "direct-write_next-1",
      tool: "sub_agent",
      args: { agent: "writer", bookId: "demo-book" },
      background: true,
      sourceRequestId,
    });

    // mock_val：isChatStreaming mock_val false（mock_val scope=all，mock_val），
    // isStreaming mock_val true（mock_val），mock_val background mock_val
    expect(store.getState().sessions[sessionId]).toMatchObject({ isStreaming: true, isChatStreaming: false });
    const taskExecution = (store.getState().sessions[sessionId]?.messages ?? [])
      .flatMap((message) => message.toolExecutions ?? [])
      .find((execution) => execution.id === "direct-write_next-1");
    expect(taskExecution).toMatchObject({ status: "running", background: true });

    // mock_val：tool:end mock_val，mock_val fetch mock_val finally mock_val（mock_val、mock_val）
    fakeEventSources[0]?.emit("tool:end", {
      sessionId,
      id: "direct-write_next-1",
      tool: "sub_agent",
      result: { content: [{ type: "text", text: "Chương 3mock_val" }] },
    });
    resolveAgent({ response: "", session: { sessionId, sessionKind: "book" } });
    await sent;

    expect(store.getState().sessions[sessionId]).toMatchObject({
      isStreaming: false,
      isChatStreaming: false,
      stream: null,
    });
    expect(fakeEventSources[0]?.closed).toBe(true);
  });

  it("keeps one task card when a replayed snapshot arrives before tool:start", async () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession(null, "play", "guided");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");

    let resolveAgent!: (value: unknown) => void;
    fetchJson
      .mockResolvedValueOnce({ session: { sessionId, bookId: null, sessionKind: "play", playMode: "guided" } })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveAgent = resolve;
      }));

    const sent = store.getState().sendMessage(sessionId, "mock_val", {
      sessionKind: "play",
      playMode: "guided",
      actionSource: "button",
      requestedIntent: "play_start",
    });
    await vi.waitFor(() => expect(fakeEventSources).toHaveLength(1));
    const agentRequest = fetchJson.mock.calls.find(([path]) => path === "/agent");
    const sourceRequestId = JSON.parse(String(agentRequest?.[1]?.body)).clientRequestId as string;
    const execution = {
      id: "direct-play_start-1",
      tool: "play_start",
      label: "mock_val",
      status: "running" as const,
      startedAt: 10,
      background: true,
    };

    fakeEventSources[0]?.emit("task:snapshot", {
      sessionId,
      sourceRequestId,
      execution,
    });
    fakeEventSources[0]?.emit("tool:start", {
      sessionId,
      sourceRequestId,
      id: execution.id,
      tool: execution.tool,
      background: true,
    });

    const matching = (store.getState().sessions[sessionId]?.messages ?? [])
      .flatMap((message) => message.toolExecutions ?? [])
      .filter((item) => item.id === execution.id);
    expect(matching).toHaveLength(1);

    fakeEventSources[0]?.emit("tool:end", {
      sessionId,
      id: execution.id,
      tool: execution.tool,
      result: "mock_val",
    });
    resolveAgent({ response: "", session: { sessionId, sessionKind: "play", playMode: "guided" } });
    await sent;
  });

  it("merges the final HTTP tool result into the existing SSE card by execution id", async () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession(null, "play", "open");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");

    let resolveAgent!: (value: unknown) => void;
    fetchJson
      .mockResolvedValueOnce({ session: { sessionId, bookId: null, sessionKind: "play", playMode: "open" } })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveAgent = resolve;
      }));

    const sent = store.getState().sendMessage(sessionId, "mock_val", {
      sessionKind: "play",
      playMode: "open",
      requestedIntent: "play_start",
    });
    await vi.waitFor(() => expect(fakeEventSources).toHaveLength(1));

    const executionId = "direct-play_start-1";
    fakeEventSources[0]?.emit("tool:start", {
      sessionId,
      id: executionId,
      tool: "play_start",
      background: true,
    });
    fakeEventSources[0]?.emit("tool:end", {
      sessionId,
      id: executionId,
      tool: "play_start",
      details: { kind: "play_world_started", sceneText: "mock_val。" },
    });

    resolveAgent({
      response: "",
      details: {
        toolExecutions: [{
          id: executionId,
          tool: "play_start",
          label: "mock_val",
          status: "completed",
          startedAt: 10,
          completedAt: 20,
          details: { kind: "play_world_started", sceneText: "mock_val。" },
        }],
      },
      session: { sessionId, sessionKind: "play", playMode: "open" },
    });
    await sent;

    const matching = (store.getState().sessions[sessionId]?.messages ?? [])
      .flatMap((message) => message.toolExecutions ?? [])
      .filter((execution) => execution.id === executionId);
    expect(matching).toHaveLength(1);
    expect(matching[0]).toMatchObject({
      status: "completed",
      completedAt: 20,
      details: { kind: "play_world_started", sceneText: "mock_val。" },
    });
  });

  it("does not duplicate a production card when task snapshot wins the startup race", async () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession(null, "script");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");

    let resolveAgent!: (value: unknown) => void;
    fetchJson
      .mockResolvedValueOnce({ session: { sessionId, bookId: null, sessionKind: "script" } })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveAgent = resolve;
      }));

    const sent = store.getState().sendMessage(sessionId, "mock_val", {
      sessionKind: "script",
      actionSource: "button",
      requestedIntent: "script_create",
    });
    await vi.waitFor(() => expect(fakeEventSources).toHaveLength(1));
    const agentRequest = fetchJson.mock.calls.find(([path]) => path === "/agent");
    const sourceRequestId = JSON.parse(String(agentRequest?.[1]?.body)).clientRequestId as string;
    const executionId = "direct-script_create-1";

    // The task snapshot can be replayed while GET /events races the POST /agent
    // startup. Its timestamp differs from the client stream timestamp.
    fakeEventSources[0]?.emit("task:snapshot", {
      sessionId,
      sourceRequestId,
      execution: {
        id: executionId,
        tool: "script_create",
        label: "mock_val",
        status: "running",
        startedAt: 10,
      },
    });
    fakeEventSources[0]?.emit("tool:start", {
      sessionId,
      sourceRequestId,
      id: executionId,
      tool: "script_create",
      background: true,
    });

    resolveAgent({
      response: "",
      details: {
        toolExecutions: [{
          id: executionId,
          tool: "script_create",
          label: "mock_val",
          status: "completed",
          startedAt: 10,
          completedAt: 20,
          details: { kind: "script_created", scriptPath: "dramas/demo/script.md" },
        }],
      },
      session: { sessionId, sessionKind: "script" },
    });
    await sent;

    const matching = (store.getState().sessions[sessionId]?.messages ?? [])
      .flatMap((message) => message.toolExecutions ?? [])
      .filter((execution) => execution.id === executionId);
    expect(matching).toHaveLength(1);
    expect(matching[0]).toMatchObject({
      status: "completed",
      completedAt: 20,
      details: { kind: "script_created", scriptPath: "dramas/demo/script.md" },
    });
  });

  it("reclassifies a free-text turn from a replayed task snapshot and stops the production task", async () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession("demo-book", "book");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");

    let resolveAgent!: (value: unknown) => void;
    fetchJson
      .mockResolvedValueOnce({ session: { sessionId, bookId: "demo-book", sessionKind: "book" } })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveAgent = resolve;
      }))
      .mockResolvedValueOnce({ ok: true, aborted: true });

    const sent = store.getState().sendMessage(sessionId, "mock_val");
    await vi.waitFor(() => expect(fakeEventSources).toHaveLength(1));
    expect(store.getState().sessions[sessionId]).toMatchObject({ isStreaming: true, isChatStreaming: true });
    const agentRequest = fetchJson.mock.calls.find(([path]) => path === "/agent");
    const sourceRequestId = JSON.parse(String(agentRequest?.[1]?.body)).clientRequestId as string;

    // EventSource mock_val：mock_val tool:start mock_val，mock_val
    // mock_val ID mock_val running mock_val。mock_val tool:start mock_val。
    fakeEventSources[0]?.emit("task:snapshot", {
      sessionId,
      sourceRequestId,
      execution: {
        id: "direct-write_next-replayed",
        tool: "sub_agent",
        agent: "writer",
        status: "running",
        startedAt: Date.now(),
      },
    });

    expect(store.getState().sessions[sessionId]).toMatchObject({ isStreaming: true, isChatStreaming: false });
    await store.getState().abortSession(sessionId);
    const abortCall = fetchJson.mock.calls.find(([path]) => path === `/sessions/${sessionId}/abort`);
    expect(abortCall?.[1]).toMatchObject({ method: "POST" });
    expect(abortCall?.[1]).not.toHaveProperty("body");

    resolveAgent({ error: { code: "REQUEST_ABORTED", message: "This operation was aborted" } });
    await sent;
  });

  it("keeps a parallel chat turn classified as chat when replaying an older background task", async () => {
    const store = createTestStore();
    const sessionId = await setupRunningTaskSession(store);

    let resolveAgent!: (value: unknown) => void;
    fetchJson.mockClear();
    fetchJson.mockImplementationOnce(() => new Promise((resolve) => {
      resolveAgent = resolve;
    }));

    const sent = store.getState().sendMessage(sessionId, "mock_val");
    await vi.waitFor(() => expect(fakeEventSources).toHaveLength(2));
    expect(store.getState().sessions[sessionId]?.isChatStreaming).toBe(true);

    fakeEventSources[1]?.emit("task:snapshot", {
      sessionId,
      sourceRequestId: "older-request",
      execution: {
        id: "direct-short_run-1",
        tool: "short_fiction_run",
        status: "running",
        startedAt: 1,
      },
    });

    expect(store.getState().sessions[sessionId]?.isChatStreaming).toBe(true);
    resolveAgent({ response: "mock_val。", session: { sessionId, sessionKind: "short" } });
    await sent;
  });

  it("routes executionId-tagged llm progress to the task card's active stage", async () => {
    const store = createTestStore();
    const sessionId = await setupRunningTaskSession(store);

    // mock_val stages：mock_val active mock_val
    fakeEventSources[0]?.emit("task:snapshot", {
      sessionId,
      execution: {
        id: "direct-short_run-1",
        tool: "short_fiction_run",
        label: "mock_val",
        status: "running",
        startedAt: 10,
        stages: [{ label: "mock_val", status: "active" }],
      },
    });

    let resolveAgent!: (value: unknown) => void;
    fetchJson.mockClear();
    fetchJson.mockImplementationOnce(() => new Promise((resolve) => {
      resolveAgent = resolve;
    }));
    const sent = store.getState().sendMessage(sessionId, "mock_val");
    await vi.waitFor(() => expect(fakeEventSources).toHaveLength(2));
    fakeEventSources[1]?.emit("tool:start", {
      sessionId,
      id: "chat-tool-1",
      tool: "sub_agent",
      args: { agent: "auditor" },
      stages: ["mock_val"],
    });

    fakeEventSources[1]?.emit("llm:progress", {
      sessionId,
      executionId: "direct-short_run-1",
      status: "mock_val",
      elapsedMs: 1200,
      totalChars: 800,
      chineseChars: 640,
    });

    // mock_val executionId mock_val active mock_val
    expect(findTaskExecution(store, sessionId)?.stages?.[0]?.progress).toMatchObject({
      elapsedMs: 1200,
      totalChars: 800,
      chineseChars: 640,
    });
    // mock_val
    expect(findChatToolExecution(store, sessionId)?.stages?.[0]?.progress).toBeUndefined();

    resolveAgent({ response: "mock_val。", session: { sessionId, sessionKind: "short" } });
    await sent;
  });

  it("drops id-less logs and progress instead of attaching them to a background task card", async () => {
    const store = createTestStore();
    const sessionId = await setupRunningTaskSession(store);
    // mock_val active mock_val，mock_val id mock_val
    fakeEventSources[0]?.emit("task:snapshot", {
      sessionId,
      execution: {
        id: "direct-short_run-1",
        tool: "short_fiction_run",
        label: "mock_val",
        status: "running",
        startedAt: 10,
        stages: [{ label: "mock_val", status: "active" }],
      },
    });

    let resolveAgent!: (value: unknown) => void;
    fetchJson.mockClear();
    fetchJson.mockImplementationOnce(() => new Promise((resolve) => {
      resolveAgent = resolve;
    }));
    const sent = store.getState().sendMessage(sessionId, "mock_val");
    await vi.waitFor(() => expect(fakeEventSources).toHaveLength(2));

    // mock_val：mock_val id mock_val log / llm:progress mock_val
    // mock_val（mock_val），mock_val（mock_val）。
    fakeEventSources[1]?.emit("log", {
      sessionId,
      level: "info",
      tag: "studio",
      message: "mock_val",
    });
    fakeEventSources[1]?.emit("llm:progress", {
      sessionId,
      status: "mock_val",
      elapsedMs: 900,
      totalChars: 120,
      chineseChars: 100,
    });
    expect(findTaskExecution(store, sessionId)?.logs).toBeUndefined();
    expect(findTaskExecution(store, sessionId)?.stages?.[0]?.progress).toBeUndefined();

    // mock_val：mock_val id mock_val，mock_val
    fakeEventSources[1]?.emit("tool:start", {
      sessionId,
      id: "chat-tool-1",
      tool: "sub_agent",
      args: { agent: "auditor" },
    });
    fakeEventSources[1]?.emit("log", {
      sessionId,
      level: "info",
      tag: "studio",
      message: "mock_val",
    });
    expect(findChatToolExecution(store, sessionId)?.logs).toEqual(["mock_val"]);
    expect(findTaskExecution(store, sessionId)?.logs).toBeUndefined();

    resolveAgent({ response: "mock_val。", session: { sessionId, sessionKind: "short" } });
    await sent;
  });

  it("records the failed send with its original text and options when /agent rejects", async () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession("demo-book", "book");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");
    fetchJson
      .mockResolvedValueOnce({ session: { sessionId, bookId: "demo-book", sessionKind: "book" } })
      .mockRejectedValueOnce(new Error("Request timed out"));

    await store.getState().sendMessage(sessionId, "mock_val", {
      sessionKind: "book",
      requestedSkills: ["style-guard"],
    });

    expect(store.getState().sessions[sessionId]?.lastError).toBe("Request timed out");
    expect(store.getState().sessions[sessionId]?.lastFailedSend).toEqual({
      text: "mock_val",
      options: { sessionKind: "book", requestedSkills: ["style-guard"] },
    });
  });

  it("records the failed send when /agent responds with an error payload", async () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession(null, "chat");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");
    fetchJson
      .mockResolvedValueOnce({ session: { sessionId, bookId: null, sessionKind: "chat" } })
      .mockResolvedValueOnce({
        error: { code: "upstream_error", message: "mock_val 500" },
        session: { sessionId, sessionKind: "chat" },
      });

    await store.getState().sendMessage(sessionId, "mock_val");

    expect(store.getState().sessions[sessionId]?.lastFailedSend).toEqual({ text: "mock_val" });
  });

  it("retries the last failed send with identical business parameters and a fresh request id", async () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession("demo-book", "book");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");
    fetchJson
      .mockResolvedValueOnce({ session: { sessionId, bookId: "demo-book", sessionKind: "book" } })
      .mockRejectedValueOnce(new Error("Request timed out"))
      .mockResolvedValueOnce({ response: "ok", session: { sessionId, sessionKind: "book" } });

    await store.getState().sendMessage(sessionId, "mock_val", {
      sessionKind: "book",
      requestedSkills: ["style-guard"],
    });

    await store.getState().retryLastSend(sessionId);

    const agentCalls = fetchJson.mock.calls.filter(([path]) => path === "/agent");
    expect(agentCalls).toHaveLength(2);
    const firstBody = JSON.parse((agentCalls[0]?.[1] as { body: string }).body);
    const retryBody = JSON.parse((agentCalls[1]?.[1] as { body: string }).body);
    expect(retryBody.clientRequestId).toEqual(expect.any(String));
    expect(retryBody.clientRequestId).not.toBe(firstBody.clientRequestId);
    const { clientRequestId: firstRequestId, ...firstBusinessParams } = firstBody;
    const { clientRequestId: retryRequestId, ...retryBusinessParams } = retryBody;
    expect(firstRequestId).toEqual(expect.any(String));
    expect(retryRequestId).toEqual(expect.any(String));
    expect(retryBusinessParams).toEqual(firstBusinessParams);
    expect(store.getState().sessions[sessionId]?.lastFailedSend).toBeUndefined();
  });

  it("keeps no failed-send record after a successful round", async () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession(null, "chat");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");
    fetchJson
      .mockResolvedValueOnce({ session: { sessionId, bookId: null, sessionKind: "chat" } })
      .mockResolvedValueOnce({ response: "mock_val！", session: { sessionId, sessionKind: "chat" } });

    await store.getState().sendMessage(sessionId, "mock_val");

    expect(store.getState().sessions[sessionId]?.lastFailedSend).toBeUndefined();
  });

  it("does not record a failed send when the user stops the round themselves", async () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession(null, "chat");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");

    let rejectAgent!: (error: Error) => void;
    fetchJson
      .mockResolvedValueOnce({ session: { sessionId, bookId: null, sessionKind: "chat" } })
      .mockImplementationOnce(() => new Promise((_resolve, reject) => {
        rejectAgent = reject;
      }))
      .mockResolvedValueOnce({});

    const sent = store.getState().sendMessage(sessionId, "mock_val");
    await vi.waitFor(() => expect(fakeEventSources).toHaveLength(1));

    await store.getState().abortSession(sessionId);
    rejectAgent(new Error("This operation was aborted"));
    await sent;

    expect(store.getState().sessions[sessionId]?.lastFailedSend).toBeUndefined();
  });

  it("does nothing when retryLastSend is called without a failed-send record", async () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession(null, "chat");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");
    fetchJson.mockClear();

    await store.getState().retryLastSend(sessionId);

    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("routes task-tagged context compression to the task card and never into the chat stream", async () => {
    const store = createTestStore();
    const sessionId = await setupRunningTaskSession(store);

    let resolveAgent!: (value: unknown) => void;
    fetchJson.mockClear();
    fetchJson.mockImplementationOnce(() => new Promise((resolve) => {
      resolveAgent = resolve;
    }));
    const sent = store.getState().sendMessage(sessionId, "mock_val");
    await vi.waitFor(() => expect(fakeEventSources).toHaveLength(2));

    const allExecutions = () => (store.getState().sessions[sessionId]?.messages ?? [])
      .flatMap((message) => [
        ...(message.toolExecutions ?? []),
        ...(message.parts ?? []).flatMap((part) => (part.type === "tool" ? [part.execution] : [])),
      ]);

    // mock_val pipeline mock_val execution id：mock_val
    fakeEventSources[1]?.emit("context:compression", {
      sessionId,
      executionId: "direct-short_run-1",
      category: "story_context",
      phase: "start",
      protectedTokens: 1200,
    });
    expect(findTaskExecution(store, sessionId)?.stages).toEqual([
      expect.objectContaining({ label: "Nén ngữ cảnh truyện", status: "active" }),
    ]);
    // mock_val：mock_val context-* mock_val
    expect(allExecutions().some((execution) => execution.id.startsWith("context-"))).toBe(false);

    fakeEventSources[1]?.emit("context:compression", {
      sessionId,
      executionId: "direct-short_run-1",
      category: "story_context",
      phase: "end",
    });
    expect(findTaskExecution(store, sessionId)?.stages).toEqual([
      expect.objectContaining({ label: "Nén ngữ cảnh truyện", status: "completed" }),
    ]);

    // id mock_val：mock_val，mock_val
    fakeEventSources[1]?.emit("context:compression", {
      sessionId,
      executionId: "direct-unknown-9",
      category: "session_context",
      phase: "start",
    });
    expect(allExecutions().some((execution) => execution.id.startsWith("context-"))).toBe(false);

    resolveAgent({ response: "mock_val。", session: { sessionId, sessionKind: "short" } });
    await sent;
  });
});
