# Phase 5 Foundation + Planning Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved Phase 5 Foundation + Planning
Intelligence architecture while preserving Phase 4 Canon settlement,
legacy castor compatibility, and the one-chapter human execution boundary.

**Architecture:** Phase 5 adds an **Evolutionary Governance Kernel** on top of the
existing Castor pipeline: Foundation and Arc Plan become versioned, human-published
authority artifacts (Markdown content + structured governance manifests); Planning
produces advisory Lookahead and execution-proposal Detailed Chapter Plans; a
deterministic+semantic risk gate and an immutable Execution Snapshot bind each Writer
attempt. Core owns authority, readiness, dependencies, conflicts, authorizations,
versions, transactions and provenance; AI proposes, Human authorizes, Canon records
reality — reusing the existing Architect/Planner/Writer, Phase 4 State Review, atomic
persistence, retrieval, Studio and CLI rather than building a parallel system. **AI
execution NEVER creates authority:** every authority artifact stops at a
Human-reviewable Draft, restore produces revision candidates (never Published
versions), and Human Publish (Foundation/Arc), Human confirmation (Direction/
Authorization), or Phase 4 Final Confirm (Canon) is the only authority boundary.

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
- **Writer/pipeline:** `core/src/pipeline/runner.ts` (`writeNextChapter` — the production
  Writer entry path; governed proposal publication), `core/src/pipeline/chapter-review-cycle.ts`,
  `core/src/pipeline/chapter-truth-validation.ts`, `core/src/agents/writer.ts`.
- **Phase 4:** `core/src/state/state-review-{store,service,items,confirm,finalize,temporal}.ts`,
  `core/src/state/advancement-gate.ts`, `core/src/models/state-review.ts`; Studio
  `server.ts` `stateReviewBase` routes + `lib/state-review-api.ts` + `pages/StateReviewPage.tsx`.
  `state-review-finalize.ts` is the SINGLE Canon settlement transaction (one
  `commitAtomicFileSet` containing canon writes + projections + snapshot + receipt +
  index + artifact deletion).
- **Persistence:** `core/src/utils/atomic-file-set.ts` (`commitAtomicFileSet`),
  `core/src/state/manager.ts` (book dirs, control documents, lock,
  `loadBookConfig`/`saveBookConfig`), `core/src/state/snapshot-set.ts`,
  `core/src/state/state-bootstrap.ts`, `core/src/state/runtime-state-store.ts`
  (`StateManifestSchema`, `lastAppliedChapter`), `core/src/utils/prose-revision.ts`
  (`computeProseRevision`).
- **Book metadata:** `core/src/models/book.ts` (`BookConfigSchema` — the natural home for
  additive capability/version markers).
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
- Canon owns established past; Foundation/Arc authority requires **Human Publish** —
  AI execution NEVER auto-publishes; it produces Human-reviewable Drafts only.
- Restore NEVER creates authority — it produces a revision candidate requiring Human
  Publish.
- Human Direction / Authorization require explicit Human confirmation.
- Phase 4 Final Confirm remains the Canon settlement boundary.
- Direct declared dependency invalidation only — no recursive cascade at change time.
- Approved/published Foundation is AI-readable and AI-immutable.
- Published versions immutable; never backward pointer moves. **Published Foundation is
  ONE global authority version (Foundation v1, v2, …) identifying the complete
  authoritative Foundation state** — individual unit revisions are governed beneath it,
  never confused with the global version number.
- No silent semantic `CANON_CONFLICT` classification by AI (deterministic Core only).
- Lookahead is advisory only; scores are informational only.
- Authorization consumes only on Canon evidence — derived and validated by Core, never
  from a raw caller ID list — atomically with Canon settlement. **There is exactly ONE
  ACTIVE→CONSUMED transition: the Phase 4 Final Confirm / Canon settlement transaction;
  no standalone consumption write path exists.**
- Writer cannot run without a valid immutable Execution Snapshot; the CORE production
  write entry enforces this (CLI/Studio are not the security boundary).
- One deliberate Write action produces at most one chapter.
- P0 authority context is never silently dropped; no automatic model switching to
  escape the context budget.
- Old castor-derived books keep working before V2 adoption; preserve `castor.json`,
  `castor_*`, `.castor/` compatibility unless a justified migration requires otherwise.
- Governance capability markers flip atomically with the first Human Publish — never
  before, never in a separate transaction.
- No Phase 6 deep prose-autonomy leakage; no Phase 7 Story Intelligence leakage.
- No production authority bypass flags (`--force`, `--ignore-canon`, `--skip-authority`).
- No `v0.2.0` until the Phase 5 completion gate passes and the human accepts it.

---

## Book-scoped coordination / locking (global contract)

**All authority-changing operations are book-scoped and lock-protected.** Reuse the
existing Castor book-lock abstraction (`core/src/state/manager.ts` — the same primitive
Phase 4 uses; `withBookMutationLock`-style ownership). Do NOT introduce a second hidden
lock system.

Required semantics for EVERY operation below:

```
acquire book lock
→ re-read current authority/state INSIDE the lock
→ validate expected revisions/bases against the freshly-read state
→ prepare
→ commit
→ release in finally
```

Never perform: check revision → THEN acquire lock → commit stale state
(check-then-lock-then-commit is forbidden).

Operation → locking assignment (exact):

| Operation | Lock owner Task |
|---|---|
| Foundation Human Publish (`publishFoundation`) | T9 (inside `runTransaction`) |
| Arc Human Publish (`publishArcPlan`) | T13 (inside the shared `runTransaction`) |
| Human Direction confirmation / conflict-resolution mutation | T11 |
| Authorization confirmation / lifecycle authority mutation | T11 |
| Phase 4 Final Confirm settlement integration (Canon + consumption writes) | T20 (reuse the existing Phase 4 finalize lock ownership) |
| Arc close/activate transition (`applyArcTransition`) | T21 |
| Execution Snapshot prepare where authority race matters (`freezeExecutionSnapshot`) | T18 |

Concurrency guarantee: **no last-write-wins** for concurrent Studio/CLI authority
changes. Tests must cover at least one concurrent Studio/CLI or two-Core-call race (the
primary home is T9's publish fault/concurrency tests, mirrored in T13/T20): one
operation wins; the other receives a TYPED conflict/stale result (`REVISION_BASE_STALE`
or the operation-specific conflict code); never half authority, never silent overwrite.

---

## Foundation revision content isolation (working content model)

**Published Foundation Markdown remains production-readable authority. Revision Draft
content is isolated working Markdown/content. Planner/Writer continue reading Published
Foundation until Human Publish.**

Explicit working content model:

```
revisionId
→ revision-scoped working content root (working Markdown/content, NOT Published paths)
→ FoundationRevisionDraft + manifests/approval records point to that working content
  (contentHash computed over the WORKING content)
```

- `saveFoundationUnitDraft` writes ONLY into the revision-scoped working root — it MUST
  NOT overwrite current Published Markdown.
- Two concurrent Revision Drafts may hold DIFFERENT content for the same unit (each has
  its own working root).
- Human Publish (T9) atomically MATERIALIZES the approved revision as the new current
  Published Foundation and records immutable version history — only then does
  production-readable Foundation change.
- `discardFoundationRevision` removes only the working root; Published content is
  unchanged.
- External edits to Published Markdown remain distinguishable from edits inside an
  explicit Revision Draft: external-change detection compares the Published Markdown
  hash against the approved revision (T9 `external_change_detected`), never against
  working content.
- Creative prose is NEVER duplicated into governance JSON.

Tests (owned by T8/T9): open revision + edit → Published Markdown hash/content
unchanged; Planner/Writer still read the old Published content; two Revision Drafts hold
different content for the same unit; Publish of the selected revision is the ONLY moment
current materialized Foundation changes; discard revision → Published content unchanged.

---

## Planned File / Responsibility Map

New files (all under `packages/`; tests beside sources per repo convention
`core/src/__tests__/`, `studio/src/__tests__/`, `cli/src/__tests__/`):

| Path | Responsibility | Introduced by |
|---|---|---|
| `core/src/governance/contracts.ts` | Capability/version markers + ALL stable vocabularies (unit kinds, statuses, importance, character reasons, relationship tiers, hook lifecycle, authorization scopes/conditions, decision kinds, direction scopes/lifecycle, beat categories, finding severity/scope, conflict kinds, gate results, `PlanningDependencyRef`) | T1 |
| `core/src/models/book.ts` (modify) | Additive optional `governance` field to `BookConfigSchema` (absent ⇒ legacy) — the persisted capability marker surface | T1 |
| `core/src/governance/readiness.ts` | `ReadinessEvaluator` — blockingReasons/warnings/nextRecommendedAction | T4 |
| `core/src/governance/dependencies.ts` | `DependencyManager` — Core-owned dep semantics, concrete links, direct-only invalidation, graph validity | T4 |
| `core/src/governance/conflicts.ts` | Two-layer conflict classifier (deterministic Core vs semantic AI) + Human Resolution Record | T6 |
| `core/src/governance/authorizations.ts` | Author Decision vocabulary, pending→active Authorization, typed scopes/conditions, evidence-derived consumption, Core Human Direction NL parser | T11 |
| `core/src/governance/versions.ts` | **Generic version/history primitives only**: `VersionEnvelope<T>`, `FoundationPublishedSnapshot` (global whole-Foundation snapshot), read-only `VersionStore` (read/current/list/integrity) + `prepareVersionAppend`/`prepareCurrentVersionPointer` (writes committed ONLY by the Task 9 coordinator), `restoreVersionAsRevisionCandidate` (never publishes, never advances the current pointer) | T5 |
| `core/src/governance/transactions.ts` | **Single authoritative `TransactionCoordinator`** (PREPARE/VALIDATE/STAGE/JOURNAL/COMMIT/MATERIALIZE/FINALIZE) over `atomic-file-set` | T9 |
| `core/src/governance/provenance.ts` | Provenance recorder (version/evidence/resolution provenance records) | T5/T6 |
| `core/src/foundation/manifest.ts` | Foundation V2 unit manifests with **logical content locators** (whole_file / section / rule / entry), identity, kind, importance, status, deps, revision, approval, staleness, provenance (internal persistence primitive only) | T2 |
| `core/src/foundation/bootstrap.ts` | Governance-mode detection, legacy parse → `legacy_established`, opt-in upgrade **candidate preparation** (`status: "prepared"`, ephemeral; no preflight, never publishes) — consumed by T10 which persists a durable revisionId | T3 |
| `core/src/foundation/review.ts` | Finding schema, reviewer-only diagnosis, bounded repair policy (2 rounds), verification invocation | T7 |
| `core/src/foundation/revision-service.ts` | **Core Foundation Human review operations**: open/load/save draft, approve, mark-needs-revision, reapprove-stale, discard — Core computes/verifies hash+revision (caller never supplies truth); the ONLY approval transitions; never publishes | T8 |
| `core/src/foundation/publish.ts` | Foundation Publish gate (evaluated over trusted persisted state) + explicit Human Publish + atomic V2 marker activation + external-edit Compare/Adopt/Discard, on the shared TransactionCoordinator | T9 |
| `core/src/foundation/pipeline.ts` | Adaptive intake (0–3 MUST-KNOW gaps), global generate → global review → local repair → **durable Human-reviewable revisionId** (never publishes) | T10 |
| `core/src/planning/arc-plan.ts` | Arc Plan **storage/domain only**: `ArcPlanSnapshot`, `ArcPlanDraftRecord` (keyed by draftId), `saveArcPlanDraft`/`loadArcPlanDraft`, read-only Published history, `restoreArcPlanAsRevisionDraft` (persists Draft C into the same store), Beat model/evidence — NO publish, NO preflight record (T13) | T12 |
| `core/src/planning/invalidation-registry.ts` | **Generic future-planning artifact registry**: `registerPlanningArtifact`/`unregisterPlanningArtifact`/`listPlanningArtifactsDirectlyDependingOn`/`invalidateDirectPlanningDependents` over `PlanningArtifactKind` — introduced in T12 so Arc Publish (T13) invalidates without T14/T15 types; Lookahead (T14) and Detailed Plan (T15) participate in the SAME mechanism | T12 |
| `core/src/planning/arc-pipeline.ts` | **Arc Planner + Arc preflight + Human Publish boundary**: generate Arc Draft (via T12 save), persisted preflight bound to draft hash + Foundation/Canon bases, semantic review (typed findings), LOCAL repair, verification, `publishArcPlan` (by draftId, with full rejection set), atomic planning V2 marker + direct future-planning invalidation | T13 |
| `core/src/planning/beats.ts` | Major Beat lifecycle/importance/categories + Canon-evidence evaluation (deterministic + semantic) | T12 |
| `core/src/planning/lookahead.ts` | Advisory Rolling Lookahead with typed `PlanningDependencyRef` provenance + selective invalidation | T14 |
| `core/src/planning/detailed-plan.ts` | Detailed Chapter Plan V2 evolving `ChapterIntent/ChapterMemo`, typed binding refs, PLAN_SCOPE_TOO_BROAD | T15 |
| `core/src/planning/gate.ts` | Planning Gate L1 (deterministic) + L2 (semantic) + truth-table resolution | T16 |
| `core/src/planning/repair.ts` | **Planning-specific bounded repair**: `PlanningFinding`, `PlanningRepairOutcome`, `reviewDetailedPlan`, `repairDetailedPlanLocal`, `verifyDetailedPlanRepair` | T16 |
| `core/src/planning/transition.ts` | Arc completion outcomes + auto-close/activate (never auto-Publish) | T21 |
| `core/src/context/composer.ts` | Authority Spine + dependency retrieval + continuity + semantic supplement; P0–P4 profiles | T17 |
| `core/src/context/bundle.ts` | ContextBundle schema + **structured `ContextSourceProvenance`** + staleness | T17 |
| `core/src/context/budget.ts` | Budget policy (reserve output, deterministic projection, soft trim, semantic compression allowlist, no auto model switch, CONTEXT_BUDGET_EXCEEDED) | T17 |
| `core/src/execution/snapshot.ts` | Atomic Execution Snapshot freeze + provenance + prepare-race failure | T18 |
| `core/src/execution/attempt-store.ts` | **Durable ExecutionAttempt persistence** (create/load/recordRunning/recordDrafted/recordFailure/abortForPlanDefect/accept) | T18 |
| `core/src/execution/attempt.ts` | Attempt lifecycle + defect routing (PROSE/PLAN/AUTHORITY/CANON) + 2-replan cap | T18 |
| `core/src/pipeline/runner.ts` (modify) | **Core production write gate**: resolve authority → fresh Detailed Plan → Planning Gate SAFE → Context Composer → budget check → Snapshot freeze → Writer; every Writer invocation requires a valid snapshot | T19 |
| `core/src/state/settlement-integration.ts` | **Evidence-derived** authorization consumption (atomic with Canon) + laggable post-commit effects | T20 |
| `core/src/state/state-review-finalize.ts` (modify) | Validated consumption writes inside the SAME prepared atomic set as Canon writes | T20 |
| `core/src/index.ts` | Public barrel exports for new modules | T1+ |
| `studio/src/lib/foundation-api.ts`, `planning-api.ts` | Typed clients (StateReviewPage precedent) | T22/T23 |
| `studio/src/pages/FoundationPage.tsx` (+ `foundation-ui-state.ts`/`.test.ts`) | Foundation unit review/revision/Publish UI consuming Core ops | T22 |
| `studio/src/pages/PlanningPage.tsx` (+ `planning-ui-state.ts`/`.test.ts`) | Arc/Beat/Lookahead/detailed-plan UI; Direction NL via Core parser | T23 |
| `studio/src/api/server.ts` (modify) | Two route blocks (foundation base, planning base) consuming Core ops only | T22/T23 |
| `cli/src/commands/foundation.ts`, `planning.ts`; modify `status.ts`, `write.ts` | Safe operational surface + readiness blockers; gates respected in `write next` | T24 |

Justified split: none of the existing files are refactored except `runner.ts` (T19 adds
the Core write gate inside the existing `writeNextChapter` orchestration) and
`state-review-finalize.ts` (T20 adds validated consumption writes to its existing atomic
set) and `models/book.ts` (T1 additive optional field).

---

## Expected implementation order (mapped to tasks)

```
1  → T1    governance domain contracts / capability markers / vocabularies (+ PlanningDependencyRef)
2  → T2    Foundation V2 unit manifests + logical content locators
3  → T3    legacy bootstrap + upgrade candidate preparation (prepared only; NO preflight, NO publish)
4  → T4    readiness + dependencies + direct invalidation
5  → T5    generic version/history primitives (restore ⇒ revision candidate)
6  → T6    conflict classification + Human Resolution
7  → T7    foundation reviewer findings + bounded repair
8  → T8    Foundation revision/review service (Human approval state transitions)
9  → T9    TransactionCoordinator + Foundation Human Publish + atomic V2 marker + external edits
10 → T10   Foundation AI pipeline (stops at Human-reviewable Draft)
11 → T11   Human Direction + Authorization (pending→active, typed scopes) + Core NL parser
12 → T12   Arc Plan storage + Major Beat model (NO publish)
13 → T13   Arc Planner + Arc preflight + Human Publish boundary
14 → T14   Rolling Lookahead lifecycle + typed selective invalidation
15 → T15   Detailed Chapter Plan V2
16 → T16   Planning Gate + planning-specific bounded repair
17 → T17   Context Composer (structured provenance, budget, no auto model switch)
18 → T18   Execution Snapshot + durable Execution Attempts
19 → T19   Core Writer execution gate (runner.ts — every Writer call needs a valid snapshot)
20 → T20   Phase 4 settlement integration (evidence-derived consumption, atomic + laggable)
21 → T21   Arc completion / transition (never auto-Publish)
22 → T22   Studio Foundation governance surface
23 → T23   Studio Planning governance surface (Core NL parsing)
24 → T24   CLI safe operational integration
25 → T25   legacy upgrade E2E / compatibility / recovery scenarios (test-only)
26 → T26   final Phase 5 acceptance (Definition of Done)
```

Post-review corrections: restore produces revision candidates only (T5/T12); the Arc
Planner/preflight pipeline is a real task (T13) and `publishArcPlan` lives THERE, not in
T12 (storage-only) — no Core path can create Arc authority before preflight exists; the
Core write gate lives in `runner.ts` (T19) with an explicit governance-mode write
matrix; Foundation Human approval is a dedicated Core service (T8) that computes/verifies
state; Foundation Publish loads trusted persisted revision state (T9); V2 marker
activation is atomic with first Human Publish (T9/T13); Authorization becomes CONSUMED
only inside Canon settlement (T20); planning/context dependency refs share one typed
vocabulary capturing observed state (T1).

---

## Task 1 — Governance domain contracts, capability markers, stable vocabularies

**Files**
- Create `packages/core/src/governance/contracts.ts`
- Modify `packages/core/src/models/book.ts` (additive optional `governance` field on
  `BookConfigSchema`; absent ⇒ legacy — existing books parse unchanged)
- Create `packages/core/src/__tests__/governance-contracts.test.ts`

**Interfaces** (zod, repo convention)

```ts
export const FoundationGovernanceModeSchema = z.enum(["legacy", "v2"]);
export const PlanningGovernanceModeSchema = z.enum(["legacy", "v2"]);
export const GovernanceMarkersSchema = z.object({
  foundation: FoundationGovernanceModeSchema.default("legacy"),
  planning: PlanningGovernanceModeSchema.default("legacy"),
});
export type GovernanceMarkers = z.infer<typeof GovernanceMarkersSchema>;
// BookConfigSchema gains: governance: GovernanceMarkersSchema.optional()

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
export type HookAuthorityLevel = z.infer<typeof HookAuthorityLevelSchema>; // inferred TS type for interfaces
// Path-safe governance IDs — ANY id that can influence a filesystem location must
// validate through this helper (unitId, revisionId, candidateId, arcId, draftId,
// beatId, planId, lookaheadId, snapshotId, attemptId, directionId, authorizationId…).
// Rejects path separators, "..", absolute paths, drive prefixes, NUL/control chars,
// unsafe empty/oversize values. All path construction maps validated IDs into known
// Core-owned roots (path-safety tests added here, before T25).
export const SafeGovernanceIdSchema = z.string().min(1).max(128)
  .refine((v) => !/[\\/\u0000-\u001f]/.test(v), "path separator or control character")
  .refine((v) => v !== "." && v !== ".." && !v.startsWith(".."), "dot traversal")
  .refine((v) => !/^[a-zA-Z]:/.test(v) && !v.startsWith("/") && !v.startsWith("\\"), "absolute/drive path");
export type SafeGovernanceId = z.infer<typeof SafeGovernanceIdSchema>;
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
export const AuthorizationLifecycleSchema = z.enum([
  "pending", "active", "consumed", "expired", "cancelled",
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
  "pending", "active", "satisfied", "unsatisfied", "expired", "superseded", "cancelled",
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
// Typed dependency refs shared by Lookahead / Detailed Plan / Context (single vocabulary).
// RUNTIME-VALIDATED schema (zod discriminatedUnion), because these refs come from
// external/AI/file data and must be rejected at runtime.
export const PlanningDependencyRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("foundation_unit"), unitId: z.string(), contentRevision: z.number(), approvedRevision: z.number(), foundationVersion: z.number() }),
  z.object({ kind: z.literal("canon_fact"), factKey: z.string(), canonRevision: z.number(), evidenceRevision: z.string() }),
  z.object({ kind: z.literal("hook"), hookId: z.string(), authority: HookAuthorityLevelSchema, observedLifecycleRevision: z.string() }),
  z.object({ kind: z.literal("relationship"), relationshipId: z.string(), observedStateRevision: z.string() }),
  z.object({ kind: z.literal("timeline"), anchorId: z.string(), observedRevision: z.string() }),
  z.object({ kind: z.literal("character_state"), characterId: z.string(), observedStateRevision: z.string() }),
  z.object({ kind: z.literal("arc_beat"), beatId: z.string(), observedEvidenceRevision: z.string() }),
  z.object({ kind: z.literal("human_direction"), directionId: z.string(), lifecycleRevision: z.string() }),
  z.object({ kind: z.literal("authorization"), authorizationId: z.string(), lifecycleRevision: z.string(), confirmedAt: z.string().optional() }),
]);
export type PlanningDependencyRef = z.infer<typeof PlanningDependencyRefSchema>;

// Foundation dependency vocabulary is CORE-OWNED and finite — AI selects valid concrete
// links but can never invent dependency semantics.
export const FoundationDependencyKindSchema = z.enum([
  "requires_character", "references_book_rule", "uses_hook", "timeline_after",
  "relies_on_arc_direction", "relates_relationship", "extends_story_frame",
]);
export const FoundationDependencyRefSchema = z.object({
  kind: FoundationDependencyKindSchema,
  targetUnitId: z.string(),
  observedRevision: z.union([z.number(), z.string()]).optional(),
});
export type FoundationDependencyRef = z.infer<typeof FoundationDependencyRefSchema>;

// Generic future-planning artifact kinds for the PlanningInvalidationRegistry (T12):
// Arc Publish (T13) invalidates these generically WITHOUT importing T14/T15 types.
export const PlanningArtifactKindSchema = z.enum(["lookahead", "detailed_plan"]);
export type PlanningArtifactKind = z.infer<typeof PlanningArtifactKindSchema>;

// The observed token is a revision number or a stable hash depending on the existing
// store; the artifact MUST carry enough information to detect a direct change without
// staling on unrelated Canon changes. A schema member like HookAuthorityLevelSchema is
// exported as `type HookAuthorityLevel = z.infer<typeof HookAuthorityLevelSchema>` —
// interfaces use the inferred TS type, never the zod value.
```

**Steps**

- [ ] Write the failing test (schemas parse every canonical member; reject unknown
      values; markers default to `legacy` when absent; explicit `"v2"` marker wins; an
      unknown marker value fails closed; existing books without `governance` still
      parse; `PlanningDependencyRefSchema` parses every variant and REJECTS
      malformed/unknown variants at runtime; `FoundationDependencyKindSchema` rejects
      invented kinds; `SafeGovernanceIdSchema` rejects path separators, `..`,
      absolute/drive paths, control characters, and oversize values — path-traversal
      negative tests). Run
      `pnpm --filter @actalk/castor-core exec vitest run src/__tests__/governance-contracts.test.ts`
      and verify failure (module missing).
- [ ] Implement `contracts.ts` + `BookConfigSchema` additive field; re-run targeted test → PASS.
- [ ] Run `pnpm --filter @actalk/castor-core exec vitest run src/__tests__/models.test.ts` (regression).
- [ ] Run the Task Completion Gate using commit message
      `feat(core): phase 5 governance domain contracts and vocabularies`.

## Task 2 — Foundation V2 unit manifests with logical content locators

**Files**
- Create `packages/core/src/foundation/manifest.ts`
- Create `packages/core/src/__tests__/foundation-manifest.test.ts`

**Interfaces**

```ts
export type FoundationContentLocator =
  | { readonly sourceRelPath: string; readonly contentKind: "whole_file" }
  | { readonly sourceRelPath: string; readonly contentKind: "section"; readonly sectionKey: string }
  | { readonly sourceRelPath: string; readonly contentKind: "rule"; readonly ruleId: FoundationSourceKey }
  | { readonly sourceRelPath: string; readonly contentKind: "entry"; readonly entryKey: string };

// Two DIFFERENT identities for the `rule` locator (implementation-discovered):
//   unitId = SafeGovernanceId  — stable, Windows/path-safe governed identity.
//   ruleId = FoundationSourceKey — bounded selector for the EXISTING Markdown H2
//     heading text (e.g. "/" CONTAINS "/" because the real book_rules
//     card heading does). ruleId is NEVER used as a filesystem path component and
//     is NOT SafeGovernanceId; the manifest unitId remains path-safe.

export interface FoundationUnitManifest {
  readonly unitId: SafeGovernanceId;         // stable logical identity, not basename
  readonly kind: FoundationUnitKind;
  readonly importance: Importance;
  readonly status: FoundationUnitStatus;     // "stale" is a STATUS — no separate durable stale flag
  readonly locator: FoundationContentLocator;   // multiple units may share one file
  readonly contentHash: string;              // computeProseRevision(governed logical content)
  readonly contentRevision: number;          // increments whenever governed draft content changes
  readonly approvedRevision?: number;        // the contentRevision explicitly approved by Human
  readonly dependencies: ReadonlyArray<FoundationDependencyRef>;  // Core-owned kinds only (T1)
  readonly approvedAt?: string;
  readonly approvedBy?: string;
  readonly provenance?: FoundationUnitProvenance;  // STRICT RESERVED EMPTY envelope — NO free-form
  // payload. Governance JSON is metadata only (no-shadow-prose invariant): z.record/
  // arbitrary blobs/free-form prose fields must never be reintroduced here.
}
export function isUnitApproved(manifest: FoundationUnitManifest): boolean;
// approved means: status === "approved" && approvedRevision === contentRevision && all
// approval predicates remain valid. Editing after approval increments contentRevision
// and status becomes needs_review. Derived UI booleans (e.g. an in-memory stale flag)
// are computed from status — never a second durable truth source.
export async function readUnitManifests(bookDir: string): Promise<Map<string, FoundationUnitManifest>>;
export async function writeUnitManifest(bookDir: string, manifest: FoundationUnitManifest): Promise<void>;
export async function extractGovernedContent(bookDir: string, locator: FoundationContentLocator): Promise<string>;
```

Grounded locator mapping (existing layout): Story Frame = `story/outline/story_frame.md`
with section keys `theme_tone | core_conflict | world_setting | ending_direction` —
four independent units sharing one file; Book Rules = `story/book_rules.md` with
per-rule IDs; Characters = `story/roles/<tier>/*.md` (whole-file per sheet); Hooks =
`story/pending_hooks.md` (per-hook entry); Arc Direction = `story/outline/volume_map.md`
(whole_file or per-volume `entry`). Manifest files live under
`story/foundation-v2/<unit-id>.gov.json`; Markdown remains creative content authority
and JSON never duplicates prose.

**Steps**

- [ ] Write failing tests: round-trip write/read; content hash computed over the
      GOVERNED logical content (a section change changes only that unit's hash); the
      four Story Frame units share `story_frame.md` and are governed independently;
      per-rule Book Rule governance; unknown kind rejected; manifest has no prose
      field; **revision model**: `status: "approved"` with
      `approvedRevision !== contentRevision` is INVALID; `status: "stale"` cannot
      simultaneously claim an independent non-stale flag (no second durable stale
      truth); editing after approval increments contentRevision and moves status to
      `needs_review`; unitId passes `SafeGovernanceIdSchema`.
- [ ] Implement `manifest.ts`; targeted run → PASS.
- [ ] Regressions (`outline-paths`/architect tests), typecheck.
- [ ] Run the Task Completion Gate using commit message
      `feat(core): foundation v2 unit manifests with logical content locators`.

## Task 3 — Legacy Foundation bootstrap + upgrade candidate preparation (prepared only)

**Files**
- Create `packages/core/src/foundation/bootstrap.ts`
- Create `packages/core/src/__tests__/foundation-bootstrap.test.ts`

**Interfaces**

```ts
export interface BootstrapResult {
  readonly mode: FoundationGovernanceMode;   // explicit marker or legacy
  readonly units: ReadonlyArray<FoundationUnitManifest>;
  readonly upgradeCandidateReady: boolean;
}
export async function bootstrapFoundation(bookDir: string): Promise<BootstrapResult>;
// DURABLE working/candidate record — resolvable across the declared boundary because
// Task 10 consumes it by candidateId. Never authoritative.
export interface UpgradeCandidate {
  readonly candidateId: SafeGovernanceId;
  readonly status: "prepared";               // NEVER preflight/approved/published here
  readonly revisionDraft: ReadonlyArray<FoundationUnitManifest>;  // legacy_established source content
  readonly canonRevision: number;
  readonly createdAt: string;
}
export async function prepareFoundationV2Upgrade(bookDir: string): Promise<UpgradeCandidate>;   // persists
export async function loadUpgradeCandidate(bookDir: string, candidateId: string): Promise<UpgradeCandidate | null>;
export async function deleteUpgradeCandidate(bookDir: string, candidateId: string): Promise<void>;
```

Rules: legacy books parse the existing layout into `legacy_established` units (NOT
approved); books with existing chapters stay in compatibility mode; upgrade is opt-in;
`prepareFoundationV2Upgrade` ONLY creates the candidate (`status: "prepared"`) and
PERSISTS it to a working/candidate store (`loadUpgradeCandidate`/`deleteUpgradeCandidate`
provided) so Task 10 can consume it by candidateId. **AI preflight, current-Canon check,
repair, and Human-review readiness belong to the later pipeline orchestration (T7
findings + T10 pipeline) — not here. There is no hidden forward dependency.** Candidate
creation never publishes, never flips markers, and never rewrites chapters/Canon (assert
content hashes + `story/state/*.json` byte-identical).

**Steps**

- [ ] Write failing tests: legacy book → units `legacy_established`, none approved;
      `prepareFoundationV2Upgrade` returns `status: "prepared"` with zero authority
      side effects (no published version, no marker flip, chapters/Canon
      byte-identical) AND is loadable by candidateId via `loadUpgradeCandidate`;
      explicit `"v2"` marker skips bootstrap; unknown marker fails closed.
- [ ] Implement `bootstrap.ts`; targeted run → PASS.
- [ ] Regressions: `pipeline-runner.test.ts` bootstrap tests; typecheck.
- [ ] Run the Task Completion Gate using commit message
      `feat(core): legacy foundation bootstrap and v2 upgrade candidate preparation`.

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
export function declareDependency(unitId: string, kind: FoundationDependencyKind, targetUnitId: string): void;
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
- [ ] Run the Task Completion Gate using commit message
      `feat(core): foundation readiness and direct dependency invalidation`.

## Task 5 — Generic version/history primitives (restore ⇒ revision candidate)

**Files**
- Create `packages/core/src/governance/versions.ts`
- Create `packages/core/src/__tests__/governance-versions.test.ts`

**Interfaces** (generic only — NO forward type references; the Foundation version is ONE
global authority version, NOT a per-unit version)

```ts
export interface VersionEnvelope<TSnapshot> {
  readonly artifactKind: "foundation" | "arc_plan";
  readonly unitId: string;                 // "foundation" for the whole-Foundation snapshot; arcId for arc plans
  readonly version: number;
  readonly parentVersion: number | null;
  readonly baseCanonRevision: number;
  readonly contentHash: string;            // hash of the snapshot record (governance refs only)
  readonly snapshot: TSnapshot;
  readonly publishedAt: string;
  readonly publishedBy: string;
  readonly restoredFromVersion?: number;
}
// Whole-Foundation authoritative snapshot: ONE global Foundation version (v1, v2, v3…).
// Stores governance refs/hashes ONLY — creative Markdown prose is NEVER duplicated into JSON.
export interface FoundationPublishedSnapshot {
  readonly unitRefs: ReadonlyArray<{
    readonly unitId: string;
    readonly contentRevision: number;
    readonly approvedRevision: number;
    readonly contentHash: string;
  }>;
  readonly changedUnitIds: ReadonlyArray<string>;
  readonly humanResolutionIds: ReadonlyArray<string>;
  readonly dependencyImpact: ReadonlyArray<string>;
  readonly baseCanonRevision: number;
}
export type FoundationVersion = VersionEnvelope<FoundationPublishedSnapshot>;
// READ-ONLY history access. Version WRITES are prepared here and COMMITTED only by the
// Task 9 TransactionCoordinator — never appended standalone.
export interface VersionStore {
  readonly prepareVersionAppend: <T>(v: Omit<VersionEnvelope<T>, "publishedAt">) => PreparedVersionWrites;
  readonly prepareCurrentVersionPointer: (artifactKind: string, unitId: string, version: number) => AtomicFileWrite;
  readonly readVersion: <T>(artifactKind: string, unitId: string, version: number) => Promise<VersionEnvelope<T> | null>;
  readonly readCurrentVersion: <T>(artifactKind: string, unitId: string) => Promise<VersionEnvelope<T> | null>;
  readonly listVersions: (artifactKind: string, unitId: string) => Promise<ReadonlyArray<number>>;
  readonly verifyIntegrity: (artifactKind: string, unitId: string) => Promise<ReadonlyArray<string>>;
}
export interface PreparedVersionWrites {
  readonly writes: ReadonlyArray<AtomicFileWrite>;   // immutable version record + current-version pointer/materialization only
}
// Task 5 NEVER creates TransactionCoordinator journal entries — journal metadata is
// created only by runTransaction (Task 9), which owns the ONE journal/persistence
// semantics. Prepared writes are committed exclusively inside that publication
// transaction together with marker activation and dependency invalidation.
export interface RevisionCandidate<TSnapshot> {
  readonly artifactKind: "foundation" | "arc_plan";
  readonly unitId: string;
  readonly parentVersion: number;          // = CURRENT published version
  readonly restoredFromVersion: number;    // selected historical version
  readonly baseCanonRevision: number;      // CURRENT Canon
  readonly status: "draft" | "needs_review";
  readonly snapshot: TSnapshot;
}
export async function restoreVersionAsRevisionCandidate<T>(
  store: VersionStore, artifactKind: string, unitId: string, fromVersion: number, currentCanonRevision: number,
): Promise<RevisionCandidate<T>>;
```

Foundation history is `Foundation v1 → v2 → v3 …`, each version identifying the complete
authoritative Foundation state; individual unit revisions are governed independently
beneath that global version. The first Human Foundation Publish creates Foundation v1; a
later revision changing two units creates Foundation v2 whose snapshot references the
unchanged approved unit revisions plus the two new approved revisions.

Scope discipline: Task 5 owns version/history semantics only. **`restoreVersionAsRevisionCandidate`
produces a revision candidate — it MUST NOT append a new Published authority version,
MUST NOT advance the authoritative current pointer, and MUST NOT bypass current
Canon/dependency review.** No pre-transaction append of a Published version:
`prepareVersionAppend`/`prepareCurrentVersionPointer` return writes that are COMMITTED
only inside Task 9's publication transaction together with capability-marker activation
and dependency invalidation. Human Publish (Task 9) later creates the new immutable
Published version. No `ArcPlanVersion` alias here — `ArcPlanSnapshot` does not exist
until Task 12, which defines `type ArcPlanVersion = VersionEnvelope<ArcPlanSnapshot>`
after introducing the snapshot type. After each Task's commit the repository must
typecheck (dependency-order rule).

**Steps**

- [ ] Write failing tests: read/current/list round-trips; immutability (a version record
      cannot be mutated after it is committed); **one Publish prepares exactly ONE new
      Foundation version**; changing one unit still increments the global Foundation
      version once (via a prepared append) while unchanged units keep their approved
      revisions; **restore leaves the current published authority unchanged**
      (readCurrentVersion identical before/after) and returns a `RevisionCandidate`;
      integrity verification detects tampering; prepared writes are NOT committed by
      `VersionStore` itself (no side effect until the coordinator commits them).
- [ ] Implement `versions.ts`; targeted run → PASS.
- [ ] Typecheck; run the Task Completion Gate using commit message
      `feat(core): global foundation version history primitives with restore-as-candidate`.

## Task 6 — Conflict classification (two-layer) + Human Resolution Record

**Files**
- Create `packages/core/src/governance/conflicts.ts`
- Create `packages/core/src/__tests__/governance-conflicts.test.ts`

**Interfaces** (ALL revision-scoped — every operation binds an explicit working
`revisionId`; Published Foundation vN remains read-only context)

```ts
export interface ConflictEvidence { readonly source: string; readonly detail: string; }
export type FoundationConflictResult =
  | { kind: "future_safe"; evidence: ReadonlyArray<ConflictEvidence> }
  | { kind: "uncertain"; evidence: ReadonlyArray<ConflictEvidence>; semanticConcern: string }
  | { kind: "canon_conflict"; evidence: ReadonlyArray<ConflictEvidence>; canonRevision: number };
export function classifyCanonConflictDeterministic(bookDir: string, revisionId: string, unitId: string): Promise<FoundationConflictResult>;
export function classifyCanonConflictSemantic(bookDir: string, revisionId: string, unitId: string): Promise<Extract<FoundationConflictResult, { kind: "uncertain" | "future_safe" }>>;
export interface HumanResolutionRecord {
  readonly resolutionId: string;
  readonly revisionId: string;              // binds the EXACT working revision
  readonly unitId: string;
  readonly findingId: string;
  readonly evidence: ReadonlyArray<ConflictEvidence>;
  readonly canonRevision: number;
  readonly resolver: string;
  readonly choice: "compatible" | "revise";
}
// Human-facing operation: caller names only the REAL finding, the choice, and the Human
// actor. Core loads the exact persisted FoundationFinding (contentRevision/contentHash,
// deterministic/semantic evidence), the current Canon revision, and the revision state,
// then constructs and persists HumanResolutionRecord ITSELF.
export async function resolveFoundationUncertainty(input: {
  bookDir: string;
  revisionId: string;
  findingId: string;
  choice: "compatible" | "revise";
  humanActor: string;
}): Promise<HumanResolutionRecord>;
export async function isResolutionStillValid(bookDir: string, resolutionId: string): Promise<boolean>;
```

Negative guarantees: the semantic layer can emit `uncertain` but NEVER `canon_conflict`;
a hard `canon_conflict` requires deterministic Core evidence; a recorded resolution is
invalidated when its bound revision/evidence or Canon revision changes; classification
reads the EXACT Revision Draft — when Revision A and Revision B coexist, A's analysis
never reads B's content as its target. **A caller cannot fabricate evidence or a Canon
revision for a resolution — `resolveFoundationUncertainty` binds Core-verified evidence
and the current Canon revision; a stale finding (draft content changed since it was
computed) is rejected and requires re-review.**

**Steps**

- [ ] Write failing tests for the negative guarantees + the coexistence test (two
      simultaneous revisions; classifying A must read A's draft, never B) +
      resolution trust tests (caller cannot fabricate evidence/Canon revision; stale
      finding cannot be resolved; a valid resolution binds exact evidence + current
      Canon); targeted → fail.
- [ ] Implement; targeted → PASS; typecheck.
- [ ] Run the Task Completion Gate using commit message
      `feat(core): revision-scoped foundation conflict classification and trusted human resolutions`.

## Task 7 — Foundation reviewer findings + bounded repair

**Files**
- Create `packages/core/src/foundation/review.ts`
- Create `packages/core/src/__tests__/foundation-review.test.ts`

**Interfaces**

```ts
// Core-owned finding categories — AI cannot invent arbitrary categories.
export const FoundationFindingCategorySchema = z.enum([
  "story_core", "character", "relationship", "world", "structure",
  "pacing_feasibility", "hook", "timeline", "book_rule", "dependency",
  "internal_consistency", "author_intent_alignment",
]);
export type FoundationFindingCategory = z.infer<typeof FoundationFindingCategorySchema>;
export interface FoundationFinding {
  readonly findingId: string;
  readonly revisionId: string;              // binds the EXACT working revision
  readonly unitId: string;
  readonly contentRevision: number;         // content revision the finding was computed against
  readonly contentHash: string;             // hash the finding was computed against
  readonly category: FoundationFindingCategory;   // runtime-validated, Core-owned
  readonly severity: FindingSeverity;
  readonly repairScope: RepairScope;
  readonly evidence: string;
  readonly suggestedAction: string;
}
export type RepairOutcome =
  | { status: "repaired"; round: number }
  | { status: "needs_human_direction"; round: number; remaining: ReadonlyArray<FoundationFinding> }
  | { status: "clean" };
export async function reviewFoundationRevision(bookDir: string, revisionId: string): Promise<ReadonlyArray<FoundationFinding>>;
export async function applyBoundedFoundationRepair(bookDir: string, revisionId: string, targetUnitIds: ReadonlyArray<string>, findings: ReadonlyArray<FoundationFinding>, round: number): Promise<RepairOutcome>;
export async function verifyFoundationRepairs(bookDir: string, revisionId: string, targetUnitIds: ReadonlyArray<string>, findings: ReadonlyArray<FoundationFinding>, round: number): Promise<ReadonlyArray<FoundationFinding>>;
```

Policy encoded and tested: reviewer reads the EXACT Revision Draft; repair writes ONLY
into that Revision Draft; Published Foundation vN remains read-only context; approved
sibling units are never modified by a LOCAL repair; findings bind
revisionId+unitId+content revision/hash — **a stale finding (draft content changed since
it was computed) cannot be applied**; MINOR+LOCAL auto-repairs; IMPORTANT+LOCAL
auto-repairs with mandatory targeted re-review; MULTI_UNIT never silently repaired;
AUTHOR_DECISION routes to human; BLOCKING unresolved blocks Publish; semantic repair
capped at 2 rounds then `needs_human_direction`; `verifyFoundationRepairs` is a separate
invocation (no self-certification). **AI repair can never approve a unit** — approval is
exclusively the Human review service (Task 8).

**Steps**

- [ ] Write failing tests incl. write-scope enforcement, the 2-round cap, stale-finding
      rejection after draft content change, and the coexistence test (Revision A and
      Revision B exist simultaneously; review/repair A MUST NOT touch or read B as its
      target); targeted → fail.
- [ ] Implement; targeted → PASS; regressions (`foundation-reviewer` agent tests).
- [ ] Run the Task Completion Gate using commit message
      `feat(core): revision-scoped foundation findings and bounded repair`.

## Task 8 — Foundation revision/review service (Human approval state transitions)

**Files**
- Create `packages/core/src/foundation/revision-service.ts`
- Create `packages/core/src/__tests__/foundation-revision-service.test.ts`

**Interfaces** (Human says WHAT to approve; Core computes/verifies the trusted state —
caller-supplied revisions/hashes are never truth; every approval carries explicit
`humanActor` provenance)

```ts
// Durable revision draft — governance references/revisions/hashes and working-state
// metadata only; NEVER duplicates Markdown prose.
export interface FoundationRevisionDraft {
  readonly revisionId: SafeGovernanceId;
  readonly baseFoundationVersion: number | null;   // null when no Foundation v1 exists yet (upgrade path)
  readonly baseCanonRevision: number;
  readonly status: "open" | "needs_review" | "reviewed" | "discarded";
  readonly unitStates: ReadonlyArray<{
    readonly unitId: SafeGovernanceId;
    readonly contentRevision: number;
    readonly approvedRevision?: number;
    readonly contentHash: string;
    readonly state: "draft" | "needs_review" | "approved" | "stale";
  }>;
  readonly approvalRecords: ReadonlyArray<{ unitId: SafeGovernanceId; approvedRevision: number; approvedBy: string; approvedAt: string }>;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly restoredFromVersion?: number;
}
export async function openFoundationRevision(bookDir: string, unitIds: ReadonlyArray<SafeGovernanceId>): Promise<{ revisionId: string }>;
export async function loadFoundationRevision(bookDir: string, revisionId: string): Promise<FoundationRevisionDraft>;
export async function saveFoundationUnitDraft(bookDir: string, revisionId: string, unitId: string, content: string): Promise<void>;
export async function approveFoundationUnit(bookDir: string, revisionId: string, unitId: string, humanActor: string): Promise<void>;
export async function markFoundationUnitNeedsRevision(bookDir: string, revisionId: string, unitId: string, reason: string): Promise<void>;
export async function reapproveStaleFoundationUnit(bookDir: string, revisionId: string, unitId: string, humanActor: string, resolutionId?: string): Promise<void>;
export async function discardFoundationRevision(bookDir: string, revisionId: string): Promise<void>;
export async function approveFoundationUnitsBatch(bookDir: string, revisionId: string, unitIds: ReadonlyArray<SafeGovernanceId>, humanActor: string): Promise<{ approved: ReadonlyArray<string>; rejected: ReadonlyArray<{ unitId: string; reason: string }> }>;
```

Approval semantics: the Human call names the unit and the acting Human; **Core computes
and verifies the current draft content revision, the content hash, the dependency
declaration, and review eligibility, then persists the approval record bound to
contentRevision/approvedRevision/hash/dependencies with `approvedBy` from the explicit
`humanActor`**. For stale reapproval Core itself verifies any required Human
Resolution. `writeUnitManifest` remains an internal persistence primitive — it is NOT
exposed as a public authority-transition API. No revision-service operation changes
current Published authority.

Rules (state-transition tests for each): approved Published content remains immutable;
opening revision creates working state only; manual edit → `needs_review`; AI repair can
never approve; only explicit Human action can approve/reapprove; stale cannot silently
become approved (requires the resolution record when applicable); batch approval only for
clean eligible units; Publish remains Task 9.

**Steps**

- [ ] Write failing tests: full state-transition table; approved-unit immutability;
      manual edit → needs_review; AI-repair-cannot-approve; stale
      reapproval-requires-resolution; batch approval rejects ineligible units; publish
      authority unchanged by any revision op; **a caller-fabricated hash or revision
      cannot be approved (Core recomputes the hash and rejects mismatches)**;
      **approval records carry `approvedBy` from the explicit humanActor**;
      **content isolation: open revision + edit → Published Markdown hash/content
      unchanged and Planner/Writer still read the old Published content; two Revision
      Drafts hold different content for the same unit; discard revision → Published
      content unchanged**.
- [ ] Implement `revision-service.ts`; targeted → PASS; typecheck.
- [ ] Run the Task Completion Gate using commit message
      `feat(core): foundation human review service with explicit approval transitions`.

## Task 9 — TransactionCoordinator + Foundation Human Publish + atomic V2 marker + external edits

**Files**
- Create `packages/core/src/governance/transactions.ts`
- Create `packages/core/src/foundation/publish.ts`
- Create `packages/core/src/__tests__/governance-transactions.test.ts`
- Create `packages/core/src/__tests__/foundation-publish.test.ts`

**Interfaces**

```ts
export type TransactionStage =
  | "prepare" | "validate" | "stage" | "journal" | "commit" | "materialize" | "finalize";
export interface TransactionInput {
  readonly bookDir: string;
  readonly writes: ReadonlyArray<AtomicFileWrite>;
  readonly deletes: ReadonlyArray<string>;
  readonly revalidate: () => Promise<ReadonlyArray<string>>;   // failures => REVISION_BASE_STALE
}
export type TransactionResult = { status: "committed" } | { status: "revision_base_stale"; reasons: ReadonlyArray<string> };
export async function runTransaction(input: TransactionInput): Promise<TransactionResult>;

export interface PublishGateInput {
  readonly bookDir: string;
  readonly revisionId: string;               // Human-reviewed revision (Task 8)
  readonly humanActor: string;
  readonly expectedBaseFoundationVersion: number;
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
export async function publishFoundation(input: PublishGateInput): Promise<PublishOutcome>;
export async function handleExternalEdit(bookDir: string, unitId: string, action: "compare" | "adopt_into_revision" | "discard"): Promise<void>;
```

**Trusted Publish contract:** the caller requests Publish (bookDir, revisionId, humanActor,
expected base versions) and does NOT supply authoritative unit states. Core loads from
trusted persistence: the Task 8 `FoundationRevisionDraft` + approval records, current
governed Markdown hashes, approved revisions, declared dependencies, Human Resolution
records, external-change state, current Canon, and current Published Foundation — then
evaluates the Publish Gate itself and builds the `FoundationPublishedSnapshot`. A caller
fabricating an "approved" manifest, hash, or resolution list cannot Publish.

Gate requires: required units ready — **approved means
`approvedRevision === contentRevision` per `isUnitApproved` (status `stale` is the only
durable staleness source)**; no canon conflicts; required uncertainties resolved; stale
handled; graph valid; hashes valid (recomputed from Markdown); no unresolved external
changes. Publish is deterministic and short;
revalidation immediately before COMMIT; `REVISION_BASE_STALE` on base change; external
content never inherits approval. `publishFoundation` is the ONLY operation that creates
Foundation authority — invoked by the Human via Studio/CLI/API, never by the AI pipeline
(Task 10). The committed atomic set includes: the prepared `VersionEnvelope`
(Foundation vN snapshot, via T5 `prepareVersionAppend` + `prepareCurrentVersionPointer`),
the capability-marker write, and required direct invalidations.

**Atomic governance-mode activation (Foundation):** the FIRST successful Human
Foundation V2 Publish atomically persists, in ONE transaction: Published Foundation v1
+ `governance.foundation = "v2"` + required direct invalidations. No marker flip before
Publish; no marker flip after Publish in a separate transaction. Fault tests around
marker activation: crash before COMMIT → marker stays `legacy` and no published v1;
crash after durable COMMIT → marker `v2` with published v1 present.

Fault injection (PRIMARY home for authoritative-Publish fault tests): before staging,
after staging, before COMMIT, after durable COMMIT, current-materialization failure,
journal finalization failure — old authority or fully committed new authority, never
half authority.

**Steps**

- [ ] Write failing tests: gate truth for each failure class (evaluated over persisted
      state, not caller manifests); stale-base rejection; external-edit flow
      (compare/adopt/discard, adopt never auto-approves); **atomic marker activation**
      (single transaction; both crash sides tested); **caller fabricating an approved
      manifest cannot Publish**; **a unit with `approvedRevision !== contentRevision`
      cannot Publish**; **content changed after approval → Publish fails**;
      **external edit after approval → Publish fails**; **one Publish creates exactly
      ONE new Foundation version**; the full fault-injection table; **book-scoped
      concurrency race: two concurrent Publish calls (Studio/CLI or two Core calls) —
      one wins, the other receives a typed `REVISION_BASE_STALE`/conflict result, no
      last-write-wins, no half authority**; targeted → fail.
- [ ] Implement `transactions.ts` then `publish.ts`; targeted → PASS.
- [ ] Regressions (`state-review-finalize` atomic tests), typecheck.
- [ ] Run the Task Completion Gate using commit message
      `feat(core): trusted transactional foundation publish with atomic v2 marker activation`.

## Task 10 — Foundation intelligence pipeline (stops at Human-reviewable Draft)

**Files**
- Create `packages/core/src/foundation/pipeline.ts`
- Create `packages/core/src/__tests__/foundation-pipeline.test.ts`

**Interfaces**

```ts
export interface AdaptiveIntakeResult {
  readonly mustKnowGaps: ReadonlyArray<string>;   // 0..3
  readonly helpfulProposals: ReadonlyArray<string>;
}
export async function adaptiveIntake(bookDir: string, known: Record<string, string>): Promise<AdaptiveIntakeResult>;
export type FoundationPipelineResult =
  | { status: "ready_for_human_review"; revisionId: string; findings: ReadonlyArray<FoundationFinding> }
  | { status: "needs_human_direction"; revisionId: string; findings: ReadonlyArray<FoundationFinding>; remainingRounds: number }
  | { status: "generation_failed"; reasons: ReadonlyArray<string>; revisionId?: string };
export async function runFoundationPipeline(bookDir: string, opts?: { upgradeCandidateId?: string }): Promise<FoundationPipelineResult>;
```

Behavior: intake extracts known info first and asks only MUST-KNOW gaps (0–3); the
Architect may propose helpful material; generation runs once globally for coherence;
review runs globally; repair runs locally (Task 7 policy); no whole-Foundation
regeneration for local issues; mechanical/schema retries separate from semantic rounds.

**Durable revision handoff:** the pipeline PERSISTS its Human-reviewable result through
the Task 8 revision service — it creates/uses the `revisionId` BEFORE any semantic
review/repair so ALL findings and repairs attach to that durable draft.
`ready_for_human_review` AND `needs_human_direction` both carry the durable
`revisionId` (Human resumes the SAME draft); `generation_failed` preserves and returns
the revisionId where a revision was already created rather than discarding useful
working state. Studio later loads via `loadFoundationRevision(revisionId)` and
approves/edits; it never reconstructs a revision from raw AI manifests.

**Upgrade hand-off boundary:** `prepareFoundationV2Upgrade()` (Task 3) PERSISTS a durable
`UpgradeCandidate` (`status: "prepared"`); Task 10 consumes it via
`runFoundationPipeline(bookDir, { upgradeCandidateId })` (loading it through
`loadUpgradeCandidate`), runs AI preflight/repair over the legacy content, and persists
the durable `revisionId`. The workflow is therefore: prepared candidate (durable) → AI
preflight/repair → durable Foundation revisionId → Human review (Task 8) → Human Publish
(Task 9). No missing hand-off boundary; the candidate is always resolvable across the
declared boundary.

**Authority boundary: the pipeline NEVER publishes.** Architect → Reviewer → Repair →
automatic Publish is forbidden; Human Publish is exclusively Task 9's
`publishFoundation`. Tests assert no published version and no marker flip after any
pipeline outcome.

**Steps**

- [ ] Write failing tests (mocked `ArchitectAgent`/`FoundationReviewerAgent`): intake
      asks only unknown MUST-KNOW gaps and 0–3 of them; local issue triggers a local
      repair, not a global regeneration; every outcome ends with NO published version
      and NO marker flip; clean run → `ready_for_human_review` WITH a durable
      `revisionId` loadable via `loadFoundationRevision`; exhausted rounds →
      `needs_human_direction`; generation failure → `generation_failed`; the upgrade
      hand-off (`upgradeCandidateId` → revisionId) round-trips.
- [ ] Implement `pipeline.ts`; targeted → PASS.
- [ ] Regressions: `architect`/`foundation-reviewer` agent tests; typecheck.
- [ ] Run the Task Completion Gate using commit message
      `feat(core): adaptive foundation pipeline producing durable human-reviewable revisions`.

## Task 11 — Human Direction + Authorization (pending → active) + Core NL parser

**Files**
- Create `packages/core/src/governance/authorizations.ts`
- Create `packages/core/src/__tests__/governance-authorizations.test.ts`

**Interfaces** (discriminated scope instances; pending authority is un-resolvable; NL
parsing lives in Core)

```ts
export type AuthorizationScope =
  | { kind: "exact_chapter"; chapterNumber: number }
  | { kind: "chapter_window"; startChapter: number; endChapter: number }
  | { kind: "arc"; arcId: string }
  | { kind: "condition"; condition: AuthorizationCondition }
  | { kind: "from_arc"; sourceArcId: string; targetArcId: string };
export type AuthorizationCondition =
  | { kind: "after_hook_advanced"; hookId: string }
  | { kind: "after_hook_resolved"; hookId: string }
  | { kind: "after_arc_started"; arcId: string }
  | { kind: "after_arc_climax"; arcId: string }
  | { kind: "after_chapter"; chapterNumber: number }
  | { kind: "after_relationship_state"; relationshipId: string; state: string }
  | { kind: "after_fact_exists"; factKey: string };
export type AuthorizationLifecycle =
  | "pending" | "active" | "consumed" | "expired" | "cancelled";
// Durable record: immutable base fields + lifecycle state. Terminal records RETAIN
// decisionKind/scope/consumption forever (governance provenance). Every lifecycle
// transition increments lifecycleRevision (matches PlanningDependencyRef semantics).
export interface AuthorizationRecord {
  readonly authorizationId: string;
  readonly decisionKind: AuthorDecisionKind;
  readonly scope: AuthorizationScope;
  readonly consumption: AuthorizationConsumption;
  readonly createdAt: string;
  readonly lifecycle: AuthorizationLifecycle;
  readonly lifecycleRevision: string;
  readonly confirmedAt?: string;
  readonly confirmedBy?: string;
  readonly consumedAt?: string;
  readonly consumedCanonRevision?: number;
  readonly expiredAt?: string;
  readonly cancelledAt?: string;
}
export type ActiveAuthorization = AuthorizationRecord & { lifecycle: "active" };
export type PendingAuthorization = AuthorizationRecord & { lifecycle: "pending" };
export async function createAuthorization(bookDir: string, a: { decisionKind: AuthorDecisionKind; scope: AuthorizationScope; consumption: AuthorizationConsumption }): Promise<PendingAuthorization>;
export async function confirmAuthorization(bookDir: string, id: string, humanActor: string): Promise<ActiveAuthorization>;
export async function loadAuthorization(bookDir: string, id: string): Promise<AuthorizationRecord | null>;
// Deterministic scope/condition evaluation context — covers ALL approved scope kinds
// (exact_chapter, chapter_window, arc, condition incl. every condition kind, from_arc)
// and ALL Human Direction scopes. Shared by Planning Gate and settlement evidence
// validation (one interpretation, no divergence).
export interface AuthorizationEvaluationContext {
  readonly chapterNumber: number;
  readonly currentArcId: string;
  readonly canonRevision: number;
  readonly hookStates: (hookId: string) => { readonly lifecycleState: HookLifecycleState; readonly lifecycleRevision: string };
  readonly relationshipStates: (relationshipId: string) => { readonly state: string; readonly stateRevision: string };
  readonly factResolver: (factKey: string) => { readonly exists: boolean; readonly canonRevision: number };
  readonly arcState: (arcId: string) => { readonly status: "not_started" | "started" | "climaxed" | "closed"; readonly revision: string };
}
export function authorizationApplies(a: ActiveAuthorization, context: AuthorizationEvaluationContext): boolean;
export function directionApplies(direction: HumanDirectionRecord & { lifecycle: "active" }, context: AuthorizationEvaluationContext): boolean;
// PURE (non-writing) evidence evaluation — consumption is PERSISTED only by Task 20
// inside the Canon settlement transaction. No standalone write path exists.
export function evaluateAuthorizationAgainstEvidence(
  a: ActiveAuthorization,
  evidence: CanonSettlementEvidence,
): { matches: boolean; reason: string };
export function deriveEligibleAuthorizationConsumption(
  authorizations: ReadonlyArray<ActiveAuthorization>,
  finalizedReview: ActiveStateReviewArtifact,
  evidence: CanonSettlementEvidence,
): ReadonlyArray<{ authorizationId: string; decisionKind: AuthorDecisionKind }>;

export type HumanDirectionScope =
  | { kind: "exact_chapter"; chapterNumber: number }
  | { kind: "chapter_window"; startChapter: number; endChapter: number }
  | { kind: "arc"; arcId: string }
  | { kind: "until_condition"; condition: AuthorizationCondition };
// HumanDirection also carries a stable lifecycleRevision (observed-state token for
// PlanningDependencyRef); base fields (directionId/text/scope) persist across states.
export interface HumanDirectionRecord {
  readonly directionId: string;
  readonly text: string;
  readonly scope: HumanDirectionScope;
  readonly lifecycle: HumanDirectionLifecycle;
  readonly lifecycleRevision: string;
  readonly createdAt: string;
  readonly confirmedAt?: string;
  readonly confirmedBy?: string;
  readonly resolvedAt?: string;
}
// Persisted pending proposal — the parse→confirm handoff is EXPLICIT. parse persists
// the proposal (NO authority); confirm loads THAT EXACT proposal, revalidates
// scope/conflicts/current authority, then activates. No ambiguous middle state.
export interface PendingHumanDirectionProposal {
  readonly directionId: SafeGovernanceId;
  readonly text: string;
  readonly proposedScope: HumanDirectionScope;
  readonly confidence: "high" | "medium" | "low";
  readonly unresolved: ReadonlyArray<string>;
  readonly createdAt: string;
}
export async function createHumanDirection(bookDir: string, draft: { text: string; scope: HumanDirectionScope }): Promise<HumanDirectionRecord & { lifecycle: "pending" }>;
export async function confirmHumanDirection(bookDir: string, directionId: string, humanActor: string): Promise<HumanDirectionRecord & { lifecycle: "active" }>;
export async function resolveDirectionConflict(bookDir: string, ids: ReadonlyArray<string>, choice: "override" | "replace" | "keep" | "edit", humanActor: string): Promise<void>;
// Core-owned NL parsing — Studio NEVER parses authority semantics. PERSISTS a pending
// proposal (no authority); confirmHumanDirection later loads that exact proposal.
export async function parseHumanDirectionDraft(bookDir: string, text: string, currentContext: { canonRevision: number; arcPlanVersion: number | null }): Promise<PendingHumanDirectionProposal>;
```

Tests: pending Authorization/Direction can never be resolved as executable authority
(`authorizationApplies` accepts only active; runtime guard rejects pending);
confirmation is the only transition to active (with `confirmedBy` from the explicit
`humanActor`); every lifecycle transition increments `lifecycleRevision`; **terminal
records retain decisionKind/scope/consumption and their provenance fields**
(consumedAt/consumedCanonRevision for consumed; expiredAt; cancelledAt); **scope
evaluation covers EVERY scope kind and EVERY condition kind via
`AuthorizationEvaluationContext`** (exact_chapter, chapter_window, arc, all 7
conditions, from_arc; `directionApplies` covers all 4 Human Direction scopes) and is
shared by the Planning Gate and settlement; direction conflicts explicit — no
latest-wins, each choice exercised; the pure helpers
(`evaluateAuthorizationAgainstEvidence`, `deriveEligibleAuthorizationConsumption`)
NEVER persist `lifecycle: "consumed"` — **the ONLY ACTIVE → CONSUMED transition is the
Phase 4 Final Confirm / Canon settlement transaction owned by Task 20** (direct
non-settlement callers cannot consume; plan/draft/failure never consume);
`parseHumanDirectionDraft` PERSISTS a pending structured proposal (`PendingHumanDirectionProposal`,
no authority) that `confirmHumanDirection(directionId, humanActor)` loads and revalidates
before activating; typed scope instances resolve for all scope/condition kinds.

**Steps**

- [ ] Write failing tests (incl. "planning intent never consumes", "confirmation-gated
      authority", "pending cannot resolve as authority", scope-instance evaluation for
      every typed scope/condition kind, NL parser outputs a pending proposal with no
      authority); targeted → fail.
- [ ] Implement; targeted → PASS; typecheck.
- [ ] Run the Task Completion Gate using commit message
      `feat(core): durable human direction and scoped authorization governance`.

## Task 12 — Arc Plan storage + Major Beat model (persistence/domain ONLY — no publish)

**Files**
- Create `packages/core/src/planning/arc-plan.ts`
- Create `packages/core/src/planning/beats.ts`
- Create `packages/core/src/planning/invalidation-registry.ts`   (generic future-planning artifact registry — introduced HERE so T13 can invalidate without T14/T15 types)
- Create `packages/core/src/__tests__/planning-arc-plan.test.ts`
- Create `packages/core/src/__tests__/planning-beats.test.ts`
- Create `packages/core/src/__tests__/planning-invalidation-registry.test.ts`

**Interfaces** (consumes the exact generic `VersionEnvelope` from Task 5 — no parallel
implementation; `ArcPlanVersion` is defined HERE, after `ArcPlanSnapshot` exists)

```ts
// Generic registry of future-planning artifacts and their DECLARED dependency refs.
// Lookahead (T14) and Detailed Plan (T15) stores register through it; Arc Publish (T13)
// invalidates direct dependents GENERICALLY (PlanningArtifactKind only) — no T14/T15
// imports, no duplicate invalidation subsystem, per-Task typecheck preserved.
export interface RegisteredPlanningArtifact {
  readonly artifactKind: PlanningArtifactKind;   // "lookahead" | "detailed_plan" (T1 vocab)
  readonly artifactId: SafeGovernanceId;
  readonly dependencyRefs: ReadonlyArray<PlanningDependencyRef>;
  readonly registeredAt: string;
}
export async function registerPlanningArtifact(bookDir: string, entry: RegisteredPlanningArtifact): Promise<void>;
export async function unregisterPlanningArtifact(bookDir: string, artifactKind: PlanningArtifactKind, artifactId: string): Promise<void>;
export async function listPlanningArtifactsDirectlyDependingOn(bookDir: string, dependencyKey: string): Promise<ReadonlyArray<{ artifactKind: PlanningArtifactKind; artifactId: string }>>;
export async function invalidateDirectPlanningDependents(bookDir: string, dependencyKey: string): Promise<ReadonlyArray<{ artifactKind: PlanningArtifactKind; artifactId: string }>>;
// DIRECT-only: only artifacts whose declared refs point at the changed key become stale;
// transitive invalidation follows only when the intermediate artifact's own authoritative
// content actually changes (same rule as Foundation dependencies).
```
export interface ArcPlanSnapshot {
  readonly arcId: string;
  readonly goal: string;
  readonly requiredBeats: ReadonlyArray<BeatRef>;
  readonly optionalBeats: ReadonlyArray<BeatRef>;
  readonly relationshipMovements: ReadonlyArray<string>;
  readonly hookMovements: ReadonlyArray<string>;
  readonly timing: Record<string, unknown>;
  readonly authorizations: ReadonlyArray<string>;
  readonly dependencies: ReadonlyArray<PlanningDependencyRef>;
  readonly changedBeats: ReadonlyArray<string>;
  readonly changedAuthorizations: ReadonlyArray<string>;
}
export type ArcPlanVersion = VersionEnvelope<ArcPlanSnapshot>;
export interface BeatRef {
  readonly beatId: string;
  readonly category: BeatCategory;
  readonly importance: Importance;
  readonly description: string;
}
export interface ArcPlanDraftRecord {
  readonly draftId: string;
  readonly arcId: string;
  readonly snapshot: ArcPlanSnapshot;
  readonly draftHash: string;
  readonly foundationVersion: number;
  readonly baseCanonRevision: number;
  readonly status: "draft" | "needs_review";
  readonly createdAt: string;
  readonly updatedAt: string;
}
// NOTE: ArcPreflightRecord is owned by Task 13 (it references ArcFinding, introduced
// there) — Task 12 must typecheck immediately after its own commit with zero forward
// references.
export async function saveArcPlanDraft(bookDir: string, record: ArcPlanDraftRecord): Promise<{ draftId: string }>;
export async function loadArcPlanDraft(bookDir: string, draftId: string): Promise<ArcPlanDraftRecord | null>;
export async function loadPublishedArcPlan(bookDir: string, arcId: string): Promise<ArcPlanVersion | null>;   // read-only history access
export async function restoreArcPlanAsRevisionDraft(bookDir: string, arcId: string, fromVersion: number): Promise<{ draftId: string }>; // persists Draft C into the SAME draft store; NEVER publishes
export async function evaluateBeatFromCanon(bookDir: string, beatId: string): Promise<BeatEvidenceResult>;
```

**Scope discipline: Task 12 is persistence/domain ONLY. There is NO authoritative
`publishArcPlan` here** — after T12's commit there is no Core path capable of creating
Arc authority. There is ONE Arc draft persistence path: `saveArcPlanDraft` is the single
store; the AI pipeline (Task 13) AND restore (`restoreArcPlanAsRevisionDraft`) both
persist through it — restore produces a durable Draft C with its own `draftId`, which
then flows through the NORMAL preflight→publish workflow (Published v7 → Draft C →
fresh preflight → Human Publish → v8). No orphan generic `RevisionCandidate` exists
outside the draft store. Beat state comes from Canon evidence, never planning
prediction; semantic uncertainty mid-Arc stays `in_progress` unless required for an
authority decision; REQUIRED Beats cannot be silently superseded.

**Steps**

- [ ] Write failing tests: save/load draft round-trip KEYED BY `draftId` (generated
      Draft A vs regenerated Draft B vs restore-based Draft C are distinct records);
      load Published Arc history (read-only); **restore alone leaves the current
      published Arc authority unchanged** and yields a persisted Draft C that loads via
      `loadArcPlanDraft(draftId)`; beat evidence derives from Canon; semantic
      uncertainty stays in_progress; required-beat supersede refused; **no publish
      operation exists in this module (compile-time assertion / absent API)**;
      **registry tests**: register/unregister; `invalidateDirectPlanningDependents`
      stales ONLY direct dependents (transitive follows only when the intermediate
      artifact's content changes); generic kinds need no T14/T15 types.
- [ ] Implement; targeted → PASS; typecheck.
- [ ] Run the Task Completion Gate using commit message
      `feat(core): arc plan storage and canon-evidence major beats`.

## Task 13 — Arc Planner + Arc preflight + Human Publish boundary

**Files**
- Create `packages/core/src/planning/arc-pipeline.ts`
- Create `packages/core/src/__tests__/planning-arc-pipeline.test.ts`

**Interfaces** (reuses shared finding severity/repairScope vocabulary; NOT the Detailed
Chapter Planning Gate)

```ts
export interface ArcFinding {
  readonly findingId: string;
  readonly source: "deterministic" | "semantic";
  readonly kind: "local_issue" | "uncertain" | "author_decision" | "conflict";
  readonly severity: FindingSeverity;
  readonly repairScope: RepairScope;
  readonly evidence: string;
  readonly suggestedAction: string;
  readonly involvesDecisionKind?: AuthorDecisionKind;
}
// Persisted preflight record — bound to the EXACT draft hash + bases; publish relies
// on typed states, never string matching.
export interface ArcPreflightRecord {
  readonly draftId: SafeGovernanceId;
  readonly draftHash: string;
  readonly foundationVersion: number;
  readonly baseCanonRevision: number;
  readonly deterministicResult: "pass" | "fail";
  readonly semanticFindings: ReadonlyArray<ArcFinding>;
  readonly repairRound: number;
  readonly unresolvedAuthorDecisions: ReadonlyArray<AuthorDecisionKind>;
  readonly verifiedAt: string;
  readonly status: "current" | "stale";
}
export async function saveArcPreflightRecord(bookDir: string, record: ArcPreflightRecord): Promise<void>;
export async function loadArcPreflightRecord(bookDir: string, draftId: string): Promise<ArcPreflightRecord | null>;
export type ArcPreflightResult =
  | { outcome: "preflight_pass"; foundationVersion: number; baseCanonRevision: number; draftHash: string }
  | { outcome: "preflight_fail"; findings: ReadonlyArray<ArcFinding> };
export async function generateArcPlanDraft(bookDir: string, arcId: string, foundationVersion: number, brief: string): Promise<{ draftId: string }>;  // Arc Planner; persists via Task 12 saveArcPlanDraft
export async function runArcPreflight(bookDir: string, draftId: string): Promise<ArcPreflightResult>;   // deterministic checks over the PERSISTED draft
export async function reviewArcPlanDraft(bookDir: string, draftId: string): Promise<ReadonlyArray<ArcFinding>>;  // semantic review
export type ArcRepairOutcome =
  | { status: "repaired"; round: number; draftId: string }
  | { status: "needs_human_direction"; round: number; findings: ReadonlyArray<ArcFinding> }
  | { status: "clean"; draftId: string };
export async function repairArcPlanLocal(bookDir: string, draftId: string, findings: ReadonlyArray<ArcFinding>, round: number): Promise<ArcRepairOutcome>;
export async function verifyArcPlanRepair(bookDir: string, draftId: string, findings: ReadonlyArray<ArcFinding>, round: number): Promise<ReadonlyArray<ArcFinding>>;
export async function publishArcPlan(input: {
  bookDir: string;
  draftId: string;                 // EXACT draft the Human reviewed
  humanActor: string;
  expectedFoundationVersion: number;
  expectedCanonRevision: number;
}): Promise<ArcPlanVersion>;       // explicit Human Publish
```

Rules: pipeline = Published Foundation → Arc Planner → Arc Plan Draft (persisted via T12)
→ deterministic preflight → semantic reviewer → bounded local repair → **Human Publish
(`publishArcPlan`, defined HERE)**. Preflight state is **persisted and bound to the
exact draft hash + Foundation/Canon bases** (`ArcPreflightRecord`, defined HERE in T13).
`publishArcPlan`
loads the SAME persisted draft and SAME persisted preflight, and REJECTS if: draft hash
changed after preflight; Foundation version changed; Canon revision changed; a declared
dependency's observed state changed; preflight missing/stale; unresolved BLOCKING
exists; unresolved AUTHOR_DECISION exists; a required authorization is unavailable —
then the shared TransactionCoordinator (Task 9) creates Arc authority. `preflight_pass`
remains Draft until the explicit Human call. Restore flow: Published Arc v7 → Draft C
(T12, own draftId) → current preflight again → Human Publish → v8; never
restore→publish directly. Max 2 semantic repair rounds then Human; LOCAL-only
auto-repair; IMPORTANT+LOCAL requires separate targeted re-review; repair cannot broaden
authority; MULTI_UNIT/AUTHOR_DECISION/CONFLICT never silently repaired;
`verifyArcPlanRepair` is a separate invocation (no self-certification).

**Typed finding invariant:** ONLY deterministic checks may create `kind: "conflict"`;
semantic review may create `local_issue | uncertain | author_decision` but NEVER hard
conflict. `publishArcPlan` relies on these typed states, not on string matching in
evidence/suggestedAction.

**Atomic governance-mode activation + direct planning invalidation:** the FIRST valid
Arc Plan Publish under V2 Foundation atomically flips `governance.planning = "v2"` in
the same publish transaction; no competing legacy/V2 planning authority exists. When an
existing Published Arc Plan is revised, the publication transaction includes, as ONE
logical change: the new Arc Plan version + current Arc authority pointer/materialization
+ planning-v2 marker on first activation (if applicable) + **direct dependency
invalidation through the Task 12 `PlanningInvalidationRegistry`**
(`invalidateDirectPlanningDependents` over the changed Arc dependency key) — the
registry is GENERIC (`PlanningArtifactKind` only), so T13 implements and tests atomic
future-planning invalidation WITHOUT importing T14/T15 types; Lookahead (T14) and
Detailed Plan (T15) stores register their artifacts through that same registry — one
invalidation mechanism, no duplicates**. Historical chapters/Canon remain untouched.
Fault tests: Arc v2 replaces v1; a directly dependent Lookahead becomes STALE atomically;
an unrelated artifact stays CURRENT; crash before COMMIT = old Arc + old validity; crash
after COMMIT = new Arc + affected planning cannot be treated valid.

**Steps**

- [ ] Write failing tests (mocked agents): stale Foundation dependency → preflight
      fail; stale Canon base → fail; hard Book Rule/timeline conflict → fail with
      `kind: "conflict"` from a DETERMINISTIC source; relationship/reveal pacing
      semantic concern → `kind: "uncertain"` (semantic review NEVER produces hard
      conflict — typed-state invariant); unauthorized major Author Decision →
      `kind: "author_decision"`; LOCAL repair + independent re-review; repair cannot
      broaden authority (attempted unauthorized decision rejected); exhausted 2 rounds
      → Human; `preflight_pass` still not Published; **publish by draftId revalidates
      draft hash/base versions/preflight status and refuses on stale preflight,
      dependency observed-state change, unresolved BLOCKING/AUTHOR_DECISION, or missing
      authorization**; **publish cannot be called before preflight exists (no authority
      path in T12)**; restore→preflight→publish produces a new version and never
      restore→publish directly; **atomic planning marker activation AND direct future
      planning invalidation** (Arc v2 replaces v1; a directly dependent Lookahead
      becomes STALE atomically; an unrelated artifact stays CURRENT; crash before
      COMMIT = old Arc + old validity; crash after COMMIT = new Arc + affected planning
      cannot be treated valid).
- [ ] Implement `arc-pipeline.ts`; targeted → PASS; typecheck.
- [ ] Run the Task Completion Gate using commit message
      `feat(core): arc planner, preflight and human publish boundary`.

## Task 14 — Rolling Lookahead lifecycle + typed selective invalidation

**Files**
- Create `packages/core/src/planning/lookahead.ts`
- Create `packages/core/src/__tests__/planning-lookahead.test.ts`

**Interfaces**

```ts
export interface RollingLookahead {
  readonly lookaheadId: string;
  readonly status: LookaheadStatus;
  readonly horizon: ReadonlyArray<{ chapterNumber: number; intention: string }>;
  readonly provenance: {
    readonly foundationVersion: number;
    readonly arcPlanVersion: number;
    readonly basedOnCanonRevision: number;
    readonly dependencyRefs: ReadonlyArray<PlanningDependencyRef>;   // typed, spans all domains
  };
  readonly createdAt: string;
}
export async function generateLookahead(bookDir: string, horizonChapters: number): Promise<RollingLookahead>;
export async function revalidateLookahead(bookDir: string, lookaheadId: string): Promise<LookaheadStatus>;
```

Rules: advisory only — no `approved` state; default horizon 2–3 lightweight intentions;
only the next chapter gets a Detailed Plan; selective invalidation is typed: an
UNRELATED Canon/Foundation change must NOT stale the Lookahead, while a DIRECTLY
REFERENCED Canon dependency (e.g. a `canon_fact` or `hook` ref) must. **Each generated
Lookahead registers itself through the Task 12 `PlanningInvalidationRegistry`
(`registerPlanningArtifact`, artifactKind `lookahead`) so Arc Publish (T13) can
invalidate it directly through the SAME mechanism.** Tests:
horizon outside 2–3 rejected; unrelated vs direct-dep change; replacement →
`SUPERSEDED`; consumption → `CONSUMED`; Lookahead never grants authorization.

**Steps**

- [ ] Write failing tests: horizon bounds; typed selective invalidation (unrelated
      Canon delta no-stale vs directly referenced Canon dependency stale);
      supersede/consume transitions; lookahead never satisfies an authorization or
      gate requirement.
- [ ] Implement; targeted → PASS; typecheck.
- [ ] Run the Task Completion Gate using commit message
      `feat(core): advisory rolling lookahead with typed selective invalidation`.

## Task 15 — Detailed Chapter Plan V2

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
  readonly dependencyRefs: ReadonlyArray<PlanningDependencyRef>;   // shared typed vocabulary
  readonly ruleIds: ReadonlyArray<string>;
}
// Durable plan record — EVOLVES the existing persisted-governed-plan.ts infrastructure
// (savePersistedPlan/loadPersistedPlan) rather than running it only as a regression.
export interface DetailedChapterPlanRecord {
  readonly planId: string;
  readonly chapterNumber: number;
  readonly intent: ChapterIntent;
  readonly memo: ChapterMemo;
  readonly bindings: DetailedPlanBindings;
  readonly planHash: string;                 // computeProseRevision(serialized plan identity)
  readonly status: "draft" | "gated" | "frozen";
  readonly createdAt: string;
  readonly updatedAt: string;
}
export async function buildDetailedPlan(bookDir: string, chapterNumber: number): Promise<{ planId: string }>;   // persists and returns planId
export function planScopeTooBroad(plan: { intent: ChapterIntent; memo: ChapterMemo }): boolean;
export async function replanChapter(bookDir: string, chapterNumber: number, round: number): Promise<{ planId: string }>;
export async function loadDetailedPlan(bookDir: string, planId: string): Promise<DetailedChapterPlanRecord | null>;
```

Rules: Detailed Plan is a mutable proposal until frozen by the Execution Snapshot;
binds the six authority dimensions; `PLAN_SCOPE_TOO_BROAD` instead of silently dropping
required context; **maximum 2 automatic semantic REPLANS per chapter — the initial plan
is NOT counted among the two replans (Initial Attempt → Replan #1 → Replan #2 → if
still PLAN_DEFECT: Human)**; separate from Phase 6 prose retry; dependency refs reuse
the Task 1 `PlanningDependencyRef` vocabulary.
**The Planning Gate evaluates the persisted plan identity/hash; the Execution Snapshot
freezes the exact `planId` + `planHash` that passed the gate.** A restart between
planning and Write does not require reconstructing an unprovable in-memory plan.
**Each persisted Detailed Plan registers itself through the Task 12
`PlanningInvalidationRegistry` (`registerPlanningArtifact`, artifactKind
`detailed_plan`) — the same mechanism Arc Publish uses.**
Compatibility with existing ChapterIntent/ChapterMemo artifacts is preserved.

**Steps**

- [ ] Write failing tests: bindings contract (all six dimensions, typed dependency
      refs); `buildDetailedPlan`/`replanChapter` persist and return a `planId`
      loadable via `loadDetailedPlan`; scope-too-broad detection; 2-replan cap; plan
      mutability before snapshot and immutability after freeze (T18); plan
      identity/hash survive a simulated restart.
- [ ] Implement (evolving ChapterIntent/ChapterMemo + persisted-governed-plan,
      additive schema change); targeted → PASS.
- [ ] Regressions: planner/persisted-governed-plan tests; typecheck.
- [ ] Run the Task Completion Gate using commit message
      `feat(core): durable detailed chapter plan records and replan boundary`.

## Task 16 — Planning Gate + planning-specific bounded repair

**Files**
- Create `packages/core/src/planning/gate.ts`
- Create `packages/core/src/planning/repair.ts`
- Create `packages/core/src/__tests__/planning-gate.test.ts`
- Create `packages/core/src/__tests__/planning-repair.test.ts`

**Interfaces** (TRUSTED gate: the caller supplies only `bookDir` + `planId`; Core loads
all authority state itself — a forged in-memory plan or a fake authorization array
cannot influence the Gate because no such public input exists)

```ts
export interface PlanningGateInput {
  readonly bookDir: string;
  readonly planId: SafeGovernanceId;         // persisted DetailedChapterPlanRecord (T15)
}
export type PlanningGateResult =
  | { outcome: "safe" }
  | { outcome: "uncertain"; concerns: ReadonlyArray<string> }
  | { outcome: "author_decision"; missing: ReadonlyArray<AuthorDecisionKind> }
  | { outcome: "conflict"; evidence: ReadonlyArray<string> };
export async function evaluatePlanningGate(input: PlanningGateInput): Promise<PlanningGateResult>;
```

Core loads and compares trusted values: the persisted `DetailedChapterPlanRecord`
(planId + planHash + bindings), the current Published Foundation version, the current
Published Arc version, the current Canon revision, ACTIVE Human Directions and ACTIVE
Authorizations from the trusted store, Book Rules, unresolved Phase 4 review state, and
current dependency observed-state — against the plan bindings/hash. A caller cannot
manufacture SAFE by supplying fake versions or fake active authorizations.

// Planning-specific bounded repair — OWN types, never Foundation RepairOutcome;
// PLAN-SCOPED: findings bind planId + planHash; repair loads the exact persisted plan.
export interface PlanningFinding {
  readonly findingId: string;
  readonly planId: SafeGovernanceId;
  readonly planHash: string;                 // plan hash the finding was computed against
  readonly chapterNumber: number;
  readonly severity: FindingSeverity;
  readonly repairScope: RepairScope;
  readonly evidence: string;
  readonly suggestedAction: string;
  readonly involvesDecisionKind?: AuthorDecisionKind;
}
export type PlanningRepairOutcome =
  | { status: "repaired"; round: number; planId: SafeGovernanceId; planHash: string }
  | { status: "needs_human_direction"; round: number; findings: ReadonlyArray<PlanningFinding> }
  | { status: "clean"; planId: SafeGovernanceId; planHash: string };
export async function reviewDetailedPlan(bookDir: string, planId: SafeGovernanceId): Promise<ReadonlyArray<PlanningFinding>>;
export async function repairDetailedPlanLocal(bookDir: string, planId: SafeGovernanceId, findingIds: ReadonlyArray<string>, round: number): Promise<PlanningRepairOutcome>;
export async function verifyDetailedPlanRepair(bookDir: string, planId: SafeGovernanceId, findingIds: ReadonlyArray<string>, round: number): Promise<ReadonlyArray<PlanningFinding>>;
```

Truth table (tests cover all 5 rows): deterministic clean + semantic clean + sufficient
authority → SAFE; deterministic clean + semantic uncertain → UNCERTAIN; deterministic
clean + new major decision + missing authority → AUTHOR_DECISION; hard deterministic
violation → CONFLICT; major decision already authorized in correct scope → SAFE (no
re-ask). L1 checks include stale deps, required units, hard Canon contradictions, Book
Rules, hard Timeline constraints, direction conflicts, authorization validity/
consumption, chapter sequence, unresolved state review. L2 checks cannot create hard
CONFLICT. SAFE never auto-runs Writer.

Planning repair rules: LOCAL-only auto-repair; IMPORTANT+LOCAL requires separate
targeted re-review; repair cannot broaden authority; MULTI_UNIT/AUTHOR_DECISION/CONFLICT
never silently repaired; max 2 semantic rounds; `verifyDetailedPlanRepair` is a separate
invocation (no self-certification); **repair loads the EXACT persisted plan by planId —
if `planHash` changed after finding creation, stale findings are rejected**; a
successful repair persists an updated/new `DetailedChapterPlanRecord` and returns its
exact plan identity; a different chapter/plan target is a no-op or error.

**Steps**

- [ ] Write failing tests: the 5-row truth table (evaluated over Core-loaded state —
      **a forged in-memory plan or fake authorization array cannot influence the Gate
      because no such public input exists**); "semantic cannot create hard conflict";
      "authorized-at-scope does not re-ask"; LOCAL-only auto-repair; **negative test: a
      local planning repair attempting to introduce an unauthorized major decision is
      rejected → AUTHOR_DECISION, never repaired into SAFE**; 2-round cap;
      self-certification refusal; stale-finding rejection after planHash change;
      wrong-plan-target no-op.
- [ ] Implement `gate.ts` + `repair.ts`; targeted → PASS; typecheck.
- [ ] Run the Task Completion Gate using commit message
      `feat(core): planning risk gate and planning-specific bounded repair`.

## Task 17 — Context Composer: authority spine, profiles, budget, structured provenance

**Files**
- Create `packages/core/src/context/composer.ts`
- Create `packages/core/src/context/bundle.ts`
- Create `packages/core/src/context/budget.ts`
- Create `packages/core/src/__tests__/context-composer.test.ts`
- Create `packages/core/src/__tests__/context-budget.test.ts`

**Interfaces** (structured provenance replaces weak strings)

```ts
export type ContextProfile = "planner_context" | "writer_context" | "reviewer_context";
export type ContextPriority = 0 | 1 | 2 | 3 | 4;
export type ContextRepresentation = "full" | "projected" | "summary" | "excerpt";
export interface ContextSourceProvenance {
  readonly sourceType: "foundation_unit" | "arc_plan" | "canon" | "human_direction" | "authorization" | "book_rule" | "hook" | "relationship" | "timeline" | "character_state" | "chapter_summary" | "style_example" | "semantic_memory";
  readonly sourceId: string;
  readonly sourceRevision?: number | string;   // typed revision token — stable hash or lifecycle revision allowed
  readonly priority: ContextPriority;
  readonly selectionReason: string;
  readonly representation: ContextRepresentation;
  readonly authoritative: boolean;
}
export interface BudgetOmission {
  readonly sourceId: string;
  readonly priority: ContextPriority;
  readonly reason: string;              // e.g. "soft_trim" | "semantic_compression_unavailable" | "mandatory_fit_failure"
}
export type ContextSubject =
  | { kind: "detailed_plan"; planId: SafeGovernanceId; planHash: string }
  | { kind: "arc_draft"; draftId: SafeGovernanceId; draftHash: string }
  | { kind: "review"; chapterNumber: number };
export interface ContextBundle {
  readonly bundleId: string;
  readonly profile: ContextProfile;
  readonly task: string;
  readonly subject: ContextSubject;        // proves WHICH persisted artifact this bundle was composed for
  readonly foundationVersion: number;
  readonly arcPlanVersion: number;
  readonly canonRevision: number;
  readonly dependencyRefs: ReadonlyArray<PlanningDependencyRef>;   // shared typed vocabulary — isBundleStale compares observed state
  readonly sections: ReadonlyArray<ContextSourceProvenance & { content: string }>;
  readonly budget: { readonly contextLimit: number; readonly reservedOutput: number; readonly estimatedInput: number };
  readonly tokenEstimates: Record<string, number>;
  readonly compactions: ReadonlyArray<string>;
  readonly omittedDueToBudget: ReadonlyArray<BudgetOmission>;
}
export interface ComposeContextRequest {
  readonly bookDir: string;
  readonly profile: ContextProfile;
  readonly subject: ContextSubject;        // typed request — not (bookDir, profile, task) strings
}
export async function composeContext(request: ComposeContextRequest): Promise<ContextBundle>;
export async function isBundleStale(bookDir: string, bundle: ContextBundle): Promise<boolean>;
export type BudgetResult = { status: "ok"; bundle: ContextBundle } | { status: "context_budget_exceeded" };
export async function applyBudgetPolicy(bundle: ContextBundle): Promise<BudgetResult>;
```

Writer context loads dependency refs from the exact persisted Detailed Plan (subject
identity); `isBundleStale` validates BOTH authority dependencies AND subject identity;
`freezeExecutionSnapshot` refuses a ContextBundle composed for another plan.

Rules: authority before relevance; P0 never silently dropped or semantically summarized;
budget policy order (deterministic projection → trim soft → semantic compression only
for the allowed set → narrow/replan → CONTEXT_BUDGET_EXCEEDED); reserve output before
input; no automatic model switch to escape budget; forbidden to semantically compress
hard Canon facts / Book Rules / Human Directions / authorization scopes / Foundation
invariants / Execution Snapshot contract; retrieval excludes rejected/non-canonical
Writer attempts; derived indexes are rebuildable, never authority; draft Foundation/Arc
revisions never leak into production retrieval; per-call observability metadata
(task/profile/bundleId/model/provider/estimated/actual input/output) retained as
instrumentation only. This is NOT a Phase 7 feature — provenance exists only for
staleness/debugging.

**Steps**

- [ ] Write failing tests incl.: P0 preservation under pressure; budget-exceeded →
      zero LLM calls (spy on the provider client); no model-switch path; stale bundle
      detection via structured provenance (revision/source change) AND subject
      identity (bundle composed for plan A refused for plan B); false-memory
      exclusion (rejected attempt content never appears); compaction allowlist (hard
      Canon facts never semantically compressed); omission records carry
      source+priority+reason.
- [ ] Implement `budget.ts` → `bundle.ts` → `composer.ts`; targeted → PASS.
- [ ] Regressions: `context-filter`/`governed-context` tests; typecheck.
- [ ] Run the Task Completion Gate using commit message
      `feat(core): context composer authority spine and token governance`.

## Task 18 — Execution Snapshot + durable Execution Attempts

**Files**
- Create `packages/core/src/execution/snapshot.ts`
- Create `packages/core/src/execution/attempt-store.ts`
- Create `packages/core/src/execution/attempt.ts`
- Create `packages/core/src/__tests__/execution-snapshot.test.ts`
- Create `packages/core/src/__tests__/execution-attempt.test.ts`

**Interfaces**

```ts
// Freezes the EXACT persisted plan that was gated — no caller-supplied plan object is
// trusted. Core loads the plan by planId and validates: plan exists; planHash matches
// the gated plan; the Gate result corresponds to that plan hash; the ContextBundle was
// composed for that same plan; Foundation/Arc/Canon bindings remain current;
// dependency refs remain current.
export interface ExecutionSnapshot {
  readonly snapshotId: string;
  readonly chapterNumber: number;
  readonly planId: SafeGovernanceId;
  readonly planHash: string;
  readonly bindings: DetailedPlanBindings;
  readonly contextBundleId: string;
  readonly frozenAt: string;
}
export type FreezeResult = { status: "frozen"; snapshot: ExecutionSnapshot } | { status: "execution_prepare_failed"; reason: string };
export async function freezeExecutionSnapshot(bookDir: string, planId: SafeGovernanceId, contextBundle: ContextBundle): Promise<FreezeResult>;

export type ExecutionAttemptStatus =
  | "created" | "running" | "drafted" | "failed" | "aborted_for_plan_defect" | "accepted" | "rejected";
export interface ExecutionAttempt {
  readonly attemptId: string;
  readonly chapterNumber: number;
  readonly snapshotId: string;                 // immutable linkage
  readonly status: ExecutionAttemptStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly providerFailure?: { provider: string; model: string; message: string; at: string };
  readonly draftArtifactRefs?: ReadonlyArray<string>;
  readonly defect?: AttemptDefect;
  readonly replanNumber: number;               // 0 = INITIAL attempt; 1 = Replan #1; 2 = Replan #2 (max); 3+ forbidden → Human
}
export async function createExecutionAttempt(bookDir: string, snapshotId: string, chapterNumber: number, replanNumber: number): Promise<ExecutionAttempt>;
export async function loadExecutionAttempt(bookDir: string, attemptId: string): Promise<ExecutionAttempt | null>;
export async function recordAttemptRunning(bookDir: string, attemptId: string): Promise<void>;
export async function recordAttemptDrafted(bookDir: string, attemptId: string, artifactRefs: ReadonlyArray<string>): Promise<void>;
export async function recordAttemptFailure(bookDir: string, attemptId: string, failure: ExecutionAttempt["providerFailure"]): Promise<void>;
export async function abortAttemptForPlanDefect(bookDir: string, attemptId: string): Promise<void>;
export async function acceptAttempt(bookDir: string, attemptId: string): Promise<void>;
export type AttemptOutcome =
  | { status: "prose_defect"; next: "revise_same_snapshot" }
  | { status: "plan_defect"; next: "fresh_plan_and_snapshot" }
  | { status: "authority_defect"; next: "authority_resolver" }
  | { status: "canon_conflict"; next: "hard_stop" };
export function classifyAttemptDefect(attempt: unknown): AttemptOutcome;
```

Rules: freeze revalidates authority/Canon/context atomically (via Task 9
`runTransaction`); `EXECUTION_PREPARE_FAILED` when anything changed during freeze
(prepare-race test); Writer never starts without a snapshot; the plan used by an attempt
is immutable after freeze; attempts are durable and snapshot-linked; defect routing per
table; max 2 replans (each replan is a NEW attempt under a fresh snapshot); provider
failures preserve failure records and consume no authorizations;
**rejected/aborted-attempt prose is NON_CANON execution history and must never enter
production memory** (asserted via retrieval exclusion, reinforced in T20).

**Steps**

- [ ] Write failing tests: freeze rejects stale bundle; prepare-race →
      `execution_prepare_failed`; attempt immutability of snapshot linkage; full
      attempt-status persistence round-trips; defect routing; provider failure consumes
      nothing and records metadata; rejected-attempt prose excluded from memory.
- [ ] Implement; targeted → PASS; typecheck.
- [ ] Run the Task Completion Gate using commit message
      `feat(core): immutable execution snapshots and durable execution attempts`.

## Task 19 — Core Writer execution gate (runner.ts)

**Files**
- Modify `packages/core/src/pipeline/runner.ts` (inside the existing
  `writeNextChapter` orchestration)
- Modify `packages/core/src/pipeline/chapter-review-cycle.ts` (PLAN_DEFECT
  orchestration owner — see below)
- Create `packages/core/src/__tests__/core-writer-gate.test.ts`

**Rules:** the CORE production write entry enforces the full chain; **no Writer
invocation may occur without a valid durable Execution Attempt**; CLI (`castor write
next`) and Studio call this SAME Core operation — CLI/Studio are never the security
boundary. `CONFLICT`, `AUTHOR_DECISION`, `UNCERTAIN`-requiring-Human, stale
ContextBundle, and missing-snapshot all result in zero Writer calls. SAFE + valid
snapshot → exactly one chapter attempt. The Writer spy call count is the assertion
vehicle.

**V2 write chain (durable attempt integration — the Attempt is created BEFORE Writer):**

```
fresh Detailed Plan (T15 planId)
→ Planning Gate SAFE
→ Context Composer / budget check
→ freeze immutable Execution Snapshot
→ createExecutionAttempt(snapshotId, chapterNumber, replanNumber=0)
→ recordAttemptRunning
→ invoke Writer exactly once
→ recordAttemptDrafted on output
  OR recordAttemptFailure with provider/system failure
```

No Writer invocation exists outside a durable Attempt. Provider failure leaves:
Snapshot immutable, Attempt FAILED, no Canon change, no Authorization consumption.

**PLAN_DEFECT orchestration (owner: `chapter-review-cycle.ts`, called from the write
chain):** Initial Attempt (replanNumber 0) → Audit classifies `PLAN_DEFECT` →
`abortAttemptForPlanDefect` (Attempt 1 stays `aborted_for_plan_defect`, Snapshot 1
untouched) → `replanChapter(latest Canon, same authority)` → Planning Gate again → new
ContextBundle → new Execution Snapshot → createExecutionAttempt(..., replanNumber=1) →
Attempt 2 (Replan #1) → if still PLAN_DEFECT → Replan #2 (replanNumber 2, Attempt 3) →
if still PLAN_DEFECT → STOP to Human. **Two automatic replans means TWO replans AFTER
the initial attempt (replanNumber 0..2; a third PLAN_DEFECT stops to Human); the
initial plan is never counted as a replan.** never mutate Attempt 1 or Snapshot 1. This
is implemented HERE (T19), so T26 Scenario E is covered by a real earlier Task, not only
by the final acceptance test.

**Governance-mode write matrix (explicit, tested in THIS Task — legacy compatibility is
intentional, not accidental):**

| foundation | planning | write behavior |
|---|---|---|
| `legacy` | `legacy` | existing legacy write workflow remains available (unchanged path) |
| `v2` | `legacy` | **TRANSITION STATE** — do NOT silently fall back to the old Planner/Writer path; require preparation + Human Publish of the appropriate V2 Arc Plan before V2 writing can continue (block with actionable readiness) |
| `v2` | `v2` | full Phase 5 Planning Gate + Context + Snapshot + Attempt + Writer path |
| `legacy` | `v2` | **invalid/unsupported governance state** — fail closed / recovery required |

**Steps**

- [ ] Write failing tests that call the Core write entry directly (not via CLI):
      missing snapshot/attempt → Writer spy call count 0; CONFLICT → 0;
      AUTHOR_DECISION → 0; UNCERTAIN requiring Human → 0; stale ContextBundle → 0;
      SAFE + valid snapshot → exactly one chapter attempt with a durable Attempt
      created BEFORE the Writer call (Attempt RUNNING→DRAFTED); provider failure →
      Attempt FAILED, Snapshot immutable, no Canon change, no consumption;
      **PLAN_DEFECT orchestration**: Attempt 1 (initial) aborted, Replan #1 (Attempt 2)
      and Replan #2 (Attempt 3) each get fresh replan/gate/context/snapshot, a third
      PLAN_DEFECT stops to Human, Attempt 1 + Snapshot 1 unmutated; one
      deliberate Write produces at most one chapter; **mode matrix**: untouched
      legacy/legacy book still writes exactly through the existing path; v2/v2 uses the
      gate; v2/legacy cannot bypass Planning V2 by invoking the legacy Writer path;
      legacy/v2 fails closed.
- [ ] Implement the gate + mode dispatch + attempt wiring + PLAN_DEFECT loop inside
      `runner.ts`/`chapter-review-cycle.ts`; targeted → PASS.
- [ ] Regressions: `pipeline-runner.gated.test.ts`, `pipeline-runner.test.ts`,
      `state-review-confirm` suite, full Phase 4 suites; typecheck.
- [ ] Run the Task Completion Gate using commit message
      `feat(core): enforce planning gate, execution snapshot and write mode matrix`.

## Task 20 — Phase 4 Canon settlement integration (evidence-derived consumption)

**Files**
- Create `packages/core/src/state/settlement-integration.ts`
- Create `packages/core/src/__tests__/settlement-integration.test.ts`
- Modify `packages/core/src/state/state-review-finalize.ts` — validated consumption
  writes are added to the SAME prepared atomic set as the Canon writes (NO post-commit
  hook for atomic effects)

**Interfaces**

```ts
// Core DERIVES consumption ONLY from TRUSTED ACTIVE Authorization records loaded from
// the Core store — a raw caller ID list or an ID merely mentioned in State Review is
// never authority.
export async function deriveConsumedAuthorizations(
  bookDir: string,                            // Core loads trusted records itself
  finalizedReview: ActiveStateReviewArtifact, // post-decision artifact being settled
  canonEvidence: CanonSettlementEvidence,     // subject/scope/event facts in the settled delta
): Promise<ReadonlyArray<{ authorizationId: string; decisionKind: AuthorDecisionKind; canonRevision: number }>>;
export interface AtomicSettlementInput {
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly canonRevision: number;
  readonly derivedConsumptions: ReadonlyArray<{ authorizationId: string; decisionKind: AuthorDecisionKind }>;
}
export function buildSettlementWrites(input: AtomicSettlementInput): ReadonlyArray<AtomicFileWrite>;
export interface LaggableEffects {
  readonly beatEvidence: ReadonlyArray<{ beatId: string; state: "satisfied" | "not_satisfied" | "uncertain" }>;
  readonly lookaheadStatus: LookaheadStatus;
  readonly arcReadiness: ArcCompletionOutcome | "not_applicable";
  readonly nextPlanningReady: boolean;
}
export async function applyLaggableSettlementEffects(bookDir: string, chapterNumber: number, canonRevision: number): Promise<LaggableEffects>;
```

**Atomicity contract:** the settlement transaction performs: load trusted ACTIVE
Authorization records → validate decision kind → validate scope → validate condition →
validate the finalized Review event → validate resulting Canon evidence → prepare
lifecycle-transition writes (`lifecycle: "consumed"`, `consumedAt`,
`consumedCanonRevision`, incremented `lifecycleRevision`) → commit those writes in the
SAME `commitAtomicFileSet` as Canon. Canon committed state + validated one-time
Authorization consumption succeed/fail as ONE logical transaction. A crash/failure must
NEVER expose "Canon event committed + Authorization still AVAILABLE". Fault-injection
tests prove BOTH sides of the commit boundary. No second Canon transaction system is
created — the existing Phase 4 atomic primitive is evolved in place. **This is the ONLY
ACTIVE → CONSUMED transition in the system:** Task 11's
`evaluateAuthorizationAgainstEvidence`/`deriveEligibleAuthorizationConsumption` are pure
helpers and persist nothing; a direct non-settlement caller cannot consume.

**Evidence verification tests:** an active Authorization ID whose confirmed Canon event
does not match → NOT consumed; correct decision subject/scope/event evidence →
consumed; the same one-time authorization already consumed → fail closed / no duplicate;
an unauthorized/raw injected ID cannot be consumed **even when the finalized review text
mentions it** (only trusted ACTIVE records loaded by Core are eligible).

Post-commit MAY contain only laggable, reconstructable effects: semantic Beat
evaluation, advisory Lookahead refresh, rebuildable derived projections. Canon
correctness never depends on them. Tests prove Draft/Audit never consume, State Review
proposals never consume, and Final Confirm settlement consumes exactly the confirmed
event's validated one-time authorizations. Existing Phase 4 tests remain green
unchanged.

**Steps**

- [ ] Write failing tests: non-consumption paths (Draft/Audit/Plan); **direct
      non-settlement callers cannot consume**; evidence-derived consumption (all
      four evidence cases); fault injection on both sides of the commit boundary
      (before COMMIT → Canon unchanged + Authorization ACTIVE; after durable COMMIT →
      Canon changed + CONSUMED); replay/double-consume fails closed; laggable effects
      never affect Canon correctness; full Phase 4 suites green.
- [ ] Implement `settlement-integration.ts` + the finalize atomic-set extension;
      targeted → PASS.
- [ ] Regressions: `state-review-confirm`/`state-review-finalize` suites; typecheck.
- [ ] Run the Task Completion Gate using commit message
      `feat(core): evidence-derived atomic settlement integration`.

## Task 21 — Arc completion / transition (never auto-Publish)

**Files**
- Create `packages/core/src/planning/transition.ts`
- Create `packages/core/src/__tests__/planning-transition.test.ts`

**Interfaces**

```ts
export type ArcTransitionResult =
  | { outcome: "not_ready" }
  | { outcome: "ready_to_close"; nextPublished: boolean; action: "auto_activate" | "prepare_next_before_transition" }
  | { outcome: "arc_completion_uncertain"; reason: string };
export async function evaluateArcCompletion(bookDir: string, arcId: string): Promise<ArcTransitionResult>;
export type ApplyArcTransitionResult =
  | { status: "closed_and_activated"; currentArc: string; nextArc: string }
  | { status: "not_applicable"; reason: string };
export async function applyArcTransition(bookDir: string, currentArcId: string): Promise<ApplyArcTransitionResult>;
```

Rules (explicit wording): `evaluateArcCompletion` reports readiness; `applyArcTransition`
performs the actual state change — and ONLY when: current Arc is `READY_TO_CLOSE`,
required Beat evidence is Canon-confirmed, the next Arc Plan is already Published, and
authority bases (Foundation version / Canon revision) are still current. The
close-current / activate-next state change is consistent and, where multiple
authoritative/materialized records change together, transactional (Task 9 coordinator).
If the next Arc is missing: automatically PREPARE the next Arc Draft if desired, then
**STOP for Human Publish** — do NOT call `applyArcTransition`; the current Arc remains
`READY_TO_CLOSE` until that Publish. **Never auto-Publish an Arc Plan.** Tests verify the
actual persisted current-Arc state, not only the evaluation return value.

**Steps**

- [ ] Write failing tests: not-ready with pending required beats; ready + published
      next → `applyArcTransition` closes current and activates next (assert persisted
      current-Arc records); ready + missing next → prepare-before-transition, no apply,
      no auto-Publish (no published version created), current Arc stays
      READY_TO_CLOSE; stale authority bases → apply refused; completion-uncertain
      requires human.
- [ ] Implement; targeted → PASS; typecheck.
- [ ] Run the Task Completion Gate using commit message
      `feat(core): evidence-driven arc completion and transition apply`.

## Task 22 — Studio Foundation governance surface

**Files**
- Modify `packages/studio/src/api/server.ts` (foundation route block, base
  `/api/v1/books/:id/foundation`: unit manifests, readiness report, revision
  open/load/save/approve/needs-revision/reapprove-stale/discard/batch-approve —
  consuming EXACTLY the Task 8 Core operations; publish action consuming Task 9)
- Create `packages/studio/src/lib/foundation-api.ts` (typed client)
- Create `packages/studio/src/pages/FoundationPage.tsx` + `foundation-ui-state.ts` +
  `foundation-ui-state.test.ts`
- Create `packages/studio/src/__tests__/foundation-route.test.ts`

Pattern: mirror `stateReviewBase` routes + `lib/state-review-api.ts` + `StateReviewPage.tsx`
(pure `*-ui-state` model + vitest node-env tests, no RTL; bilingual copy; route keyed
`key={bookId}`; `invalidateApiPaths` on publish).

Studio behavior (spec §8.2): unit-level review with statuses/required-optional/
dependencies/findings/diffs/revision workspace/history/Publish boundary; approved units
read-only until explicit Open Revision; revision UI shows current Published authority,
current Revision Draft, and which version production uses; diff-first review for later
revisions; batch approval only for safe clean units. No duplicated readiness/authority
logic — the UI renders Core's structured readiness and calls Core's revision service.

**Steps**

- [ ] Write failing route tests (foundation read/units/readiness/revision lifecycle/
      publish + error mapping reusing `mapStateReviewError` style) and
      `foundation-ui-state.test.ts` model tests; targeted → fail.
- [ ] Implement server route block + typed client + page; targeted → PASS.
- [ ] Studio regressions: `state-review-route.test.ts`, full studio serial suite;
      typecheck; client build.
- [ ] Run the Task Completion Gate using commit message
      `feat(studio): foundation v2 governance surface`.

## Task 23 — Studio Planning governance surface (Core NL parsing)

**Files**
- Modify `packages/studio/src/api/server.ts` (planning route block, base
  `/api/v1/books/:id/planning`: arc drafts/publish, published arc + beat progress,
  lookahead show, detailed-plan gate report, direction parse/create/confirm/conflict
  resolution via Core `parseHumanDirectionDraft`/`confirmHumanDirection`,
  authorization create/confirm)
- Create `packages/studio/src/lib/planning-api.ts` (typed client)
- Create `packages/studio/src/pages/PlanningPage.tsx` + `planning-ui-state.ts` +
  `planning-ui-state.test.ts`
- Create `packages/studio/src/__tests__/planning-route.test.ts`

Studio behavior (spec §8.3–8.5): Published Arc Plan, Major Beat progress, advisory
Rolling Lookahead (no Approve button), next Detailed Plan; Arc Plan Publish is explicit;
**Human Direction NL is parsed by the Core `parseHumanDirectionDraft` service** — the
React layer only displays the pending structured proposal; confirmation via Core
`confirmHumanDirection`; direction conflicts require explicit resolution; Detailed Plan
SAFE → no approval needed (View/Add Direction/Regenerate/Write Chapter);
UNCERTAIN/AUTHOR_DECISION explain issue+evidence+authority+valid next actions;
CONFLICT hard-blocks with no "Write Anyway". No duplicated governance logic.

**Steps**

- [ ] Write failing route tests + `planning-ui-state.test.ts` model tests (incl.
      lookahead has no approve action; publish explicit; direction NL → pending
      proposal displayed, authority only after confirm; conflict resolution); targeted
      → fail.
- [ ] Implement server route block + typed client + page; targeted → PASS.
- [ ] Studio regressions: full studio serial suite; typecheck; client build.
- [ ] Run the Task Completion Gate using commit message
      `feat(studio): planning v2 governance surface`.

## Task 24 — CLI safe operational integration

**Files**
- Create `packages/cli/src/commands/foundation.ts` (status/inspect/units; no mutation
  bypass)
- Create `packages/cli/src/commands/planning.ts` (arc status, lookahead show, gate
  report)
- Modify `packages/cli/src/commands/status.ts` (readiness block summary:
  blockingReasons/warnings/nextRecommendedAction)
- Modify `packages/cli/src/commands/write.ts` (write next calls the SAME Core
  write-entry gate from Task 19; on `conflict` prints blockers and points to Studio;
  `plan_defect` path surfaces replan)
- Create `packages/cli/src/__tests__/foundation-command.test.ts`,
  `packages/cli/src/__tests__/planning-command.test.ts`; extend
  `packages/cli/src/__tests__/write-command.test.ts`

Rules: CLI is a safe operational surface; complex review routes users to Studio;
**no** `--force`/`--ignore-canon`/`--skip-authority` flags; `castor write next` keeps
working for healthy books and fails closed on gate violations with actionable messages;
the security boundary is the Core write gate (Task 19), and CLI tests additionally
prove the CLI cannot bypass it.

**Steps**

- [ ] Write failing tests: foundation status output; planning gate report; write-next
      on a gate-CONFLICT book fails with blockers and no prose write; no bypass flag
      exists (parsing rejects unknown flags); healthy SAFE path still writes.
- [ ] Implement; targeted → PASS.
- [ ] CLI regressions: full CLI serial suite; typecheck; build.
- [ ] Run the Task Completion Gate using commit message
      `feat(cli): phase 5 governance status and gate-safe write integration`.

## Task 25 — Legacy upgrade E2E, compatibility and recovery scenarios (test/E2E-only)

**Files**
- Create `packages/core/src/__tests__/legacy-v2-upgrade-e2e.test.ts`
- Create `packages/core/src/__tests__/phase5-recovery-e2e.test.ts`

This Task is **explicitly test/E2E-only: no new production migration glue is required**.
The capability-marker persistence surface (additive `governance` field on
`BookConfigSchema`, read/write via `state/manager.ts` `loadBookConfig`/`saveBookConfig`)
is introduced and tested in Task 1/Task 3; the atomic Foundation marker flip lives in
Task 9 and the atomic Planning marker flip lives in Task 13. Defect-owner references
cover ALL actual owners: T1/T3 (markers), T8 (approval service), T9 (Foundation
publish/marker/recovery), T13 (Arc publication/marker/recovery), T19 (Writer-mode matrix
and Attempt path). Any defect found in those surfaces during this Task is fixed in its
owning Task, not here. **If T25 finds a REAL integration defect after an earlier
Human-approved Task: STOP and report the owning Task/regression — never silently rewrite
history or pretend the E2E is "test-only PASS".**

Scenarios:
- legacy book (existing `castor.json`, `.castor/`, Foundation files, ChapterIntent,
  ChapterMemo, chapters, Canon/state) remains fully usable without V2 upgrade
  (write-next + Phase 4 flow green);
- opt-in upgrade candidate → Human review (Task 8) → Human Publish (Task 9) → V2 v1,
  preserving chapter prose hashes and historical Canon byte-for-byte, with the marker
  flipping atomically in the publish transaction;
- once V2 Foundation is Published, legacy Foundation is not run as competing authority;
- fault-injection E2E across the Task 9/13/18 transaction stages verifying recovery
  truth priority (committed history → current manifests → journals → drafts → derived);
- immutable-history corruption is detected, never silently adopted;
- schema migrations forward-only/idempotent/recoverable.

**Steps**

- [ ] Write the E2E tests; run → fail only if a production surface defect exists
      (report to its owning Task T1/T3/T8/T9/T13/T19; otherwise tests pass).
- [ ] Run full core serial suite (expect exactly the 2 known Windows EPERM baselines);
      studio serial; CLI serial; typecheck; build.
- [ ] Run the Task Completion Gate using commit message
      `test(core): legacy-v2 upgrade compatibility and recovery e2e`.

## Task 26 — Final Phase 5 acceptance (Definition of Done)

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
tests green; Studio/CLI share Core logic; Phase 4 semantics intact; no AI-only execution
path can create Human authority; restore never creates Published authority; the Core
write gate is the security boundary. Record the verdict in the verification doc.
`v0.2.0` is created ONLY after the human accepts the completed Phase 5 verification/
review state — never by this or any ordinary Task.

**Steps**

- [ ] Write the acceptance test; run E2E scenarios; fix only genuine Phase 5
      regressions RED-first with narrow commits.
- [ ] Run the full serial battery; record results; fill the verification doc.
- [ ] `git diff --check`; review; run the Task Completion Gate using commit message
      `test: phase 5 acceptance matrix verified`.

---

## Task Completion Gates (every Task — exactly one commit)

Every implementation Task ends with the SAME explicit gate, in order:

- [ ] G1. Targeted tests green (RED→GREEN cycles per Task steps).
- [ ] G2. Relevant regression suites green (core/studio/cli per Task).
- [ ] G3. Typecheck/build as applicable (`pnpm -C E:\tool-castor-story-engine typecheck`,
      package build).
- [ ] G4. `git diff --check` clean.
- [ ] G5. **Independent/reviewer checkpoint** for the Task's diff and tests.
- [ ] G6. Fix any valid Critical/Important findings (RED-first, minimal fix).
- [ ] G7. Rerun targeted + regression suites.
- [ ] G8. Re-review until APPROVE (Critical = 0, Important = 0).
- [ ] G9. **Perform exactly ONE focused commit using the Task's commit message.**
- [ ] G10. **STOP AT THE HUMAN GATE — do not automatically proceed to the next Task.**

Each Task states its commit message once, in the form
"Run the Task Completion Gate using commit message X" — G9 performs that single commit.
No Task performs a second commit. If reviewer infrastructure is unavailable at G5/G8:
report that fact honestly, do not claim independent approval, and stop for the human
gate.

## Studio/CLI rule

UI and CLI consume Core governance operations only. Studio gets rich resolution/review
UX (Tasks 22–23); CLI gets safe operational parity and clear blockers (Task 24). Neither
implements readiness/authority logic; complex review may route users to Studio. The
security boundary is the Core write gate (Task 19); Studio and CLI call that same Core
operation. Parity is tested (T22/T23/T24/T26).

## Phase 4 integration rule

Phase 4 is an existing contract to preserve — not rewritten. Phase 5 integrates after/
beside the Final Confirm boundary. Task 20 extends `state-review-finalize.ts` by adding
evidence-derived, validated consumption writes to its existing atomic set only. Tests
prove Draft/Audit do not consume authorizations, State Review proposals do not consume
authorizations, and Final Confirm settlement does — with fault injection on both sides
of the commit boundary. The full Phase 4 suites must stay green in every task gate and
in T26.

---

## Spec-to-Task Coverage Matrix

| Spec requirement | Task(s) |
|---|---|
| §1 authority ownership + conflict routes + invariants 1–10 | T1, T4, T5, T6, T8, T9, T11, T18, T20 |
| §2 Foundation representation (Markdown + manifest, no prose in JSON) | T2 |
| §2 unit statuses/importance/kinds/Story Frame 4 units | T1, T2, T4 |
| §2 character policy + reasons | T1, T4 |
| §2 relationship split + tiers | T1, T2, T12 |
| §2 Arc Direction / Book Rules kinds | T1, T2, T12 |
| §2 Foundation/Runtime Hooks + lifecycle + no escalation | T1, T12, T20 |
| §2 Timeline split + constraint kinds | T1, T2, T16 |
| §2 dependencies direct-only | T4 |
| §2 revision policy / published history / restore-as-revision-candidate / external edits | T5, T8, T9 |
| §2 legacy books + upgrade (candidate, Human review, Human Publish) | T3, T8, T9, T25 |
| §3 pipeline + adaptive intake (ends at Human Review) | T10 |
| §3 generation strategy + repair bounds + reviewer/repair separation | T7, T10 |
| §3 finding schema + severity/scope policy + scores informational | T7 |
| §3 conflict model (FUTURE_SAFE/UNCERTAIN/CANON_CONFLICT) + 2-layer | T6 |
| §3 Human Resolution Record | T6 |
| §3 Human review/approval state transitions | T8 |
| §3 Publish gate + Chapter-1 readiness | T4, T9 |
| §4 Planning artifacts + Arc Plan metadata/versions/restore-candidate | T12, T13 |
| §4 Major Beats lifecycle/importance/categories/Canon evidence | T12, T20 |
| §4 Arc Plan authority boundary (explicit Human Publish after preflight) | T13 |
| §4 Arc authority publication transaction + planning V2 marker activation + direct future-planning invalidation | T13 |
| §4 Arc recovery coverage (publish transaction both crash sides) | T13, T25, T26 |
| §4 Rolling Lookahead lifecycle (advisory, 2–3 horizon, typed provenance) | T14 |
| §4 Human Direction scopes/lifecycle/conflicts + Core NL parse | T11 |
| §4 Author Decisions vocabulary + Authorization scopes/conditions/consumption | T1, T11, T20 |
| §4 Detailed Chapter Plan (ChapterIntent/Memo evolution + bindings + immutability) | T15, T18 |
| §4 Execution Attempt defects + 2 replans + durable attempts | T18 |
| §4 Arc completion (never auto-Publish) | T21 |
| §5 Arc flow (Planner → Draft → deterministic → semantic → repair → Human Publish) | T13 |
| §5 Detailed chapter flow (fresh after latest Canon) | T15, T16 |
| §5 Planning Gate L1/L2 + truth table + SAFE semantics | T16 |
| §5 bounded repair + PLAN_SCOPE_TOO_BROAD | T15, T16 |
| §6 Composer architecture + profiles + priority P0–P4 | T17 |
| §6 budget policy + reserve output + no auto model switch + CONTEXT_BUDGET_EXCEEDED | T17 |
| §6 projection vs summary + compression allowlist/forbidden set | T17 |
| §6 ContextBundle provenance (structured) + staleness | T17 |
| §6 retrieval truth (exclude rejected attempts; derived indexes) | T17, T18, T20 |
| §7 persistence layers + published current+history | T5 |
| §7 Transaction Coordinator steps + revalidation + REVISION_BASE_STALE (single owner) | T9 |
| §7 crash semantics + journal + fault injection | T9, T18, T25, T26 |
| §7 authority switch + dependency invalidation atomic | T9, T20 |
| §7 Execution freeze + EXECUTION_PREPARE_FAILED + provider failures | T18 |
| §7 authorization consumption with Canon settlement (single ACTIVE→CONSUMED path, evidence-derived, atomic) | T11 (pure), T20 |
| §7 recovery truth priority + corruption detection + reuse primitives | T9, T25 |
| §7 legacy compatibility + capability markers (atomic activation) + opt-in V2 + no competing authority | T1, T3, T9, T12, T25 |
| §7 migrations forward-only/idempotent/recoverable | T25 |
| §8 Studio workspace + Foundation UX + revision UI + batch approval | T22 |
| §8 Arc UX + Lookahead no-approve + Direction parse/confirm/conflict | T23 |
| §8 Detailed Plan states + Write action + one chapter | T23, T18, T19, T24 |
| §8 CLI safety (no bypass flags; write next respects gates) | T24 |
| §9 testing layers + Foundation/Planning coverage + truth contract | T4–T18, T26 |
| §9 Context tests + fault injection + half-authority invariant | T9, T17, T18, T20, T25, T26 |
| §9 compatibility/parity + E2E A–F | T22, T23, T24, T25, T26 |
| §9 security/path safety (AI IDs never become fs paths — SafeGovernanceId) | T1, T2, T25 |
| §2 Foundation unit revision model (contentRevision vs approvedRevision; stale = status only) | T2, T8, T9 |
| §5 Planning Gate trusted inputs (planId + Core-loaded authority only) | T16 |
| §5 planning findings plan-scoped (planId + planHash, stale-finding rejection) | T16 |
| §6 ContextBundle subject identity (bundle ↔ persisted plan) | T17, T18 |
| §7 Execution Snapshot freezes exact planId + planHash | T18 |
| §7 two automatic replans AFTER the initial attempt | T15, T18, T19 |
| §7 book-scoped coordination/locking on every authority-changing operation (no last-write-wins) | T9, T11, T13, T18, T20, T21 |
| §7 Foundation revision content isolation (working root; Published untouched until Publish) | T8, T9 |
| §7 Arc publication direct future-planning invalidation via generic PlanningInvalidationRegistry | T12, T13, T14, T15 |
| Core Writer gate (spec §8.5 + invariants 9) | T19 |
| Scope boundary (no Phase 6/7, one chapter per run) | T18, T19, T24, T26 |
| Definition of Done | T26 |
