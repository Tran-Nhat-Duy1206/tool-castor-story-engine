import { z } from "zod";
import { readFile, readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  AuthorDecisionKindSchema,
  AuthorizationConsumptionSchema,
  AuthorizationLifecycleSchema,
  HumanDirectionLifecycleSchema,
  HookLifecycleStateSchema,
  SafeGovernanceIdSchema,
  type AuthorDecisionKind,
  type AuthorizationConsumption,
  type HookLifecycleState,
  type SafeGovernanceId,
} from "./contracts.js";
import { readCurrentCanonRevision } from "./conflicts.js";
import { StateManager } from "../state/manager.js";
import { commitAtomicFileSet, type AtomicFileWrite } from "../utils/atomic-file-set.js";

// ===========================================================================
// Phase 5 Task 11 — durable scoped Human authority.
//
// Proposal/pending records are deliberately non-executable. Only explicit
// Human confirmation under the existing Castor book lock can create ACTIVE
// authority. Scope evaluation is shared and pure. This module exposes no
// ACTIVE -> CONSUMED persistence API; Task 20 Canon settlement owns that edge.
// ===========================================================================

const PositiveChapterSchema = z.number().int().min(1);
const NonEmptyTextSchema = z.string().trim().min(1).max(20_000);
const LifecycleRevisionSchema = z.string().regex(/^\d+$/);

export const AuthorizationConditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("after_hook_advanced"), hookId: SafeGovernanceIdSchema }).strict(),
  z.object({ kind: z.literal("after_hook_resolved"), hookId: SafeGovernanceIdSchema }).strict(),
  z.object({ kind: z.literal("after_arc_started"), arcId: SafeGovernanceIdSchema }).strict(),
  z.object({ kind: z.literal("after_arc_climax"), arcId: SafeGovernanceIdSchema }).strict(),
  z.object({ kind: z.literal("after_chapter"), chapterNumber: PositiveChapterSchema }).strict(),
  z.object({
    kind: z.literal("after_relationship_state"),
    relationshipId: SafeGovernanceIdSchema,
    state: z.string().trim().min(1).max(256),
  }).strict(),
  z.object({ kind: z.literal("after_fact_exists"), factKey: z.string().trim().min(1).max(256) }).strict(),
]);
export type AuthorizationCondition = z.infer<typeof AuthorizationConditionSchema>;

const ChapterWindowSchema = z.object({
  kind: z.literal("chapter_window"),
  startChapter: PositiveChapterSchema,
  endChapter: PositiveChapterSchema,
}).strict();

export const AuthorizationScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("exact_chapter"), chapterNumber: PositiveChapterSchema }).strict(),
  ChapterWindowSchema,
  z.object({ kind: z.literal("arc"), arcId: SafeGovernanceIdSchema }).strict(),
  z.object({ kind: z.literal("condition"), condition: AuthorizationConditionSchema }).strict(),
  z.object({
    kind: z.literal("from_arc"),
    sourceArcId: SafeGovernanceIdSchema,
    targetArcId: SafeGovernanceIdSchema,
  }).strict(),
]).superRefine((value, ctx) => {
  if (value.kind === "chapter_window" && value.startChapter > value.endChapter) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "chapter_window startChapter must be <= endChapter" });
  }
  if (value.kind === "from_arc" && value.sourceArcId === value.targetArcId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "from_arc sourceArcId and targetArcId must differ" });
  }
});
export type AuthorizationScope = z.infer<typeof AuthorizationScopeSchema>;

const AuthorizationRecordObjectSchema = z.object({
  authorizationId: SafeGovernanceIdSchema,
  decisionKind: AuthorDecisionKindSchema,
  scope: AuthorizationScopeSchema,
  consumption: AuthorizationConsumptionSchema,
  createdAt: z.string().datetime(),
  lifecycle: AuthorizationLifecycleSchema,
  lifecycleRevision: LifecycleRevisionSchema,
  confirmedAt: z.string().datetime().optional(),
  confirmedBy: z.string().min(1).optional(),
  consumedAt: z.string().datetime().optional(),
  consumedCanonRevision: z.number().int().min(0).optional(),
  expiredAt: z.string().datetime().optional(),
  cancelledAt: z.string().datetime().optional(),
  cancelledBy: z.string().min(1).optional(),
}).strict();

export const AuthorizationRecordSchema = AuthorizationRecordObjectSchema.superRefine((record, ctx) => {
  if (record.lifecycle === "active" || record.lifecycle === "consumed") {
    if (!record.confirmedAt || !record.confirmedBy) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${record.lifecycle} authorization requires confirmation provenance` });
    }
  }
  if (record.lifecycle === "consumed" && (!record.consumedAt || record.consumedCanonRevision === undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "consumed authorization requires consumedAt and consumedCanonRevision" });
  }
  if (record.lifecycle === "expired" && !record.expiredAt) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "expired authorization requires expiredAt" });
  }
  if (record.lifecycle === "cancelled" && !record.cancelledAt) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "cancelled authorization requires cancelledAt" });
  }
});
export type AuthorizationRecord = z.infer<typeof AuthorizationRecordSchema>;
export type PendingAuthorization = AuthorizationRecord & { readonly lifecycle: "pending" };
export type ActiveAuthorization = AuthorizationRecord & { readonly lifecycle: "active" };
export type TerminalAuthorization = AuthorizationRecord & { readonly lifecycle: "consumed" | "expired" | "cancelled" };

const ActiveAuthorizationSchema = AuthorizationRecordObjectSchema.extend({
  lifecycle: z.literal("active"),
  confirmedAt: z.string().datetime(),
  confirmedBy: z.string().min(1),
}).strict();

export const HumanDirectionScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("exact_chapter"), chapterNumber: PositiveChapterSchema }).strict(),
  ChapterWindowSchema,
  z.object({ kind: z.literal("arc"), arcId: SafeGovernanceIdSchema }).strict(),
  z.object({ kind: z.literal("until_condition"), condition: AuthorizationConditionSchema }).strict(),
]);
export type HumanDirectionScope = z.infer<typeof HumanDirectionScopeSchema>;

export const HumanDirectionRecordSchema = z.object({
  directionId: SafeGovernanceIdSchema,
  text: NonEmptyTextSchema,
  scope: HumanDirectionScopeSchema,
  lifecycle: z.union([z.literal("pending"), HumanDirectionLifecycleSchema]),
  lifecycleRevision: LifecycleRevisionSchema,
  createdAt: z.string().datetime(),
  confirmedAt: z.string().datetime().optional(),
  confirmedBy: z.string().min(1).optional(),
  resolvedAt: z.string().datetime().optional(),
  supersededBy: SafeGovernanceIdSchema.optional(),
  satisfiedAt: z.string().datetime().optional(),
  unsatisfiedAt: z.string().datetime().optional(),
  expiredAt: z.string().datetime().optional(),
  cancelledAt: z.string().datetime().optional(),
}).strict().superRefine((record, ctx) => {
  if (record.lifecycle === "active" && (!record.confirmedAt || !record.confirmedBy)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "active Human Direction requires confirmation provenance" });
  }
  if (record.lifecycle === "superseded" && !record.resolvedAt) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "superseded Human Direction requires resolvedAt" });
  }
});
export type HumanDirectionRecord = z.infer<typeof HumanDirectionRecordSchema>;
export type PendingHumanDirection = HumanDirectionRecord & { readonly lifecycle: "pending" };
export type ActiveHumanDirection = HumanDirectionRecord & { readonly lifecycle: "active" };

const ActiveHumanDirectionSchema = z.object({
  directionId: SafeGovernanceIdSchema,
  text: NonEmptyTextSchema,
  scope: HumanDirectionScopeSchema,
  lifecycle: z.literal("active"),
  lifecycleRevision: LifecycleRevisionSchema,
  createdAt: z.string().datetime(),
  confirmedAt: z.string().datetime(),
  confirmedBy: z.string().min(1),
  resolvedAt: z.string().datetime().optional(),
  supersededBy: SafeGovernanceIdSchema.optional(),
  satisfiedAt: z.string().datetime().optional(),
  unsatisfiedAt: z.string().datetime().optional(),
  expiredAt: z.string().datetime().optional(),
  cancelledAt: z.string().datetime().optional(),
}).strict();

export const PendingHumanDirectionProposalSchema = z.object({
  directionId: SafeGovernanceIdSchema,
  text: NonEmptyTextSchema,
  proposedScope: HumanDirectionScopeSchema,
  confidence: z.enum(["high", "medium", "low"]),
  unresolved: z.array(z.string().min(1).max(512)),
  createdAt: z.string().datetime(),
  baseCanonRevision: z.number().int().min(0),
  baseArcPlanVersion: z.number().int().min(1).nullable(),
}).strict();
export type PendingHumanDirectionProposal = z.infer<typeof PendingHumanDirectionProposalSchema>;

export interface AuthorizationEvaluationContext {
  readonly chapterNumber: number;
  readonly currentArcId: string;
  readonly canonRevision: number;
  readonly hookStates: (hookId: string) => {
    readonly lifecycleState: HookLifecycleState;
    readonly lifecycleRevision: string;
  };
  readonly relationshipStates: (relationshipId: string) => {
    readonly state: string;
    readonly stateRevision: string;
  };
  readonly factResolver: (factKey: string) => {
    readonly exists: boolean;
    readonly canonRevision: number;
  };
  readonly arcState: (arcId: string) => {
    readonly status: "not_started" | "started" | "climaxed" | "closed";
    readonly revision: string;
  };
}

export interface CanonSettlementEvidence {
  readonly context: AuthorizationEvaluationContext;
  readonly decisionKinds: ReadonlyArray<AuthorDecisionKind>;
}

export interface AuthorizationConsumptionReview {
  readonly reviewId: SafeGovernanceId;
  readonly status: "active";
  readonly authorizationIds: ReadonlyArray<SafeGovernanceId>;
}

const DirectionConflictChoiceSchema = z.enum(["override", "replace", "keep", "edit"]);
export type DirectionConflictChoice = z.infer<typeof DirectionConflictChoiceSchema>;

const DirectionConflictResolutionSchema = z.object({
  resolutionId: SafeGovernanceIdSchema,
  directionIds: z.array(SafeGovernanceIdSchema).min(2),
  choice: DirectionConflictChoiceSchema,
  chosenDirectionId: SafeGovernanceIdSchema.nullable(),
  resolvedBy: z.string().min(1),
  resolvedAt: z.string().datetime(),
}).strict();

function governanceRoot(bookDir: string): string {
  return join(bookDir, "story", "governance");
}
function authorizationRelPath(id: string): string {
  return join("story", "governance", "authorizations", `${SafeGovernanceIdSchema.parse(id)}.gov.json`);
}
function directionRelPath(id: string): string {
  return join("story", "governance", "human-directions", `${SafeGovernanceIdSchema.parse(id)}.gov.json`);
}
function proposalRelPath(id: string): string {
  return join("story", "governance", "human-direction-proposals", `${SafeGovernanceIdSchema.parse(id)}.gov.json`);
}
function conflictRelPath(id: string): string {
  return join("story", "governance", "direction-conflicts", `${SafeGovernanceIdSchema.parse(id)}.gov.json`);
}
function absoluteFromRel(bookDir: string, relPath: string): string {
  return join(bookDir, relPath);
}
function serialized(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
function nextLifecycleRevision(current: string): string {
  const parsed = Number.parseInt(LifecycleRevisionSchema.parse(current), 10);
  if (!Number.isSafeInteger(parsed)) throw new Error(`Invalid lifecycleRevision: ${current}`);
  return String(parsed + 1);
}
function validateHumanActor(humanActor: string): void {
  if (typeof humanActor !== "string" || humanActor.trim().length === 0) {
    throw new Error("Explicit non-empty humanActor is required");
  }
}
async function readJson(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
async function writeOne(bookDir: string, relativePath: string, value: unknown): Promise<void> {
  await commitAtomicFileSet({ rootDir: bookDir, writes: [{ relativePath, content: serialized(value) }] });
}

async function withBookLock<T>(bookDir: string, operation: () => Promise<T>): Promise<T> {
  const projectRoot = resolve(bookDir, "..", "..");
  const bookId = basename(bookDir);
  const manager = new StateManager(projectRoot);
  const release = await manager.acquireBookLock(bookId);
  try {
    return await operation();
  } finally {
    await release();
  }
}

export async function loadAuthorization(bookDir: string, authorizationId: string): Promise<AuthorizationRecord | null> {
  const raw = await readJson(absoluteFromRel(bookDir, authorizationRelPath(authorizationId)));
  return raw === null ? null : AuthorizationRecordSchema.parse(raw);
}

export async function createAuthorization(
  bookDir: string,
  input: {
    readonly decisionKind: AuthorDecisionKind;
    readonly scope: AuthorizationScope;
    readonly consumption: AuthorizationConsumption;
  },
): Promise<PendingAuthorization> {
  const validated = z.object({
    decisionKind: AuthorDecisionKindSchema,
    scope: AuthorizationScopeSchema,
    consumption: AuthorizationConsumptionSchema,
  }).strict().parse(input);
  const record = AuthorizationRecordSchema.parse({
    authorizationId: `authorization-${randomUUID()}`,
    ...validated,
    createdAt: new Date().toISOString(),
    lifecycle: "pending",
    lifecycleRevision: "1",
  }) as PendingAuthorization;
  await writeOne(bookDir, authorizationRelPath(record.authorizationId), record);
  return record;
}

export async function confirmAuthorization(
  bookDir: string,
  authorizationId: string,
  humanActor: string,
): Promise<ActiveAuthorization> {
  validateHumanActor(humanActor);
  const safeId = SafeGovernanceIdSchema.parse(authorizationId);
  return withBookLock(bookDir, async () => {
    const current = await loadAuthorization(bookDir, safeId);
    if (!current) throw new Error(`Authorization ${safeId} not found`);
    if (current.lifecycle !== "pending") {
      throw new Error(`Authorization ${safeId} must be pending, found ${current.lifecycle}`);
    }
    const active = AuthorizationRecordSchema.parse({
      ...current,
      lifecycle: "active",
      lifecycleRevision: nextLifecycleRevision(current.lifecycleRevision),
      confirmedAt: new Date().toISOString(),
      confirmedBy: humanActor,
    }) as ActiveAuthorization;
    await writeOne(bookDir, authorizationRelPath(safeId), active);
    return active;
  });
}

export async function cancelAuthorization(
  bookDir: string,
  authorizationId: string,
  humanActor: string,
): Promise<TerminalAuthorization & { readonly lifecycle: "cancelled"; readonly cancelledBy: string }> {
  validateHumanActor(humanActor);
  const safeId = SafeGovernanceIdSchema.parse(authorizationId);
  return withBookLock(bookDir, async () => {
    const current = await loadAuthorization(bookDir, safeId);
    if (!current) throw new Error(`Authorization ${safeId} not found`);
    if (current.lifecycle !== "pending" && current.lifecycle !== "active") {
      throw new Error(`Authorization ${safeId} cannot be cancelled from ${current.lifecycle}`);
    }
    const cancelled = AuthorizationRecordSchema.parse({
      ...current,
      lifecycle: "cancelled",
      lifecycleRevision: nextLifecycleRevision(current.lifecycleRevision),
      cancelledAt: new Date().toISOString(),
      cancelledBy: humanActor,
    }) as TerminalAuthorization & { readonly lifecycle: "cancelled"; readonly cancelledBy: string };
    await writeOne(bookDir, authorizationRelPath(safeId), cancelled);
    return cancelled;
  });
}

function assertNever(value: never): never {
  throw new Error(`Unsupported governance variant: ${JSON.stringify(value)}`);
}

function conditionSatisfied(condition: AuthorizationCondition, context: AuthorizationEvaluationContext): boolean {
  switch (condition.kind) {
    case "after_hook_advanced": {
      const state = context.hookStates(condition.hookId).lifecycleState;
      return state === "advanced" || state === "ready_for_payoff" || state === "resolved";
    }
    case "after_hook_resolved":
      return context.hookStates(condition.hookId).lifecycleState === "resolved";
    case "after_arc_started": {
      const status = context.arcState(condition.arcId).status;
      return status === "started" || status === "climaxed" || status === "closed";
    }
    case "after_arc_climax": {
      const status = context.arcState(condition.arcId).status;
      return status === "climaxed" || status === "closed";
    }
    case "after_chapter":
      return context.canonRevision >= condition.chapterNumber && context.chapterNumber > condition.chapterNumber;
    case "after_relationship_state":
      return context.relationshipStates(condition.relationshipId).state === condition.state;
    case "after_fact_exists": {
      const fact = context.factResolver(condition.factKey);
      return fact.exists && fact.canonRevision <= context.canonRevision;
    }
    default: return assertNever(condition);
  }
}

function authorizationScopeApplies(scope: AuthorizationScope, context: AuthorizationEvaluationContext): boolean {
  switch (scope.kind) {
    case "exact_chapter": return context.chapterNumber === scope.chapterNumber;
    case "chapter_window": return context.chapterNumber >= scope.startChapter && context.chapterNumber <= scope.endChapter;
    case "arc": return context.currentArcId === scope.arcId;
    case "condition": return conditionSatisfied(scope.condition, context);
    case "from_arc": {
      const sourceStatus = context.arcState(scope.sourceArcId).status;
      return context.currentArcId === scope.targetArcId && (sourceStatus === "climaxed" || sourceStatus === "closed");
    }
    default: return assertNever(scope);
  }
}

export function authorizationApplies(
  authorization: ActiveAuthorization,
  evaluationContext: AuthorizationEvaluationContext,
): boolean {
  const active = ActiveAuthorizationSchema.safeParse(authorization);
  if (!active.success) throw new Error("authorizationApplies requires active authorization authority");
  return authorizationScopeApplies(active.data.scope, evaluationContext);
}

export function directionApplies(
  direction: HumanDirectionRecord & { readonly lifecycle: "active" },
  evaluationContext: AuthorizationEvaluationContext,
): boolean {
  const active = ActiveHumanDirectionSchema.safeParse(direction);
  if (!active.success) throw new Error("directionApplies requires active Human Direction authority");
  switch (active.data.scope.kind) {
    case "exact_chapter": return evaluationContext.chapterNumber === active.data.scope.chapterNumber;
    case "chapter_window": return evaluationContext.chapterNumber >= active.data.scope.startChapter
      && evaluationContext.chapterNumber <= active.data.scope.endChapter;
    case "arc": return evaluationContext.currentArcId === active.data.scope.arcId;
    case "until_condition": return !conditionSatisfied(active.data.scope.condition, evaluationContext);
    default: return assertNever(active.data.scope);
  }
}

export function evaluateAuthorizationAgainstEvidence(
  authorization: ActiveAuthorization,
  evidence: CanonSettlementEvidence,
): { readonly matches: boolean; readonly reason: string } {
  const active = ActiveAuthorizationSchema.safeParse(authorization);
  if (!active.success) throw new Error("Evidence evaluation requires active authorization authority");
  if (!evidence.decisionKinds.includes(active.data.decisionKind)) {
    return { matches: false, reason: "decision_kind_not_observed" };
  }
  if (!authorizationScopeApplies(active.data.scope, evidence.context)) {
    return { matches: false, reason: "scope_not_satisfied" };
  }
  return { matches: true, reason: "scope_and_decision_match" };
}

export function deriveEligibleAuthorizationConsumption(
  authorizations: ReadonlyArray<ActiveAuthorization>,
  finalizedReview: AuthorizationConsumptionReview,
  evidence: CanonSettlementEvidence,
): ReadonlyArray<{ readonly authorizationId: string; readonly decisionKind: AuthorDecisionKind }> {
  if (finalizedReview.status !== "active") throw new Error("Consumption eligibility requires an active finalized review artifact");
  const allowed = new Set(finalizedReview.authorizationIds);
  return authorizations
    .filter((authorization) => allowed.has(authorization.authorizationId))
    .filter((authorization) => authorization.consumption === "one_time")
    .filter((authorization) => evaluateAuthorizationAgainstEvidence(authorization, evidence).matches)
    .map((authorization) => ({ authorizationId: authorization.authorizationId, decisionKind: authorization.decisionKind }));
}

export async function loadHumanDirection(bookDir: string, directionId: string): Promise<HumanDirectionRecord | null> {
  const raw = await readJson(absoluteFromRel(bookDir, directionRelPath(directionId)));
  return raw === null ? null : HumanDirectionRecordSchema.parse(raw);
}

export async function createHumanDirection(
  bookDir: string,
  draft: { readonly text: string; readonly scope: HumanDirectionScope },
): Promise<PendingHumanDirection> {
  const validated = z.object({ text: NonEmptyTextSchema, scope: HumanDirectionScopeSchema }).strict().parse(draft);
  const record = HumanDirectionRecordSchema.parse({
    directionId: `direction-${randomUUID()}`,
    text: validated.text,
    scope: validated.scope,
    lifecycle: "pending",
    lifecycleRevision: "1",
    createdAt: new Date().toISOString(),
  }) as PendingHumanDirection;
  await writeOne(bookDir, directionRelPath(record.directionId), record);
  return record;
}

export async function loadPendingHumanDirectionProposal(
  bookDir: string,
  directionId: string,
): Promise<PendingHumanDirectionProposal | null> {
  const raw = await readJson(absoluteFromRel(bookDir, proposalRelPath(directionId)));
  return raw === null ? null : PendingHumanDirectionProposalSchema.parse(raw);
}

async function listHumanDirections(bookDir: string): Promise<ReadonlyArray<HumanDirectionRecord>> {
  const root = join(governanceRoot(bookDir), "human-directions");
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const records: HumanDirectionRecord[] = [];
  for (const entry of entries.filter((item) => item.endsWith(".gov.json"))) {
    const raw = await readJson(join(root, entry));
    if (raw !== null) records.push(HumanDirectionRecordSchema.parse(raw));
  }
  return records;
}

function intervalForScope(scope: HumanDirectionScope): { start: number; end: number } | null {
  if (scope.kind === "exact_chapter") return { start: scope.chapterNumber, end: scope.chapterNumber };
  if (scope.kind === "chapter_window") return { start: scope.startChapter, end: scope.endChapter };
  return null;
}

function directionScopesConflict(left: HumanDirectionScope, right: HumanDirectionScope): boolean {
  const leftInterval = intervalForScope(left);
  const rightInterval = intervalForScope(right);
  if (leftInterval && rightInterval) {
    return leftInterval.start <= rightInterval.end && rightInterval.start <= leftInterval.end;
  }
  if (left.kind === "arc" && right.kind === "arc") return left.arcId === right.arcId;
  if (left.kind === "until_condition" && right.kind === "until_condition") {
    return JSON.stringify(left.condition) === JSON.stringify(right.condition);
  }
  // Cross-kind semantic overlap cannot be proven here; do not invent a hard
  // conflict. Higher-level deterministic Planning validation may surface one.
  return false;
}

async function readCurrentArcPlanVersion(bookDir: string): Promise<number | null> {
  const root = join(governanceRoot(bookDir), "versions", "arc_plan");
  const unitDirs = await readdir(root, { withFileTypes: true }).catch(() => []);
  const versions: number[] = [];
  for (const unitDir of unitDirs) {
    if (!unitDir.isDirectory()) continue;
    const raw = await readJson(join(root, unitDir.name, "current.json"));
    if (raw && typeof raw === "object" && typeof (raw as { version?: unknown }).version === "number") {
      versions.push((raw as { version: number }).version);
    }
  }
  return versions.length > 0 ? Math.max(...versions) : null;
}

function parseDirectionScope(text: string, canonRevision: number): {
  scope: HumanDirectionScope;
  confidence: "high" | "medium" | "low";
  unresolved: string[];
} {
  const window = /(?:chapters?|ch(?:apters?)?)\s*(\d+)\s*(?:-|–|to|through)\s*(\d+)/i.exec(text)
    ?? /Chương \s*(\d+)\s*(?:-||)\s*(\d+)\s*/u.exec(text);
  if (window) {
    const scope = HumanDirectionScopeSchema.parse({
      kind: "chapter_window",
      startChapter: Number(window[1]),
      endChapter: Number(window[2]),
    });
    return { scope, confidence: "high", unresolved: [] };
  }
  const exact = /(?:chapter|ch)\s*(\d+)/i.exec(text) ?? /Chương \s*(\d+)\s*/u.exec(text);
  if (exact) {
    return {
      scope: { kind: "exact_chapter", chapterNumber: Number(exact[1]) },
      confidence: "high",
      unresolved: [],
    };
  }
  const untilChapter = /until\s+(?:after\s+)?chapter\s*(\d+)/i.exec(text);
  if (untilChapter) {
    return {
      scope: { kind: "until_condition", condition: { kind: "after_chapter", chapterNumber: Number(untilChapter[1]) } },
      confidence: "medium",
      unresolved: [],
    };
  }
  const arc = /\barc\s+([a-z0-9][a-z0-9._-]*)/i.exec(text);
  if (arc) {
    return {
      scope: { kind: "arc", arcId: SafeGovernanceIdSchema.parse(arc[1]!.toLowerCase()) },
      confidence: "medium",
      unresolved: [],
    };
  }
  return {
    scope: { kind: "exact_chapter", chapterNumber: Math.max(1, canonRevision + 1) },
    confidence: "low",
    unresolved: ["Direction scope could not be determined; Human must edit or clarify it before confirmation"],
  };
}

export async function parseHumanDirectionDraft(
  bookDir: string,
  text: string,
  currentContext: { readonly canonRevision: number; readonly arcPlanVersion: number | null },
): Promise<PendingHumanDirectionProposal> {
  const validText = NonEmptyTextSchema.parse(text);
  const baseContext = z.object({
    canonRevision: z.number().int().min(0),
    arcPlanVersion: z.number().int().min(1).nullable(),
  }).strict().parse(currentContext);
  const parsed = parseDirectionScope(validText, baseContext.canonRevision);
  const proposal = PendingHumanDirectionProposalSchema.parse({
    directionId: `direction-${randomUUID()}`,
    text: validText,
    proposedScope: parsed.scope,
    confidence: parsed.confidence,
    unresolved: parsed.unresolved,
    createdAt: new Date().toISOString(),
    baseCanonRevision: baseContext.canonRevision,
    baseArcPlanVersion: baseContext.arcPlanVersion,
  });
  await writeOne(bookDir, proposalRelPath(proposal.directionId), proposal);
  return proposal;
}

export async function confirmHumanDirection(
  bookDir: string,
  directionId: string,
  humanActor: string,
): Promise<ActiveHumanDirection> {
  validateHumanActor(humanActor);
  const safeId = SafeGovernanceIdSchema.parse(directionId);
  return withBookLock(bookDir, async () => {
    const pendingRecord = await loadHumanDirection(bookDir, safeId);
    let base: PendingHumanDirection;
    if (pendingRecord !== null) {
      if (pendingRecord.lifecycle !== "pending") {
        throw new Error(`Human Direction ${safeId} must be pending, found ${pendingRecord.lifecycle}`);
      }
      base = pendingRecord as PendingHumanDirection;
    } else {
      const proposal = await loadPendingHumanDirectionProposal(bookDir, safeId);
      if (!proposal) throw new Error(`Human Direction proposal ${safeId} not found`);
      if (proposal.unresolved.length > 0) {
        throw new Error(`Human Direction proposal ${safeId} has unresolved scope: ${proposal.unresolved.join("; ")}`);
      }
      const [currentCanonRevision, currentArcPlanVersion] = await Promise.all([
        readCurrentCanonRevision(bookDir),
        readCurrentArcPlanVersion(bookDir),
      ]);
      if (proposal.baseCanonRevision !== currentCanonRevision
        || proposal.baseArcPlanVersion !== currentArcPlanVersion) {
        throw new Error(`Human Direction proposal ${safeId} is stale against current authority context`);
      }
      base = HumanDirectionRecordSchema.parse({
        directionId: proposal.directionId,
        text: proposal.text,
        scope: proposal.proposedScope,
        lifecycle: "pending",
        lifecycleRevision: "1",
        createdAt: proposal.createdAt,
      }) as PendingHumanDirection;
    }

    const activeDirections = (await listHumanDirections(bookDir))
      .filter((record): record is ActiveHumanDirection => record.lifecycle === "active");
    const conflict = activeDirections.find((record) => directionScopesConflict(record.scope, base.scope));
    if (conflict) {
      throw new Error(`Human Direction ${safeId} conflicts with active direction ${conflict.directionId}; explicit resolution required`);
    }

    const active = HumanDirectionRecordSchema.parse({
      ...base,
      lifecycle: "active",
      lifecycleRevision: nextLifecycleRevision(base.lifecycleRevision),
      confirmedAt: new Date().toISOString(),
      confirmedBy: humanActor,
    }) as ActiveHumanDirection;
    await writeOne(bookDir, directionRelPath(safeId), active);
    return active;
  });
}

export async function resolveDirectionConflict(
  bookDir: string,
  directionIds: ReadonlyArray<string>,
  choice: DirectionConflictChoice,
  humanActor: string,
): Promise<void> {
  validateHumanActor(humanActor);
  const ids = [...new Set(directionIds.map((id) => SafeGovernanceIdSchema.parse(id)))];
  if (ids.length < 2) throw new Error("Direction conflict resolution requires at least two distinct ids");
  const validChoice = DirectionConflictChoiceSchema.parse(choice);

  await withBookLock(bookDir, async () => {
    const records: ActiveHumanDirection[] = [];
    for (const id of ids) {
      const record = await loadHumanDirection(bookDir, id);
      if (!record) throw new Error(`Human Direction ${id} not found`);
      if (record.lifecycle !== "active") throw new Error(`Conflict resolution requires active direction ${id}`);
      records.push(record as ActiveHumanDirection);
    }
    if (!records.some((left, index) => records.slice(index + 1).some((right) => directionScopesConflict(left.scope, right.scope)))) {
      throw new Error("Provided Human Directions do not have a deterministic scope conflict");
    }

    const now = new Date().toISOString();
    const resolutionId = `direction-resolution-${randomUUID()}`;
    const chosenDirectionId = validChoice === "override"
      ? ids[0]!
      : validChoice === "replace"
        ? ids[ids.length - 1]!
        : null;
    const writes: AtomicFileWrite[] = [];
    if (validChoice !== "keep") {
      for (const record of records) {
        if (chosenDirectionId && record.directionId === chosenDirectionId) continue;
        const superseded = HumanDirectionRecordSchema.parse({
          ...record,
          lifecycle: "superseded",
          lifecycleRevision: nextLifecycleRevision(record.lifecycleRevision),
          resolvedAt: now,
          ...(chosenDirectionId ? { supersededBy: chosenDirectionId } : {}),
        });
        writes.push({ relativePath: directionRelPath(record.directionId), content: serialized(superseded) });
      }
    }
    const resolution = DirectionConflictResolutionSchema.parse({
      resolutionId,
      directionIds: ids,
      choice: validChoice,
      chosenDirectionId,
      resolvedBy: humanActor,
      resolvedAt: now,
    });
    writes.push({ relativePath: conflictRelPath(resolutionId), content: serialized(resolution) });
    await commitAtomicFileSet({ rootDir: bookDir, writes });
  });
}
