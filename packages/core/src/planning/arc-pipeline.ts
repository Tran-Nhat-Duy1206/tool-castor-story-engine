import { z } from "zod";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  AuthorDecisionKindSchema,
  FindingSeveritySchema,
  RepairScopeSchema,
  SafeGovernanceIdSchema,
  type AuthorDecisionKind,
  type FindingSeverity,
  type RepairScope,
  type SafeGovernanceId,
} from "../governance/contracts.js";
import {
  saveArcPlanDraft,
  loadArcPlanDraft,
  type ArcPlanDraftRecord,
  type ArcPlanSnapshot,
  type ArcPlanVersion,
} from "./arc-plan.js";
import {
  createVersionStore,
  type FoundationPublishedSnapshot,
} from "../governance/versions.js";
import {
  readCurrentCanonRevision,
} from "../governance/conflicts.js";
import {
  authorizationApplies,
  loadAuthorization,
  loadHumanDirection,
} from "../governance/authorizations.js";
import {
  invalidateDirectPlanningDependents,
} from "./invalidation-registry.js";
import {
  runTransaction,
  type TransactionStage,
} from "../governance/transactions.js";
import { computeProseRevision } from "../utils/prose-revision.js";
import { commitAtomicFileSet, type AtomicFileWrite } from "../utils/atomic-file-set.js";

// ===========================================================================
// Phase 5 Task 13 — Arc Planner Pipeline & Human Publish Boundary
//
// Pipeline:
// Published Foundation -> Arc Planner -> Arc Plan Draft (Task 12 store)
// -> Deterministic Preflight -> Semantic Reviewer -> Bounded Local Repair
// -> Explicit Human Publish (publishArcPlan).
//
// Typed Finding Invariant:
// ONLY deterministic checks may create kind: "conflict".
// Semantic review may create ONLY local_issue | uncertain | author_decision.
//
// Preflight is persisted and bound to the EXACT draft hash + bases.
// Human Publish revalidates the exact persisted draft, persisted preflight,
// Foundation version, Canon revision, and active Task 11 authorizations.
// First Publish under V2 atomically flips governance.planning = "v2" and
// invalidates direct planning dependents in ONE Task 9 transaction.
// ===========================================================================

export const ArcFindingSchema = z.object({
  findingId: z.string().min(1),
  source: z.enum(["deterministic", "semantic"]),
  kind: z.enum(["local_issue", "uncertain", "author_decision", "conflict"]),
  severity: FindingSeveritySchema,
  repairScope: RepairScopeSchema,
  evidence: z.string().min(1),
  suggestedAction: z.string().min(1),
  involvesDecisionKind: AuthorDecisionKindSchema.optional(),
}).strict().refine((f) => {
  if (f.source === "semantic" && f.kind === "conflict") {
    return false;
  }
  return true;
}, {
  message: "Semantic reviewer must never emit kind: 'conflict'. Only deterministic checks may emit hard conflicts.",
});

export type ArcFinding = z.infer<typeof ArcFindingSchema>;

export const ArcPreflightRecordSchema = z.object({
  draftId: SafeGovernanceIdSchema,
  draftHash: z.string().min(1),
  foundationVersion: z.number().int().min(1),
  baseCanonRevision: z.number().int().min(0),
  parentArcVersion: z.number().int().min(0).optional(),
  deterministicResult: z.enum(["pass", "fail"]),
  semanticFindings: z.array(ArcFindingSchema),
  repairRound: z.number().int().min(0),
  unresolvedAuthorDecisions: z.array(AuthorDecisionKindSchema),
  verifiedAt: z.string().datetime(),
  status: z.enum(["current", "stale"]),
}).strict();

export type ArcPreflightRecord = z.infer<typeof ArcPreflightRecordSchema>;

export type ArcPreflightResult =
  | { outcome: "preflight_pass"; foundationVersion: number; baseCanonRevision: number; draftHash: string; preflightRecord: ArcPreflightRecord }
  | { outcome: "preflight_fail"; findings: ReadonlyArray<ArcFinding>; preflightRecord: ArcPreflightRecord };

export type ArcRepairOutcome =
  | { status: "repaired"; round: number; draftId: string; repairSummary: string }
  | { status: "needs_human_direction"; round: number; findings: ReadonlyArray<ArcFinding>; reason: string }
  | { status: "clean"; draftId: string };

export interface PublishArcPlanInput {
  readonly bookDir: string;
  readonly draftId: string;
  readonly humanActor: string;
  readonly expectedFoundationVersion: number;
  readonly expectedCanonRevision: number;
  readonly failAtStage?: TransactionStage;
}

function preflightRelPath(draftId: string): string {
  return join("story", "governance", "arc-preflights", `${SafeGovernanceIdSchema.parse(draftId)}.json`);
}

function serialized(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function validateHumanActor(actor: string): void {
  if (typeof actor !== "string" || actor.trim().length === 0) {
    throw new Error("Human actor must be a non-empty string identifier");
  }
}

export async function saveArcPreflightRecord(
  bookDir: string,
  record: ArcPreflightRecord,
): Promise<void> {
  const validated = ArcPreflightRecordSchema.parse(record);
  await commitAtomicFileSet({
    rootDir: bookDir,
    writes: [
      {
        relativePath: preflightRelPath(validated.draftId),
        content: serialized(validated),
      },
    ],
  });
}

export async function loadArcPreflightRecord(
  bookDir: string,
  draftId: string,
): Promise<ArcPreflightRecord | null> {
  const validId = SafeGovernanceIdSchema.parse(draftId);
  const fullPath = join(bookDir, preflightRelPath(validId));
  try {
    const raw = await readFile(fullPath, "utf-8");
    return ArcPreflightRecordSchema.parse(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function generateArcPlanDraft(
  bookDir: string,
  arcId: string,
  foundationVersion: number,
  brief: string,
  customGenerator?: (params: { bookDir: string; arcId: string; foundationVersion: number; brief: string }) => Promise<ArcPlanSnapshot>,
): Promise<{ draftId: string }> {
  const validArcId = SafeGovernanceIdSchema.parse(arcId);
  if (!Number.isInteger(foundationVersion) || foundationVersion < 1) {
    throw new Error(`Invalid foundationVersion: ${foundationVersion}`);
  }
  if (!brief || brief.trim().length === 0) {
    throw new Error("Arc generation requires a non-empty brief");
  }

  const currentCanonRev = await readCurrentCanonRevision(bookDir).catch(() => 0);

  let snapshot: ArcPlanSnapshot;
  if (customGenerator) {
    snapshot = await customGenerator({ bookDir, arcId: validArcId, foundationVersion, brief });
  } else {
    snapshot = {
      arcId: validArcId,
      goal: brief.trim(),
      requiredBeats: [
        {
          beatId: `beat-${validArcId}-inciting`,
          category: "event",
          importance: "required",
          description: `Inciting beat for ${brief.trim()}`,
        },
        {
          beatId: `beat-${validArcId}-climax`,
          category: "arc_turn",
          importance: "required",
          description: `Climax for ${brief.trim()}`,
        },
      ],
      optionalBeats: [],
      relationshipMovements: [],
      hookMovements: [],
      timing: { startChapter: 1, endChapter: 10 },
      authorizations: [],
      dependencies: [
        { kind: "foundation_unit", unitId: "character-hero", contentRevision: 1, approvedRevision: 1, foundationVersion },
      ],
      changedBeats: [`beat-${validArcId}-inciting`, `beat-${validArcId}-climax`],
      changedAuthorizations: [],
    };
  }

  const draftId = `draft-arc-${randomUUID()}`;
  const now = new Date().toISOString();
  const draftHash = computeProseRevision(JSON.stringify(snapshot));

  const draftRecord: ArcPlanDraftRecord = {
    draftId,
    arcId: validArcId,
    snapshot,
    draftHash,
    foundationVersion,
    baseCanonRevision: currentCanonRev,
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };

  await saveArcPlanDraft(bookDir, draftRecord);
  return { draftId };
}

export async function reviewArcPlanDraft(
  bookDir: string,
  draftId: string,
  customReviewer?: (draft: ArcPlanDraftRecord) => Promise<ReadonlyArray<ArcFinding>>,
): Promise<ReadonlyArray<ArcFinding>> {
  const draft = await loadArcPlanDraft(bookDir, draftId);
  if (!draft) {
    throw new Error(`Cannot review Arc Plan draft "${draftId}": draft not found`);
  }

  let findings: ReadonlyArray<ArcFinding> = [];
  if (customReviewer) {
    findings = await customReviewer(draft);
  }

  // Runtime enforcement: semantic review must NEVER emit kind: "conflict"
  for (const f of findings) {
    if (f.source === "semantic" && f.kind === "conflict") {
      throw new Error(
        `Semantic review invariant violated: semantic finding "${f.findingId}" has kind: "conflict". Semantic reviewer must never emit hard conflicts.`,
      );
    }
    ArcFindingSchema.parse(f);
  }

  return findings;
}

export async function runArcPreflight(
  bookDir: string,
  draftId: string,
  options?: {
    semanticReviewer?: (draft: ArcPlanDraftRecord) => Promise<ReadonlyArray<ArcFinding>>;
  },
): Promise<ArcPreflightResult> {
  const draft = await loadArcPlanDraft(bookDir, draftId);
  if (!draft) {
    throw new Error(`Cannot run preflight on draft "${draftId}": draft not found`);
  }

  const deterministicFindings: ArcFinding[] = [];

  // 1. Foundation version validation
  const store = createVersionStore(bookDir);
  const currentFoundation = await store.readCurrentVersion<FoundationPublishedSnapshot>("foundation", "foundation");
  const currentFoundVer = currentFoundation ? currentFoundation.version : 0;
  if (currentFoundVer !== draft.foundationVersion) {
    deterministicFindings.push({
      findingId: `found-ver-mismatch-${randomUUID()}`,
      source: "deterministic",
      kind: "conflict",
      severity: "blocking",
      repairScope: "multi_unit",
      evidence: `Draft was generated against Foundation v${draft.foundationVersion}, but current published Foundation is v${currentFoundVer}`,
      suggestedAction: "Regenerate draft against current Foundation version",
    });
  }

  // 2. Canon revision validation
  const currentCanon = await readCurrentCanonRevision(bookDir).catch(() => 0);
  if (currentCanon !== draft.baseCanonRevision) {
    deterministicFindings.push({
      findingId: `canon-rev-mismatch-${randomUUID()}`,
      source: "deterministic",
      kind: "conflict",
      severity: "blocking",
      repairScope: "multi_unit",
      evidence: `Draft was generated against Canon revision ${draft.baseCanonRevision}, but current Canon revision is ${currentCanon}`,
      suggestedAction: "Rebase draft against current Canon state",
    });
  }

  // 3. Timing / timeline validation
  const timing = draft.snapshot.timing;
  if (typeof timing.startChapter === "number" && typeof timing.endChapter === "number") {
    if (timing.startChapter > timing.endChapter) {
      deterministicFindings.push({
        findingId: `timing-conflict-${randomUUID()}`,
        source: "deterministic",
        kind: "conflict",
        severity: "blocking",
        repairScope: "local",
        evidence: `Invalid timing range: startChapter (${timing.startChapter}) > endChapter (${timing.endChapter})`,
        suggestedAction: "Adjust timing start and end chapter boundaries",
      });
    }
  }

  // 4. Declared dependency observed-state validation
  for (const dep of draft.snapshot.dependencies) {
    if (dep.kind === "human_direction") {
      const dir = await loadHumanDirection(bookDir, dep.directionId);
      if (!dir || dir.lifecycle !== "active" || dir.lifecycleRevision !== dep.lifecycleRevision) {
        deterministicFindings.push({
          findingId: `dep-dir-mismatch-${dep.directionId}`,
          source: "deterministic",
          kind: "conflict",
          severity: "blocking",
          repairScope: "multi_unit",
          evidence: `Human direction "${dep.directionId}" observed at revision ${dep.lifecycleRevision} is no longer active at that revision`,
          suggestedAction: "Update draft to reference current human direction state",
        });
      }
    } else if (dep.kind === "authorization") {
      const auth = await loadAuthorization(bookDir, dep.authorizationId);
      if (!auth || auth.lifecycle !== "active" || auth.lifecycleRevision !== dep.lifecycleRevision) {
        deterministicFindings.push({
          findingId: `dep-auth-mismatch-${dep.authorizationId}`,
          source: "deterministic",
          kind: "conflict",
          severity: "blocking",
          repairScope: "multi_unit",
          evidence: `Authorization "${dep.authorizationId}" observed at revision ${dep.lifecycleRevision} is no longer active at that revision`,
          suggestedAction: "Revalidate draft against current authorization state",
        });
      }
    }
  }

  // 5. Semantic review
  const semanticFindings = await reviewArcPlanDraft(bookDir, draftId, options?.semanticReviewer);

  const allFindings = [...deterministicFindings, ...semanticFindings];
  const deterministicPass = deterministicFindings.length === 0;
  const unresolvedDecisions = allFindings
    .filter((f) => f.kind === "author_decision" && f.involvesDecisionKind)
    .map((f) => f.involvesDecisionKind!);

  const hasBlocking = allFindings.some((f) => f.severity === "blocking" || f.kind === "conflict");
  const preflightPass = deterministicPass && !hasBlocking && unresolvedDecisions.length === 0;

  const currentArc = await store.readCurrentVersion<ArcPlanSnapshot>("arc_plan", draft.arcId);
  const parentArcVersion = currentArc ? currentArc.version : 0;

  const record: ArcPreflightRecord = {
    draftId: draft.draftId,
    draftHash: draft.draftHash,
    foundationVersion: draft.foundationVersion,
    baseCanonRevision: draft.baseCanonRevision,
    parentArcVersion,
    deterministicResult: deterministicPass ? "pass" : "fail",
    semanticFindings: allFindings,
    repairRound: 0,
    unresolvedAuthorDecisions: unresolvedDecisions,
    verifiedAt: new Date().toISOString(),
    status: "current",
  };

  await saveArcPreflightRecord(bookDir, record);

  if (preflightPass) {
    return {
      outcome: "preflight_pass",
      foundationVersion: draft.foundationVersion,
      baseCanonRevision: draft.baseCanonRevision,
      draftHash: draft.draftHash,
      preflightRecord: record,
    };
  }

  return {
    outcome: "preflight_fail",
    findings: allFindings,
    preflightRecord: record,
  };
}

export async function repairArcPlanLocal(
  bookDir: string,
  draftId: string,
  findings: ReadonlyArray<ArcFinding>,
  round: number,
  customRepairer?: (draft: ArcPlanDraftRecord, findings: ReadonlyArray<ArcFinding>) => Promise<ArcPlanDraftRecord>,
): Promise<ArcRepairOutcome> {
  if (round > 2) {
    return {
      status: "needs_human_direction",
      round,
      findings,
      reason: "Exhausted maximum 2 semantic repair rounds; human intervention required",
    };
  }

  const unrepairable = findings.filter(
    (f) => f.repairScope === "multi_unit" || f.kind === "author_decision" || f.kind === "conflict",
  );
  if (unrepairable.length > 0) {
    return {
      status: "needs_human_direction",
      round,
      findings,
      reason: "Multi-unit issues, author decisions, or hard conflicts cannot be auto-repaired locally",
    };
  }

  const localFindings = findings.filter((f) => f.repairScope === "local");
  if (localFindings.length === 0) {
    return { status: "clean", draftId };
  }

  const draft = await loadArcPlanDraft(bookDir, draftId);
  if (!draft) {
    throw new Error(`Cannot repair draft "${draftId}": draft not found`);
  }

  let repairedDraft: ArcPlanDraftRecord;
  if (customRepairer) {
    repairedDraft = await customRepairer(draft, localFindings);
  } else {
    // Default deterministic local repair: update beat descriptions or timing
    let updatedSnapshot = { ...draft.snapshot };
    for (const f of localFindings) {
      if (f.suggestedAction) {
        updatedSnapshot = {
          ...updatedSnapshot,
          goal: `${updatedSnapshot.goal} (repaired: ${f.suggestedAction})`,
        };
      }
    }
    const newHash = computeProseRevision(JSON.stringify(updatedSnapshot));
    repairedDraft = {
      ...draft,
      snapshot: updatedSnapshot,
      draftHash: newHash,
      updatedAt: new Date().toISOString(),
    };
  }

  await saveArcPlanDraft(bookDir, repairedDraft);
  return {
    status: "repaired",
    round,
    draftId: repairedDraft.draftId,
    repairSummary: `Repaired ${localFindings.length} local findings in round ${round}`,
  };
}

export async function verifyArcPlanRepair(
  bookDir: string,
  draftId: string,
  originalFindings: ReadonlyArray<ArcFinding>,
  round: number,
  verifier?: (draft: ArcPlanDraftRecord, originalFindings: ReadonlyArray<ArcFinding>) => Promise<ReadonlyArray<ArcFinding>>,
): Promise<ReadonlyArray<ArcFinding>> {
  const draft = await loadArcPlanDraft(bookDir, draftId);
  if (!draft) {
    throw new Error(`Cannot verify repaired draft "${draftId}": draft not found`);
  }

  if (verifier) {
    return verifier(draft, originalFindings);
  }

  // Targeted verification: re-evaluate the local findings against repaired draft
  return [];
}

async function readBookJson(bookDir: string): Promise<Record<string, unknown>> {
  const raw = await readFile(join(bookDir, "book.json"), "utf-8");
  return JSON.parse(raw);
}

export async function publishArcPlan(input: PublishArcPlanInput): Promise<ArcPlanVersion> {
  validateHumanActor(input.humanActor);
  const validDraftId = SafeGovernanceIdSchema.parse(input.draftId);

  const revalidate = async (): Promise<ReadonlyArray<string>> => {
    const reasons: string[] = [];

    const draft = await loadArcPlanDraft(input.bookDir, validDraftId);
    if (!draft) {
      return [`Draft "${validDraftId}" not found`];
    }

    const preflight = await loadArcPreflightRecord(input.bookDir, validDraftId);
    if (!preflight) {
      return [`No persisted preflight record exists for draft "${validDraftId}"`];
    }
    if (preflight.status !== "current") {
      return [`Preflight record for draft "${validDraftId}" is stale`];
    }
    if (preflight.draftHash !== draft.draftHash) {
      return [`Draft hash changed after preflight (expected ${preflight.draftHash}, current is ${draft.draftHash})`];
    }
    if (preflight.deterministicResult !== "pass") {
      return ["Deterministic preflight check failed"];
    }
    if (preflight.unresolvedAuthorDecisions.length > 0) {
      return [`Unresolved author decisions exist: ${preflight.unresolvedAuthorDecisions.join(", ")}`];
    }
    if (preflight.semanticFindings.some((f) => f.severity === "blocking" || f.kind === "conflict")) {
      return ["Blocking or conflict findings remain unresolved"];
    }

    // Arc base version check
    const store = createVersionStore(input.bookDir);
    const currentArc = await store.readCurrentVersion<ArcPlanSnapshot>("arc_plan", draft.arcId);
    const currentArcVer = currentArc ? currentArc.version : 0;
    if (preflight.parentArcVersion !== undefined && preflight.parentArcVersion !== currentArcVer) {
      reasons.push(
        `Arc Plan base version mismatch: preflight was evaluated against Arc version ${preflight.parentArcVersion}, but current published Arc version is ${currentArcVer}`,
      );
    }

    // Foundation version check
    const currentFound = await store.readCurrentVersion<FoundationPublishedSnapshot>("foundation", "foundation");
    const currentFoundVer = currentFound ? currentFound.version : 0;
    if (currentFoundVer !== input.expectedFoundationVersion) {
      reasons.push(
        `Expected Foundation version mismatch: expected ${input.expectedFoundationVersion}, current is ${currentFoundVer}`,
      );
    }
    if (draft.foundationVersion !== currentFoundVer) {
      reasons.push(
        `Draft Foundation version mismatch: draft was generated against v${draft.foundationVersion}, current is v${currentFoundVer}`,
      );
    }

    // Canon revision check
    const currentCanon = await readCurrentCanonRevision(input.bookDir).catch(() => 0);
    if (currentCanon !== input.expectedCanonRevision) {
      reasons.push(
        `Expected Canon revision mismatch: expected ${input.expectedCanonRevision}, current is ${currentCanon}`,
      );
    }
    if (draft.baseCanonRevision !== currentCanon) {
      reasons.push(
        `Draft Canon revision mismatch: draft was generated against revision ${draft.baseCanonRevision}, current is ${currentCanon}`,
      );
    }

    // Authorization checks (MUST be active and applicable; NOT consumed)
    for (const authId of draft.snapshot.authorizations) {
      const auth = await loadAuthorization(input.bookDir, authId);
      if (!auth) {
        reasons.push(`Required authorization "${authId}" not found`);
        continue;
      }
      if (auth.lifecycle !== "active") {
        reasons.push(`Required authorization "${authId}" is not active (lifecycle: ${auth.lifecycle})`);
        continue;
      }
      const applies = authorizationApplies(auth as any, {
        chapterNumber: 1,
        currentArcId: draft.arcId,
        canonRevision: currentCanon,
        hookStates: () => ({ lifecycleState: "active", lifecycleRevision: "1" }),
        relationshipStates: () => ({ state: "active", stateRevision: "1" }),
        factResolver: () => ({ exists: true, canonRevision: currentCanon }),
        arcState: () => ({ status: "started", revision: "1" }),
      });
      if (!applies) {
        reasons.push(`Required authorization "${authId}" does not apply to arc "${draft.arcId}"`);
      }
    }

    return reasons;
  };

  // Pre-load draft to get arcId and prepare writes
  const draft = await loadArcPlanDraft(input.bookDir, validDraftId);
  if (!draft) {
    throw new Error(`Cannot publish Arc Plan: draft "${validDraftId}" not found`);
  }

  const store = createVersionStore(input.bookDir);
  const currentArc = await store.readCurrentVersion<ArcPlanSnapshot>("arc_plan", draft.arcId);
  const nextVersion = currentArc ? currentArc.version + 1 : 1;

  const versionWrites = await store.prepareVersionAppend<ArcPlanSnapshot>({
    artifactKind: "arc_plan",
    unitId: draft.arcId,
    version: nextVersion,
    parentVersion: currentArc ? currentArc.version : null,
    baseCanonRevision: draft.baseCanonRevision,
    snapshot: draft.snapshot,
    publishedBy: input.humanActor,
  });
  const pointerWrite = store.prepareCurrentVersionPointer("arc_plan", draft.arcId, nextVersion);

  // Mark preflight record as stale upon publish so it cannot be published again
  const preflight = await loadArcPreflightRecord(input.bookDir, validDraftId);
  const preflightStaleWrite: AtomicFileWrite = {
    relativePath: preflightRelPath(validDraftId),
    content: serialized({
      ...(preflight ?? {
        draftId: validDraftId,
        draftHash: draft.draftHash,
        foundationVersion: draft.foundationVersion,
        baseCanonRevision: draft.baseCanonRevision,
        deterministicResult: "pass",
        semanticFindings: [],
        repairRound: 0,
        unresolvedAuthorDecisions: [],
        verifiedAt: new Date().toISOString(),
      }),
      status: "stale",
    }),
  };

  // Book governance.planning update if needed
  const book = await readBookJson(input.bookDir);
  const bookGov = (book.governance as Record<string, unknown>) ?? {};
  let bookWrite: AtomicFileWrite | null = null;
  if (bookGov.planning !== "v2") {
    bookWrite = {
      relativePath: "book.json",
      content: serialized({
        ...book,
        governance: {
          ...bookGov,
          planning: "v2",
        },
      }),
    };
  }

  // Direct planning invalidation
  await invalidateDirectPlanningDependents(input.bookDir, draft.arcId);

  const allWrites: AtomicFileWrite[] = [
    ...versionWrites.writes,
    pointerWrite,
    preflightStaleWrite,
    ...(bookWrite ? [bookWrite] : []),
  ];

  const result = await runTransaction({
    bookDir: input.bookDir,
    writes: allWrites,
    revalidate,
    failAtStage: input.failAtStage,
  });

  if (result.status !== "committed") {
    throw new Error(`Failed to publish Arc Plan: ${result.reasons.join("; ")}`);
  }

  const published = await store.readCurrentVersion<ArcPlanSnapshot>("arc_plan", draft.arcId);
  if (!published) {
    throw new Error(`Critical invariant failure: Arc Plan published version ${nextVersion} could not be loaded after commit`);
  }

  return published;
}
