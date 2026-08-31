import { z } from "zod";

// --- Lenient parsing helpers for free-form LLM JSON ---
// The play pipeline parses raw model output. Treat structural drift as recoverable, not fatal:
// coerce scalars to strings, drop malformed array items, and fall back on bad enums — so a single
// off-shape field never crashes the whole turn. A chat agent should degrade, not hard-error on the
// model's imperfect output.
const coercedString = z.preprocess((v) => {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}, z.string());

function lenientArray<T extends z.ZodTypeAny>(item: T) {
  return z.preprocess(
    (v) => (Array.isArray(v) ? v : []),
    z.array(z.unknown()).transform((arr) =>
      arr.flatMap((entry) => {
        const parsed = item.safeParse(entry);
        return parsed.success ? [parsed.data as z.infer<T>] : [];
      }),
    ),
  );
}

export const PlayActionKindSchema = z.enum(["look", "say", "move", "do", "wait"]);
export type PlayActionKind = z.infer<typeof PlayActionKindSchema>;

export const PlayActionIntentSchema = z.object({
  // Interpreters drift: bad/extra action kinds, null targets, numbers or objects in free-text
  // fields, object-shaped secondary actions. Coerce and tolerate so no off-shape field crashes the turn.
  actionKind: PlayActionKindSchema.catch("do"),
  targetEntityLabel: z.string().nullish().transform((v) => (v && v.trim() ? v : undefined)).catch(undefined),
  targetLocationLabel: z.string().nullish().transform((v) => (v && v.trim() ? v : undefined)).catch(undefined),
  intent: coercedString,
  manner: coercedString,
  risk: coercedString,
  ambiguity: coercedString,
  secondaryActions: lenientArray(z.string()),
});
export type PlayActionIntentInput = z.input<typeof PlayActionIntentSchema>;
export type PlayActionIntent = z.infer<typeof PlayActionIntentSchema>;

export const PlayEntityTypeSchema = z.enum([
  "actor",
  "location",
  "item",
  "evidence",
  "clue",
  "claim",
  "proof_chain",
  "organization",
  "rule",
  "scene",
  "event",
]);
export type PlayEntityType = z.infer<typeof PlayEntityTypeSchema>;

export const PlayEntitySchema = z.object({
  id: z.string().min(1),
  type: PlayEntityTypeSchema,
  label: z.string().min(1),
  summary: z.string().default(""),
  status: z.string().default(""),
  createdEventId: z.string().min(1).optional(),
  updatedEventId: z.string().min(1).optional(),
});
export type PlayEntityInput = z.input<typeof PlayEntitySchema>;
export type PlayEntity = z.infer<typeof PlayEntitySchema>;

export const PlayVisibilitySchema = z.record(z.string(), z.string());
export type PlayVisibility = z.infer<typeof PlayVisibilitySchema>;

export const PlayEdgeSchema = z.object({
  id: z.string().min(1),
  fromId: z.string().min(1),
  type: z.string().min(1),
  toId: z.string().min(1),
  value: z.record(z.string(), z.unknown()).default({}),
  validFromEventId: z.string().min(1),
  validUntilEventId: z.string().min(1).nullable().default(null),
  sourceEventId: z.string().min(1),
  visibility: PlayVisibilitySchema.default({}),
  strength: z.number().finite().optional(),
  confidence: z.number().finite().optional(),
});
export type PlayEdgeInput = z.input<typeof PlayEdgeSchema>;
export type PlayEdge = z.infer<typeof PlayEdgeSchema>;

export const PlayStateSlotKindSchema = z.enum([
  "resource",
  "relation",
  "pressure",
  "clue",
  "evidence",
  "flag",
  "timer",
]);
export type PlayStateSlotKind = z.infer<typeof PlayStateSlotKindSchema>;

export const PlayStateSlotSchema = z.object({
  id: z.string().min(1),
  ownerEntityId: z.string().min(1).nullable().optional(),
  kind: PlayStateSlotKindSchema,
  label: z.string().min(1),
  value: z.unknown(),
  updatedEventId: z.string().min(1),
});
export type PlayStateSlotInput = z.input<typeof PlayStateSlotSchema>;
export type PlayStateSlot = z.infer<typeof PlayStateSlotSchema>;

export const PlayTimeAdvanceSchema = z.object({
  elapsed: coercedString.default(""),
  anchor: coercedString.default(""),
  rationale: coercedString.default(""),
  synchronized: lenientArray(coercedString).default([]),
});
export type PlayTimeAdvanceInput = z.input<typeof PlayTimeAdvanceSchema>;
export type PlayTimeAdvance = z.infer<typeof PlayTimeAdvanceSchema>;

export const PlayEvidenceStatusSchema = z.enum([
  "unknown",
  "hinted",
  "seen",
  "collected",
  "verified",
  "weaponized",
  "exposed",
  "exhausted",
]);
export type PlayEvidenceStatus = z.infer<typeof PlayEvidenceStatusSchema>;

export const PlayEvidenceTransitionSchema = z.object({
  entityId: z.string().min(1),
  from: PlayEvidenceStatusSchema.optional(),
  to: PlayEvidenceStatusSchema,
  reason: z.string().default(""),
});
export type PlayEvidenceTransitionInput = z.input<typeof PlayEvidenceTransitionSchema>;
export type PlayEvidenceTransition = z.infer<typeof PlayEvidenceTransitionSchema>;

export const PlayEventSchema = z.object({
  id: z.string().min(1),
  turn: z.number().int().min(0),
  actionKind: PlayActionKindSchema,
  rawInput: z.string().min(1),
  outcomeSummary: z.string().default(""),
  timeAdvance: z.preprocess(normalizeTimeAdvance, PlayTimeAdvanceSchema.optional()).catch(undefined),
  createdAt: z.string().min(1),
});
export type PlayEventInput = z.input<typeof PlayEventSchema>;
export type PlayEvent = z.infer<typeof PlayEventSchema>;

// Models (especially via OpenAI-compatible gateways) drift the mutation shape: they sometimes
// return a bare array instead of { upsert: [...] } / { transitions: [...] }, emit null for optional
// string fields, and produce individual entities/edges/slots that are incomplete. Normalize the
// container shape, accept null reasons, and parse each item leniently — dropping malformed items
// rather than failing the whole mutation — so one bad item from the model doesn't crash a play turn.
// Models routinely emit a well-formed entity/slot but forget the required `id`
// (they write type+label+summary and skip the boilerplate id). Without this the
// item is silently dropped and the world graph stays empty. Backfill a stable id
// from the label so the model's actual work survives instead of vanishing.
function slugifyId(prefix: string, value: unknown, index: number): string {
  const base = typeof value === "string" ? value.trim().replace(/\s+/g, "_") : "";
  return `${prefix}_${base ? base.slice(0, 30) : `x${index}`}`;
}

function edgeIdFromParts(fromId: unknown, type: unknown, toId: unknown, index: number): string {
  const clean = (value: unknown, fallback: string): string => {
    const text = typeof value === "string" ? value.trim().replace(/\s+/g, "_") : "";
    return text ? text.slice(0, 48) : fallback;
  };
  return [
    "edge",
    clean(fromId, `from${index}`),
    clean(type, "rel"),
    clean(toId, `to${index}`),
  ].join("_");
}

function backfillUpsertIds(container: unknown, prefix: string, labelKey: string): unknown {
  if (!container || typeof container !== "object" || Array.isArray(container)) return container;
  const c = container as Record<string, unknown>;
  if (!Array.isArray(c.upsert)) return c;
  c.upsert = c.upsert.map((item, i) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const obj = item as Record<string, unknown>;
    if (typeof obj.id === "string" && obj.id.trim().length > 0) return obj;
    return { ...obj, id: slugifyId(prefix, obj[labelKey], i) };
  });
  return c;
}

// Edges additionally require temporal bookkeeping (validFromEventId / sourceEventId)
// that the model writes the relationship (from/type/to) but routinely omits — so
// every proposed relationship got dropped and never reached the panel. Backfill the
// id and the two event refs from this turn's event so the relationship survives.
// Map each entity's label AND id to its id, so an edge can reference an endpoint
// by the entity's name (the model's natural choice) and still resolve.
function buildLabelToId(entities: unknown): Map<string, string> {
  const map = new Map<string, string>();
  const c = entities as { upsert?: unknown };
  if (!Array.isArray(c?.upsert)) return map;
  for (const item of c.upsert) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    const label = typeof o.label === "string" ? o.label.trim() : "";
    if (!id) continue;
    map.set(id, id);
    if (label) map.set(label, id);
  }
  return map;
}

// Alternate keys models routinely use for relationships instead of the schema's
// fromId/type/toId. Mapping them rescues edges that would otherwise be dropped.
const EDGE_KEY_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ["from", "fromId"], ["source", "fromId"], ["subject", "fromId"],
  ["to", "toId"], ["target", "toId"], ["object", "toId"],
  ["relation", "type"], ["rel", "type"], ["kind", "type"], ["relationship", "type"],
];

function isLowInformationEdgeId(id: unknown, type: unknown): boolean {
  if (typeof id !== "string") return true;
  const edgeId = id.trim();
  if (!edgeId) return true;
  const relationType = typeof type === "string" ? type.trim().replace(/\s+/g, "_") : "";
  return relationType ? edgeId === `edge_${relationType}` : edgeId === "edge";
}

function backfillEdges(container: unknown, eventId: string, labelToId: Map<string, string>): unknown {
  if (!container || typeof container !== "object" || Array.isArray(container)) return container;
  const c = container as Record<string, unknown>;
  if (!Array.isArray(c.upsert)) return c;
  const hasText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
  const resolve = (v: unknown): unknown => (hasText(v) && labelToId.has(v.trim()) ? labelToId.get(v.trim()) : v);
  c.upsert = c.upsert.map((item, i) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const o = { ...(item as Record<string, unknown>) };
    for (const [alias, canonical] of EDGE_KEY_ALIASES) {
      if (!hasText(o[canonical]) && hasText(o[alias])) o[canonical] = o[alias];
    }
    // Endpoints given by entity label (or id) resolve to the entity's id.
    o.fromId = resolve(o.fromId);
    o.toId = resolve(o.toId);
    if (!hasText(o.validFromEventId)) o.validFromEventId = eventId;
    if (!hasText(o.sourceEventId)) o.sourceEventId = eventId;
    // Relationship identity is host-owned when the model omits an id or emits a
    // Core narrative engine processing.
    // one turn overwrite each other in file storage.
    if (isLowInformationEdgeId(o.id, o.type)) {
      o.id = edgeIdFromParts(o.fromId, o.type, o.toId, i);
    }
    return o;
  });
  return c;
}

function normalizePlayMutation(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const v = { ...(value as Record<string, unknown>) };
  if (Array.isArray(v.entities)) v.entities = { upsert: v.entities };
  if (Array.isArray(v.edges)) v.edges = { upsert: v.edges };
  if (Array.isArray(v.stateSlots)) v.stateSlots = { upsert: v.stateSlots };
  if (Array.isArray(v.evidence)) v.evidence = { transitions: v.evidence };
  if (typeof v.notes === "string") v.notes = v.notes.trim() ? [v.notes] : [];
  if (v.timeAdvance === undefined && v.time !== undefined) v.timeAdvance = v.time;
  v.timeAdvance = normalizeTimeAdvance(v.timeAdvance);
  const turn = typeof v.turn === "number" && Number.isInteger(v.turn) && v.turn >= 0
    ? v.turn
    : typeof v.turn === "string" && /^\d+$/.test(v.turn.trim()) && Number(v.turn.trim()) >= 0
      ? Number(v.turn.trim())
      : undefined;
  const eventId = typeof v.eventId === "string" && v.eventId.trim()
    ? v.eventId
    : turn !== undefined
      ? `evt-${turn}`
      : "";
  v.eventId = eventId;
  v.entities = backfillUpsertIds(v.entities, "ent", "label");
  v.stateSlots = backfillUpsertIds(v.stateSlots, "slot", "label");
  v.edges = backfillEdges(v.edges, eventId || "evt-0", buildLabelToId(v.entities));
  return v;
}

function normalizeTimeAdvance(value: unknown): unknown {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return { elapsed: String(value) };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = { ...raw };
  if (normalized.elapsed === undefined) {
    normalized.elapsed = raw.duration ?? raw.delta ?? raw.timePassed ?? raw.passed ?? raw.label;
  }
  if (normalized.anchor === undefined) {
    normalized.anchor = raw.now ?? raw.current ?? raw.currentTime ?? raw.worldTime ?? raw.phase ?? raw.clock ?? raw.at;
  }
  if (normalized.rationale === undefined) {
    normalized.rationale = raw.reason ?? raw.why ?? raw.because;
  }
  if (normalized.synchronized === undefined) {
    normalized.synchronized = raw.worldChanges ?? raw.concurrent ?? raw.simultaneous ?? raw.offscreen;
  }
  if (typeof normalized.synchronized === "string") {
    normalized.synchronized = normalized.synchronized.trim() ? [normalized.synchronized] : [];
  }
  return normalized;
}

const PlayEdgeExpireSchema = z.object({
  edgeId: z.string().min(1),
  validUntilEventId: z.string().min(1),
  reason: z.string().default(""),
});

// Every field is .catch-guarded so a single off-shape field degrades to its default instead of
// throwing and crashing the whole turn (fail-open, not fail-closed).
export const PlayMutationSchema = z.preprocess(normalizePlayMutation, z.object({
  eventId: z.string().min(1).catch(""),
  turn: z.coerce.number().int().min(0).catch(0),
  actionKind: PlayActionKindSchema.catch("do"),
  summary: coercedString.catch(""),
  timeAdvance: z.preprocess(normalizeTimeAdvance, PlayTimeAdvanceSchema.optional()).catch(undefined),
  entities: z.object({ upsert: lenientArray(PlayEntitySchema) }).catch({ upsert: [] }),
  edges: z.object({
    upsert: lenientArray(PlayEdgeSchema),
    expire: lenientArray(PlayEdgeExpireSchema),
  }).catch({ upsert: [], expire: [] }),
  stateSlots: z.object({ upsert: lenientArray(PlayStateSlotSchema) }).catch({ upsert: [] }),
  evidence: z.object({ transitions: lenientArray(PlayEvidenceTransitionSchema) }).catch({ transitions: [] }),
  blocked: z.boolean().catch(false),
  blockedReason: coercedString.catch(""),
  notes: lenientArray(coercedString).catch([]),
}));
export type PlayMutationInput = z.input<typeof PlayMutationSchema>;
export type PlayMutation = z.infer<typeof PlayMutationSchema>;
