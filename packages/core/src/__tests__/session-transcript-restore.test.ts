import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendTranscriptEvent } from "../interaction/session-transcript.js";
import {
  adaptRestoredAgentMessagesForModel,
  appendRestoredHistoryBoundary,
  deriveBookSessionFromTranscript,
  restoreAgentMessagesFromTranscript,
  TOOL_RESULT_BRIDGE_TEXT,
} from "../interaction/session-transcript-restore.js";
import type { MessageEvent } from "../interaction/session-transcript-schema.js";

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

describe("session transcript restore", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "castor-restore-"));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("mock_text committed request mock_text message", async () => {
    await appendTranscriptEvent(projectRoot, {
      type: "request_started",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      seq: 1,
      timestamp: 1,
      input: "hi",
    });
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "u1",
      parentUuid: null,
      seq: 2,
      role: "user",
      timestamp: 2,
      message: { role: "user", content: "hi", timestamp: 2 },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "request_committed",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      seq: 3,
      timestamp: 3,
    });
    await appendTranscriptEvent(projectRoot, {
      type: "request_started",
      version: 1,
      sessionId: "s1",
      requestId: "r2",
      seq: 4,
      timestamp: 4,
      input: "lost",
    });
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r2",
      uuid: "u2",
      parentUuid: "u1",
      seq: 5,
      role: "user",
      timestamp: 5,
      message: { role: "user", content: "lost", timestamp: 5 },
    } as MessageEvent);

    const restored = await restoreAgentMessagesFromTranscript(projectRoot, "s1");

    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ role: "user", content: "hi" });
  });

  it("mock_text agent mock_text committed toolResult mock_text", async () => {
    await appendTranscriptEvent(projectRoot, {
      type: "request_started",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      seq: 1,
      timestamp: 1,
      input: "tool",
    });
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "a1",
      parentUuid: null,
      seq: 2,
      role: "assistant",
      timestamp: 2,
      toolCallId: "tool-1",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "mock_text", signature: "sig" },
          { type: "toolCall", id: "tool-1", name: "read", arguments: { path: "a.md" } },
        ],
        api: "anthropic-messages",
        provider: "anthropic",
        model: "claude",
        usage,
        stopReason: "tool_use",
        timestamp: 2,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "t1",
      parentUuid: "a1",
      seq: 3,
      role: "toolResult",
      timestamp: 3,
      toolCallId: "tool-1",
      sourceToolAssistantUuid: "a1",
      message: {
        role: "toolResult",
        toolCallId: "tool-1",
        toolName: "read",
        content: [{ type: "text", text: "mock_text" }],
        details: { path: "a.md" },
        isError: false,
        timestamp: 3,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "request_committed",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      seq: 4,
      timestamp: 4,
    });

    const restored = await restoreAgentMessagesFromTranscript(projectRoot, "s1");

    const body = JSON.stringify(restored);
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({
      role: "system",
      content: expect.stringContaining("mock_text"),
    });
    expect(body).toContain("read");
    expect(body).toContain("mock_text");
    expect(body).not.toContain("sig");
    expect(body).not.toContain("\"toolCall\"");
    expect(body).not.toContain("\"toolResult\"");
    expect(body).not.toContain(TOOL_RESULT_BRIDGE_TEXT);
  });

  it("mock_text transcript mock_text use_skill mock_text", async () => {
    await appendTranscriptEvent(projectRoot, {
      type: "request_started",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      seq: 1,
      timestamp: 1,
      input: "use specialist skill",
    });
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "a1",
      parentUuid: null,
      seq: 2,
      role: "assistant",
      timestamp: 2,
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "LEGACY_PRIVATE_SKILL_THINKING" },
          { type: "toolCall", id: "skill-1", name: "use_skill", arguments: { skillId: "specialist" } },
        ],
        api: "anthropic-messages",
        provider: "anthropic",
        model: "claude",
        usage,
        stopReason: "tool_use",
        timestamp: 2,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "t1",
      parentUuid: "a1",
      seq: 3,
      role: "toolResult",
      timestamp: 3,
      toolCallId: "skill-1",
      sourceToolAssistantUuid: "a1",
      message: {
        role: "toolResult",
        toolCallId: "skill-1",
        toolName: "use_skill",
        content: [{ type: "text", text: "LEGACY_PRIVATE_SKILL_GUIDANCE" }],
        details: { kind: "skill_activated", skillId: "specialist" },
        isError: false,
        timestamp: 3,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "request_committed",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      seq: 4,
      timestamp: 4,
    });

    const body = JSON.stringify(await restoreAgentMessagesFromTranscript(projectRoot, "s1"));
    expect(body).toContain("use_skill");
    expect(body).toContain("expired");
    expect(body).not.toContain("LEGACY_PRIVATE_SKILL_GUIDANCE");

    const sessionBody = JSON.stringify(await deriveBookSessionFromTranscript(projectRoot, "s1"));
    expect(sessionBody).toContain("use_skill");
    expect(sessionBody).not.toContain("LEGACY_PRIVATE_SKILL_GUIDANCE");
    expect(sessionBody).not.toContain("LEGACY_PRIVATE_SKILL_THINKING");
  });

  it("mock_text agent mock_text system mock_text", async () => {
    await appendTranscriptEvent(projectRoot, {
      type: "request_started",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      seq: 1,
      timestamp: 1,
      sessionKind: "book",
      input: "mock_text",
    });
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "u1",
      parentUuid: null,
      seq: 2,
      role: "user",
      timestamp: 2,
      message: { role: "user", content: "mock_text", timestamp: 2 },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "a1",
      parentUuid: "u1",
      seq: 3,
      role: "assistant",
      timestamp: 3,
      toolCallId: "tool-1",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", id: "tool-1", name: "sub_agent", arguments: { agent: "writer" } }],
        api: "openai-completions",
        provider: "openai",
        model: "deepseek-v4-pro",
        usage,
        stopReason: "toolUse",
        timestamp: 3,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "t1",
      parentUuid: "a1",
      seq: 4,
      role: "toolResult",
      timestamp: 4,
      toolCallId: "tool-1",
      sourceToolAssistantUuid: "a1",
      message: {
        role: "toolResult",
        toolCallId: "tool-1",
        toolName: "sub_agent",
        content: [{ type: "text", text: "Chapter 12 written." }],
        isError: false,
        timestamp: 4,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "request_committed",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      seq: 5,
      timestamp: 5,
    });
    await appendTranscriptEvent(projectRoot, {
      type: "request_started",
      version: 1,
      sessionId: "s1",
      requestId: "r2",
      seq: 6,
      timestamp: 6,
      sessionKind: "book",
      input: "mock_text？",
    });
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r2",
      uuid: "u2",
      parentUuid: "t1",
      seq: 7,
      role: "user",
      timestamp: 7,
      message: { role: "user", content: "mock_text？", timestamp: 7 },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r2",
      uuid: "a2",
      parentUuid: "u2",
      seq: 8,
      role: "assistant",
      timestamp: 8,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Chương 7mock_text。" }],
        api: "openai-completions",
        provider: "openai",
        model: "deepseek-v4-pro",
        usage,
        stopReason: "stop",
        timestamp: 8,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "request_committed",
      version: 1,
      sessionId: "s1",
      requestId: "r2",
      seq: 9,
      timestamp: 9,
    });

    const restored = await restoreAgentMessagesFromTranscript(projectRoot, "s1", "book");
    const body = JSON.stringify(restored);

    expect(restored.map((message) => message.role)).toEqual(["system", "user", "assistant"]);
    expect(body).toContain("mock_text");
    expect(body).toContain("sub_agent");
    expect(body).toContain("Chapter 12 written.");
    expect(body).toContain("mock_text");
    expect(body).toContain("Chương 7mock_text");
    expect(body).not.toContain("\"toolCall\"");
    expect(body).not.toContain("\"toolResult\"");
    expect(body).not.toContain("[Tool results]");
  });

  it("mock_text sessionKind mock_text transcript mock_text", async () => {
    await appendTranscriptEvent(projectRoot, {
      type: "request_started",
      version: 1,
      sessionId: "s1",
      requestId: "legacy",
      seq: 1,
      timestamp: 1,
      input: "mock_text",
    });
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "legacy",
      uuid: "u1",
      parentUuid: null,
      seq: 2,
      role: "user",
      timestamp: 2,
      message: { role: "user", content: "mock_text", timestamp: 2 },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "legacy",
      uuid: "a1",
      parentUuid: "u1",
      seq: 3,
      role: "assistant",
      timestamp: 3,
      toolCallId: "tool-1",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", id: "tool-1", name: "sub_agent", arguments: { agent: "writer" } }],
        api: "openai-completions",
        provider: "openai",
        model: "deepseek-v4-pro",
        usage,
        stopReason: "toolUse",
        timestamp: 3,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "legacy",
      uuid: "t1",
      parentUuid: "a1",
      seq: 4,
      role: "toolResult",
      timestamp: 4,
      toolCallId: "tool-1",
      sourceToolAssistantUuid: "a1",
      message: {
        role: "toolResult",
        toolCallId: "tool-1",
        toolName: "sub_agent",
        content: [{ type: "text", text: "legacy chapter result should not return" }],
        isError: false,
        timestamp: 4,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "request_committed",
      version: 1,
      sessionId: "s1",
      requestId: "legacy",
      seq: 5,
      timestamp: 5,
    });

    const restored = await restoreAgentMessagesFromTranscript(projectRoot, "s1", "book");
    const body = JSON.stringify(restored);

    expect(body).toContain("mock_text");
    expect(body).not.toContain("legacy chapter result should not return");
    expect(body).not.toContain("\"toolCall\"");
    expect(body).not.toContain("\"toolResult\"");
  });

  it("mock_text agent mock_text 12 mock_text", async () => {
    let seq = 1;
    for (let i = 1; i <= 15; i++) {
      const requestId = `r${i}`;
      await appendTranscriptEvent(projectRoot, {
        type: "request_started",
        version: 1,
        sessionId: "s1",
        requestId,
        seq: seq++,
        timestamp: seq,
        sessionKind: "book",
        input: `mock_text ${i}`,
      });
      await appendTranscriptEvent(projectRoot, {
        type: "message",
        version: 1,
        sessionId: "s1",
        requestId,
        uuid: `u${i}`,
        parentUuid: null,
        seq: seq++,
        role: "user",
        timestamp: seq,
        message: { role: "user", content: `mock_text ${i}`, timestamp: seq },
      } as MessageEvent);
      await appendTranscriptEvent(projectRoot, {
        type: "request_committed",
        version: 1,
        sessionId: "s1",
        requestId,
        seq: seq++,
        timestamp: seq,
      });
    }

    const restored = await restoreAgentMessagesFromTranscript(projectRoot, "s1", "book");
    const restoredText = restored.map((message) => {
      const content = (message as any).content;
      return typeof content === "string" ? content : "";
    });

    expect(restored).toHaveLength(12);
    expect(restoredText).not.toContain("mock_text 1");
    expect(restoredText).not.toContain("mock_text 2");
    expect(restoredText).not.toContain("mock_text 3");
    expect(restoredText).toContain("mock_text 4");
    expect(restoredText).toContain("mock_text 15");
  });

  it("mock_text agent mock_text 8 mock_text", async () => {
    let seq = 1;
    for (let i = 1; i <= 10; i++) {
      const requestId = `tool-${i}`;
      const toolCallId = `call-${i}`;
      await appendTranscriptEvent(projectRoot, {
        type: "request_started",
        version: 1,
        sessionId: "s1",
        requestId,
        seq: seq++,
        timestamp: seq,
        sessionKind: "book",
        input: `mock_text ${i}`,
      });
      await appendTranscriptEvent(projectRoot, {
        type: "message",
        version: 1,
        sessionId: "s1",
        requestId,
        uuid: `a${i}`,
        parentUuid: null,
        seq: seq++,
        role: "assistant",
        timestamp: seq,
        toolCallId,
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: toolCallId, name: "sub_agent", arguments: { agent: "writer" } }],
          api: "openai-completions",
          provider: "openai",
          model: "deepseek-v4-pro",
          usage,
          stopReason: "toolUse",
          timestamp: seq,
        },
      } as MessageEvent);
      await appendTranscriptEvent(projectRoot, {
        type: "message",
        version: 1,
        sessionId: "s1",
        requestId,
        uuid: `t${i}`,
        parentUuid: `a${i}`,
        seq: seq++,
        role: "toolResult",
        timestamp: seq,
        toolCallId,
        sourceToolAssistantUuid: `a${i}`,
        message: {
          role: "toolResult",
          toolCallId,
          toolName: "sub_agent",
          content: [{ type: "text", text: `mock_text ${i}` }],
          isError: false,
          timestamp: seq,
        },
      } as MessageEvent);
      await appendTranscriptEvent(projectRoot, {
        type: "request_committed",
        version: 1,
        sessionId: "s1",
        requestId,
        seq: seq++,
        timestamp: seq,
      });
    }

    const restored = await restoreAgentMessagesFromTranscript(projectRoot, "s1", "book");
    const content = String((restored[0] as any).content);
    const lines = content.split("\n");

    expect(restored).toHaveLength(1);
    expect(content).toContain("mock_text");
    expect(lines.some((line) => /mock_text 1$/.test(line))).toBe(false);
    expect(lines.some((line) => /mock_text 2$/.test(line))).toBe(false);
    expect(lines.some((line) => /mock_text 3$/.test(line))).toBe(true);
    expect(lines.some((line) => /mock_text 10$/.test(line))).toBe(true);
  });

  it("mock_text", async () => {
    await appendTranscriptEvent(projectRoot, {
      type: "request_started",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      seq: 1,
      timestamp: 1,
      input: "tool",
    });
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "u1",
      parentUuid: null,
      seq: 2,
      role: "user",
      timestamp: 2,
      message: { role: "user", content: "tool", timestamp: 2 },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "a1",
      parentUuid: "u1",
      seq: 3,
      role: "assistant",
      timestamp: 3,
      toolCallId: "tool-1",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", id: "tool-1", name: "read", arguments: { path: "a.md" } }],
        api: "openai-completions",
        provider: "google",
        model: "gemini-pro-latest",
        usage,
        stopReason: "toolUse",
        timestamp: 3,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "t1",
      parentUuid: "a1",
      seq: 4,
      role: "toolResult",
      timestamp: 4,
      toolCallId: "tool-1",
      sourceToolAssistantUuid: "a1",
      message: {
        role: "toolResult",
        toolCallId: "tool-1",
        toolName: "read",
        content: [{ type: "text", text: "mock_text" }],
        isError: false,
        timestamp: 4,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "a2",
      parentUuid: "t1",
      seq: 5,
      role: "assistant",
      timestamp: 5,
      message: {
        role: "assistant",
        content: [],
        api: "openai-completions",
        provider: "google",
        model: "gemini-pro-latest",
        usage,
        stopReason: "error",
        errorMessage: "400 status code",
        timestamp: 5,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "request_committed",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      seq: 6,
      timestamp: 6,
    });
    await appendTranscriptEvent(projectRoot, {
      type: "request_started",
      version: 1,
      sessionId: "s1",
      requestId: "r2",
      seq: 7,
      timestamp: 7,
      input: "mock_text",
    });
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r2",
      uuid: "u2",
      parentUuid: "a2",
      seq: 8,
      role: "user",
      timestamp: 8,
      message: { role: "user", content: "mock_text", timestamp: 8 },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "request_committed",
      version: 1,
      sessionId: "s1",
      requestId: "r2",
      seq: 9,
      timestamp: 9,
    });

    const restored = await restoreAgentMessagesFromTranscript(projectRoot, "s1");

    const body = JSON.stringify(restored);
    expect(restored.map((message) => message.role)).toEqual(["system", "user"]);
    expect(body).toContain("mock_text");
    expect(body).toContain("mock_text");
    expect(body).toContain("mock_text");
    expect(body).not.toContain("\"toolCall\"");
    expect(body).not.toContain("\"toolResult\"");
    expect(body).not.toContain(TOOL_RESULT_BRIDGE_TEXT);
  });

  it("mock_text assistant message mock_text trailing thinking block", async () => {
    await appendTranscriptEvent(projectRoot, {
      type: "request_started",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      seq: 1,
      timestamp: 1,
      input: "hi",
    });
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "a1",
      parentUuid: null,
      seq: 2,
      role: "assistant",
      timestamp: 2,
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "mock_text" },
          { type: "thinking", thinking: "mock_text", signature: "sig" },
        ],
        api: "anthropic-messages",
        provider: "anthropic",
        model: "claude",
        usage,
        stopReason: "stop",
        timestamp: 2,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "request_committed",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      seq: 3,
      timestamp: 3,
    });

    const restored = await restoreAgentMessagesFromTranscript(projectRoot, "s1");

    expect((restored[0] as any).content).toEqual([{ type: "text", text: "mock_text" }]);
  });

  it("mock_text provider-specific thinking，mock_text", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "DeepSeek reasoning", thinkingSignature: "reasoning_content" },
          { type: "text", text: "mock_text" },
        ],
        api: "openai-completions",
        provider: "openai",
        model: "deepseek-v4-pro",
        usage,
        stopReason: "stop",
        timestamp: 1,
      },
    ] as any;

    const adapted = adaptRestoredAgentMessagesForModel(messages, {
      api: "openai-completions",
      provider: "openai",
      id: "gemini-pro-latest",
    });

    expect((adapted[0] as any).content).toEqual([{ type: "text", text: "mock_text" }]);
  });

  it("mock_text thinking continuity", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "DeepSeek reasoning", thinkingSignature: "reasoning_content" },
          { type: "text", text: "mock_text" },
        ],
        api: "openai-completions",
        provider: "openai",
        model: "deepseek-v4-pro",
        usage,
        stopReason: "stop",
        timestamp: 1,
      },
    ] as any;

    const adapted = adaptRestoredAgentMessagesForModel(messages, {
      api: "openai-completions",
      provider: "openai",
      id: "deepseek-v4-pro",
    });

    expect((adapted[0] as any).content).toEqual(messages[0].content);
  });

  it("mock_text system mock_text", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Need a file", thinkingSignature: "reasoning_content" },
          { type: "toolCall", id: "tool-1", name: "read", arguments: { path: "story.md" } },
        ],
        api: "openai-completions",
        provider: "openai",
        model: "deepseek-v4-pro",
        usage,
        stopReason: "toolUse",
        timestamp: 1,
      },
      {
        role: "toolResult",
        toolCallId: "tool-1",
        toolName: "read",
        content: [{ type: "text", text: "mock_text" }],
        isError: false,
        timestamp: 2,
      },
    ] as any;

    const adapted = adaptRestoredAgentMessagesForModel(messages, {
      api: "openai-completions",
      provider: "openai",
      id: "deepseek-v4-pro",
    });

    const body = JSON.stringify(adapted);
    expect(adapted).toEqual([
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("[Historical tool results]"),
      }),
    ]);
    expect(body).toContain("read");
    expect(body).toContain("tool-1");
    expect(body).toContain("mock_text");
    expect(body).not.toContain("reasoning_content");
    expect(body).not.toContain("\"toolCall\"");
    expect(body).not.toContain("\"toolResult\"");
  });

  it("does not add synthetic toolResult bridge when target model does not require it", () => {
    const messages = [
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "tool-1", name: "read", arguments: {} }],
        api: "anthropic-messages",
        provider: "anthropic",
        model: "claude",
        usage,
        stopReason: "toolUse",
        timestamp: 1,
      },
      {
        role: "toolResult",
        toolCallId: "tool-1",
        toolName: "read",
        content: [{ type: "text", text: "result" }],
        isError: false,
        timestamp: 2,
      },
    ] as any[];

    const adapted = adaptRestoredAgentMessagesForModel(messages, {
      api: "anthropic-messages",
      provider: "anthropic",
      id: "claude",
    });

    expect(JSON.stringify(adapted)).not.toContain(TOOL_RESULT_BRIDGE_TEXT);
  });

  it("does not add synthetic toolResult bridge after folding historical tool results", () => {
    const messages = [
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "tool-1", name: "read", arguments: {} }],
        api: "openai-completions",
        provider: "openai",
        model: "deepseek-v4-pro",
        usage,
        stopReason: "toolUse",
        timestamp: 1,
      },
      {
        role: "toolResult",
        toolCallId: "tool-1",
        toolName: "read",
        content: [{ type: "text", text: "result" }],
        isError: false,
        timestamp: 2,
      },
    ] as any[];

    const adapted = adaptRestoredAgentMessagesForModel(messages, {
      api: "openai-completions",
      provider: "openai",
      id: "deepseek-v4-pro",
      compat: { requiresAssistantAfterToolResult: true },
    });

    const body = JSON.stringify(adapted);
    expect(body).toContain("[Historical tool results]");
    expect(body).toContain("result");
    expect(body).not.toContain(TOOL_RESULT_BRIDGE_TEXT);
    expect(body).not.toContain("\"toolResult\"");
  });

  it("mock_text system mock_text", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "tool-1", name: "read", arguments: { path: "story.md" } },
        ],
        api: "openai-completions",
        provider: "openai",
        model: "gemini-pro-latest",
        usage,
        stopReason: "toolUse",
        timestamp: 1,
      },
      {
        role: "toolResult",
        toolCallId: "tool-1",
        toolName: "read",
        content: [{ type: "text", text: "mock_text" }],
        isError: false,
        timestamp: 2,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "I have processed the tool results." }],
        api: "openai-completions",
        provider: "castor",
        model: "synthetic-tool-result-bridge",
        usage,
        stopReason: "stop",
        timestamp: 3,
      },
    ] as any;

    const adapted = adaptRestoredAgentMessagesForModel(messages, {
      api: "openai-completions",
      provider: "openai",
      id: "deepseek-v4-pro",
    });

    const body = JSON.stringify(adapted);
    expect(body).not.toContain("\"toolCall\"");
    expect(body).not.toContain("\"toolResult\"");
    expect(adapted).toEqual([
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("[Historical tool results]"),
      }),
    ]);
    expect(body).toContain("read");
    expect(body).toContain("tool-1");
    expect(body).toContain("mock_text");
    expect(body).not.toContain("I have processed the tool results.");
  });

  it("native Google mock_text", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "plan", thinkingSignature: "google-signature" },
          { type: "toolCall", id: "tool-1", name: "ls", arguments: { subdir: "story/roles" } },
        ],
        api: "google-generative-ai",
        provider: "google",
        model: "gemini-pro-latest",
        usage,
        stopReason: "toolUse",
        timestamp: 1,
      },
      {
        role: "toolResult",
        toolCallId: "tool-1",
        toolName: "ls",
        content: [{ type: "text", text: "major/\nminor/" }],
        isError: false,
        timestamp: 2,
      },
    ] as any;

    const adapted = adaptRestoredAgentMessagesForModel(messages, {
      api: "google-generative-ai",
      provider: "google",
      id: "gemini-pro-latest",
    });

    const body = JSON.stringify(adapted);
    expect(adapted).toEqual([
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("[Historical tool results]"),
      }),
    ]);
    expect(body).toContain("ls");
    expect(body).toContain("major");
    expect(body).not.toContain("google-signature");
    expect(body).not.toContain("\"toolCall\"");
    expect(body).not.toContain("\"toolResult\"");
  });

  it("mock_text native Google mock_text OpenAI-compatible Gemini mock_text", () => {
    const messages = [
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "tool-1", name: "ls", arguments: { subdir: "story/roles" } }],
        api: "openai-completions",
        provider: "openai",
        model: "gemini-pro-latest",
        usage,
        stopReason: "toolUse",
        timestamp: 1,
      },
      {
        role: "toolResult",
        toolCallId: "tool-1",
        toolName: "ls",
        content: [{ type: "text", text: "major/" }],
        isError: false,
        timestamp: 2,
      },
    ] as any;

    const adapted = adaptRestoredAgentMessagesForModel(messages, {
      api: "google-generative-ai",
      provider: "google",
      id: "gemini-pro-latest",
    });

    const body = JSON.stringify(adapted);
    expect(body).not.toContain("\"toolCall\"");
    expect(adapted.some((message: any) => message.role === "toolResult")).toBe(false);
    expect(adapted).toEqual([
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("[Historical tool results]"),
      }),
    ]);
    expect(body).toContain("ls");
    expect(body).toContain("major");
  });

  it("mock_text native Google mock_text DeepSeek reasoning_content mock_text", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "deepseek reasoning", thinkingSignature: "reasoning_content" },
          { type: "text", text: "mock_text。" },
          { type: "toolCall", id: "tool-1", name: "read", arguments: { path: "story/roles/mock_text.md" } },
        ],
        api: "openai-completions",
        provider: "openai",
        model: "deepseek-v4-pro",
        usage,
        stopReason: "toolUse",
        timestamp: 1,
      },
      {
        role: "toolResult",
        toolCallId: "tool-1",
        toolName: "read",
        content: [{ type: "text", text: "mock_text" }],
        isError: false,
        timestamp: 2,
      },
    ] as any;

    const adapted = adaptRestoredAgentMessagesForModel(messages, {
      api: "google-generative-ai",
      provider: "google",
      id: "gemini-pro-latest",
    });

    const body = JSON.stringify(adapted);
    expect(body).not.toContain("reasoning_content");
    expect(body).not.toContain("deepseek reasoning");
    expect(body).not.toContain("\"toolCall\"");
    expect(body).toContain("mock_text。");
    expect(body).toContain("[Historical tool results]");
    expect(body).toContain("mock_text");
  });

  it("mock_text，mock_text", () => {
    const messages = [
      { role: "user", content: "mock_text", timestamp: 1 },
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "tool-1", name: "sub_agent", arguments: { agent: "writer" } }],
        api: "openai-completions",
        provider: "openai",
        model: "deepseek-v4-pro",
        usage,
        stopReason: "toolUse",
        timestamp: 2,
      },
      {
        role: "toolResult",
        toolCallId: "tool-1",
        toolName: "sub_agent",
        content: [{ type: "text", text: "Chapter written." }],
        isError: false,
        timestamp: 3,
      },
    ] as any;

    const bounded = appendRestoredHistoryBoundary(messages, "vi");

    expect(bounded).toHaveLength(4);
    expect(bounded[3]).toMatchObject({
      role: "system",
      content: expect.stringContaining("mock_text"),
    });
    expect(JSON.stringify(bounded[3])).toContain("mock_text");
  });

  it("mock_text BookSession mock_text assistant tool-use message", async () => {
    await appendTranscriptEvent(projectRoot, {
      type: "session_created",
      version: 1,
      sessionId: "s1",
      seq: 1,
      timestamp: 1,
      bookId: null,
      title: null,
      createdAt: 1,
      updatedAt: 1,
    });
    await appendTranscriptEvent(projectRoot, {
      type: "request_started",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      seq: 2,
      timestamp: 2,
      input: "mock_text",
    });
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "u1",
      parentUuid: null,
      seq: 3,
      role: "user",
      timestamp: 3,
      message: { role: "user", content: "mock_text", timestamp: 3 },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "a1",
      parentUuid: "u1",
      seq: 4,
      role: "assistant",
      timestamp: 4,
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "mock_text" },
          { type: "toolCall", id: "read-1", name: "read", arguments: { path: "books/a.md" } },
        ],
        api: "openai-completions",
        provider: "google",
        model: "gemini-pro-latest",
        usage,
        stopReason: "toolUse",
        timestamp: 4,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "request_committed",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      seq: 5,
      timestamp: 5,
    });

    const session = await deriveBookSessionFromTranscript(projectRoot, "s1");

    expect(session?.messages).toEqual([{ role: "user", content: "mock_text", timestamp: 3 }]);
  });

  it("mock_text transcript mock_text BookSession UI mock_text", async () => {
    await appendTranscriptEvent(projectRoot, {
      type: "session_created",
      version: 1,
      sessionId: "s1",
      seq: 1,
      timestamp: 1,
      bookId: "book-a",
      title: null,
      createdAt: 1,
      updatedAt: 1,
    });
    await appendTranscriptEvent(projectRoot, {
      type: "request_started",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      seq: 2,
      timestamp: 2,
      input: "Chương mock_text",
    });
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "u1",
      parentUuid: null,
      seq: 3,
      role: "user",
      timestamp: 3,
      message: { role: "user", content: "Chương mock_text", timestamp: 3 },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "a1",
      parentUuid: "u1",
      seq: 4,
      role: "assistant",
      timestamp: 4,
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "mock_text" },
          { type: "text", text: "mock_text" },
        ],
        api: "anthropic-messages",
        provider: "anthropic",
        model: "claude",
        usage,
        stopReason: "stop",
        timestamp: 4,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "request_committed",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      seq: 5,
      timestamp: 5,
    });

    const session = await deriveBookSessionFromTranscript(projectRoot, "s1");

    expect(session).toMatchObject({
      sessionId: "s1",
      bookId: "book-a",
      title: "Chương mock_text",
      messages: [
        { role: "user", content: "Chương mock_text" },
        { role: "assistant", content: "mock_text", thinking: "mock_text" },
      ],
    });
  });

  it("mock_text transcript mock_text BookSession UI mock_text", async () => {
    await appendTranscriptEvent(projectRoot, {
      type: "session_created",
      version: 1,
      sessionId: "s1",
      seq: 1,
      timestamp: 1,
      bookId: "book-a",
      title: null,
      createdAt: 1,
      updatedAt: 1,
    });
    await appendTranscriptEvent(projectRoot, {
      type: "request_started",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      seq: 2,
      timestamp: 2,
      input: "mock_text",
    });
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "u1",
      parentUuid: null,
      seq: 3,
      role: "user",
      timestamp: 3,
      message: { role: "user", content: "mock_text", timestamp: 3 },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "a1",
      parentUuid: "u1",
      seq: 4,
      role: "assistant",
      timestamp: 4,
      toolCallId: "ls-1",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "mock_text" },
          { type: "toolCall", id: "ls-1", name: "ls", arguments: { bookId: "book-a", subdir: "story/roles" } },
        ],
        api: "google-generative-ai",
        provider: "google",
        model: "gemini-pro-latest",
        usage,
        stopReason: "toolUse",
        timestamp: 4,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "t1",
      parentUuid: "a1",
      seq: 5,
      role: "toolResult",
      timestamp: 5,
      toolCallId: "ls-1",
      sourceToolAssistantUuid: "a1",
      message: {
        role: "toolResult",
        toolCallId: "ls-1",
        toolName: "ls",
        content: [{ type: "text", text: "major/\nminor/" }],
        details: { path: "books/book-a/story/roles" },
        isError: false,
        timestamp: 5,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "a2",
      parentUuid: "t1",
      seq: 6,
      role: "assistant",
      timestamp: 6,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "mock_text。" }],
        api: "google-generative-ai",
        provider: "google",
        model: "gemini-pro-latest",
        usage,
        stopReason: "stop",
        timestamp: 6,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "request_committed",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      seq: 7,
      timestamp: 7,
    });

    const session = await deriveBookSessionFromTranscript(projectRoot, "s1");

    expect(session?.messages).toMatchObject([
      { role: "user", content: "mock_text" },
      {
        role: "assistant",
        content: "mock_text。",
        thinking: "mock_text",
        toolExecutions: [{
          id: "ls-1",
          tool: "ls",
          label: "mock_text",
          status: "completed",
          args: { bookId: "book-a", subdir: "story/roles" },
          result: "major/\nminor/",
          details: { path: "books/book-a/story/roles" },
          startedAt: 4,
          completedAt: 5,
        }],
      },
    ]);
  });

  it("keeps UI message order by transcript seq instead of message timestamp", async () => {
    await appendTranscriptEvent(projectRoot, {
      type: "session_created",
      version: 1,
      sessionId: "s1",
      seq: 1,
      timestamp: 1,
      bookId: "book-a",
      title: null,
      createdAt: 1,
      updatedAt: 1,
    });
    await appendTranscriptEvent(projectRoot, {
      type: "request_started",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      seq: 2,
      timestamp: 2,
      input: "mock_text",
    });
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "u1",
      parentUuid: null,
      seq: 3,
      role: "user",
      timestamp: 100,
      message: { role: "user", content: "mock_text", timestamp: 100 },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "a1",
      parentUuid: "u1",
      seq: 4,
      role: "assistant",
      timestamp: 50,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "mock_text" }],
        api: "anthropic-messages",
        provider: "anthropic",
        model: "claude",
        usage,
        stopReason: "stop",
        timestamp: 50,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "request_committed",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      seq: 5,
      timestamp: 5,
    });

    const session = await deriveBookSessionFromTranscript(projectRoot, "s1");

    expect(session?.messages.map((message) => message.content)).toEqual(["mock_text", "mock_text"]);
  });

  it("does not carry pending tool executions or thinking across request boundaries", async () => {
    await appendTranscriptEvent(projectRoot, {
      type: "session_created",
      version: 1,
      sessionId: "s1",
      seq: 1,
      timestamp: 1,
      bookId: "book-a",
      title: null,
      createdAt: 1,
      updatedAt: 1,
    });
    await appendTranscriptEvent(projectRoot, {
      type: "request_started",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      seq: 2,
      timestamp: 2,
      input: "mock_text",
    });
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "u1",
      parentUuid: null,
      seq: 3,
      role: "user",
      timestamp: 3,
      message: { role: "user", content: "mock_text", timestamp: 3 },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "a1",
      parentUuid: "u1",
      seq: 4,
      role: "assistant",
      timestamp: 4,
      toolCallId: "ls-1",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Chương mock_text" },
          { type: "toolCall", id: "ls-1", name: "ls", arguments: { subdir: "story" } },
        ],
        api: "anthropic-messages",
        provider: "anthropic",
        model: "claude",
        usage,
        stopReason: "toolUse",
        timestamp: 4,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "t1",
      parentUuid: "a1",
      seq: 5,
      role: "toolResult",
      timestamp: 5,
      toolCallId: "ls-1",
      sourceToolAssistantUuid: "a1",
      message: {
        role: "toolResult",
        toolCallId: "ls-1",
        toolName: "ls",
        content: [{ type: "text", text: "roles/" }],
        isError: false,
        timestamp: 5,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "request_committed",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      seq: 6,
      timestamp: 6,
    });
    await appendTranscriptEvent(projectRoot, {
      type: "request_started",
      version: 1,
      sessionId: "s1",
      requestId: "r2",
      seq: 7,
      timestamp: 7,
      input: "mock_text",
    });
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r2",
      uuid: "u2",
      parentUuid: null,
      seq: 8,
      role: "user",
      timestamp: 8,
      message: { role: "user", content: "mock_text", timestamp: 8 },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r2",
      uuid: "a2",
      parentUuid: "u2",
      seq: 9,
      role: "assistant",
      timestamp: 9,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Chương mock_text" }],
        api: "anthropic-messages",
        provider: "anthropic",
        model: "claude",
        usage,
        stopReason: "stop",
        timestamp: 9,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "request_committed",
      version: 1,
      sessionId: "s1",
      requestId: "r2",
      seq: 10,
      timestamp: 10,
    });

    const session = await deriveBookSessionFromTranscript(projectRoot, "s1");
    const secondAssistant = session?.messages.find((message) => message.content === "Chương mock_text");

    expect(secondAssistant).toMatchObject({ role: "assistant", content: "Chương mock_text" });
    expect(secondAssistant).not.toHaveProperty("thinking");
    expect(secondAssistant).not.toHaveProperty("toolExecutions");
  });

  it("does not resolve tool results with tool calls from a previous request", async () => {
    await appendTranscriptEvent(projectRoot, {
      type: "session_created",
      version: 1,
      sessionId: "s1",
      seq: 1,
      timestamp: 1,
      bookId: "book-a",
      title: null,
      createdAt: 1,
      updatedAt: 1,
    });
    await appendTranscriptEvent(projectRoot, {
      type: "request_started",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      seq: 2,
      timestamp: 2,
      input: "Chương mock_text",
    });
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "a1",
      parentUuid: null,
      seq: 3,
      role: "assistant",
      timestamp: 3,
      toolCallId: "shared-tool",
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", id: "shared-tool", name: "ls", arguments: { subdir: "story/roles" } },
        ],
        api: "anthropic-messages",
        provider: "anthropic",
        model: "claude",
        usage,
        stopReason: "toolUse",
        timestamp: 3,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "request_committed",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      seq: 4,
      timestamp: 4,
    });
    await appendTranscriptEvent(projectRoot, {
      type: "request_started",
      version: 1,
      sessionId: "s1",
      requestId: "r2",
      seq: 5,
      timestamp: 5,
      input: "Chương mock_text",
    });
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r2",
      uuid: "u2",
      parentUuid: null,
      seq: 6,
      role: "user",
      timestamp: 6,
      message: { role: "user", content: "Chương mock_text", timestamp: 6 },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r2",
      uuid: "t2",
      parentUuid: "u2",
      seq: 7,
      role: "toolResult",
      timestamp: 7,
      toolCallId: "shared-tool",
      message: {
        role: "toolResult",
        toolCallId: "shared-tool",
        toolName: "ls",
        content: [{ type: "text", text: "chapters/" }],
        isError: false,
        timestamp: 7,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r2",
      uuid: "a2",
      parentUuid: "t2",
      seq: 8,
      role: "assistant",
      timestamp: 8,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Chương mock_text" }],
        api: "anthropic-messages",
        provider: "anthropic",
        model: "claude",
        usage,
        stopReason: "stop",
        timestamp: 8,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "request_committed",
      version: 1,
      sessionId: "s1",
      requestId: "r2",
      seq: 9,
      timestamp: 9,
    });

    const session = await deriveBookSessionFromTranscript(projectRoot, "s1");
    const secondAssistant = session?.messages.find((message) => message.content === "Chương mock_text");

    expect(secondAssistant?.toolExecutions).toEqual([
      expect.objectContaining({
        id: "shared-tool",
        tool: "ls",
        result: "chapters/",
        startedAt: 7,
        completedAt: 7,
      }),
    ]);
    expect(secondAssistant?.toolExecutions?.[0]).not.toHaveProperty("args");
  });

  it("restores a terminal proposed-action card onto the previous assistant message", async () => {
    await appendTranscriptEvent(projectRoot, {
      type: "session_created",
      version: 1,
      sessionId: "s1",
      seq: 1,
      timestamp: 1,
      bookId: null,
      sessionKind: "play",
      playMode: "open",
      title: null,
      createdAt: 1,
      updatedAt: 1,
    });
    await appendTranscriptEvent(projectRoot, {
      type: "request_started",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      sessionKind: "play",
      seq: 2,
      timestamp: 2,
      input: "mock_text",
    });
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "a1",
      parentUuid: null,
      seq: 3,
      role: "assistant",
      timestamp: 3,
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "mock_text。" },
          {
            type: "toolCall",
            id: "proposal-1",
            name: "propose_action",
            arguments: {
              action: "play_start",
              instruction: "mock_text",
              title: "mock_text",
            },
          },
        ],
        api: "openai-completions",
        provider: "openai",
        model: "deepseek-v4-flash",
        usage,
        stopReason: "toolUse",
        timestamp: 3,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "t1",
      parentUuid: "a1",
      seq: 4,
      role: "toolResult",
      timestamp: 4,
      toolCallId: "proposal-1",
      message: {
        role: "toolResult",
        toolCallId: "proposal-1",
        toolName: "propose_action",
        content: [{ type: "text", text: "mock_text" }],
        details: {
          kind: "proposed_action",
          action: "play_start",
          targetSessionKind: "play",
          sameSession: true,
          instruction: "mock_text",
          title: "mock_text",
        },
        isError: false,
        timestamp: 4,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "a2",
      parentUuid: "t1",
      seq: 5,
      role: "assistant",
      timestamp: 5,
      message: {
        role: "assistant",
        content: [],
        api: "openai-completions",
        provider: "openai",
        model: "deepseek-v4-flash",
        usage,
        stopReason: "stop",
        timestamp: 5,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "request_committed",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      seq: 6,
      timestamp: 6,
    });

    const session = await deriveBookSessionFromTranscript(projectRoot, "s1");
    const assistant = session?.messages.find((message) => message.content === "mock_text。");

    expect(assistant?.toolExecutions).toEqual([
      expect.objectContaining({
        id: "proposal-1",
        tool: "propose_action",
        details: expect.objectContaining({
          kind: "proposed_action",
          action: "play_start",
          targetSessionKind: "play",
          instruction: "mock_text",
        }),
      }),
    ]);
  });

  it("restores a direct terminal tool call as a standalone assistant card", async () => {
    await appendTranscriptEvent(projectRoot, {
      type: "session_created",
      version: 1,
      sessionId: "s1",
      seq: 1,
      timestamp: 1,
      bookId: "book-a",
      sessionKind: "book",
      title: null,
      createdAt: 1,
      updatedAt: 1,
    });
    await appendTranscriptEvent(projectRoot, {
      type: "request_started",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      sessionKind: "book",
      seq: 2,
      timestamp: 2,
      input: "mock_text",
    });
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "u1",
      parentUuid: null,
      seq: 3,
      role: "user",
      timestamp: 3,
      message: { role: "user", content: "mock_text", timestamp: 3 },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "a1",
      parentUuid: "u1",
      seq: 4,
      role: "assistant",
      timestamp: 4,
      toolCallId: "forecast-1",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "mock_text" },
          {
            type: "toolCall",
            id: "forecast-1",
            name: "get_narrative_forecast",
            arguments: { forecastId: "fc-1" },
          },
        ],
        api: "openai-completions",
        provider: "openai",
        model: "deepseek-v4-flash",
        usage,
        stopReason: "toolUse",
        timestamp: 4,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "t1",
      parentUuid: "a1",
      seq: 5,
      role: "toolResult",
      timestamp: 5,
      toolCallId: "forecast-1",
      sourceToolAssistantUuid: "a1",
      message: {
        role: "toolResult",
        toolCallId: "forecast-1",
        toolName: "get_narrative_forecast",
        content: [{ type: "text", text: "Forecast fc-1 is active." }],
        details: { kind: "narrative_forecast", stale: false },
        isError: false,
        timestamp: 5,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "a2",
      parentUuid: "t1",
      seq: 6,
      role: "assistant",
      timestamp: 6,
      message: {
        role: "assistant",
        content: [],
        api: "openai-completions",
        provider: "openai",
        model: "deepseek-v4-flash",
        usage,
        stopReason: "stop",
        timestamp: 6,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "request_committed",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      seq: 7,
      timestamp: 7,
    });

    const session = await deriveBookSessionFromTranscript(projectRoot, "s1");

    expect(session?.messages).toEqual([
      expect.objectContaining({ role: "user", content: "mock_text" }),
      expect.objectContaining({
        role: "assistant",
        content: "",
        thinking: "mock_text",
        toolExecutions: [expect.objectContaining({
          id: "forecast-1",
          tool: "get_narrative_forecast",
          label: "mock_text",
          args: { forecastId: "fc-1" },
          details: { kind: "narrative_forecast", stale: false },
          status: "completed",
        })],
      }),
    ]);
  });

  it("restores play tool turns as tool-only messages instead of duplicating scene text", async () => {
    await appendTranscriptEvent(projectRoot, {
      type: "session_created",
      version: 1,
      sessionId: "s1",
      seq: 1,
      timestamp: 1,
      bookId: null,
      sessionKind: "play",
      playMode: "open",
      title: null,
      createdAt: 1,
      updatedAt: 1,
    });
    await appendTranscriptEvent(projectRoot, {
      type: "request_started",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      sessionKind: "play",
      seq: 2,
      timestamp: 2,
      input: "mock_text",
    });
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "u1",
      parentUuid: null,
      seq: 3,
      role: "user",
      timestamp: 3,
      message: { role: "user", content: "mock_text", timestamp: 3 },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "a1",
      parentUuid: "u1",
      seq: 4,
      role: "assistant",
      timestamp: 4,
      toolCallId: "tool-1",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "mock_text play_step", signature: "sig" },
          { type: "toolCall", id: "tool-1", name: "play_step", arguments: { input: "mock_text" } },
        ],
        api: "openai-completions",
        provider: "openai",
        model: "deepseek-v4-flash",
        usage,
        stopReason: "toolUse",
        timestamp: 4,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "t1",
      parentUuid: "a1",
      seq: 5,
      role: "toolResult",
      timestamp: 5,
      toolCallId: "tool-1",
      sourceToolAssistantUuid: "a1",
      message: {
        role: "toolResult",
        toolCallId: "tool-1",
        toolName: "play_step",
        content: [{ type: "text", text: "Play advanced.\nmock_text。" }],
        details: {
          kind: "play_turn_advanced",
          sceneText: "mock_text。",
          suggestedActions: ["mock_text"],
        },
        isError: false,
        timestamp: 5,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "a2",
      parentUuid: "t1",
      seq: 6,
      role: "assistant",
      timestamp: 6,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "mock_text。" }],
        api: "openai-completions",
        provider: "openai",
        model: "deepseek-v4-flash",
        usage,
        stopReason: "stop",
        timestamp: 6,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "request_committed",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      seq: 7,
      timestamp: 7,
    });

    const session = await deriveBookSessionFromTranscript(projectRoot, "s1");
    const assistant = session?.messages.find((message) => message.toolExecutions?.some((exec) => exec.tool === "play_step"));

    expect(assistant).toMatchObject({
      role: "assistant",
      content: "",
      thinking: expect.stringContaining("mock_text。"),
      toolExecutions: [
        expect.objectContaining({
          tool: "play_step",
          details: expect.objectContaining({ kind: "play_turn_advanced" }),
        }),
      ],
    });
    expect(session?.messages.some((message) => message.content === "mock_text。")).toBe(false);
  });
});
