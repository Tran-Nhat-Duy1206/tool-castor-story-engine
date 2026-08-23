# InkOS 1.8.0 — Repository Architecture Audit

**Status:** COMPLETE — preserved record of a read-only repository audit performed against InkOS 1.8.0.
**Purpose:** Document what InkOS **currently** does. This is a factual architecture record, not an implementation plan and not a requirements document.
**Context documents (product intent, not reinterpreted here):** `docs/PROJECT_VISION.md`, `docs/V1_SPEC.md`.
**Baseline at time of audit:** InkOS 1.8.0 · Node 24.19.0 · pnpm 9.15.9 · install/build/typecheck PASS · 1856 tests passed with 2 known Windows symlink EPERM failures in `packages/core/src/__tests__/skill-agent-tool.test.ts` (known environment baseline).

---

## 0. Method and Evidence Standard

- Audit was performed **read-only**: no production code modified, no files created/deleted in the repository tree by the auditors, no prompt/schema/test/format changes.
- Findings were produced by six parallel deep-dive investigations (architecture, execution flows, story-data inventory, Studio capabilities, context/safety, language/coupling), then consolidated.
- **Every load-bearing claim below cites an exact file path and symbol.** Claims marked **[VERIFIED]** were additionally re-checked against source during consolidation (the checker opened the cited code and confirmed the behavior first-hand). Claims without that marker rest on the investigators' direct source reads with path citations; they were consistent with everything re-checked.
- Nothing under `node_modules/` or `dist/` was relied upon.
- Line numbers refer to the 1.8.0 working tree as audited and may drift with future edits; symbol names are the stable reference.

---

# PART I — ARCHITECTURE

## 1. Repository Architecture Map

### 1.1 Workspace topology [VERIFIED]

pnpm monorepo (`pnpm-workspace.yaml`: `packages/*`) with three packages:

| Package | Name | Role |
|---|---|---|
| `packages/core` | `@actalk/inkos-core` | Story engine: pipeline, agents, state, LLM providers, retrieval |
| `packages/cli` | `@actalk/inkos` | CLI (bin `inkos`, 34 commands) + Ink/React TUI |
| `packages/studio` | `@actalk/inkos-studio` | React 19 + Vite client + Hono Node server |

- Root `package.json`: version 1.8.0, private, engines node ≥22 / pnpm ≥9; scripts delegate via `pnpm -r`. Pins `@mariozechner/pi-ai` and `pi-agent-core` to 0.67.1.
- Dependency direction is **strictly one-way**: studio imports core heavily; cli imports core but only *spawns* studio (no static import of `@actalk/inkos-studio` anywhere in `packages/cli/src`). Bare `inkos` with no command launches Studio on port 4567 (`packages/cli/src/program.ts:62-64`) [VERIFIED].
- CI (`.github/workflows/ci.yml`): ubuntu+windows × Node 22/24, build+test, plus a pack-manifest verification job. Release (`.github/workflows/release.yml`): tag-driven canary publish of `@actalk/*`.
- `scripts/audit-semantic-patterns.mjs` is a CI guard that fails when keyword-matching ("semantic decision") logic appears on action-surface paths — an enforced architectural invariant: intent decisions belong to the agent/action layer.
- Known defect: root script `benchmark:studio-e2e` targets `scripts/studio-e2e-benchmark.mjs`, which **does not exist** [VERIFIED].

### 1.2 packages/core — subsystem responsibilities

`src/index.ts` (≈740 lines) is the public barrel.

| Directory | Responsibility | Key exported symbols / files |
|---|---|---|
| `pipeline/` | Long-fiction production engine | `PipelineRunner` (`runner.ts`, ≈3.9k lines): `initBook` :758, `writeNextChapter` :1815, `_executeNextChapterLocked` :1996, `reviseDraft` :1350, `planChapter` :1238, `composeChapter`, `writeDraft`, `auditDraft` :1290, `importChapters`, `importCanon`, fanfic/spinoff/imitation init, `reviseFoundation` :842, `resyncChapterArtifacts` :2513, `_repairChapterStateLocked` :2387. Support: `chapter-persistence.ts#persistChapterArtifacts`, `chapter-review-cycle.ts#runChapterReviewCycle`, `chapter-state-recovery.ts`, `chapter-truth-validation.ts`, `detection-runner.ts`, `scheduler.ts#Scheduler`, `short-fiction-runner.ts`, `script-storyboard-runner.ts`, `persisted-governed-plan.ts` |
| `agents/` | One-shot LLM worker roles + pure heuristics | `base.ts#BaseAgent` (`chat`/`submitStructured` → pi-agent worker; prompt-pack and skill guidance injection); `architect.ts#ArchitectAgent` (`generateFoundation` :111, `writeFoundationFiles` :842); `planner.ts#PlannerAgent`; `composer.ts#ComposerAgent`; `writer.ts#WriterAgent` (`writeChapter` :143, `settle` :494, `saveChapter` :628); `continuity.ts#ContinuityAuditor`; `reviser.ts#ReviserAgent`; `polisher.ts#PolisherAgent`; `consolidator.ts#ConsolidatorAgent`; `foundation-reviewer.ts#FoundationReviewerAgent`; `chapter-analyzer.ts#ChapterAnalyzerAgent`; `state-validator.ts#StateValidatorAgent` (LLM validator — distinct from pure `state/state-validator.ts`); settlement family (`settler-prompts/parser/delta-parser.ts`, `observer-prompts.ts`). Heuristics (no LLM): `ai-tells.ts`, `sensitive-words.ts`, `post-write-validator.ts`, `style-analyzer.ts`, `writer-parser.ts`, `rules-reader.ts`, `detector.ts` |
| `state/` | Persistence core (owns the book format) | `manager.ts#StateManager` (locks :136, chapter index, control docs :66-107, snapshots `snapshotStateAt` :561, `restoreState` :648, `rollbackToChapter` :717); `runtime-state-store.ts` (canonical v2 JSON state); `state-bootstrap.ts` (markdown→JSON reconstruction); `state-reducer.ts#applyRuntimeStateDelta`; `state-projections.ts` (JSON→markdown renderers); `memory-db.ts#MemoryDB` (SQLite WAL); `chapter-workspace.ts` (version archive, per-chapter brief); `chapter-delete.ts#deleteLatestChapter`; `chapter-word-sync.ts#syncChapterWordCounts` |
| `models/` | Zod contracts | `project.ts#ProjectConfigSchema`; `book.ts#BookConfigSchema`; `chapter.ts#ChapterMetaSchema`; `runtime-state.ts` (`StateManifestSchema` v2, `CurrentStateFactSchema`, `HookRecordSchema`, `ChapterSummaryRowSchema`, `RuntimeStateDeltaSchema`); `input-governance.ts` (`ChapterIntentSchema`, `ContextPackageSchema`, `RuleStackSchema`, `ChapterTraceSchema`); `length-governance.ts#LengthCountingModeSchema`; `genre-profile.ts`; `book-rules.ts`; `play.ts`; `state.ts` (**vestigial**, see §12) |
| `llm/` | Provider abstraction | `provider.ts#createLLMClient` :303 / `chatCompletion` :1434 / `PartialResponseError` :418 / `ContextWindowExceededError` :434; `service-presets.ts#SERVICE_PRESETS`; 41 endpoint modules under `providers/endpoints/` (18 tagged `group:"china"`); `secrets.ts` (`.inkos/secrets.json`); `config-migration.ts`; `cover-providers.ts`; `long-form-completion.ts`; `agent-trajectory.ts` (kkaiapi observability headers) |
| `agent/` | Conversational pi-agent harness | `agent-session.ts#runAgentSession` (1,426 lines); `agent-tools.ts` (≈3.8k lines, ~30 tool factories incl. `createWriteTruthFileTool`, `createPatchChapterTextTool`, import/fanfic/spinoff/translation/play tools); `agent-system-prompt.ts`; `context-transform.ts#createBookContextTransform`; `worker-agent.ts`; `pi-stream.ts` |
| `interaction/` | Chat intents/sessions/deterministic edits/export | `intents.ts`; `action-envelope.ts`; `session-transcript.ts` (`.inkos/sessions/<id>.jsonl`); `session-transcript-restore.ts`; `edit-controller.ts#planEditTransaction/executeEditTransaction`; `truth-authority.ts#classifyTruthAuthority`; `export-artifact.ts#buildExportArtifact/writeExportArtifact`; `request-router.ts`; `project-control.ts#processProjectInteractionRequest` |
| `forecast/` | Non-canonical branch planning | `schema.ts`; `store.ts#ForecastStore` (writes ONLY `story/runtime/narrative-forecasts/<fcId>/*`; header comment forbids touching canonical state); `runner.ts`; `context-builder.ts`; `render.ts` |
| Other | — | `play/` (interactive worlds, SQLite-or-file graph DB); `interactive-film/` (story graphs); `translation/` (language-neutral localization subsystem); `materials/` (ingest `.inkos/materials/`); `retrieval/local-search.ts#LocalSearchIndex` (FTS5/BM25 on `node:sqlite`); `references/` (book-bound materials); `prompts/prompt-pack.ts` (overrides at `<root>/prompt/<pack>/<prompt>.md`); `skills/` (SKILL.md loader); `notify/dispatcher.ts`; `production/harness.ts` (run snapshots, `commitProductionArtifacts`); `utils/` (40 files: `atomic-file-set.ts`, hook governance suite, context assembly suite, `outline-paths.ts`, `book-id.ts`, `language.ts`, `length-metrics.ts`, `story-markdown.ts`, `governed-working-set.ts`, …) |

Bundled data: `packages/core/genres/*.md` (15 genre profiles; 10 declare `language: en`, 5 zh-default with no `language:` field) and `packages/core/skills/*/SKILL.md` (15 builtin skill packs).

### 1.3 packages/cli

- Entry `src/index.ts` → `program.ts#createProgram` registers 34 commands (`src/commands/*.ts`): init, config, book, chapter, write, auto, review, status, radar, up/down (daemon), doctor, export, draft, audit, revise, agent, plan, compose, genre, update, detect, style, analytics, eval, import, fanfic, short (short-fiction), forecast, translate, studio, consolidate, interact, tui.
- Shared service layer `src/utils.ts`: `findProjectRoot()` returns `process.cwd()` verbatim (no walk-up search); `buildPipelineConfig`; `resolveBookId` (auto-detect when exactly one book); `getLegacyMigrationHint` (pre-v0.6 books).
- Command→core mapping examples: `write.ts` → `PipelineRunner.writeNextChapter/writeChapters/rewrite(resync/repair-state)`; `review.ts` → StateManager approve/reject (reject ⇒ rollback); `book.ts` → `initBook`; `studio.ts` spawns the studio server (repo TS via tsx loader → installed dist fallback) and opens a browser.
- TUI (`src/tui/`, 19 modules): `app.ts#launchTui`, bridge `agent-input.ts#processTuiAgentInput` → core `runAgentSession`; locale resolution `tui/i18n.ts#resolveTuiLocale`.
- `localization.ts` (544 lines): `CliLanguage="zh"|"en"`, `resolveCliLanguage` arg → `INKOS_LOCALE` → LC_* env → **default zh**.
- `project-bootstrap.ts#initializeProjectDirectory` :122: pure filesystem project init (inkos.json, commented .env template, .gitignore merge, `.nvmrc`=22, mkdir `books/`, `radar/`). Throws if inkos.json exists.

### 1.4 packages/studio (summary; detail in Part II §7)

- Client: React 19 + Vite + Tailwind + zustand, hash-routed SPA (`src/App.tsx`, `hooks/use-hash-route.ts`).
- Server: Hono (`src/api/server.ts`, single ≈6.6k-line monolith; `createStudioServer` :2554, one `new StateManager(root)` per process :2556 [VERIFIED]) + `task-store.ts`, `book-create.ts`, `errors.ts`, `safety.ts`; SSE at `GET /api/v1/events` :3452.
- Launched by `cli/src/commands/studio.ts#resolveStudioLaunch`; dev ports: vite 4567, API 4569 (`vite.config.ts` proxies `/api` and SSE).

### 1.5 scripts/

Five scripts, all read in full: `prepare-package-for-publish.mjs` / `restore-package-json.mjs` (prepack/postpack workspace-specifier rewrite), `verify-no-workspace-protocol.mjs`, `set-package-versions.mjs` (release versioning), `audit-semantic-patterns.mjs` (architecture guard described above). Missing: `studio-e2e-benchmark.mjs` (referenced by root script).

### 1.6 skills/

Repo-root `skills/SKILL.md` (827 lines, v2.9.0) is an OpenClaw/AgentSkills descriptor for the InkOS product itself. Consumption chain [VERIFIED]: `core/src/skills/external-loader.ts#configuredSkillDirs()` scans `INKOS_SKILL_DIRS` → `~/.openclaw/skills` → `~/.agents/skills` → `<projectRoot>/.agents/skills` → `<projectRoot>/skills`; each directory containing `SKILL.md` becomes a skill (depth-2, dedupe last-write-wins vs builtin ids). Builtin packs load from `packages/core/skills/` via `builtin-loader.ts`.

### 1.7 Project / book storage [VERIFIED layout]

Project root is **cwd-based**; global config at `~/.inkos/.env` (`core/src/utils/llm-env.ts:6-7`; env precedence global → project `.env` → process).

```
<projectRoot>/                          # = cwd after `inkos init`
├── inkos.json                          # ProjectConfigSchema (models/project.ts)
├── .env · .gitignore · .nvmrc/.node-version (=22)
├── books/ · radar/ · inkos.log · inkos.pid
├── shorts/<id>/… · covers/<title>/…    # short fiction & covers
├── worlds/<worldId>/runs/<runId>/…     # Play (events.jsonl/transcript.jsonl/state/checkpoints/projections)
├── interactive-films/<projectId>/      # story-graph.json, node assets
├── translations/<projectId>/…          # translation projects
└── .inkos/
    ├── session.json                    # active interaction session
    ├── sessions/<sessionId>.jsonl      # append-only transcripts (.json = legacy)
    ├── backups/<bookId>/<ts>/          # whole-book backups (+ pre-restore auto-backup)
    ├── secrets.json                    # API keys (NOT story secrets)
    ├── materials/<id>.md|json · retrieval.db · research/

books/<bookId>/                         # created atomically (staging dir + rename) by PipelineRunner.initBook
├── .write.lock                         # PID lease, heartbeat 30 s / lease 3 min (manager.ts:8-10,136-219)
├── book.json                           # BookConfigSchema
├── chapters/
│   ├── NNNN_<title>.md                 # prose (4-digit padded number)
│   ├── index.json                      # ChapterMeta[] (status/wordCount/auditIssues/tokenUsage/lengthTelemetry)
│   ├── .versions/NNNN/<ts>_<source>_<uuid>.md     # archives (manual|agent|revision|regeneration|restore)
│   └── .trash/                         # soft deletes
└── story/
    ├── author_intent.md · current_focus.md · style_guide.md · brief.md
    ├── outline/{story_frame.md,volume_map.md,rhythm_principles.md|节奏原则.md}
    ├── roles/{主要角色,次要角色,major,minor}/<name>.md        # role cards
    ├── book_rules.md
    ├── current_state.md · pending_hooks.md · chapter_summaries.md   # markdown PROJECTIONS
    ├── subplot_board.md · emotional_arcs.md · character_matrix.md · particle_ledger.md
    ├── volume_summaries.md · summaries_archive/vol_*.md · audit_drift.md
    ├── style_profile.json · detection_history.json · fanfic_canon.md · parent_canon.md
    ├── reference_bindings.json
    ├── memory.db (+-shm/-wal)          # SQLite narrative-memory index (derived, rebuildable)
    ├── state/{manifest,current_state,hooks,chapter_summaries}.json  # CANONICAL structured state
    ├── snapshots/<N>/                  # frozen copies: 7 truth md files + state/*.json
    ├── drafts/NNNN_*.md
    └── runtime/
        ├── chapter-NNNN.plan.md | .intent.md | .user-brief.md
        ├── chapter-NNNN.context.json | .rule-stack.yaml | .trace.json
        ├── chapter-NNNN.run.json       # production run snapshot (written LAST in its atomic commit)
        └── narrative-forecasts/<fcId>/{forecast.json,comparison.md,selected-branch-plan.md}
```

Legacy layout fallbacks remain readable everywhere: `story_bible.md`, `volume_outline.md`, flat `character_matrix.md` (`utils/outline-paths.ts#isNewLayoutBook/readStoryFrame/readVolumeMap`, `agents/composer.ts:886-927`, `agents/rules-reader.ts`, `runner.ts:1772-1776`).

---

## 2. Automation Flow Map

Shared plumbing for every flow [VERIFIED chain]: every command loads config (`cli/src/utils.ts#loadConfigWithDiagnostics` → core `resolveEffectiveLLMConfig`) → `buildPipelineConfig` → `core/src/llm/provider.ts#createLLMClient` :303 (provider bank resolution via `providers/lookup.ts`, `service-presets.ts`). Every agent stage: `BaseAgent.chat/submitStructured` (`agents/base.ts`) → `runWorkerAgent(Tool)` (`agent/worker-agent.ts`, pi-agent-core wrapper) → `chatCompletion` (`provider.ts:1434`: temperature clamp, `assertWithinContextWindow` :589, stream deadlines, transient retry) → OpenAI-compatible or pi-ai transport. Truncated streams raise `PartialResponseError` and are regenerated whole — half-prose is never persisted. Structured outputs use a single pi tool call, never JSON scraping.

### 2.1 Create project
`inkos init [name] --lang zh|en` → `initializeProjectDirectory` (`cli/src/project-bootstrap.ts:122`) — pure fs, no LLM.

### 2.2 Idea → foundation
`inkos book create --title --genre [--brief <file>]` (`commands/book.ts:24`) → `deriveBookIdFromTitle` (`utils/book-id.ts`) → `PipelineRunner.initBook` (`runner.ts:758`):
1. `generateAndReviewFoundation` (:538): `ArchitectAgent.generateFoundation` (`agents/architect.ts:111`; temp 0.8; zh/en prompt builders :202/:408; idea enters solely as `externalContext` block) → `parseSectionsWithRepair`/`parseSections` (:674, `=== SECTION: name ===` markers; missing sections ⇒ repair chat temp 0.2 ⇒ `MissingArchitectSectionsError` aborts).
2. `FoundationReviewerAgent.review` loop (max `foundationReviewRetries`, default 2; pass = avg ≥80 ∧ no dim <60; parse failure/reject-after-max ⇒ keep current foundation and CONTINUE).
3. Staging dir `books/.tmp-book-create-*`: `saveBookConfigAt` → `book.json`; `writeFoundationFiles` (:842) writes `outline/story_frame.md`, `outline/volume_map.md`, `roles/{主要角色,次要角色}/<name>.md`, compat shims `story_bible.md`+`character_matrix.md`, `book_rules.md`, seeds truth placeholders; `ensureControlDocumentsAt` seeds control docs; empty `chapters/index.json`; `snapshotStateAt(0)`.
4. Atomic rename into `books/<id>` after completeness checks; any error removes staging and aborts.
Studio trigger: `POST /api/v1/books/create` (`server.ts:2831`) → `processProjectInteractionRequest` intent `create_book` → same `initBook`; progress polled via `/books/:id/create-status`.

Post-hoc regeneration = `PipelineRunner.reviseFoundation` (`runner.ts:842`): backs up to `story/.backup-phase5-<ts>/`, re-runs architect in revise mode; `writeFoundationFiles(mode:"revise")` aborts if output regresses to legacy format. Callers: Studio `POST /books/:id/foundation/revise` and agent tool `revise_foundation` — **no CLI command invokes it**.

### 2.3 Planning (per-chapter; no separate book-level outline step beyond `volume_map`)
`inkos plan chapter` → `PipelineRunner.planChapter` :1238 → `resolveGovernedPlan` :3822 → `PlannerAgent.planChapter` (`agents/planner.ts:77`):
- `findOutlineNode` :608 + `extractNumberedBeat` :723 pull the chapter's beats from `volume_map`;
- `planChapterMemo` :187 (temp 0.7; `agents/planner-prompts.ts#getPlannerMemoSystemPrompt`); parse via `utils/chapter-memo-parser.ts` — `PlannerParseError` ⇒ ≤3 retries with error feedback (`MEMO_RETRY_LIMIT=3`) ⇒ degraded fallback memo (CONTINUE);
- writes human-readable `story/runtime/chapter-NNNN.intent.md` and authoritative cache `chapter-NNNN.plan.md` (`pipeline/persisted-governed-plan.ts:39`).
Then `ComposerAgent.composeGovernedChapter` (`agents/composer.ts:91`): context selection (see §8) → `ContextPackageSchema.parse` → budget compression if needed → `buildGovernedRuleStack`/`buildGovernedTrace` → `writeGovernedRuntimeArtifacts` writes `chapter-NNNN.context.json|.rule-stack.yaml|.trace.json` (`utils/runtime-writer.ts:16`).

**Scene planning does not exist as a distinct stage** [VERIFIED by exhaustive search]: no scene-plan agent/schema/file. The planner memo body plus `volume_map` numbered beats function as the de-facto scene layer consumed by writer/reviser/auditor; forecast `beats` are future-chapter planning material only.

### 2.4 `inkos write next`
`commands/write.ts#next` :22 → `PipelineRunner.writeNextChapter` :1815 → `acquireBookLock` (`.write.lock`; held lock ⇒ `BookWriteLockError`, ABORT) → `_writeNextChapterLocked` :1902 (writes `.run.json` status=running) → `_executeNextChapterLocked` :1996:
1. `ensureControlDocuments`; `getNextChapterNumber` (from durable artifact chain, see §4); **`assertNoPendingStateRepair`** :3244 — latest chapter `state-degraded` ⇒ THROW (writes blocked until repaired);
2. `prepareWriteInput` :3260 — plan reused from `.plan.md` when no new `--context` (skips planner LLM), otherwise plan+compose;
3. `WriterAgent.writeChapter` (§2.5);
4. manual review mode ⇒ stop after normalization (status `ready-for-review`); auto ⇒ `runChapterReviewCycle` (§2.7);
5. `buildPersistenceOutput` :3203 (title dedup, hook promotion pass, long-span fatigue analysis);
6. `validateChapterTruthPersistence` then `persistChapterArtifacts` (§6);
7. notifications/webhook; run snapshot terminal status.
CLI batch (`--count`) stops on `state-degraded`; `inkos auto` forces auto-review and aborts the run on any failure.

### 2.5 Chapter generation
`WriterAgent.writeChapter` (`agents/writer.ts:143`):
- **Inputs:** volume map, style guide, current_state, particle ledger, pending hooks, chapter summaries, subplot/emotional/matrix boards, roles context, style fingerprint, fanfic canon, last-5-chapters repetition fingerprint, genre profile, book rules.
- **Phase 1 creative** (temp 0.7): system `buildWriterSystemPrompt` (`agents/writer-prompts.ts:19-86`); user `buildGovernedUserPrompt` (`writer.ts:725`); parse `parseCreativeOutput` (`agents/writer-parser.ts:13`, `=== CHAPTER_TITLE/PRE_WRITE_CHECK/CHAPTER_CONTENT ===` anchors + layered fallbacks for small models).
- **Phase 2 settlement:** Observer (temp 0.5, `observer-prompts.ts`) extracts observations from the new prose → Settler (temp 0.3, `settler-prompts.ts`) emits structured `RUNTIME_STATE_DELTA` JSON (preferred, parsed by `agents/settler-delta-parser.ts:17`) or legacy full-markdown sections (`settler-parser.ts:14`).
- Deterministic post-checks (zero LLM): `normalizePostWriteSurface`, `validatePostWrite`, cross-chapter repetition, paragraph drift, `analyzeAITells`, `analyzeSensitiveWords`, `analyzeHookHealth`.

### 2.6 Post-write processing
`runChapterReviewCycle` (`pipeline/chapter-review-cycle.ts:45`): assessment = ContinuityAuditor + AI-tell/sensitive-word counts + deterministic post-write errors + `validateHookLedger` + length hard-range; pass requires audit passed ∧ score ≥85 ∧ length in range; ≤`writingReviewRetries` (default 1) reviser rounds; ε=3 net-improvement gate keeps the best-scoring in-memory version; auditor parse-failure skips auto-revise entirely. If revision changed the body, `ChapterAnalyzerAgent.analyzeChapter` re-settles truth so state matches final text (`buildPersistenceOutput` :3203). Batch consolidation is separate (`inkos consolidate` → `ConsolidatorAgent.consolidate`).

### 2.7 Audit / review
`inkos audit` → `auditDraft` :1290 (lock-free) → `evaluateMergedAudit` :3710 → index status update (`ready-for-review`|`audit-failed` + issues) → `persistAuditDriftGuidance` :3596 writes `story/audit_drift.md` → webhooks. `ContinuityAuditor.auditChapter` (`agents/continuity.ts:380`) injects truth files + FULL previous chapter text; output contract strict JSON `{passed, overall_score, issues[{severity critical|warning|info, repair_scope, category,…}], summary}`; eraResearch genres use `chatWithSearch` (OpenAI native search or Tavily). `passed=false` only for critical issues.
`inkos review list|approve|approve-all|reject` — pure index ops; reject ⇒ `rollbackToChapter(n−1)` by default. **Studio divergence [VERIFIED]:** `POST /api/v1/books/:id/audit/:chapter` (`server.ts:5321`) constructs `ContinuityAuditor` directly (:5338) and updates neither `chapters/index.json` nor `audit_drift.md`.

### 2.8 Story-state update
Two regimes inside `persistChapterArtifacts` (`pipeline/chapter-persistence.ts:14`):
- **Structured (preferred):** settler `RuntimeStateDelta` → `arbitrateRuntimeStateDeltaHooks` (`utils/hook-arbiter.ts:22`) → base snapshot `loadRuntimeStateSnapshot` (`story/state/*.json`) → `applyRuntimeStateDelta` (`state/state-reducer.ts:25`, validated) → projections rendered → saved atomically with the chapter (writer.saveChapter).
- **Legacy fallback (no delta):** `syncLegacyStructuredStateFromMarkdown` (`runner.ts:3411-3427`) → `rewriteStructuredStateFromMarkdown` re-derives JSON **from** markdown.
Then memory index sync (`rebuildNarrativeMemoryIndex` → MemoryDB replace; `rebuildCurrentStateFactHistory` :3441 replays snapshot facts into temporal fact table) and per-chapter snapshot. Validation failure ⇒ `retrySettlementAfterValidationFailure` (one settle-only retry with feedback, `chapter-state-recovery.ts:49`) ⇒ still failing ⇒ **state-degraded**: body saved, truth reverted, next write blocked (§9).

### 2.9 Rewrite / revise
`inkos revise --mode spot-fix|polish|rewrite|rework|anti-detect` → `reviseDraft` :1350: pre-audit → skip-if-clean-and-uninstructed → **baseline snapshot N−1 required (missing ⇒ ABORT)** :1437-1446 → `ReviserAgent.reviseChapter` (`agents/reviser.ts:112`, temp 0.3, `FIXED_ISSUES/PATCHES/REVISED_CONTENT` tags) → settle-vs-baseline → state validation (retry/degraded ⇒ keep original, `applied:false`) → post-audit temp 0 → **revisionGate** `strict|lenient|always` (`resolveRevisionGate`, `models/book.ts:102`; standards table `REVISION_GATE_STANDARDS` `runner.ts:233`) decides apply → `archiveChapterVersion` BEFORE overwrite :1663 → save (latest chapter touches live truth + snapshot :1669-1735; older chapters touch only the chapter file and mark descendants `needs-revision`).
Regenerate-from-scratch: `inkos write rewrite` deletes target+later chapters, `restoreState(snapshot N−1)` (missing snapshot ⇒ ABORT), reruns write-next. Studio rewrite endpoint actually calls `reviseDraft(…,"rework")` with gate `always`.

### 2.10 Resume / recovery
Layered, artifact-based (no transactional replay engine): book lock with stale takeover; persisted `.plan.md` lets a crashed run skip planner re-invocation; `.run.json` journals are observability-only (nothing auto-resumes from them); `assertNoPendingStateRepair` + `inkos write repair-state` / `inkos write sync`; snapshots power rollback (`review reject`, `write rewrite`, `deleteLatestChapter`); whole-book backups `inkos book backup|restore` (`.inkos/backups/`, pre-restore auto-backup); daemon `Scheduler` pauses after `qualityGates.pauseAfterConsecutiveFailures` (default 3) consecutive failures with temperature escalation; `inkos doctor` diagnostics.

### 2.11 Export
`inkos export --format txt|md|epub [--approved-only]` → `writeExportArtifact` (`interaction/export-artifact.ts:133`; builder :58): concatenates chapter md or builds EPUB (epub-gen-memory); no LLM; default `<root>/<bookId>_export.<fmt>`. Studio streams via `GET /books/:id/export` and saves via intent `export_book`.

---

# PART II — DATA AND TRUTH

## 3. Story Data Inventory

Legend: **canonical** = authoritative input to decisions; **derived** = computed from another store. All paths relative to `books/<bookId>/` unless noted.

### 3.1 Project-level configuration
- **`<root>/inkos.json`** — `ProjectConfigSchema` (`models/project.ts:131`): llm, notify[], detection, foundation/writing gates, researchSearch, modelOverrides (per-agent LLM routing), daemon schedule, `language: z.enum(["zh","en"]).default("zh")` :134. Written by `inkos init`/config command/Studio settings endpoints. Human-safe: zod-validated on read, never regenerated by the pipeline; loaded fresh each run. Note: zod strip mode silently drops removed fields (e.g., legacy `maxTokens`) on read.
- **`<root>/.inkos/secrets.json`** — API keys only (`llm/secrets.ts`). Not story data despite the name.
- **`books/<id>/book.json`** — `BookConfigSchema` (`models/book.ts:55`): title, `platform: tomato|feilu|qidian|other` (Chinese web-novel platforms), genre, status lifecycle (`incubating…completed`), `targetChapters` (default 200), `chapterWordCount` (min 1000, default 3000 — zh-calibrated floor), `language: z.enum(["zh","en"]).optional()` (optional precisely so pre-language books fall back to genre/project), `writing.{reviewMode,revisionGate}` overrides. Read fresh every run; updated only by deliberate settings actions (`markBookActiveIfNeeded` flips status; Studio `PUT /api/v1/books/:id`).

### 3.2 Human direction layer (canonical, never auto-written)
- **`story/author_intent.md`**, **`story/current_focus.md`** — freeform markdown; templates in `StateManager.defaultAuthorIntent/defaultCurrentFocus` (`state/manager.ts:49-59`, zh/en variants); created by `ensureControlDocumentsAt` :66-107 via **writeIfMissing** (never clobbers); updated by humans/Studio truth editor/agent tools `update_author_intent`/`update_current_focus`. Classified `"direction"` authority (`interaction/truth-authority.ts:28-33`). Protected prompt sources (never compressed away).
- **Foundation set** — `story/outline/story_frame.md` (+ YAML frontmatter rules), `story/outline/volume_map.md`, `story/roles/{主要角色|次要角色|majors|minors}/<name>.md`, `story/book_rules.md` (`BookRulesSchema`, `models/book-rules.ts`). Created by `ArchitectAgent.writeFoundationFiles` :842; updated by `reviseFoundation` (which **deletes and regenerates the entire roles directories**, `architect.ts:877-882` [VERIFIED], backup left at `story/.backup-phase5-<ts>/`) and by import/spinoff flows. Read fresh by planner/composer/writer/settler/auditor every run — human edits are respected until a regenerate action runs.
- **Derivative canon** — `story/fanfic_canon.md`, `story/parent_canon.md` (written at fanfic/spinoff init, `runner.ts:989`/`:2989`; protected context thereafter).
- **Style assets** — `story/style_guide.md`, `story/style_profile.json` (regenerated wholesale only on explicit `style import`).

### 3.3 Planning data
- **`story/runtime/chapter-NNNN.plan.md`** (+ display twin `.intent.md`) — `PlanChapterOutput{intent: ChapterIntentSchema, memo: ChapterMemoSchema}` (`models/input-governance.ts:3-23`), format documented `pipeline/persisted-governed-plan.ts:10-25`. Persistent **cache**: authoritative for skipping the planner call when no new context; strict parse ⇒ any drift silently triggers re-planning. Overwritten by the next planning pass.
- **`story/runtime/chapter-NNNN.user-brief.md`** — human-facing per-chapter steering (`state/chapter-workspace.ts:22-47`); merged into revision instructions; editable via Studio workspace panel.
- **Governed runtime artifacts** — `chapter-NNNN.context.json|.rule-stack.yaml|.trace.json` (schemas in `models/input-governance.ts:33-135`); derived traces, written fresh per planning pass; Studio exposes them read-only.
- **Run journal** — `chapter-NNNN.run.json` (`ProductionRunSnapshot`, `production/harness.ts:31`); statuses running→complete|needs-review|failed|cancelled; observability only.

### 3.4 Chapter data
- **`chapters/NNNN_<title>.md`** — prose. **Canonical for narrative content**: progress authority is the contiguous chapter-file chain (`resolveDurableStoryProgress`, `state/state-bootstrap.ts:384-575`), not manifest numbers. Human-safe by design: revisions archive prior versions (`archiveChapterVersion` → `chapters/.versions/NNNN/`); index self-heals from files (`rebuildChapterIndexFromFilesAt`, `manager.ts:473-530`); `syncChapterWordCounts` exists specifically to adopt manual prose edits into the index.
- **`chapters/index.json`** — `ChapterMeta[]` (`models/chapter.ts:21`; statuses include `ready-for-review`, `audit-failed`, `needs-revision`, `state-degraded`): number/title/status/wordCount/auditIssues/tokenUsage/lengthTelemetry. Derived-but-durable; rebuilt from files when corrupt; save refuses to persist an empty index while chapter files exist unless explicitly allowed (`manager.ts:540-555`).
- **`chapters/.trash/`** — soft deletes (`chapter-delete.ts:73-88`).

### 3.5 Structured runtime state (CANONICAL machine store)
**`story/state/{manifest,current_state,hooks,chapter_summaries}.json`** — defined in `models/runtime-state.ts`:
- `StateManifestSchema` :6-12 — `schemaVersion: z.literal(2)`, `language`, `lastAppliedChapter`, `projectionVersion`, `migrationWarnings[]`.
- `CurrentStateFactSchema` :78-87 — SPO triples (`subject/predicate/object`) with temporal validity `validFromChapter`/`validUntilChapter`/`sourceChapter`. `CurrentStatePatchSchema` :96-105 covers exactly **6 fixed slots** (currentLocation, protagonistState, currentGoal, currentConstraint, currentAlliances, currentConflict).
- `HookRecordSchema` :28-51 — 13-column ledger incl. `dependsOn`, `paysOffInArc`, `coreHook`, `halfLifeChapters`, `advancedCount`, `promoted` (optional fields for pre-Phase-7 ledgers).
- `ChapterSummaryRowSchema` :59-70 — 8-column rows.
- Delta protocol `RuntimeStateDeltaSchema` :127-142 — patch + `hookOps{upsert,mention,resolve,defer}` + candidates + summary + `subplotOps`/`emotionalArcOps`/`characterMatrixOps` (loose ops — **dead**, see §12).

Created lazily by `bootstrapStructuredStateFromMarkdown` when absent/invalid; updated every chapter by reducer + `saveChapter`; overwritten every chapter. Human-editable technically (plain JSON) but fragile: strict zod, reducer monotonicity checks, silent rebuild-from-markdown on invalid JSON.

### 3.6 Markdown truth projections (derived; dual-nature — see §4/§5)
**`story/current_state.md`**, **`story/pending_hooks.md`**, **`story/chapter_summaries.md`** — rendered by `state/state-projections.ts` from JSON at every `saveChapter`; seeded at init/import. Parsed tolerantly by `utils/story-markdown.ts` (zh and en header sets both accepted). These are the files prompts actually read. **Manual edits are seen by the next chapter's prompts but do not survive the following `write next`** (verified behavior; detailed in §4.2).

### 3.7 Markdown-only boards
**`story/subplot_board.md`**, **`story/emotional_arcs.md`**, **`story/character_matrix.md`**, **`story/particle_ledger.md`** (numerical genres only) — no JSON twins; updated by key-wise merge of settler output against the original tables (`mergeTableMarkdownByKey`/`mergeCharacterMatrixMarkdown`), so pre-existing rows generally survive merges. `character_matrix.md` in new-layout books is a compat pointer shim; authoritative character sheets are `roles/**`.

### 3.8 Snapshots, memory, consolidation, misc
- **`story/snapshots/<N>/`** — frozen copies of 7 truth md files + `state/*.json`, taken after every persisted chapter (`snapshotStateAt`, `manager.ts:561-597`) and at chapter 0 during init. Authority for all rewind operations (revise baselines, repair baselines, rollback). Append-only per chapter; refreshed only when revising that same latest chapter.
- **`story/memory.db`** (SQLite WAL; `state/memory-db.ts:69-111`) — tables `facts` (SPO + temporal validity), `chapter_summaries`, `hooks`. Fully derived acceleration index: rebuilt after every chapter from snapshots/JSON (`rebuildCurrentStateFactHistory` :3441 replays per-chapter snapshot facts, closing validity intervals when a subject::predicate changes; `rebuildNarrativeMemoryIndex` replaces summaries/hooks); dropped on rollback/delete/import so stale facts cannot leak back (`manager.ts:802-808`). Do not hand-edit.
- **`story/volume_summaries.md`** + **`summaries_archive/vol_*.md`** — consolidation products (`ConsolidatorAgent.consolidate`); canonical for compressed long-span history once created.
- **`story/audit_drift.md`** — ephemeral guidance rewritten/deleted every chapter by `persistAuditDriftGuidance` :3596-3637 (it strips only its own generated block from `current_state.md`).
- **Forecasts** — `story/runtime/narrative-forecasts/<fcId>/*`; append-mostly sandbox; `markStale` flips status only; never touches canonical state.
- **Detection** — `story/detection_history.json` (AIGC detection results, `pipeline/detection-runner.ts:131-156`).
- **Play/interactive-film/translations/materials** — separate stores documented in §1.2; event-log-canonical for play (graph derived by reducer; checkpoint restore rewrites raw logs).

### 3.9 Requested concepts with NO dedicated structure [VERIFIED]
| Concept | Closest existing equivalent |
|---|---|
| Locations | A projection slot in `current_state.md` ("Current Location"/当前位置, `state-projections.ts:166-168`) + role-sheet state lines |
| Relationships (novel side) | Character-matrix columns / `currentAlliances` slot; typed relations exist only in the Play graph (`models/play.ts`) |
| Timeline | None. Summaries trail + snapshot progression approximate it |
| Clues / Secrets / World rules | Clues ≈ hooks; secrets ≈ hook notes; world rules ≈ `book_rules.md` prohibitions + 世界铁律 sections in `story_frame.md` (shim text `architect.ts:822-824`) |
| Continuity files | No such store; `ContinuityAuditor` reads truth files, durable residue = `audit_drift.md` |
| Governed working set | Not persisted — in-memory selection functions (`utils/governed-working-set.ts`); only its trace lands in `.trace.json` |

---

## 4. Canonical Source-of-Truth Architecture

### 4.1 Verified hierarchy

**Canonical structured state is `books/<id>/story/state/*.json`** (`manifest/current_state/hooks/chapter_summaries`). The actual flow traced through code:

```
LAYER A  HUMAN DIRECTION (canonical inputs, read fresh every run, never auto-written)
         author_intent.md · current_focus.md · outline/story_frame.md(+frontmatter) ·
         outline/volume_map.md · roles/** · book_rules.md · fanfic/parent_canon.md
            │   read by: loadPlanningSeedMaterials (utils/planning-materials.ts),
            │   PlannerAgent.planChapter, collectSelectedContext (agents/composer.ts),
            │   WriterAgent fresh reads (writer.ts:147-167), readBookRules (agents/rules-reader.ts:97-131)
            ▼
LAYER B  PLANNING CACHE   planner → PlanChapterOutput → story/runtime/chapter-NNNN.plan.md
            │   composer selects/compresses context → .context.json/.rule-stack.yaml/.trace.json
            ▼
LAYER C  PROSE            WriterAgent phase 1 → chapters/NNNN_title.md   [CANONICAL PROGRESS]
            │             progress authority = contiguous chapter-file chain
            │             (resolveDurableStoryProgress, state/state-bootstrap.ts:384)
            ▼
LAYER D  EXTRACTION       Observer extracts observations FROM THE NEW PROSE (writer.settle 2a)
            │             Settler emits RUNTIME_STATE_DELTA (writer.settle 2b)
            ▼
LAYER E  REDUCTION        arbitrateRuntimeStateDeltaHooks (utils/hook-arbiter.ts:22 — admission
            │             governance, canonical hook ids)
            │             base = loadRuntimeStateSnapshot(story/state/*.json)
            │             applyRuntimeStateDelta (state/state-reducer.ts:25, pure + validateRuntimeState)
            ▼
LAYER F  DUAL PERSISTENCE (ONE atomic set — WriterAgent.saveChapter, agents/writer.ts:663-722)
         ├─▶ story/state/*.json                     ← machine-CANONICAL
         ├─▶ rendered projections ──▶ current_state.md · pending_hooks.md · chapter_summaries.md
         ├─▶ key-wise merges ──▶ subplot_board.md · emotional_arcs.md · character_matrix.md
         ├─▶ particle_ledger.md (numerical genres) · chapters/NNNN.md
            ▼  (persistChapterArtifacts order, pipeline/chapter-persistence.ts:35-77)
         saveChapter → saveTruthFiles (legacy sync only if NO delta) → chapters/index.json
         → audit_drift guidance → snapshotState (snapshots/<N>/) → fact-history replay (memory.db)
```

Answer to "what decides true": **prompts are fed the human-visible markdown, but the arithmetic of what survives to chapter N+1 is decided by the JSON reducer over `story/state/*.json`**, gated by `StateValidatorAgent.validate` before persistence. Two deliberate inversions exist: (a) **bootstrap** seeds JSON *from* markdown when JSON is missing/invalid (`bootstrapStructuredStateFromMarkdown`); (b) **legacy settlements** without a delta rebuild JSON from markdown (`syncLegacyStructuredStateFromMarkdown`, `runner.ts:3411-3427`).

### 4.2 Verified overwrite / rebuild sites (generated-over-manual)

1. **The primary overwrite — markdown trio clobbered by the next chapter.** `WriterAgent.saveChapter` writes `current_state.md`/`pending_hooks.md`/`chapter_summaries.md` from `renderCurrentStateProjection(next.currentState)`-family outputs computed from **JSON + delta** (`agents/writer.ts:665-680`; rendering in `state/runtime-state-store.ts:149-158`) [VERIFIED]. Manual markdown edits fail to propagate because: (a) `bootstrapStructuredStateFromMarkdown` returns valid existing JSON untouched — `loadJsonIfValid` short-circuits with `return existing` (`state/state-bootstrap.ts:195/230/269`; rebuild warnings logged at :405/:426) [VERIFIED]; (b) `currentStatePatch` has only 6 fixed slots (`models/runtime-state.ts:96-105`), so extra facts/notes/hook rows added by hand to markdown have no representation in JSON and vanish from the next render. Escape hatches that DO respect manual edits: deleting/corrupting `story/state/` forces bootstrap to re-seed from the edited markdown; legacy no-delta settlements take markdown direction.
2. **Studio truth editor and agent tool write raw files with no resync [VERIFIED].** `PUT /api/v1/books/:id/truth/:file` (`studio/server.ts:5666`) and `write_truth_file` (`agent-tools.ts` via `interaction/project-tools.ts:530-537`) never touch `story/state/*.json` or `memory.db` — the UI accepts edits the next `write next` erases.
3. **Revise/repair rewind past manual edits.** Baselines come from `story/snapshots/<N-1>/` (`settleChapterState(baselineChapter)` `writer.ts:392-418`; callers `runner.ts:1438-1446`, `:2414-2423`); post-operation `saveChapter` rewrites live truth — manual truth edits made after chapter N are reverted to snapshot(N−1)+new settlement. Older-chapter revise deliberately does NOT touch live truth.
4. **Foundation revise regenerates architecture files** and wipes `roles/**` (`architect.ts:877-882`), replacing hand-tuned sheets with LLM output (recoverable only from the timestamped backup).
5. **Consolidator prunes shared files:** keeps only current-volume rows in `chapter_summaries.md` (older rows archived), re-renders `pending_hooks.md` through parse→render — annotations outside recognized columns are dropped (`agents/consolidator.ts:138+`, `:161+`).
6. **Wholesale resets:** `resetImportReplayTruthFiles` (`runner.ts:3309-3337` — reseeds projections, deletes boards/summaries-archive/ledger, wipes `memory.db*`, `story/state/`, `snapshots/`); `StateManager.restoreState`/`rollbackToChapter` (overwrite 7 truth md files, delete later chapters/snapshots/runtime/drafts, drop memory.db — `manager.ts:648-812`); style regeneration overwrites style assets (`runner.ts:2697`, `:2794`).
7. **Benign/by-design:** `ensureControlDocuments` is write-if-missing; audit-drift strip touches only its own block; prose replacements archive first; `syncChapterWordCounts` adopts manual prose edits into the index.

Safe-to-hand-edit ranking observed today (most→least safe): `author_intent.md`/`current_focus.md` > `chapters/*.md` > foundation set > boards > `particle_ledger.md` > the markdown trio (effectively write-once-view-only once `story/state/` exists).

Versioning reality: schema pinned `schemaVersion: 2` with `migrationWarnings[]`; inflated `lastAppliedChapter` normalized down to durable progress with warning (`state-bootstrap.ts:93-102`); lenient repair of pre-Phase-7 11/12-column hook ledgers (`repairHooksStateInput`, :432). **There is no generic migration framework** — forward compatibility rests on tolerant parsers + rebuild-from-markdown (which is precisely the mechanism behind overwrite site #1).

## 5. State Projection Architecture

`packages/core/src/state/state-projections.ts` renders canonical JSON into human-readable markdown [VERIFIED]:

| Renderer | Output file | Shape |
|---|---|---|
| `renderCurrentStateProjection(state, language)` :128-221 | `story/current_state.md` | Fixed `Field \| Value` table (chapter/location/protagonist/goal/constraint/alliances/conflict via predicate alias sets) + "Additional State" bullet list for remaining facts; `note_N` predicates render as plain bullets |
| `renderHooksProjection(hooks, language, {currentChapter})` :15-72 | `story/pending_hooks.md` | 13-column table (hook_id…promoted) sorted by start/lastAdvanced/id; stale/blocked diagnostic markers appended to the status cell (`computeHookDiagnostics`) |
| `renderChapterSummariesProjection(summaries, language)` :95-126 | `story/chapter_summaries.md` | 8-column table sorted by chapter |

Language behavior: every renderer takes `language: "zh"|"en"` (default `"zh"`) and switches titles/headers/boolean cells — e.g. `# 伏笔池` vs `# Pending Hooks`; `| 起始章节 | 类型 | 状态 |…` vs `| start_chapter | type | status |…`; 是/否 vs true/false (`state-projections.ts:20-32, 99-108, 132-162`). Mirror parsers in `utils/story-markdown.ts` accept BOTH header sets permanently (`parsePendingHooksMarkdown` :48-52, `isCurrentChapterLabel` 当前位置\|current location :205-210), and `state-reducer.ts#applyCurrentStatePatch` orders alias checks according to `manifest.language` :182-220.

Direction of truth (canonical vs view):

```
story/state/*.json  (CANONICAL — reducer output, schema-validated)
        │  renderXxxProjection()
        ▼
story/*.md          (DERIVED human-readable views — regenerated at every saveChapter;
                     parsed back only for bootstrap/legacy/repair paths)
```

Projections are inputs to prompts and Studio display, but they are **not** an independent canon: their content is recomputed from JSON each save. The one asymmetry is bootstrap-time seeding (JSON missing ⇒ markdown becomes the seed source) — the only moment markdown edits become canonical.

## 6. Persistence Architecture

### 6.1 Atomic multi-file commit [VERIFIED]

`commitAtomicFileSet({rootDir, writes, deletes})` — `packages/core/src/utils/atomic-file-set.ts:46-115`:
1. Stage all writes under a temp dir `<rootDir>/.inkos-file-txn-*` (mkdtemp :62).
2. Rename each existing target into `<txnDir>/backup/` (:81-84), recording backups.
3. Rename staged files into final locations; apply deletes.
4. On any error: roll back committed renames and restore backups (:99+); incomplete rollback raises `AggregateError`.
Path-safety (`safeRelativePath`) and duplicate write/delete detection included.

Primary users:
- `WriterAgent.saveChapter` (`agents/writer.ts:628-723`) — ONE set containing: `chapters/NNNN_<title>.md` (+ deletes superseded same-number files with different titles), `story/current_state.md`, `story/pending_hooks.md`, optional `chapter_summaries.md`/boards/ledger, and the four `story/state/*.json` files (:692-712). Prose and truth therefore commit together or not at all.
- Non-latest-chapter revise writes (`runner.ts:1674-1681`), `commitProductionArtifacts` (`production/harness.ts:86-106` — artifacts first, run snapshot published LAST), reference-binding manifests.

Known non-atomic writes (by design where content is rebuildable or append-only): `saveChapterIndexAt` (plain writeFile; index self-heals), `archiveChapterVersion` (append-only), `edit-controller` chapter replacement (archives a version first, then plain writeFile), `snapshotStateAt` copies (redundant per-chapter copies exist), forecast/graph stores.

Residual crash-window fact [VERIFIED]: between backup renames and staged renames, targets exist only inside the txn dir; cleanup runs in a `finally` (graceful unwind only) and **there is no startup scan that restores orphaned `.inkos-file-txn-*` dirs after SIGKILL/power loss**.

### 6.2 Per-chapter persistence ordering

`persistChapterArtifacts` (`pipeline/chapter-persistence.ts:35-77`), called from `_writeNextChapterLocked` after validation:
```
validateChapterTruthPersistence  (StateValidatorAgent compares old vs new state/hooks against prose;
                                  fail ⇒ retrySettlementAfterValidationFailure ⇒ else state-degraded)
→ params.saveChapter()           :35  (atomic set: prose + projections + state JSON)
→ params.saveTruthFiles()        :37  (skipped when state-degraded; legacy sync only if no delta)
→ params.saveChapterIndex(...)   :64  (index upsert incl. tokenUsage/lengthTelemetry)
→ markBookActiveIfNeeded / drift guidance
→ params.snapshotState()         :74  (snapshots/<N>/ frozen copies)
→ params.syncCurrentStateFactHistory() :75  (replays snapshots → memory.db fact intervals)
```
Snapshots (`StateManager.snapshotStateAt`, `manager.ts:561-597`) copy 7 truth markdown files plus the whole `story/state/` dir into `story/snapshots/<N>/`. Restore semantics (`restoreState` :648-708): requires `current_state`+`pending_hooks` in the snapshot; deletes files absent from the snapshot (including structured-state files). Rollback (`rollbackToChapter` :717-812): restores snapshot N, deletes later chapter files/snapshots/runtime/drafts, drops `memory.db*`, rebuilds the index.

---

## 7. Studio Capability Map

Architecture recap: React/Vite SPA + Hono server inside `packages/studio`; server holds one `StateManager(root)` (`server.ts:2556`) and mixes core abstractions (StateManager, PipelineRunner, session/play/film stores) with direct fs access for truth/config browsing behind allowlists (`TRUTH_FLAT_FILES` :3157, role dirs `主要角色|次要角色|major|minor`).

Key verified structural fact: **Studio has NO access to the canonical structured state.** A package-wide search found zero references to `story/state/*.json`, `loadRuntimeStateSnapshot`, or `story/snapshots` anywhere in `packages/studio/src` [VERIFIED]. The UI sees only markdown projections and their lossy client-side parsers.

Capability table:

| DATA / FEATURE | CORE HAS IT? | STUDIO CAN VIEW? | STUDIO CAN EDIT? | WRITE-NEXT USES IT? | NOTES |
|---|---|---|---|---|---|
| Characters (role sheets) | ✅ `roles/**` (+ matrix shim) | ✅ list + full sheet | ✅ truth PUT (allowlisted) | Indirect (via governed context) | allowlist `server.ts:3205` |
| Relationships | ⚠️ matrix columns / play edges only | ⚠️ text only | ⚠️ matrix text | Indirect | No novel-domain relationship type exists |
| Current Facts | ✅ `current_state.json` + md projection | ⚠️ md only (`presentCurrentState`) | ⚠️ md text only | ✅ via memory-retrieval/governed context | **Structured JSON never served** [VERIFIED] |
| Fact History | ✅ `memory.db` facts + interval replay | ❌ | ❌ | ✅ rebuilt after every chapter | Invisible to Studio |
| Hooks (foreshadow ledger) | ✅ `hooks.json` 13-col + promotion metadata | ⚠️ cards; bookkeeping columns dropped client-side (`lib/truth-display.ts#parsePendingHooks`) | ⚠️ raw md via truth PUT | ✅ heavily (arbiter/promotion/validator) | Metadata columns invisible |
| Subplots / Emotional arcs | ✅ md boards | ✅ FoundationSection/TruthFiles | ✅ truth PUT | Seeded/reset by pipeline | Delta ops parsed-but-dead (§12) |
| Timeline | ❌ no type exists | ❌ | ❌ | — | Nothing to expose yet |
| Story Foundation | ✅ frame/map/rules/roles | ✅ cards/browser | ✅ (legacy shims blocked read-only) | ✅ read fresh | |
| Chapter Plan | ✅ `.plan.md`/`.intent.md` | ✅ readonly diagnostics | ❌ (regenerate via POST /plan) | ✅ reused when no --context | |
| Chapter Prose | ✅ | ✅ reader/editor | ✅ `PUT .../chapters/:num` → `executeEditTransaction` (version archive + index update) | ✅ | Manual edit resyncs word counts only on explicit 同步/resync |
| Chapter Summaries/Memos | ✅ md+json | ✅ md browser; memo inside plan view | ✅ md (JSON unexposed) | ✅ fed back via retrieval | |
| Runtime State JSON | ✅ canonical | ❌ | ❌ | ✅ reducer applies deltas | Biggest visibility gap |
| Snapshots | ✅ per chapter | ❌ (only indirect rollback via reject/delete-latest) | ❌ | ✅ taken every chapter | No browse endpoint |
| Audit Results | ✅ index issues + transient payload | ⚠️ badge/analytics counts/alert | Trigger-only (`POST /audit/:chapter`, side-effect-free variant) | ✅ gates review cycle | No report viewer |
| AIGC Detection | ✅ `detection_history.json` + REST endpoints | ❌ pages exist-not-wired | ❌ | Separate detect/rewrite flow | Orphaned-in-UI |
| Forecast | ✅ store + schemas + agent tools | ⚠️ chat tool cards only | ⚠️ branch selection via agent instruction | ⚠️ selected branch can seed next plan | Not in REST surface |
| Memory/Retrieval state | ✅ FTS5/BM25 + trace | ⚠️ `.trace.json` readonly diagnostic | ❌ | ✅ core of composer assembly | |
| Export | ✅ txt/md/epub | ✅ download/save-to-disk | ✅ trigger | n/a | |
| Sessions/chat | ✅ transcript stores | ✅ sidebar/chat page | ✅ rename/delete/abort | n/a | |

Studio CAN trigger generation end-to-end (write-next, draft-only, plan, compose, revise ×5 modes, audit, resync, repair-state, consolidate, foundation revise, imports, daemon start/stop) — button-driven and agent-driven paths land in the same core pipelines.

Mutation inventory highlights: chapter text/version-restore via `interaction/edit-controller.ts#executeEditTransaction`; chapter delete → `.trash/` + `rollbackToChapter`; brief editor; approve/reject (reject ⇒ rollback N−1); truth-file PUT (raw overwrite, shims/diagnostics rejected); book/project settings via config read-modify-write; services/secrets/prompt-packs/skills/genres CRUD; export-save.

---

## 8. Context and Memory Architecture

Two separate LLM-context paths [VERIFIED]:
- **A. Chapter pipeline:** Planner → `ComposerAgent.composeGovernedChapter` builds a governed `ContextPackage`, rendered into writer prompts by `buildGovernedUserPrompt` (`agents/writer.ts:725-812`).
- **B. Interactive sessions:** every turn injects a truth-file compression pack via `createBookContextTransform` (`agent/context-transform.ts`); files ≤6000 chars inline whole (`FULL_INLINE_CHAR_LIMIT`), larger become heading indexes (≤80 headings/file, ≤220 chars each); priority files first, includes `outline/**` and `roles/**`.

Writer context composition (ordered):
1. Per-chapter user brief — highest-priority block (`externalContext`);
2. Direction entries (`author_intent.md`, `current_focus.md`) pulled to front as binding block;
3. Memo narrative block (`renderMemoAsNarrativeBlock`, `utils/narrative-control.ts`);
4. Selected context — `collectSelectedContext` (`composer.ts:572-711`): memo → focus → intent → drift → story_frame/volume_map sections (legacy fallbacks) → parent/fanfic canon → trails (recent titles/mood/endings) → hook debt → facts → summaries → volume summaries → hooks → bound references;
5. Governed evidence blocks (`utils/governed-context.ts`): Recent Title History → Mood/Type Trail → Canon Evidence → Hook Debt Briefs → Selected Hook/Summary/Volume evidence;
6. Rule stack (hard/soft/diagnostic layers, `buildGovernedRuleStack` in `utils/context-assembly.ts`);
7. English variance brief (en only);
8. Length requirement + output format. System prompt adds genre intro, contracts, full `style_guide.md`, style fingerprint digest, book rules.

Selection mechanics (`utils/memory-retrieval.ts`):
- Candidate generation: BM25 FTS5 over `story/memory.db` (`LocalSearchIndex.search`, `bm25(fts,5.0,1.0)`), limit 32; query derived from goal/outline/mustKeep hints.
- Optional LLM semantic re-selection (`ComposerAgent.selectMemoryCandidates/selectOutlineSections/selectReferenceSections`, low temperature); silent fallback to BM25 ordering on failure.
- Deterministic caps: summaries ≤4 (recency window n−3 + top retrieved), facts 4 (priority predicates, score ≥14), hooks ≤8 (active-window ∪ stalest; recyclable-hook silence thresholds 5/8/10 chapters), volume summaries 2, recent endings 3 × last meaningful sentence ≤60 chars. Planner sees only last 320 chars of previous chapter (`readPreviousEndingExcerpt`, `utils/planning-materials.ts:79`); **auditor receives the FULL previous chapter text** (`agents/continuity.ts:624-628`).
- Settlement uses governed working sets: `buildGovernedHookWorkingSet` (selected ∪ agenda ∪ window-5), `buildGovernedCharacterMatrixWorkingSet` (mentioned names + protagonist) — `utils/governed-working-set.ts:10-50`.

Full-file injections (untruncated): focus/intent/audit-drift/current_state/canon files, selected outline sections, reference excerpts, `style_guide.md` (system prompt), full previous chapter (auditor).

Compression that already exists:
- Standing layers: per-chapter summary rows; volume summaries (consolidation); hook-debt briefs distilled from summaries (`buildHookDebtEntries`, `composer.ts:812-874`); style fingerprint digest instead of raw samples.
- Budget-triggered: `applyContextBudgetIfNeeded` (`composer.ts:159-296`) — if estimated tokens exceed `contextWindow − reservedOutput`, protected sources stay verbatim and everything else is replaced by ONE LLM-compiled entry (`compileCompressibleContext`, temp 0.2); protected set defined by `isProtectedContextSource` (`utils/context-assembly.ts:126-142`: memo, focus, intent, drift, frame/bible, map/outline, canon, current_state, pending_hooks, hook debt). Protected overflow ⇒ hard error, never truncation.
- Session-path heading-index substitution (above). Note: `capContextBlock` exists but has **no production caller** (tests/export only).

Structured state over raw markdown [VERIFIED]: retrieval prefers Zod-validated JSON (`loadRuntimeStateSnapshot` → `CurrentStateStateSchema/HooksStateSchema/ChapterSummariesStateSchema`) with markdown parsing only as bootstrap fallback (`utils/memory-retrieval.ts:103-142`); writer settlement emits typed `RuntimeStateDelta`; governance artifacts are schemas; forecast fingerprints hash canonical inputs including `story/state/*.json` (sha256, `computeContextFingerprint`).

Forecast context (`forecast/context-builder.ts#buildForecastContext`): injects full authorIntent/currentFocus/currentState/pendingHooks/frame/map/character context/subplot board + last 8 summaries.

Context Inspector readiness (current instrumentation): per-chapter `.context.json`/`.rule-stack.yaml`/`.trace.json` with protected/compressible token totals, compression records, and retrieval traces (engine, query, candidate scores, semantic selections) — `buildGovernedTrace` (`context-assembly.ts:86-124`); compression callback events subscribed by Studio (`server.ts:2770`); pre-flight `ContextWindowExceededError` carrying estimated input/reserved/window numbers (`provider.ts:580-595`); per-chapter `tokenUsage` in `chapters/index.json`; run journals. Gaps: no per-entry token breakdown; final rendered prompts never dumped; token estimation heuristic (CJK=1 token, non-CJK÷4; `estimateTextTokens`, `provider.ts:506-511`).

## 9. Recovery and Generation Safety

Mechanisms verified present and interlocking (all [VERIFIED] unless noted):

| Mechanism | Implementation |
|---|---|
| Atomic multi-file commit | `commitAtomicFileSet` (§6.1) — prose+truth+JSON commit together |
| Stream integrity | Missing terminal signal ⇒ `PartialResponseError` (`provider.ts:1140-1147/1266-1272/1400-1429/1687-1712`); interrupted content regenerated wholesale, never salvaged (explicit comments `provider.ts:413-431`) |
| Transport retries | `TRANSIENT_LLM_RETRIES=2` (3 attempts), linear backoff 800 ms×(attempt+1) (`provider.ts:41,763-788`); retryable: partial responses, empty responses, transport errors, HTTP 429/502/503/504 phrases; bare 500 / MODEL_NOT_AVAILABLE deliberately NOT retried; retries disabled while streaming deltas |
| Domain retries | Planner memo ×3 with error feedback then degraded-valid memo; settlement validation failure ×1 (`retrySettlementAfterValidationFailure`, `chapter-state-recovery.ts:49-112`); review iterations `writingReviewRetries` default 1; sqlite-busy ×3 delays [VERIFIED constants] |
| Empty responses | Throw everywhere ("LLM returned empty response"); reasoning-only throws; runner asserts non-empty prose per stage (`assertChapterContentNotEmpty` `runner.ts:3394`); reviser empty ⇒ throw; review cycle exits when revision produces nothing new |
| Output-limit handling | `finish_reason length` / `max_tokens` / `response.incomplete` ⇒ `PartialResponseError(reason:"output-limit")` ⇒ one full retry, then loud failure |
| Context-window policy | Pre-flight `assertWithinContextWindow` ⇒ `ContextWindowExceededError` with numbers; no silent truncation; composer-side budget compression runs before this guard is needed |
| Stream deadlines | First-event 120 s (300 s pipeline agents), idle 90 s (180 s); env overrides `INKOS_LLM_FIRST_EVENT_TIMEOUT_MS`/`INKOS_LLM_STREAM_IDLE_TIMEOUT_MS` |
| State-degraded recovery | Failed settlement ⇒ body saved, OLD truth restored (`buildStateDegradedPersistenceOutput`, `chapter-state-recovery.ts:164-179`), review note recorded (:187/:198), snapshots skipped; `assertNoPendingStateRepair` blocks further writes (`runner.ts:3244-3254`); repairs: `write repair-state` (settlement-only re-run :2387), `write sync` (resettle from externally edited body :2513) |
| Rewrite safety | All gates precede any write (in-memory generation/validation/audit/gate first); old draft archived to `.versions` BEFORE overwrite (:1663); failing revision gate ⇒ `applied:false` with ZERO writes; failed commit rolls back atomically |
| Chapter-state recovery | Snapshot-based baselines for revise/repair; `loadRuntimeStateSnapshotAtChapter` prefers `snapshots/<N>/state/*.json` and falls back to parsing snapshot markdown (`runtime-state-store.ts:56-112`) |
| Snapshots/rollback/trash/backups | §3.8/§6.2; whole-book backups outside `books/` with pre-restore auto-backup (`cli/src/book-backup.ts`) |
| Concurrency | `acquireBookLock` wraps all mutating ops (PID liveness, stale takeover, heartbeat) |
| Manual review checkpoint | `chapterReviewMode:"manual"` stops right after draft persistence; forced auto for unattended `inkos auto` |

**Can a failed rewrite or later pipeline stage destroy a valid draft? No** [VERIFIED write-order trace of `reviseDraft` :1350-1757]: generation, settling, validation, post-audit and gate evaluation all occur in memory; archive precedes replace; commits roll back; audit is read-only except index metadata and `audit_drift.md`; truth updates are validator-gated with old-truth preservation in degraded mode; snapshots are written after success.

Residual risks (documented facts, not defects assigned for fixing): orphaned `.inkos-file-txn-*` txn dirs after hard kill (no startup scan); superseded same-number chapter files with changed titles deleted unarchived in `saveChapter` (recoverable only from snapshots/backups); CLI `write rewrite` hard-deletes later chapters without versioning (confirm/`--force` gated, snapshot check required); non-atomic single-file writes where content is rebuildable/append-only (§6.1).

---

# PART III — LANGUAGE, RISKS, CLASSIFICATION

## 10. Language Architecture

Universal model [VERIFIED]: language is a hard two-value enum everywhere — `ProjectConfigSchema.language` (`models/project.ts:134`, default `"zh"`), `BookConfigSchema.language` (optional), `RuntimeStateLanguageSchema` (`models/runtime-state.ts:3`), `LengthCountingModeSchema = z.enum(["zh_chars","en_words"])` (`models/length-governance.ts:3`), `CliLanguage` (`cli/localization.ts`), `TuiLocale = "zh-CN"|"en"` (`cli/tui/i18n.ts`), `AppLanguage` (`studio/lib/app-language.ts`), `PlayWorld.language`, `ForecastSchema.language`. **No `vi` handling exists anywhere**; the sole occurrence of "Vietnamese" is a free-text translation-target preset string (`studio/src/pages/TranslationManager.tsx:118`). `detect.ts` is AIGC detection (GPTZero-style), not language detection.

Resolution and propagation: project default ← book override (`book.json.language`) ← genre frontmatter (`GenreProfileSchema.language`, default zh); resolved per run by `PipelineRunner.resolveBookLanguage` (`runner.ts:478-500`), which selects every zh/en prompt branch, the counting mode, control-doc templates, and projection rendering. Chat path: session language → `propose_action.createBook.language ?? session ?? inferLanguage(instruction)` (`agent-tools.ts:1007`). Studio UI language follows the same project field today (one field drives both content and chrome); CLI output language is env-driven separately.

Verified language-dependent mechanisms:

| Area | Symbol/File | Behavior |
|---|---|---|
| Length counting | `LengthCountingModeSchema` (`length-governance.ts:3`); `countChapterLength`/`resolveLengthCountingMode`/`formatLengthCount` (`utils/length-metrics.ts`; `${count}字` vs `${count} words` :43); defaults `DEFAULT_CHAPTER_LENGTH_ZH=3000`/`EN=2000` | Char-count for zh, word-count for en; mode persisted in telemetry/snapshots; drives write-loop gating |
| Language inference | `inferLanguage` (`utils/language.ts`) — CJK `[一-鿿]` vs Latin counts, defaults `"zh"` [VERIFIED] | Used at book creation from chat/CLI; three inline duplicates exist (`consolidator.ts:168`, `architect.ts:1281`, `planner.ts containsChinese`) |
| Slugs | `deriveBookIdFromTitle` (`utils/book-id.ts:3-11`) keeps only `[a-z0-9\u4e00-\u9fff]` [VERIFIED]; duplicated in `studio/api/book-create.ts:36`, `server.ts:1689/6058` | **Vietnamese diacritics would be stripped** from book IDs today |
| Index rebuild | `rebuildChapterIndexFromFilesAt` wordCount = whitespace-stripped CHAR count regardless of language (`state/manager.ts:519` area) [VERIFIED]; default title template `第N章` | English books get char counts after reconstruction (latent inconsistency) |
| Prompts | Parallel zh/en builders for every agent: architect :202/:408, foundation-reviewer, planner-prompts, writer-prompts (+`agents/en-prompt-sections.ts` Royal Road/KU framing), reviser, polisher, observer/settler LANGUAGE-OVERRIDE prefixes, short-fiction/script/storyboard/play/forecast | English is complete end-to-end; zh branches would be the replacement targets for vi |
| Parsers | Bilingual fallbacks: `chapter-memo-parser.ts` REQUIRED_SECTIONS pins exact zh headings AND their EN translations; `writer-parser.ts` 第N章/正文 vs Chapter N/content; `story-markdown.ts` accepts both header sets | Prompt-wording ↔ parser coupling (§13) |
| Projections | `state-projections.ts` zh/en header switching (§5) | File FORMAT is bilingual forever |
| Bootstrap asymmetry | `resolveRuntimeLanguage` defaults `"en"` when book.json unreadable (`state/bootstrap.ts:374-380`) | Inconsistent with zh-default elsewhere |
| CLI/TUI/Studio i18n | `localization.ts` (default zh), `tui/i18n.ts` (default zh-CN), `use-i18n.ts` (~400-entry zh/en table), `LanguageSelector.tsx` 中文-first cards | Complete zh+en pairs; defaults matter for the fork |
| Tests | `short-fiction-en.test.ts` asserts zero-CJK in en prompts; localization/TUI/progress tests pin zh defaults | Tripwires for any language change |
| Anti-fatigue | `EnglishVarianceBrief` (`utils/long-span-fatigue.ts`) — en only | Injected only for en books (`writer.ts:189`) |
| Translation subsystem | `core/src/translation/*` — free-text source/target languages | Only genuinely language-neutral subsystem today |

## 11. Chinese Dependency Inventory (A–E)

Classification labels (as directed): **A** language-neutral already · **B** Chinese-specific, candidate to replace/generalize · **C** Chinese-specific, candidate to remove · **D** temporary compatibility concern · **E** needs further investigation. This is an inventory, not a migration plan.

| # | Component (path · symbol) | Class | Notes |
|---|---|---|---|
| 1 | `utils/language.ts#inferLanguage` + 3 inline CJK detectors | B | zh-default heuristic; central to auto-created projects |
| 2 | `models/length-governance.ts` `zh_chars`/`en_words` | B | Persisted enum; third mode touches schema + all persisted artifacts |
| 3 | `utils/length-metrics.ts` count/format + defaults | B | Core of write-loop length gates |
| 4 | `state/manager.ts:519` rebuild char-count | E | Ignores counting mode; latent bug on non-zh books |
| 5 | `models/book.ts` `chapterWordCount` floor/calibration; PlatformSchema 番茄/起点/飞卢 | B / D | Platform enum is Chinese-market-specific but harmless legacy data |
| 6 | `agents/architect.ts` `buildChineseFoundationPrompt` :202 / rhythm rubric / localized shims :820-846 | B / D | En branch reusable as template |
| 7 | `packages/core/genres/*.md` — 5 zh-default genres (恐怖/都市/仙侠/玄幻/通用), 10 en genres | B/D | Mixed-language corpus |
| 8 | `agents/planner-prompts.ts` zh/en memo templates; `utils/chapter-memo-parser.ts` pinned headings | B | Parser contract coupling (§13) |
| 9 | `agents/writer-prompts.ts` / `en-prompt-sections.ts` / `writer.ts` localized logs, length blocks, PRE_WRITE needles; `writer-parser.ts` zh fallbacks/placeholders | B | `=== TAG ===` anchors themselves are language-neutral |
| 10 | `utils/writing-methodology.ts` buildChineseMethodology (去 AI 味/了字控制…) vs buildEnglishMethodology | B | Injected into style_guide at init |
| 11 | `utils/long-span-fatigue.ts` EnglishVarianceBrief (en-only) | B | No vi equivalent exists |
| 12 | `agents/continuity.ts` zh audit rubric (12 结构类雷点) + en variant; `tryParseAuditJson(json, language)` | B | Rubric authored in Chinese; severity vocabulary is downstream-coupled (§13) |
| 13 | `agents/foundation-reviewer.ts` zh/en review prompts + localized dimension labels | B | |
| 14 | `agents/post-write-validator.ts` per-language rules, ngram 6-char zh, title-qualifier extractors | B | Nothing for Vietnamese diacritics |
| 15 | `agents/sensitive-words.ts` China regulatory wordlists | C | China-censorship-specific |
| 16 | `agents/ai-tells.ts` {zh,en} lexicons + 。！？ sentence split; `agents/style-analyzer.ts` char-based TTR for zh | B | Lexicon extension point |
| 17 | `agents/polisher.ts` buildChineseSystemPrompt ±15% 字数 rule | B | Agent currently unwired (§12) |
| 18 | `agents/reviser.ts` isEnglish branches + legacy prompt :502 | B/D | |
| 19 | `agents/settler-prompts.ts` / `observer-prompts.ts` 【LANGUAGE OVERRIDE】prefixes + zh defaults | B | |
| 20 | Short-fiction stack: `prompts/short-fiction.ts`, `pipeline/short-fiction-runner.ts` (zh defaults, 中文封面 cover briefs), `agents/short-fiction.ts` counting modes | B | |
| 21 | Script/storyboard/interactive-film stacks: language params, `interactive-film/export-html.ts:86` hardcoded `<html lang="zh">` | B | Cosmetic-but-baked-in labels; epub exporter emits lang per language |
| 22 | Play subsystem: `play-store.ts` persisted world language, four zh/en prompt-builder families | B/D | Persisted worlds pin language |
| 23 | Forecast: `schema.ts` language enum; `prompts.ts:65` passes hardcoded `"zh"` | E | Suspicion: en-book forecasts may receive zh-shaped instructions — unproven |
| 24 | Truth-file format bilingualism: `state-projections.ts`, `utils/story-markdown.ts`, `state-reducer.ts` alias order | D | Old books have zh-headed files forever; parsers must accept both permanently |
| 25 | `models/runtime-state.ts` persisted `manifest.language` | D | Data-format compat |
| 26 | `state/bootstrap.ts` runtime-language default "en" asymmetry | E | |
| 27 | Name/ID utilities keeping CJK: `utils/book-id.ts`, `utils/context-filter.ts` cnRegex, `utils/hook-ledger-validator.ts`, `utils/hook-arbiter.ts` chineseTerms, `utils/memory-retrieval.ts` aliases, `utils/chapter-cadence.ts`, `utils/governed-working-set.ts#containsHan` | B | Slug issue is the highest-impact item (four slugifier sites) |
| 28 | Import/platform: `第X回` classical heading splits, full-width （） parsing, `agents/radar-source.ts` 起点/番茄 scrapers | B / C | Radar is platform-specific scraping |
| 29 | Providers: 18 `group:"china"` endpoint tags; studio `constants/service-groups.ts` 国产原厂 labels | D | Harmless catalog; tests assert it |
| 30 | Translation subsystem | A | Free-text languages; only multilingual-ready subsystem |
| 31 | CLI: `localization.ts` (~40 bilingual formatters, default zh); `--lang` options across init/config/book/fanfic/genre/short-fiction (default zh) | B | |
| 32 | TUI: `tui/i18n.ts` locale resolution default zh-CN; effects/setup/dashboard locale branches | B | |
| 33 | Studio: `hooks/use-i18n.ts` zh/en table; `lib/app-language.ts`; `pages/LanguageSelector.tsx` 中文创作 cards; `BookCreate.tsx` PLATFORMS_ZH/EN + 3000/2000 defaults; `ImportManager.tsx` 中文 option; ~20 `book.language==="en"` ternaries; `lib/truth-display.ts` zh relabeling | B | |
| 34 | Studio↔server protocol: `server.ts` PIPELINE_STAGES/AGENT_LABELS/TOOL_LABELS keyed by zh strings; `ProgressSection.tsx` matches backend SSE log text by exact zh string (:8-31) [VERIFIED bilingual tables]; chat store zh stage-name keys | B | De-facto protocol; localizing one side breaks the other (§13) |
| 35 | Agent system prompt/tool descriptions: `agent-system-prompt.ts` giant zh prompt + en variants; `agent-tools.ts` zh-biased descriptions, charsPerChapter ranges | B | |
| 36 | Tests asserting Chinese behavior (progress-text, localization, tui-i18n, dashboard, genre-command, writer-parser, chapter-splitter 第X回, consolidator full-width parens, draft-directive 每章字数, agent-tools-params zh inference, providers-group china, models normalize 起点, state-projections, short-fiction-en zero-CJK assertions…) | B | Intentional tripwires; update intentionally in any migration |
| 37 | Docs: `README.md` (zh primary) + `README.en.md` + `README.ja.md`; CHANGELOG zh/en; CONTRIBUTING (stale: "Node ≥ 20", "22 commands" vs actual ≥22/34 commands) | B/C | ja likely remove later |
| 38 | `llm/provider.ts:865` non-ASCII API-key error mentioning pasted Chinese notes | A | Message text only |

## 12. Incomplete / Vestigial Systems

Verified live-vs-present status (risk explanations only; cleanup is not proposed here):

1. **`subplotOps` / `emotionalArcOps` / `characterMatrixOps` — parsed but NEVER applied.** Defined on `RuntimeStateDeltaSchema` (`models/runtime-state.ts:138-140`) as loose ops; grep of `state/state-reducer.ts` finds **zero references** to these three fields [VERIFIED]. The boards themselves (`subplot_board.md`, `emotional_arcs.md`, `character_matrix.md`) ARE live — updated via a separate legacy path (key-wise markdown merge of settler output in `writer.ts:604-619`, conditional writes :682-690) — but the structured delta protocol for them is dead surface. Risk: anyone assuming the delta protocol covers these boards will mis-implement consumers/editors; the boards' actual write path is the merge path.
2. **`PolisherAgent` — exported, tested, UNWIRED.** `agents/polisher.ts:32` class exists; production callers: none (grep shows only `core/src/index.ts:516` export and test files) [VERIFIED]. Auditor prompts still reference a "Polisher pass", which does not exist in the pipeline. Risk: documentation/prompts imply a polish stage that never runs.
3. **`models/state.ts` — vestigial.** `CurrentState/ParticleLedger/PendingHooks/LedgerEntry` types have **zero internal importers**; referenced only by the barrel re-export (`core/src/index.ts:5`) [VERIFIED]. Superseded by `models/runtime-state.ts`. Risk: importing these types suggests a live schema that nothing consumes.
4. **Broken script:** root `package.json` `benchmark:studio-e2e` → nonexistent `scripts/studio-e2e-benchmark.mjs` [VERIFIED].
5. **Stale docs:** CONTRIBUTING.md states Node ≥ 20 and 22 commands; actual engines require ≥22 and there are 34 top-level commands.
6. **Orphaned-in-UI feature:** AIGC-detection REST endpoints exist in Studio (`POST /books/:id/detect/:chapter`, `/detect-all`, `/detect/stats`, `server.ts:5643-5833`) but no Studio page calls them; `detection_history.json` appears in truth listings yet is not GET-readable (not in allowlist).
7. **Dead helper:** `capContextBlock` (`utils/context-filter.ts:21`) has no production caller.
8. **Name collisions / misnomers (orientation hazards, not defects):** two state validators (`state/state-validator.ts` pure vs `agents/state-validator.ts` LLM); `interactive-film/paths.ts` enumerates graph paths, not filesystem paths; `brief.md` (book-level) vs `chapter-NNNN.user-brief.md` (per-chapter).

## 13. Coupling and Migration Risks

Dangerous files/modules where casual edits break things (each verified during the audit; blast radius stated as observed):

1. **`utils/chapter-memo-parser.ts` ↔ `agents/planner-prompts.ts`** — REQUIRED_SECTIONS pins the exact nine zh headings and their EN twins copied from the prompts. Any wording change ⇒ `PlannerParseError` ⇒ every write-next fails at plan stage (after 3 retries, degraded memo). Radius: entire write pipeline, planner tests.
2. **`agents/writer-parser.ts` ↔ writer/reviser prompts** — `=== TAG ===` anchors (CHAPTER_TITLE/PRE_WRITE_CHECK/CHAPTER_CONTENT/UPDATED_STATE/RUNTIME_STATE_DELTA…) are a prompt-parser protocol. Drift silently empties chapters (>100-char fallback guard) or drops state/ledger/hook updates. Radius: writer, chapter-analyzer (shares parser), full pipeline test suite.
3. **Bilingual truth-file trio — `utils/story-markdown.ts` + `state/state-projections.ts` + `state/state-reducer.ts`** — old books carry zh-headed files permanently; new books may get en; parsers must accept both forever. Radius: hook parsing, POV filter (`utils/pov-filter.ts:107` keys off hook_id rows), governed working set, memory retrieval, consolidator, forecast context, ALL legacy-book reopens.
4. **`models/runtime-state.ts`** — `schemaVersion: z.literal(2)` and the language enum drive loading of every existing project; loosening/tightening breaks `loadRuntimeStateSnapshot`; `manifest.language` orders reducer alias checks.
5. **`studio/src/api/server.ts`** (≈6.6k lines) — SSE `log.message` strings matched BY EXACT zh TEXT in `components/sidebar/ProgressSection.tsx` [VERIFIED bilingual matcher tables]; PIPELINE_STAGES keys duplicated server/client; truth-file allowlist must stay in lockstep with core role-dir scanning and what the architect actually writes; `currentProjectLanguage` caching. Radius: entire Studio frontend, e2e suites.
6. **`agent/agent-tools.ts` + `interaction/action-envelope.ts`** — zod range validation (charsPerChapter union; zh 900–1200 vs en 600–800 superRefine) must match prompt-side guidance and short-fiction constants. Radius: Studio chat creation flows, confirmations.
7. **Legacy/migration cluster — do not touch casually:** `cli/src/utils.ts#getLegacyMigrationHint` + `doctor.ts` (pre-v0.6 auto-migrate on next write); `agents/rules-reader.ts` (story_frame frontmatter → legacy book_rules shim fallback, refuses to zero rules); `agents/composer.ts` outline fallback :886-927; `agents/architect.ts` legacy-section acceptance + revise-mode regression refusal; `llm/config-migration.ts`; `llm/secrets.ts` siliconflow→siliconcloud id migration. Radius: reopenability of existing books.
8. **Slugifiers ×4** — `utils/book-id.ts`, `studio/api/book-create.ts:36`, `server.ts:1689`, `server.ts:6058` keep only `[a-z0-9\u4e00-\u9fff]` [VERIFIED]. Vietnamese diacritics fall outside the class and would be stripped. Any language generalization must change all four in lockstep (plus `deriveBookIdFromTitle` callers). Radius: book naming, active-book references, backups, Studio URLs.
9. **`utils/length-metrics.ts` + `models/length-governance.ts`** — counting mode is persisted in telemetry/snapshots; changing thresholds/modes invalidates historical telemetry and mid-book hard-range gates. Latent trap: index rebuild ignores counting mode (§10 #4). Radius: write-loop gates, chapter-word-sync, status/review CLIs.
10. **`agents/continuity.ts` vocabulary** — severity (`critical|warning|info`) and `repair_scope` values are consumed by revision gating (`resolveRevisionGate`), auto-rewrite loops, scheduler quality gates, dashboards/analytics grouping. Rewording categories breaks downstream consumers.
11. **Studio↔chat stage-name protocol** — ProgressSection zh strings, chat store zh stage keys, server pipeline-stage outputs form one de-facto protocol; localizing one side leaves progress permanently pending.
12. **Tests as contracts** — `short-fiction-en.test.ts` (zero-CJK assertion), script-storyboard en specs, if-film-en defaults, tui-i18n/localization zh defaults: intentional tripwires; weaken only deliberately.

Cross-cutting blast-radius summary: `write next` (items 1,2,3,4,9,10) · Studio (5,11) · CLI (7,36) · existing books (3,4,7,24,25) · snapshots/state reconstruction (4,9) · audit (10) · context (2,3) · language behavior (1,8,9) · providers (29 — inert) · migrations (7).

## 14. Existing-Component Classification

Relative to `PROJECT_VISION.md` / `V1_SPEC.md` principles ("preserve and expose; reuse before duplicate"). Describes the CURRENT architecture; not an implementation plan.

**KEEP** (working; preserve):
- Safety machinery: `commitAtomicFileSet`, `PartialResponseError` stream-integrity, retry ladder, `ContextWindowExceededError` pre-flight, state-degraded mode + recovery commands, snapshots/rollback/trash/versions/backups, durable-progress resolution, book locking, run journals. (Directly matches V1_SPEC §6/§39/§40.)
- Storage formats and layout (`books/<id>/…`, `story/state/*.json`, projections) — data formats excluded from change.
- Provider abstraction (`createLLMClient`, endpoint bank, secrets, config migration), streaming, pi-agent harness.
- Retrieval kernel (`LocalSearchIndex` FTS5/BM25) and `MemoryDB`.
- Governed-context architecture (planner→composer→writer, protected-source budgeting, trace dumps).
- Forecast subsystem (its never-touches-canon boundary matches vision §20 exactly).
- Direction/control-doc mechanism (`writeIfMissing`, authority classes).
- CLI/TUI command surface; export builder; notify dispatcher.
- Legacy-layout readers/shims and migrations (compatibility obligation toward existing books).

**KEEP + EXPOSE** (exists in core; invisible or lossy in Studio today):
- `story/state/*.json` structured runtime state (SPO facts with temporal validity, full 13-column hook ledger incl. causality/promotion metadata, chapter-summary rows).
- `memory.db` fact history and temporal intervals.
- Snapshot browsing (today only indirect rollback).
- Governed context traces (`.context.json`/`.rule-stack.yaml`/`.trace.json`, token budgets, retrieval traces) — the natural substrate for the deferred Context Inspector (V1_SPEC §38 defers it; classification unaffected).
- Detection-history endpoints (exist server-side, unused by UI); full audit payloads (currently alert/badge only); volume summaries; forecast REST surface (currently chat-only).

**MODIFY EVENTUALLY** (current state requires eventual modification to serve the Vietnamese+English target — per V1_SPEC §22-§34; listed descriptively, no sequencing implied):
- Language enums across core/CLI/TUI/Studio (`"zh"|"en"` unions); `LengthCountingModeSchema` third word-oriented mode; `inferLanguage` + three inline CJK detectors; four slugifier sites (diacritics); per-language lexicons (`ai-tells`, `post-write-validator`, `style-analyzer`); zh prompt branches (clone-from-en pattern); CLI/Studio language defaults and new-project choices; genre-profile language defaults; zh-first copy in `LanguageSelector`/i18n tables.

**REFACTOR EVENTUALLY** (functional today; structure is the constraint):
- Mega-modules: `pipeline/runner.ts` (≈3.9k lines), `agent/agent-tools.ts` (≈3.8k), `studio/api/server.ts` (≈6.6k), `agent/agent-session.ts` (1.4k) — high blast radius, no functional deficiency identified.
- The missing human-edit resync path: markdown-trio edits are clobbered (§4.2 #1/#2) — closing this gap is where human-owned-canon work will land; noted as the architecture's principal design gap relative to the vision, not a task assignment.
- Atomicity inconsistency: writer/harness/reference-manifests use atomic sets while edit-controller/graph/forecast/single-file state writers do not (§6.1).

**REPLACE ONLY IF NECESSARY:** none identified. Every vision-critical capability (automation chain, state tracking, audit, recovery, exports, Studio, CLI, providers) has a working implementation.

**REMOVE LATER** (present in source; not load-bearing; removal explicitly not urgent and not part of any current task):
- Dead delta-op fields (`subplotOps`/`emotionalArcOps`/`characterMatrixOps`), `PolisherAgent` wiring question, `models/state.ts`, `capContextBlock`, broken benchmark-script reference, `README.ja.md`, China-specific items classified C in §11 (#15, #28-radar) — each requires the verify-reader/writer/reducer/persistence/consumption discipline before any exposure work relies on them.

## 15. Remaining Unknowns

Genuine technical unknowns the audit could not prove from source:

1. **Forecast language behavior:** `forecast/prompts.ts:65` passes hardcoded `"zh"` regardless of book language — whether en-book forecasts receive zh-shaped JSON instructions was suspected but not proven (would require executing the flow).
2. **FTS5 tokenizer treatment of Vietnamese:** `retrieval/local-search.ts` documents ICU-tokenization caveats for Chinese compounds; behavior with Vietnamese diacritics/tone marks is untested (likely fine — space-delimited — but unproven).
3. **Real-world prevalence of legacy-layout books** beyond test fixtures — determines the practical weight of the legacy-compat cluster.
4. **`chatWithSearch` coverage** for eraResearch genres on providers other than OpenAI-native/Tavily injection.
5. **Full behavioral parity of Studio audit vs CLI audit** beyond the verified index/drift divergence (scoring/inputs assumed same auditor construction; not diffed end-to-end).
6. **kkaiapi trajectory headers** (`llm/agent-trajectory.ts`) — emitted only for one aggregator endpoint; relevance to this fork unevaluated.
7. **Root cause of the 2 Windows symlink EPERM test failures** (`skill-agent-tool.test.ts`) — declared known-environment baseline; not investigated per task constraints.

## 16. Product Decisions

Decisions the code cannot determine. Where `V1_SPEC.md` has already decided, the decision is recorded as APPROVED (context only — not reinterpreted); the remainder are open questions the audit surfaces.

Already approved (defined in `docs/V1_SPEC.md`; listed here only as audit-relevant context):
- Default/new-project story language: Vietnamese; supported set vi + en; Chinese not retained as a legacy story language — Chinese projects are migrated (translated content, stable identifiers preserved).
- `story/state/*.json` is the canonical state to build on; no independent Canon database; projections are views, not canon.
- Mandatory post-chapter state review as a chapter gate (NEEDS_STATE_REVIEW → READY); accept/edit/reject/add-manual controls; explicit-event rejection warning; no automatic historical prose rewrite; time-aware corrections forward-only.
- Preserve automation, persistence safety, recovery, provider architecture, ComposerAgent/context infrastructure; Context Inspector deferred; Studio UI may remain English; internal technical state READ_ONLY/SYSTEM_MANAGED; dead systems require verify-before-expose.

Open questions code alone cannot answer (recorded, not invented):
1. Whether any state changes should bypass the mandatory review gate (vision allows "minor safe changes automatic"; V1 mandates a gate for important changes — the boundary taxonomy between those two is undefined).
2. How "EXPLICIT STORY EVENT vs AI INFERENCE" (V1_SPEC §16) should be detected/represented given today's extraction produces neither marker.
3. Representation choice for timeline-like state (no first-class type exists; options include staying within summaries/snapshots vs extending structured state) — an implementation-plan decision constrained by the reuse rule.
4. Exact Vietnamese slug format (V1_SPEC §34 explicitly defers to the implementation plan).
5. Target model/context budgets that would size any future per-block token accounting (relevant only when the deferred Context Inspector is revisited).

---

## Appendix — Verification Index (claims re-checked first-hand during consolidation)

| Claim | Verified against |
|---|---|
| Canonical JSON untouched when valid; rebuild only when invalid/missing | `state/state-bootstrap.ts` `loadJsonIfValid` `return existing` :195/:230/:269; warnings :405/:426 |
| Subplot/emotional/matrix delta ops never applied | grep of `state/state-reducer.ts` — zero matches |
| Projection rendering from JSON, zh/en switching | `state/state-projections.ts` full read |
| Atomic commit mechanics | `utils/atomic-file-set.ts` :62/:64/:81-84/:99; `agents/writer.ts:628-723` writes incl. state JSON :692-712 |
| Retry/error constants | `llm/provider.ts` :41 (`TRANSIENT_LLM_RETRIES=2`), :418 (`PartialResponseError`), :434/:589 (`ContextWindowExceededError`) |
| Persistence ordering | `pipeline/chapter-persistence.ts` :35-77 |
| State-degraded machinery | `pipeline/chapter-state-recovery.ts` :49/:164/:187/:198 |
| Studio blind to canonical state | grep of `packages/studio/src` — zero refs to `story/state/*.json`/`loadRuntimeStateSnapshot`/`snapshots`; anchors `server.ts:2554/:2556/:3157` |
| Studio audit divergence | `server.ts:5321` constructs `ContinuityAuditor` :5338; nearby `saveChapterIndex` calls belong to approve/reject |
| Language enums/defaults | `models/project.ts:134`, `models/book.ts:63`, `models/runtime-state.ts:3`, `models/length-governance.ts:3`, `test-project/inkos.json` |
| Slugifier CJK-only class | `utils/book-id.ts:3-11`; `inferLanguage` in `utils/language.ts` |
| Index-rebuild char counting | `state/manager.ts` rebuild path (`wordCount: content.replace(/\s+/g,"").length`, default title `第N章`) |
| PolisherAgent unwired | grep across `packages/` — only barrel export + tests |
| `models/state.ts` vestigial | grep — only `core/src/index.ts:5` references |
| Broken benchmark script | `Test-Path scripts/studio-e2e-benchmark.mjs` = False; root package.json script present |
| Bare CLI launches Studio | `program.ts:62-64` action → `launchStudioEntry(cwd,"4567")` |

*End of audit record.*
