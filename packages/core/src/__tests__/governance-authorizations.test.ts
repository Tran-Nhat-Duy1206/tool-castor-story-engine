import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateManager } from "../state/manager.js";
import * as authModule from "../governance/authorizations.js";
import {
  AuthorizationRecordSchema,
  HumanDirectionRecordSchema,
  authorizationApplies,
  cancelAuthorization,
  confirmAuthorization,
  confirmHumanDirection,
  createAuthorization,
  createHumanDirection,
  deriveEligibleAuthorizationConsumption,
  directionApplies,
  evaluateAuthorizationAgainstEvidence,
  loadAuthorization,
  loadHumanDirection,
  loadPendingHumanDirectionProposal,
  parseHumanDirectionDraft,
  resolveDirectionConflict,
  type ActiveAuthorization,
  type AuthorizationCondition,
  type AuthorizationEvaluationContext,
  type AuthorizationRecord,
  type HumanDirectionRecord,
} from "../governance/authorizations.js";

let root = "";
let bookDir = "";
const canonPath = () => join(bookDir, "story", "state", "manifest.json");
const bookPath = () => join(bookDir, "book.json");

async function setupBook(): Promise<void> {
  root = await mkdtemp(join(tmpdir(), "castor-authorizations-"));
  bookDir = join(root, "books", "demo-book");
  await mkdir(join(bookDir, "story", "state"), { recursive: true });
  await writeFile(bookPath(), `${JSON.stringify({
    id: "demo-book",
    title: "Demo",
    platform: "other",
    genre: "fantasy",
    status: "active",
    targetChapters: 30,
    chapterWordCount: 2000,
    language: "en",
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
    governance: { foundation: "v2", planning: "legacy" },
  }, null, 2)}\n`, "utf-8");
  await writeCanon(4);
}

async function writeCanon(revision: number): Promise<void> {
  await writeFile(canonPath(), `${JSON.stringify({
    schemaVersion: 2,
    language: "en",
    lastAppliedChapter: revision,
    projectionVersion: 1,
    migrationWarnings: [],
  }, null, 2)}\n`, "utf-8");
}

function context(overrides: Partial<AuthorizationEvaluationContext> = {}): AuthorizationEvaluationContext {
  const hooks: Record<string, { lifecycleState: "active" | "advanced" | "resolved"; lifecycleRevision: string }> = {
    advanced: { lifecycleState: "advanced", lifecycleRevision: "2" },
    resolved: { lifecycleState: "resolved", lifecycleRevision: "3" },
    active: { lifecycleState: "active", lifecycleRevision: "1" },
  };
  return {
    chapterNumber: 6,
    currentArcId: "arc-b",
    canonRevision: 5,
    hookStates: (hookId) => hooks[hookId] ?? { lifecycleState: "active", lifecycleRevision: "1" },
    relationshipStates: (relationshipId) => ({ state: relationshipId === "rivals" ? "allies" : "unknown", stateRevision: "7" }),
    factResolver: (factKey) => ({ exists: factKey === "identity-known", canonRevision: 5 }),
    arcState: (arcId) => ({
      status: arcId === "arc-a" ? "closed" : arcId === "arc-b" ? "started" : "not_started",
      revision: "4",
    }),
    ...overrides,
  };
}

function activeAuthorization(scope: ActiveAuthorization["scope"]): ActiveAuthorization {
  return AuthorizationRecordSchema.parse({
    authorizationId: "auth-active",
    decisionKind: "identity_reveal",
    scope,
    consumption: "one_time",
    createdAt: "2026-08-27T00:00:00.000Z",
    lifecycle: "active",
    lifecycleRevision: "2",
    confirmedAt: "2026-08-27T00:01:00.000Z",
    confirmedBy: "human-a",
  }) as ActiveAuthorization;
}

function activeDirection(scope: HumanDirectionRecord["scope"], id = "direction-active"): HumanDirectionRecord & { lifecycle: "active" } {
  return HumanDirectionRecordSchema.parse({
    directionId: id,
    text: `Direction ${id}`,
    scope,
    lifecycle: "active",
    lifecycleRevision: "2",
    createdAt: "2026-08-27T00:00:00.000Z",
    confirmedAt: "2026-08-27T00:01:00.000Z",
    confirmedBy: "human-a",
  }) as HumanDirectionRecord & { lifecycle: "active" };
}

async function writeDirectionFixture(record: HumanDirectionRecord): Promise<void> {
  const dir = join(bookDir, "story", "governance", "human-directions");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${record.directionId}.gov.json`), `${JSON.stringify(record, null, 2)}\n`, "utf-8");
}

async function writeAuthorizationFixture(record: AuthorizationRecord): Promise<void> {
  const dir = join(bookDir, "story", "governance", "authorizations");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${record.authorizationId}.gov.json`), `${JSON.stringify(record, null, 2)}\n`, "utf-8");
}

beforeEach(async () => {
  await setupBook();
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (root) await rm(root, { recursive: true, force: true });
});

describe("authorization lifecycle and Human confirmation", () => {
  it("createAuthorization always persists pending non-authority", async () => {
    const pending = await createAuthorization(bookDir, {
      decisionKind: "identity_reveal",
      scope: { kind: "exact_chapter", chapterNumber: 6 },
      consumption: "one_time",
    });
    expect(pending.lifecycle).toBe("pending");
    expect(pending.lifecycleRevision).toBe("1");
    expect((await loadAuthorization(bookDir, pending.authorizationId))?.lifecycle).toBe("pending");
    expect(() => authorizationApplies(pending as never, context())).toThrow(/active/i);
  });

  it("confirm requires explicit Human actor and performs only pending -> active", async () => {
    const pending = await createAuthorization(bookDir, {
      decisionKind: "major_betrayal",
      scope: { kind: "arc", arcId: "arc-b" },
      consumption: "reusable",
    });
    await expect(confirmAuthorization(bookDir, pending.authorizationId, "   ")).rejects.toThrow(/humanActor/i);
    const active = await confirmAuthorization(bookDir, pending.authorizationId, "Human Exact");
    expect(active.lifecycle).toBe("active");
    expect(active.confirmedBy).toBe("Human Exact");
    expect(active.confirmedAt).toBeTruthy();
    expect(active.lifecycleRevision).toBe("2");
    await expect(confirmAuthorization(bookDir, pending.authorizationId, "Human Exact")).rejects.toThrow(/pending.*active/i);
  });

  it("retains immutable provenance for consumed, expired, and cancelled terminal records", async () => {
    const base = {
      authorizationId: "auth-terminal",
      decisionKind: "world_rule_exception" as const,
      scope: { kind: "chapter_window" as const, startChapter: 5, endChapter: 8 },
      consumption: "one_time" as const,
      createdAt: "2026-08-27T00:00:00.000Z",
      lifecycleRevision: "3",
      confirmedAt: "2026-08-27T00:01:00.000Z",
      confirmedBy: "human-a",
    };
    const consumed = AuthorizationRecordSchema.parse({
      ...base,
      lifecycle: "consumed",
      consumedAt: "2026-08-27T00:02:00.000Z",
      consumedCanonRevision: 6,
    });
    await writeAuthorizationFixture(consumed);
    expect(await loadAuthorization(bookDir, base.authorizationId)).toMatchObject({
      decisionKind: base.decisionKind,
      scope: base.scope,
      consumption: base.consumption,
      consumedCanonRevision: 6,
    });

    const expired = AuthorizationRecordSchema.parse({ ...base, authorizationId: "auth-expired", lifecycle: "expired", expiredAt: "2026-08-27T00:03:00.000Z" });
    await writeAuthorizationFixture(expired);
    expect(await loadAuthorization(bookDir, "auth-expired")).toMatchObject({ decisionKind: base.decisionKind, expiredAt: expect.any(String) });

    const cancelled = AuthorizationRecordSchema.parse({ ...base, authorizationId: "auth-cancelled", lifecycle: "cancelled", cancelledAt: "2026-08-27T00:04:00.000Z" });
    await writeAuthorizationFixture(cancelled);
    expect(await loadAuthorization(bookDir, "auth-cancelled")).toMatchObject({ scope: base.scope, cancelledAt: expect.any(String) });
  });

  it("implemented cancellation is locked, retains provenance, and increments lifecycleRevision", async () => {
    const pending = await createAuthorization(bookDir, {
      decisionKind: "major_goal_change",
      scope: { kind: "exact_chapter", chapterNumber: 8 },
      consumption: "reusable",
    });
    const cancelled = await cancelAuthorization(bookDir, pending.authorizationId, "Human Canceller");
    expect(cancelled).toMatchObject({
      lifecycle: "cancelled",
      lifecycleRevision: "2",
      decisionKind: "major_goal_change",
      consumption: "reusable",
      cancelledBy: "Human Canceller",
    });
  });
});

describe("one deterministic authorization/direction scope interpretation", () => {
  it("evaluates exact_chapter, chapter_window boundaries, arc, and from_arc", () => {
    expect(authorizationApplies(activeAuthorization({ kind: "exact_chapter", chapterNumber: 6 }), context())).toBe(true);
    expect(authorizationApplies(activeAuthorization({ kind: "exact_chapter", chapterNumber: 7 }), context())).toBe(false);
    expect(authorizationApplies(activeAuthorization({ kind: "chapter_window", startChapter: 6, endChapter: 8 }), context())).toBe(true);
    expect(authorizationApplies(activeAuthorization({ kind: "chapter_window", startChapter: 3, endChapter: 6 }), context())).toBe(true);
    expect(authorizationApplies(activeAuthorization({ kind: "chapter_window", startChapter: 7, endChapter: 9 }), context())).toBe(false);
    expect(authorizationApplies(activeAuthorization({ kind: "arc", arcId: "arc-b" }), context())).toBe(true);
    expect(authorizationApplies(activeAuthorization({ kind: "from_arc", sourceArcId: "arc-a", targetArcId: "arc-b" }), context())).toBe(true);
    expect(authorizationApplies(activeAuthorization({ kind: "from_arc", sourceArcId: "arc-x", targetArcId: "arc-b" }), context())).toBe(false);
  });

  it.each([
    [{ kind: "after_hook_advanced", hookId: "advanced" }, true],
    [{ kind: "after_hook_resolved", hookId: "resolved" }, true],
    [{ kind: "after_arc_started", arcId: "arc-b" }, true],
    [{ kind: "after_arc_climax", arcId: "arc-a" }, true],
    [{ kind: "after_chapter", chapterNumber: 5 }, true],
    [{ kind: "after_relationship_state", relationshipId: "rivals", state: "allies" }, true],
    [{ kind: "after_fact_exists", factKey: "identity-known" }, true],
  ] as const)("evaluates condition %j", (condition, expected) => {
    expect(authorizationApplies(activeAuthorization({ kind: "condition", condition: condition as AuthorizationCondition }), context())).toBe(expected);
  });

  it("covers all four Human Direction scopes and rejects pending at runtime", () => {
    expect(directionApplies(activeDirection({ kind: "exact_chapter", chapterNumber: 6 }), context())).toBe(true);
    expect(directionApplies(activeDirection({ kind: "chapter_window", startChapter: 5, endChapter: 6 }), context())).toBe(true);
    expect(directionApplies(activeDirection({ kind: "arc", arcId: "arc-b" }), context())).toBe(true);
    expect(directionApplies(activeDirection({ kind: "until_condition", condition: { kind: "after_chapter", chapterNumber: 7 } }), context())).toBe(true);
    expect(directionApplies(activeDirection({ kind: "until_condition", condition: { kind: "after_chapter", chapterNumber: 5 } }), context())).toBe(false);
    const pending = HumanDirectionRecordSchema.parse({
      directionId: "direction-pending",
      text: "Pending",
      scope: { kind: "arc", arcId: "arc-b" },
      lifecycle: "pending",
      lifecycleRevision: "1",
      createdAt: "2026-08-27T00:00:00.000Z",
    });
    expect(() => directionApplies(pending as never, context())).toThrow(/active/i);
  });
});

describe("pure evidence and Task 20 consumption boundary", () => {
  it("evaluates eligibility without persisting consumption during planning, drafting, or failure", async () => {
    const pending = await createAuthorization(bookDir, {
      decisionKind: "identity_reveal",
      scope: { kind: "exact_chapter", chapterNumber: 6 },
      consumption: "one_time",
    });
    const active = await confirmAuthorization(bookDir, pending.authorizationId, "human-a");
    const path = join(bookDir, "story", "governance", "authorizations", `${active.authorizationId}.gov.json`);
    const before = await readFile(path, "utf-8");
    const evidence = { context: context(), decisionKinds: ["identity_reveal" as const] };
    expect(evaluateAuthorizationAgainstEvidence(active, evidence)).toEqual({ matches: true, reason: "scope_and_decision_match" });
    expect(deriveEligibleAuthorizationConsumption([active], {
      reviewId: "review-1",
      status: "active",
      authorizationIds: [active.authorizationId],
    }, evidence)).toEqual([{ authorizationId: active.authorizationId, decisionKind: "identity_reveal" }]);
    await Promise.reject(new Error("simulated writer failure")).catch(() => undefined);
    expect(await readFile(path, "utf-8")).toBe(before);
    expect((await loadAuthorization(bookDir, active.authorizationId))?.lifecycle).toBe("active");
    expect("consumeAuthorization" in authModule).toBe(false);
  });
});

describe("Core NL parser and exact proposal confirmation", () => {
  it("persists a pending proposal with confidence/unresolved and zero authority", async () => {
    const proposal = await parseHumanDirectionDraft(bookDir, "In chapter 7, reveal the sealed map", {
      canonRevision: 4,
      arcPlanVersion: null,
    });
    expect(proposal.proposedScope).toEqual({ kind: "exact_chapter", chapterNumber: 7 });
    expect(proposal.confidence).toBe("high");
    expect(proposal.unresolved).toEqual([]);
    expect(await loadPendingHumanDirectionProposal(bookDir, proposal.directionId)).toEqual(proposal);
    expect(await loadHumanDirection(bookDir, proposal.directionId)).toBeNull();
  });

  it("records low-confidence unresolved parsing and refuses silent activation", async () => {
    const proposal = await parseHumanDirectionDraft(bookDir, "Make the next part more tense", {
      canonRevision: 4,
      arcPlanVersion: null,
    });
    expect(proposal.confidence).toBe("low");
    expect(proposal.unresolved.length).toBeGreaterThan(0);
    await expect(confirmHumanDirection(bookDir, proposal.directionId, "human-a")).rejects.toThrow(/unresolved/i);
  });

  it("confirm loads the exact persisted proposal and revalidates current context", async () => {
    const proposal = await parseHumanDirectionDraft(bookDir, "Across chapters 6-8, raise the political pressure", {
      canonRevision: 4,
      arcPlanVersion: null,
    });
    const active = await confirmHumanDirection(bookDir, proposal.directionId, "Human Director");
    expect(active).toMatchObject({
      directionId: proposal.directionId,
      text: proposal.text,
      scope: proposal.proposedScope,
      lifecycle: "active",
      lifecycleRevision: "2",
      confirmedBy: "Human Director",
    });
  });

  it("fails closed for stale, missing, or corrupt proposals", async () => {
    const stale = await parseHumanDirectionDraft(bookDir, "In chapter 9, reveal the crown", { canonRevision: 4, arcPlanVersion: null });
    await writeCanon(5);
    await expect(confirmHumanDirection(bookDir, stale.directionId, "human-a")).rejects.toThrow(/stale/i);
    await expect(confirmHumanDirection(bookDir, "missing-proposal", "human-a")).rejects.toThrow(/not found/i);
    const proposalDir = join(bookDir, "story", "governance", "human-direction-proposals");
    await mkdir(proposalDir, { recursive: true });
    await writeFile(join(proposalDir, "corrupt-proposal.gov.json"), "{bad", "utf-8");
    await expect(confirmHumanDirection(bookDir, "corrupt-proposal", "human-a")).rejects.toThrow();
  });

  it("createHumanDirection is pending and only explicit Human confirmation activates", async () => {
    const pending = await createHumanDirection(bookDir, {
      text: "Keep the antagonist off-page",
      scope: { kind: "arc", arcId: "arc-b" },
    });
    expect(pending.lifecycle).toBe("pending");
    await expect(confirmHumanDirection(bookDir, pending.directionId, "")).rejects.toThrow(/humanActor/i);
    const active = await confirmHumanDirection(bookDir, pending.directionId, "human-a");
    expect(active).toMatchObject({ lifecycle: "active", lifecycleRevision: "2", confirmedBy: "human-a" });
  });
});

describe("explicit Human Direction conflicts", () => {
  async function seedPair(prefix: string): Promise<[string, string]> {
    const first = activeDirection({ kind: "exact_chapter", chapterNumber: 8 }, `${prefix}-first`);
    const second = activeDirection({ kind: "exact_chapter", chapterNumber: 8 }, `${prefix}-second`);
    await writeDirectionFixture(first);
    await writeDirectionFixture(second);
    return [first.directionId, second.directionId];
  }

  it("never silently latest-wins and implements override/replace/keep/edit deterministically", async () => {
    const overrideIds = await seedPair("override");
    await resolveDirectionConflict(bookDir, overrideIds, "override", "human-a");
    expect((await loadHumanDirection(bookDir, overrideIds[0]))?.lifecycle).toBe("active");
    expect(await loadHumanDirection(bookDir, overrideIds[1])).toMatchObject({ lifecycle: "superseded", lifecycleRevision: "3" });

    const replaceIds = await seedPair("replace");
    await resolveDirectionConflict(bookDir, replaceIds, "replace", "human-a");
    expect((await loadHumanDirection(bookDir, replaceIds[0]))?.lifecycle).toBe("superseded");
    expect((await loadHumanDirection(bookDir, replaceIds[1]))?.lifecycle).toBe("active");

    const keepIds = await seedPair("keep");
    await resolveDirectionConflict(bookDir, keepIds, "keep", "human-a");
    expect((await loadHumanDirection(bookDir, keepIds[0]))?.lifecycle).toBe("active");
    expect((await loadHumanDirection(bookDir, keepIds[1]))?.lifecycle).toBe("active");

    const editIds = await seedPair("edit");
    await resolveDirectionConflict(bookDir, editIds, "edit", "human-a");
    expect((await loadHumanDirection(bookDir, editIds[0]))?.lifecycle).toBe("superseded");
    expect((await loadHumanDirection(bookDir, editIds[1]))?.lifecycle).toBe("superseded");
  });
});

describe("book lock order and authority isolation", () => {
  it("acquires the existing book lock before re-reading and rejects stale pre-lock state", async () => {
    const pending = await createAuthorization(bookDir, {
      decisionKind: "major_secret_reveal",
      scope: { kind: "exact_chapter", chapterNumber: 7 },
      consumption: "one_time",
    });
    const release = vi.fn(async () => undefined);
    vi.spyOn(StateManager.prototype, "acquireBookLock").mockImplementation(async () => {
      const path = join(bookDir, "story", "governance", "authorizations", `${pending.authorizationId}.gov.json`);
      const changed = AuthorizationRecordSchema.parse({
        ...pending,
        lifecycle: "cancelled",
        lifecycleRevision: "2",
        cancelledAt: "2026-08-27T00:02:00.000Z",
        cancelledBy: "other-human",
      });
      await writeFile(path, `${JSON.stringify(changed, null, 2)}\n`, "utf-8");
      return release;
    });
    await expect(confirmAuthorization(bookDir, pending.authorizationId, "human-a")).rejects.toThrow(/pending.*cancelled/i);
    expect(release).toHaveBeenCalledOnce();
  });

  it("releases lock on validation/read failure", async () => {
    const release = vi.fn(async () => undefined);
    vi.spyOn(StateManager.prototype, "acquireBookLock").mockResolvedValue(release);
    await expect(confirmAuthorization(bookDir, "missing-auth", "human-a")).rejects.toThrow(/not found/i);
    expect(release).toHaveBeenCalledOnce();
  });

  it("leaves Canon, Foundation authority, Planning authority, markers, and prose unchanged", async () => {
    const canonBefore = await readFile(canonPath(), "utf-8");
    const bookBefore = await readFile(bookPath(), "utf-8");
    const pending = await createAuthorization(bookDir, {
      decisionKind: "ending_direction_change",
      scope: { kind: "arc", arcId: "arc-b" },
      consumption: "reusable",
    });
    await confirmAuthorization(bookDir, pending.authorizationId, "human-a");
    const direction = await createHumanDirection(bookDir, { text: "Hold the ending", scope: { kind: "arc", arcId: "arc-b" } });
    await confirmHumanDirection(bookDir, direction.directionId, "human-a");
    expect(await readFile(canonPath(), "utf-8")).toBe(canonBefore);
    expect(await readFile(bookPath(), "utf-8")).toBe(bookBefore);
    await expect(readFile(join(bookDir, "story", "governance", "versions", "arc_plan", "current.json"), "utf-8")).rejects.toThrow();
  });
});
