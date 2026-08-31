import { createAssistantMessageEventStream } from "@mariozechner/pi-ai";
import { castorEnv } from "../utils/llm-env.js";
import type {
  AssistantMessage,
  AssistantMessageEventStream,
  Model,
  Api,
} from "@mariozechner/pi-ai";
import type { LLMMessage, LLMResponse } from "../llm/provider.js";

export function isLlmStubEnabled(): boolean {
  return Boolean(castorEnv("CASTOR_AGENT_LLM_STUB"));
}

// Mirrors EMPTY_USAGE in agent-session.ts exactly.
const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function lastUserText(context: { messages?: Array<{ role: string; content: unknown }> }): string {
  const msgs = context.messages ?? [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role === "user") {
      return typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    }
  }
  return "";
}

function alreadyProposed(
  context: { messages?: Array<{ role: string; content: unknown; toolName?: string }> },
): boolean {
  return (context.messages ?? []).some((m) => {
    // Agent format (non-openai-completions): role="toolResult" with toolName
    if (m.role === "toolResult" && (m as { toolName?: string }).toolName === "propose_action") {
      return true;
    }
    // LLM format (openai-completions): assistant message with toolCall content
    if (m.role === "assistant" && Array.isArray(m.content)) {
      if (
        (m.content as Array<{ type: string; name?: string }>).some(
          (c) => c.type === "toolCall" && c.name === "propose_action",
        )
      ) {
        return true;
      }
    }
    // LLM format (openai-completions folded): tool result folded into user message string
    if (m.role === "user" && typeof m.content === "string") {
      if (/- propose_action \(/.test(m.content as string)) {
        return true;
      }
    }
    return false;
  });
}

/**
 * Returns a deterministic AssistantMessageEventStream that either emits a
 * propose_action toolCall (when the latest user text mentions "structure"
 * and propose_action hasn't run yet) or a plain "OK." text reply.
 *
 * Mirrors localAssistantStopStream in agent-session.ts exactly — same
 * createAssistantMessageEventStream() + queueMicrotask pattern.
 */
export function stubAgentStream(model: Model<Api>, context: unknown): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const text = lastUserText(context as { messages?: Array<{ role: string; content: unknown }> });
  const proposed = alreadyProposed(
    context as { messages?: Array<{ role: string; content: unknown; toolName?: string }> },
  );
  const wantStructure = !proposed && /structure|frame/i.test(text);

  const content = wantStructure
    ? [
        {
          type: "toolCall" as const,
          id: "stub-draft",
          name: "propose_action",
          arguments: {
            action: "draft_structure",
            title: "Build Structure",
            summary: "Generate 3-act structure upon confirmation",
            instruction: "Build a 3-act branching structure",
            draftStructure: { instruction: "3-act branching structure" },
          },
        },
      ]
    : [{ type: "text" as const, text: "OK." }];

  const stopReason = wantStructure ? ("toolUse" as const) : ("stop" as const);

  const message: AssistantMessage = {
    role: "assistant",
    content: content as AssistantMessage["content"],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: EMPTY_USAGE as AssistantMessage["usage"],
    stopReason,
    timestamp: Date.now(),
  };

  queueMicrotask(() => {
    stream.push({ type: "done", reason: stopReason, message });
    stream.end(message);
  });

  return stream;
}

const STRUCTURE_JSON = JSON.stringify({
  nodes: [
    {
      id: "s",
      type: "start",
      title: "Opening",
      sceneDesc: "Palace Gate",
      choices: [{ id: "c1", text: "Audit", targetNodeId: "b" }],
    },
    {
      id: "b",
      type: "branch",
      title: "Choice",
      sceneDesc: "Accounting Room",
      choices: [
        { id: "c2", text: "Disclose", targetNodeId: "e1" },
        { id: "c3", text: "Conceal", targetNodeId: "e2" },
      ],
    },
    { id: "e1", type: "ending", title: "Truth", choices: [] },
    { id: "e2", type: "ending", title: "Downfall", choices: [] },
  ],
});

const NODE_JSON = JSON.stringify({
  type: "branch",
  title: "New Scene",
  sceneDesc: "Nightfall",
  dialogue: [{ speaker: "A Mei", text: "The books must not be wrong", emotion: "determined" }],
  choices: [],
});

/**
 * Deterministic replacement for the chatCompletion network call.
 * Returns STRUCTURE_JSON when the prompt mentions structure/nodes,
 * otherwise a single node JSON.
 */
export function stubChatCompletion(
  messages: ReadonlyArray<LLMMessage>,
  _model: string,
): LLMResponse {
  const joined = messages.map((m) => m.content).join("\n");
  const content = /structure|nodes|frame/i.test(joined) ? STRUCTURE_JSON : NODE_JSON;
  return {
    content,
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  };
}
