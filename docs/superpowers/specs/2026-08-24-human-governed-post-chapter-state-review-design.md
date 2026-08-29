# Phase 4 Design Spec — Human-Governed Post-Chapter State Review

| | |
|---|---|
| Date | 2026-08-24 |
| Status | **AUTHORITATIVE DESIGN — human-approved. Implementation NOT begun.** |
| Branch | `feature/human-controlled-story-state-v1` |
| Supersedes | The earlier Phase 4/5/6 task sketches in `docs/IMPLEMENTATION_PLAN.md` (T4.1–T6.x) wherever they conflict with this document. The plan retains its role as the task breakdown; implementation must reconcile it to THIS spec (see Appendix A). |
| Builds on | P0–P2 read-only Canon viewer · P3A manual mutation engine (`7eabf216`) · P3B Studio editing + lock ownership (`b59f5dff`) · P3.1 semantic no-op hardening (`452bdd77`) |
| Out of scope here | Any production code change. TDD/implementation planning happens AFTER this spec is accepted. |

---

## 0. Product principle

castor continues to automate the writing workflow, but the **human author is the final
authority over story meaning and Canon**.

There remains **exactly one Canon store**: `story/state/*.json`. Everything this phase
adds — proposals, decisions, receipts — is **pending workflow / audit data**. It is never
a second Canon store and must never become Writer context (Invariant 2).

Phase 4 inserts ONE governance step into the existing state pipeline:

```
Chapter prose
  → Audit
  → Observer
  → Settler
  → PROPOSED RuntimeStateDelta        (new: captured, not applied)
  → HUMAN STATE REVIEW                (new)
  → CONFIRMED semantic delta          (human-approved subset/edits)
  → existing Core reducers            (UNCHANGED engine)
  → canonical story state             (UNCHANGED store)
```

No second state engine is designed. The review layer governs **what** is applied;
Core remains responsible for **how** Canon is represented.

---

## 1. Chapter lifecycle

Conceptual lifecycle:

```
PLANNING → WRITING → DRAFTED → AUDITING → NEEDS_STATE_REVIEW → READY
```

Integration rules with the REAL repository:

- `ChapterStatusSchema` (`packages/core/src/models/chapter.ts`) already carries the
  pipeline statuses (`drafted`, `auditing`, `audit-passed`, `audit-failed`,
  `ready-for-review`, `approved`, …). Phase 4 adds exactly **one** new enum value,
  `needs-state-review` (as sketched by plan T5.2), and reuses `approved` as the
  terminal **READY** meaning. No proliferation of top-level statuses beyond that.
- While `needs-state-review`, all review-workflow detail lives in the **review workflow
  substate** carried by the active review artifact (§3): `active | stale |
  rebuild_required | rebuild_failed`. These are properties of the review workflow
  record, NOT new chapter statuses.
- READY (`approved`) is the only normal advancement state.
- **Zero-proposal rule:** even when the AI proposes ZERO story-state changes, the
  chapter stays `needs-state-review` until the human uses *Add Missing Change* /
  *Confirm No Changes* (§19). Nothing auto-READYs.

Exact persistence of the status transition follows the existing chapter-index
machinery (`state-manager`) during implementation; this spec fixes semantics only.

## 2. Author-relevant review scope

Review covers ALL author-relevant story meaning produced by the post-chapter pipeline,
restricted to what Core reducers actually support today:

| Review domain | Supported via | Notes |
|---|---|---|
| Current-state facts | `RuntimeStateDelta.currentStatePatch` → fact set/remove | primary case |
| Hooks / subplots | hook ops upsert / mention / resolve / defer; new-hook candidates | incl. arbitration posture reused from the write path |
| Relationships / emotional-state / arcs | **only** insofar as they are represented as current-state facts or hooks in Core today | no new relationship engine in V1 |
| Chapter summary (author-facing row) | `chapterSummary` delta row | |

**Never exposed as editable fields** (Core derives them): hashes, snapshot IDs,
timestamps, internal counters, `advancedCount`, indexes, schema IDs, validFrom/source
chapter anchoring, migration warnings, or any other reducer bookkeeping.

Human chooses story meaning; Core derives technical representation.

## 3. Active state review artifact

Pending (unresolved) review artifact:

```
story/runtime/chapter-NNNN.state-review.json
```

This matches both the repository's existing runtime-artifact home (`story/runtime/`
already hosts derived runtime data such as `memory.db`) and the plan's T4.3 sketch;
ownership and semantics below are normative even if the final layout shifts slightly
during implementation.

The schema contract has TWO requirement tiers on ONE artifact path (the same file is
workflow shell AND active proposal — never a duplicate store). The exact low-level
shell schema remains an implementation-planning detail; what is frozen here is WHICH
fields are mandatory in which tier.

**A. Durable workflow-shell fields** — mandatory whenever the artifact represents
non-confirmable workflow state (`rebuild_required`, `rebuild_failed`): a chapter-scoped
review-workflow identity, `status`, lifecycle timestamps and language — the minimum
needed to render Studio state, drive Retry Audit, and survive crashes. A shell MUST
NOT be required to carry proposal data it cannot have yet.

**B. Additional fields mandatory when `status = "active"`** (a confirmable proposal):

| Field | Meaning |
|---|---|
| `reviewId` | stable identity of THIS review generation (fresh on every rebuild) |
| `sourceChapter` | chapter whose prose produced the proposal |
| `effectiveChapter` | temporal position the confirmed changes will anchor at; normal chapters: `= sourceChapter` (= durable head + 1 at proposal generation); historical corrections: durable head + 1 at proposal generation — revalidated at Final Confirm per the normative rules in §20 |
| `proseRevision` | deterministic hash of the exact saved prose the proposal was generated from |
| `baseCanonRevision` | `computeCanonRevision` fingerprint the proposal was generated against |
| `reviewRevision` | optimistic-concurrency counter of the ARTIFACT itself (bumps on every decision/add/remove save) |
| `items[]` | review items (§4) |

plus bookkeeping (`createdAt`, `language`) and the shared `status` field.

**Three independent concurrency anchors are required on every ACTIVE proposal** (none
of them exists on a pre-proposal shell):

1. `proseRevision` — protects against confirming a proposal generated from old prose (§14).
2. `baseCanonRevision` — protects Canon from stale confirmation (§13).
3. `reviewRevision` — protects concurrent review editing (§12).

**Workflow shell (pre-proposal durability).** The SAME artifact path also acts as a
durable WORKFLOW SHELL whenever no confirmable proposal currently exists:

- editing/saving a READY or currently-reviewed chapter atomically CREATES OR REPLACES
  the workflow shell with `status = "rebuild_required"`;
- a failed auto-rebuild transitions the shell to `status = "rebuild_failed"`;
- a successful rebuild publishes proposal items and transitions it to
  `status = "active"`;
- a shell is NON-CONFIRMABLE by definition and carries only identity/lifecycle fields;
- proposal-specific mandatory data (the three anchors, items) is required ONLY for an
  ACTIVE, confirmable proposal — a pre-proposal shell must not be forced to carry
  impossible proposal data;
- Retry Audit always operates FROM this durable shell against the latest saved prose +
  latest current Canon.

Crash after prose save but before/during audit is therefore fully represented by
durable files at every instant. Still exactly one Canon store and one state engine.

Resolved reviews become **receipts** (§23) stored separately (historical content
immutable; one system-managed lifecycle transition — §23); the pending artifact /
shell is closed or replaced atomically at confirmation (§9).

## 4. Review item model

Common envelope:

```
ReviewItem {
  id                 // stable within one review generation; NOT array position
  kind               // maps onto a semantic operation Core actually supports (below)
  origin             // "ai" | "user"
  proposal           // the AI-proposed semantic change (immutable once created)
  evidence           // { claimedLevel, verifiedLevel?, quote? }   (§7)
  decision           // human decision record                     (§5)
  effectiveChange    // the final semantic change after human editing (§6)
}
```

- **Stable IDs:** deterministic content-derived ids (fnv-based, per plan T4.1 pattern),
  stable across page reloads within one review generation. Array position is never
  identity.
- **Regeneration:** a stale/rebuilt review is a NEW generation with a NEW `reviewId`
  and NEW item ids, because decisions are never carried forward (§15).
- **origin:** `"ai"` for proposed items, `"user"` for author-added items. `origin`
  exists ONLY inside review/audit artifacts. **`origin:"manual"` must NOT be
  introduced into Canon** (amended D5 stands — no provenance in `story/state/*.json`).
- **kind set (V1)** — exactly the operations the existing engine supports, mapped 1:1
  onto reducer/delta vocabulary:
  - `current-state-fact` (set or remove one semantic fact)
  - `hook-upsert` / `hook-mention` / `hook-resolve` / `hook-defer`
  - `new-hook-candidate` (accept ⇒ promote through the existing candidate path)
  - `chapter-summary` (author-facing summary row)
  - `note` (informational, zero effective change — e.g. unmappable legacy remnants)

  Raw JSON-patch operations are forbidden. Kinds unsupported by the reducer are NOT
  invented (§10); gaps discovered against the architecture audit are recorded as
  explicit V1 limitations in the implementation plan, not smuggled in as new kinds.

## 5. Human decisions

AI-proposed items start `undecided`.

| Action | Decision result | Reviewed? |
|---|---|---|
| **Accept** | `accepted` (proposal unchanged) | immediately |
| **Edit + Save** | `edited`+accepted (effectiveChange = edited values) | immediately — **NO second Accept click** |
| **Reject** | `rejected` (excluded from confirmed delta) | immediately |
| **Add Missing Change + Save** | new item, `origin:"user"`, `accepted` | immediately |

- User-added items may be edited or removed any time before Final Confirm.
- **Final Confirm disabled until:** every AI item is decided AND every remaining
  user-added item passes item validation. (`note` items need no decision.)
- **No default implicit rejection.** An undecided item blocks confirmation forever.
- Every Accept/Edit/Reject/Add persists IMMEDIATELY to the artifact (bumping
  `reviewRevision`). Canon remains untouched until Final Confirm.

## 6. AI proposal vs human decision separation

The original AI proposal is NEVER overwritten by human editing. The artifact and the
receipt always preserve the three-layer distinction:

```
AI PROPOSAL      →  HUMAN DECISION   →  FINAL EFFECTIVE CHANGE
age 22 → 23         edited to 24         age 22 → 24
```

Concretely: `proposal` is immutable; `decision` records what the human did;
`effectiveChange` records what will actually be applied. Receipts retain all three
(§23).

## 7. Explicit vs inferred evidence

AI may claim `claimedLevel: "explicit" | "inferred"` and supply a prose quote.
The claim is NOT trusted.

For an `explicit` claim, Core performs **deterministic verification**: normalized
substring match of the supplied quote against the exact prose bound by
`proseRevision`. No second AI classifier is added for this.

- claim `explicit` + quote verified ⇒ `verifiedLevel = "explicit"`
- claim `explicit` + verification fails ⇒ downgrade to `verifiedLevel = "inferred"`
- claim `inferred` ⇒ `verifiedLevel = "inferred"`

Reject-warning behavior keys off **`verifiedLevel`, never `claimedLevel`**:

- Reject `inferred` ⇒ allow normally (light/no warning).
- Reject verified `explicit` ⇒ strong warning (§27) with actions
  **Cancel / Edit Chapter / Reject Anyway**. `Reject Anyway` is always available —
  AI never overrides human authority (Invariant 15).

Evidence metadata (claim, verification outcome, quote, prose revision) is retained in
the artifact and the receipt for audit.

## 8. Final Confirm: all-or-nothing

Final Confirm is **all-or-nothing**.

Example: 7 valid effective items + 1 invalid item ⇒ APPLY ZERO items, Canon unchanged,
chapter remains `needs-state-review`, structured error returned pointing at the invalid
item (`state_review_invalid_change`, §30).

Rejected items are simply excluded. Accepted + edited + user-added effective changes
form ONE confirmed batch. **No partial Canon confirmation in V1.**

## 9. Prepare then commit

Final Confirm runs in two conceptual phases.

### A. PREPARE — pure / in-memory (inside the correct book lock)

1. load active review artifact
2. re-read current prose; recompute current prose revision
3. re-read current Canon (`readStoryCanon`)
4. validate the loaded artifact is an ACTIVE, confirmable proposal
   (`status === "active"`; a pre-proposal workflow shell, `stale` or
   `rebuild_failed` state ⇒ typed error — §3, §13–§15)
5. validate `reviewRevision` matches caller's (else `state_review_edit_conflict`)
6. validate `proseRevision` matches current (else `state_review_stale`)
7. validate `baseCanonRevision` matches current Canon revision (else `state_review_conflict`)
8. validate `sourceChapter`/`effectiveChapter` assumptions (incl. historical cases, §20)
9. ensure every AI item decided; every user-added item valid (else `state_review_incomplete` / `state_review_invalid_change`)
10. compile decisions into ONE confirmed semantic delta (`RuntimeStateDelta`)
11. apply the EXISTING Core reducer path IN MEMORY (`applyRuntimeStateDelta`)
12. derive technical bookkeeping IN MEMORY (anchoring, projections inputs)
13. validate the complete resulting runtime state (`validateRuntimeState`)
14. build Markdown projections IN MEMORY
15. build required snapshot data IN MEMORY
16. build the RESOLVED RECEIPT IN MEMORY (§23)

During PREPARE: **zero Canon filesystem writes, zero derived `memory.db` mutation.**

### B. AUTHORITATIVE COMMIT — one atomic integrity boundary

Only after PREPARE passes, ONE `commitAtomicFileSet({rootDir: bookDir})` whose single
transaction includes ALL authoritative files:

- resulting Canon JSON (`story/state/*.json`)
- relevant Markdown projections (e.g. `story/current_state.md`)
- required snapshot/state mirror files
- chapter index/lifecycle update → `approved` (READY)
- the resolved receipt file (new, durable)
- closure/removal of the pending review artifact

Exact file list follows the existing Writer persistence + P3A/P3B write-set precedents
and is finalized during implementation. The invariant is:

> A successful review resolution ATOMICALLY guarantees: chapter is READY, the resolved
> receipt is durable, and the active review is permanently unconfirmable. Any Canon
> mutation produced by a NON-EMPTY confirmed delta occurs only inside that SAME
> transaction. A ZERO-EFFECTIVE-CHANGE confirmation (Confirm No Changes; all items
> rejected) is equally valid, uses the identical authoritative transaction, and simply
> carries no Canon story-meaning mutation.

Canon-first-then-repair-metadata is forbidden. Crash at any point yields either the
complete old state or the fully committed new state (acceptance: crash scenario, §32).

### C. Derived memory (post-commit)

After the authoritative commit succeeds: extracted memory-sync functions run exactly as
in P3/P3.1. Failure ⇒ do NOT roll back Canon; invalidate/quarantine the derived DB;
return a warning. `memory.db` is DERIVED state, not Canon (§25).

### Idempotency

At the very start of the locked section, look up a resolved receipt by `reviewId`.
If present: do NOT reapply anything; return the deterministic already-resolved result.
Double click / network retry therefore cannot duplicate hooks/counters/temporal
mutations (§24).

## 10. Reuse the existing state engine

Existing engine (unchanged):

```
Observer → Settler → RuntimeStateDelta → applyRuntimeStateDelta → validation → Canon
```

Phase 4 rewires only the FRONT of it:

```
Observer → Settler → PROPOSED RuntimeStateDelta
  → review proposal (artifact)
  → human decisions
  → CONFIRMED semantic delta (must be expressible as RuntimeStateDelta)
  → applyRuntimeStateDelta (EXISTING) → validateRuntimeState (EXISTING) → Canon
```

Rules:

- No new reducer, no parallel application path, no shadow Canon model.
- Supported, schema-valid review shapes MUST compile — proven by tests. However,
  runtime compilation or semantic validation can still fail on real data (corrupted
  or stale artifacts, future migrations, invalid edited/user-added values). Such a
  failure is FAIL-CLOSED: typed `state_review_invalid_change` (with the originating
  `itemId` where attributable), APPLY ZERO, Canon untouched, review left unresolved
  and still actionable. Never a partial apply; never an unhandled escape that
  half-applies.
- Fact-level items may REUSE P3A's semantic-key conventions (`resolveFactPredicateKey`,
  alias resolution) when COMPILING `currentStatePatch` operations — this is vocabulary
  reuse for building the delta, never a second application path. Application remains
  exclusively `applyRuntimeStateDelta`.
- **Known reducer-coverage gaps from ARCHITECTURE_AUDIT.md are accounted for
  explicitly**: any delta piece the engine cannot apply becomes either a `note` item
  (zero effective change) or is excluded from proposals entirely — recorded as a V1
  limitation. No silently invented operations.

## 11. Locking and race safety

Preserve the P3 ownership pattern exactly:

```
Studio/API mutation route
  → state.acquireBookLock(bookId)
  → Core mutation/review service calls
  → release in finally
```

No second hidden lock layer.

All revision checks happen INSIDE the lock, against freshly read state:

> Wrong: check revisions → acquire lock → commit
> Correct: acquire lock → re-read review/prose/Canon → verify revisions → prepare →
> commit → release

Same abstraction already serializes manual canon commits (P3B) and pipeline writes.

## 12. Review revision (concurrent review editing)

The artifact's `reviewRevision` gives it its own optimistic concurrency, separate from
Canon:

- Browser A holds R7; browser B saves a decision ⇒ artifact at R8.
- A submits with expected R7 ⇒ typed `state_review_edit_conflict`; B's edit is never
  silently overwritten; A reloads.

Studio submits **semantic decisions/operations only** — never a replacement Canon
state, never raw JSON blobs (P3B boundary discipline: shared types come from Core via
type-only imports).

## 13. Canon conflict

Proposal bound to `baseCanonRevision = A`; Canon later legitimately becomes B (manual
edit, another confirmation).

At Final Confirm: `A ≠ current` ⇒ typed `state_review_conflict` ⇒ **APPLY ZERO** ⇒
old proposal permanently unconfirmable ⇒ user regenerates from latest saved prose +
Canon B ⇒ new review starts 0/N reviewed.

No automatic merge/rebase in V1. No "Apply Anyway".

## 14. Prose staleness

Proposal bound to `proseRevision = P1`; saved prose is now P2.

Final Confirm ⇒ typed `state_review_stale` ⇒ **APPLY ZERO**. A proposal generated from
old prose can never become valid again — no path re-binds it to newer prose.

## 15. Editing prose while a review is active

Chapter `needs-state-review`, user edits + saves prose:

1. Save persists new prose (+ new `proseRevision`) durably.
2. In the SAME durable save, the old proposal is replaced by a NON-CONFIRMABLE
   workflow shell with `status = "rebuild_required"` (§3) — it can never confirm.
3. Auto re-audit starts (Observer/Settler over the new prose).
4. A completely NEW review is generated (new `reviewId`, new item ids), 0/N reviewed.
5. Old decisions are NOT carried forward. Ever.

If auto re-audit fails ⇒ §17.

## 16. Editing a READY chapter

Chapter READY with resolved receipt R1; user edits + saves prose.

The prose Save itself must atomically (one transaction):

- save the new prose (+ new prose revision)
- move the chapter to `needs-state-review` (the Phase 4 rebuild path NEVER routes
  through `ready-for-review`)
- mark R1 `superseded`
- create or replace the durable review workflow shell with
  `status = "rebuild_required"` (non-confirmable; §3)

Phase 4 lifecycle from there:

```
READY / approved
  → Edit + Save            ⇒ chapter = needs-state-review, shell = rebuild_required
  → rebuild succeeds       ⇒ chapter STAYS needs-state-review, shell = active
                             (confirmable proposal)
  → rebuild fails          ⇒ chapter STAYS needs-state-review, shell = rebuild_failed
  → Final Confirm succeeds ⇒ approved / READY
```

Only after the durable save may the auto re-audit start; on success the shell becomes
an ACTIVE, confirmable proposal (new generation, 0/N reviewed).

**No automatic rollback of the Canon changes R1 introduced.** R1 remains historical
audit evidence (superseded, optionally linking to its successor once one exists; if
rebuild fails first, it remains superseded with no successor yet).

## 17. Rebuild failure

If auto re-audit / proposal generation fails after a prose Save:

- the NEW prose is kept — never rolled back because AI failed (Invariant 11)
- Canon unchanged
- old proposal remains unconfirmable
- chapter must NOT be READY
- the durable workflow shell transitions to `status = "rebuild_failed"` — every
  intermediate state (prose saved, shell marked, audit pending/failed) is represented
  by durable files, so a crash anywhere leaves recoverable, non-confirmable state (§3)

Studio actions: **Retry Audit** (→ §18) and **Edit Chapter** (normal editing).
Never resurrect the old proposal.

## 18. Retry Audit

Retry Audit runs FROM the durable workflow shell (§3) and always against: latest
saved prose + latest current Canon. The new proposal binds
to the LATEST `proseRevision` and LATEST `baseCanonRevision` — never retried against
the old Canon revision. Success publishes the items and flips the shell to
`status = "active"` as a NEW generation ⇒ 0/N reviewed.

## 19. Zero-change review

AI proposes zero changes ⇒ chapter STILL `needs-state-review`. Studio shows:

> *No state changes proposed.* — [Add Missing Change] [Confirm No Changes]

**Confirm No Changes** travels the SAME Final Confirm integrity path (locks, anchor
checks, prepare, atomic commit): receipt created, chapter READY, active review
permanently closed — with ZERO Canon story-meaning mutation inside that same
transaction. A review whose items are ALL rejected resolves identically.
No auto-READY for zero-change chapters.

## 20. Historical chapter edits

Durable head = Chapter 25; user edits Chapter 16.

NOT done: rewriting/invaliding/re-auditing Chapters 17–25; rewriting snapshots 16–25;
rolling back Canon history.

Done instead:

- new review records `sourceChapter = 16`, `effectiveChapter = 26`
  (= durable progress + 1 computed and REVALIDATED at Final Confirm)
- the correction applies to current/future Canon FROM Chapter 26 onward
- resolved receipt preserves BOTH numbers
- Studio shows the historical-correction banner (§28): existing chapters/history will
  NOT be rewritten
- if durable head advanced between proposal and confirm such that the reviewed
  temporal assumption moved, Final Confirm fails the anchor check (APPLY ZERO) rather
  than silently relocating the change

**Temporal-position rules (normative — no single ambiguous global formula):**

| Case | `sourceChapter` | `effectiveChapter` |
|---|---|---|
| Normal newly-written chapter | = durable head + 1 **at proposal generation** | same value: `sourceChapter === effectiveChapter` |
| Historical edit / correction | the edited chapter: `<` durable head | durable head + 1 **at proposal generation** |

Final Confirm REVALIDATES the temporal assumption against the CURRENT durable head.
If it moved ⇒ APPLY 0 and rebuild; a reviewed change is never silently relocated to a
different temporal position. Receipts preserve both numbers exactly as resolved.

## 21. Historical edits and advancement

Historical edits never cascade into existing READY chapters — but an UNRESOLVED
historical correction blocks the future chapter it affects, and any later chapter
while it stays unresolved:

- head = 25, pending correction with `effectiveChapter = 26`
  ⇒ Chapter 26 generation is BLOCKED until that review resolves.

The gate is `effectiveChapter <= nextChapter` (§22): an unresolved correction whose
temporal effect is AT OR BEFORE the chapter being generated blocks advancement — this
also covers stale pending corrections left behind by head movement. "Ch17–25 stay
READY" is not permission to write Ch26 from Canon the author is actively correcting.

## 22. Generate Next gate (single Core rule)

The gate lives in CORE: `assertCanAdvanceStory(bookDir, nextChapter)` (name indicative).
Consumers — Studio Generate Next, CLI write-next, pipeline/batch/continue paths — all
call the same rule:

Block when:

1. previous chapter is not READY (existing refusal semantics, cf. plan T5.3), OR
2. an unresolved state review has `effectiveChapter <= nextChapter` — a pending
   correction whose temporal effect is at or BEFORE the chapter about to be generated.

No frontend-only enforcement. Acceptance tests must prove CLI/pipeline cannot bypass
Studio governance (§32).

CLI V1 needs NO interactive review UI; it must report the blocking reason and guide the
user toward Studio State Review. Before naming any command: **audit the existing
`/review` / review-mode CLI surface** (a prose *review mode* already exists —
`write-review-mode`); State Review must neither collide with nor be conflated into it.

## 23. Resolved receipts

Successful confirmation produces a durable, read-only receipt, e.g.
`story/runtime/state-review-receipts/chapter-NNNN.<reviewId>.json` (final layout at
implementation). Preserves at minimum:

- `reviewId`, `sourceChapter`, `effectiveChapter`
- `proseRevision`, `baseCanonRevision`, `resultingCanonRevision`
- AI proposals (as generated)
- human decisions (including which items were rejected)
- final effective changes (what actually entered the confirmed delta)
- evidence metadata (claims, verification outcomes, quotes)
- `resolvedAt`, `resolved: true` (later `superseded` per §16)

Receipt is: NOT Canon, NOT Writer context, viewable in Studio. Its HISTORICAL CONTENT
— proposals, human decisions, effective changes, evidence metadata, revision anchors —
is immutable and read-only to users. Exactly ONE system-managed lifecycle transition
is permitted, and it is itself written atomically: `resolved → superseded`, optionally
setting `supersededBy: <new reviewId>` when a successor exists; if rebuild fails
before a new review exists, the receipt remains superseded with no successor yet
(§17). No other field ever mutates after resolution.

## 24. Final Confirm idempotency

Covered in §9: locked receipt-lookup by `reviewId` BEFORE applying; already-resolved ⇒
deterministic prior-result response, nothing reapplied. Essential for
hooks/counters/temporal mutations under double-click/network retry.

## 25. Derived memory / indexes

Post-commit sync only (§9.C). Failure ⇒ Canon/READY/receipt stand; derived DB
invalidated/quarantined where possible; warning returned. Semantics reused from
P3/P3.1. `memory.db` is derived state, never truth.

## 26. Studio UX

Primary V1 interface. Chapter page shows state visibly:

```
Chapter N
Draft ✓   Audit ✓   State Review Required
[ Review State Changes ]
```

Review UI groups story MEANING (never raw JSON):

- Current State
- Hooks / Subplots
- Relationships / Emotional Arcs (where represented)
- Chapter Summary
- User Added Changes

Each item shows: current vs proposed meaning, evidence level (verified), relevant
quote, and Accept / Edit / Reject. Header shows progress ("5 / 8 reviewed");
Confirm disabled until complete. `+ Add Missing Change` always available.

Zero-change review: [Add Missing Change] [Confirm No Changes] (§19).

No raw Canon JSON editor anywhere in this flow.

## 27. Explicit rejection UX

Rejecting a VERIFIED-EXPLICIT item warns:

> “This change appears to be directly supported by the chapter text. Rejecting it may
> cause Canon to disagree with the prose.”

Actions: **Cancel / Edit Chapter / Reject Anyway.** Edit Chapter follows §15/§17
stale-rebuild semantics. Once Reject Anyway is persisted, Final Confirm does NOT repeat
the warning.

## 28. Historical correction UX

Banner on historical-source reviews (wording flexible, semantics mandatory):

> Historical chapter correction — Changes confirmed here will affect Canon from
> Chapter 26 onward. Existing Chapters 17–25 and their prose/history will not be
> rewritten.

## 29. Conceptual Core API boundaries

Indicative names (exact names chosen from repository conventions at implementation):

- `loadStateReview(...)`
- `saveStateReviewDecision(...)`  (bumps `reviewRevision`)
- `addStateReviewItem(...)` / `removeUserStateReviewItem(...)`
- `rebuildStateReview(...)`
- `confirmStateReview(...)`       (prepare + authoritative commit + idempotency)
- `assertCanAdvanceStory(...)`    (the §22 gate)

**Core owns:** schemas; semantic validation; review lifecycle/substates; evidence
verification; proposal compilation; reducer invocation; final validation;
authoritative write-set creation.

**Studio owns:** HTTP validation/mapping; book-lock orchestration per the established
pattern; UI; typed client. Studio must NOT duplicate ReviewItem/Canon contracts
locally — type-only imports from `@actalk/castor-core` exactly as P3B/I-1 established.

## 30. Conceptual Studio API

Capabilities (routes not frozen):

- GET chapter state review
- POST item decision
- POST user-added item
- DELETE user-added item
- POST confirm review
- POST rebuild review

Typed workflow errors (semantics frozen, names checked against repo conventions):

`state_review_not_found` · `state_review_stale` · `state_review_conflict` ·
`state_review_edit_conflict` · `state_review_incomplete` ·
`state_review_invalid_change` · `state_review_rebuild_failed` ·
`state_review_already_resolved` · `state_review_write_locked`

No generic 500s for workflow conditions.

## 31. V1 non-goals

Automatic decision carry-forward · automatic merge/rebase of stale proposals ·
historical Canon rollback · historical snapshot rewrite · cascade rewrite/re-audit of
later chapters · advanced provenance system · visual timeline/graph editor · fact
locking · multi-model reviewer arbitration · token/cost dashboards · collaboration/
cloud sync · full-screen interactive CLI State Review UI · unrelated
SaaS/publishing/TTS/video/cover work.

## 32. Acceptance scenarios (required behaviors)

1. **Happy path:** write → audit → proposed delta → NEEDS_STATE_REVIEW → review all →
   Final Confirm ⇒ Canon + receipt + READY atomically; next chapter allowed.
2. **Zero delta:** 0 proposals ⇒ Confirm No Changes ⇒ receipt + READY, Canon story
   meaning unchanged (still human-gated).
3. **Edited AI proposal:** AI 23 → human edits 24 ⇒ Save counts reviewed ⇒ confirm
   applies 24 ⇒ receipt retains proposal 23 AND human 24.
4. **Explicit reject:** verified-explicit item ⇒ Reject ⇒ strong warning ⇒ Reject
   Anyway ⇒ reviewed/rejected ⇒ excluded from confirm.
5. **Incomplete:** 7/8 reviewed ⇒ Confirm disabled client-side AND Core rejects
   incomplete confirmation.
6. **Canon conflict:** base A → Canon becomes B ⇒ confirm ⇒ APPLY 0 ⇒ rebuild from
   latest prose + B.
7. **Prose stale:** base P1 → prose P2 ⇒ confirm ⇒ APPLY 0.
8. **Edit pending review:** active proposal ⇒ prose edit ⇒ stale ⇒ auto rebuild ⇒ new
   0/N review.
9. **Edit READY chapter:** READY + receipt ⇒ edit/save ⇒ receipt superseded ⇒
   NEEDS_STATE_REVIEW ⇒ rebuild ⇒ NO Canon rollback.
10. **Rebuild failure:** audit/AI fails ⇒ prose survives, Canon unchanged, Retry Audit
    available, chapter not READY.
11. **Historical edit:** head 25 ⇒ edit Ch16 ⇒ Ch17–25 untouched/READY ⇒
    source=16/effective=26 ⇒ pending correction blocks Ch26 (gate
    `effectiveChapter <= nextChapter`: also any later chapter while unresolved) ⇒
    confirm affects future Canon only.
12. **Invalid final batch:** one invalid item among many ⇒ APPLY 0 + structured error
    naming the item.
13. **Crash during confirm:** outcome is either complete old state or fully committed
    Canon+READY+receipt — never half-confirmed (failure injection around the atomic set).
14. **Network retry:** lost response ⇒ retry same reviewId ⇒ no duplicate application.
15. **Derived-memory failure:** confirm succeeded ⇒ memory rebuild fails ⇒
    Canon/READY/receipt valid, derived store invalidated/warned.
16. **CLI bypass:** pending State Review ⇒ CLI/pipeline next-chapter attempt blocked by
    the same Core gate with actionable reason.

## 33. Testing / implementation constraints

TDD is MANDATORY for Phase 4. Before touching implementation: derive tests from the
invariants (§34) and scenarios (§32). RED before GREEN for every new behavior.

Additionally:

- preserve existing P3/P3.1 Canon mutation semantics (they are the fallback editing
  path while a review is NOT active)
- preserve the known Windows EPERM symlink baseline failures in `skill-agent-tool`;
  do NOT fix unrelated baseline failures inside Phase 4
- test filesystem purity of PREPARE and of every failure path (sha256+size+mtime tree
  snapshots, per P3.1 practice)
- test atomicity with failure injection around the final authoritative
  `commitAtomicFileSet` (mid-set throw ⇒ complete old state)
- test `reviewRevision` concurrent-edit conflict
- test `proseRevision` and `baseCanonRevision` races (each anchor independently)
- test idempotent confirmation (double confirm, retry-after-success)
- test historical-correction temporal behavior (source/effective split; the
  `effectiveChapter <= nextChapter` gate, including an OLDER unresolved correction
  still blocking generation)
- test Generate Next gating across Core, Studio route, and CLI/pipeline routes
  (prove non-bypass)
- test derived-memory failure AFTER successful authoritative commit
- suites run strictly sequentially (established machine constraint)

## 34. Required architectural invariants

1. `story/state/*.json` remains the SINGLE Canon store.
2. Review artifacts/receipts are NEVER Writer Canon context.
3. AI cannot mutate Canon without human confirmation.
4. Humans review semantic story meaning, never raw technical bookkeeping.
5. Review decisions persist immediately but never mutate Canon (until Final Confirm).
6. A stale proposal can never become valid again (three independent anchors).
7. Final Confirm is all-or-nothing.
8. A successful review resolution is ONE atomic transition — chapter READY + durable
   receipt + permanently unconfirmable active review; Canon mutations from a non-empty
   confirmed delta happen only inside that same transaction (zero-effective-change
   resolutions are valid and mutate no story meaning).
9. Existing Core reducers remain the ONLY Canon application engine.
10. Studio AND CLI/pipeline are equally subject to the Core advancement gate.
11. Author prose is never rolled back because AI review generation failed.
12. Historical edits do not cascade or rewrite old chapters in V1.
13. Pending historical corrections block the future chapter they affect.
14. Derived-memory failure never invalidates successfully committed Canon.
15. The human remains final authority — even against verified explicit prose evidence.

---

## Appendix A — Reconciliation with IMPLEMENTATION_PLAN sketches (binding deltas)

The plan's T4/T5/T6 sketches remain the working task breakdown EXCEPT where this spec
refines them:

| Plan sketch | This spec |
|---|---|
| T4.1 artifact schema (`decision: pending`, `editedValue`) | Envelope gains `reviewId/proseRevision/baseCanonRevision/reviewRevision/status`, immutable `proposal` vs `effectiveChange`, `origin:"user"`, evidence `claimed/verifiedLevel` |
| T4.3 artifact written during deferred save | unchanged in spirit; artifact now carries the three anchors; prose save on gated chapters also freezes any prior active artifact (§15) |
| T5.2 status enum += `needs-state-review` | unchanged |
| T5.3 generate-next guard | generalized to `assertCanAdvanceStory` covering prev-chapter-not-ready AND pending historical corrections hitting nextChapter (§21–22) |
| T6.1 confirm deletes artifact after apply | replaced: durable RESOLVED RECEIPT + atomic closure of pending artifact; adds prepare-phase purity, all-or-nothing invalid-item handling, idempotency lookup, three-anchor checks, evidence verification, zero-change confirm path |
| T6.1 reject-all resolves the review | SUPERSEDED semantics: "Reject All" (if retained as a UI convenience) ONLY batch-sets every actionable AI proposal item to rejected+reviewed. It does NOT resolve the review, does NOT mutate Canon, and never touches receipts. The author must still run Final Confirm — an all-rejected batch is a valid ZERO-EFFECTIVE-CHANGE resolution: receipt created, chapter READY, Canon story meaning unchanged, identical atomic confirmation path (§8, §19) |

Any further divergence discovered during implementation must be reconciled INTO this
document (or explicitly amended by the human) — never silently.

## Appendix B — Open implementation questions (non-blocking; resolved during TDD planning)

1. Exact prose-revision hashing recipe (raw bytes vs normalized text) — must be stable
   across save/load round-trips.
2. Exact receipt filename/layout and whether receipts are listed via directory scan or
   an index entry.
3. Precise chapter-index write mechanics for the READY transition inside the atomic
   set (index file joins the same `commitAtomicFileSet`).
4. Whether any CURRENT_STATE_SLOT-covered relationship/emotional fields exist today
   beyond free-form facts (bounds kind coverage, §2).
5. Naming audit outcome for Studio routes and the CLI reporting verb, avoiding the
   existing prose `review`-mode vocabulary.
