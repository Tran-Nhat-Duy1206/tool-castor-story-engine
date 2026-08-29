# castor V1 Implementation Plan

**Status:** PLAN — implementation planning only. No code, tests, schemas, prompts, or migrations are changed by this document.
**Sources of truth used:** `docs/PROJECT_VISION.md` (long-term intent) · `docs/V1_SPEC.md` (APPROVED V1 requirements) · `docs/ARCHITECTURE_AUDIT.md` (verified castor 1.8.0 facts).
**Rule invoked throughout:** REUSE → EXPOSE → EXTEND before DUPLICATE → REPLACE → REWRITE (V1_SPEC §61). Every task below names the exact existing symbols it reuses; where it extends, it says exactly what is added.

---

## 0. Ground Rules and Invariants

These hold for every task in this plan:

1. **One canonical store.** `books/<id>/story/state/{manifest,current_state,hooks,chapter_summaries}.json` remains the ONLY canonical structured state (`models/runtime-state.ts`). No second Canon database, no Studio-side canon, no markdown-as-canon (V1_SPEC §4).
2. **Projections stay derived.** `story/current_state.md`, `pending_hooks.md`, `chapter_summaries.md` are rendered exclusively via `state-projections.ts#renderCurrentStateProjection / renderHooksProjection / renderChapterSummariesProjection` from JSON. They are never hand-authored by Studio.
3. **Atomicity preserved.** All multi-file writes go through `utils/atomic-file-set.ts#commitAtomicFileSet`. Prose + truth + state continue to commit as one set wherever they change together.
4. **Recovery preserved.** `PartialResponseError` regeneration, retry ladder, `assertNoPendingStateRepair`, snapshots, `restoreState`/`rollbackToChapter`, `.versions` archive-before-overwrite, book locks — untouched except where a task explicitly extends them, always with regression tests (§R).
5. **Every phase ships green.** After each phase: `pnpm typecheck`, `pnpm build`, package test suites pass (1856 baseline + new tests; the 2 Windows symlink EPERM failures in `packages/core/src/__tests__/skill-agent-tool.test.ts` remain excluded from regression judgment).
6. **Tests first.** Each task names its test file and the failing assertion written before implementation.
7. **Browser never touches the filesystem.** New Studio routes accept `bookId`/`chapterNumber` parameters and resolve paths server-side through `StateManager`; request bodies are zod-validated.
8. **No unrelated cleanup.** Vestigial systems listed in AUDIT §12 are left alone unless a V1 task explicitly depends on them (none does; §44 of V1_SPEC requires verify-before-expose, and we simply do not expose them).

---

## 1. Target Flow and Architecture Deltas

Today (verified):

```
Writer prose → Observer → Settler(RuntimeStateDelta) → arbitrate → applyRuntimeStateDelta
→ WriterAgent.saveChapter [ONE atomic set: prose + projections + story/state/*.json]
→ persistChapterArtifacts: index → drift → snapshotState(N) → fact-history replay(memory.db)
→ status ready-for-review / audit-failed / state-degraded
```

V1 target (delta in **bold**):

```
Writer prose → Observer → Settler(RuntimeStateDelta) → existing validations/audit
→ **build StateReviewArtifact from delta (+evidence quotes)**            ← NEW (E)
→ saveChapter(deferred): atomic set = prose + proposal artifact ONLY;
   story/state/*.json and projections NOT advanced                       ← CHANGED (E)
→ index.status = needs-state-review                                      ← NEW STATUS (F)
→ Generate Next refuses while previous chapter is needs-state-review      ← GATE (F)
→ human Accept/Edit/Reject/Add in Studio (decisions persisted in artifact) ← NEW (G)
→ confirmChapterState: arbitrate → reduce → validate → ONE atomic set
   {state JSONs + projections} → index=approved(READY) → snapshot(N)
   → memory/fact-history sync → delete proposal artifact                  ← NEW (I)
→ Manual current-state editor (any time): Edit → Save (the ONE confirmation)
   → validated atomic commit {canon + projections + snapshot N mirrors};
   forward-only semantics                                                 ← NEW (C/D/K)
→ Vietnamese native generation (vi|en only; zh migration path)            ← NEW (L–P)
```

The pipeline skeleton (Planner → Composer → Writer → Auditor → Reviser), provider layer, context assembly, and all recovery machinery are reused unchanged.

---

## 2. Resolved Design Decisions

Each decision below was derived from named audit findings; these bind all later tasks.

**D1 — Interception point (E).** The safest interception is `agents/writer.ts#WriterAgent.saveChapter` (:628–723), because that is the single place where the settler delta becomes canonical artifacts (via `resolveRuntimeStateArtifactsForOutput`) inside `commitAtomicFileSet`. In gated mode `saveChapter` receives an option that (a) excludes the four `story/state/*.json` writes and the three projection-markdown writes from the atomic set, and (b) includes a serialized `StateReviewArtifact` instead. Consequence: after a gated write, `loadRuntimeStateSnapshot(bookDir)` naturally returns the **pre-chapter state** (post-chapter N−1), which is exactly the reduction base the confirm step needs — no shadow copies, no rollback machinery. The delta itself is produced upstream by `settler-delta-parser.ts#parseSettlerDeltaOutput` and is already a plain object (`RuntimeStateDeltaSchema`) — serializing it into the artifact loses nothing.

**D2 — Proposal artifact (G).** Path: `books/<id>/story/runtime/chapter-NNNN.state-review.json`. Owned by the pipeline (created at gated save), mutated ONLY through Core APIs (decision updates, confirm, reject, regenerate), consumed by `confirmChapterState`, deleted on resolution. It lives under `story/runtime/` so the EXISTING sweep behavior of `StateManager.restoreState` / `rollbackToChapter` / `deleteLatestChapter` cleans it automatically (AUDIT §6.2) — no new cleanup subsystem. It is a pending-work queue scoped to one chapter, never read by generation (the gate forbids proceeding while it exists), therefore NOT a second canon.

**D3 — Lifecycle statuses (F).** Verified current enum: `ChapterStatusSchema = ["card-generated","drafting","drafted","auditing","audit-passed","audit-failed","state-degraded","revising","ready-for-review","approved","rejected","published","imported"]` (`models/chapter.ts:4-18`), and review-approve writes `status:"approved"` (`cli/commands/review.ts:127/:165`; identical logic in the Studio approve endpoint). Therefore: add exactly ONE new member `"needs-state-review"`; **READY = the existing `"approved"`** — no overloaded or ambiguous reuse. `production/harness.ts` `ProductionRunStatus` gains the same new member (additive). Existing meanings of `ready-for-review`, `audit-failed`, `needs-revision`, `state-degraded` unchanged.

**D4 — Current/history semantics (D) — AMENDED.** A manual correction takes effect from **E = durable contiguous story progress + 1** (`resolveDurableStoryProgress`; the durable chapter-file chain wins over an inflated `manifest.lastAppliedChapter`). `setFact` REPLACES the active rows for `subject::predicate` in live `current_state.json` following the existing reducer splice convention (`applyCurrentStatePatch` never leaves closed rows behind); the new row is `{subject, predicate, object, validFromChapter: E, validUntilChapter: null, sourceChapter: E}`. Historical intervals are reconstructed exclusively from snapshots + derived fact-history replay plus the live-truth reconciliation pass (T3A.7) — closed rows are NEVER accumulated in live JSON. Old chapters are never rewritten (V1_SPEC §11).

**D5 — No provenance marker in P3 — AMENDED.** `CurrentStateFactSchema` is NOT modified; there is no `origin` field anywhere in P3. Overwrite/history safety is achieved structurally: live OPEN rows are authoritative for the present and are reconciled into rebuilt history by their own `validFromChapter` (T3A.7), so no manual-vs-story distinction is required for correctness. If a later V1 phase needs provenance, adding an optional enum then remains purely additive.

**D6 — Gate scope.** Per V1_SPEC §14 the review gate is mandatory for the normal pipeline. Resolution helper `resolveChapterStateReviewMode(book, projectWriting)` mirrors the existing `resolveChapterReviewMode` pattern (`models/book.ts:83-88`): book override > project setting > default `"gate"`; value `"off"` exists so unattended operators can consciously opt out (daemon/auto then behave exactly as today). Default is `"gate"` — including for daemon/auto, which surface an explicit pause event instead of silently stalling (consistent with the existing consecutive-failure pause machinery, `pipeline/scheduler.ts`).

**D7 — Memory/fact-history sync reuse.** `rebuildNarrativeMemoryIndex` / `rebuildCurrentStateFactHistory` are currently module-internal to `pipeline/runner.ts` (verified: not exported). They are extracted verbatim into `packages/core/src/state/memory-sync.ts`; `runner.ts` delegates (behavior-neutral), and the new canon-commit paths call the same functions — guaranteeing writer context, projections, snapshots and fact history cannot diverge after a manual edit or review commit.

**D8 — Explicit-event evidence (H).** At proposal-build time, a deterministic heuristic records `evidence`: normalize whitespace and search the saved chapter body for the proposed `object`/value/notes text; if found, store the matched quote (≤200 chars). No LLM, no semantic engine. The Studio review UI shows "Explicitly supported by prose" when `evidence` exists and warns on reject (Reject Anyway preserved — human authority, V1_SPEC §16).

**D9 — Legacy no-delta settlements under the gate.** Today's fallback path (`syncLegacyStructuredStateFromMarkdown`, `runner.ts:3411-3427`) applies state directly from markdown sections. Under the gate this would bypass review, so task T4.5 adds a pure adapter converting legacy `UPDATED_*` settlements into a `RuntimeStateDelta` (reusing the alias normalization already implemented in `state-bootstrap.ts#parseCurrentStateFacts` and the hook-row mapper of `parsePendingHooksMarkdown`). If conversion fails, the chapter falls back to today's direct-apply behavior with a logged warning and no gate — documented limitation, tested.

**D10 — Revise of a READY latest chapter under the gate.** Revising chapter N replaces its prose, which invalidates its committed state changes. Gated-mode `reviseDraft` for the latest chapter therefore: archives the old version (existing `archiveChapterVersion`), writes revised prose, resets live truth/state files to `snapshots/N-1` content (reuse `restoreState` file-copy semantics), regenerates a fresh proposal artifact from the revised prose (reuse T4.6 regeneration), and sets `needs-state-review`. All existing revision gates still run BEFORE any write. This preserves "a failed rewrite cannot destroy a valid draft" while preventing stale canon.

**D11 — Predicate/alias policy.** Stored predicates are functional (matched against alias tables in `state-reducer.ts:182-220` and `utils/story-markdown.ts`). Vietnamese support ADDS vi aliases to those tables; it does not rewrite stored predicates during normal operation. Only the Chinese-migration flow (Phase 9) rewrites values, via schema-aware field whitelists — never a global `zh`→`vi` substitution (V1_SPEC §29).

**D12 — Read/write boundary (A).** One small Core facade (`state/canon-service.ts`) wraps `runtime-state-store.ts` APIs for non-pipeline consumers (Studio server, future tooling). Studio routes call only this facade + `StateManager`; the React app sees JSON over REST only.

---

## 3. Phases and Tasks

Task template: **Goal / Files / Reuse / Interface / Tests-first / Minimal impl / Verify / Commit boundary.**
Verification shorthand — CORE-F(t): `pnpm --filter @actalk/castor-core exec vitest run src/__tests__/<t>` · STUDIO-F(t): `pnpm --filter @actalk/castor-studio exec vitest run src/__tests__/<t>` · BOUNDARY: `pnpm --filter @actalk/castor-core test && pnpm --filter @actalk/castor-cli test && pnpm --filter @actalk/castor-studio test && pnpm typecheck && pnpm build`.

### Phase 0 — Test scaffolding (risk: LOW)

**T0.1 Canon fixture helper.**
- Files: CREATE `packages/core/src/__tests__/helpers/canon-fixture.ts`.
- Reuse: `node:fs/promises mkdtemp`, schema objects from `models/runtime-state.ts`.
- Interface: `createCanonBook(opts?)` → `{root, bookDir}` writing a minimal v2 book: `book.json`, `chapters/0001_*.md` + `index.json`, `story/state/*.json` (valid v2), `story/current_state.md|pending_hooks.md|chapter_summaries.md`, `story/snapshots/{0,1}/…`.
- Tests-first: assertions inside consuming tests (this IS the harness); add a sanity spec `canon-fixture.test.ts` asserting `loadRuntimeStateSnapshot(bookDir)` parses the fixture (fails before helper exists).
- Verify: CORE-F(canon-fixture).

### Phase 1 — Canonical state Core read boundary (A) (risk: LOW)

**T1.1 Core canon read service.**
- Files: CREATE `packages/core/src/state/canon-service.ts`.
- Reuse: `loadRuntimeStateSnapshot` (`runtime-state-store.ts:35`), `validateLoadedSnapshot` behavior, `StateManager.bookDir` convention documented for callers.
- Interface: `readStoryCanon(bookDir): Promise<StoryCanonView>` where `StoryCanonView = { manifest: StateManifest; currentState: CurrentStateState; hooks: HooksState; chapterSummaries: ChapterSummariesState }`.
- Tests-first: CREATE `src/__tests__/canon-service.test.ts` — (a) returns parsed view for T0.1 fixture; (b) rejects invalid state (corrupt `hooks.json` ⇒ throws with validator summary, mirroring `validateLoadedSnapshot` error shape); (c) reflects post-bootstrap view when JSON missing (markdown-seeded).
- Minimal impl: thin wrapper over `loadRuntimeStateSnapshot`; NO mutation beyond the existing bootstrap-on-read side effect (documented in TSDoc — matches engine behavior).
- Verify: CORE-F(canon-service).
- Commit: feat(core): canon read service.

**T1.2 Barrel export.**
- Files: MODIFY `packages/core/src/index.ts` (append export line near runtime-state exports :30-52).
- Verify: `pnpm --filter @actalk/castor-core build` (subpath exports intact), `pnpm typecheck`.

**T1.3 Studio read route.**
- Files: MODIFY `packages/studio/src/api/server.ts` (new route beside book routes ~:2800); CREATE `packages/studio/src/__tests__/canon-route.test.ts`.
- Route: `GET /api/v1/books/:id/canon[?section=manifest|current_state|hooks|chapter_summaries]` → 404 unknown book (`state.listBooks()` membership), 200 with section or full view; response contains NO filesystem paths.
- Reuse: `createStudioServer`'s existing `state` instance (:2556); core `readStoryCanon` (T1.2).
- Tests-first (following `api/server.test.ts` harness patterns): route returns fixture canon; unknown book ⇒ 404; section filter works; malformed section ⇒ 400.
- Verify: STUDIO-F(canon-route).

### Phase 2 — Studio Story State viewer (B) (risk: LOW)

**T2.1 Client API binding.**
- Files: CREATE `packages/studio/src/lib/canon-api.ts` (typed fetch wrapper mirroring `hooks/use-api.ts` conventions); MODIFY nothing else.
- Interface: `fetchCanon(bookId, section?): Promise<StoryCanonView | Section>`; types mirrored locally from the REST payload.
- Tests-first: `src/lib/canon-api.test.ts` — URL construction, section param, error propagation (mock fetch).

**T2.2 Story State page (read-only).**
- Files: CREATE `packages/studio/src/pages/story-state/StoryStatePage.tsx` (+ small presentational subcomponents in same folder); MODIFY `App.tsx` (route `/story-state?book=`), sidebar navigation entry.
- Content strictly mirrors existing schemas — three tabs: **Current State** (slot table from the 6 patch slots via alias matching + "Additional facts" list showing subject/predicate/object + validity chapters), **Hooks** (FULL 13-column table incl. `dependsOn/payoffTiming/coreHook/halfLife/promoted` — deliberately unlike the lossy client-side `lib/truth-display.ts#parsePendingHooks` cards), **Chapter Summaries** (8-column table). Technical fields displayed but marked system-managed (per V1_SPEC §43).
- Do NOT invent timeline/relationship/clue/secret models (audit §3.9: none exist).
- Tests-first: `pages/story-state/StoryStatePage.test.tsx` — renders mocked canon; hooks table shows promoted column; empty-state for missing sections.
- Verify: STUDIO-F(StoryStatePage) + `pnpm --filter @actalk/castor-studio build`.

### Phase 3 — Safe manual current-state editing (C, D, K) — FINAL AMENDED DESIGN (risk: MEDIUM; P3A persistence/reconciliation elevated)

> **AMENDMENT NOTE (final approved design; supersedes original T3.1–T3.7 after independent design review + source inspection):** origin/provenance field dropped entirely · effective position = **durable contiguous progress + 1**, never manifest alone · live fact replacement follows the existing reducer splice convention (closed rows are NEVER accumulated in live `current_state.json`) · global `validateRuntimeState` unchanged; an **edit-local** validator protects only the mutation path · deterministic **revision fingerprint** + optimistic concurrency (`canon_conflict`) added · existing `acquireBookLock` reused — no second locking mechanism · snapshots join the **same atomic integrity transaction** as Canon/projections · single shared pure snapshot contract (`state/snapshot-set.ts`) with `snapshotStateAt` delegating to it · the side-effecting snapshot pre-step was REMOVED (all preparation is in-memory) · memory sync extracted (`state/memory-sync.ts`) · origin-based history merge replaced by live-current-truth reconciliation · derived-memory failure invalidation added · Phase split into **P3A (Core engine)** → **P3B (Studio experience)**, reviewed separately · Save is the ONE and ONLY user confirmation · chapter-summary and hook editing excluded from P3 scope (deferred V1 work).

#### P3A — Core Canon Mutation Engine

**T3A.1 Core edit contract.**
- Files: CREATE `packages/core/src/models/canon-edits.ts`; MODIFY `packages/core/src/index.ts` (exports).
- Interface (Core owns the runtime Zod schemas AND TypeScript types):
  ```ts
  CanonEditSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("setFact"), subject: z.string().trim().min(1),
               predicate: z.string().trim().min(1), object: z.string().trim().min(1) }),
    z.object({ kind: z.literal("removeFact"), subject: z.string().trim().min(1),
               predicate: z.string().trim().min(1) }),
  ]);
  CanonCommitRequestSchema = z.object({
    edits: z.array(CanonEditSchema).min(1),
    expectedRevision: z.string().min(8),
  });
  ```
  No raw whole-state replacement, filesystem paths, hook operations, chapter-summary operations, or origin/provenance fields. Studio server later imports these schemas AT RUNTIME; the browser client uses TYPE-ONLY imports where package constraints require (the exports map keeps the core main entry out of browser bundles).
- Tests-first: CREATE `src/__tests__/canon-edits.test.ts` §contract — parses both kinds; rejects unknown kind, empty/whitespace fields, extra keys; envelope rejects empty edits and short revision. RED reason: module does not exist.
- Verify: CORE-F(canon-edits).

**T3A.2 Manual-edit reducer (E = durable progress + 1).**
- Files: MODIFY `packages/core/src/state/state-reducer.ts`; CREATE `src/__tests__/state-reducer.manual-edit.test.ts`.
- Interface: `applyManualCurrentStateEdits(params: { snapshot: RuntimeStateSnapshot; edits: CanonEdit[]; effectiveChapter: number }): RuntimeStateSnapshot` — PURE.
- Semantics (amended D4): semantic identity = `subject::predicate` with slot-alias normalization REUSED from `state-projections.ts#CURRENT_STATE_SLOT_DEFS` aliases (case-insensitive match; canonical stored form kept). `setFact` SPLICES every ACTIVE row matching the key (existing reducer splice convention — no historical closed rows accumulate in live JSON) and appends `{subject, predicate, object, validFromChapter: E, validUntilChapter: null, sourceChapter: E}`; `removeFact` splices matching active rows only. Never mutates manifest/hooks/chapterSummaries/`currentState.chapter`. Idempotent on repeated identical `setFact`.
- Effective-chapter rule (authoritative): `N = resolveDurableStoryProgress(bookDir)`; `E = N + 1`. Example pinned by tests: durable progress 15, Elara age 22 → setFact 23 ⇒ new live row `validFromChapter = 16, validUntilChapter = null, sourceChapter = 16`; previous prose chapters 1–15 remain byte-identical. An inflated manifest must NOT move E.
- Tests-first: chapters-1..15 fixture: setFact age 23 at E=16 ⇒ live contains exactly one age row (open, from 16) and NO closed row; removeFact drops rows; double-set idempotent; alias predicate ("Current Location" vs canonical slot form) resolves to the same key; deep-frozen input not mutated; unrelated additional facts untouched. RED reason: function missing.
- Verify: CORE-F(state-reducer.manual-edit).

**T3A.3 Single snapshot contract (pure helper + snapshotStateAt delegation).**
- Files: CREATE `packages/core/src/state/snapshot-set.ts`; MODIFY `packages/core/src/state/manager.ts#snapshotStateAt` (delegation only — behavior-preserving refactor).
- Interface: `SNAPSHOT_STORY_FILE_NAMES` (the existing fixed 7 story markdown slots), `buildSnapshotFileSet(bookDir, chapterNumber): Promise<Array<{relativePath, content}>>` (READS ONLY — returns intended writes; skip-if-source-missing parity with today's behavior; mirrors EVERY file under `story/state/`), `isSnapshotComplete(bookDir, chapterNumber)` (set-equality against the derivable contract).
- Drift rule: `snapshotStateAt` writes exactly the helper's returned files (per-file mkdir preserved). There must NOT be one independently maintained 7-file list inside `manager.ts` and another inside `snapshot-set.ts`.
- Tests-first: CREATE `src/__tests__/snapshot-set.test.ts` — golden parity: helper-intended set ≡ tree produced by `snapshotStateAt` (file names + bytes) on fixtures including an absent source slot and an extra unexpected `story/state` file; completeness flags. RED reason: module missing. After delegation, `state-manager.test.ts` must stay green unchanged (behavior-preservation proof).
- Verify: CORE-F(snapshot-set) + CORE-F(state-manager).

**T3A.4 Revision fingerprint, edit-local validation, conflict error.**
- Files: MODIFY `packages/core/src/state/canon-service.ts`; MODIFY `packages/core/src/index.ts` exports.
- Interface:
  - `computeCanonRevision(snapshot): string` — SHA-256 (16 hex) over a recursively KEY-SORTED canonical serialization of all FOUR validated documents; deterministic; independent of JSON whitespace and object-key ordering; pure; zero filesystem writes.
  - `validateCanonEditedState(before, after, effectiveChapter): RuntimeStateValidationIssue[]` — EDIT-LOCAL ONLY (global `validateRuntimeState` untouched): ≤1 OPEN row per `subject::predicate`; temporal ordering (`validUntilChapter ≥ validFromChapter` when closed); every edited open row has `validFromChapter === effectiveChapter`; manifest/hooks/chapterSummaries/`currentState.chapter` deep-unchanged vs before. Rationale: legacy/bootstrap books can legitimately carry structures a stricter GLOBAL validator would reject (tolerant-parse precedent) — shared pipeline acceptance must not change in P3.
  - `class CanonConflictError extends Error { readonly code = "canon_conflict" }`.
  - `readStoryCanon` views gain an additive computed `revision` field (no writes).
- Tests-first (canon-edits.test.ts §revision/§validation): same semantics with reformatted/reordered JSON files ⇒ EQUAL revision; semantic change ⇒ DIFFERENT revision; each invariant violation produces a named issue; regression guard — a legacy book carrying duplicate open rows still passes the GLOBAL `validateRuntimeState` (proves shared acceptance unchanged).
- Verify: CORE-F(canon-edits).

**T3A.5 Preview + atomic commit engine (zero side-effect preparation; one integrity transaction).**
- Files: MODIFY `packages/core/src/state/canon-service.ts`; extend `src/__tests__/canon-edits.test.ts`.
- Interfaces:
  - `previewCanonEdits(bookDir, edits): Promise<{before, after, effectiveChapter, closedFacts, warnings, revision}>` — pure compute over the pure read; ZERO filesystem effects.
  - `commitCanonEdits(bookDir, request: CanonCommitRequest, deps?): Promise<CommitResult>`; injectable `deps` = `{renameFile?, rebuildNarrativeMemoryIndex?, rebuildCurrentStateFactHistory?, invalidateDerivedMemory?}` (test seams only).
- LOCK OWNERSHIP (explicit, not ambiguous): the CALLER must hold `StateManager.acquireBookLock(bookId)` for the ENTIRE sequence — the Studio server owns lock orchestration in P3B; pipeline callers hold their own. TSDoc states this requirement; Core introduces no second locking mechanism.
- Sequence: pure read (`readStoryCanon` — never bootstraps; missing/corrupt ⇒ `CanonUnavailableError`) → `computeCanonRevision(current)` ≠ `request.expectedRevision` ⇒ throw `CanonConflictError` (ZERO writes) → `E = resolveDurableStoryProgress(bookDir) + 1` → apply edits → `validateRuntimeState(after)` + `validateCanonEditedState(...)` → render `current_state.md` via `renderCurrentStateProjection(after.currentState, manifest.language)` → assemble the write list IN MEMORY: live `story/state/current_state.json` + regenerated `story/current_state.md` + snapshot mirrors `story/snapshots/N/state/current_state.json` + `story/snapshots/N/current_state.md`; if `isSnapshotComplete(bookDir, N)` is false, overlay those two entries onto the COMPLETE `buildSnapshotFileSet(bookDir, N)` reconstruction (still in memory) → **ONE `commitAtomicFileSet({ rootDir: bookDir, writes, renameFile? })`** covering every integrity-boundary target. `saveRuntimeStateSnapshot` is deliberately NOT used (four independent writes = partial-write risk). There is NO `snapshotStateAt` call, NO writeFile/mkdir materialization, NO bootstrap, and NO projection write before the transaction. → extracted memory fns (T3A.6) with failure handling (T3A.8) → return `{appliedEdits, closedFacts, effectiveChapter, previousRevision, revision: computeCanonRevision(after), warnings}`.
- Tests-first (canon-edits.test.ts §preview/§commit): preview purity via sha+len+mtime metadata capture; happy path asserts exact bytes of live JSON, projection equality with renderer output, and BOTH snapshot mirrors; inflated-manifest fixture (durable 15, manifest claims 20) ⇒ E = 16; missing/incomplete snapshot N ⇒ complete reconstruction created inside the transaction; stale `expectedRevision` ⇒ `CanonConflictError` and ALL project files hash+len+mtime identical; missing/corrupt canon ⇒ `CanonUnavailableError`, nothing written; injected `renameFile` failure at the LIVE-target stage AND at the SNAPSHOT-target stage ⇒ every touched path in BOTH trees unchanged, no `.castor-file-txn-*` residue, no partial snapshot remains; spy/module assertions prove NO `snapshotStateAt` or other mutating preparatory call precedes the transaction.
- Verify: CORE-F(canon-edits).

**T3A.6 Memory/fact-history sync extraction (behavior-preserving).**
- Files: CREATE `packages/core/src/state/memory-sync.ts`; MODIFY `packages/core/src/pipeline/runner.ts` (private bodies → delegating wrappers; call sites unchanged).
- Exports: `rebuildCurrentStateFactHistory(bookDir, uptoChapter)`, `rebuildNarrativeMemoryIndex(bookDir)` — moved verbatim, including the SQLITE_BUSY retry ladder and the `subject::predicate` factKey convention.
- Tests-first: `src/__tests__/memory-sync.test.ts` ports representative cases from `pipeline-runner-memory-sync.test.ts` against the MODULE (RED: module missing); after extraction `pipeline-runner-memory-sync.test.ts` expectations must remain byte-for-byte green (extraction altered nothing).
- Verify: CORE-F(memory-sync) + CORE-F(pipeline-runner-memory-sync).

**T3A.7 Live-truth reconciliation (manual facts in derived history).**
- Files: MODIFY `packages/core/src/state/memory-sync.ts#rebuildCurrentStateFactHistory`.
- Behavior (no origin field; no second history store; memory.db stays derived): after replaying snapshots 0..N, reconcile every OPEN row of LIVE `current_state.json` — force its interval to `[row.validFromChapter, null]`, closing any conflicting replayed interval at `row.validFromChapter` (the exclusive-`valid_until_chapter` convention of `memory-db.ts`). Live open truth is authoritative for the present; replay owns the past; healthy books reconcile to a no-op.
- Tests-first: `src/__tests__/fact-history-manual.test.ts` — (a) chapters 1–15 age 22 + manual edit after 15 ⇒ derived lookup at chapter 15 yields 22, at 16 yields 23; (b) a later story-settled value correctly supersedes; (c) GOLDEN: replay WITHOUT manual edits produces output identical to pre-change behavior. RED reason: reconciliation pass absent ⇒ (a) misattributes intervals, (c) exposes divergence.
- Verify: CORE-F(fact-history-manual) + CORE-F(pipeline-runner-memory-sync).

**T3A.8 Derived-memory failure safety.**
- Files: MODIFY `packages/core/src/state/memory-sync.ts` (`invalidateDerivedMemory(bookDir, io?)`) + commit wiring in T3A.5.
- Behavior: memory sync succeeds ⇒ rebuilt DB is used normally. Sync FAILS ⇒ canonical persistence is NEVER rolled back; attempt invalidation of `memory.db`, `memory.db-shm`, `memory.db-wal` using the existing deletion precedent (`rollbackToChapter`); if deletion fails (e.g., open handle), quarantine-rename where possible; if BOTH mechanisms fail, push the EXACT warning `"derived memory invalidation failed; memory.db may be stale"` into `CommitResult.warnings` and claim NOTHING about guaranteed inaccessibility. Impact nuance (verified): P3 current-fact retrieval for future writer context reads LIVE structured `current_state.json` directly (`utils/memory-retrieval.ts`), so residual stale derived memory cannot contradict the saved fact leg.
- Tests-first: forced sync rejection ⇒ DB trio actually removed; injected io failures ⇒ quarantine engaged / exact warning emitted; Canon + projection + snapshot untouched throughout.
- Verify: CORE-F(canon-edits).

**T3A.9 Deterministic future-writer integration proof.**
- Files: CREATE `src/__tests__/canon-edit-writer-context.integration.test.ts` (implemented as `canon-writer-proof.test.ts`).
- Fixture: durable progress 15, Elara age 22 (real chapter files 0001..0015 + snapshot chain + memory.db). Commit `setFact Elara/age/23` with the correct `expectedRevision`. Assert — NO external LLM/API call: (1) live `current_state.json` contains 23; (2) live `current_state.md` contains 23 and equals `renderCurrentStateProjection` over the persisted state with no stale active 22; (3) `snapshots/15/state/current_state.json` mirrors corrected Canon with `validFromChapter = 16`; (4) rebuilt historical lookup at chapter 15 ⇒ 22; (5) next-chapter/current selection at 16 ⇒ 23; **(6) VERIFIED PRODUCTION PATH — the next-writer narrative selected context for chapter 16 must contain 23 and no stale active 22**: real `retrieveMemorySelection({bookDir, chapterNumber:16, …})` reads LIVE structured canon and ranks against the memory index the commit just rebuilt → Composer's exact selectedContext fact-entry mapping (`source: story/current_state.md#<predicate-anchor>`, `` excerpt: `${predicate} | ${object}` ``) → `renderNarrativeSelectedContext` embeds all selectedContext verbatim into the Writer prompt (`writer.ts`); (7) chapters 0001..0015 byte-identical; (8) Canon revision changed.
- Note: `buildGovernedMemoryEvidenceBlocks` currently does NOT select `story/current_state.md` fact entries (its filters cover hooks/debt/summaries/volume/trail/parent-or-fanfic canon only), so routing facts through that helper would require a separate approved production change and is NOT part of P3A.
- Verify: CORE-F(canon-edit-writer-context.integration).

**▶ CHECKPOINT P3A:** Core Canon mutation engine complete and independently reviewed. STOP. No Studio mutation surface may exist yet (the read-only viewer stays untouched).

#### P3B — Studio Canon Editing Experience (NOT begun until P3A review passes)

**T3B.1 Server mutation routes.**
- Files: MODIFY `packages/studio/src/api/server.ts`; CREATE `src/__tests__/canon-edits-route.test.ts`.
- Routes: `POST /api/v1/books/:id/canon/current-state/preview` and `POST /api/v1/books/:id/canon/commit`. Bodies validated with CORE's `CanonCommitRequestSchema` imported at runtime (single semantic source; browser client uses type-only imports). Lock-owning orchestration lives HERE: `state.acquireBookLock(id)` wraps pure read → revision check → commit → memory sync. Error mapping: Zod/edit issues ⇒ 400 `{error, issues}` (human-readable, V1_SPEC §42); `CanonConflictError` ⇒ 409 `{code: "canon_conflict", currentRevision}`; `CanonUnavailableError` ⇒ 409 `{code: "canon_unavailable"}` (P2 semantics); lock held ⇒ 409 `{code: "book_write_locked"}`; unknown book ⇒ 404. GET `/canon` responses gain the additive `revision` field.
- Tests-first: preview payload; commit round-trip on fixture book incl. refreshed snapshot; second commit with stale revision ⇒ conflict + zero mtime changes; invalid edit ⇒ issues list + zero mtime changes; unknown book ⇒ 404. RED reason: routes absent.
- Verify: STUDIO-F(canon-edits-route).

**T3B.2 One-confirmation Story State editing UI.**
- Files: MODIFY `packages/studio/src/pages/story-state/StoryStatePage.tsx`, `pages/story-state/story-state-model.ts`, `lib/canon-api.ts`; type-only Core imports for edit types.
- UX (BINDING): inline edit/add/remove on slot fields + additional facts → **Save posts the commit request directly; Save is the ONE and ONLY user confirmation.** NO preview dialog and NO second Confirm action; automatic/debounced validation MAY surface warnings inline but must never gate Save behind another click. Validity integers, manifest, and system-managed fields render READ-ONLY (V1_SPEC §43). Errors/conflicts render inline issue lists; success refetches (fresh revision).
- Explicitly out of scope: chapter-summary editing, hook editing (hooks arrive with T6.5), any post-chapter review workflow.
- Tests-first: model-layer edit-collection→payload specs + route-level coverage (jsdom/.tsx test harness unavailable in this repo — standing disclosed deviation from plan-default UI testing).
- Verify: STUDIO-F(canon-edits-model) + `pnpm --filter @actalk/castor-studio build`.

**▶ CHECKPOINT P3B:** Studio API + editing UI complete and independently reviewed. STOP. Only then does Phase 4 consume this commit engine (T6.1 `confirmChapterState` reuses the same atomic live+snapshot pattern).

#### P3.1 — Semantic No-op Canon Commit Hardening (bounded Core patch; design APPROVED, NOT begun)

**Root cause.** `applyManualCurrentStateEdits` (`state-reducer.ts`) sorts the fact array unconditionally at the end of every manual-edit application. A semantic no-op — e.g. `removeFact(nonexistent)` — can therefore reorder `current_state.json` and advance the Canon revision although no author-facing state changed. The revision hashes the FOUR structured Canon documents; the markdown projection is NOT part of the revision, and manifest normalization is not involved.

**P3.1 semantics.** Manual editing modifies AUTHOR-FACING CURRENT STORY MEANING; temporal provenance is not user input. Same-value `setFact` is therefore a semantic no-op: existing `age=23` + `setFact age 23` ⇒ no-op, no temporal re-anchor, revision unchanged, zero filesystem writes, zero memory sync. `removeFact` on a missing / currently-unasserted key ⇒ no-op.

**Sequential classification (MANDATORY — original-state classification is UNSAFE for ordered batches).** Classify edits IN REQUEST ORDER against a lightweight shadow model containing OPEN/current semantic facts only; key = `subject + resolveFactPredicateKey(predicate)`.
- `setFact(key,value)`: if the shadow holds exactly one unambiguous active assertion whose value equals the requested value ⇒ NO-OP (shadow unchanged); otherwise EFFECTIVE (`shadow[key] = requested value`).
- `removeFact(key)`: if no active assertion ⇒ NO-OP (shadow unchanged); otherwise EFFECTIVE (`shadow.delete(key)`).
- Preserve the original relative order of effective edits; pass ONLY effective edits through the existing reducer.
- Regression examples (initial `age=23`): `[set24,set23]` ⇒ both effective, final 23 · `[remove,set23]` ⇒ both effective, final 23 · `[set23,set24]` ⇒ first no-op/second effective, final 24 · `[set24,remove]` ⇒ both effective, final absent.

**Legacy / ambiguous state.** Closed historical rows are invisible to the current-meaning shadow: only-closed key + `removeFact` ⇒ semantic no-op, historical bookkeeping unchanged. Same-value `setFact` is a no-op ONLY when the active state is unambiguous (exactly one open row matching). Multiple OPEN rows per key — duplicate same-value OR conflicting — must NOT be classified no-op; route through the effective/normal validation path. No-op detection must not silently bless malformed legacy state; global repair behavior is not redesigned.

**Secondary semantic comparator.** After reducer preview and before write assembly, retain an order-insensitive semantic comparator as defense-in-depth over all four structured documents: object keys canonicalized as existing revision logic does; `currentState.facts` treated as an order-insensitive multiset of canonical rows; everything else strict. Fact-array order is non-semantic for this comparison ONLY — do NOT globally sort or rewrite stored fact arrays.

**Pure no-op result.** Every edit a semantic no-op ⇒ `revision` = existing revision unchanged · `appliedEdits = []` · `effectiveChapter` = normal durable-progress+1 · `warnings = []`; structurally ZERO Canon / projection / snapshot writes, ZERO derived-memory synchronization, ZERO bootstrap/manifest-normalization side effects.

**Mixed result.** Discard no-op operations, pass effective edits (original order) to the existing reducer, ONE normal atomic commit, `appliedEdits` contains effective edits only. No new API response variant; NO Studio changes required.

**RED-first test matrix** (`canon-commit.test.ts`; whole-filesystem sha256+size+mtime equality asserted on every no-op case):
1. removeFact(nonexistent) → A→A, appliedEdits=[] ; 2. setFact(existing same value) → A→A, validFrom/source unchanged ; 3. setFact(existing different value) → A→B with normal E re-anchor ; 4. setFact(absent key) → real commit ; 5. removeFact(existing OPEN key) → real commit ; 6. [set24,set23] both effective, final 23 ; 7. [remove,set23] both effective, final 23 ; 8. [set23,set24] only set24 applied ; 9. [set24,remove] both applied, final absent ; 10. only-CLOSED key + remove ⇒ pure no-op/zero writes ; 11. duplicate/conflicting OPEN rows + same-value set ⇒ NOT prematurely skipped ; 12. deliberately unsorted facts + pure no-op ⇒ zero reorder, zero writes ; 13. pure no-op: `rebuildNarrativeMemoryIndex`, `rebuildCurrentStateFactHistory`, `invalidateDerivedMemory` are NOT called.

**Files/scope.** Touch ONLY `packages/core/src/state/canon-service.ts` + `packages/core/src/__tests__/canon-commit.test.ts` (additional test helper only if source inspection proves strictly required). Do NOT change reducer behavior, schemas, revision format, effectiveChapter semantics, lock ownership, Studio, language/migration, Phase 4, or global fact ordering.

**▶ CHECKPOINT P3.1:** Semantic no-op hardening complete. STOP. Independent review required before Phase 4.

> **⚠️ SUPERSEDED (2026-08-24):** Phases 4–6 task sketches below (T4.1–T6.x) are
> SUPERSEDED by the approved design spec
> `docs/superpowers/specs/2026-08-24-human-governed-post-chapter-state-review-design.md`
> and its implementation plan
> `docs/superpowers/plans/2026-08-24-human-governed-post-chapter-state-review.md`.
> They remain as historical context only — reconcile EVERYTHING against the spec
> (three concurrency anchors, workflow shells, resolved receipts, evidence
> verification, idempotent confirm, advancement gate ≤). Do not implement T4/T5/T6
> as written.

### Phase 4 — Post-chapter state-review domain model (E, G, H) (risk: HIGH — touches saveChapter/persist path)

**T4.1 Proposal artifact schema.**
- Files: CREATE `packages/core/src/models/state-review.ts`; barrel export.
- Schema: `StateReviewArtifactSchema = {schemaVersion: z.literal(1), chapter, createdAt, baseLastAppliedChapter, language, originalDelta: RuntimeStateDeltaSchema, items: StateReviewItemSchema[]}`; item: `{id, kind: "currentStatePatch"|"hookUpsert"|"hookMention"|"hookResolve"|"hookDefer"|"newHookCandidate"|"chapterSummary"|"note", title, detail?, evidence?: {quote: string}, decision: "pending"|"accepted"|"edited"|"rejected", editedValue?: unknown}`.
- Stable ids: deterministic `${kind}:${opIndex}:${fnv1a-8(JSON.stringify(payload))}` (pure helper exported for tests/UI).
- Tests-first: `src/__tests__/state-review-schema.test.ts` — round-trip; SAME delta ⇒ identical ids across builds (order-insensitive within arrays is NOT required — document order-sensitivity); rejecting unknown kind.
- Verify: CORE-F(state-review-schema).

**T4.2 Proposal builder + evidence heuristic (H).**
- Files: CREATE `packages/core/src/pipeline/state-review.ts`; CREATE `src/__tests__/state-review-build.test.ts`.
- Interface: `buildStateReviewArtifact({chapter, language, baseLastAppliedChapter, delta, chapterContent}): StateReviewArtifact` — maps delta pieces to items (patch slots → currentStatePatch items titled by slot label; hookOps upsert/mention/resolve/defer; newHookCandidates; chapterSummary; notes), computes `evidence.quote` by normalized substring search of `object`/value/notes text within `chapterContent` (≤200 chars, miss ⇒ omit), derives human `title` strings.
- Reuse: slot labels from `state-projections.ts` layout tables (zh/en aware via `language`).
- Tests-first: crafted delta + prose ⇒ expected items/ids/evidence; Vietnamese and English samples both quoted; no false evidence when text absent.
- Verify: CORE-F(state-review-build).

**T4.3 Deferred save mode in WriterAgent.saveChapter (E core).**
- Files: MODIFY `packages/core/src/agents/writer.ts` (`saveChapter` signature += `options?: {deferStateApplication?: boolean; stateReviewJson?: string}`); CREATE `src/__tests__/writer.deferred-save.test.ts`.
- Behavior when `deferStateApplication`: atomic set = chapter md (+ superseded-title deletes as today) + `story/runtime/chapter-NNNN.state-review.json` (content = `stateReviewJson`); ALL state/projection/board writes skipped (including legacy `updated*` fields); runtime artifacts resolution bypassed.
- Tests-first (fail first): gated save leaves `story/state/*.json` and `current_state.md` byte-identical (pre-captured hashes); proposal file exists and validates against T4.1; ungated call unchanged (existing `writer.test.ts` suite stays green); simulated mid-set failure (mock commitAtomicFileSet throwing after rename stage) restores prior state (leverages existing atomic rollback).
- Verify: CORE-F(writer.deferred-save) + CORE-F(writer).

**T4.4 Pipeline plumbing for gated writes.**
- Files: MODIFY `packages/core/src/pipeline/runner.ts` `_executeNextChapterLocked` (:1996) + `prepareWriteInput` (:3260) call sites; CREATE `src/__tests__/pipeline-runner.gated.test.ts` using the existing LLM stub harness (`agent/llm-stub.ts`) patterns from `pipeline-runner.test.ts`.
- Flow: when `resolveChapterStateReviewMode(...)==="gate"` (T5.1) ⇒ after writer output, `artifact = buildStateReviewArtifact({delta: output.runtimeStateDelta …})` (T4.2) → `writer.saveChapter(..., {deferStateApplication:true, stateReviewJson: JSON.stringify(article)})` → persistence proceeds with `saveTruthFiles` SKIPPED (flag threaded through `persistChapterArtifacts` params, `pipeline/chapter-persistence.ts`) → index status `needs-state-review` (T5.2) → `.run.json` status mapping.
- Tests-first: stubbed full write on gated book ⇒ prose persisted, canon hash unchanged, artifact parses, status set, `snapshotState` NOT advanced (persistence-order assertion); ungated book behaves exactly as today (regression subset).
- Verify: CORE-F(pipeline-runner.gated) + CORE-F(pipeline-runner).

**T4.5 Legacy settlement → delta adapter (D9).**
- Files: CREATE `packages/core/src/agents/settler-legacy-adapter.ts`; CREATE `src/__tests__/settler-legacy-adapter.test.ts`.
- Interface: `legacySettlementToDelta(settlement, chapter): RuntimeStateDelta | null` — map UPDATED_STATE table rows via the alias normalization from `state-bootstrap.ts#parseCurrentStateFacts` (export a reusable row-normalizer if needed), UPDATED_HOOKS rows via the `parsePendingHooksMarkdown` row mapper, summaries via `parseChapterSummariesMarkdown` row shape; unmappable remnants ⇒ `null`.
- Tests-first: table-driven conversions; partial remnant ⇒ null; null ⇒ caller falls back to direct apply + `logger.warn` (assert log).
- Verify: CORE-F(settler-legacy-adapter).

**T4.6 Proposal (re)generation command.**
- Files: MODIFY `packages/core/src/pipeline/runner.ts` (+ method `regenerateStateReview(bookId, chapter)`); CREATE `src/__tests__/state-review-regenerate.test.ts`.
- Reuse: `ChapterAnalyzerAgent.analyzeChapter` (already re-runs Observer/Settler on saved prose) → capture returned delta → `buildStateReviewArtifact` → atomically replace artifact (single-file tmp+rename acceptable; artifact is recoverable queue state, and `production/harness.ts` pattern noted).
- Recovery semantics: missing/corrupt artifact while status=`needs-state-review` ⇒ regenerate yields equivalent proposals; original decisions lost (documented — decisions live only until resolution).
- Tests-first: delete artifact ⇒ regenerate ⇒ parses & items non-empty; corrupt JSON ⇒ regenerate; ungated chapter ⇒ clear error.
- Verify: CORE-F(state-review-regenerate).

### Phase 5 — Pipeline state-review gate (F) (risk: HIGH — lifecycle semantics across entry points)

**T5.1 Gate configuration resolver.**
- Files: MODIFY `packages/core/src/models/project.ts` (`writing.stateReview: z.enum(["gate","off"]).default("gate")` inside WritingConfigSchema) and `models/book.ts` (`BookConfigSchema.writing.stateReview` optional override); ADD `resolveChapterStateReviewMode(book, projectWriting)` mirroring `resolveChapterReviewMode` (:83-88).
- Tests-first: `src/__tests__/state-review-mode.test.ts` — precedence book > project > default("gate"); legacy configs without the field ⇒ "gate".
- Verify: CORE-F(state-review-mode).

**T5.2 Status enum additions.**
- Files: MODIFY `packages/core/src/models/chapter.ts` (`ChapterStatusSchema` += `"needs-state-review"`) and `packages/core/src/production/harness.ts` (`ProductionRunStatus` += same).
- Tests-first: extend `state-manager.test.ts` — index JSON containing the new status round-trips through load/save; `rebuildChapterIndexFromFilesAt` still defaults unknown/new files to `ready-for-review`.
- Verify: CORE-F(state-manager).

**T5.3 Generate-next refusal.**
- Files: MODIFY `packages/core/src/pipeline/runner.ts` — new guard `assertNoPendingStateReview(index, nextChapterNumber)` placed adjacent to `assertNoPendingStateRepair` (:3244) inside `_executeNextChapterLocked`; error message names the blocking chapter and the resolution commands.
- Tests-first (in `pipeline-runner.gated.test.ts`): previous chapter `needs-state-review` ⇒ `writeNextChapter` throws with actionable message; after T6.1 confirm ⇒ proceeds (integration asserted in Phase 6 suite).
- Verify: CORE-F(pipeline-runner.gated).

**T5.4 Daemon/auto behavior.**
- Files: MODIFY `packages/cli/src/commands/auto.ts` (batch break condition alongside the state-degraded check, `write.ts:82` area) and `packages/core/src/pipeline/scheduler.ts` (classify the refusal as a pausable condition emitting webhook event `state-review-required`, distinct message, counting toward the existing consecutive-failure pause).
- Tests-first: extend `cli/src/__tests__/auto-command.test.ts` + scheduler tests — gated stop surfaces clearly; `stateReview:"off"` book proceeds automatically (D6 escape hatch verified end-to-end with stub).
- Verify: CLI-F(auto-command) + CORE-F(scheduler).

**T5.5 Interaction matrix.**
- Files: MODIFY `packages/core/src/pipeline/runner.ts` methods `reviseDraft` (:1350), `resyncChapterArtifacts` (:2513), `_repairChapterStateLocked` (:2387); CREATE `src/__tests__/state-review-interactions.test.ts`.
- Rules: revise of a `needs-state-review` chapter ⇒ throw `ChapterStateReviewPendingError` BEFORE any LLM/write; resync on gated chapter ⇒ T4.6 regeneration instead of direct settle; repair-state on gated chapter ⇒ proposal regeneration only; `review reject`(rollback) / `deleteLatestChapter` sweep artifact + restore prior status (existing sweep behavior — assert, don't implement).
- Tests-first: one case per rule, each asserting "no canon writes occurred" (hash compare) alongside the expected outcome.
- Verify: CORE-F(state-review-interactions) + CORE-F(reviser) + CORE-F(chapter-delete).

### Phase 6 — Review operations, canon commit, Studio review UX (G, I) (risk: HIGH — commit correctness; UI parts MEDIUM)

**T6.1 Confirm/reject core commands (I).**
- Files: MODIFY `packages/core/src/pipeline/runner.ts` (+ `confirmChapterState(bookId, chapter, decisions)` and `rejectChapterState(bookId, chapter, reason?)`); CREATE `src/__tests__/state-review-confirm.test.ts`.
- Confirm steps: load artifact → apply decisions onto a COPY of `originalDelta` (reject ⇒ drop op; edit ⇒ replace payload value; accepted ⇒ keep; addMissing ⇒ append user-authored op — no provenance marker, per amended D5) → `arbitrateRuntimeStateDeltaHooks` (same allowNewHooks posture as today's write path) → base = `loadRuntimeStateSnapshot` (== pre-chapter state per D1) → `applyRuntimeStateDelta` → `validateRuntimeState` → safety-net `StateValidatorAgent.validate` (failure ⇒ abort, artifact retained, nothing written) → **ONE `commitAtomicFileSet`** {4 state JSONs + 3 freshly rendered projections} → index status `"approved"` (D3) → `snapshotStateAt(N)` → extracted `memory-sync` fns (T3A.6) → delete artifact → webhook `state-committed`.
- Reject-all: zero canon writes; status `"approved"`; artifact deleted; reason appended to chapter `reviewNote`.
- Tests-first: happy path asserts canon advanced exactly per accepted set; edited value lands VERBATIM; rejected hookUpsert absent from `hooks.json`; addMissing fact present verbatim; projections byte-equal renderer output; snapshot N contains new state; fact-history intervals correct; artifact gone; validator-abort writes nothing; crash simulation (throw between validate and commit) leaves everything intact.
- Reuse: everything listed; NO new persistence primitives.
- Verify: CORE-F(state-review-confirm) + CORE-F(runtime-state-store) + CORE-F(pipeline-runner).

**T6.2 Decision persistence endpoint (G durability).**
- Files: MODIFY `packages/core/src/pipeline/runner.ts` (+ `saveStateReviewDecisions(bookId, chapter, items)` — updates `items[].decision/editedValue` in the artifact, tmp+rename single-file write); MODIFY `server.ts` routes: `GET /books/:id/chapters/:n/state-review`, `PUT .../state-review/decisions`, `POST .../state-review/confirm`, `POST .../state-review/reject`, `POST .../state-review/regenerate`.
- Tests-first: `canon-review-route.test.ts` — toggle decision ⇒ GET reflects it AFTER simulated server restart (fresh `createStudioServer` on same root — proves disk persistence, V1_SPEC G requirement); confirm executes T6.1; regenerate recovers deleted artifact.
- Verify: STUDIO-F(canon-review-route).

**T6.3 Studio review experience.**
- Files: CREATE `packages/studio/src/pages/story-state/ChapterStateReview.tsx`; MODIFY `ChapterWorkspacePanel.tsx`/`BookDetail.tsx` (badge + entry when status `needs-state-review`; BookDetail row action).
- UI: grouped item cards (patch slots / hooks / summary / notes); per-item Accept / Edit (inline value editor constrained to the payload's own fields) / Reject; evidence badge "Explicit in prose" (H) and reject-confirmation warning modal with **Reject Anyway / Edit Chapter / Cancel**; `[+ Add Missing State Change]` mini-form (fact set / hook upsert / note); Confirm enabled only when no `pending` items remain → diff preview → POST confirm → status chip READY; every toggle PUTs decisions immediately (reload-safe).
- Tests-first: `ChapterStateReview.test.tsx` — mocked API flows incl. reload mid-review (decisions restored from GET), evidence-warning modal on evidenced reject, add-missing lands as item, confirm disabled while pending.
- Verify: STUDIO-F(ChapterStateReview).

**T6.4 CLI parity commands (minimal).**
- Files: MODIFY `packages/cli/src/commands/review.ts` (+ `castor review state [book] [chapter]` listing proposals, `--accept-all/--reject-all` flags delegating to runner commands) — keeps CLI valuable without duplicating UI (vision §26).
- Tests-first: `cli/src/__tests__/review-state-command.test.ts` with stubbed runner.
- Verify: CLI-F(review-state-command).

**T6.5 Manual hook adjustments (completes C for hooks).**
- Files: MODIFY `packages/core/src/state/canon-service.ts` (+ `previewHookEdits`/`commitHookEdits(bookDir, hookOps)` reusing `arbitrateRuntimeStateDeltaHooks` + `renderHooksProjection` + the T3A.5 commit pattern); MODIFY `StoryStatePage.tsx` hooks tab (status change, notes edit, add hook — system fields like `startChapter` auto-filled, `hookId` auto-generated via existing ledger-validator charset).
- Tests-first: `canon-hook-edits.test.ts` (core) + `StoryStatePage.hooks.test.tsx` (UI).
- Verify: CORE-F(canon-hook-edits) + STUDIO-F(StoryStatePage.hooks).

**▶ CHECKPOINT C2 (after Phase 6):** full loop on a real book with a real model — generate gated chapter → review → accept some/edit one/reject one/add one missing → confirm → inspect `story/state`, projections, `snapshots/N`, memory.db facts → next chapter generation reflects confirmed canon; restart Studio mid-review and resume.

### Phase 7 — Overwrite/rebuild hardening (J, R) (risk: MEDIUM overall; T7.2 HIGH)

Mostly a TEST-DOMINANT phase; fixes only where a test exposes a gap.

**T7.1 Bootstrap/restore interaction matrix.**
- Files: CREATE `src/__tests__/canon-overwrite-matrix.test.ts`.
- Cases (each asserts exact survivorship): (a) valid JSON + manual facts ⇒ bootstrap no-op; (b) corrupted `current_state.json` ⇒ rebuild-from-markdown loses manual facts → **documented limitation**, then `restoreState(snapshot N)` recovers them (manual facts were snapshotted at commit/edit) — assert recovery path; (c) legacy no-delta settlement on gated book ⇒ T4.5/D9 fallback (direct apply + warn + status stays non-gated) ; (d) `rollbackToChapter(k<N)` removes proposals & statuses (sweep regression); (e) projection regeneration idempotence: `render(parse(render(x))) === render(x)` for all three renderers × zh/en.
- Verify: CORE-F(canon-overwrite-matrix).

**T7.2 Gated revise of READY latest chapter (D10).**
- Files: MODIFY `runner.ts#reviseDraft` gated branch; extend `state-review-interactions.test.ts`.
- Sequence under gate: existing gates → archive version → write revised prose → copy `snapshots/N-1` truth+state back over live files → regenerate proposals from revised prose → status `needs-state-review`. Failure at any point ⇒ prior prose/state intact (archive + atomic set).
- Tests-first: revised prose produces NEW proposals; canon equals snapshot N−1 content between revise and confirm; failed reviser output ⇒ zero writes (extends existing `revise-foundation`/`reviser` rollback expectations); older-than-latest chapter revise unchanged (still touches only the chapter file).
- Verify: CORE-F(state-review-interactions) + CORE-F(reviser) + CORE-F(revise-foundation).

**T7.3 Repair/resync/resume matrix under gate.**
- Files: extend `state-review-interactions.test.ts` + `pipeline-runner.test.ts` regression subset.
- Cases: crash between validate and commit (T6.1) ⇒ retry works; `.run.json` reflects `needs-state-review`; `write sync` on gated chapter regenerates proposals; `repair-state` refuses to bypass gate; lock held during confirm behaves.
- Verify: CORE-F(state-review-interactions) + CORE-F(production-harness).

### Phase 8 — Vietnamese + English language model (L, M, N, O, Q) (risk: MEDIUM; T8.6/T8.10 HIGH)

Ordering rationale: schemas → utilities → prompts/parsers → projections → pipeline wiring → surfaces. English regression tests land WITH the tasks that could break English (Q).

**T8.1 Language union widening.**
- Files: MODIFY `models/project.ts` (`language: z.enum(["vi","en"]).default("vi")` — approved default flip, V1_SPEC §23; `"zh"` retained ONLY in the dedicated migration types, see T9.x), `models/book.ts` (`language: z.enum(["vi","en"]).optional()`), `models/runtime-state.ts` (`RuntimeStateLanguageSchema` += `"vi"` — legacy manifests may still say zh), `play/play-store.ts` + `forecast/schema.ts` enums += `"vi"`, `interaction/action-envelope.ts` language fields.
- Compat: reading OLD zh projects must keep working pre-migration ⇒ introduce `LegacyStoryLanguage = "zh" | StoryLanguage` in `models/language.ts` (NEW tiny module) and use it at READ boundaries only (project/book loaders keep accepting `"zh"`, new-project creation restricts to vi|en).
- Tests-first: `src/__tests__/language-schema.test.ts` — new defaults; old zh file parses; new-project factory rejects zh.
- Verify: CORE-F(language-schema) + `pnpm typecheck` (union widening will surface every switch — each exhaustively updated in T8.10 checklist).

**T8.2 Length counting (M).**
- Files: MODIFY `models/length-governance.ts` (`LengthCountingModeSchema` += `"vi_words"`), `utils/length-metrics.ts` (`resolveLengthCountingMode` vi→vi_words; generalize en word counter to `countWords` used by both; `formatLengthCount` vi label; `DEFAULT_CHAPTER_LENGTH_VI = 2000` constant), FIX `state/manager.ts` rebuild path to count via `resolveLengthCountingMode`-aware counting (repairs the latent char-count bug generally — AUDIT §10), `state/chapter-word-sync.ts` follows automatically.
- Tests-first: `src/__tests__/length-metrics-vi.test.ts` — diacritic-heavy sample counts words not chars; format labels; telemetry round-trip persists `vi_words`; rebuild of an en/vi book index yields word counts (fails before fix); zh book unchanged (char counts) — migration-only behavior preserved.
- Verify: CORE-F(length-metrics-vi) + CORE-F(chapter-word-sync).

**T8.3 Language inference (N).**
- Files: MODIFY `utils/language.ts` — precedence rule ENFORCED at call sites: explicit project/book language ALWAYS wins (`agent-tools.ts:1007` createBook path passes explicit when present — add the missing precedence check); `inferLanguage` gains Vietnamese detection: presence of VN diacritic class (ăâđêôơư + tone marks, precomposed) ⇒ `"vi"`; Latin-dominant without diacritics ⇒ `"en"`; strong-CJK ⇒ `"zh"` (legacy contexts only). Inline duplicates (`consolidator.ts:168`, `architect.ts:1281`, `planner.ts containsChinese`) delegate to the shared util.
- Tests-first: `src/__tests__/language-vi.test.ts` — V1_SPEC §34 example string infers vi; plain English infers en; mixed with light diacritics infers vi; explicit config overrides inference everywhere (call-site tests).
- Verify: CORE-F(language-vi) + CLI-F(agent-tools-params).

**T8.4 Language-neutral slugs (O).**
- Files: MODIFY `utils/book-id.ts#deriveBookIdFromTitle` — NFD normalize → strip combining marks → đ→d → lowercase → keep `[a-z0-9]` + CJK range (legacy titles) → collapse hyphens → cap 30 (unchanged cap). REPLACE the three duplicated implementations (`studio/api/book-create.ts:36`, `server.ts:1689`, `server.ts:6058`) with imports of the core fn (deduplication justified: divergence already caused the 4-site risk).
- Tests-first: `src/__tests__/book-id-vi.test.ts` — `"Người Vợ Trong Bức Chân Dung"` → `nguoi-vo-trong-buc-chan-dung`; empty-after-strip fallback; CJK title byte-identical to old behavior; `assertSafeBookId` accepts results; collision suffix unchanged.
- Verify: CORE-F(book-id-vi) + STUDIO-F(book-create).

**T8.5 Foundation/architect + control docs (vi).**
- Files: MODIFY `agents/architect.ts` (+ `buildVietnameseFoundationPrompt` cloned from the EN structure with Vietnamese web-fiction framing; section markers `=== SECTION:` UNCHANGED — parser contract preserved), `utils/writing-methodology.ts` (+ `buildVietnameseMethodology`), `state/manager.ts` control-doc templates (+ vi variants selected by resolved language), roles dir choice: vi/en books use `roles/major|minor` (already accepted by `outline-paths.ts` and the Studio allowlist — verified).
- Tests-first: `src/__tests__/architect-vi.test.ts` — stubbed vi foundation parses via existing `parseSections`; `writeFoundationFiles` emits `roles/major|minor`; control docs seeded in Vietnamese; EN/ZH golden regressions untouched.
- Verify: CORE-F(architect-vi) + CORE-F(architect).

**T8.6 Planner memo (vi) — parser-contract task.**
- Files: MODIFY `agents/planner-prompts.ts` (+ `getPlannerMemoSystemPrompt("vi")` template whose headings are the CANONICAL vi heading set defined in the same file as a shared constant) and `utils/chapter-memo-parser.ts` (REQUIRED_SECTIONS becomes per-language tables keyed by `WritingLanguage`; parse selects by language; fallback memo vi).
- Tests-first: `src/__tests__/chapter-memo-parser-vi.test.ts` — golden vi memo fixture parses; ANY heading drift fails loudly (contract test enumerating constant↔template consistency — template string must contain the exact constant headings, asserted by test); zh/en golden regressions green.
- Verify: CORE-F(chapter-memo-parser-vi) + CORE-F(planner).

**T8.7 Writer + parser (vi).**
- Files: CREATE `agents/vi-prompt-sections.ts` (genre intro/output-format/pre-write tables mirroring `en-prompt-sections.ts`); MODIFY `agents/writer-prompts.ts` (isVi branches incl. length block "Mục tiêu: N từ"), `agents/writer-parser.ts` (fallback heading `Chương N` + vi labels + vi placeholder sentinels), `utils/long-span-fatigue.ts` (+ minimal vi variance lexicon).
- Tests-first: `src/__tests__/writer-vi.test.ts` — golden vi creative output parses (title/content/pre-write); length requirement block rendering; en/zh regressions green; `short-fiction-en.test.ts`-style ZERO-leak assertion generalized (see T8.10).
- Verify: CORE-F(writer-vi) + CORE-F(writer) + CORE-F(writer-parser).

**T8.8 Settlement + projections + parsers (vi).**
- Files: MODIFY `agents/observer-prompts.ts` / `settler-prompts.ts` (+ vi LANGUAGE-OVERRIDE variants; delta JSON itself language-neutral), `agents/state-validator.ts` (+ vi prompt variant), `state/state-projections.ts` (+ vi label/header/boolean tables), `utils/story-markdown.ts` (+ vi header alias sets — permanent third acceptance set per AUDIT coupling finding), `state-reducer.ts` alias order gains vi ordering keyed by `manifest.language`.
- Tests-first: `src/__tests__/projections-vi.test.ts` — render(parse(render(x))) identity in vi; reducer patch applies with vi aliases; zh/en identities unchanged.
- Verify: CORE-F(projections-vi) + CORE-F(runtime-state-store) + CORE-F(state-manager).

**T8.9 Audit/review/validation stack (vi).**
- Files: MODIFY `agents/continuity.ts` (+ vi rubric authored in Vietnamese; severity vocabulary unchanged), `agents/foundation-reviewer.ts`, `agents/reviser.ts`, `agents/polisher.ts` (+ vi variants; polisher remains unwired — variant added only because the prompt family is being made total), `agents/ai-tells.ts` (+ starter vi hedge/transition lexicons), `agents/post-write-validator.ts` (+ `validatePostWriteVietnamese`: generic paragraph-shape rules; skip China-specific wordlists for vi/en), `agents/style-analyzer.ts` (word-based metrics for vi).
- Tests-first: `src/__tests__/audit-vi.test.ts` — vi audit JSON parses; ai-tells fires on vi hedged sample; sensitive-words analyzer no-ops on vi; en/zh regressions green.
- Verify: CORE-F(audit-vi) + CORE-F(continuity) + CORE-F(post-write-validator).

**T8.10 Pipeline wiring + leak-free integration (Q anchor).**
- Files: MODIFY `pipeline/runner.ts#resolveBookLanguage` (:478-500 widen; `languageFromLengthSpec` maps vi_words→vi); exhaustive-switch helper `assertStoryLanguage(l)` in `models/language.ts`; update every `language === "en"` branch site surfaced by the compiler.
- Tests-first: CREATE `src/__tests__/long-form-language-leak.test.ts` — stubbed END-TO-END per language (foundation→plan→write→settle) asserting: vi book ⇒ zero EN-template sentinel strings AND zero zh sentinels; en book ⇒ zero vi sentinels AND zero zh sentinels; zh fixture (legacy) unchanged. Sentinels drawn from each prompt family's distinctive phrases.
- Verify: CORE-F(long-form-language-leak) + FULL core suite.
- **▶ CHECKPOINT C3 immediately after this task:** real-model Vietnamese book — idea → foundation → plan → gated write → review → confirm, all artifacts in Vietnamese, word-based gates firing.

**T8.11 Surfaces: CLI / Studio / exports.**
- Files: MODIFY `cli/commands/init.ts` (--lang default vi, choices vi|en), `config.ts`, `book.ts`, `short-fiction.ts` (--lang vi), `cli/localization.ts` (CliLanguage += "vi"; formatters vi where trivially safe), Studio `LanguageSelector.tsx` (options: Vietnamese/English ONLY for new projects), `BookCreate.tsx` (defaults vi / 2000 words), `server.ts` book-create passthrough + `POST /project/language` accepts vi, `action-envelope.ts` charsPerChapter superRefine adds vi range (600–800 words, parity with en), `interaction/export-artifact.ts` epub lang `vi-VN`, `interactive-film/export-html.ts` lang from project language (fixes hardcoded zh). TUI locale deliberately UNCHANGED (UI chrome ≠ story language, V1_SPEC §35).
- Tests-first: CLI-F(init/lang), CLI-F(book lang), STUDIO-F(language-selector), STUDIO-F(book-create defaults), CORE-F(action-envelope vi range), CORE-F(export lang).
- Verify boundary: BOUNDARY (full).

### Phase 9 — Chinese → vi/en migration (P) (risk: HIGH)

**T9.1 Detection + dry-run planner.**
- Files: CREATE `packages/core/src/migration/detect.ts` (+ `planLanguageMigration(projectRoot, target): MigrationPlan`); CLI `commands/migrate-language.ts` (`castor migrate-language [--book id] --to vi|en --dry-run`); program registration.
- Output: per-file action list (translate / rewrite / relabel / untouched) with counts; NEVER mutates in dry-run.
- Whitelist logic encodes V1_SPEC §26/§27: translate chapters, foundation md, roles sheets, outlines, summaries cells, hook notes/types, state VALUES, planning artifacts; NEVER ids/schema keys/hashes/snapshot dirs/enum values (except `manifest.language`/`book.language`/`castor.json.language` which the finalize step rewrites explicitly).
- Tests-first: `src/__tests__/migrate-detect.test.ts` on a zh fixture book (T0.1 variant) — exact plan contents; en book ⇒ empty plan.
- Verify: CORE-F(migrate-detect).

**T9.2 Backup + journal.**
- Files: MODIFY `cli/src/book-backup.ts` (expose project-level backup of castor.json alongside per-book backups); CREATE `migration/journal.ts` (`MigrationJournal` — append-only JSONL at `.castor/migrations/<ts>-<target>.jsonl`, entries {file, action, status, backupRef}; supports resume + rollback listing).
- Tests-first: journal append/resume/rollback-list unit tests; backup created before any mutation (integration).
- Verify: CORE-F(migration-journal).

**T9.3 Translation executor (schema-aware).**
- Files: CREATE `migration/translate.ts` — adapter over the EXISTING translation subsystem (`translation/index.ts#createLLMTranslationModel` + segmenters) with per-artifact handlers: markdown files translated body-only (headings re-written by a heading-map step: `第N章`→`Chương N`/`Chapter N`); JSON artifacts translated ONLY through field whitelists (e.g., `CurrentStateFact.object` yes, `predicate` normalized-to-canonical-alias then mapped, `hookId` never); role FILENAMES transliterated via T8.4 slug fn (sheets referenced by display name, not id — verified safe).
- Tests-first: `src/__tests__/migrate-translate.test.ts` with the LLM stub — whitelist enforcement (attempt to feed a schema key ⇒ refused), heading rewriting, filename transliteration, journal entries per file, abort-on-error leaving journal resumable.
- Verify: CORE-F(migrate-translate).

**T9.4 Finalize + verify.**
- Files: CREATE `migration/finalize.ts` — per book: write translated artifacts via `commitAtomicFileSet`, update `castor.json`/`book.json`/`manifest.json` language fields LAST, regenerate all three projections via renderers, run `loadRuntimeStateSnapshot` validation + `doctor`-style checks; print summary; `--rollback <journal>` restores backups (T9.2) — the ONLY sanctioned undo.
- Tests-first: `src/__tests__/migrate-finalize.test.ts` — migrated fixture passes canon validation; projections match renderers; IDs/hashes byte-identical pre/post; failure mid-finalize ⇒ atomic per-book rollback; explicit zh→vi manifest flip drives vi alias order correctly (reducer test).
- Verify: CORE-F(migrate-finalize) + CORE-F(runtime-state-store).

**T9.5 Studio migration wizard.**
- Files: MODIFY `server.ts` (+ `POST /migrate/plan|run|rollback` running through the existing background task-store pattern with SSE progress); CREATE `pages/MigrationWizard.tsx` (banner on zh project: choose target → dry-run report → run → result).
- Tests-first: `migration-route.test.ts` with stubbed translator (plan/run/rollback happy paths + failure resume).
- Verify: STUDIO-F(migration-route).

**T9.6 Prototype validation.**
- Manual protocol (documented in the task): migrate a REAL small zh book to vi and to en; human review of prose fidelity, ID stability, pipeline continuation (`write next` succeeds post-migration).
- **▶ CHECKPOINT C4.**

---

## 4. Risk Ranking

| Phase | Risk | Why (grounded in audit) |
|---|---|---|
| P0 scaffolding | LOW | Additive test helpers only |
| P1 read boundary | LOW | New pure-read facade + one route; no writes |
| P2 viewer | LOW | Additive UI; no engine contact |
| P3 manual editing | **MEDIUM** (P3A persistence/reconciliation elevated) | Touches reducer family + atomic persistence incl. snapshot mirrors + fact-history rebuild; mitigated by no-schema-change design, pure helpers, ONE atomic integrity transaction (live + snapshot), optimistic revision conflicts under the existing book lock, behavior-neutral extraction with ported goldens |
| P4 review domain model | **HIGH** | Modifies `WriterAgent.saveChapter` and the persist path — the most load-bearing write site (AUDIT §6); mitigated by option-flag design, byte-identity tests, and keeping ungated path untouched |
| P5 lifecycle gate | **HIGH** | New status + refusal semantics span CLI/Studio/daemon/auto/revise/resync/repair; ambiguity here blocks all writing; mitigated by reusing `approved` as READY (verified) and the `assertNoPendingStateRepair` guard pattern |
| P6 review ops + commit | **HIGH** core / MEDIUM UI | Confirm must synchronize canon+projections+snapshot+memory in one correct transaction; mitigated by reusing arbitrate→reduce→validate→atomic-set exactly as the write path does |
| P7 hardening | MEDIUM (T7.2 HIGH) | Test-dominant; gated revise rewinds live canon by design — intricate, heavily tested |
| P8 Vietnamese | MEDIUM (T8.6/T8.10 HIGH) | Broad but shallow per task on additive branches; memo-parser heading contract and leak-free integration are the two genuinely dangerous points (AUDIT coupling #1/#16) |
| P9 Chinese migration | **HIGH** | Rewrites user story content across many formats; structured-field translation (predicate aliases) is the deepest unknown; mitigated by dry-run, backups, journal resume/rollback |

## 5. Testing Strategy

- **Per task:** named failing test → minimal implementation → focused vitest filter (commands inline above).
- **Per phase boundary:** `pnpm --filter @actalk/castor-core test` (+ cli/studio when touched), `pnpm typecheck`, `pnpm build`.
- **Milestones (after P3A/P3B/C2/C3/C4):** full `pnpm test -r`; baseline discipline — 1856 passing + new tests; ONLY the 2 known `skill-agent-tool.test.ts` symlink EPERM failures excluded.
- **Regression anchors reused constantly:** `pipeline-runner.test.ts`, `writer.test.ts`, `reviser.test.ts`, `runtime-state-store.test.ts`, `state-manager.test.ts`, `chapter-delete.test.ts`, `atomic-file-set.test.ts`, `production-harness.test.ts`, `short-fiction-en.test.ts` (pattern source for leak tests), `localization.test.ts`.
- Offline determinism: LLM-dependent tests use the existing `agent/llm-stub.ts` harness; no network in CI tasks.

## 6. Human Review Checkpoints

| Checkpoint | After | Inspect |
|---|---|---|
| **P3A** | Core Canon mutation engine (T3A.1–T3A.9) | Engine-level review: contract · E=N+1 temporal semantics · revision/conflict · ONE atomic live+snapshot transaction with failure injections at both stages · snapshot-contract parity (`snapshotStateAt` delegation) · memory-sync goldens · reconciliation ch15→16 · memory-failure invalidation · deterministic writer proof. STOP before P3B |
| **P3B** | Studio API + editing UI (T3B.1–T3B.2) | End-to-end on a real book: one-confirmation Save → projections/snapshot/memory updated → next generation uses the new value → old chapters untouched; lock-owned routes; error/conflict UX. STOP before Phase 4 |
| **C2** | Phase 6 | First complete gated chapter loop incl. restart-mid-review survival and post-confirm generation correctness |
| **C3** | T8.10 | Real-model Vietnamese generation: foundation→plan→write→review in Vietnamese, word-based gates, zero leakage |
| **C4** | T9.6 | Chinese migration prototype: fidelity of translated story content, ID stability, continued pipeline operation, rollback rehearsal |

## 7. Dependency Graph

```
P0 ─► P1 ─► P2 ─► P3A ─► P3B ─┬─► P4 ─► P5 ─► P6 ─► P7
       (A)   (B)      │    (E,G,H)(F)  (G,I)  (J,R)
                      │     ▲         ▲
                      │     └─P3A(commit engine, memory-sync extraction)
                      │
P8 ───────────────────┴── independent branch after P0 (schemas→utils→prompts→
(L,M,N,O,Q)              projections→wiring→surfaces); intersects P4/P5 only via
                         language param plumbing (no semantic dependency)
P9 ── depends on P8 (vi target must exist) + translation subsystem (exists)
Q (English regression) ── embedded in P8 tasks + re-run at every milestone
```

Blocking notes: P4 requires P3A (commit infra + memory-sync extraction). P6 requires P4+P5+P3B. P7 requires P3–P6. P9 requires T8.4 (slug fn) and vi language stack. Nothing in P8 requires P3–P7, so the language track can proceed in parallel after P0 if desired.

## 8. Recommended First Implementation Slice

**Slice = Phase 0 + Phase 1 + Phase 2 (T0.1, T1.1–T1.3, T2.1–T2.2): the read-only Story State viewer.**

Why this slice:
- **Real user value immediately:** the vision's core complaint is opacity; this makes canonical facts, the full hook ledger (incl. columns Studio drops today), and chapter summaries visible — closing the audit's biggest exposure gap (Studio has ZERO access to `story/state/*.json` today) without touching a single write path.
- **Least risky architecture:** purely additive — one Core facade over `loadRuntimeStateSnapshot`, one GET route, one page; no schema changes, no pipeline contact, no lifecycle effects; trivially revertible.
- **Independently mergeable/testable:** new tests only + existing suites green; ships behind nothing (it reads what the engine already wrote).
- **Foundation for everything else:** P3A/P3B/P6/P9 all consume the same facade and route patterns established here.

Explicitly NOT in the first slice: editing, the review gate, language work — each carries the higher risks ranked above and deserves its own reviewed merge after checkpoint-style inspection (now P3A/P3B).

---

## Appendix A — Exact Symbol Reuse Index

| Need | Reuse (file · symbol) |
|---|---|
| Load canonical state | `state/runtime-state-store.ts#loadRuntimeStateSnapshot` :35 |
| Reduce deltas | `state/state-reducer.ts#applyRuntimeStateDelta` :25; `utils/hook-arbiter.ts#arbitrateRuntimeStateDeltaHooks` |
| Validate state | `state/state-validator.ts#validateRuntimeState`; LLM safety net `agents/state-validator.ts#StateValidatorAgent.validate` |
| Render projections | `state/state-projections.ts#renderCurrentStateProjection/renderHooksProjection/renderChapterSummariesProjection` |
| Atomic writes | `utils/atomic-file-set.ts#commitAtomicFileSet` |
| Snapshots/restore/rollback/index | `state/manager.ts#snapshotStateAt/restoreState/rollbackToChapter/loadChapterIndex/saveChapterIndex/acquireBookLock`; SINGLE snapshot contract: `state/snapshot-set.ts#buildSnapshotFileSet/isSnapshotComplete` — `snapshotStateAt` delegates to it (T3A.3) |
| Canon edit/revision/concurrency | `models/canon-edits.ts#CanonEditSchema/CanonCommitRequestSchema`; `state/canon-service.ts#computeCanonRevision/validateCanonEditedState/previewCanonEdits/commitCanonEdits` (P3A) |
| Persistence order | `pipeline/chapter-persistence.ts#persistChapterArtifacts` |
| Delta parsing | `agents/settler-delta-parser.ts#parseSettlerDeltaOutput`; legacy `agents/settler-parser.ts#parseSettlementOutput` |
| Re-extraction for recovery | `agents/chapter-analyzer.ts#ChapterAnalyzerAgent.analyzeChapter` |
| Guards pattern | `pipeline/runner.ts#assertNoPendingStateRepair` :3244 (pattern for T5.3) |
| Config-resolution pattern | `models/book.ts#resolveChapterReviewMode/resolveRevisionGate` |
| Memory/fact-history sync | `pipeline/runner.ts` internals → extracted to `state/memory-sync.ts` (T3A.6; reconciliation pass T3A.7) |
| Language resolution | `pipeline/runner.ts#resolveBookLanguage` :478-500; `utils/language.ts#inferLanguage` |
| Slugs | `utils/book-id.ts#deriveBookIdFromTitle/assertSafeBookId` |
| Length | `models/length-governance.ts#LengthCountingModeSchema`; `utils/length-metrics.ts` |
| Backups | `cli/src/book-backup.ts#createBookBackup/restoreBookBackup` |
| Translation engine (migration) | `translation/index.ts#createLLMTranslationModel` + segmenters |
| Background work/SSE (Studio) | `studio/src/api/task-store.ts` + `/api/v1/events` :3452 |
| Offline tests | `agent/llm-stub.ts` |

## Appendix B — File Manifest

CREATE: `core/src/state/canon-service.ts` · `core/src/models/canon-edits.ts` (P3A edit contract) · `core/src/state/snapshot-set.ts` (single snapshot contract) · `core/src/state/memory-sync.ts` · `core/src/models/state-review.ts` · `core/src/models/language.ts` · `core/src/pipeline/state-review.ts` · `core/src/agents/settler-legacy-adapter.ts` · `core/src/migration/{detect,journal,translate,finalize}.ts` · `core/src/agents/vi-prompt-sections.ts` · `studio/src/lib/canon-api.ts` · `studio/src/pages/story-state/{StoryStatePage.tsx,…}` · `studio/src/pages/story-state/ChapterStateReview.tsx` · `studio/src/pages/MigrationWizard.tsx` · `cli/src/commands/migrate-language.ts` · ~20 new test files as named per task.
MODIFY: `core/src/models/{runtime-state,chapter,project,book,length-governance}.ts` · `core/src/state/{state-reducer,state-projections,runtime-state-store(canonical-service extraction only),manager(rebuild count fix; snapshotStateAt delegates to snapshot-set per T3A.3),bootstrap(alias exports)}.ts` · `core/src/agents/{writer,architect,planner-prompts(observer/settler/reviser/polisher/continuity/foundation-reviewer/state-validator)…}.ts` · `core/src/utils/{language,book-id,length-metrics,writing-methodology,long-span-fatigue,story-markdown}.ts` · `core/src/pipeline/{runner(memory-sync delegates per T3A.6),pipeline(chapter-persistence flag),scheduler}.ts` · `core/src/production/harness.ts` · `core/src/index.ts` (exports) · `studio/src/api/server.ts` (routes only) · Studio pages listed · `cli/src/commands/{init,config,book,auto,review,short-fiction}.ts` · `cli/src/localization.ts`.
UNTOUCHED by explicit decision: providers/endpoints catalog, retrieval kernel, notify, play/interactive-film engines (except their language enums), skills loader, vestigial systems (AUDIT §12).

---

*End of plan. Implementation has NOT begun; no production file, test, prompt, schema, or branch was touched to produce this document.*
