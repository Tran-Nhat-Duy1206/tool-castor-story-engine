import { z } from "zod";
import { Type } from "@mariozechner/pi-ai";
import { BaseAgent, type AgentContext } from "../agents/base.js";
import {
  PlayActionIntentSchema,
  PlayMutationSchema,
  type PlayActionIntent,
  type PlayActionIntentInput,
  type PlayMutation,
  type PlayMutationInput,
} from "../models/play.js";
import { appendPromptPackGuidance } from "../prompts/prompt-pack.js";

export interface PlayActionInterpreterInput {
  readonly input: string;
  readonly sceneBrief: string;
  readonly language?: "vi" | "en";
}

export interface PlayWorldMutatorInput {
  readonly turn: number;
  readonly input: string;
  readonly action: PlayActionIntentInput;
  readonly context: string;
  readonly language?: "vi" | "en";
}

export interface PlaySceneRenderInput {
  readonly input: string;
  readonly action: PlayActionIntentInput;
  readonly context?: string;
  readonly mutationSummary: string;
  readonly stateBrief: string;
  readonly replayContext?: string;
  readonly language?: "vi" | "en";
  // The world's premise — a persistent anchor so the scene stays in the
  // established era/setting/genre and doesn't drift (a modern shop must not grow
  // night-watchmen and oil lamps).
  readonly worldPremise?: string;
}

export interface PlaySceneReconcileInput {
  readonly turn: number;
  readonly input: string;
  readonly action: PlayActionIntentInput;
  readonly mutation: PlayMutationInput;
  readonly sceneText: string;
  readonly context: string;
  readonly stateBrief: string;
  readonly language?: "vi" | "en";
  readonly worldPremise?: string;
}

const PlaySceneRenderSchema = z.object({
  sceneText: z.string().min(1),
  suggestedActions: z.array(z.string().min(1)).min(0).max(4).default([]),
});
export type PlaySceneRender = z.infer<typeof PlaySceneRenderSchema>;

const PlayEntityResultSchema = Type.Object({
  id: Type.Optional(Type.String()),
  type: Type.Union([
    Type.Literal("actor"), Type.Literal("location"), Type.Literal("item"),
    Type.Literal("evidence"), Type.Literal("clue"), Type.Literal("claim"),
    Type.Literal("proof_chain"), Type.Literal("organization"), Type.Literal("rule"),
    Type.Literal("scene"), Type.Literal("event"),
  ]),
  label: Type.String(),
  summary: Type.Optional(Type.String()),
  status: Type.Optional(Type.String()),
});

const PlayEdgeResultSchema = Type.Object({
  id: Type.Optional(Type.String()),
  fromId: Type.String(),
  type: Type.String(),
  toId: Type.String(),
  value: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  visibility: Type.Optional(Type.Record(Type.String(), Type.String())),
  strength: Type.Optional(Type.Number()),
  confidence: Type.Optional(Type.Number()),
});

const PlayStateSlotResultSchema = Type.Object({
  id: Type.Optional(Type.String()),
  ownerEntityId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  kind: Type.Union([
    Type.Literal("resource"), Type.Literal("relation"), Type.Literal("pressure"),
    Type.Literal("clue"), Type.Literal("evidence"), Type.Literal("flag"), Type.Literal("timer"),
  ]),
  label: Type.String(),
  value: Type.Unknown(),
});

const PlayMutationResultSchema = Type.Object({
  summary: Type.Optional(Type.String()),
  timeAdvance: Type.Optional(Type.Object({
    elapsed: Type.String(),
    anchor: Type.Optional(Type.String()),
    rationale: Type.Optional(Type.String()),
    synchronized: Type.Optional(Type.Array(Type.String())),
  })),
  entities: Type.Optional(Type.Array(PlayEntityResultSchema)),
  edges: Type.Optional(Type.Array(PlayEdgeResultSchema)),
  expiredEdges: Type.Optional(Type.Array(Type.Object({
    edgeId: Type.String(),
    reason: Type.Optional(Type.String()),
  }))),
  stateSlots: Type.Optional(Type.Array(PlayStateSlotResultSchema)),
  evidenceTransitions: Type.Optional(Type.Array(Type.Object({
    entityId: Type.String(),
    from: Type.Optional(Type.Union([
      Type.Literal("unknown"), Type.Literal("hinted"), Type.Literal("seen"),
      Type.Literal("collected"), Type.Literal("verified"), Type.Literal("weaponized"),
      Type.Literal("exposed"), Type.Literal("exhausted"),
    ])),
    to: Type.Union([
      Type.Literal("unknown"), Type.Literal("hinted"), Type.Literal("seen"),
      Type.Literal("collected"), Type.Literal("verified"), Type.Literal("weaponized"),
      Type.Literal("exposed"), Type.Literal("exhausted"),
    ]),
    reason: Type.Optional(Type.String()),
  }))),
  blocked: Type.Optional(Type.Boolean()),
  blockedReason: Type.Optional(Type.String()),
  notes: Type.Optional(Type.Array(Type.String())),
});

const WORLD_MUTATION_TOOL = {
  name: "submit_world_mutation",
  label: "Submit world mutation",
  description: "Submit the complete world-state transition caused by this action. Host-owned event metadata is intentionally omitted.",
  parameters: PlayMutationResultSchema,
} as const;

const GRAPH_RECONCILIATION_TOOL = {
  name: "submit_graph_reconciliation",
  label: "Submit graph reconciliation",
  description: "Submit only graph facts present in the rendered scene but missing from the applied mutation. Submit empty arrays when nothing is missing.",
  parameters: PlayMutationResultSchema,
} as const;

const PLAY_SCENE_RENDER_TOOL = {
  name: "submit_play_scene",
  label: "Submit play scene",
  description: "Submit the rendered scene and up to four immediate player actions grounded in the applied world state.",
  parameters: Type.Object({
    sceneText: Type.String({ minLength: 1 }),
    suggestedActions: Type.Array(Type.String({ minLength: 1 }), { maxItems: 4 }),
  }),
} as const;

// A play turn runs three internal LLM calls (interpret → mutate → render). The
// transport-level retry in the provider does NOT cover HTTP 502/503/429 or
// "temporarily unavailable", so a single flaky upstream response would break the
// whole turn. Retry those here; each agent then applies its own safe failure policy.
function isRetryableLlmError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return /50[0-9]|429|temporarily unavailable|timeout|timed out|socket|terminated|econn|network|fetch failed|bad gateway|service unavailable|rate limit/.test(msg);
}

async function chatWithRetry<T>(call: () => Promise<T>, retries = 2): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await call();
    } catch (err) {
      lastErr = err;
      if (attempt >= retries || !isRetryableLlmError(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw lastErr;
}

export class PlayActionInterpreterAgent extends BaseAgent {
  constructor(ctx: AgentContext) {
    super(ctx);
  }

  get name(): string {
    return "play-action-interpreter";
  }

  async interpret(input: PlayActionInterpreterInput): Promise<PlayActionIntent> {
    // Never throw: a transient upstream error (after retries) or unparseable output
    // degrades to a generic action (the player's raw text as a "do"), not a crash.
    let raw: unknown = {};
    try {
      const response = await chatWithRetry(() => this.chat([
        { role: "system", content: buildActionInterpreterSystemPrompt(input.language ?? "vi") },
        { role: "user", content: buildActionInterpreterUserPrompt(input, input.language ?? "vi") },
      ], { temperature: 0.15, maxTokens: 1024 }));
      raw = parseJson(response.content);
    } catch { /* transient/malformed → degrade below */ }
    const parsed = PlayActionIntentSchema.safeParse(raw);
    return parsed.success
      ? parsed.data
      : PlayActionIntentSchema.parse({ actionKind: "do", intent: input.input });
  }
}

export class PlayWorldMutatorAgent extends BaseAgent {
  constructor(ctx: AgentContext) {
    super(ctx);
  }

  get name(): string {
    return "play-world-mutator";
  }

  async proposeMutation(input: PlayWorldMutatorInput): Promise<PlayMutation> {
    const language = input.language ?? "vi";
    const actionKind = PlayActionIntentSchema.parse(input.action).actionKind;
    const systemPrompt = await appendPromptPackGuidance(
      buildWorldMutatorSystemPrompt(language),
      { promptId: "play.mutator", projectRoot: this.ctx.projectRoot },
    );
    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: buildWorldMutatorUserPrompt(input, language) },
    ];

    // Empty output cannot count as a completed turn: otherwise prose advances
    // while the canonical graph stays frozen. Give the model one repair turn,
    // then expose a blocked no-op instead of silently splitting state and prose.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw = await chatWithRetry(() => this.submitStructured(
          messages,
          WORLD_MUTATION_TOOL,
          { temperature: 0.25, maxTokens: 4096 },
        ));
        const mutation = mutationFromStructuredResult(raw, input.turn, actionKind);
        logDroppedMutationItems(raw, mutation, input.turn);
        if (hasMutationResult(mutation)) return mutation;
      } catch {
        // One operation-level retry below. Transport retries remain in the Pi harness.
      }
      if (attempt === 0) {
        messages.push({
          role: "user",
          content: language === "en"
            ? "No usable world result was submitted. Call submit_world_mutation with a summary and the concrete state, entity, relationship, or time changes. If the action cannot proceed, submit blocked=true with blockedReason."
            : "Chưa có kết quả thế giới hợp lệ nào được gửi. Hãy gọi submit_world_mutation kèm summary và các thay đổi cụ thể về trạng thái, thực thể, quan hệ hoặc thời gian; nếu hành động không thể thực hiện, hãy gửi blocked=true và blockedReason.",
        });
      }
    }

    return withHostMutationIdentity(PlayMutationSchema.parse({
      blocked: true,
      blockedReason: language === "en"
        ? "The model did not return a usable world-state transition. This turn did not advance."
        : "Mô hình không trả về chuyển đổi trạng thái thế giới hợp lệ. Lượt này chưa được thúc đẩy.",
    }), input.turn, actionKind);
  }
}

function mutationFromStructuredResult(
  raw: Record<string, unknown>,
  turn: number,
  actionKind: PlayActionIntent["actionKind"],
): PlayMutation {
  return withHostMutationIdentity(PlayMutationSchema.parse({
    summary: raw.summary,
    timeAdvance: raw.timeAdvance,
    entities: { upsert: raw.entities },
    edges: {
      upsert: raw.edges,
      expire: Array.isArray(raw.expiredEdges)
        ? raw.expiredEdges.map((edge) => ({
            ...(edge as Record<string, unknown>),
            validUntilEventId: `evt-${turn}`,
          }))
        : [],
    },
    stateSlots: { upsert: raw.stateSlots },
    evidence: { transitions: raw.evidenceTransitions },
    blocked: raw.blocked,
    blockedReason: raw.blockedReason,
    notes: raw.notes,
  }), turn, actionKind);
}

function withHostMutationIdentity(
  mutation: PlayMutation,
  turn: number,
  actionKind: PlayActionIntent["actionKind"],
): PlayMutation {
  return PlayMutationSchema.parse({
    ...mutation,
    eventId: `evt-${turn}`,
    turn,
    actionKind,
  });
}

function hasMutationResult(mutation: PlayMutation): boolean {
  return mutation.blocked
    || Boolean(mutation.summary.trim())
    || Boolean(mutation.timeAdvance)
    || mutation.entities.upsert.length > 0
    || mutation.edges.upsert.length > 0
    || mutation.edges.expire.length > 0
    || mutation.stateSlots.upsert.length > 0
    || mutation.evidence.transitions.length > 0
    || mutation.notes.length > 0;
}

function rawUpsertCount(field: unknown): number {
  if (Array.isArray(field)) return field.length;
  if (field && typeof field === "object" && Array.isArray((field as { upsert?: unknown }).upsert)) {
    return (field as { upsert: unknown[] }).upsert.length;
  }
  return 0;
}

function logDroppedMutationItems(raw: unknown, mutation: PlayMutation, turn: number): void {
  if (!raw || typeof raw !== "object") return;
  const r = raw as Record<string, unknown>;
  const rawE = rawUpsertCount(r.entities);
  const rawEd = rawUpsertCount(r.edges);
  const rawS = rawUpsertCount(r.stateSlots);
  const keptE = mutation.entities.upsert.length;
  const keptEd = mutation.edges.upsert.length;
  const keptS = mutation.stateSlots.upsert.length;
  if (rawE > keptE || rawEd > keptEd || rawS > keptS) {
    // eslint-disable-next-line no-console -- intentional degradation observability
    console.warn(
      `[play-mutator] turn ${turn}: dropped malformed items — entities ${rawE}->${keptE}, edges ${rawEd}->${keptEd}, slots ${rawS}->${keptS}`,
    );
  }
}

export class PlaySceneRendererAgent extends BaseAgent {
  constructor(ctx: AgentContext) {
    super(ctx);
  }

  get name(): string {
    return "play-scene-renderer";
  }

  async render(input: PlaySceneRenderInput & { readonly mode?: "open" | "guided" }): Promise<PlaySceneRender> {
    const language = input.language ?? "vi";
    const systemPrompt = await appendPromptPackGuidance(
      buildSceneRendererSystemPrompt(input.mode ?? "open", language),
      { promptId: "play.renderer", projectRoot: this.ctx.projectRoot },
    );
    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: buildSceneRendererUserPrompt(input, language) },
    ];
    const raw = await chatWithRetry(() => this.submitStructured(
      messages,
      PLAY_SCENE_RENDER_TOOL,
      { temperature: 0.45, maxTokens: 4096 },
    ));
    return PlaySceneRenderSchema.parse(raw);
  }
}

export class PlaySceneReconcilerAgent extends BaseAgent {
  constructor(ctx: AgentContext) {
    super(ctx);
  }

  get name(): string {
    return "play-scene-reconciler";
  }

  async reconcile(input: PlaySceneReconcileInput): Promise<PlayMutationInput> {
    const language = input.language ?? "vi";
    const eventId = `evt-${input.turn}`;
    const actionKind = PlayActionIntentSchema.parse(input.action).actionKind;
    const empty = emptyReconciliation(input.turn, actionKind);
    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: buildSceneReconcilerSystemPrompt(language) },
      { role: "user", content: buildSceneReconcilerUserPrompt(input, language) },
    ];
    try {
      const raw = await chatWithRetry(() => this.submitStructured(
        messages,
        GRAPH_RECONCILIATION_TOOL,
        { temperature: 0.1, maxTokens: 2048 },
      ));
      return mutationFromStructuredResult(raw, input.turn, actionKind);
    } catch {
      return empty;
    }
  }
}

function emptyReconciliation(turn: number, actionKind: PlayActionIntent["actionKind"]): PlayMutationInput {
  return {
    eventId: `evt-${turn}`,
    turn,
    actionKind,
    summary: "",
    entities: { upsert: [] },
    edges: { upsert: [], expire: [] },
    stateSlots: { upsert: [] },
    evidence: { transitions: [] },
    blocked: false,
    blockedReason: "",
    notes: [],
  };
}

function buildSceneReconcilerSystemPrompt(language: "vi" | "en"): string {
  const outputLanguage = language === "vi" ? "Vietnamese" : "English";
  return [
    "You reconcile an interactive-fiction scene with the world graph.",
    `Output all facts in ${outputLanguage}. Keep system keys and schemas unchanged.`,
    "Compare the rendered prose against the already applied changes and current state summary.",
    "If the prose introduced a concrete named object, clue, evidence, location, organization, or person that is not represented in the applied changes/current state, submit ONLY those missing graph facts.",
    "Do not rewrite prose. Do not invent facts that are not in the rendered scene. If nothing is missing, submit empty arrays.",
    "Use the same eventId/turn/actionKind. For tangible things the player now physically holds, add a holding edge from actor_player with value.role=\"holding\"; if the target is evidence/clue/claim/proof_chain rather than an item, also set value.physical=true. Observed phenomena or learned facts are not holdings.",
    "Call submit_graph_reconciliation once. The host supplies eventId, turn, and actionKind.",
  ].join("\n");
}

function buildSceneReconcilerUserPrompt(input: PlaySceneReconcileInput, language: "vi" | "en"): string {
  const actionKind = PlayActionIntentSchema.parse(input.action).actionKind;
  const eventId = `evt-${input.turn}`;
  return [
    `eventId: ${eventId}`,
    `turn: ${input.turn}`,
    `actionKind: ${actionKind}`,
    "",
    ...(input.worldPremise ? [language === "en" ? "World setting:" : "Thiết lập thế giới:", input.worldPremise, ""] : []),
    language === "en" ? "Player input:" : "Nhập liệu người chơi:",
    input.input,
    "",
    language === "en" ? "Current context before this turn:" : "Ngữ cảnh trước lượt này:",
    input.context,
    "",
    language === "en" ? "Applied mutation:" : "Biến đổi đã áp dụng:",
    JSON.stringify(PlayMutationSchema.parse(input.mutation), null, 2),
    "",
    language === "en" ? "Current state summary:" : "Tóm tắt trạng thái hiện tại:",
    input.stateBrief,
    "",
    language === "en" ? "Rendered scene:" : "Cảnh đã kết xuất:",
    input.sceneText,
  ].join("\n");
}

function buildActionInterpreterSystemPrompt(language: "vi" | "en"): string {
  return [
    "You are an interactive-fiction action interpreter.",
    "Your job is to normalize one line of the player's natural language into one of five action kinds: look / say / move / do / wait.",
    "Do not add drama for the player, do not advance the plot, do not write scene prose.",
    "look = observe/examine/recall a clue; say = speak/probe/confront; move = move to a location; do = perform an action/use an item/investigate; wait = wait/stall/watch.",
    "Output strict JSON, no explanation.",
  ].join("\n");
}

function buildActionInterpreterUserPrompt(input: PlayActionInterpreterInput, language: "vi" | "en"): string {
  return [
    language === "en" ? "Current scene:" : "Cảnh hiện tại:",
    input.sceneBrief,
    "",
    language === "en" ? "Player input:" : "Nhập liệu người chơi:",
    input.input,
    "",
    language === "en"
      ? "Output fields: actionKind, targetEntityLabel?, targetLocationLabel?, intent, manner, risk, ambiguity, secondaryActions."
      : "Các trường xuất: actionKind, targetEntityLabel?, targetLocationLabel?, intent, manner, risk, ambiguity, secondaryActions.",
  ].join("\n");
}

function buildWorldMutatorSystemPrompt(language: "vi" | "en"): string {
  const outputLanguage = language === "vi" ? "Vietnamese" : "English";
  return [
    "You are an interactive-fiction world-state drafter.",
    `Output all draft values and descriptions in ${outputLanguage}. Keep identifiers, roles, and schema keys unchanged.`,
    "Based only on the player's action and the current context, propose this turn's possible state changes as a draft.",
    "Do not write final prose; do not commit to the store on the reducer's behalf; do not let key states jump to completion out of nowhere.",
    "This engine is genre-neutral: romance, adventure, wuxia, mystery, slice-of-life all use the same structure. Entity types: actor/location/item/evidence/clue/claim/proof_chain/organization/rule/scene/event — use as needed.",
    "Give every new or important entity a one-line summary (who/what it is and why it matters), not just a status word — the player expands this summary in the side panel.",
    "Tangible things the player discovers or holds (a clue, a document, a weapon, a token, key evidence) MUST be their own entity (item/evidence/clue), never folded into a person's status — only then can they enter the player's holdings and be tracked. Observed phenomena, knowledge, impressions, or environmental signs are NOT holdings.",
    "Use entity.status to record state progress for any genre, with status words suited to this world's genre, advancing step by step without skipping (e.g. relationship: stranger -> curious -> attracted -> lover; injury: healthy -> bleeding -> critical; clue: found -> collected -> confirmed).",
    "The player entity id is fixed: always use id actor_player for the player character. Never rename this id; only replace its label, summary, and status with this world's player identity.",
    "Whenever a meaningful relationship forms or shifts between entities (ally / rival / kin / suspicion / debt / master-servant …), record it in edges.upsert as {\"fromId\":\"<entity>\",\"type\":\"<relation>\",\"toId\":\"<entity>\",\"value\":{\"role\":\"relation\"}} — this is the ONLY source for the relationship panel, so over-record rather than skip; add a fresh edge when a relationship changes.",
    "When the player physically holds/carries/keeps/takes a tangible thing, record an edge from actor_player to that entity and set value.role=\"holding\". If the held target is evidence/clue/claim/proof_chain rather than an item, also set value.physical=true. If the player only observes or learns something, use value.role=\"observed\" or a normal relation, never holding.",
    "The current context may include an entity roster. Reuse those exact ids in entities, edges, evidence, and stateSlots. If you only know a name, use the exact roster label; never invent a new id for the same person/thing (or the panel shows duplicates).",
    "State tracking is optional and governed by the user's world contract. If the world contract rejects stats, numeric panels, levels, RPG framing, or quantified meters, do NOT output stateSlots; express progress as natural-language entity.status / summary / evidence transitions instead.",
    "When stateSlots are appropriate, prefer natural-language values unless the user explicitly asked for quantitative tracking or the fiction contains a concrete count/clock/deadline. Do not create numbers just because the schema supports them.",
    "Early on (the first few turns), seed only the state the premise already establishes: a concrete deadline may become a timer slot if the world permits quantified tracking; the central mystery/objective -> its first clue/evidence entity; already-named key characters -> actor entities with a one-line summary. Don't leave the opening world nearly empty.",
    "Restraint: only create entities and meters the story actually makes real — never invent gratuitous stats or items just to fill the panel.",
    "Only use evidence.transitions for the evidence lifecycle when this world is genuinely an investigation/mystery; otherwise leave it empty.",
    "If the player's action is invalid or information is insufficient, set blocked=true and write blockedReason.",
    "Time is a synchronization axis, not a fixed tick. For every non-opening turn, set timeAdvance with: elapsed = the natural-language duration spent by this action; anchor = the world time/phase after the action if the world has a clock, season, phase, day/night, retreat period, deadline, or other temporal anchor; rationale = why this duration is right; synchronized = what relevant NPCs/places/pressures changed during the same elapsed time. A glance may pass seconds, a trip half a day, cultivation three years — obey the user's world contract; never invent a universal turn length.",
    "Call submit_world_mutation once with summary, timeAdvance, entities, edges, stateSlots, evidenceTransitions, blocked, blockedReason, and notes. The host supplies eventId, turn, and actionKind.",
  ].join("\n");
}

function buildWorldMutatorUserPrompt(input: PlayWorldMutatorInput, language: "vi" | "en"): string {
  return [
    `turn: ${input.turn}`,
    language === "en" ? "Player's words:" : "Lời người chơi:",
    input.input,
    "",
    language === "en" ? "Action interpretation:" : "Hiểu hành động:",
    JSON.stringify(PlayActionIntentSchema.parse(input.action), null, 2),
    "",
    language === "en" ? "Current context:" : "Ngữ cảnh hiện tại:",
    input.context,
    "",
    language === "en"
      ? "Requirement: use eventId evt-" + input.turn + "; every new or referenced entity id must be stable, readable, and short."
      : "Yêu cầu: sử dụng eventId evt-" + input.turn + "; mọi id thực thể mới hoặc được tham chiếu phải ổn định, dễ đọc, ngắn gọn.",
  ].join("\n");
}

export function buildSceneRendererSystemPrompt(mode: "open" | "guided" = "open", language: "vi" | "en" = "vi"): string {
  const outputLanguage = language === "vi" ? "Vietnamese" : "English";
  const base = [
    "You are an interactive-fiction scene-response author.",
    `Write the scene prose in natural, native ${outputLanguage}.`,
    "Write the response only from the already-applied state; do not overturn the reducer's results.",
    "The scene must visibly carry out every completed part of the player's action recorded in Applied changes before writing its aftermath. Do not skip a requested examination, conversation, movement, or use of an item and jump straight to a reaction or decision point.",
    "The world setting and authoritative pre-action context preserve identity, ownership, relationships, persistent counts, and established facts. Keep them unchanged unless Applied changes explicitly update them.",
    "Concrete new objects, clues, evidence, locations, organizations, or named people can only appear if they are already present in Applied changes or Current state summary. If the prose needs a new concrete thing, it must have been created by the mutator first; otherwise describe mood, pressure, or an unnamed detail instead.",
    "If Current state summary includes a Time section, treat elapsed and anchor as canonical. Render the scene after exactly that elapsed interval, at that resulting world time/phase, and include the synchronized pressure/character movement naturally in prose. Do not invent another clock reading, another elapsed amount, or a fixed tick label.",
    "sceneText is narrative prose only. Choice hints belong only in suggestedActions, never as an A/B/C or bullet menu inside sceneText.",
  ];
  const actionsRule = mode === "guided"
    ? "suggestedActions: give 0-3 as optional springboards ('you could…'), ONLY at a genuine decision point — not every turn. They are hints, not the only way forward; the player can type freely or just stay put at any time."
    : "suggestedActions: 0-3 short hints, optional, never restricting the player's input; omit them when there is no real decision point.";
  return [...base, actionsRule, "Output strict JSON: sceneText, suggestedActions."].join("\n");
}

function buildSceneRendererUserPrompt(input: PlaySceneRenderInput, language: "vi" | "en"): string {
  const premise = input.worldPremise?.trim();
  const context = input.context?.trim();
  return [
    ...(premise ? [language === "en" ? "World setting (always obey):" : "Thiết lập thế giới (luôn tuân thủ):", premise, ""] : []),
    ...(context ? [language === "en" ? "Authoritative context before this action:" : "Ngữ cảnh chuẩn mực trước hành động:", context, ""] : []),
    language === "en" ? "Player's words:" : "Lời người chơi:",
    input.input,
    "",
    language === "en" ? "Action:" : "Hành động:",
    JSON.stringify(PlayActionIntentSchema.parse(input.action), null, 2),
    "",
    language === "en" ? "Applied changes this turn:" : "Các thay đổi đã áp dụng lượt này:",
    input.mutationSummary,
    "",
    language === "en" ? "Current state summary:" : "Tóm tắt trạng thái hiện tại:",
    input.stateBrief,
    input.replayContext ? ["", language === "en" ? "Replay constraints:" : "Ràng buộc phát lại:", input.replayContext].join("\n") : "",
  ].join("\n");
}

function parseJson(raw: string): unknown {
  const trimmed = raw.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("Play agent did not return JSON.");
  }
}
