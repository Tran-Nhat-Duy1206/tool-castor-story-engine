import { readdir, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AuthorizationRecordSchema, evaluateAuthorizationAgainstEvidence, type CanonSettlementEvidence, type AuthorizationRecord } from "../governance/authorizations.js";
import type { AuthorDecisionKind } from "../governance/contracts.js";
import type { AtomicFileWrite } from "../utils/atomic-file-set.js";

/**
 * Task 20 — evidence-derived atomic settlement integration.
 * Core loads trusted ACTIVE authorization records; caller IDs are never trusted.
 */

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
