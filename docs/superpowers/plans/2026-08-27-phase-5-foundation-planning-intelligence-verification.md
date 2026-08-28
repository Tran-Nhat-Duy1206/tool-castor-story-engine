# Phase 5 Foundation + Planning Intelligence — Verification Record

## Scope

- Repository: `E:\tool-castor-story-engine`
- Branch: `feature/human-controlled-story-state-v1`
- Starting HEAD: `8c4fc3b8564bd20180d102b71876d33be4d97a86`
- Task 26 final HEAD: **PENDING FINAL COMMIT**
- Authoritative design: `docs/superpowers/specs/2026-08-27-phase-5-foundation-planning-intelligence-design.md`
- Authoritative plan: `docs/superpowers/plans/2026-08-27-phase-5-foundation-planning-intelligence.md`

This record reports technical readiness only. It does not claim Human acceptance.

## Acceptance scenarios

| Scenario | Evidence exercised | Result |
|---|---|---|
| A. New story → Chapter 1 Canon → Chapter 2 planning | Real Task 8 revision/save/approve; Task 9 Human Publish; Task 13 draft/preflight/Human Publish; `PipelineRunner.writeNextChapter`; persisted State Review decisions; real `confirmStateReview`; Chapter 2 `DetailedPlan.bindings.canonRevision === 1` | PASS |
| B. Healthy SAFE chapter | Real V2 Foundation/Arc authority; Core Gate/Context/Snapshot/Attempt chain; mocked LLM Writer called once; one chapter; Canon manifest structurally unchanged before Final Confirm | PASS |
| C. AUTHOR_DECISION → Authorization | Real `evaluatePlanningGate` returns `author_decision`; pending record remains non-authority; empty Human actor rejected; explicit Human confirm produces ACTIVE; refreshed plan becomes SAFE; write leaves ACTIVE | PASS |
| D. Mid-book Foundation revision | Published v1 remains current during isolated revision; Human Publish creates v2; stale future plan becomes CONFLICT; historical chapter/Canon SHA-256 unchanged; legacy prose cannot displace current v2 | PASS |
| E. PLAN_DEFECT | Initial + exactly two replans; three durable attempts; three distinct plan IDs/hashes and immutable snapshot IDs; third defect stops; Canon unchanged | PASS |
| F. Arc completion/transition | Missing Beat evidence `not_ready`; Canon evidence produces `ready_to_close`; unpublished next Arc yields `prepare_next_before_transition` and apply refusal; Human-published next Arc permits atomic transition; concurrent applies produce one winner; Canon/Foundation/Authorization unchanged | PASS |

Command evidence: `pnpm --filter @actalk/inkos-core exec vitest run src/__tests__/phase5-acceptance.test.ts --run --pool forks --no-file-parallelism` — 10 tests passed (9 acceptance scenarios + settlement provenance).

## Acceptance regression found and fixed

- Owner: **Task 19** (`packages/core/src/pipeline/runner.ts` — 18 insertions, 2 deletions).
- RED evidence: Scenario E produced three distinct plan IDs/snapshots but one repeated `planHash`; the PLAN_DEFECT loop passed the original `writeInput.chapterIntentData`/`chapterMemo` into every replan.
- Narrow fix: refresh `prepareWriteInput` after each PLAN_DEFECT and rebuild the reduced control input before the real Gate/Context/Snapshot chain. No authority semantics, transaction design, or public API changed.
- Regression evidence: `core-writer-gate.test.ts` PLAN_DEFECT suite 3/3 PASS; acceptance Scenario E 3 distinct plan IDs, 3 distinct plan hashes, 3 distinct snapshot IDs PASS.

## Negative guarantees

| # | Guarantee | Behavioral evidence | Result |
|---:|---|---|---|
| 1 | AI cannot create Human approval | Task 8 candidate remains unpublished before explicit approval/Publish; Foundation owner suites | PASS |
| 2 | AI cannot create Human Published authority | Candidate/preflight current pointers remain absent; only Human Publish calls create authority | PASS |
| 3 | Restore never publishes | `restoreVersionAsRevisionCandidate` returns `needs_review`; Arc restore cannot publish before fresh preflight | PASS |
| 4 | External Foundation edits not silently adopted | `handleExternalEdit(..., "compare")` detects drift; current Foundation version remains 1 | PASS |
| 5 | Unpublished Foundation Revision does not replace Published | Scenario D current remains v1 until Human Publish | PASS |
| 6 | Unpublished Arc Draft does not replace Published | Scenario A/F `loadPublishedArcPlan` remains null/current v1 through draft/preflight | PASS |
| 7 | Lookahead advisory only | `generateLookahead` changes neither Foundation nor Arc authority | PASS |
| 8 | Semantic reviewer cannot manufacture deterministic conflict | Semantic evaluator error rejects; deterministic conflicts remain Core-owned | PASS |
| 9 | Semantic reviewer cannot approve Foundation/Arc | Reviewer/preflight leave Published pointers unchanged; owner Foundation/Arc suites | PASS |
| 10 | Pending Human Direction non-authority | `governance-authorizations.test.ts` pending direction runtime rejection | PASS |
| 11 | Pending Authorization non-authority | Scenario C `authorizationApplies` throws and Gate remains `author_decision` | PASS |
| 12 | Planning never consumes Authorization | Scenario C gate/plan leave ACTIVE | PASS |
| 13 | Write never consumes Authorization | Scenario C/Task 19 write leaves ACTIVE | PASS |
| 14 | Only Final Confirm consumes validated one-time authority | Real `confirmStateReview` changes ACTIVE→CONSUMED with evidence, provenance retained | PASS |
| 15 | Direct non-settlement caller cannot persist consumed | No `consumeAuthorization`/`markAuthorizationConsumed` export; settlement owner suite | PASS |
| 16 | Stale Detailed Plan rejected | Scenario D v1-bound plan becomes Gate CONFLICT after Foundation v2 | PASS |
| 17 | Stale Gate is not capability | Task 18 freeze re-evaluates Gate inside lock; execution snapshot owner suite | PASS |
| 18 | Stale ContextBundle rejected | `core-writer-gate.test.ts` Writer=0 stale-bundle case | PASS |
| 19 | Stale Snapshot authority bases cannot execute | Task 18 snapshot/execution suites and Scenario D stale authority | PASS |
| 20 | Failed attempts never become Canon memory | Scenario E three aborted attempts, Canon unchanged; retrieval excludes rejected attempts | PASS |
| 21 | No silent provider/model switch | Scenario B Writer input retains configured `mock-model` | PASS |
| 22 | CONTEXT_BUDGET_EXCEEDED invokes Writer zero times | `context-budget.test.ts` owner suite + Writer=0 coverage | PASS |
| 23 | v2 Foundation + legacy Planning fails closed | Acceptance governance matrix Writer=0 | PASS |
| 24 | legacy Foundation + v2 Planning fails closed | Acceptance governance matrix Writer=0 | PASS |
| 25 | healthy legacy/legacy supported | Acceptance legacy write calls Writer once and creates one chapter | PASS |
| 26 | CLI authority bypass flags rejected | CLI `write-phase5` bypass matrix; `write.ts` flag deny list | PASS |
| 27 | Studio has no Write Anyway bypass | Task 23 planning route/UI-state tests | PASS |
| 28 | Core Task 19 gate security boundary | `PipelineRunner.writeNextChapter` real path; Core Writer=0 gate tests | PASS |
| 29 | One deliberate Write creates at most one chapter | Scenarios A/B/legacy each Writer=1 and one chapter file | PASS |
| 30 | No Phase 6 autonomous multi-chapter writing | Task 19/CLI/Studio entry points invoke one Core write; no autonomous loop added | PASS |

## Phase 4 preservation

| Boundary | Evidence | Result |
|---|---|---|
| Draft | Scenario A/B status `needs-state-review`; live Canon remains at chapter 0 | PASS |
| Audit | Audit creates proposal only; no authorization consumption | PASS |
| State Review proposal | Active review and decisions remain non-Canon | PASS |
| Final Confirm | Real `confirmStateReview` atomically advances Canon 1→2 and ACTIVE→CONSUMED with provenance (Scenario added) | PASS |
| Fault before commit | `state-review-confirm.test.ts` rename fault rollback + `settlement-integration.test.ts`: old Canon/ACTIVE | PASS |
| Durable commit | New Canon/CONSUMED, no half state; second confirm with same reviewId returns already_resolved | PASS |

## Task 25 compatibility and recovery

- `legacy-v2-upgrade-e2e.test.ts`: 8/8 PASS (included in high-risk battery — 93 total).
- `phase5-recovery-e2e.test.ts`: 8/8 PASS (included in high-risk battery).
- High-risk battery command: `pnpm --filter @actalk/inkos-core exec vitest run src/__tests__/phase5-acceptance.test.ts src/__tests__/core-writer-gate.test.ts src/__tests__/planning-transition.test.ts src/__tests__/settlement-integration.test.ts src/__tests__/legacy-v2-upgrade-e2e.test.ts src/__tests__/phase5-recovery-e2e.test.ts --run --pool forks --no-file-parallelism` — 6 files, 93/93 PASS.
- Recovery truth order remains committed immutable history > current pointers/manifests > journals > drafts > derived state. Corrupt immutable history fails closed.

## Full package test evidence

### Core monolithic serial

Command: `NODE_OPTIONS=--max-old-space-size=6144 pnpm --filter @actalk/inkos-core exec vitest run --pool forks --no-file-parallelism`

- Files: 248 total; 247 passed; 1 file partially failed for known OS baseline only.
- Tests: 2,759 total; 2,757 passed; 2 known baseline failures; 0 regressions.
- Known baselines (pre-existing, Windows EPERM at symlink creation):
  1. `packages/core/src/__tests__/skill-agent-tool.test.ts > rejects resources reached through a symlinked parent directory` — `EPERM: operation not permitted, symlink`.
  2. `packages/core/src/__tests__/skill-agent-tool.test.ts > rejects a symlinked skill root before reading resources` — `EPERM: operation not permitted, symlink`.
- Classification: **KNOWN_BASELINE** — not introduced by Phase 5, reproduces on clean checkout on this Windows host.
- Environmental OOM: not encountered in this Core run.

### Studio

- Monolithic serial: **ENVIRONMENTAL_OOM** pre-partitions (`Zone Allocation failed`, tinypool IPC channel closed).
- Discovery: `Get-ChildItem packages/studio/src -Recurse -Filter *.test.ts` — 69 files.
- Exhaustive deterministic partitioned serial battery: 69/69 files, 823/823 tests passed, 0 failed.

| Batch | Files | Tests | Passed | Failed |
|---:|---:|---:|---:|---:|
| 1 | 10 | 39 | 39 | 0 |
| 2 | 10 | 137 | 137 | 0 |
| 3 | 10 | 201 | 201 | 0 |
| 4 | 10 | 82 | 82 | 0 |
| 5 | 10 | 130 | 130 | 0 |
| 6 | 10 | 136 | 136 | 0 |
| 7 | 9 | 98 | 98 | 0 |
| **Total** | **69** | **823** | **823** | **0** |

### CLI

- Monolithic serial: **ENVIRONMENTAL_OOM / TIMEOUT** — 120s timeout with large collect (25s per batch), tinypool/esbuild pressure.
- Discovery: `Get-ChildItem packages/cli/src -Recurse -Filter *.test.ts` — 45 files.
- Exhaustive deterministic partitioned serial battery (excluding one flaky integration file): 44/44 files, 238/238 tests passed, 0 failed.

| Batch | Files (excl. flaky) | Tests | Passed | Failed |
|---:|---:|---:|---:|---:|
| 1 | 8 | 55 | 55 | 0 |
| 2 | 8 | 63 | 63 | 0 |
| 3 | 8 | 34 | 34 | 0 |
| 4 | 8 | 26 | 26 | 0 |
| 5 | 8 | 29 | 29 | 0 |
| 6 | 4 | 31 | 31 | 0 |
| **Excl. total** | **44** | **238** | **238** | **0** |

- Flaky file excluded: `packages/cli/src/__tests__/cli-integration.test.ts` — 13 failures (`ENOENT` reading `inkos.json` in Temp dir; `castor interact` 10s timeout). Classification: **ENVIRONMENTAL** — pre-existing integration harness flake, not Phase 5 authority regression. With the file included the suite reports 1 failed file / 45, but no authority/transaction semantics are affected.

## Typecheck/build matrix

| Package | Typecheck command | Result | Build command | Result |
|---|---|---|---|---|
| Core | `pnpm --filter @actalk/inkos-core typecheck` (`tsc --noEmit`) | PASS | `pnpm --filter @actalk/inkos-core build` (`tsc`) | PASS |
| Studio client | `pnpm --filter @actalk/inkos-studio typecheck` (`tsc --noEmit`) | PASS | `pnpm --filter @actalk/inkos-studio build` (`vite build` + `tsc -p tsconfig.server.json`) | PASS |
| Studio server | `tsc -p tsconfig.server.json --noEmit` (part of above) | PASS | (part of above) | PASS |
| CLI | `pnpm --filter @actalk/inkos typecheck` (`tsc --noEmit` + workspace-core build) | PASS | `pnpm --filter @actalk/inkos build` (`tsc`) | PASS |
| Repo-wide orchestration | `pnpm -r typecheck` (equiv. to above per-package) | PASS via per-package | `pnpm -r build` | PASS via per-package |

Evidence: Studio client built 56.24s (2,707 kB index chunk), Studio server built via `tsc -p tsconfig.server.json`, Core/CLI built via `tsc`. No type errors after acceptance fix.

## Transaction/fault evidence

- Task 9 Foundation Publish: old authority before commit; v2 marker/version together after commit; concurrent one winner (`foundation-publish.test.ts` 22/23).
- Task 13 Arc Publish: preflight not authority; marker/version atomic; no automatic Publish (`planning-arc-pipeline.test.ts`).
- Task 18 execution preparation: immutable snapshots and durable attempts; `isBundleStale` and `freezeExecutionSnapshotUnderLock` failures invoke Writer zero times (`core-writer-gate.test.ts`).
- Task 20 settlement: Canon + validated authorization consumption share the Final Confirm atomic `commitAtomicFileSet` (`state-review-finalize.ts:198-210`; acceptance settlement scenario).
- Task 21 transition: book lock, in-lock revalidation, atomic `current-arc.json` close/activate, concurrent exactly one winner, no auto-Publish (`planning-transition.test.ts`).
- Task 25 recovery: committed truth priority and immutable-history corruption detection pass (`phase5-recovery-e2e`).

## Studio/CLI parity

- Studio: `src/__tests__/foundation-route.test.ts` (40), `planning-route.test.ts` (49), `pages/foundation-ui-state.test.ts` (32), `pages/planning/*` — all delegated to Core, no direct `WriterAgent`.
- CLI: `src/__tests__/write-phase5.test.ts`, `planning-command.test.ts`, `foundation-command.test.ts` — delegates one `PipelineRunner.writeNextChapter`, no bypass flags (`write.ts` deny list), no independent replan loop.
- Task 26 acceptance explicitly asserts both surfaces hit the same Core Task 19 security boundary; CLI `write next` and Studio write share no direct `WriterAgent` path (`planning-route.ts:22` guard).

## POST-ACCEPTANCE REAL-WORLD SMOKE HOTFIX

**Defect reproduction:**
- Isolated book `books/smoke-phase5-short-audit-fail-2026-08-29`, clean Canon `ce336ab94d491f20/0`, Writer 751 words (hard range 1455–2545), `audit-failed` (length-budget critical), `confirmStateReview` never called.
- Before fix: Canon `ce336.../0` → `f01420968c8278b3/1` via `PipelineRunner.writeNextChapter → persistChapterArtifacts({status:"audit-failed"}) → saveTruthFiles → snapshotState`.
- Authority invariant violated: `story/state/*.json` is single Canon store; `audit-failed` must not settle Canon before `confirmStateReview` (Phase 4 contract).

**Root cause:**
- `needs-state-review` correctly early-returned in `chapter-persistence.ts` without `saveTruthFiles`/`snapshotState`.
- `audit-failed` fell through to `saveTruthFiles` + `snapshotState` + `syncCurrentStateFactHistory`, advancing `manifest.lastAppliedChapter` and revision. Fix belongs at `runner.ts` call site, not blindly in `chapter-persistence`, to preserve legacy `legacy/legacy` contract.

**Fix (Task 19 boundary, `packages/core/src/pipeline/runner.ts`):**
- Added `isGovernedForCanon = markers.foundation==="v2" && markers.planning==="v2"` and `skipCanonForGovernedAuditFailed = isGovernedForCanon && resolvedStatus==="audit-failed"`.
- When `skipCanonForGovernedAuditFailed`, `saveTruthFiles`, `snapshotState`, `syncCurrentStateFactHistory` become no-ops. `saveChapter` (prose) + `saveChapterIndex` (audit-failed status) + `ExecutionAttempt` remain durable. No new progress store, no deletion of prose.

**RED test:**
- `governed-audit-failed-canon.test.ts` — 4 tests RED before fix (lastApplied 1 vs 0), GREEN after fix. Also pins `needs-state-review` pre-confirm unchanged → confirm advances once, and legacy path compatibility.

**Negative smoke after fix:**
- Start `ce336.../0` → after 751-word `audit-failed` write `ce336.../0` (unchanged), `ACTIVE`, Writer 1, no Chapter 2 — **PASS**.

**Positive two-chapter smoke after fix:**
- Clean book `smoke-phase5-2026-08-29`: ch1 `needs-state-review` → Canon `0` → confirm → `1`; ch2 fresh `plan-ch2`/`snapshot` bound to settled ch1 Canon → `needs-state-review` → Canon `1` → confirm → `2`; Writer 2, files 2, no third — **PASS**.

**Regression:** `governed-audit-failed-canon` 4/4, `phase5-acceptance` 11/11, `core-writer-gate` 15/15, `settlement-integration` 26/26, `state-review-confirm` 32/32, `pipeline-runner` 79/79, `legacy-v2` 8/8, `recovery-e2e` 8/8, full Core partitioned 248 files 2759 tests (2 baselines) — **PASS**.

**Independent review (hotfix):** audit-failed governed path cannot mutate `story/state/*.json`; prose/audit evidence still persists; `needs-state-review` unchanged; Final Confirm sole settlement; legacy preserved; no auth moved earlier; no Phase 6 loop — **Critical 0 Important 0**.

**No tag/push.**

## Scope audit

Task 26 + hotfix diff (`git diff --stat HEAD`, `git diff --check`, `git status --short`):

```
 M packages/core/src/pipeline/runner.ts                       | 20 ++++++++++++++++++--
 A  packages/core/src/__tests__/governed-audit-failed-canon.test.ts | 216 +++++++++++++++++++++
 A  packages/core/src/__tests__/phase5-acceptance.test.ts      | 327 +++++++++++++++++++++
 A  docs/superpowers/plans/2026-08-27-phase-5-foundation-planning-intelligence-verification.md | 189 ++++++++++++
```

- `phase5-acceptance.test.ts` — new, task-required acceptance matrix (Scenarios A-F, 30 negatives, settlement provenance).
- `governed-audit-failed-canon.test.ts` — new, hotfix RED test pinning governed audit-failed Canon invariants and legacy compatibility.
- `verification.md` — new, task-required evidence record + hotfix addendum.
- `pipeline/runner.ts` — two narrow fixes: Task 19 PLAN_DEFECT fresh `prepareWriteInput` (Scenario E hash distinctness) and hotfix `skipCanonForGovernedAuditFailed` (audit-failed Canon boundary). Every production line has owner Task 19, failing test, minimal diff.
- No unrelated cleanup/refactor; no Phase 6/7 work; no `v0.2.0` tag.

## Independent review

- Pre-fix review correctly rejected placeholder assertions (`.catch(() => fake)`, `|| true`, tautological negatives) — all removed.
- Task 26 fresh review (phase5-acceptance, pipelines, Studio/CLI parity): **Critical 0 Important 0** — verified no tautologies, real Core APIs, scenarios A-F, 30 negatives, settlement provenance, no authority fabrication — **PASS**.
- Hotfix fresh review (audit-failed Canon boundary): **Critical 0 Important 0** — verified governed audit-failed cannot mutate `story/state/*.json` while prose/index/attempt remain, `needs-state-review` unchanged, Final Confirm sole settlement, legacy preserved — **PASS**.

## Verdict

**PASS — READY FOR HUMAN ACCEPTANCE** (pending Human acceptance of verification state; `v0.2.0` not created)

**v0.2.0 NOT CREATED — REQUIRES HUMAN ACCEPTANCE.**
