# InkOS V1 Implementation Plan

**Status:** PLAN — implementation planning only. No code, tests, schemas, prompts, or migrations are changed by this document.
**Sources of truth used:** `docs/PROJECT_VISION.md` (long-term intent) · `docs/V1_SPEC.md` (APPROVED V1 requirements) · `docs/ARCHITECTURE_AUDIT.md` (verified InkOS 1.8.0 facts).
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
→ Manual current-state editor (any time): preview → validated atomic commit
   → projections/snapshot/memory synchronized; forward-only semantics     ← NEW (C/D/K)
→ Vietnamese native generation (vi|en only; zh migration path)            ← NEW (L–P)
```

The pipeline skeleton (Planner → Composer → Writer → Auditor → Reviser), provider layer, context assembly, and all recovery machinery are reused unchanged.

---

## 2. Resolved Design Decisions

Each decision below was derived from named audit findings; these bind all later tasks.

**D1 — Interception point (E).** The safest interception is `agents/writer.ts#WriterAgent.saveChapter` (:628–723), because that is the single place where the settler delta becomes canonical artifacts (via `resolveRuntimeStateArtifactsForOutput`) inside `commitAtomicFileSet`. In gated mode `saveChapter` receives an option that (a) excludes the four `story/state/*.json` writes and the three projection-markdown writes from the atomic set, and (b) includes a serialized `StateReviewArtifact` instead. Consequence: after a gated write, `loadRuntimeStateSnapshot(bookDir)` naturally returns the **pre-chapter state** (post-chapter N−1), which is exactly the reduction base the confirm step needs — no shadow copies, no rollback machinery. The delta itself is produced upstream by `settler-delta-parser.ts#parseSettlerDeltaOutput` and is already a plain object (`RuntimeStateDeltaSchema`) — serializing it into the artifact loses nothing.

**D2 — Proposal artifact (G).** Path: `books/<id>/story/runtime/chapter-NNNN.state-review.json`. Owned by the pipeline (created at gated save), mutated ONLY through Core APIs (decision updates, confirm, reject, regenerate), consumed by `confirmChapterState`, deleted on resolution. It lives under `story/runtime/` so the EXISTING sweep behavior of `StateManager.restoreState` / `rollbackToChapter` / `deleteLatestChapter` cleans it automatically (AUDIT §6.2) — no new cleanup subsystem. It is a pending-work queue scoped to one chapter, never read by generation (the gate forbids proceeding while it exists), therefore NOT a second canon.

**D3 — Lifecycle statuses (F).** Verified current enum: `ChapterStatusSchema = ["card-generated","drafting","drafted","auditing","audit-passed","audit-failed","state-degraded","revising","ready-for-review","approved","rejected","published","imported"]` (`models/chapter.ts:4-18`), and review-approve writes `status:"approved"` (`cli/commands/review.ts:127/:165`; identical logic in the Studio approve endpoint). Therefore: add exactly ONE new member `"needs-state-review"`; **READY = the existing `"approved"`** — no overloaded or ambiguous reuse. `production/harness.ts` `ProductionRunStatus` gains the same new member (additive). Existing meanings of `ready-for-review`, `audit-failed`, `needs-revision`, `state-degraded` unchanged.

**D4 — Current/history semantics (D).** A manual correction of an active fact at current position N (N = `manifest.lastAppliedChapter`) is implemented as: close the old fact (`validUntilChapter = N`) and insert `{subject, predicate, object: newValue, validFromChapter: N, validUntilChapter: null, sourceChapter: N, origin: "manual"}`. This uses the existing temporal fields (`CurrentStateFactSchema`, `models/runtime-state.ts:78-87`) exactly as `rebuildCurrentStateFactHistory` already interprets them. Old chapters are never rewritten (V1_SPEC §11). Because the latest snapshot `snapshots/N/state/*` is refreshed on every confirmed mutation, the existing replay-based fact-history rebuild reproduces manual facts without new storage.

**D5 — Manual-edit provenance marker.** Add ONE optional field to `CurrentStateFactSchema`: `origin: z.enum(["story","manual"]).optional()` (absent ≡ `"story"`). Purely additive — every existing fixture/file validates unchanged. This gives the overwrite-safety work (J) a deterministic rule: manual-origin facts survive history rebuilds and are never silently overwritten by derived data.

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
Verification shorthand — CORE-F(t): `pnpm --filter @actalk/inkos-core exec vitest run src/__tests__/<t>` · STUDIO-F(t): `pnpm --filter @actalk/inkos-studio exec vitest run src/__tests__/<t>` · BOUNDARY: `pnpm --filter @actalk/inkos-core test && pnpm --filter @actalk/inkos-cli test && pnpm --filter @actalk/inkos-studio test && pnpm typecheck && pnpm build`.

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
- Verify: `pnpm --filter @actalk/inkos-core build` (subpath exports intact), `pnpm typecheck`.

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
- Content strictly mirrors existing schemas — three tabs: **Current State** (slot table from the 6 patch slots via alias matching + "Additional facts" list showing subject/predicate/object + validity chapters + origin badge), **Hooks** (FULL 13-column table incl. `dependsOn/payoffTiming/coreHook/halfLife/promoted` — deliberately unlike the lossy client-side `lib/truth-display.ts#parsePendingHooks` cards), **Chapter Summaries** (8-column table). Technical fields displayed but marked system-managed (per V1_SPEC §43).
- Do NOT invent timeline/relationship/clue/secret models (audit §3.9: none exist).
- Tests-first: `pages/story-state/StoryStatePage.test.tsx` — renders mocked canon; hooks table shows promoted column; empty-state for missing sections.
- Verify: STUDIO-F(StoryStatePage) + `pnpm --filter @actalk/inkos-studio build`.

### Phase 3 — Safe manual current-state editing (C, D, K) (risk: MEDIUM; T3.5/T3.6 elevated)

**T3.1 Additive provenance field.**
- Files: MODIFY `packages/core/src/models/runtime-state.ts` (`CurrentStateFactSchema` += `origin: z.enum(["story","manual"]).optional()`).
- Tests-first: extend `src/__tests__/runtime-state-store.test.ts` — legacy fact object without `origin` still parses; `origin:"manual"` round-trips through `saveRuntimeStateSnapshot`/load.
- Verify: CORE-F(runtime-state-store).

**T3.2 Manual-edit reducer function.**
- Files: MODIFY `packages/core/src/state/state-reducer.ts`; CREATE `src/__tests__/state-reducer.manual-edit.test.ts`.
- Interface: `applyManualCurrentStateEdits(snapshot: RuntimeStateSnapshot, edits: ManualCurrentStateEdit[], opts: {chapter: number}): RuntimeStateSnapshot` where `ManualCurrentStateEdit = {kind:"set", subject, predicate, object} | {kind:"remove", subject, predicate}`.
- Semantics (D4/D5): `set` closes every currently-active fact with same normalized subject::predicate (`validUntilChapter = opts.chapter`), appends the new fact with `validFromChapter = opts.chapter`, `sourceChapter = opts.chapter`, `origin:"manual"`; `remove` closes without replacement. Pure function; runs `validateRuntimeState` before returning; does NOT touch `lastAppliedChapter`.
- Tests-first (all fail before impl): time-skip scenario — age 22 active from ch.1; set age 23 at ch.15 ⇒ old row closed at 15, new row open, `origin:"manual"`; remove; duplicate set idempotence; invalid edits (empty subject) ⇒ validator error; snapshot immutability (input not mutated).
- Reuse: `normalizePredicate` logic already in reducer; `validateRuntimeState` (`state/state-validator.ts`).
- Verify: CORE-F(state-reducer.manual-edit).

**T3.3 Preview + atomic commit service.**
- Files: MODIFY `packages/core/src/state/canon-service.ts`; CREATE `src/__tests__/canon-edits.test.ts`.
- Interfaces:
  - `previewCanonEdits(bookDir, edits): Promise<{before: CurrentStateState; after: CurrentStateState; warnings: string[]}>` (pure compute; `after` = `applyManualCurrentStateEdits` result; warnings e.g. "closes 1 active fact", "unknown slot alias").
  - `commitCanonEdits(bookDir, edits, deps: {snapshotState: () => Promise<void>; language: "zh"|"en"}): Promise<CommitResult>` — steps: load → apply → validate → render `current_state.md` via `renderCurrentStateProjection(after.currentState, language)` → **ONE `commitAtomicFileSet`** writing the 4 state JSONs + regenerated `current_state.md` → caller-supplied `snapshotState()` refresh (StateManager.snapshotStateAt bound to lastAppliedChapter) → return `{appliedEdits, closedFacts}`.
- Reuse: `commitAtomicFileSet`, `renderCurrentStateProjection`, `validateRuntimeState`, `saveRuntimeStateSnapshot` NOT used here (superseded by the atomic set — note why in code comment).
- Tests-first: happy path asserts file contents + projection equality with renderer output; failing-validation edit writes NOTHING (fs unchanged); injected `commitAtomicFileSet` failure (non-writable staging via mock) leaves prior files intact; snapshot refreshed (fixture spy).
- Verify: CORE-F(canon-edits).

**T3.4 Server routes for preview/commit.**
- Files: MODIFY `packages/studio/src/api/server.ts`; CREATE `src/__tests__/canon-edits-route.test.ts`.
- Routes: `POST /api/v1/books/:id/canon/current-state/preview` and `/commit`; bodies zod-validated (`edits[]`); commit resolves `language` from project config (existing `currentProjectLanguage` helper :2716 area) and binds `deps.snapshotState` to `state.snapshotStateAt(id, manifest.lastAppliedChapter)`.
- Error mapping: ZodError / `validateRuntimeState` issues → `{error, issues: string[]}` with human-readable messages (V1_SPEC §42); HTTP 200-with-error-object pattern consistent with neighboring routes.
- Tests-first: preview returns diff summary; commit persists + refreshes snapshot (fixture book); invalid edit ⇒ no file mtime changes + issues list; unknown book ⇒ 404.
- Verify: STUDIO-F(canon-edits-route).

**T3.5 Extract memory/fact-history sync (D7).**
- Files: CREATE `packages/core/src/state/memory-sync.ts`; MODIFY `packages/core/src/pipeline/runner.ts` (delete internal fns `rebuildNarrativeMemoryIndex`/`rebuildCurrentStateFactHistory` bodies → re-export/delegate wrappers kept private); CREATE `src/__tests__/memory-sync.test.ts` (port relevant cases from `pipeline-runner-memory-sync.test.ts` fixtures).
- Behavior-neutral refactor; enables T3.6/T6.1 reuse. Runner keeps calling sites unchanged (`persistChapterArtifacts` callers).
- Verify: CORE-F(memory-sync) + CORE-F(pipeline-runner-memory-sync) must stay green byte-for-byte in expectations.

**T3.6 Fact-history preserves manual facts (J part 1).**
- Files: MODIFY `packages/core/src/state/memory-sync.ts` (`rebuildCurrentStateFactHistory`): after replaying `snapshots/0..N`, merge manual-origin facts from LIVE `current_state.json` (upsert by subject::predicate; close any replayed interval conflicting with `validFromChapter ≥ manual.validFromChapter`).
- Tests-first: CREATE `src/__tests__/fact-history-manual.test.ts` — (a) manual age edit at ch.15 survives full replay; (b) story fact re-established later (settled at ch.20) correctly supersedes; (c) replay WITHOUT manual facts unchanged vs old behavior (golden compare on fixture).
- Verify: CORE-F(fact-history-manual) + CORE-F(pipeline-runner-memory-sync).

**T3.7 Studio current-state editor UI (K).**
- Files: MODIFY `packages/studio/src/pages/story-state/StoryStatePage.tsx` (edit affordances on slot fields + additional facts: inline edit, add, remove; Save flow = preview dialog showing before/after diff + warnings → Confirm → commit; success toast + refetch). Hook editing intentionally deferred to T6.5.
- System-managed fields (validity integers, origin, manifest) shown read-only (V1_SPEC §43).
- Tests-first: `StoryStatePage.edit.test.tsx` — mocked API: edit→preview payload correct; validation error renders issue list; successful commit triggers refetch; past-chapter validity rows never editable.
- Verify: STUDIO-F(StoryStatePage.edit).

**▶ CHECKPOINT C1 (after Phase 3):** on a real book — edit a fact in Studio, observe updated `current_state.md`, refreshed `snapshots/<N>/state`, and that the NEXT `write next` prompt/context uses the new value; verify old chapters untouched; kill a commit mid-save (dev harness) and confirm prior canon intact.

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
- Confirm steps: load artifact → apply decisions onto a COPY of `originalDelta` (reject ⇒ drop op; edit ⇒ replace payload value; accepted ⇒ keep; addMissing ⇒ append user-authored op with `origin:"manual"` on generated facts) → `arbitrateRuntimeStateDeltaHooks` (same allowNewHooks posture as today's write path) → base = `loadRuntimeStateSnapshot` (== pre-chapter state per D1) → `applyRuntimeStateDelta` → `validateRuntimeState` → safety-net `StateValidatorAgent.validate` (failure ⇒ abort, artifact retained, nothing written) → **ONE `commitAtomicFileSet`** {4 state JSONs + 3 freshly rendered projections} → index status `"approved"` (D3) → `snapshotStateAt(N)` → extracted `memory-sync` fns (T3.5) → delete artifact → webhook `state-committed`.
- Reject-all: zero canon writes; status `"approved"`; artifact deleted; reason appended to chapter `reviewNote`.
- Tests-first: happy path asserts canon advanced exactly per accepted set; edited value lands VERBATIM; rejected hookUpsert absent from `hooks.json`; addMissing fact present with `origin:"manual"`; projections byte-equal renderer output; snapshot N contains new state; fact-history intervals correct; artifact gone; validator-abort writes nothing; crash simulation (throw between validate and commit) leaves everything intact.
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
- Files: MODIFY `packages/cli/src/commands/review.ts` (+ `inkos review state [book] [chapter]` listing proposals, `--accept-all/--reject-all` flags delegating to runner commands) — keeps CLI valuable without duplicating UI (vision §26).
- Tests-first: `cli/src/__tests__/review-state-command.test.ts` with stubbed runner.
- Verify: CLI-F(review-state-command).

**T6.5 Manual hook adjustments (completes C for hooks).**
- Files: MODIFY `packages/core/src/state/canon-service.ts` (+ `previewHookEdits`/`commitHookEdits(bookDir, hookOps)` reusing `arbitrateRuntimeStateDeltaHooks` + `renderHooksProjection` + the T3.3 commit pattern); MODIFY `StoryStatePage.tsx` hooks tab (status change, notes edit, add hook — system fields like `startChapter` auto-filled, `hookId` auto-generated via existing ledger-validator charset).
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
- Files: CREATE `packages/core/src/migration/detect.ts` (+ `planLanguageMigration(projectRoot, target): MigrationPlan`); CLI `commands/migrate-language.ts` (`inkos migrate-language [--book id] --to vi|en --dry-run`); program registration.
- Output: per-file action list (translate / rewrite / relabel / untouched) with counts; NEVER mutates in dry-run.
- Whitelist logic encodes V1_SPEC §26/§27: translate chapters, foundation md, roles sheets, outlines, summaries cells, hook notes/types, state VALUES, planning artifacts; NEVER ids/schema keys/hashes/snapshot dirs/enum values (except `manifest.language`/`book.language`/`inkos.json.language` which the finalize step rewrites explicitly).
- Tests-first: `src/__tests__/migrate-detect.test.ts` on a zh fixture book (T0.1 variant) — exact plan contents; en book ⇒ empty plan.
- Verify: CORE-F(migrate-detect).

**T9.2 Backup + journal.**
- Files: MODIFY `cli/src/book-backup.ts` (expose project-level backup of inkos.json alongside per-book backups); CREATE `migration/journal.ts` (`MigrationJournal` — append-only JSONL at `.inkos/migrations/<ts>-<target>.jsonl`, entries {file, action, status, backupRef}; supports resume + rollback listing).
- Tests-first: journal append/resume/rollback-list unit tests; backup created before any mutation (integration).
- Verify: CORE-F(migration-journal).

**T9.3 Translation executor (schema-aware).**
- Files: CREATE `migration/translate.ts` — adapter over the EXISTING translation subsystem (`translation/index.ts#createLLMTranslationModel` + segmenters) with per-artifact handlers: markdown files translated body-only (headings re-written by a heading-map step: `第N章`→`Chương N`/`Chapter N`); JSON artifacts translated ONLY through field whitelists (e.g., `CurrentStateFact.object` yes, `predicate` normalized-to-canonical-alias then mapped, `hookId` never); role FILENAMES transliterated via T8.4 slug fn (sheets referenced by display name, not id — verified safe).
- Tests-first: `src/__tests__/migrate-translate.test.ts` with the LLM stub — whitelist enforcement (attempt to feed a schema key ⇒ refused), heading rewriting, filename transliteration, journal entries per file, abort-on-error leaving journal resumable.
- Verify: CORE-F(migrate-translate).

**T9.4 Finalize + verify.**
- Files: CREATE `migration/finalize.ts` — per book: write translated artifacts via `commitAtomicFileSet`, update `inkos.json`/`book.json`/`manifest.json` language fields LAST, regenerate all three projections via renderers, run `loadRuntimeStateSnapshot` validation + `doctor`-style checks; print summary; `--rollback <journal>` restores backups (T9.2) — the ONLY sanctioned undo.
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
| P3 manual editing | **MEDIUM** (T3.5/T3.6 elevated) | Touches reducer family + persistence + fact-history rebuild; mitigated by additive schema field, pure functions, atomic commits, behavior-neutral extraction with ported tests |
| P4 review domain model | **HIGH** | Modifies `WriterAgent.saveChapter` and the persist path — the most load-bearing write site (AUDIT §6); mitigated by option-flag design, byte-identity tests, and keeping ungated path untouched |
| P5 lifecycle gate | **HIGH** | New status + refusal semantics span CLI/Studio/daemon/auto/revise/resync/repair; ambiguity here blocks all writing; mitigated by reusing `approved` as READY (verified) and the `assertNoPendingStateRepair` guard pattern |
| P6 review ops + commit | **HIGH** core / MEDIUM UI | Confirm must synchronize canon+projections+snapshot+memory in one correct transaction; mitigated by reusing arbitrate→reduce→validate→atomic-set exactly as the write path does |
| P7 hardening | MEDIUM (T7.2 HIGH) | Test-dominant; gated revise rewinds live canon by design — intricate, heavily tested |
| P8 Vietnamese | MEDIUM (T8.6/T8.10 HIGH) | Broad but shallow per task on additive branches; memo-parser heading contract and leak-free integration are the two genuinely dangerous points (AUDIT coupling #1/#16) |
| P9 Chinese migration | **HIGH** | Rewrites user story content across many formats; structured-field translation (predicate aliases) is the deepest unknown; mitigated by dry-run, backups, journal resume/rollback |

## 5. Testing Strategy

- **Per task:** named failing test → minimal implementation → focused vitest filter (commands inline above).
- **Per phase boundary:** `pnpm --filter @actalk/inkos-core test` (+ cli/studio when touched), `pnpm typecheck`, `pnpm build`.
- **Milestones (after C1/C2/C3/C4):** full `pnpm test -r`; baseline discipline — 1856 passing + new tests; ONLY the 2 known `skill-agent-tool.test.ts` symlink EPERM failures excluded.
- **Regression anchors reused constantly:** `pipeline-runner.test.ts`, `writer.test.ts`, `reviser.test.ts`, `runtime-state-store.test.ts`, `state-manager.test.ts`, `chapter-delete.test.ts`, `atomic-file-set.test.ts`, `production-harness.test.ts`, `short-fiction-en.test.ts` (pattern source for leak tests), `localization.test.ts`.
- Offline determinism: LLM-dependent tests use the existing `agent/llm-stub.ts` harness; no network in CI tasks.

## 6. Human Review Checkpoints

| Checkpoint | After | Inspect |
|---|---|---|
| **C1** | Phase 3 | Canonical editing end-to-end: Studio edit → projections/snapshot/memory updated → next generation uses new value → old chapters untouched → failed-save atomicity (kill test) |
| **C2** | Phase 6 | First complete gated chapter loop incl. restart-mid-review survival and post-confirm generation correctness |
| **C3** | T8.10 | Real-model Vietnamese generation: foundation→plan→write→review in Vietnamese, word-based gates, zero leakage |
| **C4** | T9.6 | Chinese migration prototype: fidelity of translated story content, ID stability, continued pipeline operation, rollback rehearsal |

## 7. Dependency Graph

```
P0 ─► P1 ─► P2 ─► P3 ─┬─► P4 ─► P5 ─► P6 ─► P7
       (A)   (B)      │    (E,G,H)(F)  (G,I)  (J,R)
                      │     ▲         ▲
                      │     └─P3(T3.3 commit infra, T3.5 extraction)
                      │
P8 ───────────────────┴── independent branch after P0 (schemas→utils→prompts→
(L,M,N,O,Q)              projections→wiring→surfaces); intersects P4/P5 only via
                         language param plumbing (no semantic dependency)
P9 ── depends on P8 (vi target must exist) + translation subsystem (exists)
Q (English regression) ── embedded in P8 tasks + re-run at every milestone
```

Blocking notes: P4 requires T3.3/T3.5 (commit infra + memory-sync extraction). P6 requires P4+P5+P3. P7 requires P3–P6. P9 requires T8.4 (slug fn) and vi language stack. Nothing in P8 requires P3–P7, so the language track can proceed in parallel after P0 if desired.

## 8. Recommended First Implementation Slice

**Slice = Phase 0 + Phase 1 + Phase 2 (T0.1, T1.1–T1.3, T2.1–T2.2): the read-only Story State viewer.**

Why this slice:
- **Real user value immediately:** the vision's core complaint is opacity; this makes canonical facts, the full hook ledger (incl. columns Studio drops today), and chapter summaries visible — closing the audit's biggest exposure gap (Studio has ZERO access to `story/state/*.json` today) without touching a single write path.
- **Least risky architecture:** purely additive — one Core facade over `loadRuntimeStateSnapshot`, one GET route, one page; no schema changes, no pipeline contact, no lifecycle effects; trivially revertible.
- **Independently mergeable/testable:** new tests only + existing suites green; ships behind nothing (it reads what the engine already wrote).
- **Foundation for everything else:** T3.3/T3.4/P6/P9 all consume the same facade and route patterns established here.

Explicitly NOT in the first slice: editing, the review gate, language work — each carries the higher risks ranked above and deserves its own reviewed merge after C1-style inspection.

---

## Appendix A — Exact Symbol Reuse Index

| Need | Reuse (file · symbol) |
|---|---|
| Load canonical state | `state/runtime-state-store.ts#loadRuntimeStateSnapshot` :35 |
| Reduce deltas | `state/state-reducer.ts#applyRuntimeStateDelta` :25; `utils/hook-arbiter.ts#arbitrateRuntimeStateDeltaHooks` |
| Validate state | `state/state-validator.ts#validateRuntimeState`; LLM safety net `agents/state-validator.ts#StateValidatorAgent.validate` |
| Render projections | `state/state-projections.ts#renderCurrentStateProjection/renderHooksProjection/renderChapterSummariesProjection` |
| Atomic writes | `utils/atomic-file-set.ts#commitAtomicFileSet` |
| Snapshots/restore/rollback/index | `state/manager.ts#snapshotStateAt/restoreState/rollbackToChapter/loadChapterIndex/saveChapterIndex/acquireBookLock` |
| Persistence order | `pipeline/chapter-persistence.ts#persistChapterArtifacts` |
| Delta parsing | `agents/settler-delta-parser.ts#parseSettlerDeltaOutput`; legacy `agents/settler-parser.ts#parseSettlementOutput` |
| Re-extraction for recovery | `agents/chapter-analyzer.ts#ChapterAnalyzerAgent.analyzeChapter` |
| Guards pattern | `pipeline/runner.ts#assertNoPendingStateRepair` :3244 (pattern for T5.3) |
| Config-resolution pattern | `models/book.ts#resolveChapterReviewMode/resolveRevisionGate` |
| Memory/fact-history sync | `pipeline/runner.ts` internals → extracted to `state/memory-sync.ts` (T3.5) |
| Language resolution | `pipeline/runner.ts#resolveBookLanguage` :478-500; `utils/language.ts#inferLanguage` |
| Slugs | `utils/book-id.ts#deriveBookIdFromTitle/assertSafeBookId` |
| Length | `models/length-governance.ts#LengthCountingModeSchema`; `utils/length-metrics.ts` |
| Backups | `cli/src/book-backup.ts#createBookBackup/restoreBookBackup` |
| Translation engine (migration) | `translation/index.ts#createLLMTranslationModel` + segmenters |
| Background work/SSE (Studio) | `studio/src/api/task-store.ts` + `/api/v1/events` :3452 |
| Offline tests | `agent/llm-stub.ts` |

## Appendix B — File Manifest

CREATE: `core/src/state/canon-service.ts` · `core/src/state/memory-sync.ts` · `core/src/models/state-review.ts` · `core/src/models/language.ts` · `core/src/pipeline/state-review.ts` · `core/src/agents/settler-legacy-adapter.ts` · `core/src/migration/{detect,journal,translate,finalize}.ts` · `core/src/agents/vi-prompt-sections.ts` · `studio/src/lib/canon-api.ts` · `studio/src/pages/story-state/{StoryStatePage.tsx,…}` · `studio/src/pages/story-state/ChapterStateReview.tsx` · `studio/src/pages/MigrationWizard.tsx` · `cli/src/commands/migrate-language.ts` · ~20 new test files as named per task.
MODIFY: `core/src/models/{runtime-state,chapter,project,book,length-governance}.ts` · `core/src/state/{state-reducer,state-projections,runtime-state-store(canonical-service extraction only),manager(rebuild count fix),bootstrap(alias exports)}.ts` · `core/src/agents/{writer,architect,planner-prompts(observer/settler/reviser/polisher/continuity/foundation-reviewer/state-validator)…}.ts` · `core/src/utils/{language,book-id,length-metrics,writing-methodology,long-span-fatigue,story-markdown}.ts` · `core/src/pipeline/{runner,pipeline(chapter-persistence flag),scheduler}.ts` · `core/src/production/harness.ts` · `core/src/index.ts` (exports) · `studio/src/api/server.ts` (routes only) · Studio pages listed · `cli/src/commands/{init,config,book,auto,review,short-fiction}.ts` · `cli/src/localization.ts`.
UNTOUCHED by explicit decision: providers/endpoints catalog, retrieval kernel, notify, play/interactive-film engines (except their language enums), skills loader, vestigial systems (AUDIT §12).

---

*End of plan. Implementation has NOT begun; no production file, test, prompt, schema, or branch was touched to produce this document.*
