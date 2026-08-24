# Human-Governed Post-Chapter State Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert mandatory human governance between the existing post-chapter proposed RuntimeStateDelta and Canon application, with durable review/recovery workflow, atomic confirmation, Studio review UI, and Core-level advancement gating.

**Architecture:** Reuse the existing Observer → Settler → RuntimeStateDelta → applyRuntimeStateDelta engine. Phase 4 captures the proposed delta before application, persists a non-Canon review workflow, compiles human decisions back into a confirmed RuntimeStateDelta, and applies it through the existing reducer in one authoritative confirmation transaction. Studio owns UI/HTTP orchestration; Core owns semantics; CLI/pipeline share the Core advancement gate.

**Tech Stack** (as discovered in repo — no new dependencies beyond `node:crypto`, already used across Core): Node 22 + TypeScript (strict), pnpm 9 workspaces, Zod schemas (`packages/core/src/models/*`), vitest per-package, Hono server in `packages/studio/src/api/server.ts`, React 19 + hand-rolled `useState` page-model pattern in `packages/studio/src/pages/*`, Commander CLI in `packages/cli/src/commands/*`.

**Spec (binding):** `docs/superpowers/specs/2026-08-24-human-governed-post-chapter-state-review-design.md`

---

## 0. Ground rules for every task

- Suites run **strictly sequentially** on this machine (load-induced flake precedent). Never parallelize `pnpm --filter … test`.
- TDD: RED run must fail for the named reason before GREEN.
- Known baseline (never "fix" in Phase 4): exactly 2 failures in `packages/core/src/__tests__/skill-agent-tool.test.ts` (Windows symlink EPERM).
- All filesystem-purity assertions use `captureBookMetadata(root)` from `packages/core/src/__tests__/helpers/canon-fixture.ts` (sha256+size+mtimeMs whole-tree map, deep-equality compare).
- Fixtures: `createCanonBook({seedSnapshotsThrough: 12})` from the same helper module (facts: 主角/当前位置 closed@10 + open 东城公寓@11, 主角状态 open@12, 林晚/身份 open@4).
- Never feed anything under `story/runtime/` to Writer-context builders; never write Canon outside `story/state/*.json`.
- **No task may reference a symbol introduced by a LATER task.** The task order below is dependency-sorted; if an executor finds a missing dependency, STOP and escalate rather than implementing a future task early.
- Language values are ALWAYS the canonical `RuntimeStateLanguageSchema` / `RuntimeStateLanguage` from `packages/core/src/models/runtime-state.ts` (:3-4, barrel-exported). No Phase 4 file declares its own `"zh" | "en"` literal union.
- Review IDs use `randomUUID()` from `node:crypto` (repo precedent: `manager.ts:2`, `chapter-workspace.ts`). ReviewItem IDs stay deterministic within a generation (Task 1 helper).

## File / Responsibility Map

**New Core files**

| File | Responsibility (ONE each) |
|---|---|
| `packages/core/src/models/state-review.ts` | Zod schemas + TS types: workflow shell vs active proposal vs receipt (all three frozen layers typed), ReviewItem envelope + typed proposal payloads, decisions, evidence levels, typed error codes, `fnv1a8`, deterministic ReviewItem-id helper |
| `packages/core/src/utils/prose-revision.ts` | `computeProseRevision(content)` — deterministic 16-hex prose fingerprint — plus normalized-substring evidence predicates |
| `packages/core/src/state/state-review-store.ts` | Load/save workflow shell + active proposal artifact; receipt store (by reviewId, by chapter); system supersede transition; PURE live-runtime-state reader for confirm paths |
| `packages/core/src/state/state-review-items.ts` | PURE converter `buildStateReviewItems(delta, ctx)` → ReviewItem[] using the SHARED slot-vocabulary helper (no private alias table) |
| `packages/core/src/state/advancement-gate.ts` | `assertCanAdvanceStory(bookDir, nextChapter)` — the single Core gate over unresolved artifacts |
| `packages/core/src/state/state-review-service.ts` | Decision mutations (accept/edit/reject/add/remove/rejectAll) with reviewRevision CAS; prose-save invalidation (`handleStateRelevantProseSave`); rebuild orchestration (`rebuildStateReview`) |
| `packages/core/src/state/state-review-confirm.ts` | `prepareStateReviewConfirm` (PURE reads only) + `confirmStateReview` (reviewId-keyed idempotency + locked authoritative txn + derived-memory sync) |

**Modified Core files**

| File | Responsibility |
|---|---|
| `packages/core/src/models/chapter.ts` | Add `"needs-state-review"` to `ChapterStatusSchema` |
| `packages/core/src/state/state-projections.ts` | Extract PURE `describeCurrentStateSlot(slot, language)` beside `CURRENT_STATE_SLOT_DEFS`; becomes the single subject/predicate vocabulary |
| `packages/core/src/state/state-reducer.ts` | `applyCurrentStatePatch` consumes `describeCurrentStateSlot` (deletes its private `labels` table); byte-identical output proven by existing tests |
| `packages/core/src/pipeline/chapter-persistence.ts` | Extend `ChapterPersistenceStatus` with `"needs-state-review"`; index computed BEFORE `saveChapter` for that status and handed into the atomic set; NO separate index write |
| `packages/core/src/agents/writer.ts` | `saveChapter(..., options?)` gains `{deferStateApplication, stateReviewJson, updatedChapterIndexJson}` — ONE atomic set owns prose + artifact + index + superseded deletes |
| `packages/core/src/pipeline/runner.ts` | Gated `_executeNextChapterLocked` flow (capture delta → artifact + index in writer's set); `regenerateStateReview(bookId, chapter)`; gate call after `assertNoPendingStateRepair` (:2008) |
| `packages/core/src/interaction/edit-controller.ts` | `chapter-replace` execution commits prose + shell + receipt-supersession + index + deletes via ONE `commitAtomicFileSet`; no post-transaction index call |
| `packages/core/src/index.ts` (barrel) | Export new models/services consumed by Studio/CLI |

**New Core tests** (`packages/core/src/__tests__/`): `state-review-schema.test.ts`, `prose-revision.test.ts`, `state-review-store.test.ts`, `state-review-items.test.ts`, `advancement-gate.test.ts`, `writer.deferred-save.test.ts`, `pipeline-runner.gated.test.ts`, `state-review-decisions.test.ts`, `state-review-invalidate.test.ts`, `state-review-regenerate.test.ts`, `state-review-confirm.test.ts`, `state-review-historical.test.ts`

**Studio (all in `packages/studio/`)**

| File | Responsibility |
|---|---|
| `src/lib/state-review-api.ts` (new) | Typed fetch client; Core types via `import type`; confirm sends `reviewId`; discriminated outcomes |
| `src/api/server.ts` (modify) | `/api/v1/books/:id/chapters/:num/state-review*` route group; lock→Core→release; confirm body carries reviewId |
| `src/pages/state-review-ui-state.ts` (new) | Pure UI-state reducer (selections, banners, progress, warning modal) |
| `src/pages/StateReviewPage.tsx` (new) | Review panel: groups, items, Accept/Edit/Reject, Add Missing Change, Final Confirm, banners |
| `src/pages/ChapterReader.tsx` (modify) | Badge/link "State Review Required" for `needs-state-review`; rebuild-failed banner actions |
| `src/App.tsx` (modify) | Route `#/books/:id/chapters/:num/state-review` |
| `src/__tests__/state-review-route.test.ts` (new) | Route contract tests (Hono app, tmp fixtures) |
| `src/pages/state-review-ui-state.test.ts` (new) | UI-state model tests |

**CLI (modify)**: `packages/cli/src/commands/write.ts`, `auto.ts` — surface the Core gate refusal verbatim; no interactive UI, no new command.

---

## Resolution of spec Appendix B (planning-time decisions)

**Q1 · Prose revision.** `computeProseRevision(content: string): string` in `packages/core/src/utils/prose-revision.ts`:
`createHash("sha256").update(content, "utf-8").digest("hex").slice(0, 16)` — same 16-hex convention as `computeCanonRevision`. Input is the EXACT durable chapter-file content including the `# Chapter N` heading line (bytes-on-disk ⇒ survives save/load round-trips trivially). Not AI-derived.

**Q2 · Receipt storage.** Directory-per-chapter, file-per-resolution:
`story/runtime/state-review-receipts/chapter-<NNNN>/<reviewId>.json` where `<reviewId>` is the generation's `randomUUID()`. Lookup = read that exact file (confirm requests carry the chapter number AND reviewId). History for Studio = `readdir` + parse + sort by `resolvedAt`. No index file.

**Q3 · Chapter-status atomic write.** Status lives ONLY in `<bookDir>/chapters/index.json` (JSON array of `ChapterMeta`; `StateManager.loadChapterIndex` :474). BOTH Phase 4 transactions serialize the updated array in memory and add `{relativePath: "chapters/index.json", content}` to their single `commitAtomicFileSet` (Tasks 6/7 and 9). No post-transaction `saveChapterIndex` call exists anywhere in Phase 4 flows.

**Q4 · Relationship/emotional coverage.** `applyRuntimeStateDelta` consumes ONLY `currentStatePatch`, `hookOps`, `chapterSummary`; loose ops are never read. V1 kinds = fact/hook×4/candidate/summary/note; loose remnants become `note` items. No relationship engine.

**Q5 · Route / CLI naming.** Prose surfaces own "review/approve/reject" (`commands/review.ts`, Studio `/approve`,`/reject`, `chapterReviewMode`). State Review namespace: Studio `/api/v1/books/:id/chapters/:num/state-review` (+ subpaths); CLI V1 adds NO command — refusals print the gate reason containing "State Review".

**Shared semantic vocabulary (blocker-7 decision).** The reducer ALREADY owns patch-fact semantics: `subject: "protagonist"` and predicate = first alias of the language-ordered table inside `applyCurrentStatePatch` (`state-reducer.ts:276-315`) — which today DUPLICATES `CURRENT_STATE_SLOT_DEFS` (`state-projections.ts:148-154`). Phase 4 extracts ONE pure helper and leaves exactly one table:

```ts
// state-projections.ts (new export):
export function describeCurrentStateSlot(
  slot: keyof CurrentStatePatch,
  language: RuntimeStateLanguage,
): { readonly subject: "protagonist"; readonly predicate: string };
// predicate === aliases[0] under the EXACT per-language ordering the reducer uses today
// (zh books: ["当前位置","Current Location"], en books: ["Current Location","当前位置"], …)
```

`applyCurrentStatePatch` is refactored to consume it (byte-identical output asserted by existing reducer + projection suites BEFORE merge), and the converter (Task 4) uses the same helper. No third mapping, no invented Chinese constants in Phase 4 files.

---

## Task 0 — Docs reconciliation (docs-only, already committed with b1045953)

- [x] Superseded banner above `### Phase 4` in `docs/IMPLEMENTATION_PLAN.md`.

---

## Area A — Review models + pure helpers

### Task 1 — Schemas, errors, three frozen layers, resolvers

**Files:** CREATE `packages/core/src/models/state-review.ts`; CREATE `packages/core/src/__tests__/state-review-schema.test.ts`; MODIFY barrel `packages/core/src/index.ts`.

Imports (all pre-existing): `RuntimeStateLanguageSchema`, `HookRecordSchema`, `HookOpsSchema`, `NewHookCandidateSchema`, `ChapterSummaryRowSchema`, types `CurrentStatePatch` from `./runtime-state.js`; `randomUUID` NOT here (lives in pipeline/service tasks).

Exact content:

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

// ---- LAYER 1: AI proposal / final effective change (typed, no z.unknown) ----
export const ProposalChangeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("fact"),
    change: z.object({
      action: z.enum(["set", "remove"]),
      subject: z.string().min(1),
      predicate: z.string().min(1),
      object: z.string().optional(),          // required iff action==="set" (refine below)
    }).superRefine((v, ctx) => {
      if (v.action === "set" && !v.object) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "set requires object" });
    }),
  }),
  z.object({ type: z.literal("hook-upsert"), hook: HookRecordSchema }),
  z.object({ type: z.literal("hook-op"), op: z.enum(["mention", "resolve", "defer"]), hookId: z.string().min(1) }),
  z.object({ type: z.literal("new-hook-candidate"), candidate: NewHookCandidateSchema }),
  z.object({ type: z.literal("chapter-summary"), row: ChapterSummaryRowSchema }),
  z.object({ type: z.literal("none") }),        // notes / rejected / undecided
]);
export type ProposalChange = z.infer<typeof ProposalChangeSchema>;

// ---- LAYER 2: human decision record (receipts freeze these) ----
export const HumanDecisionRecordSchema = z.object({
  itemId: z.string().min(1),
  decision: ReviewDecisionKindSchema,
  editedChange: ProposalChangeSchema.optional(),
});
export type HumanDecisionRecord = z.infer<typeof HumanDecisionRecordSchema>;

export const ReviewEvidenceSchema = z.object({
  claimedLevel: EvidenceLevelSchema,
  verifiedLevel: EvidenceLevelSchema,
  quote: z.string().max(200).optional(),       // present iff verifiedLevel === "explicit"
});

export const ReviewItemSchema = z.object({
  id: z.string().min(1),
  kind: ReviewItemKindSchema,
  origin: ReviewOriginSchema,
  title: z.string().min(1),
  detail: z.string().optional(),
  proposal: ProposalChangeSchema,              // REQUIRED, typed (AI layer for ai items; user layer for user items)
  evidence: ReviewEvidenceSchema.optional(),
  decision: ReviewDecisionKindSchema.default("undecided"),
  editedChange: ProposalChangeSchema.optional(),
});
export type ReviewItem = z.infer<typeof ReviewItemSchema>;

// ---- LAYER 3 resolver: the ONE place effective change is decided ----
export function resolveReviewItemEffectiveChange(item: ReviewItem): ProposalChange;
// accepted            => item.proposal
// edited              => item.editedChange (required; absent => throw StateReviewError("state_review_invalid_change", itemId))
// rejected            => { type: "none" }
// accepted (user)     => item.proposal
// note kind           => { type: "none" } regardless of decision
// undecided           => { type: "none" }

// ---- Artifacts ----
export const StateReviewArtifactSchema = z.discriminatedUnion("status", [
  z.object({
    schemaVersion: z.literal(1),
    status: z.literal("rebuild_required"),
    sourceChapter: z.number().int().min(1),
    createdAt: z.string().datetime(),
    language: RuntimeStateLanguageSchema,
    reason: z.string().default(""),
  }),
  z.object({
    schemaVersion: z.literal(1),
    status: z.literal("rebuild_failed"),
    sourceChapter: z.number().int().min(1),
    createdAt: z.string().datetime(),
    language: RuntimeStateLanguageSchema,
    reason: z.string().min(1),
  }),
  z.object({
    schemaVersion: z.literal(1),
    status: z.enum(["active", "stale"]),
    reviewId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/), // uuid v4
    sourceChapter: z.number().int().min(1),
    effectiveChapter: z.number().int().min(1),
    proseRevision: z.string().regex(/^[0-9a-f]{16}$/),
    baseCanonRevision: z.string().regex(/^[0-9a-f]{16}$/),
    reviewRevision: z.number().int().min(1),
    items: z.array(ReviewItemSchema),
    createdAt: z.string().datetime(),
    language: RuntimeStateLanguageSchema,
  }),
]);
export type StateReviewArtifact = z.infer<typeof StateReviewArtifactSchema>;
// A shell CANNOT carry anchors/items; an ACTIVE variant cannot omit them — enforced by the union.

// ---- Receipt: three frozen layers, separately ----
export const ResolvedReviewReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  reviewId: z.string().min(1),
  sourceChapter: z.number().int().min(1),
  effectiveChapter: z.number().int().min(1),
  proseRevision: z.string(),
  baseCanonRevision: z.string(),
  resultingCanonRevision: z.string(),
  proposals: z.array(ProposalChangeSchema),        // frozen AI/user proposal layer
  decisions: z.array(HumanDecisionRecordSchema),   // frozen human layer
  effectiveChanges: z.array(ProposalChangeSchema), // frozen resolved layer (resolveReviewItemEffectiveChange outputs, item-aligned)
  rawProviderDelta: z.unknown().optional(),        // OPTIONAL audit-only provider payload; NOTHING semantic reads it
  resolvedAt: z.string().datetime(),
  resolution: z.enum(["confirmed-no-changes", "confirmed-changes", "superseded"]),
  supersededBy: z.string().optional(),
});

export const STATE_REVIEW_ERROR_CODES = [
  "state_review_not_found", "state_review_stale", "state_review_conflict",
  "state_review_edit_conflict", "state_review_incomplete",
  "state_review_invalid_change", "state_review_rebuild_failed",
  "state_review_already_resolved", "state_review_write_locked",
] as const;
export class StateReviewError extends Error {
  readonly code: (typeof STATE_REVIEW_ERROR_CODES)[number];
  readonly itemId?: string;
}

export function fnv1a8(input: string): string;                       // 8-hex FNV-1a (item ids only)
export function stateReviewItemId(kind: string, opIndex: number, payload: unknown): string;
// = `${kind}:${opIndex}:${fnv1a8(JSON.stringify(payload))}` — deterministic WITHIN a generation.
```

Steps:
- [ ] RED `state-review-schema.test.ts`: (1) shell variants parse WITHOUT anchors/items; active variant without `reviewId`/anchors/`items` FAILS parse; (2) `decision` defaults `"undecided"`; (3) unknown kind rejected; (4) `fact/set` without object rejected, with object accepted; (5) `hook-upsert` proposal embeds a FULL valid `HookRecordSchema` value and rejects malformed hooks; (6) `resolveReviewItemEffectiveChange` truth table (accepted→proposal; edited→editedChange; rejected→none; user accepted→proposal; note→none; undecided→none; edited-without-editedChange throws `state_review_invalid_change`); (7) `stateReviewItemId` deterministic + input-order-sensitive; (8) `fnv1a8` determinism + 8-hex shape + differs on 1-char change (no magic constants).
- [ ] GREEN implement exactly as frozen; barrel-export public symbols.
- [ ] Verify: `pnpm -C inkos --filter @actalk/inkos-core exec vitest run src/__tests__/state-review-schema.test.ts`
- [ ] Proposed commit: `feat(core): state review domain schemas`

### Task 2 — Prose revision + evidence verification primitives

**Files:** CREATE `packages/core/src/utils/prose-revision.ts`; CREATE `packages/core/src/__tests__/prose-revision.test.ts`.

```ts
export function computeProseRevision(content: string): string;
export function normalizeForEvidenceMatch(text: string): string;   // NFC → collapse /\s+/g→" " → trim → toLowerCase()
export function evidenceQuoteVerified(quote: string, prose: string): boolean;
// normalizeForEvidenceMatch(prose).includes(normalizeForEvidenceMatch(quote))
```

Steps:
- [ ] RED `prose-revision.test.ts`: stable 16-hex for fixed CJK vector; trailing-newline sensitivity; two distinct CJK strings differ; space-inside-quote FALSE vs contiguous TRUE; English case-insensitive TRUE.
- [ ] GREEN implement.
- [ ] Verify focused; commit `feat(core): prose revision + evidence verification primitives`.

## Area B/C — Store + converter + gate

### Task 3 — State review store (+ pure live-state reader)

**Files:** CREATE `packages/core/src/state/state-review-store.ts`; CREATE `packages/core/src/__tests__/state-review-store.test.ts`; barrel exports.

```ts
export const ACTIVE_REVIEW_RELPATH = (chapter: number): string =>
  `story/runtime/chapter-${String(chapter).padStart(4, "0")}.state-review.json`;
export const RECEIPTS_DIR = (chapter: number): string =>
  `story/runtime/state-review-receipts/chapter-${String(chapter).padStart(4, "0")}`;

export async function loadStateReview(bookDir: string, chapter: number): Promise<StateReviewArtifact | null>;
export async function saveStateReviewShell(bookDir: string, shell: ShellArtifact): Promise<void>;      // tmp+rename
export async function publishActiveProposal(bookDir: string, proposal: ActiveArtifact): Promise<void>;
export async function mutateActiveProposal(params: {
  bookDir: string; chapter: number; expectedReviewRevision: number;
  mutate: (active: ActiveArtifact) => ActiveArtifact;   // content WITHOUT bump; store sets expected+1
}): Promise<ActiveArtifact>;                             // mismatch ⇒ StateReviewError("state_review_edit_conflict")
export async function findReceiptByReviewId(bookDir: string, chapter: number, reviewId: string): Promise<ResolvedReviewReceipt | null>;
export async function listReceiptsForChapter(bookDir: string, chapter: number): Promise<ResolvedReviewReceipt[]>; // resolvedAt asc
export async function writeResolvedReceipt(bookDir: string, chapter: number, receipt: ResolvedReviewReceipt): Promise<string>;
export async function supersedeReceiptsForChapter(params: {
  bookDir: string; chapter: number;
}): Promise<Array<{ relativePath: string; content: string }>>;   // PURE: entries flipping resolution/supersededBy only

// PURE live-state reader for confirm paths (blocker 6): four readFile + zod parse.
// NO bootstrapStructuredStateFromMarkdown, NO mkdir, NO heal, NO fallback-to-markdown.
// Missing/corrupt file ⇒ throw Error(`runtime state unreadable: <file> (<cause>)`) — fail-closed, callers surface 500.
export async function readLiveRuntimeStateSnapshot(bookDir: string): Promise<RuntimeStateSnapshot>;
```

Steps:
- [ ] RED `state-review-store.test.ts`: (1) load missing ⇒ null; (2) shell round-trip preserves discriminant, NO anchor fields; (3) CAS wrong revision ⇒ `edit_conflict` + tree unchanged (`captureBookMetadata`); correct revision bumps +1; (4) receipt find/list sorted; miss ⇒ null; (5) supersede returns flip-only entries, arrays byte-identical; (6) every operation leaves `story/state/**` metadata equal; (7) `readLiveRuntimeStateSnapshot` returns parsed snapshot on fixture book; DELETING one state JSON makes it THROW (assert no file created, whole tree unchanged).
- [ ] GREEN implement.
- [ ] Verify focused; commit `feat(core): state review artifact + receipt store`.

### Task 4 — Shared slot vocabulary + delta converter

**Files:** MODIFY `packages/core/src/state/state-projections.ts` (add export), `packages/core/src/state/state-reducer.ts` (consume it), CREATE `packages/core/src/state/state-review-items.ts`, CREATE `packages/core/src/__tests__/state-review-items.test.ts`; barrel exports.

Step A — extract the ONE mapping (see "Shared semantic vocabulary" above):
- [ ] RED first: characterization assertions pinning TODAY's reducer output for zh and en patches (subject `"protagonist"`, predicate first-alias ordering) inside `state-review-items.test.ts` setup section OR existing reducer tests — run existing `state-reducer` / projection suites green BEFORE refactor (baseline capture).
- [ ] Add `describeCurrentStateSlot` to state-projections.ts; refactor `applyCurrentStatePatch` labels block (:276-292) to call it; DELETE the private `labels` tables.
- [ ] GREEN gate: existing reducer + projections suites pass UNCHANGED (byte-stable proof), then converter tests below.

Step B — converter:

```ts
export interface BuildReviewItemsContext {
  readonly chapterContent: string;             // exact bound prose
  readonly language: RuntimeStateLanguage;
}
export function buildStateReviewItems(delta: RuntimeStateDelta, ctx: BuildReviewItemsContext): ReviewItem[];
```

Mapping (exhaustive): each present patch slot ⇒ `current-state-fact` item with `proposal = {type:"fact", change:{action:"set", subject, predicate, object}}` where `{subject, predicate} = describeCurrentStateSlot(slot, ctx.language)`; `hookOps.upsert[i]` ⇒ `{type:"hook-upsert", hook}` (kind `hook-upsert`); mention/resolve/defer ⇒ `{type:"hook-op", op, hookId}`; `newHookCandidates[i]` ⇒ `{type:"new-hook-candidate", candidate}`; `chapterSummary` ⇒ `{type:"chapter-summary", row}`; subplot/emotional/matrix entries + `delta.notes` ⇒ ONE aggregated `note` item with `proposal = {type:"none"}` listing them as unsupported-in-V1. Evidence via Task 2 predicate over candidate value text / hook payoff+notes / summary events; hit ⇒ `{claimedLevel:"explicit", verifiedLevel:"explicit", quote≤200}`, miss ⇒ `{claimedLevel:"inferred", verifiedLevel:"inferred"}`. IDs via `stateReviewItemId(kind, indexWithinKind, payload)`.

- [ ] RED `state-review-items.test.ts`: crafted delta ⇒ EXACT item multiset; quote present only when truly contained (sentence from fixture prose); ids stable across invocations; loose ops ⇒ exactly one `note` item; empty delta ⇒ zero items; **vocabulary equivalence**: for each slot and both languages, converter-emitted `predicate` deep-equals what the reducer persists for the same patch (cross-check against Step-A characterization).
- [ ] GREEN implement.
- [ ] Verify focused + full reducer/projection suites; commit `feat(core): shared slot vocabulary + proposed-delta converter`.

### Task 5 — Advancement gate (exists BEFORE any pipeline consumption)

**Files:** CREATE `packages/core/src/state/advancement-gate.ts`; CREATE `packages/core/src/__tests__/advancement-gate.test.ts`; barrel exports.

EXACT frozen rule (single wording; supersedes every earlier draft):

```
assertCanAdvanceStory(bookDir, nextChapter):
  entries = await readdir(join(bookDir, "story", "runtime")).catch(() => [])
  for each name matching /^chapter-(\d{4})\.state-review\.json$/:
    art = StateReviewArtifactSchema.safeParse(JSON.parse(await readFile(...)))
    if (!art.success) => THROW actionable bilingual error naming the unreadable file (fail-closed)
    if (art.status === "active" || art.status === "stale"):
        blocked ⇔ art.effectiveChapter <= nextChapter
    else (rebuild_required | rebuild_failed shell):
        blocked ⇔ art.sourceChapter < nextChapter
  receipt directories never match the glob ⇒ resolved history NEVER blocks.
  Throw StateReviewError-family with message naming blocking chapter, its status,
  and the words "open State Review in Studio".
```

This covers: normal previous-chapter shell (source=N blocks N+1), historical Ch16 shell while head=25 (16<26 blocks 26), rebuild_failed historical shell (same rule), older unresolved shell blocking any later generation, active historical proposal (effective ≤ next blocks). Resolved receipts alone never block.

Steps:
- [ ] RED `advancement-gate.test.ts`: (1) previous chapter active artifact (effective=head+1) blocks head+1; (2) approved previous + no artifacts ⇒ passes; (3) historical ACTIVE correction source=16/effective=26 blocks `assertCanAdvanceStory(dir, 26)` and also 27+ (26<=27); (4) historical `rebuild_required` shell source=16 blocks 26; (5) historical `rebuild_failed` shell source=16 blocks 26; (6) older unresolved shell source=16 blocks generating 20 (16<20); (7) chapter with only receipts (artifact deleted) never blocks; (8) corrupt artifact JSON ⇒ throws with filename in message.
- [ ] GREEN implement.
- [ ] Verify focused; commit `feat(core): story advancement gate`.

## Area D — Pipeline deferred application

### Task 6 — Writer deferred-save + in-set chapter index (atomic publication seam)

**Files:** MODIFY `packages/core/src/agents/writer.ts` (`saveChapter` :628); CREATE `packages/core/src/__tests__/writer.deferred-save.test.ts`.

Exact signature:

```ts
async saveChapter(
  bookDir: string,
  output: WriteChapterOutput,
  numericalSystem: boolean = true,
  language: RuntimeStateLanguage = "zh",
  options?: {
    readonly deferStateApplication?: boolean;
    readonly stateReviewJson?: string;         // serialized ACTIVE artifact
    readonly updatedChapterIndexJson?: string; // serialized ChapterMeta[] — joins the SAME AtomicFileSet
  },
): Promise<void>
```

When `deferStateApplication === true`:
- Skip `resolveRuntimeStateArtifactsForOutput` entirely (no apply, no rendering, no story writes).
- ONE `commitAtomicFileSet({rootDir: bookDir, writes: [
  {chapters/<filename>},
  ...(options.updatedChapterIndexJson ? [{relativePath: join("chapters","index.json"), content: options.updatedChapterIndexJson}] : []),
  {relativePath: ACTIVE_REVIEW_RELPATH(output.chapterNumber), content: options.stateReviewJson},
], deletes: supersededChapterFiles.map(...)})`.
- ALL other `story/**` writes omitted.
- Options undefined ⇒ byte-identical legacy behavior.

Steps:
- [ ] RED `writer.deferred-save.test.ts` (stubbed `WriteChapterOutput` carrying `runtimeStateDelta`, patterns from `writer.test.ts`): pre-capture tree ⇒ gated save ⇒ (1) chapter md exists; (2) `story/**` untouched; (3) artifact parses; (4) `chapters/index.json` written EXACTLY from provided JSON (pass a two-entry array containing `needs-state-review` entry; assert bytes equal); (5) mid-set `renameFile` failure ⇒ entire tree equals pre-capture (rollback), no partial; (6) ungated control still writes story files + does NOT touch index.json beyond legacy behavior.
- [ ] GREEN implement.
- [ ] Verify focused + `writer.test.ts` green. Commit `feat(core): writer deferred publication with in-set chapter index`.

### Task 7 — Gated pipeline flow (consumes Tasks 2,4,5,6 only)

**Files:** MODIFY `packages/core/src/models/chapter.ts`, `packages/core/src/pipeline/chapter-persistence.ts`, `packages/core/src/pipeline/runner.ts`; CREATE `packages/core/src/__tests__/pipeline-runner.gated.test.ts`.

Changes:
1. `ChapterStatusSchema` += `"needs-state-review"`.
2. `persistChapterArtifacts` reordering for the gated status — THE pinned seam:
   ```ts
   if (params.status === "needs-state-review") {
     const existingIndex = await params.loadChapterIndex();
     const entry: ChapterMeta = { /* built exactly as today, status: "needs-state-review" */ };
     const updatedIndex = upsertByNumber(existingIndex, entry);
     await params.saveChapter({ chapterIndexJson: JSON.stringify(updatedIndex) }); // writer's ONE atomic set
     await params.markBookActiveIfNeeded();
     await params.persistAuditDriftGuidance(driftIssues);
     return { entry };                      // NO saveTruthFiles, NO snapshotState,
                                            // NO syncCurrentStateFactHistory, NO saveChapterIndex call
   }
   // …legacy path for the other statuses, unchanged…
   ```
   Seam type widens to `readonly saveChapter: (extra?: { readonly chapterIndexJson?: string }) => Promise<void>` (legacy callers pass nothing).
3. Runner `_executeNextChapterLocked`: after `assertNoPendingStateRepair` (:2008) insert `await assertCanAdvanceStory(bookDir, chapterNumber);` (symbol EXISTS — Task 5). After audit, capture RAW Settler `persistenceOutput.runtimeStateDelta`; anchors: `proseRevision = computeProseRevision(<exact chapterContent string writer will persist>)`; `baseCanonRevision = (await readStoryCanon(bookDir)).revision`; `effectiveChapter = durable + 1` where `durable = await resolveDurableStoryProgress({ bookDir })`; `reviewId = randomUUID()` (fresh EVERY publication); items via `buildStateReviewItems(delta, {chapterContent, language})`; artifact assembled with `reviewRevision: 1`. `saveChapter` seam closure passes `{ deferStateApplication: true, stateReviewJson, }`; runner computes `updatedIndex` FIRST? No — persistence module does (step 2). Zero-proposal ⇒ STILL `needs-state-review`, `items: []` (§19).
4. Manual prose mode (`chapterReviewMode === "manual"`, :2063) orthogonal/unchanged.

Steps:
- [ ] RED `pipeline-runner.gated.test.ts` (LLM stub harness per `pipeline-runner.test.ts`): gated write ⇒ (1) prose persisted; (2) `chapters/index.json` ON DISK contains entry.status `needs-state-review` IMMEDIATELY after the single atomic commit — and a spy asserting `saveChapterIndex` seam was NEVER invoked in this flow; (3) `story/state/*.json` + 3 projection mds byte-unchanged; (4) artifact parses with anchors + `items` from stub delta + `reviewRevision: 1`; (5) zero-proposal stub ⇒ `items: []`, status still gated; (6) ungated control end-to-end unchanged (state files written, `ready-for-review`, snapshot exists, index via legacy path).
- [ ] GREEN implement.
- [ ] Verify focused + `writer.test.ts` + `pipeline-runner.test.ts`. Commit `feat(core): gated pipeline publishes proposal + index atomically`.

## Area E/F — Decisions, invalidation, rebuild

### Task 8 — Decisions with reviewRevision CAS

**Files:** CREATE `packages/core/src/state/state-review-service.ts` (decisions part); CREATE `packages/core/src/__tests__/state-review-decisions.test.ts`; barrel exports.

```ts
decideStateReviewItem({bookDir, chapter, itemId, decision: "accept"|"reject", expectedReviewRevision, overrideExplicitWarning?})
  // reject + evidence.verifiedLevel==="explicit" && !override ⇒ StateReviewError("state_review_invalid_change","explicit-evidence-warning-required",itemId)
editStateReviewItem({bookDir, chapter, itemId, expectedReviewRevision, editedChange: ProposalChange})
  // decision := "edited"; reviewed immediately; proposal PRESERVED; kind-vs-change validation else invalid_change+itemId
addUserStateReviewItem({bookDir, chapter, expectedReviewRevision, kind, change: ProposalChange, title})
  // origin:"user", decision:"accepted", id = stateReviewItemId("user", seq, payload)
removeUserStateReviewItem({bookDir, chapter, itemId, expectedReviewRevision})   // user items only
rejectAllAiItems({bookDir, chapter, expectedReviewRevision, overrideExplicitWarning?})
  // batch reject on actionable AI items; does NOT resolve; override flag applies when any verified-explicit included
```
All operate only on `status==="active"` artifacts (else `not_found`/`stale`); every success bumps `reviewRevision` +1 via Task 3 CAS; Canon untouched.

- [ ] RED: accept/edit(22→24: decision edited, proposal 22, editedChange 24)/explicit-reject friction both ways/add-user/edit-user/remove-user/remove-AI⇒invalid_change/rejectAll (note items untouched, still active)/stale revision⇒edit_conflict bytes unchanged/shell target⇒stale — plus whole-tree Canon-frozen assertion after EACH case.
- [ ] GREEN; verify focused; commit `feat(core): state review decision service`.

### Task 9 — Atomic prose-edit invalidation (pending + READY)

**Files:** MODIFY `packages/core/src/interaction/edit-controller.ts` (`executeEditTransaction` :495, chapter-replace arm); MODIFY `packages/core/src/state/state-review-service.ts` (add `handleStateRelevantProseSave`); CREATE `packages/core/src/__tests__/state-review-invalidate.test.ts`.

```ts
export async function handleStateRelevantProseSave(params: {
  bookDir: string; chapter: number; language: RuntimeStateLanguage;
}): Promise<{
  indexEntryUpdate: (entry: ChapterMeta) => ChapterMeta;     // sets status needs-state-review (+updatedAt)
  shellWrite: { relativePath: string; content: string };
  receiptWrites: Array<{ relativePath: string; content: string }>;
}>;
```

Controller chapter-replace arm (under caller lock) builds ONE transaction — exact set:

```ts
await commitAtomicFileSet({
  rootDir: bookDir,
  writes: [
    { relativePath: chapterRelPath, content: fullText },
    shellWrite,                                   // rebuild_required shell (create-or-replace)
    ...receiptWrites,                             // resolution:"superseded" flips where applicable
    { relativePath: join("chapters", "index.json"), content: JSON.stringify(updatedIndex) },
  ],
  deletes: supersededChapterFiles,                // legacy rename-away deletes preserved
});
```

NO post-transaction `deps.saveChapterIndex` call remains on this path (legacy non-review edit kinds keep their existing behavior).

- [ ] RED `state-review-invalidate.test.ts`: (A) pending review + replace ⇒ new prose, artifact REPLACED by shell, index status `needs-state-review` ON DISK IN THE SAME COMMIT (inject `renameFile` throwing AFTER the index rename would occur ⇒ OLD complete state fully restored incl. old index status); (B) READY chapter with seeded resolved receipt ⇒ receipt flipped `superseded` + shell + index all-or-nothing (mid-set failure restores everything); (C) unit: handler on chapter with no review history ⇒ empty receiptWrites; (D) whole-tree assertions around every scenario.
- [ ] GREEN; verify focused + `edit-controller.test.ts` green. Commit `feat(core): atomic prose-edit review invalidation`.

### Task 10 — Rebuild (Retry Audit) — fresh reviewId per generation

**Files:** MODIFY `packages/core/src/state/state-review-service.ts`; CREATE `packages/core/src/__tests__/state-review-regenerate.test.ts`.

```ts
export async function rebuildStateReview(params: {
  bookDir: string; chapter: number; language: RuntimeStateLanguage;
  analyze: (input: { chapterContent: string }) => Promise<RuntimeStateDelta>;
  // production wires ChapterAnalyzerAgent.analyzeChapter (chapter-analyzer.ts:42); adapter extracts .runtimeStateDelta
}): Promise<{ artifact: ActiveArtifact }>;
```

- Loads shell (`rebuild_required`|`rebuild_failed` else `already_resolved`/`stale`); reads latest prose bytes ⇒ `proseRevision`; `readStoryCanon` ⇒ `baseCanonRevision`; `effectiveChapter = resolveDurableStoryProgress({bookDir}) + 1` (§20); `analyze()` ⇒ items via Task 4; **`reviewId = randomUUID()`** — brand-new for EVERY successful rebuild, including when NO receipt exists yet (no counters, no clock-derived ids); persisted once, stable within the generation. Analyze throw ⇒ shell→`rebuild_failed` (durable) + `StateReviewError("state_review_rebuild_failed", original.message)`. No decision carry-forward.

- [ ] RED: (1) R1 active → `handleStateRelevantProseSave` → rebuild ⇒ R2 active with **R1.reviewId !== R2.reviewId** and ZERO intervening receipts; (2) shell rebuild_failed → failing analyze again stays failed; then succeeding retry ⇒ new successful proposal with yet another fresh reviewId; (3) anchors equal freshly computed revisions; (4) confirm attempt on shell refused; Canon frozen throughout.
- [ ] GREEN; runner gets thin `regenerateStateReview(bookId, chapter)` wrapper (analyzer construction). Verify focused; commit `feat(core): state review rebuild with per-generation review ids`.

## Area G/H/I — PREPARE + CONFIRM

### Task 11 — Pure PREPARE (pure read paths ONLY)

**Files:** CREATE `packages/core/src/state/state-review-confirm.ts`; CREATE `packages/core/src/__tests__/state-review-confirm.test.ts`; barrel exports.

PURE READ FUNCTION ALLOWLIST (everything prepare may call — audited against real loaders):

| Function | Why pure |
|---|---|
| `readStoryCanon(bookDir)` (canon-service.ts:333) | established P3A pure Canon read boundary |
| `readLiveRuntimeStateSnapshot(bookDir)` (NEW, Task 3) | 4×readFile + zod parse; throws on missing/corrupt; NO bootstrap/heal/mkdir/markdown-fallback |
| `computeProseRevision` + raw `readFile` of chapter bytes | pure |
| `loadStateReview` / `findReceiptByReviewId` / `listReceiptsForChapter` (Task 3) | readFile/readdir only |
| raw `readFile("chapters/index.json")` + JSON.parse + array check | NO `StateManager.loadChapterIndex` (it heals-by-reconstruction logically); missing/unparseable ⇒ typed error |
| `describeCurrentStateSlot` (Task 4) | pure |
| `buildRuntimeStateArtifactsFromSnapshot` (runtime-state-store.ts:131) | PURE arbitrate+apply+render, no fs |
| `validateRuntimeState` (state-validator.ts:14) | pure |
| NEW `composeSnapshotWrites(bookDir, effectiveChapter, artifacts)` (local to this module, readFile-only) | copies unchanged slots from live disk, renders 3 slots from artifacts, embeds 4 computed state JSONs targeting `story/snapshots/<E>/` |

BANNED in PREPARE (documented): `loadRuntimeStateSnapshot` (calls `bootstrapStructuredStateFromMarkdown` which WRITES), `bootstrapStructuredStateFromMarkdown`, `StateManager.loadChapterIndex`, any mkdir/write/rm. `resolveDurableStoryProgress` is NOT called inside prepare — the CALLER (route/runner, under lock) passes:

```ts
export interface PreparedStateReviewConfirm {
  readonly receipt: ResolvedReviewReceipt;
  readonly receiptWrite: { relativePath: string; content: string };
  readonly indexWrite: { relativePath: string; content: string };   // chapters/index.json, entry approved
  readonly canonWrites: ReadonlyArray<{ relativePath: string; content: string }>;
  readonly projectionWrites: ReadonlyArray<{ relativePath: string; content: string }>;
  readonly snapshotWrites: ReadonlyArray<{ relativePath: string; content: string }>;
  readonly deletes: ReadonlyArray<string>;                          // pending artifact relpath
  readonly resultingCanonRevision: string;
  readonly effectiveChapter: number;
  readonly zeroEffectiveChange: boolean;
}
export async function prepareStateReviewConfirm(params: {
  bookDir: string; chapter: number; expectedReviewRevision: number;
  durableHead: number;                       // caller-resolved CURRENT durable progress
}): Promise<PreparedStateReviewConfirm>;
```

Check order (§9.A): loaded-artifact status must be `active` (shell/stale ⇒ respective errors) → `expectedReviewRevision` ⇒ `edit_conflict` → `proseRevision` vs recomputed file hash ⇒ `state_review_stale` → `baseCanonRevision` vs `readStoryCanon` ⇒ `state_review_conflict` → temporal rules §20 against `params.durableHead` (normal source===effective===head+1; correction source<head ⇒ effective=head+1; head moved past effective ⇒ APPLY-ZERO error) → completeness (AI `undecided` ⇒ `state_review_incomplete`; invalid user item ⇒ `state_review_invalid_change`+itemId) → compile ONE `RuntimeStateDelta` (delta.chapter = effectiveChapter) from `resolveReviewItemEffectiveChange` per item → `buildRuntimeStateArtifactsFromSnapshot({snapshot: readLiveRuntimeStateSnapshot(), delta, language})` → receipt (typed three-layer arrays; `effectiveChanges` item-aligned) → index update in memory. Zero-effective-change ⇒ canon/projection writes EMPTY; snapshotWrites still composed; receipt `confirmed-no-changes`.

Steps:
- [ ] RED `state-review-confirm.test.ts` PREPARE section — EVERY case asserts whole-tree `captureBookMetadata` deep-equality before/after: happy 2-item confirm; zero-change; all-rejected; **stale** (prose tampered); **conflict** (advance Canon via P3A `commitCanonEdits`); **invalid-item** (user item empty object ⇒ invalid_change+itemId); **historical-temporal-failure** (caller passes durableHead ≥ effectiveChapter ⇒ APPLY-ZERO error); plus undecided ⇒ `state_review_incomplete`; revision mismatch ⇒ `edit_conflict`; returned `canonWrites` parse against schemas and differ from current by exactly the stubbed delta; `indexWrite` parses as ChapterMeta[] with approved entry; **static purity guard**: grep-style unit test asserting prepare module never imports `bootstrapStructuredStateFromMarkdown`/`mkdir`/`writeFile`/`rm`.
- [ ] GREEN implement (enforce by construction: imports limited to readFile/readdir/stat + listed functions).
- [ ] Verify focused; commit `feat(core): state review confirm prepare (pure reads)`.

### Task 12 — confirmStateReview with reviewId-keyed idempotency

**Files:** MODIFY `packages/core/src/state/state-review-confirm.ts` (add confirm); MODIFY `packages/core/src/pipeline/runner.ts` (gate wiring done in Task 7 — no further change needed here); barrel exports.

Exact signature + flow:

```ts
export async function confirmStateReview(params: {
  bookDir: string;
  chapter: number;
  reviewId: string;                 // REQUIRED — keys idempotency AND identity
  expectedReviewRevision: number;
  durableHead?: number;             // optional override; default resolveDurableStoryProgress({bookDir}) under caller lock
  deps?: { renameFile?: (from: string, to: string) => Promise<void> };
}): Promise<{
  status: "resolved" | "already_resolved";
  receipt: ResolvedReviewReceipt;
  resultingCanonRevision: string;
  warnings: ReadonlyArray<string>;
}>;
// CALLER HOLDS BOOK LOCK. Inside the lock, EXACTLY this order:
// 1. receipt = await findReceiptByReviewId(bookDir, chapter, params.reviewId)   ← FIRST, pure read
// 2. if (receipt) return { status: "already_resolved", receipt, resultingCanonRevision:
//        receipt.resultingCanonRevision, warnings: [] };                        ← ZERO writes.
//    This succeeds even though the active artifact WAS DELETED at original resolution.
// 3. active = await loadStateReview(bookDir, chapter);
//    !active || active.status !== "active" ⇒ StateReviewError("state_review_not_found")
// 4. active.reviewId !== params.reviewId ⇒ StateReviewError("state_review_not_found",
//    message names the superseding generation)                                  ← identity binding
// 5. prepared = await prepareStateReviewConfirm({ bookDir, chapter,
//        expectedReviewRevision, durableHead: params.durableHead ?? await resolveDurableStoryProgress({ bookDir }) })
// 6. ONE commitAtomicFileSet({ rootDir: bookDir,
//      writes: [...prepared.canonWrites, ...prepared.projectionWrites,
//               ...prepared.snapshotWrites, prepared.receiptWrite, prepared.indexWrite],
//      deletes: [prepared.deletes[0]],
//      ...(deps?.renameFile ? { renameFile: deps.renameFile } : {}) })
// 7. Derived memory (P3 pattern): try rebuildNarrativeMemoryIndex(bookDir)
//    then rebuildCurrentStateFactHistory(bookDir, prepared.effectiveChapter - 1)
//    catch ⇒ invalidateDerivedMemory(bookDir); push its warning string when strategy==="failed".
// 8. Return { status: "resolved", … }.
```

Steps:
- [ ] RED (extend `state-review-confirm.test.ts`): (a) normal confirm ⇒ canon changed per delta, snapshot `<E>/` populated, index approved ON DISK, receipt written, artifact DELETED, warnings []; (b) **lost-response retry**: rerun with SAME reviewId AFTER artifact deletion ⇒ `already_resolved`, ZERO tree changes, MemoryDB hook-row count stable; (c) **double confirm** second call ⇒ same; (d) retry with WRONG reviewId after resolution (generation gone, receipt exists for other id) ⇒ `state_review_not_found` (no writes); (e) reviewId mismatch against LIVE artifact (R2 active, confirm R1's id) ⇒ `state_review_not_found`, zero writes; (f) one invalid user item ⇒ throws AND tree equals pre-confirm capture; (g) atomic failure injection `renameFile` mid-set ⇒ tree equals pre-confirm capture, artifact still present, retry with same reviewId then SUCCEEDS; (h) stale/conflict/temporal failures ⇒ typed errors, zero writes; (i) zero-change + all-rejected ⇒ `confirmed-no-changes`, READY; (j) derived-memory failure stub ⇒ confirm still resolved, db invalidated, exact P3 warning string surfaced.
- [ ] GREEN implement.
- [ ] Verify focused + `pipeline-runner.gated.test.ts` + `canon-commit.test.ts`. Commit `feat(core): reviewId-keyed idempotent confirm transaction`.

## Area J/K — Historical + surfaces

### Task 13 — Historical corrections end-to-end (incl. shell gating)

**Files:** CREATE `packages/core/src/__tests__/state-review-historical.test.ts`.

- [ ] RED: head-25 fixture (25 approved entries + snapshots via `snapshotStateAt`): (1) pending correction artifact source=16/effective=26 ⇒ chapters 17–25 statuses untouched; `assertCanAdvanceStory(dir, 26)` BLOCKED; confirm applies anchored at 26 (`MemoryDB.getFactsAt("protagonist", 26)` row present); receipt preserves source=16/effective=26; NO file under `chapters/0017..0025` or `story/snapshots/17..25` changes metadata; (2) **historical `rebuild_required` shell source=16** ⇒ blocks Ch26 generation until rebuilt/resolved (rule: sourceChapter < nextChapter); (3) **historical `rebuild_failed` shell source=16** ⇒ same block; (4) after resolving (confirm/rebuild+confirm) ⇒ 26 generatable; (5) resolved receipts alone never block.
- [ ] GREEN (expect mostly fixture-side fixes; production generalized in Tasks 5/11/12).
- [ ] Verify focused; commit `test(core): historical correction end-to-end incl. shell gating`.

### Task 14 — HTTP routes + typed client (confirm carries reviewId)

**Files:** MODIFY `packages/studio/src/api/server.ts`; CREATE `packages/studio/src/lib/state-review-api.ts`; CREATE `packages/studio/src/__tests__/state-review-route.test.ts`.

Routes (mutations wrap `acquireBookLock`…`finally release()`):

```
GET    /api/v1/books/:id/chapters/:num/state-review
POST   /api/v1/books/:id/chapters/:num/state-review/decision  {itemId, decision, expectedReviewRevision, overrideExplicitWarning?}
POST   /api/v1/books/:id/chapters/:num/state-review/edit      {itemId, editedChange, expectedReviewRevision}
POST   /api/v1/books/:id/chapters/:num/state-review/items     {kind, change, title, expectedReviewRevision}
DELETE /api/v1/books/:id/chapters/:num/state-review/items/user/:itemId?expectedReviewRevision=
POST   /api/v1/books/:id/chapters/:num/state-review/reject-all{expectedReviewRevision, overrideExplicitWarning?}
POST   /api/v1/books/:id/chapters/:num/state-review/confirm   {reviewId, expectedReviewRevision}   ← reviewId REQUIRED
POST   /api/v1/books/:id/chapters/:num/state-review/rebuild   {}
GET    /api/v1/books/:id/chapters/:num/state-review/receipts
```

Error mapping: `StateReviewError` ⇒ `not_found`→404; all other codes→409 `{code, itemId?, message}`; non-StateReviewError ⇒ 500 fixed string. Client functions return `{ok:true,…}|{ok:false, code, itemId?}`; `confirmReview(bookId, num, reviewId, expectedReviewRevision)`.

- [ ] RED `state-review-route.test.ts`: GET happy; decision round-trip bumps revision; wrong expectation ⇒ 409 `edit_conflict`; confirm WITHOUT reviewId ⇒ 400; confirm with matching reviewId ⇒ 200 resolved + fs assertions; **lost-response retry through HTTP** (repeat confirm post-deletion) ⇒ 200 `already_resolved`; wrong reviewId ⇒ 409/404 per Core mapping; shell confirm ⇒ 409 `state_review_stale`… (shell confirm hits not_found path — assert exact mapped code from Core); rebuild failing analyzer ⇒ 409 `state_review_rebuild_failed`; receipts sorted; unknown book ⇒ 404.
- [ ] GREEN; verify focused studio suite; commit `feat(studio): state review http api + typed client`.

### Task 15 — Review UI state model + page

**Files:** CREATE `packages/studio/src/pages/state-review-ui-state.ts` + `.test.ts`; CREATE `pages/StateReviewPage.tsx`; MODIFY `App.tsx` (route, keyed `key={bookId}`), `ChapterReader.tsx` (badge/link + rebuild-failed banner actions).

Model: domain groups (Current State ← fact items; Hooks/Subplots ← hook kinds + candidates; Chapter Summary; User Added ← origin user); progress `reviewedCount/total`; confirmEnabled = all reviewed && no invalid user items; confirm action SENDS the loaded artifact's `reviewId`; explicit-reject warning modal (Cancel/Edit/RejectAnyway ⇒ override dispatch); zero-change layout switch; historical banner (sourceChapter < head from workspace data); rebuild_failed banner (Retry Audit / Edit Chapter); receipt viewer chips (resolved/superseded).

- [ ] RED model tests: progress math; gating; warning modal payload carries `overrideExplicitWarning:true`; zero-change switch; banner selectors; confirm dispatch payload includes `reviewId`.
- [ ] GREEN model + page wiring (extract `StateReviewGroups.tsx` only if page exceeds ~600 lines). Verify studio suite; commit `feat(studio): state review ux`.

### Task 16 — CLI refusal surfacing

**Files:** MODIFY `packages/cli/src/commands/write.ts`, `auto.ts` (printing only).

- [ ] Inspect catch/print blocks (:64/:233, :86); ensure gate error prints verbatim ("State Review" + blocking chapter + Studio pointer). Regression tests in `packages/cli/src/__tests__/auto-command.test.ts` + write-command test: stubbed pipeline throwing gate error ⇒ stdout contains "State Review"; static assertion `reviewCommand.commands` unchanged (no collision with prose `review`). RED-first even if printing already verbatim.
- [ ] Verify CLI suites; commit `test(cli): state review gate refusal surfaced`.

### Task 17 — Final integration checkpoint

- [ ] Sequential, each awaited alone: focused Phase 4 core tests → core suite (only the 2 known EPERM failures) → studio suite → CLI suites → `pnpm -C inkos typecheck` → `pnpm -C inkos build`.
- [ ] Walk acceptance matrix + blocker-verification map; gaps ⇒ new RED test first.
- [ ] Commit: `test: phase 4 acceptance matrix verified`.

## Acceptance coverage matrix (spec §32 scenario → tests)

| # | Scenario | Tests |
|---|---|---|
| 1 | Happy path | `pipeline-runner.gated` → `state-review-confirm` normal confirm (12.a) → gate passes-after |
| 2 | Zero delta | `pipeline-runner.gated` zero-proposal + `state-review-confirm` zero-change |
| 3 | Edited proposal | `state-review-decisions` edit + confirm applies edited value; receipt keeps proposal+edited separately |
| 4 | Explicit reject | `state-review-decisions` friction + override + route flow |
| 5 | Incomplete | `state-review-confirm` undecided ⇒ incomplete + UI gating |
| 6 | Canon conflict | `state-review-confirm` conflict path (full-tree equality) |
| 7 | Prose stale | `state-review-confirm` stale path |
| 8 | Edit pending | `state-review-invalidate` (A) + `state-review-regenerate` R1≠R2 |
| 9 | Edit READY | `state-review-invalidate` (B) |
| 10 | Rebuild failure | `state-review-regenerate` failure + retry fresh reviewId + `state-review-invalidate` (C) |
| 11 | Historical edit | `state-review-historical` (1) + `advancement-gate` (3)-(6) |
| 12 | Invalid batch | `state-review-confirm` one-invalid-applies-zero (12.f) |
| 13 | Crash mid-confirm | `state-review-confirm` atomic injection (12.g) |
| 14 | Network retry | `state-review-confirm` lost-response/double/wrong-id (12.b–e) + HTTP retries (T14) |
| 15 | Derived-memory failure | `state-review-confirm` (12.j) |
| 16 | CLI bypass | `advancement-gate` + CLI surfacing (T16) |

Invariant mapping (1–15): 1→T6/T11 (runtime writes only in confirm); 2→T3/T6; 3→T7/T8; 4→T4 groups/UI; 5→T3 CAS+T8; 6→T11 anchors/T12 identity; 7→T11/T12 all-or-nothing; 8→T12 single set incl. index+receipt+closure; 9→T11 engine reuse; 10→T5 gate in runner (T7); 11→T9/T10 prose kept on failure; 12→T13; 13→T5 `<=` + shell rule + T13; 14→T12 step 7; 15→T8 explicit-warning contract.

## Blocker-verification map (patch self-review → exact evidence)

| Requirement | Where proven |
|---|---|
| Confirm retry works after artifact deletion | T12 tests (b)(c)(g-retry); T14 HTTP retry |
| Initial proposal + lifecycle status one transaction | T6 test (4); T7 test (2)+(spy: no `saveChapterIndex` call) |
| Prose invalidation + lifecycle status one transaction | T9 tests (A)/(B) incl. mid-set rollback of index |
| Every generation fresh reviewId | T10 test (1) R1≠R2 with zero receipts; T10 test (2); T7 uses `randomUUID` |
| Historical rebuild_required AND rebuild_failed shells block Ch26 | `advancement-gate` tests (4)(5); `state-review-historical` (2)(3) |
| No task uses a future-task symbol | Dependency-sorted order T1→T17; ground-rule #7 |
| PREPARE no bootstrap/healing loaders | T11 allowlist/banned lists + import-guard unit test + full-tree equality on 6 paths |
| No local Chinese-language assumptions | `RuntimeStateLanguageSchema` reused (T1 artifacts); shared `describeCurrentStateSlot` (T4); reducer vocabulary `subject:"protagonist"` only |
| Converter/reducer share vocabulary | T4 Step A/B cross-check test |
| No placeholder schemas | T1 typed `ProposalChange`/`HumanDecisionRecord`/receipt arrays; `rawProviderDelta` optional-audit only |
| No second state engine / no partial apply | T11/T12 exclusive use of `buildRuntimeStateArtifactsFromSnapshot`; zero-write failure proofs |
| 15 invariants + 16 scenarios mapped | Matrix above |

## Spec reconciliation note

Blockers 1–7 were implementable as plan-level precision without contradicting the approved spec: reviewId-keyed idempotency realizes §24 (receipt lookup precedes artifact access); in-set index writes realize §16's single-transaction requirement mechanically; per-generation UUIDs satisfy §13's uniqueness intent without determinism claims; the shell gate rule (sourceChapter < nextChapter) is the concrete reading of §21–22 for non-confirmable artifacts lacking `effectiveChapter`. **The approved spec remains unchanged.**
