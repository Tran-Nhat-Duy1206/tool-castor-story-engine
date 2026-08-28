import { readdir, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AuthorizationRecordSchema, evaluateAuthorizationAgainstEvidence, type CanonSettlementEvidence, type AuthorizationRecord } from "../governance/authorizations.js";
import type { AuthorDecisionKind } from "../governance/contracts.js";
import type { AtomicFileWrite } from "../utils/atomic-file-set.js";

function canonicalFactKey(fact: { readonly subject: string; readonly predicate: string }): string {
  return `${fact.subject}::${fact.predicate}`;
}

/**
 * Task 20 — evidence-derived atomic settlement integration.
 * Core loads trusted ACTIVE authorization records; caller IDs are never trusted.
 * Settlement context resolvers are derived from trusted live persisted state and fail closed.
 */

export async function buildTrustedSettlementEvidence(
  bookDir: string,
  effectiveChapter: number,
  resultingCanonRevision: string,
): Promise<CanonSettlementEvidence> {
  const { readLiveRuntimeStateSnapshot } = await import("./state-review-store.js");
  const live = await readLiveRuntimeStateSnapshot(bookDir).catch(() => null);
  let currentArcId = "arc-1";
  let arcAmbiguous = false;
  const arcStatusCache = new Map<string, { status: "not_started" | "started" | "climaxed" | "closed"; revision: string }>();
  try {
    const { readdir, readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const versionsRoot = join(bookDir, "story", "governance", "versions", "arc_plan");
    const unitDirs = (await readdir(versionsRoot).catch(() => [] as string[])).sort();
    const found: string[] = [];
    for (const d of unitDirs) {
      try {
        const cur = JSON.parse(await readFile(join(versionsRoot, d, "current.json"), "utf-8"));
        if (cur?.unitId && typeof cur?.version === "number") {
          found.push(cur.unitId);
          const status = cur.snapshot?.status ?? "started";
          const safeStatus = ["started", "climaxed", "closed"].includes(status) ? status : "not_started";
          arcStatusCache.set(cur.unitId, { status: safeStatus as any, revision: String(cur.version) });
        } else if (cur?.unitId) {
          found.push(cur.unitId);
        }
      } catch {}
    }
    if (found.length === 1) currentArcId = found[0]!;
    else if (found.length > 1) { arcAmbiguous = true; currentArcId = ""; arcStatusCache.clear(); }
  } catch {}

  const hookMap = new Map<string, { status: string; lifecycleRevision: string }>();
  if (live?.hooks?.hooks) {
    for (const h of (live.hooks as any).hooks) {
      const lifecycle = h.status === "resolved" ? "resolved" : h.status === "progressing" ? "advanced" : h.status === "deferred" ? "dormant" : h.status === "ready_for_payoff" ? "ready_for_payoff" : "active";
      hookMap.set(h.hookId, { status: lifecycle, lifecycleRevision: String(h.lastAdvancedChapter ?? 1) });
    }
  }

  const factSet = new Set<string>();
  const factRevision = new Map<string, number>();
  if (live?.currentState?.facts) {
    for (const f of (live.currentState as any).facts) {
      const key = canonicalFactKey(f);
      factSet.add(key);
      factRevision.set(key, f.validFromChapter ?? effectiveChapter);
    }
  }

  return {
    context: {
      chapterNumber: effectiveChapter,
      currentArcId,
      canonRevision: effectiveChapter,
      hookStates: (hookId: string) => {
        const found = hookMap.get(hookId);
        if (!found) return { lifecycleState: "proposed" as any, lifecycleRevision: "0" };
        return { lifecycleState: found.status as any, lifecycleRevision: found.lifecycleRevision };
      },
      relationshipStates: (relationshipId: string) => {
        return { state: "unknown", stateRevision: "0" };
      },
      factResolver: (factKey: string) => {
        const exists = factSet.has(factKey);
        return { exists, canonRevision: exists ? (factRevision.get(factKey) ?? effectiveChapter) : 0 };
      },
      arcState: (arcId: string) => {
        const cached = arcStatusCache.get(arcId);
        if (cached) return cached;
        if (arcId === currentArcId) return { status: "started" as const, revision: "1" };
        return { status: "not_started" as const, revision: "0" };
      },
    },
    decisionKinds: [] as any,
  };
}

async function listAuthorizations(bookDir: string): Promise<AuthorizationRecord[]> {
  const dir = join(bookDir, "story", "governance", "authorizations");
  let entries: string[] = [];
  try { entries = await readdir(dir); } catch { return []; }
  const records: AuthorizationRecord[] = [];
  for (const entry of entries.filter(e => e.endsWith(".gov.json"))) {
    try {
      const raw = JSON.parse(await readFile(join(dir, entry), "utf-8"));
      records.push(AuthorizationRecordSchema.parse(raw));
    } catch {}
  }
  return records;
}

export async function deriveConsumedAuthorizations(
  bookDir: string,
  finalizedReview: any,
  canonEvidence: CanonSettlementEvidence,
): Promise<ReadonlyArray<{ authorizationId: string; decisionKind: AuthorDecisionKind; canonRevision: number }>> {
  const all = await listAuthorizations(bookDir);
  const allowedIds: Set<string> | null = Array.isArray(finalizedReview?.authorizationIds)
    ? new Set(finalizedReview.authorizationIds)
    : null;
  const result: Array<{ authorizationId: string; decisionKind: AuthorDecisionKind; canonRevision: number }> = [];
  for (const rec of all) {
    if (rec.lifecycle !== "active") continue;
    if (rec.consumption !== "one_time") continue;
    if (allowedIds && !allowedIds.has(rec.authorizationId)) continue;
    // validate decisionKind/scope/condition via pure helper
    const active = rec as any;
    const evalRes = (() => {
      try { return evaluateAuthorizationAgainstEvidence(active, canonEvidence); } catch { return { matches: false }; }
    })();
    if (!evalRes.matches) continue;
    // derive canonRevision from evidence context
    result.push({ authorizationId: rec.authorizationId, decisionKind: rec.decisionKind, canonRevision: canonEvidence.context.canonRevision });
  }
  return result;
}

export interface AtomicSettlementInput {
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly canonRevision: number;
  readonly derivedConsumptions: ReadonlyArray<{ authorizationId: string; decisionKind: AuthorDecisionKind }>;
}

export function buildSettlementWrites(input: AtomicSettlementInput): ReadonlyArray<AtomicFileWrite> {
  if (input.derivedConsumptions.length === 0) return [];
  const writes: AtomicFileWrite[] = [];
  for (const c of input.derivedConsumptions) {
    const raw = JSON.parse(readFileSync(join(input.bookDir, `story/governance/authorizations/${c.authorizationId}.gov.json`), "utf-8"));
    const rec = AuthorizationRecordSchema.parse(raw);
    if (rec.lifecycle !== "active") throw new Error(`Authorization ${c.authorizationId} is not active at settlement`);
    const parsed = Number.parseInt(rec.lifecycleRevision, 10);
    if (!Number.isSafeInteger(parsed)) throw new Error(`Invalid lifecycleRevision ${rec.lifecycleRevision}`);
    const nextRev = String(parsed + 1);
    const consumed = AuthorizationRecordSchema.parse({
      ...rec,
      lifecycle: "consumed",
      lifecycleRevision: nextRev,
      consumedAt: new Date().toISOString(),
      consumedCanonRevision: input.canonRevision,
    });
    writes.push({
      relativePath: `story/governance/authorizations/${c.authorizationId}.gov.json`,
      content: `${JSON.stringify(consumed, null, 2)}\n`,
    });
  }
  return writes;
}

export interface LaggableEffects {
  readonly beatEvidence: ReadonlyArray<{ beatId: string; state: "satisfied" | "not_satisfied" | "uncertain" }>;
  readonly lookaheadStatus: "current" | "stale" | "superseded" | "consumed";
  readonly arcReadiness: "not_ready" | "ready_to_close" | "arc_completion_uncertain" | "not_applicable";
  readonly nextPlanningReady: boolean;
}

export async function applyLaggableSettlementEffects(bookDir: string, chapterNumber: number, canonRevision: number): Promise<LaggableEffects> {
  // Laggable, reconstructable; never affects canon correctness. Best-effort no throw.
  try {
    // No-op derivation for now; future tasks may populate.
    return {
      beatEvidence: [],
      lookaheadStatus: "current",
      arcReadiness: "not_applicable",
      nextPlanningReady: true,
    };
  } catch {
    return { beatEvidence: [], lookaheadStatus: "current", arcReadiness: "not_applicable", nextPlanningReady: false };
  }
}

/* Helper for finalize integration to produce real enriched writes from trusted records */
export async function buildValidatedSettlementWrites(
  bookDir: string,
  input: AtomicSettlementInput,
): Promise<ReadonlyArray<AtomicFileWrite>> {
  if (input.derivedConsumptions.length === 0) return [];
  const writes: AtomicFileWrite[] = [];
  for (const c of input.derivedConsumptions) {
    const raw = JSON.parse(await readFile(join(bookDir, `story/governance/authorizations/${c.authorizationId}.gov.json`), "utf-8"));
    const rec = AuthorizationRecordSchema.parse(raw);
    if (rec.lifecycle !== "active") throw new Error(`Authorization ${c.authorizationId} is not active`);
    const parsed = Number.parseInt(rec.lifecycleRevision, 10);
    if (!Number.isSafeInteger(parsed)) throw new Error(`Invalid lifecycleRevision ${rec.lifecycleRevision}`);
    const nextRev = String(parsed + 1);
    const consumed = AuthorizationRecordSchema.parse({
      ...rec,
      lifecycle: "consumed",
      lifecycleRevision: nextRev,
      consumedAt: new Date().toISOString(),
      consumedCanonRevision: input.canonRevision,
    });
    writes.push({
      relativePath: `story/governance/authorizations/${c.authorizationId}.gov.json`,
      content: `${JSON.stringify(consumed, null, 2)}\n`,
    });
  }
  return writes;
}
