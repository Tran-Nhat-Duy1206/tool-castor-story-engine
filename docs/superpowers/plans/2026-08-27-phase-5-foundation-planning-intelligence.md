# Phase 5 Foundation + Planning Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved Phase 5 Foundation + Planning
Intelligence architecture while preserving Phase 4 Canon settlement,
legacy InkOS compatibility, and the one-chapter human execution boundary.

**Architecture:** Phase 5 adds an **Evolutionary Governance Kernel** on top of the
existing Castor pipeline: Foundation and Arc Plan become versioned, human-published
authority artifacts (Markdown content + structured governance manifests); Planning
produces advisory Lookahead and execution-proposal Detailed Chapter Plans; a
deterministic+semantic risk gate and an immutable Execution Snapshot bound each Writer
attempt. Core owns authority, readiness, dependencies, conflicts, authorizations,
versions, transactions and provenance; AI proposes, Human authorizes, Canon records
reality — reusing the existing Architect/Planner/Writer, Phase 4 State Review, atomic
persistence, retrieval, Studio and CLI rather than building a parallel system.

**Tech Stack:** TypeScript (ESM), pnpm workspace (`packages/core` / `packages/cli` /
`packages/studio`), zod schemas with `z.infer` types (repo convention,
`packages/core/src/models/*`), vitest (`--no-file-parallelism` serial runs on this
machine), Hono + React (Studio, `packages/studio/src/api/server.ts`), commander (CLI),
Node 22+, SQLite FTS5 memory/retrieval. Phase 4 precedent for Studio integration:
`stateReviewBase` route block in `server.ts` + typed client
(`packages/studio/src/lib/state-review-api.ts`) + page (`pages/StateReviewPage.tsx`).

**Spec:**
docs/superpowers/specs/2026-08-27-phase-5-foundation-planning-intelligence-design.md

---

## Repository audit summary (grounding)

Verified current files this plan builds on (paths under `packages/`):

- **Foundation/Architect:** `core/src/agents/architect.ts` (`ArchitectAgent`, `ArchitectOutput`,
  `ArchitectIncompleteFoundationError`), `core/src/agents/foundation-reviewer.ts`
  (`FoundationReviewerAgent`, `FoundationReviewResult`), `core/src/utils/outline-paths.ts`
  (`isBookFoundationComplete`; layout `story/outline/story_frame.md`, `story/outline/volume_map.md`,
  `story/book_rules.md`, `story/pending_hooks.md`, `story/roles/<tier>/*.md`, with
  `story_bible.md`/`book_rules.md`/`character_matrix.md` as compat shims).
- **Planning:** `core/src/agents/planner.ts` (`PlanChapterInput/Output`, `PlannerAgent`),
  `core/src/agents/planner-context.ts` (brief/roles/rules/summaries readers),
  `core/src/agents/planner-prompts.ts`, `core/src/models/input-governance.ts`
  (`ChapterIntentSchema`, `ChapterMemoSchema`), `core/src/pipeline/persisted-governed-plan.ts`
  (`savePersistedPlan`/`loadPersistedPlan`).
- **Writer/pipeline:** `core/src/pipeline/runner.ts` (`writeNextChapter`, governed
  proposal publication), `core/src/pipeline/chapter-review-cycle.ts`,
  `core/src/pipeline/chapter-truth-validation.ts`, `core/src/agents/writer.ts`.
- **Phase 4:** `core/src/state/state-review-{store,service,items,confirm,finalize,temporal}.ts`,
  `core/src/state/advancement-gate.ts`, `core/src/models/state-review.ts`; Studio
  `server.ts` `stateReviewBase` routes + `lib/state-review-api.ts` + `pages/StateReviewPage.tsx`.
- **Persistence:** `core/src/utils/atomic-file-set.ts` (`commitAtomicFileSet`),
  `core/src/state/manager.ts` (book dirs, control documents, lock), `core/src/state/snapshot-set.ts`,
  `core/src/state/state-bootstrap.ts`, `core/src/state/runtime-state-store.ts`
  (`StateManifestSchema`, `lastAppliedChapter`), `core/src/utils/prose-revision.ts`
  (`computeProseRevision`).
- **Context/retrieval:** `core/src/utils/context-assembly.ts`, `governed-context.ts`,
  `governed-working-set.ts`, `context-filter.ts` (existing `[Castor context budget: …]` guard),
  `core/src/utils/memory-retrieval.ts`, `core/src/state/memory-db.ts`, `memory-sync.ts`.
- **Hooks:** `core/src/utils/hook-{governance,lifecycle,arbiter,promotion,stale-detection,policy}.ts`
  (runtime hook dispositions: mention/advance/resolve/defer).
- **Provider:** `core/src/llm/provider.ts` (context-window guard with
  `estimatedInputTokens`/`reservedOutputTokens`; token usage shape
  `promptTokens`/`completionTokens`/`totalTokens`).
- **Studio:** `pages/BookDetail.tsx`, `pages/TruthFiles.tsx`, `pages/ChapterReader.tsx`,
  `pages/StateReviewPage.tsx`, `components/` (nav/sidebar), 146 API routes in `server.ts`.
- **CLI:** `commands/{write,plan,status,review,chapter,compose,draft,audit,revise}.ts`,
  `localization.ts`, `program.ts`.
- **Tests:** `core/src/__tests__/state-review-*.test.ts`, `pipeline-runner.gated.test.ts`,
  `studio/src/__tests__/state-review-route.test.ts`, `studio/src/pages/state-review-ui-state.test.ts`,
  `cli/src/__tests__/write-command.test.ts` — these are the contracts Phase 5 must not regress.

No `governance` capability/version markers exist yet anywhere (verified); they are new.

---

## Global constraints (from the approved spec)

- AI proposes; Core governs; Human authorizes; Canon records reality.
- No lower layer expands higher authority.
- Canon owns established past; Foundation/Arc authority requires Human Publish.
- Human Direction / Authorization require explicit Human confirmation.
- Phase 4 Final Confirm remains the Canon settlement boundary.
- Direct declared dependency invalidation only — no recursive cascade at change time.
- Approved/published Foundation is AI-readable and AI-immutable.
- Published versions immutable; restore-as-new-revision, never backward pointer moves.
- No silent semantic `CANON_CONFLICT` classification by AI (deterministic Core only).
- Lookahead is advisory only; scores are informational only.
- Authorization consumes only on Canon evidence.
- Writer cannot run without a valid immutable Execution Snapshot.
- One deliberate Write action produces at most one chapter.
- P0 authority context is never silently dropped; no automatic model switching to
  escape the context budget.
- Old InkOS-derived books keep working before V2 adoption; preserve `inkos.json`,
  `INKOS_*`, `.inkos/` compatibility unless a justified migration requires otherwise.
- No Phase 6 deep prose-autonomy leakage; no Phase 7 Story Intelligence leakage.
- No production authority bypass flags (`--force`, `--ignore-canon`, `--skip-authority`).
- No `v0.2.0` until the Phase 5 completion gate passes and the human accepts it.

---

## Planned File / Responsibility Map

New files (all under `packages/`; tests beside sources per repo convention
`core/src/__tests__/`, `studio/src/__tests__/`, `cli/src/__tests__/`):

| Path | Responsibility | Extends |
|---|---|---|
| `core/src/governance/contracts.ts` | Capability/version markers + ALL stable vocabularies (unit kinds, statuses, importance, character reasons, relationship tiers, hook lifecycle, authorization scopes/conditions, decision kinds, direction scopes/lifecycle, beat categories, finding severity/scope, conflict kinds, gate results) | zod pattern of `models/state-review.ts` |
| `core/src/governance/readiness.ts` | `ReadinessEvaluator` — blockingReasons/warnings/nextRecommendedAction for units, Foundation, Arc, chapter | `core/src/models/chapter.ts` status vocabulary |
| `core/src/governance/dependencies.ts` | `DependencyManager` — Core-owned dep semantics, concrete links, direct-only invalidation, graph validity | `hook-governance.ts` disposition patterns |
| `core/src/governance/conflicts.ts` | Two-layer conflict classifier (deterministic Core vs semantic AI) + Human Resolution Record | `state-review-temporal.ts` revision checks |
| `core/src/governance/authorizations.ts` | Author Decision vocabulary, Authorization schema/scope/conditions/consumption | contracts.ts |
| `core/src/governance/versions.ts` | Immutable published versions, current-materialized pointer, restore-as-new-revision, external-change detection | `snapshot-set.ts` + `prose-revision.ts` |
| `core/src/governance/transactions.ts` | `TransactionCoordinator` (PREPARE/VALIDATE/STAGE/JOURNAL/COMMIT/MATERIALIZE/FINALIZE) | `utils/atomic-file-set.ts` |
| `core/src/governance/provenance.ts` | Provenance recorder (version/evidence/resolution provenance records) | `state-review-store.ts` receipt patterns |
| `core/src/foundation/manifest.ts` | Foundation V2 unit manifests (identity/kind/importance/status/deps/revision/approval/staleness/provenance) keyed to existing Markdown layout | `outline-paths.ts` layout constants |
| `core/src/foundation/bootstrap.ts` | Legacy markdown → `legacy_established` unit import; capability-mode resolution; upgrade preflight | `isBookFoundationComplete` |
| `core/src/foundation/review.ts` | Finding schema, reviewer-only diagnosis, bounded repair policy (2 rounds), verification invocation | `FoundationReviewerAgent` |
| `core/src/foundation/publish.ts` | Publish gate + transactional publication + external-edit Compare/Adopt/Discard | governance/transactions.ts |
| `core/src/foundation/pipeline.ts` | Adaptive intake (0–3 MUST-KNOW gaps), global generate → global review → local repair orchestration | `ArchitectAgent` |
| `core/src/planning/arc-plan.ts` | Arc Plan schema, immutable versions, Human Publish boundary, restore | governance/versions.ts |
| `core/src/planning/beats.ts` | Major Beat lifecycle/importance/categories + Canon-evidence evaluation (deterministic + semantic) | `state-review-items.ts` evidence patterns |
| `core/src/planning/lookahead.ts` | Rolling Lookahead lifecycle (advisory), 2–3 chapter horizon, selective invalidation | — |
| `core/src/planning/detailed-plan.ts` | Detailed Chapter Plan V2 evolving `ChapterIntent/ChapterMemo`, binding fields, PLAN_SCOPE_TOO_BROAD | `models/input-governance.ts` |
| `core/src/planning/gate.ts` | Planning Gate L1 (deterministic) + L2 (semantic) + truth-table resolution + bounded repair | governance/readiness.ts |
| `core/src/planning/transition.ts` | Arc completion outcomes + auto/blocked transition | planning/beats.ts |
| `core/src/context/composer.ts` | Authority Spine + dependency retrieval + continuity + semantic supplement; P0–P4 profiles | `context-assembly.ts`/`governed-context.ts` |
| `core/src/context/bundle.ts` | ContextBundle schema + provenance + staleness | `models/context-compression.ts` |
| `core/src/context/budget.ts` | Budget policy (reserve output, deterministic projection, soft trim, semantic compression allowlist, no auto model switch, CONTEXT_BUDGET_EXCEEDED) | `llm/provider.ts` guard |
| `core/src/execution/snapshot.ts` | Atomic Execution Snapshot freeze + provenance + prepare-race failure | governance/transactions.ts |
| `core/src/execution/attempt.ts` | Attempt lifecycle + defect routing (PROSE/PLAN/AUTHORITY/CANON) + 2-replan cap | `pipeline/runner.ts` |
| `core/src/state/settlement-integration.ts` | Post-Canon settlement: authorization consumption (atomic), dependency impact, Beat evidence, Lookahead revalidation, Arc readiness | `state-review-finalize.ts` |
| `core/src/index.ts` | Public barrel exports for new modules | existing barrel |
| `studio/src/lib/foundation-api.ts`, `planning-api.ts` | Typed clients (StateReviewPage precedent) | `lib/state-review-api.ts` |
| `studio/src/pages/FoundationPage.tsx`, `PlanningPage.tsx` (+ `*-ui-state.ts`/`.test.ts`) | Unit review/revision/publish UI; Arc/Beat/Lookahead/detailed-plan UI | `pages/StateReviewPage.tsx` pattern |
| `studio/src/api/server.ts` | Route blocks (foundation/planning bases) consuming Core ops only | `stateReviewBase` pattern |
| `cli/src/commands/foundation.ts`, `planning.ts`; modify `status.ts`, `write.ts` | Safe operational surface + readiness blockers; gates respected in `write next` | `commands/doctor.ts` pattern |

Justified split: none of the existing files are refactored; new modules live beside them.
`pipeline/runner.ts` gains a thin integration call site in the settlement task only.

---

## Expected implementation order (mapped to tasks)

```
1  → T1    governance domain contracts / capability markers / vocabularies
2  → T2    Foundation V2 unit manifest representation
3  → T3    legacy bootstrap + capability-mode resolution
4  → T4    readiness + dependencies + direct invalidation
5  → T5    revisions + immutable publication + restore
6  → T6    conflict classification + Human Resolution
7  → T7    reviewer findings + bounded repair
8  → T8    Publish transaction/recovery + external edits
9  → T9    Foundation pipeline orchestration (adaptive intake → publish)
10 → T10   Human Direction + Authorization durable governance
11 → T11   Arc Plan + Major Beat authority/versioning
12 → T12   Rolling Lookahead lifecycle + selective invalidation
13 → T13   Detailed Chapter Plan V2
14 → T14   Planning Gate (deterministic + semantic + truth table)
15 → T15   Context Composer (spine/profiles/budget/provenance)
16 → T16   Execution Snapshot + attempt lifecycle
17 → T17   Phase 4 settlement integration (consumption/evidence/revalidation)
18 → T18   Arc completion / transition
19 → T19   Studio governance surfaces
20 → T20   CLI safe operational integration
21 → T21   legacy upgrade E2E / compatibility / recovery scenarios
22 → T22   final Phase 5 acceptance (Definition of Done)
```

The order follows the spec's dependency direction; the only material departures are
(a) Context Composer (bucket 12) placed after the Planning Gate because gate outcomes
drive profile content, and (b) Arc completion merged into one task (bucket 15). Both
are consistent with the spec's own cross-references.

---

## Task 1 — Governance domain contracts, capability markers, stable vocabularies

**Files**
- Create `packages/core/src/governance/contracts.ts`
- Create `packages/core/src/__tests__/governance-contracts.test.ts`

**Interfaces** (zod, repo convention)

```ts
// capability/version markers — explicit marker wins; absence => legacy
export const FoundationGovernanceModeSchema = z.enum(["legacy", "v2"]);
export const PlanningGovernanceModeSchema = z.enum(["legacy", "v2"]);
export const GovernanceMarkersSchema = z.object({
  foundation: FoundationGovernanceModeSchema.default("legacy"),
  planning: PlanningGovernanceModeSchema.default("legacy"),
});
export type GovernanceMarkers = z.infer<typeof GovernanceMarkersSchema>;

export const FoundationUnitKindSchema = z.enum([
  "story_frame", "character", "relationship_intent", "arc_direction",
  "book_rule", "foundation_hook", "timeline_anchor", "timeline_constraint",
]);
export const FoundationUnitStatusSchema = z.enum([
  "missing", "draft", "needs_review", "approved", "needs_revision",
  "stale", "legacy_established",
]);
export const ImportanceSchema = z.enum(["required", "optional"]);
export const CharacterReasonSchema = z.enum([
  "protagonist", "co_protagonist", "core_conflict_participant",
  "primary_antagonist", "central_relationship", "arc_required",
  "supporting", "future_only", "minor",
]);
export const RelationshipTierSchema = z.enum(["central", "arc_relevant", "runtime_only"]);
export const HookLifecycleStateSchema = z.enum([
  "proposed", "active", "advanced", "dormant", "ready_for_payoff",
  "resolved", "deferred", "abandoned",
]);
export const HookAuthorityLevelSchema = z.enum(["foundation_hook", "runtime_hook"]);
export const TimelineConstraintKindSchema = z.enum(["hard", "soft", "target"]);
export const BookRuleKindSchema = z.enum([
  "pov", "language", "style", "content_boundary", "world_invariant",
  "character_invariant", "relationship_constraint", "structure_constraint",
]);
export const AuthorizationScopeSchema = z.enum([
  "exact_chapter", "chapter_window", "arc", "condition", "from_arc",
]);
export const AuthorizationConditionKindSchema = z.enum([
  "after_hook_advanced", "after_hook_resolved", "after_arc_started",
  "after_arc_climax", "after_chapter", "after_relationship_state", "after_fact_exists",
]);
export const AuthorizationConsumptionSchema = z.enum(["one_time", "reusable"]);
export const AuthorDecisionKindSchema = z.enum([
  "major_character_death", "identity_reveal", "relationship_commitment",
  "relationship_break", "major_goal_change", "major_alliance_change",
  "major_betrayal", "major_secret_reveal", "major_hook_resolution",
  "antagonist_role_change", "world_rule_exception", "major_timeline_jump",
  "arc_direction_change", "ending_direction_change",
]);
export const HumanDirectionScopeSchema = z.enum([
  "exact_chapter", "chapter_window", "arc", "until_condition",
]);
export const HumanDirectionLifecycleSchema = z.enum([
  "active", "satisfied", "unsatisfied", "expired", "superseded", "cancelled",
]);
export const BeatCategorySchema = z.enum([
  "event", "fact_change", "hook_state", "relationship_change",
  "character_change", "goal_change", "knowledge_change", "pressure_change", "arc_turn",
]);
export const BeatStatusSchema = z.enum([
  "pending", "in_progress", "satisfied", "blocked", "superseded",
]);
export const LookaheadStatusSchema = z.enum(["current", "stale", "superseded", "consumed"]);
export const FindingSeveritySchema = z.enum(["minor", "important", "blocking"]);
export const RepairScopeSchema = z.enum(["local", "multi_unit", "author_decision"]);
export const CanonConflictKindSchema = z.enum(["future_safe", "uncertain", "canon_conflict"]);
export const GateResultSchema = z.enum(["safe", "uncertain", "author_decision", "conflict"]);
export const ArcCompletionOutcomeSchema = z.enum([
  "not_ready", "ready_to_close", "arc_completion_uncertain",
]);
export const AttemptDefectSchema = z.enum([
  "prose_defect", "plan_defect", "authority_defect", "canon_conflict",
]);
```

**Steps**

- [ ] Write the failing test (schemas parse every canonical member; reject unknown
      values; markers default to `legacy` when absent; explicit `"v2"` marker wins;
      a marker with an unknown value fails closed). Run
      `pnpm --filter @actalk/inkos-core exec vitest run src/__tests__/governance-contracts.test.ts`
      and verify failure (module missing).
- [ ] Implement `contracts.ts`; re-run targeted test → PASS.
- [ ] Run `pnpm --filter @actalk/inkos-core exec vitest run src/__tests__/models.test.ts` (regression).
- [ ] Typecheck (`pnpm --filter @actalk/inkos-core exec tsc --noEmit`), `git diff --check`, review diff.
- [ ] Commit `feat(core): phase 5 governance domain contracts and vocabularies`.

## Task 2 — Foundation V2 unit manifest representation

**Files**
- Create `packages/core/src/foundation/manifest.ts`
- Create `packages/core/src/__tests__/foundation-manifest.test.ts`

**Interfaces**

```ts
export interface FoundationUnitManifest {
  readonly unitId: string;
  readonly kind: FoundationUnitKind;
  readonly importance: Importance;
  readonly status: FoundationUnitStatus;
  readonly sourceRelPath: string;            // existing markdown file under story/
  readonly contentHash: string;              // computeProseRevision(content)
  readonly dependencies: ReadonlyArray<{ kind: string; targetUnitId: string }>;
  readonly revision: number;                 // 0 = never published
  readonly approvedAt?: string;
  readonly approvedBy?: string;
  readonly stale?: boolean;
  readonly provenance?: Record<string, unknown>;
}
export async function readUnitManifests(bookDir: string): Promise<Map<string, FoundationUnitManifest>>;
export async function writeUnitManifest(bookDir: string, manifest: FoundationUnitManifest): Promise<void>;
export function resolveFoundationUnitSource(kind: FoundationUnitKind, unitId: string): string; // maps to story_frame/roles/book_rules/... layout
```

Unit-id derivation is deterministic (kind + stable slug from the existing markdown
basename). Manifest files live under a governance directory inside the book
(`story/foundation-v2/<unit-id>.gov.json`); Markdown remains the creative content
authority and is never duplicated into the manifest.

**Steps**

- [ ] Write failing tests: round-trip write/read; content hash mismatch detected on
      read; unknown kind rejected; manifest never contains creative prose (schema has
      no content field); `resolveFoundationUnitSource` maps every kind onto an
      existing layout path from `utils/outline-paths.ts` constants.
- [ ] Implement `manifest.ts`; targeted run → PASS.
- [ ] Run nearby regressions (`outline-paths`/architect tests), typecheck, diff check.
- [ ] Commit `feat(core): foundation v2 unit manifests over existing markdown layout`.

## Task 3 — Legacy Foundation bootstrap + capability-mode resolution

**Files**
- Create `packages/core/src/foundation/bootstrap.ts`
- Create `packages/core/src/__tests__/foundation-bootstrap.test.ts`

**Interfaces**

```ts
export interface BootstrapResult {
  readonly mode: FoundationGovernanceMode;   // explicit marker or legacy
  readonly units: ReadonlyArray<FoundationUnitManifest>;
  readonly legacyUpgradeReady: boolean;
}
export async function bootstrapFoundation(bookDir: string): Promise<BootstrapResult>;
export async function upgradeFoundationToV2(bookDir: string): Promise<{ publishedVersion: number }>;
```

Rules: legacy books parse the existing layout into `legacy_established` units (NOT
approved); books with existing chapters stay in compatibility mode; upgrade is opt-in
and rewrites NO chapter prose or historical Canon (assert content hashes unchanged).

**Steps**

- [ ] Write failing tests: legacy book → units `legacy_established`, none approved;
      upgrade publishes V2 v1 without touching chapters/Canon (prose hashes +
      `story/state/*.json` byte-identical); explicit `"v2"` marker skips bootstrap;
      unknown marker fails closed.
- [ ] Implement `bootstrap.ts`; targeted run → PASS.
- [ ] Regressions: `pipeline-runner.test.ts` bootstrap tests; typecheck; diff check.
- [ ] Commit `feat(core): legacy foundation bootstrap and v2 capability markers`.

## Task 4 — Foundation readiness, dependencies, direct invalidation

**Files**
- Create `packages/core/src/governance/readiness.ts`
- Create `packages/core/src/governance/dependencies.ts`
- Create `packages/core/src/__tests__/governance-readiness.test.ts`
- Create `packages/core/src/__tests__/governance-dependencies.test.ts`

**Interfaces**

```ts
export interface ReadinessReport {
  readonly blockingReasons: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
  readonly nextRecommendedAction: string | null;
}
export async function evaluateFoundationReadiness(
  bookDir: string, manifests: ReadonlyArray<FoundationUnitManifest>,
): Promise<ReadinessReport>;
export async function evaluateChapter1Readiness(bookDir: string): Promise<ReadinessReport>;
export function declareDependency(unitId: string, kind: string, targetUnitId: string): void;
export async function invalidateDirectDependents(bookDir: string, unitId: string): Promise<ReadonlyArray<string>>;
export function validateDependencyGraph(manifests: ReadonlyArray<FoundationUnitManifest>): ReadonlyArray<string>;
```

Negative guarantees tested: changing A marks only direct dependents B stale — C (depends
on B) stays non-stale until B's authoritative content actually changes; required units
block readiness; optional units do not block unless a downstream authoritative artifact
depends on them; protagonist always required; graph cycles rejected.

**Steps**

- [ ] Write failing tests incl. the direct-only invalidation scenario (A→B→C) and
      optional-gating-when-depended; run targeted → fail.
- [ ] Implement; targeted → PASS; regressions (`outline-paths`), typecheck.
- [ ] Commit `feat(core): foundation readiness and direct dependency invalidation`.

## Task 5 — Foundation revisions, immutable publication, restore-as-new-revision

**Files**
- Create `packages/core/src/governance/versions.ts`
- Create `packages/core/src/__tests__/governance-versions.test.ts`

**Interfaces**

```ts
export interface PublishedVersion {
  readonly artifactKind: "foundation" | "arc_plan";
  readonly unitId: string;
  readonly version: number;
  readonly parentVersion: number | null;
  readonly baseCanonRevision: number;
  readonly contentHash: string;
  readonly manifestSnapshot: FoundationUnitManifest;
  readonly publishedAt: string;
  readonly publishedBy: string;
  readonly restoredFromVersion?: number;
}
export async function publishVersion(
  bookDir: string, v: Omit<PublishedVersion, "version" | "publishedAt">,
): Promise<PublishedVersion>;
export async function restoreAsNewRevision(
  bookDir: string, artifactKind: "foundation" | "arc_plan", unitId: string, fromVersion: number,
): Promise<PublishedVersion>;
export function detectExternalChange(bookDir: string, unitId: string): Promise<"match" | "external_change_detected">;
```

Rules: published versions immutable (publish rejects a content hash change for the same
version); authority pointer never moves backwards; restore always creates a new version
against current Foundation/Canon; external markdown edits are detected via content hash
vs approved revision.

Fault injection (introduced here, reused by later tasks): failure before staging,
after staging, before COMMIT, after durable COMMIT, during current-materialization —
assert old authority survives pre-COMMIT, new committed authority survives post-COMMIT
with materialization rebuilt.

**Steps**

- [ ] Write failing tests incl. immutability, restore-as-new-version, external-change
      detection, and the two crash semantics; run targeted → fail.
- [ ] Implement `versions.ts` (reusing `commitAtomicFileSet` + a journal file);
      targeted → PASS.
- [ ] Regressions (`state-review-confirm` receipt patterns), typecheck.
- [ ] Commit `feat(core): immutable foundation version publication and restore`.

## Task 6 — Conflict classification (two-layer) + Human Resolution Record

**Files**
- Create `packages/core/src/governance/conflicts.ts`
- Create `packages/core/src/__tests__/governance-conflicts.test.ts`

**Interfaces**

```ts
export interface ConflictEvidence { readonly source: string; readonly detail: string; }
export type FoundationConflictResult =
  | { kind: "future_safe"; evidence: ReadonlyArray<ConflictEvidence> }
  | { kind: "uncertain"; evidence: ReadonlyArray<ConflictEvidence>; semanticConcern: string }
  | { kind: "canon_conflict"; evidence: ReadonlyArray<ConflictEvidence>; canonRevision: number };
export function classifyCanonConflictDeterministic(bookDir: string, unit: FoundationUnitManifest): Promise<FoundationConflictResult>;
export function classifyCanonConflictSemantic(unit: FoundationUnitManifest): Promise<Extract<FoundationConflictResult, { kind: "uncertain" | "future_safe" }>>;
export interface HumanResolutionRecord {
  readonly resolutionId: string;
  readonly revision: number;
  readonly unitId: string;
  readonly findingId: string;
  readonly evidence: ReadonlyArray<ConflictEvidence>;
  readonly canonRevision: number;
  readonly resolver: string;
  readonly choice: "compatible" | "revise";
}
export async function recordHumanResolution(bookDir: string, r: HumanResolutionRecord): Promise<void>;
export async function isResolutionStillValid(bookDir: string, resolutionId: string): Promise<boolean>;
```

Negative guarantees: the semantic layer can emit `uncertain` but NEVER `canon_conflict`;
a hard `canon_conflict` requires deterministic Core evidence; a recorded resolution is
invalidated when its bound evidence or Canon revision changes.

**Steps**

- [ ] Write failing tests for the negative guarantees; targeted → fail.
- [ ] Implement; targeted → PASS; typecheck; diff check.
- [ ] Commit `feat(core): two-layer foundation conflict classification and human resolutions`.

## Task 7 — Foundation reviewer findings + bounded repair

**Files**
- Create `packages/core/src/foundation/review.ts`
- Create `packages/core/src/__tests__/foundation-review.test.ts`

**Interfaces**

```ts
export interface FoundationFinding {
  readonly findingId: string;
  readonly unitId: string;
  readonly category: string;
  readonly severity: FindingSeverity;
  readonly repairScope: RepairScope;
  readonly evidence: string;
  readonly suggestedAction: string;
}
export type RepairOutcome =
  | { status: "repaired"; round: number }
  | { status: "needs_human_direction"; round: number; remaining: ReadonlyArray<FoundationFinding> }
  | { status: "clean" };
export async function reviewFoundation(bookDir: string): Promise<ReadonlyArray<FoundationFinding>>;
export async function applyBoundedRepair(bookDir: string, round: number): Promise<RepairOutcome>;
export async function verifyRepairs(bookDir: string, round: number): Promise<ReadonlyArray<FoundationFinding>>;
```

Policy encoded and tested: MINOR+LOCAL auto-repairs; IMPORTANT+LOCAL auto-repairs with
mandatory targeted re-review; MULTI_UNIT never silently repaired; AUTHOR_DECISION routes
to human; BLOCKING unresolved blocks Publish; semantic repair capped at 2 rounds then
`needs_human_direction`; repair writes are scoped — an approved sibling unit is never
modified by a LOCAL repair; reviewer-only diagnosis vs repair-agent proposal are separate
invocations (verifyRepairs is a distinct call).

**Steps**

- [ ] Write failing tests incl. write-scope enforcement and the 2-round cap;
      targeted → fail.
- [ ] Implement; targeted → PASS; regressions (`foundation-reviewer` agent tests).
- [ ] Commit `feat(core): foundation findings and bounded repair policy`.

## Task 8 — Foundation Publish transaction + gate + external edits

**Files**
- Create `packages/core/src/governance/transactions.ts`
- Create `packages/core/src/foundation/publish.ts`
- Create `packages/core/src/__tests__/governance-transactions.test.ts`
- Create `packages/core/src/__tests__/foundation-publish.test.ts`

**Interfaces**

```ts
export interface PublishGateInput {
  readonly bookDir: string;
  readonly units: ReadonlyArray<FoundationUnitManifest>;
  readonly resolutions: ReadonlyArray<HumanResolutionRecord>;
  readonly expectedBaseCanonRevision: number;
}
export interface PublishGateResult {
  readonly ok: boolean;
  readonly failures: ReadonlyArray<string>;
}
export type PublishOutcome =
  | { status: "published"; version: number }
  | { status: "revision_base_stale" }
  | { status: "external_change_detected" };
export async function checkFoundationPublishGate(input: PublishGateInput): Promise<PublishGateResult>;
export async function publishFoundation(bookDir: string, gate: PublishGateInput): Promise<PublishOutcome>;
export async function handleExternalEdit(bookDir: string, unitId: string, action: "compare" | "adopt_into_revision" | "discard"): Promise<void>;
```

Gate requires: required units ready, no canon conflicts, required uncertainties
resolved, stale handled, graph valid, hashes valid, no unresolved external changes.
Publish is deterministic and short; revalidation immediately before COMMIT;
`REVISION_BASE_STALE` on base change; external content never inherits approval.

Fault injection at every transaction stage (before staging, after staging, before
COMMIT, after COMMIT, materialization failure, journal finalization failure) — the
system exposes old authority or fully committed new authority, never half authority.

**Steps**

- [ ] Write failing tests: gate truth for each failure class; stale-base rejection;
      external-edit flow (compare/adopt/discard, adopt never auto-approves); fault
      injection table; targeted → fail.
- [ ] Implement `transactions.ts` then `publish.ts`; targeted → PASS.
- [ ] Regressions (`state-review-finalize` atomic tests), typecheck.
- [ ] Commit `feat(core): transactional foundation publish gate and external edit handling`.

## Task 9 — Foundation intelligence pipeline orchestration

**Files**
- Create `packages/core/src/foundation/pipeline.ts`
- Create `packages/core/src/__tests__/foundation-pipeline.test.ts`

**Interfaces**

```ts
export interface AdaptiveIntakeResult {
  readonly mustKnowGaps: ReadonlyArray<string>;   // 0..3
  readonly helpfulProposals: ReadonlyArray<string>;
}
export interface FoundationPipelineResult {
  readonly status: "published" | "needs_human_direction";
  readonly version?: number;
  readonly findings: ReadonlyArray<FoundationFinding>;
}
export async function adaptiveIntake(bookDir: string, known: Record<string, string>): Promise<AdaptiveIntakeResult>;
export async function runFoundationPipeline(bookDir: string): Promise<FoundationPipelineResult>;
```

Behavior: intake extracts known info first and asks only MUST-KNOW gaps (0–3); the
Architect may propose helpful material; generation runs once globally for coherence;
review runs globally; repair runs locally (reusing Task 7 policy); no whole-Foundation
regeneration for local issues; mechanical/schema retries separate from semantic rounds.

**Steps**

- [ ] Write failing tests (mocked `ArchitectAgent`/`FoundationReviewerAgent`):
      intake asks only unknown MUST-KNOW gaps and 0–3 of them; local issue triggers a
      local repair, not a global regeneration; pipeline ends at publish or
      `needs_human_direction`.
- [ ] Implement `pipeline.ts`; targeted → PASS.
- [ ] Regressions: `architect`/`foundation-reviewer` agent tests; typecheck.
- [ ] Commit `feat(core): adaptive foundation generation pipeline`.

## Task 10 — Human Direction + Authorization durable governance

**Files**
- Create `packages/core/src/governance/authorizations.ts`
- Create `packages/core/src/__tests__/governance-authorizations.test.ts`

**Interfaces**

```ts
export interface HumanDirection {
  readonly directionId: string;
  readonly scope: HumanDirectionScope;
  readonly text: string;
  readonly parsedScope: Record<string, string>;
  readonly lifecycle: HumanDirectionLifecycle;
  readonly createdAt: string;
  readonly confirmedAt?: string;   // becomes authority only after confirmation
}
export interface Authorization {
  readonly authorizationId: string;
  readonly decisionKind: AuthorDecisionKind;
  readonly scope: AuthorizationScope;
  readonly conditionKind?: AuthorizationConditionKind;
  readonly subjectIds: ReadonlyArray<string>;
  readonly consumption: AuthorizationConsumption;
  readonly lifecycle: "active" | "consumed" | "cancelled";
}
export async function createHumanDirection(bookDir: string, draft: HumanDirection): Promise<{ pending: HumanDirection }>;
export async function confirmHumanDirection(bookDir: string, directionId: string): Promise<HumanDirection>;
export async function resolveDirectionConflict(bookDir: string, ids: ReadonlyArray<string>, choice: "override" | "replace" | "keep" | "edit"): Promise<void>;
export async function createAuthorization(bookDir: string, a: Authorization): Promise<{ pending: Authorization }>;
export async function confirmAuthorization(bookDir: string, id: string): Promise<Authorization>;
export async function consumeAuthorizationIfCanonConfirmed(bookDir: string, id: string, canonRevision: number): Promise<"consumed" | "not_yet">;
```

Tests: directions/authorizations are pending until explicit confirmation (never
authority pre-confirmation); direction conflicts are explicit — no latest-wins, each
choice is exercised; lifecycle transitions; `consumeAuthorizationIfCanonConfirmed` is
the ONLY consumption path and requires Canon evidence (plan/draft/failure never consume).

**Steps**

- [ ] Write failing tests (incl. "planning intent never consumes" and
      "confirmation-gated authority"); targeted → fail.
- [ ] Implement; targeted → PASS; typecheck.
- [ ] Commit `feat(core): durable human direction and scoped authorization governance`.

## Task 11 — Arc Plan + Major Beat authority/versioning

**Files**
- Create `packages/core/src/planning/arc-plan.ts`
- Create `packages/core/src/planning/beats.ts`
- Create `packages/core/src/__tests__/planning-arc-plan.test.ts`
- Create `packages/core/src/__tests__/planning-beats.test.ts`

**Interfaces**

```ts
export interface BeatRef {
  readonly beatId: string;
  readonly category: BeatCategory;
  readonly importance: Importance;
  readonly description: string;
}
export interface ArcPlan {
  readonly arcId: string;
  readonly version: number;
  readonly parentVersion: number | null;
  readonly foundationVersion: number;
  readonly baseCanonRevision: number;
  readonly goal: string;
  readonly requiredBeats: ReadonlyArray<BeatRef>;
  readonly optionalBeats: ReadonlyArray<BeatRef>;
  readonly relationshipMovements: ReadonlyArray<string>;
  readonly hookMovements: ReadonlyArray<string>;
  readonly timing: Record<string, unknown>;
  readonly authorizations: ReadonlyArray<string>;
  readonly dependencies: ReadonlyArray<string>;
  readonly changedBeats: ReadonlyArray<string>;
  readonly changedAuthorizations: ReadonlyArray<string>;
  readonly publishedAt?: string;
  readonly restoredFromVersion?: number;
}
export type BeatEvidenceResult = { state: "satisfied" | "not_satisfied" } | { state: "uncertain"; reason: string };
export async function evaluateBeatFromCanon(bookDir: string, beatId: string): Promise<BeatEvidenceResult>;
```

Rules: Arc Plan is Draft until Human Publish; immutable published versions; restore
creates a new revision against current Foundation/Canon; Beat state comes from Canon
evidence, never planning prediction; semantic uncertainty mid-Arc stays `in_progress`
unless required for an authority decision; REQUIRED Beats cannot be silently superseded.

**Steps**

- [ ] Write failing tests: publish boundary (PREFLIGHT_PASS draft still not
      authoritative); beat evidence derives from Canon (a planning prediction alone
      never sets satisfied); semantic uncertainty stays in_progress; required-beat
      supersede refused.
- [ ] Implement; targeted → PASS; typecheck.
- [ ] Commit `feat(core): arc plan authority and canon-evidence major beats`.

## Task 12 — Rolling Lookahead lifecycle + selective invalidation

**Files**
- Create `packages/core/src/planning/lookahead.ts`
- Create `packages/core/src/__tests__/planning-lookahead.test.ts`

**Interfaces**

```ts
export interface RollingLookahead {
  readonly lookaheadId: string;
  readonly status: LookaheadStatus;
  readonly horizon: ReadonlyArray<{ chapterNumber: number; intention: string }>;
  readonly basedOnCanonRevision: number;
  readonly createdAt: string;
}
export async function generateLookahead(bookDir: string, horizonChapters: number): Promise<RollingLookahead>;
export async function revalidateLookahead(bookDir: string, lookaheadId: string): Promise<LookaheadStatus>;
```

Rules: advisory only — no `approved` state; default horizon 2–3 lightweight intentions;
only the next chapter gets a Detailed Plan; invalidation is selective (Canon or
dependency change → `stale`; superseded when replaced).

**Steps**

- [ ] Write failing tests: `generateLookahead` rejects horizons outside 2–3;
      lookahead can never produce authority (no gate accepts it as sufficient);
      `revalidateLookahead` transitions on Canon change; supersede/consume transitions.
- [ ] Implement; targeted → PASS; typecheck.
- [ ] Commit `feat(core): advisory rolling lookahead lifecycle`.

## Task 13 — Detailed Chapter Plan V2

**Files**
- Create `packages/core/src/planning/detailed-plan.ts`
- Create `packages/core/src/__tests__/planning-detailed-plan.test.ts`
- Modify `packages/core/src/models/input-governance.ts` (add optional Phase 5 binding
  fields to `ChapterIntentSchema`/`ChapterMemoSchema` — additive, defaults preserved)

**Interfaces**

```ts
export interface DetailedPlanBindings {
  readonly foundationVersion: number;
  readonly arcPlanVersion: number;
  readonly canonRevision: number;
  readonly humanDirectionIds: ReadonlyArray<string>;
  readonly authorizationIds: ReadonlyArray<string>;
  readonly dependencyUnitIds: ReadonlyArray<string>;
  readonly ruleIds: ReadonlyArray<string>;
}
export async function buildDetailedPlan(bookDir: string, chapterNumber: number): Promise<{ intent: ChapterIntent; memo: ChapterMemo; bindings: DetailedPlanBindings }>;
export function planScopeTooBroad(plan: { intent: ChapterIntent; memo: ChapterMemo }): boolean;
export async function replanChapter(bookDir: string, chapterNumber: number, round: number): Promise<{ intent: ChapterIntent; memo: ChapterMemo; bindings: DetailedPlanBindings }>;
```

Rules: Detailed Plan is a mutable proposal until frozen by the Execution Snapshot;
binds the six authority dimensions; `PLAN_SCOPE_TOO_BROAD` instead of silently dropping
required context; maximum 2 automatic semantic replans per chapter (separate from Phase
6 prose retry).

**Steps**

- [ ] Write failing tests: bindings contract (all six dimensions present and typed);
      scope-too-broad detection; 2-replan cap; plan mutability before snapshot (T16).
- [ ] Implement (evolving ChapterIntent/ChapterMemo, additive schema change);
      targeted → PASS.
- [ ] Regressions: planner/persisted-governed-plan tests; typecheck.
- [ ] Commit `feat(core): detailed chapter plan v2 bindings and replan boundary`.

## Task 14 — Planning Gate (deterministic L1 + semantic L2)

**Files**
- Create `packages/core/src/planning/gate.ts`
- Create `packages/core/src/__tests__/planning-gate.test.ts`

**Interfaces**

```ts
export interface PlanningGateInput {
  readonly bookDir: string;
  readonly foundationVersion: number;
  readonly arcPlanVersion: number;
  readonly canonRevision: number;
  readonly directions: ReadonlyArray<HumanDirection>;
  readonly authorizations: ReadonlyArray<Authorization>;
  readonly plan: { intent: ChapterIntent; memo: ChapterMemo; bindings: DetailedPlanBindings };
}
export type PlanningGateResult = { outcome: "safe" } | { outcome: "uncertain"; concerns: ReadonlyArray<string> } | { outcome: "author_decision"; missing: ReadonlyArray<AuthorDecisionKind> } | { outcome: "conflict"; evidence: ReadonlyArray<string> };
export async function evaluatePlanningGate(input: PlanningGateInput): Promise<PlanningGateResult>;
```

Truth table (tests must cover all 5 rows): deterministic clean + semantic clean +
sufficient authority → SAFE; deterministic clean + semantic uncertain → UNCERTAIN;
deterministic clean + new major decision + missing authority → AUTHOR_DECISION; hard
deterministic violation → CONFLICT; major decision already authorized in correct scope
→ SAFE (no re-ask). L1 checks include stale deps, required units, hard Canon
contradictions, Book Rules, hard Timeline constraints, direction conflicts,
authorization validity/consumption, chapter sequence, unresolved state review. L2
checks (motivation, relationship progression, reveal timing, hook payoff readiness,
scene causality, arc progression, pacing, author decisions) cannot create hard
CONFLICT. SAFE never auto-runs Writer.

**Steps**

- [ ] Write failing tests for the 5-row truth table + "semantic cannot create hard
      conflict" + "authorized-at-scope does not re-ask"; targeted → fail.
- [ ] Implement; targeted → PASS; typecheck.
- [ ] Commit `feat(core): planning risk gate with deterministic and semantic layers`.

## Task 15 — Context Composer: authority spine, profiles, budget, provenance

**Files**
- Create `packages/core/src/context/composer.ts`
- Create `packages/core/src/context/bundle.ts`
- Create `packages/core/src/context/budget.ts`
- Create `packages/core/src/__tests__/context-composer.test.ts`
- Create `packages/core/src/__tests__/context-budget.test.ts`

**Interfaces**

```ts
export type ContextProfile = "planner_context" | "writer_context" | "reviewer_context";
export type ContextPriority = 0 | 1 | 2 | 3 | 4;
export interface ContextBundle {
  readonly bundleId: string;
  readonly profile: ContextProfile;
  readonly task: string;
  readonly foundationVersion: number;
  readonly arcPlanVersion: number;
  readonly canonRevision: number;
  readonly sections: ReadonlyArray<{ priority: ContextPriority; source: string; content: string; projection?: boolean }>;
  readonly sourceProvenance: ReadonlyArray<string>;
  readonly dependencyRefs: ReadonlyArray<string>;
  readonly semanticRetrievalRefs: ReadonlyArray<string>;
  readonly budget: { readonly contextLimit: number; readonly reservedOutput: number; readonly estimatedInput: number };
  readonly tokenEstimates: Record<string, number>;
  readonly compactions: ReadonlyArray<string>;
  readonly omittedDueToBudget: ReadonlyArray<string>;
}
export async function composeContext(bookDir: string, profile: ContextProfile, task: string): Promise<ContextBundle>;
export async function isBundleStale(bookDir: string, bundle: ContextBundle): Promise<boolean>;
export type BudgetResult = { status: "ok"; bundle: ContextBundle } | { status: "context_budget_exceeded" };
export async function applyBudgetPolicy(bundle: ContextBundle): Promise<BudgetResult>;
```

Rules: authority before relevance; P0 never silently dropped or semantically summarized;
budget policy order (deterministic projection → trim soft → semantic compression only
for the allowed set → narrow/replan → CONTEXT_BUDGET_EXCEEDED); reserve output before
input; no automatic model switch to escape budget; forbidden to semantically compress
hard Canon facts / Book Rules / Human Directions / authorization scopes / Foundation
invariants / Execution Snapshot contract; retrieval excludes rejected/non-canonical
Writer attempts; derived indexes are rebuildable, never authority; draft Foundation/Arc
revisions never leak into production retrieval; per-call observability metadata
(task/profile/bundleId/model/provider/estimated/actual input/output) retained as
instrumentation only.

**Steps**

- [ ] Write failing tests incl.: P0 preservation under pressure; budget-exceeded →
      zero LLM calls (spy on the provider client); no model-switch path; stale bundle
      detection; false-memory exclusion (rejected attempt content never appears in a
      bundle); compaction allowlist (hard Canon facts never semantically compressed).
- [ ] Implement `budget.ts` → `bundle.ts` → `composer.ts`; targeted → PASS.
- [ ] Regressions: `context-filter`/`governed-context` tests; typecheck.
- [ ] Commit `feat(core): context composer authority spine and token governance`.

## Task 16 — Execution Snapshot + attempt lifecycle

**Files**
- Create `packages/core/src/execution/snapshot.ts`
- Create `packages/core/src/execution/attempt.ts`
- Create `packages/core/src/__tests__/execution-snapshot.test.ts`
- Create `packages/core/src/__tests__/execution-attempt.test.ts`

**Interfaces**

```ts
export interface ExecutionSnapshot {
  readonly snapshotId: string;
  readonly chapterNumber: number;
  readonly bindings: DetailedPlanBindings;
  readonly bundleId: string;
  readonly planContentHash: string;
  readonly frozenAt: string;
}
export type FreezeResult = { status: "frozen"; snapshot: ExecutionSnapshot } | { status: "execution_prepare_failed"; reason: string };
export async function freezeExecutionSnapshot(bookDir: string, plan: { intent: ChapterIntent; memo: ChapterMemo; bindings: DetailedPlanBindings }, bundle: ContextBundle): Promise<FreezeResult>;
export type AttemptOutcome =
  | { status: "prose_defect"; next: "revise_same_snapshot" }
  | { status: "plan_defect"; next: "fresh_plan_and_snapshot" }
  | { status: "authority_defect"; next: "authority_resolver" }
  | { status: "canon_conflict"; next: "hard_stop" };
export function classifyAttemptDefect(attempt: unknown): AttemptOutcome;
```

Rules: freeze revalidates authority/Canon/context atomically; `EXECUTION_PREPARE_FAILED`
when anything changed during freeze (prepare-race test); Writer never starts without a
snapshot; the plan used by an attempt is immutable after freeze; defect routing per
table; max 2 replans; provider failures record failure records and consume no
authorizations; one chapter per deliberate run.

**Steps**

- [ ] Write failing tests: freeze rejects stale bundle; prepare-race (authority changes
      mid-freeze) → `execution_prepare_failed`; attempt immutability; defect routing;
      provider failure consumes nothing.
- [ ] Implement; targeted → PASS; typecheck.
- [ ] Commit `feat(core): immutable execution snapshots and attempt lifecycle`.

## Task 17 — Phase 4 Canon settlement integration

**Files**
- Create `packages/core/src/state/settlement-integration.ts`
- Create `packages/core/src/__tests__/settlement-integration.test.ts`
- Modify `packages/core/src/state/state-review-finalize.ts` (post-commit hook call,
  additive — existing semantics unchanged)

**Interfaces**

```ts
export interface SettlementEffects {
  readonly consumedAuthorizationIds: ReadonlyArray<string>;
  readonly staleDependencyUnits: ReadonlyArray<string>;
  readonly beatEvidence: ReadonlyArray<{ beatId: string; state: "satisfied" | "not_satisfied" | "uncertain" }>;
  readonly lookaheadStatus: LookaheadStatus;
  readonly arcReadiness: ArcCompletionOutcome | "not_applicable";
  readonly nextPlanningReady: boolean;
}
export async function applySettlementEffects(bookDir: string, chapterNumber: number, canonRevision: number): Promise<SettlementEffects>;
```

Rules: Canon commit + one-time authorization consumption logically atomic; Draft/Audit
never consume; State Review proposals never consume; Final Confirm settlement consumes;
Beat semantic evaluation may run after commit and never affects Canon correctness;
dependency impact and lookahead revalidation run where deterministic; existing Phase 4
tests remain green.

**Steps**

- [ ] Write failing tests: non-consumption for Draft/Audit/State-Review-proposal paths;
      consumption exactly on settlement; atomicity fault test (consumption write fails
      → Canon not half-applied); beat evidence post-commit; lookahead/arc revalidation.
- [ ] Implement; targeted → PASS.
- [ ] Full Phase 4 regressions: `state-review-confirm`/`state-review-finalize`
      suites unchanged green; typecheck.
- [ ] Commit `feat(core): phase 4 settlement integration for authorizations and beats`.

## Task 18 — Arc completion / transition

**Files**
- Create `packages/core/src/planning/transition.ts`
- Create `packages/core/src/__tests__/planning-transition.test.ts`

**Interfaces**

```ts
export type ArcTransitionResult =
  | { outcome: "not_ready" }
  | { outcome: "ready_to_close"; nextPublished: boolean; action: "auto_activate" | "prepare_next_before_transition" };
  | { outcome: "arc_completion_uncertain"; reason: string };
export async function evaluateArcCompletion(bookDir: string, arcId: string): Promise<ArcTransitionResult>;
```

Rules: evidence-based completion (required beats from Canon); auto close/activate when
the next Arc Plan is already published; prepare/publish the next plan before transition
when missing.

**Steps**

- [ ] Write failing tests: not-ready with pending required beats; ready + published
      next → auto activation; ready + missing next → prepare-before-transition;
      completion-uncertain requires human.
- [ ] Implement; targeted → PASS; typecheck.
- [ ] Commit `feat(core): evidence-driven arc completion and transition`.

## Task 19 — Studio governance surfaces

**Files**
- Modify `packages/studio/src/api/server.ts` (two route blocks: foundation base
  `/api/v1/books/:id/foundation`, planning base `/api/v1/books/:id/planning` — read
  surfaces, unit review actions, revision open/save, publish, arc publish, direction
  confirm, authorization confirm; all call Core functions only)
- Create `packages/studio/src/lib/foundation-api.ts`, `packages/studio/src/lib/planning-api.ts`
- Create `packages/studio/src/pages/FoundationPage.tsx` + `foundation-ui-state.ts` +
  `foundation-ui-state.test.ts`
- Create `packages/studio/src/pages/PlanningPage.tsx` + `planning-ui-state.ts` +
  `planning-ui-state.test.ts`
- Create `packages/studio/src/__tests__/foundation-route.test.ts`,
  `packages/studio/src/__tests__/planning-route.test.ts`

Pattern: mirror `stateReviewBase` routes + `lib/state-review-api.ts` + `StateReviewPage.tsx`
(pure `*-ui-state` model + vitest node-env tests, no RTL; bilingual copy; route keyed
`key={bookId}`; invalidateApiPaths on publish).

Studio behavior (per spec §8): unit-level review with statuses/required-optional/
dependencies/findings/diffs/revision workspace/history/Publish boundary; approved units
read-only until explicit Open Revision; revision UI shows current Published authority,
current Revision Draft, and which version production uses; diff-first review for later
revisions; batch approval only for safe clean units; Arc Plan view with Major Beat
progress, advisory Lookahead (no Approve button), next Detailed Plan; Human Direction
NL parsed into structured scope, shown to Human, confirmed; direction conflicts require
explicit resolution; Detailed Plan SAFE → no approval needed (View/Add Direction/
Regenerate/Write Chapter); UNCERTAIN/AUTHOR_DECISION explain issue+evidence+authority+
valid next actions; CONFLICT hard-blocks with no "Write Anyway". No duplicated
readiness/authority logic — UI renders Core's structured readiness.

**Steps**

- [ ] Write failing route tests (foundation/planning read + actions + publish +
      revision + direction confirm; error mapping reuses `mapStateReviewError` style)
      and `*-ui-state.test.ts` model tests; targeted → fail.
- [ ] Implement server routes + typed clients + pages; targeted → PASS.
- [ ] Studio regressions: `state-review-route.test.ts`, full studio serial suite;
      typecheck; client build.
- [ ] Commit `feat(studio): phase 5 foundation and planning governance surfaces`.

## Task 20 — CLI safe operational integration

**Files**
- Create `packages/cli/src/commands/foundation.ts` (status/inspect/units; no mutation
  bypass)
- Create `packages/cli/src/commands/planning.ts` (arc status, lookahead show, gate
  report)
- Modify `packages/cli/src/commands/status.ts` (readiness block summary:
  blockingReasons/warnings/nextRecommendedAction)
- Modify `packages/cli/src/commands/write.ts` (write next respects the Planning Gate +
  Execution Snapshot freeze; on `conflict` prints blockers and points to Studio;
  `plan_defect` path surfaces replan)
- Create `packages/cli/src/__tests__/foundation-command.test.ts`,
  `packages/cli/src/__tests__/planning-command.test.ts`; extend
  `packages/cli/src/__tests__/write-command.test.ts`

Rules: CLI is a safe operational surface; complex review routes users to Studio;
**no** `--force`/`--ignore-canon`/`--skip-authority` flags; `castor write next` keeps
working for healthy books and fails closed on gate violations with actionable messages;
gates cannot be bypassed from the CLI (test proves a gate-CONFLICT book cannot write).

**Steps**

- [ ] Write failing tests: foundation status output; planning gate report; write-next
      on a gate-CONFLICT book fails with blockers and no prose write; no bypass flag
      exists (parsing rejects unknown flags); healthy SAFE path still writes.
- [ ] Implement; targeted → PASS.
- [ ] CLI regressions: full CLI serial suite; typecheck; build.
- [ ] Commit `feat(cli): phase 5 governance status and gate-safe write integration`.

## Task 21 — Legacy upgrade E2E, compatibility and recovery scenarios

**Files**
- Create `packages/core/src/__tests__/legacy-v2-upgrade-e2e.test.ts`
- Create `packages/core/src/__tests__/phase5-recovery-e2e.test.ts`

Scenarios:
- legacy book (existing `inkos.json`, `.inkos/`, Foundation files, ChapterIntent,
  ChapterMemo, chapters, Canon/state) remains fully usable without V2 upgrade
  (write-next + Phase 4 flow green);
- opt-in upgrade to Foundation V2 preserves chapter prose hashes and historical Canon
  byte-for-byte;
- once V2 Foundation is Published, legacy Foundation is not run as competing authority;
- fault-injection E2E across the Task 8/16 transaction stages verifying recovery truth
  priority (committed history → current manifests → journals → drafts → derived);
- immutable-history corruption is detected, never silently adopted;
- schema migrations forward-only/idempotent/recoverable.

**Steps**

- [ ] Write failing tests; run → fail.
- [ ] Implement any missing migration/marker glue; targeted → PASS.
- [ ] Full core serial suite (expect exactly the 2 known Windows EPERM baselines);
      studio serial; CLI serial; typecheck; build.
- [ ] Commit `feat(core): legacy-v2 upgrade compatibility and recovery e2e`.

## Task 22 — Final Phase 5 acceptance (Definition of Done)

**Files**
- Create `packages/core/src/__tests__/phase5-acceptance.test.ts` (scenarios A–F +
  coverage of the negative guarantees list)
- Create `docs/superpowers/plans/2026-08-27-phase-5-foundation-planning-intelligence-verification.md`
  (verification record: matrix + baseline classification + verdict; created at the end
  of this Task, not by ordinary tasks)

E2E scenarios (mocked LLM agents per repo convention — no real API calls):
- A. New story from natural brief through Chapter 1 Canon and Chapter 2 planning.
- B. Healthy SAFE chapter with minimal Human friction.
- C. Missing-authority author decision (AUTHOR_DECISION, then authorization).
- D. Mid-book Foundation revision invalidating future Planning without historical rewrite.
- E. PLAN_DEFECT aborted attempt + fresh replan/snapshot.
- F. Evidence-driven Arc completion and transition.

Acceptance battery (serial): core full (expect 2211/2213 + new suites, only the 2 EPERM
baselines), studio full, CLI full, typecheck, build, `git diff --check`; classify every
failure as regression/baseline/environmental per repo discipline. Verify: no new
Critical/Important findings; legacy compatibility green; transaction/recovery fault
tests green; Studio/CLI share Core logic; Phase 4 semantics intact. Record the verdict
in the verification doc. `v0.2.0` is created ONLY after the human accepts the completed
Phase 5 verification/review state — never by this or any ordinary Task.

**Steps**

- [ ] Write the acceptance test; run E2E scenarios; fix only genuine Phase 5
      regressions RED-first with narrow commits.
- [ ] Run the full serial battery; record results; fill the verification doc.
- [ ] `git diff --check`; review; final commit `test: phase 5 acceptance matrix verified`.

---

## Spec-to-Task Coverage Matrix

| Spec requirement | Task(s) |
|---|---|
| §1 authority ownership + conflict routes + invariants 1–10 | T1 (vocab), T4, T5, T6, T8, T10, T16, T17 |
| §2 Foundation representation (Markdown + manifest, no prose in JSON) | T2 |
| §2 unit statuses/importance/kinds/Story Frame 4 units | T1, T2, T4 |
| §2 character policy + reasons | T1, T4 |
| §2 relationship split + tiers | T1, T2, T11 |
| §2 Arc Direction / Book Rules kinds | T1, T2, T11 |
| §2 Foundation/Runtime Hooks + lifecycle + no escalation | T1, T11, T17 |
| §2 Timeline split + constraint kinds | T1, T2, T14 |
| §2 dependencies direct-only | T4 |
| §2 revision policy / published history / restore / external edits | T5, T8 |
| §2 legacy books + upgrade | T3, T21 |
| §3 pipeline + adaptive intake | T9 |
| §3 generation strategy + repair bounds + reviewer/repair separation | T7, T9 |
| §3 finding schema + severity/scope policy + scores informational | T7 |
| §3 conflict model (FUTURE_SAFE/UNCERTAIN/CANON_CONFLICT) + 2-layer | T6 |
| §3 Human Resolution Record | T6 |
| §3 Publish gate + Chapter-1 readiness | T4, T8 |
| §4 Planning artifacts + Arc Plan metadata/versions/restore | T11 |
| §4 Major Beats lifecycle/importance/categories/Canon evidence | T11, T17 |
| §4 Rolling Lookahead lifecycle (advisory, 2–3 horizon) | T12 |
| §4 Human Direction scopes/lifecycle/conflicts | T10 |
| §4 Author Decisions vocabulary + Authorization scopes/conditions/consumption | T1, T10, T17 |
| §4 Detailed Chapter Plan (ChapterIntent/Memo evolution + bindings + immutability) | T13, T16 |
| §4 Execution Attempt defects + 2 replans | T16 |
| §4 Arc completion | T18 |
| §5 Arc flow + Draft-until-Publish | T11 |
| §5 Detailed chapter flow (fresh after latest Canon) | T13, T14 |
| §5 Planning Gate L1/L2 + truth table + SAFE semantics | T14 |
| §5 bounded repair + PLAN_SCOPE_TOO_BROAD | T7, T13, T14 |
| §6 Composer architecture + profiles + priority P0–P4 | T15 |
| §6 budget policy + reserve output + no auto model switch + CONTEXT_BUDGET_EXCEEDED | T15 |
| §6 projection vs summary + compression allowlist/forbidden set | T15 |
| §6 ContextBundle provenance + staleness | T15 |
| §6 retrieval truth (exclude rejected attempts; derived indexes) | T15, T17 |
| §7 persistence layers + published current+history | T5 |
| §7 Transaction Coordinator steps + revalidation + REVISION_BASE_STALE | T8 |
| §7 crash semantics + journal + fault injection | T5, T8, T16, T21, T22 |
| §7 authority switch + dependency invalidation atomic | T8, T17 |
| §7 Execution freeze + EXECUTION_PREPARE_FAILED + provider failures | T16 |
| §7 authorization consumption with Canon settlement (atomic) | T17 |
| §7 recovery truth priority + corruption detection + reuse primitives | T8, T21 |
| §7 legacy compatibility + capability markers + opt-in V2 + no competing authority | T1, T3, T21 |
| §7 migrations forward-only/idempotent/recoverable | T21 |
| §8 Studio workspace + Foundation UX + revision UI + batch approval | T19 |
| §8 Arc UX + Lookahead no-approve + Direction parse/confirm/conflict | T19 |
| §8 Detailed Plan states + Write action + one chapter | T19, T16, T20 |
| §8 CLI safety (no bypass flags; write next respects gates) | T20 |
| §9 testing layers + Foundation/Planning coverage + truth contract | T4–T18, T22 |
| §9 Context tests + fault injection + half-authority invariant | T5, T8, T15, T16, T21, T22 |
| §9 compatibility/parity + E2E A–F | T19, T20, T21, T22 |
| §9 security/path safety (AI IDs never become fs paths) | T2, T21 |
| Scope boundary (no Phase 6/7, one chapter per run) | T16, T20, T22 |
| Definition of Done | T22 |

---

## Studio/CLI rule

UI and CLI consume Core governance operations only. Studio gets rich resolution/review
UX (Task 19); CLI gets safe operational parity and clear blockers (Task 20). Neither
implements readiness/authority logic; complex review may route users to Studio. Parity
is tested (T19/T20/T22).

## Phase 4 integration rule

Phase 4 is an existing contract to preserve — not rewritten. Phase 5 integrates after/
beside the Final Confirm boundary (Task 17 modifies `state-review-finalize.ts` with an
additive post-commit hook only). Tests prove Draft/Audit do not consume authorizations,
State Review proposals do not consume authorizations, and Final Confirm settlement does.
The full Phase 4 suites must stay green in every task gate and in T22.

## Task completion / review gates

Every implementation Task ends with: (1) targeted tests green; (2) relevant regressions
green; (3) typecheck/build as applicable; (4) `git diff --check`; (5) reviewer
checkpoint; (6) one focused commit. Execution follows: implement Task → debug/tests →
review → fix Critical/Important findings → regression → re-review → APPROVE → stop at
the human gate before the next Task. Multiple Tasks are never implemented automatically
in one run.
