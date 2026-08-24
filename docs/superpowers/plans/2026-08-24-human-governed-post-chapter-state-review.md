# Human-Governed Post-Chapter State Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert mandatory human governance between the existing post-chapter proposed RuntimeStateDelta and Canon application, with durable review/recovery workflow, atomic confirmation, Studio review UI, and Core-level advancement gating.

**Architecture:** Reuse the existing Observer → Settler → RuntimeStateDelta → applyRuntimeStateDelta engine. Phase 4 captures the proposed delta before application, persists a non-Canon review workflow, compiles human decisions back into a confirmed RuntimeStateDelta, and applies it through the existing reducer in one authoritative confirmation transaction. Studio owns UI/HTTP orchestration; Core owns semantics; CLI/pipeline share the Core advancement gate.

**Tech Stack** (as discovered in repo — no new dependencies): Node 22 + TypeScript (strict), pnpm 9 workspaces, Zod schemas (`packages/core/src/models/*`), vitest per-package, Hono server in `packages/studio/src/api/server.ts`, React 19 + hand-rolled `useState` page-model pattern in `packages/studio/src/pages/*`, Commander CLI in `packages/cli/src/commands/*`.

**Spec (binding):** `docs/superpowers/specs/2026-08-24-human-governed-post-chapter-state-review-design.md`

---

## 0. Ground rules for every task

- Suites run **strictly sequentially** on this machine (load-induced flake precedent). Never parallelize `pnpm --filter … test`.
- TDD: RED run must fail for the named reason before GREEN.
- Known baseline (never "fix" in Phase 4): exactly 2 failures in `packages/core/src/__tests__/skill-agent-tool.test.ts` (Windows symlink EPERM).
- All filesystem-purity assertions use `captureBookMetadata(root)` from `packages/core/src/__tests__/helpers/canon-fixture.ts` (sha256+size+mtimeMs whole-tree map, deep-equality compare).
- Fixtures: `createCanonBook({seedSnapshotsThrough: 12})` from the same helper module (facts: 主角/当前位置 closed@10 + open 东城公寓@11, 主角状态 open@12, 林晚/身份 open@4).
- Never feed anything under `story/runtime/` to Writer-context builders; never write Canon outside `story/state/*.json`.

## File / Responsibility Map

**New Core files**

| File | Responsibility (ONE each) |
|---|---|
| `packages/core/src/models/state-review.ts` | Zod schemas + TS types: workflow shell vs active proposal vs receipt, ReviewItem envelope, decisions, evidence levels, typed error codes/result types, `fnv1a8`, stable item-id helper |
| `packages/core/src/utils/prose-revision.ts` | `computeProseRevision(content: string): string` — deterministic 16-hex prose fingerprint |
| `packages/core/src/state/state-review-store.ts` | Load/save workflow shell + active proposal artifact; receipt store (by reviewId, by chapter); system supersede transition |
| `packages/core/src/state/state-review-items.ts` | PURE converter `buildStateReviewItems(delta, ctx)` → ReviewItem[] incl. evidence quote extraction + unsupported-op notes |
| `packages/core/src/state/state-review-service.ts` | Decision mutations (accept/edit/reject/add/remove/rejectAll) with reviewRevision CAS; prose-save invalidation (`handleStateRelevantProseSave`); rebuild orchestration (`rebuildStateReview`) |
| `packages/core/src/state/state-review-confirm.ts` | `prepareStateReviewConfirm` (pure) + `confirmStateReview` (locked authoritative txn + idempotency + derived-memory sync) |
| `packages/core/src/state/advancement-gate.ts` | `assertCanAdvanceStory(bookDir, nextChapter)` — the single Core gate |

**Modified Core files**

| File | Responsibility |
|---|---|
| `packages/core/src/models/chapter.ts` | Add `"needs-state-review"` to `ChapterStatusSchema` |
| `packages/core/src/pipeline/chapter-persistence.ts` | Extend `ChapterPersistenceStatus` with `"needs-state-review"`; skip truth/snapshot/history sync for it; optional `saveStateReviewArtifact` seam |
| `packages/core/src/agents/writer.ts` | `saveChapter(..., options?: {deferStateApplication?: boolean; stateReviewJson?: string})` — defer ALL story/ writes, persist artifact instead |
| `packages/core/src/pipeline/runner.ts` | Gated `_executeNextChapterLocked` flow (capture delta → artifact, no state apply); `regenerateStateReview(bookId, chapter)`; call `assertCanAdvanceStory` next to `assertNoPendingStateRepair` (:2008) |
| `packages/core/src/interaction/edit-controller.ts` | `chapter-replace` execution commits prose + workflow-shell/receipt-supersession + index via ONE `commitAtomicFileSet` |
| `packages/core/index.ts` (barrel) | Export new models/services consumed by Studio/CLI |

**New Core tests** (`packages/core/src/__tests__/`): `state-review-schema.test.ts`, `prose-revision.test.ts`, `state-review-store.test.ts`, `state-review-items.test.ts`, `state-review-decisions.test.ts`, `state-review-invalidate.test.ts`, `state-review-confirm.test.ts`, `state-review-gate.test.ts`, `writer.deferred-save.test.ts`, `pipeline-runner.gated.test.ts`, `state-review-historical.test.ts`

**Modified pipeline file**: `packages/core/src/pipeline/chapter-persistence.ts` (above). **No new pipeline files.**

**Studio (all in `packages/studio/`)**

| File | Responsibility |
|---|---|
| `src/lib/state-review-api.ts` (new) | Typed fetch client; Core types via `import type`; discriminated outcomes |
| `src/api/server.ts` (modify) | `/api/v1/books/:id/chapters/:num/state-review*` route group: GET/decision/item/add/remove/confirm/rebuild/receipts; lock→Core→release |
| `src/pages/state-review-ui-state.ts` (new) | Pure UI-state reducer (selections, banners, progress, warning modal) — follows `page-state.ts` + `*.test.ts` pattern |
| `src/pages/StateReviewPage.tsx` (new) | Review panel: groups, items, Accept/Edit/Reject, Add Missing Change, Final Confirm, banners |
| `src/pages/ChapterReader.tsx` (modify) | Badge/link "State Review Required" when status is `needs-state-review`; link to review page |
| `src/App.tsx` (modify) | Route `#/books/:id/chapters/:num/state-review` |
| `src/__tests__/state-review-route.test.ts` (new) | Route contract tests (Hono app, real tmp book fixtures) |
| `src/pages/state-review-ui-state.test.ts` (new) | UI-state model tests |

**CLI (modify)**: `packages/cli/src/commands/write.ts`, `auto.ts` — surface the Core gate refusal verbatim (actionable "State Review required" reason); no interactive UI.

**Docs**: this plan + reconciliation banner in `docs/IMPLEMENTATION_PLAN.md` (committed with Task 0).

---

## Resolution of spec Appendix B (planning-time decisions)

**Q1 · Prose revision.** `computeProseRevision(content: string): string` in `packages/core/src/utils/prose-revision.ts`:
`createHash("sha256").update(content, "utf-8").digest("hex").slice(0, 16)` — same 16-hex convention as `computeCanonRevision`. Input is the EXACT durable chapter-file content including the `# Chapter N` heading line (bytes-on-disk ⇒ survives save/load round-trip trivially; recomputation reads the file back). Not AI-derived. Test vectors: fixed strings in `prose-revision.test.ts` (empty-ish minimal heading; CJK content; whitespace sensitivity asserted: trailing `\n` changes the revision).

**Q2 · Receipt storage.** Directory-per-chapter, file-per-resolution:
`story/runtime/state-review-receipts/chapter-<NNNN>/<reviewId>.json`.
Lookup by reviewId = read `…/chapter-<sourceOrEffective? NO — chapter-NNNN is the source chapter directory>/​<reviewId>.json` directly (confirm requests always carry the chapter number). History for Studio = `readdir` the chapter directory, parse each, sort by `resolvedAt`. No index file (directory listing is sufficient and can't drift). Receipt filename doubles as its id.

**Q3 · Chapter-status atomic write.** Status lives ONLY in `<bookDir>/chapters/index.json` (JSON array of `ChapterMeta`; loader `StateManager.loadChapterIndex` :474, saver `saveChapterIndex`; file-rebuild default `ready-for-review` :519). The authoritative confirm transaction READS the index during PREPARE, produces the UPDATED array in memory (entry.status = `"approved"`), serializes it, and adds ONE write `{relativePath: "chapters/index.json", content}` to the SAME `commitAtomicFileSet` as Canon + projections + snapshot + receipt + artifact deletion. Prose-edit invalidation does the same with `needs-state-review`. No second status store is introduced or consulted.

**Q4 · Relationship/emotional coverage.** `applyRuntimeStateDelta` (`state-reducer.ts:106-160`) consumes ONLY `currentStatePatch`, `hookOps`, `chapterSummary` (plus `delta.chapter`). `subplotOps` / `emotionalArcOps` / `characterMatrixOps` are `z.record(z.unknown())` loose arrays that the reducer NEVER reads. Therefore V1 `ReviewItemKind` = `"current-state-fact" | "hook-upsert" | "hook-mention" | "hook-resolve" | "hook-defer" | "new-hook-candidate" | "chapter-summary" | "note"`; loose-op remnants become `note` items (zero effective change, documented exclusion). No relationship engine.

**Q5 · Route / CLI naming.** Existing prose surfaces: Studio `POST /chapters/:num/approve|reject`, CLI `review list|approve|reject` (`commands/review.ts` = PROSE review), config `chapterReviewMode: "auto"|"manual"` (runner :2063). State Review uses an unambiguous namespace: Studio `/api/v1/books/:id/chapters/:num/state-review` (+ `/decision`, `/items`, `/items/user`, `/confirm`, `/rebuild`, `/receipts`); CLI V1 adds NO command — `write`/`auto` refusals print the Core gate reason containing the exact words "State Review" and point at Studio. The words "State Review" never appear as a CLI subcommand in V1.

---

## Task 0 — Docs reconciliation (docs-only, committed with this plan)

- [x] In `docs/IMPLEMENTATION_PLAN.md`, insert immediately above `### Phase 4 — Post-chapter state-review domain model (E, G, H)` a banner:

```markdown
> **⚠️ SUPERSEDED (2026-08-24):** Phases 4–6 task sketches below (T4.1–T6.x) are
> SUPERSEDED by the approved design spec
> `docs/superpowers/specs/2026-08-24-human-governed-post-chapter-state-review-design.md`
> and its implementation plan
> `docs/superpowers/plans/2026-08-24-human-governed-post-chapter-state-review.md`.
> They remain as historical context only — reconcile EVERYTHING against the spec
> (three concurrency anchors, workflow shells, resolved receipts, evidence
> verification, idempotent confirm, advancement gate ≤). Do not implement T4/T5/T6
> as written.
```

- [x] No other changes to completed P0–P3 history.

---

## Area A — Review models + pure helpers

### Task 1 — Schemas, errors, result types, item-id helper

**Files:** CREATE `packages/core/src/models/state-review.ts`; CREATE `packages/core/src/__tests__/state-review-schema.test.ts`; MODIFY barrel `packages/core/index.ts`.

Interfaces introduced (exact):

```ts
export const StateReviewWorkflowStatusSchema = z.enum([
  "active", "stale", "rebuild_required", "rebuild_failed",
]);
export const ReviewItemKindSchema = z.enum([
  "current-state-fact", "hook-upsert", "hook-mention", "hook-resolve",
  "hook-defer", "new-hook-candidate", "chapter-summary", "note",
]);
export const ReviewOriginSchema = z.enum(["ai", "user"]);
export const EvidenceLevelSchema = z.enum(["explicit", "inferred"]);
export const ReviewDecisionKindSchema = z.enum(["undecided", "accepted", "edited", "rejected"]);

// Evidence: claimedLevel mandatory from AI; verifiedLevel assigned by Core verifier.
export const ReviewEvidenceSchema = z.object({
  claimedLevel: EvidenceLevelSchema,
  verifiedLevel: EvidenceLevelSchema.optional(),
  quote: z.string().max(200).optional(),
});

// Semantic change payloads reuse Core vocabulary — never raw JSON patches:
export const FactChangeSchema = z.object({
  action: z.enum(["set", "remove"]),
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object: z.string().min(1).optional(),   // remove has no object
});
export const HookUpsertChangeSchema = z.object({ op: z.literal("upsert"), hookId: z.string().min(1) /* full HookRecord fields */ }).passthrough();
// hook mention/resolve/defer: { op, hookId }
// newHookCandidate accept: { op: "promote-candidate", candidate: NewHookCandidate }
// chapterSummary: { row: ChapterSummaryRowSchema }

export const EffectiveChangeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("fact"), change: FactChangeSchema }),
  z.object({ type: z.literal("hook"), change: HookOpChangeSchema }),
  z.object({ type: z.literal("new-hook-candidate"), change: CandidateChangeSchema }),
  z.object({ type: z.literal("chapter-summary"), change: SummaryChangeSchema }),
  z.object({ type: z.literal("none") }),            // note items / rejected
]);

export const ReviewItemSchema = z.object({
  id: z.string().min(1),
  kind: ReviewItemKindSchema,
  origin: ReviewOriginSchema,
  title: z.string().min(1),
  detail: z.string().optional(),
  proposal: z.unknown().optional(),      // immutable AI-proposed semantic payload
  evidence: ReviewEvidenceSchema.optional(),
  decision: ReviewDecisionKindSchema.default("undecided"),
  editedChange: EffectiveChangeSchema.optional(), // human-edited effective values
});

export const StateReviewArtifactSchema = z.discriminatedUnion("status", [
  z.object({                                   // WORKFLOW SHELL — non-confirmable
    schemaVersion: z.literal(1),
    status: z.literal("rebuild_required"),
    sourceChapter: z.number().int().min(1),
    createdAt: z.string().datetime(),
    language: z.enum(["zh", "en"]),
    reason: z.string().default(""),
  }),
  z.object({
    schemaVersion: z.literal(1),
    status: z.literal("rebuild_failed"),
    sourceChapter: z.number().int().min(1),
    createdAt: z.string().datetime(),
    language: z.enum(["zh", "en"]),
    reason: z.string().min(1),
  }),
  z.object({                                   // ACTIVE CONFIRMABLE PROPOSAL
    schemaVersion: z.literal(1),
    status: z.enum(["active", "stale"]),
    reviewId: z.string().min(1),
    sourceChapter: z.number().int().min(1),
    effectiveChapter: z.number().int().min(1),
    proseRevision: z.string().regex(/^[0-9a-f]{16}$/),
    baseCanonRevision: z.string().regex(/^[0-9a-f]{16}$/),
    reviewRevision: z.number().int().min(1),
    items: z.array(ReviewItemSchema),
    createdAt: z.string().datetime(),
    language: z.enum(["zh", "en"]),
  }),
]);
export type StateReviewArtifact = z.infer<typeof StateReviewArtifactSchema>;

export const ResolvedReviewReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  reviewId: z.string().min(1),
  sourceChapter: z.number().int().min(1),
  effectiveChapter: z.number().int().min(1),
  proseRevision: z.string(),
  baseCanonRevision: z.string(),
  resultingCanonRevision: z.string(),
  proposals: z.array(z.unknown()),       // AI layer, frozen
  decisions: z.array(z.unknown()),       // human layer, frozen
  effectiveChanges: z.array(z.unknown()),// applied layer, frozen
  evidence: z.array(z.unknown()),
  resolvedAt: z.string().datetime(),
  resolution: z.literal("confirmed-no-changes").or(z.literal("confirmed-changes")).or(z.literal("superseded")),
  supersededBy: z.string().optional(),
});
// NOTE: tier-B active variant REQUIRES anchors/items (discriminated union makes a
// shell without them unrepresentable-as-active — encode, don't convention).

export const STATE_REVIEW_ERROR_CODES = [
  "state_review_not_found", "state_review_stale", "state_review_conflict",
  "state_review_edit_conflict", "state_review_incomplete",
  "state_review_invalid_change", "state_review_rebuild_failed",
  "state_review_already_resolved", "state_review_write_locked",
] as const;
export class StateReviewError extends Error {
  readonly code: (typeof STATE_REVIEW_ERROR_CODES)[number];
  readonly itemId?: string;
  constructor(code: ..., message: string, itemId?: string);
}

export function fnv1a8(input: string): string;          // 8-hex FNV-1a
export function stateReviewItemId(kind: string, opIndex: number, payload: unknown): string;
// = `${kind}:${opIndex}:${fnv1a8(JSON.stringify(payload))}`
```

Steps:
- [ ] RED `state-review-schema.test.ts`: (1) shell variant WITHOUT anchors/items parses; active variant WITHOUT `reviewId`/anchors/items FAILS parse; (2) `decision` defaults to `"undecided"`; (3) unknown kind rejected; (4) `stateReviewItemId` deterministic across two calls + order-sensitive input differs; (5) `fnv1a8("") === "0829f8c7"`? — NO invented vector: assert determinism + 8-hex shape + difference on 1-char change instead of magic constants.
- [ ] GREEN implement schemas/class/helpers exactly as above; export from barrel.
- [ ] Verify: `pnpm -C inkos --filter @actalk/inkos-core exec vitest run src/__tests__/state-review-schema.test.ts`
- [ ] Proposed commit: `feat(core): state review domain schemas`

### Task 2 — Prose revision + deterministic evidence verification

**Files:** CREATE `packages/core/src/utils/prose-revision.ts`; CREATE `packages/core/src/__tests__/prose-revision.test.ts`. Evidence verifier lives beside items (Task 4) but its predicate is specified here:

```ts
export function computeProseRevision(content: string): string;
// sha256-hex.slice(0,16) over UTF-8 bytes of the exact chapter-file content.

export function normalizeForEvidenceMatch(text: string): string;
// NFC normalize → collapse /\s+/g to single space → trim → toLowerCase().

export function evidenceQuoteVerified(quote: string, prose: string): boolean;
// normalizeForEvidenceMatch(prose).includes(normalizeForEvidenceMatch(quote))
```

Steps:
- [ ] RED `prose-revision.test.ts`: vectors — `computeProseRevision("# 第1章 试\n\n正文")` is 16-hex and STABLE across repeated calls; changing trailing newline changes value; CJK-safe (no mojibake: two different CJK strings differ). `evidenceQuoteVerified("他 推开了 门", "前夜。\n他推开了门，风灌了进来。")` — FALSE (space inside quote is significant after collapse: "他 推开了 门" ≠ "他推开了门"); `evidenceQuoteVerified("他推开了门", "…\n他推开了门，…")` TRUE; case-insensitive English match TRUE.
- [ ] GREEN implement.
- [ ] Verify focused suite; commit `feat(core): prose revision + evidence verification primitives`.

## Area B — Artifact + receipt persistence

### Task 3 — State review store

**Files:** CREATE `packages/core/src/state/state-review-store.ts`; CREATE `packages/core/src/__tests__/state-review-store.test.ts`; barrel exports.

Exact interfaces:

```ts
export const ACTIVE_REVIEW_RELPATH = (chapter: number): string =>
  `story/runtime/chapter-${String(chapter).padStart(4, "0")}.state-review.json`;
export const RECEIPTS_DIR = (chapter: number): string =>
  `story/runtime/state-review-receipts/chapter-${String(chapter).padStart(4, "0")}`;

export async function loadStateReview(bookDir: string, chapter: number):
  Promise<StateReviewArtifact | null>;                       // null ⇒ none
export async function saveStateReviewShell(bookDir: string, shell: ShellArtifact): Promise<void>;     // tmp+rename atomic single file
export async function publishActiveProposal(bookDir: string, proposal: ActiveArtifact): Promise<void>;
export async function mutateActiveProposal(params: {
  bookDir: string; chapter: number; expectedReviewRevision: number;
  mutate: (active: ActiveArtifact) => ActiveArtifact;        // MUST bump reviewRevision itself? NO — see below
}): Promise<ActiveArtifact>;
// CAS: loaded.reviewRevision !== expected ⇒ throw StateReviewError("state_review_edit_conflict");
// mutate() returns content with UNCHANGED reviewRevision; store sets reviewRevision = expected + 1 before write.
export async function closeActiveReviewRelPath(chapter: number): { relativePath: string }; // for confirm delete list
export async function findReceiptByReviewId(bookDir: string, chapter: number, reviewId: string): Promise<ResolvedReviewReceipt | null>;
export async function listReceiptsForChapter(bookDir: string, chapter: number): Promise<ResolvedReviewReceipt[]>; // sorted resolvedAt asc
export async function writeResolvedReceipt(bookDir: string, chapter: number, receipt: ResolvedReviewReceipt): Promise<string>; // returns relpath
export async function supersedeReceiptsForChapter(params: {
  bookDir: string; chapter: number; supersededBy?: string;
}): Promise<Array<{ relativePath: string; content: string }>>;
// PURE: returns write entries (resolution:"superseded", supersededBy) — caller puts them
// into its OWN atomic transaction. Reads receipts fresh under caller's lock.
```

Rules encoded: everything under `story/runtime/**` — never imported by Writer-context assembly; decision persistence touches NOTHING under `story/state/`.

Steps:
- [ ] RED `state-review-store.test.ts` (fixture book via `createCanonBook`): (1) load missing ⇒ null; (2) saveShell→load round-trips discriminant `rebuild_required` with NO anchor fields; (3) publish→mutate with wrong `expectedReviewRevision` throws `state_review_edit_conflict` AND file bytes unchanged (`captureBookMetadata` diff empty except nothing); correct expectation bumps 1→2; (4) `findReceiptByReviewId` miss ⇒ null, hit ⇒ parsed; `listReceiptsForChapter` sorts by `resolvedAt`; (5) `supersedeReceiptsForChapter` returns entries flipping ONLY `resolution`/`supersededBy`, historical arrays byte-identical; (6) Canon tree (`story/state/**`) metadata equal after every store operation.
- [ ] GREEN implement (tmp-file + `rename` for single-file atomicity, mirroring `production/harness.ts` recoverable-write pattern).
- [ ] Verify focused; commit `feat(core): state review artifact + receipt store`.

## Area C — Proposed delta → review items

### Task 4 — Delta converter + evidence assignment

**Files:** CREATE `packages/core/src/state/state-review-items.ts`; CREATE `packages/core/src/__tests__/state-review-items.test.ts`; barrel exports.

Exact interface:

```ts
export interface BuildReviewItemsContext {
  readonly chapterContent: string;        // exact bound prose (for evidence verify)
  readonly language: "zh" | "en";
}
export function buildStateReviewItems(
  delta: RuntimeStateDelta,
  ctx: BuildReviewItemsContext,
): ReviewItem[];
```

Mapping (exhaustive over REAL `RuntimeStateDelta` fields):
- `currentStatePatch.<slot>` present ⇒ one `current-state-fact` item per slot: `proposal = {action:"set", subject:"主角"? NO — subject comes from slot semantics}`. CONCRETE DECISION: patch slots are book-level singleton slots; item encodes `{action:"set", subject:"主角", predicate:<slot zh alias from CURRENT_STATE_SLOT_DEFS[0].aliases for language>, object:<value>}` — subject fixed to the protagonist convention ALREADY used by the reducer's slot projection (`主角` in fixture/books; parameterize via existing slot table, not invented). Removal is NOT expressible by patches ⇒ no remove items from AI.
- `hookOps.upsert[i]` ⇒ `hook-upsert` item, proposal = the HookRecord; `mention[j]` ⇒ `hook-mention` `{op:"mention",hookId}`; `resolve[k]`/`defer[l]` likewise.
- `newHookCandidates[i]` ⇒ `new-hook-candidate` item.
- `chapterSummary` ⇒ `chapter-summary` item (row).
- `subplotOps`/`emotionalArcOps`/`characterMatrixOps` entries ⇒ ONE aggregated `note` item listing them as unsupported-in-V1 (zero effective change). `delta.notes` ⇒ appended to detail of relevant item or standalone `note`.
- Evidence: for set/fact objects and hook expectedPayoff/notes and summary events text, run normalized substring search of candidate value text in `chapterContent` (Task 2 predicate); hit ⇒ `{claimedLevel:"explicit", quote: matched ≤200 chars, verifiedLevel:"explicit"}`; miss ⇒ `{claimedLevel:"inferred", verifiedLevel:"inferred"}` (no fabricated quotes). AI never supplies claimedLevel in V1 capture — Core assigns BOTH (claim == verification outcome); the claimed/verified split exists for future providers and for edited/user items where user may claim explicit (verified by same predicate).
- IDs via `stateReviewItemId(kind, indexWithinKind, payload)`.

Steps:
- [ ] RED `state-review-items.test.ts`: crafted delta (1 patch + 2 upserts + 1 mention + 1 resolve + 1 defer + 1 candidate + summary + 1 subplotOp + 1 emotionalArcOp + notes) against fixture prose ⇒ EXACT item multiset (kinds/counts), quote present when text truly contained (use a sentence from `createCanonBook` chapter prose), inferred otherwise; ids stable across two invocations with same input; loose ops produce exactly one `note` item with zero `effectiveChange`; empty delta ⇒ zero items.
- [ ] GREEN implement.
- [ ] Verify focused; commit `feat(core): proposed delta to review items converter`.

## Area D — Pipeline deferred Canon application

### Task 5 — Writer deferred-save option

**Files:** MODIFY `packages/core/src/agents/writer.ts` (`saveChapter` :628); CREATE `packages/core/src/__tests__/writer.deferred-save.test.ts`.

Exact signature change:

```ts
async saveChapter(
  bookDir: string,
  output: WriteChapterOutput,
  numericalSystem: boolean = true,
  language: "zh" | "en" = "zh",
  options?: {
    readonly deferStateApplication?: boolean;
    readonly stateReviewJson?: string;      // serialized ACTIVE proposal artifact
  },
): Promise<void>
```

Behavior when `deferStateApplication === true`:
- Compute NOTHING from `resolveRuntimeStateArtifactsForOutput` (skip entirely — no `buildRuntimeStateArtifacts` call, no projection rendering).
- `writes` = chapter md + superseded-chapter deletes (unchanged) + `{relativePath: ACTIVE_REVIEW_RELPATH(output.chapterNumber), content: options.stateReviewJson}`.
- ALL `story/**` entries (current_state.md, pending_hooks.md, chapter_summaries.md, subplot/emotional/matrix boards, particle_ledger, story/state/*.json) are NOT written.
- Ungated calls: byte-identical behavior to today (options undefined ⇒ zero diff).

Steps:
- [ ] RED `writer.deferred-save.test.ts`: fixture book + stubbed `WriteChapterOutput` carrying a `runtimeStateDelta` (reuse patterns from `packages/core/src/__tests__/writer.test.ts`): pre-capture whole-tree metadata ⇒ gated save ⇒ (1) `chapters/0001_*.md` EXISTS with heading+content; (2) `story/state/current_state.json`, `story/current_state.md`, `story/pending_hooks.md` ABSENT/unchanged-bytes; (3) artifact file exists at `ACTIVE_REVIEW_RELPATH(1)` and parses via `StateReviewArtifactSchema`; (4) mid-set failure injection: pass `renameFile` mock that throws on 2nd rename ⇒ prior tree fully intact (existing rollback), no partial chapter; (5) ungated control call still writes story files (regression assertion).
- [ ] GREEN implement option plumbing (early-return branch assembling the reduced write set).
- [ ] Verify focused + `pnpm -C inkos --filter @actalk/inkos-core exec vitest run src/__tests__/writer.test.ts` (must stay green). Commit `feat(core): writer deferred state application`.

### Task 6 — Gated pipeline flow + needs-state-review status

**Files:** MODIFY `packages/core/src/pipeline/chapter-persistence.ts`, `packages/core/src/pipeline/runner.ts`, `packages/core/src/models/chapter.ts`; CREATE `packages/core/src/__tests__/pipeline-runner.gated.test.ts`.

Changes (exact):
1. `models/chapter.ts`: `ChapterStatusSchema` gains `"needs-state-review"`.
2. `chapter-persistence.ts`: `ChapterPersistenceStatus` += `"needs-state-review"`; ordering becomes: `saveChapter()` → `if status==="needs-state-review" { /* artifact already persisted inside gated saveChapter — nothing extra */ } else { saveTruthFiles() }` → index write (entry.status as given) → `markBookActiveIfNeeded` → drift guidance → snapshot/history ONLY when `status !== "needs-state-review" && status !== "state-degraded"`. (No new seam: the artifact rides the writer's own atomic set from Task 5.)
3. `runner._executeNextChapterLocked` (:1998): insert immediately after `await this.assertNoPendingStateRepair(bookId)` (:2008):
   `await assertCanAdvanceStory(bookDir, chapterNumber);` (Task 11 symbol — introduce there FIRST if sequencing demands; see Task 11 ordering note).
   After audit passes (non-manual mode), BEFORE building `persistenceOutput`'s state artifacts: capture `proposedDelta = persistenceOutput.runtimeStateDelta` (post `arbitrateRuntimeStateDeltaHooks` posture preserved — arbitration happens later inside prepare, NOT here; capture RAW Settler delta), compute anchors:
   ```ts
   const proseContent = buildChapterFileContent(...)  // exact bytes later written by saveChapter
   const proseRevision = computeProseRevision(proseContent);
   const baseCanonRevision = (await readStoryCanon(bookDir)).revision;
   const durable = await resolveDurableStoryProgress({ bookDir });
   const effectiveChapter = durable + 1;
   ```
   Build ACTIVE artifact via Task 4 converter + `reviewId = stateReviewItemId("gen", chapterNumber, proseRevision + baseCanonRevision)`-style deterministic generation id (documented: `${chapter}-g${generationCounter}` where generationCounter = count of prior receipts for chapter, computed via `listReceiptsForChapter` length — deterministic, no clock). Persist through `persistChapterArtifacts` new seams with `status: "needs-state-review"`, `saveTruthFiles: async () => undefined`, `saveStateReviewArtifact: () => writer.saveChapter(...)` NO — artifact written INSIDE writer.saveChapter gated mode (Task 5) so ONE transaction covers prose+artifact; seam therefore only flips flags:
   ```ts
   await writer.saveChapter(bookDir, persistenceOutput, gp.numericalSystem, lang,
     { deferStateApplication: true, stateReviewJson: JSON.stringify(activeArtifact) });
   ```
   and `snapshotState`/`syncCurrentStateFactHistory` skipped by persistence status gate. Concretely the `saveChapter` seam at runner :2324 becomes
   ```ts
   saveChapter: () => writer.saveChapter(bookDir, persistenceOutput, gp.numericalSystem, pipelineLang,
     { deferStateApplication: true, stateReviewJson: JSON.stringify(activeArtifact) }),
   ```
   while `saveTruthFiles` seam becomes a no-op for this status (its sync work moves to confirm-time). Zero-proposal delta ⇒ STILL `needs-state-review`, artifact published with `items: []` (§19 — no special casing).
4. Manual prose-review mode (`chapterReviewMode === "manual"`, :2063) is ORTHOGONAL and unchanged — it stops before audit and never reaches this code path.

Steps:
- [ ] RED `pipeline-runner.gated.test.ts` using the LLM stub harness (`packages/core/src/agent/llm-stub.ts`) patterns from `pipeline-runner.test.ts`: gated book write ⇒ (1) chapter prose persisted; (2) `chapters/index.json` entry.status === `"needs-state-review"`; (3) `story/state/*.json` + 3 projection md files byte-UNCHANGED from pre-run capture (Canon untouched by proposal); (4) artifact parses, `items` reflect stubbed delta, anchors present (`proseRevision` 16-hex etc.); (5) ZERO-proposal stub ⇒ artifact with `items: []`, status still `needs-state-review`; (6) ungated book (control) end-to-end unchanged: state files WRITTEN, status `ready-for-review`, snapshot created (regression subset).
- [ ] GREEN implement 1–4.
- [ ] Verify focused + full `writer.test.ts` + `pipeline-runner.test.ts` green.
- [ ] Commit `feat(core): gated chapter pipeline persists state-review proposal`.

## Area E — Review decision core service

### Task 7 — Decisions with reviewRevision CAS

**Files:** CREATE `packages/core/src/state/state-review-service.ts` (decisions part); CREATE `packages/core/src/__tests__/state-review-decisions.test.ts`; barrel exports.

Exact functions (ALL acquire-nothing: caller holds book lock; ALL operate only on `status==="active"` artifacts, else `state_review_stale`/`not_found`):

```ts
export async function decideStateReviewItem(params: {
  bookDir: string; chapter: number; itemId: string;
  decision: "accept" | "reject";
  expectedReviewRevision: number;
  overrideExplicitWarning?: boolean;      // Reject Anyway
}): Promise<{ artifact: ActiveArtifact }>;
// reject + evidence.verifiedLevel === "explicit" && !overrideExplicitWarning
//   ⇒ throw StateReviewError("state_review_invalid_change", "explicit-evidence-warning-required", itemId)
//   (Studio maps to its warning dialog; persistence happens ONLY with override=true)

export async function editStateReviewItem(params: {
  bookDir: string; chapter: number; itemId: string;
  expectedReviewRevision: number;
  editedChange: EffectiveChange;          // validated against kind below
}): Promise<{ artifact: ActiveArtifact }>;
// decision := "edited"; reviewed immediately; proposal PRESERVED; effectiveChange := validated edit

export async function addUserStateReviewItem(params: {
  bookDir: string; chapter: number; expectedReviewRevision: number;
  kind: Exclude<ReviewItemKind, "note">; change: EffectiveChange; title: string;
}): Promise<{ artifact: ActiveArtifact; itemId: string }>;
// origin:"user", decision:"accepted" (reviewed immediately)

export async function removeUserStateReviewItem(params: {
  bookDir: string; chapter: number; itemId: string; expectedReviewRevision: number;
}): Promise<{ artifact: ActiveArtifact }>;   // origin:"user" only ⇒ else invalid_change

export async function rejectAllAiItems(params: {
  bookDir: string; chapter: number; expectedReviewRevision: number;
}): Promise<{ artifact: ActiveArtifact }>;
// convenience ONLY: batch rejected on actionable AI items; does NOT resolve; skips
// explicit-warning friction by design? NO — spec §27 governs SINGLE rejects; batch
// reject-all ALSO requires overrideExplicitWarning=true when any verified-explicit
// item is included (same contract, one flag).
```

Validation of edited/user `EffectiveChange` per kind: fact ⇒ object required for set; hook ids must exist (upsert/mention/resolve/defer target known-or-new per arbiter rules delegated at PREPARE, light checks here); summary row schema-checked. Failures ⇒ `state_review_invalid_change` + itemId. Every success bumps `reviewRevision` exactly +1 (via Task 3 CAS). Canon untouched — asserted by tests.

Steps:
- [ ] RED `state-review-decisions.test.ts`: seeded active artifact (from Task 4 builder over stub delta): (1) accept ⇒ decision accepted, rev+1; (2) edit fact value 22→24 ⇒ decision edited, proposal STILL 22, effectiveChange 24; (3) reject verified-explicit without override throws code+itemId, artifact unchanged bytes; with override ⇒ rejected+reviewed; (4) add user fact item ⇒ origin user, accepted, id deterministic; edit it; remove it; removing an AI item ⇒ invalid_change; (5) rejectAll ⇒ all AI actionable rejected, note items untouched, artifact still active (NOT resolved), rev bumped once; (6) stale expectedReviewRevision ⇒ edit_conflict, bytes unchanged; (7) EVERY case ends with `captureBookMetadata` proving `story/state/**` untouched; (8) operations on `rebuild_required` shell ⇒ `state_review_stale`.
- [ ] GREEN implement.
- [ ] Verify focused; commit `feat(core): state review decision service`.

## Area F — Prose-edit invalidation / rebuild

### Task 8 — Atomic invalidation on prose save (pending + READY paths)

**Files:** MODIFY `packages/core/src/interaction/edit-controller.ts` (`chapter-replace` arm of `executeEditTransaction` :495); CREATE `packages/core/src/__tests__/state-review-invalidate.test.ts`; barrel exports.

Exact service called from the controller (controller gathers data; service computes write entries):

```ts
export async function handleStateRelevantProseSave(params: {
  bookDir: string; chapter: number; language: "zh" | "en";
}): Promise<{
  statusForIndex: "needs-state-review";
  shellWrite: { relativePath: string; content: string };   // rebuild_required shell
  receiptWrites: Array<{ relativePath: string; content: string }>; // superseded flips
}>;
// Under caller's lock: read current index entry status; if chapter was
// approved/READY ⇒ collect supersede entries for ALL resolved receipts of the
// chapter; ALWAYS return shell (create-or-replace semantics).
```

Controller integration (chapter-replace arm): after existing version-archive step, assemble ONE `commitAtomicFileSet({rootDir: bookDir, writes: [chapterMd, shellWrite, ...receiptWrites], deletes: supersededChapterFiles})` replacing today's direct `writeFile` path, then `deps.saveChapterIndex(indexWithNeedsStateReview)`. Non-review-relevant edit kinds unchanged.

Steps:
- [ ] RED `state-review-invalidate.test.ts`: three scenarios on fixtures: (A) pending review + PUT-style replace ⇒ prose new bytes, artifact REPLACED by `rebuild_required` shell (old active GONE — cannot confirm: `loadStateReview` returns shell; prepare would refuse), index status `needs-state-review`, Canon frozen; (B) READY chapter with seeded resolved receipt ⇒ same save flips receipt to `resolution:"superseded"` (+`supersededBy` absent) in SAME transaction (inject `renameFile` throwing mid-set ⇒ OLD complete state restored: prose old, receipt still resolved, no shell); (C) failure-injection variant of (A) ⇒ old prose + old artifact intact. Plus unit: `handleStateRelevantProseSave` on chapter without any review ⇒ plain shell, empty receiptWrites.
- [ ] GREEN implement.
- [ ] Verify focused + existing `edit-controller.test.ts` green. Commit `feat(core): atomic prose-save review invalidation`.

### Task 9 — Rebuild (Retry Audit) service

**Files:** MODIFY `packages/core/src/state/state-review-service.ts`; CREATE `packages/core/src/__tests__/state-review-regenerate.test.ts` (name per old T4.6 vocabulary, content per THIS spec).

Exact interface:

```ts
export async function rebuildStateReview(params: {
  bookDir: string; chapter: number; language: "zh" | "en";
  analyze: (input: { chapterContent: string }) => Promise<RuntimeStateDelta>;
  // production wires ChapterAnalyzerAgent.analyzeChapter (chapter-analyzer.ts:42)
  // returning ParsedWriterOutput; adapter extracts .runtimeStateDelta
}): Promise<{ artifact: ActiveArtifact }>;
```

Semantics: loads CURRENT shell (must be `rebuild_required`|`rebuild_failed`, else `state_review_already_resolved`/`stale`); reads latest prose file bytes ⇒ `proseRevision`; latest Canon ⇒ `baseCanonRevision`; `effectiveChapter = resolveDurableStoryProgress + 1` (temporal rules §20); `analyze(...)` ⇒ delta ⇒ Task 4 items; publishes NEW active generation (new reviewId via generation counter = receipts count + failed-generation counter persisted in shell `reason`? CONCRETE: generation = number of receipts for chapter + number of prior shells observed — simpler: `reviewId = \`ch${chapter}-r${Date.now().toString(36)}\``? NON-deterministic clock violates house style… FREEZE: `reviewId = \`ch${chapter}-g${receiptCount + 1}\``, uniqueness guaranteed because receipts only grow). On thrown analyze error: shell → `rebuild_failed` (durable), rethrow as `StateReviewError("state_review_rebuild_failed", original.message)`. No carry-forward of ANY prior decisions (new items built fresh).

Steps:
- [ ] RED: shell `rebuild_required` + stub analyze ⇒ active artifact with fresh ids, anchors = LATEST revisions (assert equality with freshly computed `computeProseRevision(fileBytes)` and `readStoryCanon().revision`); failing stub ⇒ shell `rebuild_failed` + error code, Canon frozen, chapter index untouched; retry-after-failure succeeds; confirm-attempt on shell ⇒ refused (already covered but re-asserted here).
- [ ] GREEN; runner gets thin `regenerateStateReview(bookId, chapter)` wrapper constructing the analyzer (Task 6 file already touched — acceptable second modification of runner, same responsibility).
- [ ] Verify focused; commit `feat(core): state review rebuild service`.

## Area G — Final Confirm PREPARE

### Task 10 — Pure prepare

**Files:** CREATE `packages/core/src/state/state-review-confirm.ts`; CREATE `packages/core/src/__tests__/state-review-confirm.test.ts`; barrel exports.

Exact interface:

```ts
export interface PreparedStateReviewConfirm {
  readonly receipt: ResolvedReviewReceipt;
  readonly receiptWrite: { relativePath: string; content: string };
  readonly indexWrite: { relativePath: string; content: string };  // chapters/index.json, entry approved
  readonly canonWrites: ReadonlyArray<{ relativePath: string; content: string }>;
  readonly projectionWrites: ReadonlyArray<{ relativePath: string; content: string }>;
  readonly snapshotWrites: ReadonlyArray<{ relativePath: string; content: string }>;
  readonly deletes: ReadonlyArray<string>;                         // pending artifact relpath
  readonly resultingCanonRevision: string;
  readonly effectiveChapter: number;
  readonly zeroEffectiveChange: boolean;
}

export async function prepareStateReviewConfirm(params: {
  bookDir: string; chapter: number; expectedReviewRevision: number;
}): Promise<PreparedStateReviewConfirm>;
// ZERO writes anywhere. Throws typed StateReviewError per spec §9.A order:
// already-resolved receipt lookup FIRST (returns via confirm, not here — see Task 11),
// then: active? → reviewRevision → proseRevision vs current file bytes →
// baseCanonRevision vs readStoryCanon → temporal rules (§20 table) vs CURRENT durable
// head → completeness (AI undecided ⇒ state_review_incomplete; user item invalid ⇒
// state_review_invalid_change+itemId) → compile ONE RuntimeStateDelta (delta.chapter =
// effectiveChapter) from accepted/edited/user effectiveChanges →
// buildRuntimeStateArtifactsFromSnapshot({snapshot: loadRuntimeStateSnapshot(), delta,
// language, allowNewHooks: <config posture>})  [runtime-state-store.ts:131 — the
// EXISTING arbitrate+apply+render engine] → validateRuntimeState implicit (store
// validates) → render remaining projection (hooks/summaries already in artifacts) →
// compose snapshotWrites: 3 rendered slots + other SNAPSHOT_STORY_FILE_NAMES slots
// copied from live + 4 story/state JSONs (per snapshot-set.ts contract) targeting
// story/snapshots/<effectiveChapter>/ → receipt in memory → index update in memory.
// Compile/validation throw inside store ⇒ catch ⇒ StateReviewError("state_review_invalid_change", itemId-if-known).
```

Zero-effective-change (no accepted/edited/user items with `type !== "none"`): `canonWrites/projectionWrites` EMPTY; `snapshotWrites` still composed (mirrors unchanged truth — not a meaning mutation); receipt `resolution:"confirmed-no-changes"`.

Steps:
- [ ] RED `state-review-confirm.test.ts` PREPARE section: whole-tree `captureBookMetadata` BEFORE/AFTER prepare ⇒ deep-equal in ALL cases: happy 2-item confirm; zero-change; all-rejected; undecided AI item ⇒ `state_review_incomplete`; user item with empty object ⇒ `state_review_invalid_change`+itemId; prose tampered ⇒ `state_review_stale`; canon manually advanced (use `commitCanonEdits` from P3A!) ⇒ `state_review_conflict`; expectedReviewRevision mismatch ⇒ edit_conflict; head advanced past historical correction's effectiveChapter (fixture manipulation) ⇒ APPLY-ZERO error; returned `canonWrites` content parses against schemas and differs from current by exactly the stubbed delta; `indexWrite` content parses as ChapterMeta[] with approved entry.
- [ ] GREEN implement (pure; no fs writes — enforce by construction: only readFile/readdir/stat).
- [ ] Verify focused; commit `feat(core): state review confirm prepare (pure)`.

## Areas H+I — Authoritative transaction, idempotency, derived memory

### Task 11 — confirmStateReview + advancement gate

**Files:** MODIFY `packages/core/src/state/state-review-confirm.ts` (add confirm); CREATE `packages/core/src/state/advancement-gate.ts` + `packages/core/src/__tests__/state-review-gate.test.ts`; MODIFY `packages/core/src/pipeline/runner.ts` (:2008 insertion + draft-path audit); barrel exports.

Exact interfaces:

```ts
export async function confirmStateReview(params: {
  bookDir: string; chapter: number; expectedReviewRevision: number;
  deps?: { renameFile?: (from: string, to: string) => Promise<void> };
}): Promise<{
  status: "resolved" | "already_resolved";
  receipt: ResolvedReviewReceipt;
  resultingCanonRevision: string;
  warnings: ReadonlyArray<string>;
}>;
// CALLER HOLDS BOOK LOCK (Studio route per §11; tests acquire via state.acquireBookLock).
// 1. receipt = findReceiptByReviewId(reviewId of loaded active artifact) — if PRESENT
//    ⇒ return {status:"already_resolved", receipt, …} with ZERO writes (idempotency §24).
// 2. prepared = await prepareStateReviewConfirm(...)
// 3. ONE commitAtomicFileSet({rootDir: bookDir,
//      writes: [...prepared.canonWrites, ...prepared.projectionWrites,
//               ...prepared.snapshotWrites, prepared.receiptWrite, prepared.indexWrite],
//      deletes: [prepared.deletes[0]],            // pending artifact closure
//      ...(deps?.renameFile ? {renameFile: deps.renameFile} : {})})
// 4. Derived memory (P3 reuse, post-commit): try rebuildNarrativeMemoryIndex(bookDir)
//    then rebuildCurrentStateFactHistory(bookDir, effectiveChapter - 1)  // same n as P3A
//    catch ⇒ invalidateDerivedMemory(bookDir); if !invalidated && warning ⇒ warnings.push(warning).
// 5. Return resolved result.

export async function assertCanAdvanceStory(bookDir: string, nextChapter: number): Promise<void>;
// Block (throw StateReviewError-family with actionable bilingual message naming the
// blocking chapter + "open State Review in Studio") when EITHER:
//   a) chapter index entry for nextChapter-1 exists with status !== "approved", OR
//   b) ANY chapter directory under state-review-receipts lacks full resolution while an
//      ACTIVE/SHELL artifact exists whose effectiveChapter <= nextChapter
//      (shell effectiveChapter = durable head + 1 recorded at shell creation — shells
//      store sourceChapter + createdAt only, SO: gate reads pending artifacts via
//      loadStateReview for chapters < nextChapter and blocks when artifact exists and
//      is not resolved; ACTIVE artifacts additionally compared by their effectiveChapter
//      <= nextChapter; SHELLS always block nextChapter = their sourceChapter + 1 while
//      unresolved — implement via: unresolved = loadStateReview(ch) != null for ch in
//      1..nextChapter-1 with no superseding receipt chain ⇒ block if ch === nextChapter-1
//      (rule a) or (active && effectiveChapter <= nextChapter) or (shell && ch < nextChapter)).
```

CONCRETE GATE FREEZE (avoid vagueness): iterate chapters 1..nextChapter-1; let art = loadStateReview(ch); blocked ⇔ (art !== null) AND ch === nextChapter - 1 (previous-not-ready equivalent: an unresolved pending/shell for the IMMEDIATELY previous chapter) OR (art?.status === "active" && art.effectiveChapter <= nextChapter). Receipt existence alone never blocks (resolved history is fine).

Runner integration: replace/augment :2008 block:
```ts
await this.assertNoPendingStateRepair(bookId);
const chapterNumber = await this.state.getNextChapterNumber(bookId);
await assertCanAdvanceStory(this.state.bookDir(bookId), chapterNumber);
```
This single choke point covers Studio `POST /write-next` (:3492), CLI `write.ts:64/:233`, `auto.ts:86` — all funnel into `writeNextChapter` ⇒ `_executeNextChapterLocked`. Audit step confirms no OTHER chapter-creating runner entry exists (`grep "async write\|async draft\|async continue" runner.ts`) and wires any found.

Steps:
- [ ] RED `state-review-gate.test.ts`: (1) previous chapter `needs-state-review` ⇒ throws, message contains "State Review"; (2) approved previous + no pendings ⇒ passes; (3) historical: head-25 fixture (25 approved entries) + active correction effective 26 ⇒ `assertCanAdvanceStory(bookDir, 26)` throws, `(26)` after resolution passes; (4) older unresolved correction effective 20 blocks generating 21 (the `<=` rule) even though ch20 long READY; (5) resolved receipts alone never block.
- [ ] RED (same file or `state-review-confirm.test.ts` H/I section): normal confirm ⇒ Canon JSONs changed per delta, snapshot `<E>/` populated, index approved, receipt on disk, artifact DELETED, warnings []; zero-change ⇒ canonWrites absent-but-transaction-succeeded, receipt `confirmed-no-changes`, READY; all-rejected ⇒ same as zero-change; ONE invalid user item ⇒ throws invalid_change AND `captureBookMetadata` proves ZERO writes (prepare purity holds through confirm); atomic failure injection `renameFile` throwing mid-set ⇒ entire tree equals pre-confirm capture (rollback), artifact still present, retry possible; stale prose ⇒ throws `state_review_stale`, zero writes; canon-conflicted ⇒ `state_review_conflict`, zero writes; moved effectiveChapter ⇒ APPLY ZERO; double confirm ⇒ second returns `already_resolved`, tree unchanged, counters/hooks not reapplied (assert hook rows count stable via MemoryDB read); lost-response retry = same as double confirm; derived-memory failure (stub `rebuildNarrativeMemoryIndex` throwing) ⇒ confirm STILL resolved, READY, receipt durable, db invalidated, warnings carry exact P3 string on hard failure.
- [ ] GREEN implement gate + confirm.
- [ ] Verify focused + `pipeline-runner.gated.test.ts` + `canon-commit.test.ts` (P3.1 untouched). Commit `feat(core): state review confirm transaction + advancement gate`.

### Task 12 — Historical corrections end-to-end

**Files:** CREATE `packages/core/src/__tests__/state-review-historical.test.ts`.

Steps:
- [ ] RED: build head-25 fixture programmatically (loop `createCanonBook`-style seeding or index fabrication with 25 approved entries + snapshots via `snapshotStateAt`); craft pending correction artifact for sourceChapter 16 (shell→active via Task 4/9 helpers with effectiveChapter = 26); assert: chapters 17–25 statuses untouched; `assertCanAdvanceStory(26)` blocks; confirm applies delta anchored at 26 (`validFromChapter: 26` on produced fact rows via MemoryDB `getFactsAt("主角", 26)`); receipt preserves source=16/effective=26; NO file under `chapters/0017..0025` or `story/snapshots/17..25` changes metadata (captureBookMetadata subset comparison).
- [ ] GREEN = fixes flowing from failures (expect mostly test-side fixture work; production already generalizes via Tasks 10–11).
- [ ] Verify focused; commit `test(core): historical correction end-to-end`.

## Areas L+M — Studio HTTP API + UX

### Task 13 — HTTP routes + typed client

**Files:** MODIFY `packages/studio/src/api/server.ts` (new route group near canon routes); CREATE `packages/studio/src/lib/state-review-api.ts`; CREATE `packages/studio/src/__tests__/state-review-route.test.ts`.

Routes (exact; all wrap `state.acquireBookLock(id)` … `finally release()` for mutations; revision checks INSIDE lock):

```
GET    /api/v1/books/:id/chapters/:num/state-review           → artifact | 404 state_review_not_found
POST   /api/v1/books/:id/chapters/:num/state-review/decision  {itemId, decision:"accept"|"reject", expectedReviewRevision, overrideExplicitWarning?}
POST   /api/v1/books/:id/chapters/:num/state-review/edit      {itemId, editedChange, expectedReviewRevision}
POST   /api/v1/books/:id/chapters/:num/state-review/items     {kind, change, title, expectedReviewRevision}          (user add)
DELETE /api/v1/books/:id/chapters/:num/state-review/items/user/:itemId {expectedReviewRevision} (query)
POST   /api/v1/books/:id/chapters/:num/state-review/reject-all{expectedReviewRevision, overrideExplicitWarning?}
POST   /api/v1/books/:id/chapters/:num/state-review/confirm   {expectedReviewRevision}
POST   /api/v1/books/:id/chapters/:num/state-review/rebuild   {}
GET    /api/v1/books/:id/chapters/:num/state-review/receipts  → receipt history
```

Error mapping (mirror P3B `mapCanonMutationError` style): `StateReviewError` ⇒ `not_found`→404; `stale/conflict/edit_conflict/already_resolved/write_locked/incomplete/invalid_change/rebuild_failed`→409 `{code, itemId?, message}`; unexpected ⇒ 500 fixed string. Success bodies typed via barrel imports (`import type { StateReviewArtifact, ResolvedReviewReceipt … } from "@actalk/inkos-core"`) — NO local semantic duplicates (P3B I-1 rule).

Client `state-review-api.ts`: `fetchStateReview`, `decideItem`, `editItem`, `addUserItem`, `removeUserItem`, `rejectAll`, `confirmReview`, `rebuildReview`, `listReceipts` — each returning discriminated `{ok:true,…}|{ok:false, code, itemId?}` outcomes (HTTP statuses never throw; network throw ⇒ `{ok:false, code:"unexpected"}`).

Steps:
- [ ] RED `state-review-route.test.ts` (makeApp pattern from `canon-edits-route.test.ts`, tmp fixture books): happy GET; decision round-trip bumps reviewRevision; wrong expectation ⇒ 409 `state_review_edit_conflict`; unknown book ⇒ 404; unknown chapter review ⇒ 404 code; confirm on shell ⇒ 409 `state_review_stale`; confirm happy path ⇒ 200 resolved + index approved (verify via fs); rebuild on failing analyzer stub ⇒ 409 `state_review_rebuild_failed`; malformed JSON body ⇒ 400; receipts listing sorted.
- [ ] GREEN implement routes + client.
- [ ] Verify focused studio suite; commit `feat(studio): state review http api + typed client`.

### Task 14 — Review UI state model + page

**Files:** CREATE `packages/studio/src/pages/state-review-ui-state.ts` + `.test.ts`; CREATE `packages/studio/src/pages/StateReviewPage.tsx`; MODIFY `src/App.tsx` (route `#/books/:id/chapters/:num/state-review`, keyed `key={bookId}` per P3B M-1 lesson); MODIFY `src/pages/ChapterReader.tsx` (status badge + link button "审查状态变更 / Review State Changes" when `meta.status === "needs-state-review"`; rebuild-failed banner with Retry Audit / Edit Chapter actions calling client).

UI-state model (pure, tested): grouping by domain (Current State ← `current-state-fact`; Hooks/Subplots ← hook kinds + candidates; Relationships/Emotional Arcs group renders ONLY IF items exist — i.e., represented via facts/hooks per Q4; Chapter Summary; User Added ← origin user); progress `reviewedCount/total` (undecided AI = unreviewed; user items always reviewed); confirmEnabled = total===reviewed && no invalid user items; explicit-reject warning modal state machine (Cancel/Edit/RejectAnyway ⇒ dispatch decision with override); zero-change layout switch (items empty ⇒ Add Missing Change + Confirm No Changes labels); historical banner visibility (sourceChapter < currentHead from workspace data); rebuild_failed banner state; receipt viewer state (read-only list, resolved/superseded chips).

Steps:
- [ ] RED `state-review-ui-state.test.ts`: progress math (mixed decided/user/note); confirm gating incl. invalid user item; explicit-warning open→RejectAnyway dispatch payload carries `overrideExplicitWarning:true`; zero-change switch; banner selectors.
- [ ] GREEN model; then page component wiring client↔model (components inline per existing page style — StoryStatePage precedent; extract subcomponent only if file exceeds ~600 lines: `StateReviewGroups.tsx` fallback boundary named NOW).
- [ ] Verify: `pnpm -C inkos --filter @actalk/inkos-studio test`; commit `feat(studio): state review ux`.

## Area N — CLI non-bypass

### Task 15 — CLI refusal surfacing

**Files:** MODIFY `packages/cli/src/commands/write.ts`, `auto.ts` (error printing only).

Steps:
- [ ] Inspect current catch/print blocks (:64/:233 write.ts, :86 auto.ts); ensure thrown gate error message prints verbatim (it already contains "State Review" + blocking chapter + Studio pointer from Task 11 message). Add explicit test in `packages/cli/src/__tests__/auto-command.test.ts` + new case in existing `write` command test file: stubbed pipeline throwing gate error ⇒ stdout contains "State Review"; assert NO new command name collides with prose `review` (static grep assertion in test: `reviewCommand.commands` unchanged). If printing already verbatim, task reduces to the regression tests (still RED-first for the message assertion).
- [ ] Verify CLI suites; commit `test(cli): state review gate refusal surfaced`.

## Area O — Final integration checkpoint

### Task 16 — Sequential full verification + acceptance matrix audit

Steps:
- [ ] Run IN ORDER, each awaited alone and fully collected before the next: focused Phase 4 core tests → `pnpm -C inkos --filter @actalk/inkos-core test` (expect 1930-baseline + new, ONLY the 2 skill-agent-tool EPERM failures) → `--filter @actalk/inkos-studio test` (634+new) → CLI suites (`--filter @actalk/inkos-cli test`) → `pnpm -C inkos typecheck` → `pnpm -C inkos build`.
- [ ] Walk the acceptance matrix (below) ticking each mapped test name; any gap ⇒ new RED test before closing.
- [ ] Commit: `test: phase 4 acceptance matrix verified` (or chore-only if no gaps).

## Acceptance coverage matrix (spec §32 scenario → tests)

| # | Scenario | Tests |
|---|---|---|
| 1 | Happy path | `pipeline-runner.gated` → `state-review-confirm` normal confirm → `state-review-gate` passes-after |
| 2 | Zero delta | `pipeline-runner.gated` zero-proposal + `state-review-confirm` zero-change |
| 3 | Edited proposal | `state-review-decisions` edit + confirm applies 24/receipt keeps 23+24 |
| 4 | Explicit reject | `state-review-decisions` (3) + route override flow |
| 5 | Incomplete | `state-review-confirm` undecided ⇒ incomplete + UI gating (`state-review-ui-state`) |
| 6 | Canon conflict | `state-review-confirm` conflict-zero-write |
| 7 | Prose stale | `state-review-confirm` stale |
| 8 | Edit pending | `state-review-invalidate` (A) + `state-review-regenerate` |
| 9 | Edit READY | `state-review-invalidate` (B) + scenario wording |
| 10 | Rebuild failure | `state-review-regenerate` failure + `state-review-invalidate` (C) |
| 11 | Historical edit | `state-review-historical` + `state-review-gate` (3)(4) |
| 12 | Invalid batch | `state-review-confirm` one-invalid-applies-zero |
| 13 | Crash mid-confirm | `state-review-confirm` atomic failure injection |
| 14 | Network retry | `state-review-confirm` double confirm / already_resolved |
| 15 | Derived-memory failure | `state-review-confirm` sync-failure warning |
| 16 | CLI bypass | `state-review-gate` + CLI surfacing tests (Task 15) |

Invariant mapping (1–15 → enforcing tasks): 1→T5/T10 (runtime only writes story/state in confirm); 2→T3/T5 (runtime paths only); 3→T6/T7 (nothing applies without confirm); 4→T4 groups/UI; 5→T3 CAS+T7; 6→T10 anchors/T11 gate; 7→T10/T11 all-or-nothing; 8→T11 atomic set incl index+receipt+closure; 9→T10 reuse of `buildRuntimeStateArtifactsFromSnapshot`; 10→T11 gate in `_executeNextChapterLocked`; 11→T8/T9 prose kept on failure; 12→T12; 13→T11 gate `<=` + T12; 14→T11 step 4; 15→T7 explicit-warning contract.

## Self-review record (completed during planning)

- Placeholders: none (`grep TODO|TBD|FIXME|appropriate|similar to|handle edge cases` clean at commit time).
- Type consistency: every later-task symbol introduced earlier (gate fn introduced Task 11 BUT referenced Task 6 — ORDERING FIX APPLIED: Task 6 inserts the runner call behind the same task that lands `advancement-gate.ts`; executor implements Task 11's gate FILE first if running strictly sequentially — noted in Task 6 step 3 as "Task 11 symbol — introduce there FIRST if sequencing demands").
- Architecture: single engine (`applyRuntimeStateDelta` via `buildRuntimeStateArtifactsFromSnapshot`), single store, no frontend gate, no carry-forward, no ready-for-review detour, `<=` gate everywhere.
- Transactions: three atomic boundaries pinned (Tasks 6/8/11 write sets).
- Appendix B: all five RESOLVED (see resolutions section).
