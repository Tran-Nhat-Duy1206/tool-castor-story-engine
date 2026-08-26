# Phase 5 Design Spec — Foundation + Planning Intelligence

| | |
|---|---|
| Date | 2026-08-27 |
| Status | **AUTHORITATIVE DESIGN — human-approved. Implementation governed by this specification.** |
| Product | Tool Castor Story Engine (CLI: `castor`) |
| Branch | `feature/human-controlled-story-state-v1` (standalone repository `Tran-Nhat-Duy1206/tool-castor-story-engine`) |
| Builds on | Phase 4 Human-Governed Post-Chapter State Review (spec `2026-08-24-human-governed-post-chapter-state-review-design.md`, technically complete at tag `v0.1.0`) · existing Architect / Foundation Reviewer / Planner / ChapterIntent / ChapterMemo / Writer integration · atomic persistence and recovery primitives · local retrieval/index infrastructure · Studio · CLI |
| Supersedes | Earlier Phase 5/6/7 task sketches in `docs/IMPLEMENTATION_PLAN.md` wherever they conflict with this document. The plan retains its role as historical task breakdown; implementation must reconcile it to THIS spec. |
| Out of scope here | Any production code change, any implementation plan, any Phase 5 implementation, any tag creation (`v0.2.0` is NOT created by this documentation task). |

---

## 0. Product principle

Castor's Phase 5 extends the Phase 4 governance principle to the **creative-intelligence
upstream**: story foundation and planning are no longer private LLM context — they become
**governed, versioned, human-authorized artifacts**.

```
AI proposes.
Core governs.
Human authorizes.
Canon records reality.
```

The authority model is layered, not a simple total-order ladder:

```
Authority layers (own truth):
  Canon                 = established reality
  Published Foundation  = long-range authority
  Published Arc Plan    = medium-range authority
  Human Direction + Author Authorization = scoped Human Authority (inputs to execution)

Execution inputs:
  Detailed Chapter Plan = proposal (mutable)
  Execution Snapshot    = frozen execution contract
  Writer                = execution
```

**No lower layer may expand authority not granted by a higher layer.**

Phase 5 uses an **Evolutionary Governance Kernel**. It does **NOT** redesign Castor from
scratch. It reuses/evolves the existing Architect, Foundation Reviewer, Planner,
ChapterIntent, ChapterMemo, Writer integration, Phase 4 Human-Governed Post-Chapter State
Review, atomic persistence/recovery infrastructure, local retrieval/index infrastructure,
Studio, and CLI.

The Governance Kernel **does not write stories**. It governs:

```
authority · readiness · dependencies · conflicts · authorizations ·
versions · transactions · provenance
```

Conceptual responsibilities (NOT mandatory class names — exact physical placement is an
implementation-planning decision):

| Conceptual responsibility | Responsibility |
|---|---|
| Authority Resolver | Decides which authority layer owns a given truth and where conflicts route |
| Readiness Evaluator | Evaluates whether a proposal may proceed to execution/publish |
| Dependency Manager | Records declared dependencies and performs **direct** invalidation |
| Conflict Classifier | Distinguishes deterministic Core conflicts from semantic AI concerns |
| Authorization Resolver | Resolves typed/scoped human creative permissions |
| Version Manager | Owns immutable published version history and restore-as-new-revision |
| Transaction Coordinator | Owns atomic Publish / authority-switch / authorization-settlement transactions |
| Provenance Recorder | Records durable evidence, resolution and version provenance |

---

## 1. System architecture & authority model

### 1.1 Authority ownership

| Artifact | Owns |
|---|---|
| **Canon** (`story/state/*.json`) | Established past/reality. Sole store of settled story truth. |
| **Published Foundation** | Long-range story direction and constraints (theme, conflict, world, ending, protagonist, arcs, rules, hooks, timeline intent). |
| **Published Arc Plan** | Medium-range route (arc goal, Major Beats, movements, timing, authorizations). |
| **Human Direction** | Scoped execution intent **within** higher authority. |
| **Author Authorization** | Typed/scoped creative permission (one-time or reusable, consumed by Canon evidence). |
| **Rolling Lookahead** | Advisory only. Never authority. |
| **Detailed Chapter Plan** | Execution proposal only (mutable until frozen). |
| **Execution Snapshot** | Immutable execution contract for ONE Writer attempt. |
| **AI Proposal** | **No authority by itself.** Gains meaning only through human authorization at the owning layer. |
| **Core** | Enforces boundaries. |
| **Human** | Final creative authority — but changes must route through the authority owner responsible for that type of truth. |

### 1.2 Authority conflict routes

| Conflict | Routes to |
|---|---|
| `EXECUTION_CONFLICT` | Human Direction |
| `ARC_AUTHORITY_CONFLICT` | Arc Revision |
| `FOUNDATION_AUTHORITY_CONFLICT` | Foundation Revision |
| `CANON_CONFLICT` | Canon Correction |

### 1.3 Core invariants (authoritative)

1. **Proposal ≠ Authority.** Nothing AI proposes becomes truth until the owning layer authorizes it.
2. **Approved content is AI-readable but AI-immutable.** Approved/published units are inputs to AI, never silently rewritten by AI.
3. **Canon owns the past.** No revision rewrites established Canon or written chapters.
4. **Publish is the authority boundary for versioned Foundation and Arc Plan authority.** Foundation Revision becomes Foundation authority only through **Human Publish**; Arc Plan Draft becomes Arc authority only through **Human Publish**; Human Direction and Author Authorization become scoped Human Authority only after **explicit Human confirmation**; Canon changes only through the **Phase 4 Canon settlement / Final Confirm workflow**. Invariant 1 (Proposal ≠ Authority) is never weakened.
5. **Published versions are immutable.** Changes produce a new immutable version; the authority pointer never moves backwards.
6. **Dependency invalidation is direct and declared.** A change to A marks only A's **direct** dependents stale immediately; transitive staleness follows only when the intermediate authoritative content actually changes.
7. **Human Authority cannot be silently overridden.** No `--force`-style bypass for Writer authority; no automatic override of human decisions.
8. **Advisory artifacts never grant authority.** Lookahead, scores, and semantic suggestions are never sufficient for execution.
9. **Writer requires a valid immutable Execution Snapshot.** No Writer attempt starts without a frozen snapshot bound to current authority/Canon/context.
10. **Authority publication is transactional.** A crash/failure **BEFORE COMMIT** leaves the old authority authoritative; a crash/failure **AFTER durable COMMIT** leaves the new committed authority authoritative, with incomplete current materializations/indexes/caches rebuilt during recovery. The system never exposes half authority (see §7).

---

## 2. Foundation V2 data model & lifecycle

### 2.1 Representation

- **Markdown creative content authority** — prose/content lives in Markdown.
- **Structured governance manifest** — the manifest owns: unit identity, kind, importance,
  status, dependencies, revision metadata, approval metadata, staleness, provenance.

**Do NOT duplicate creative prose in JSON.** The manifest is governance metadata, not content.

> Implementation must reuse/evolve the existing repository structure; exact physical placement is selected during implementation planning.

### 2.2 Foundation Unit statuses (stable, durable)

```
missing
draft
needs_review
approved
needs_revision
stale
legacy_established
```

**Approved means:** AI readable = yes; AI writable = no.

Transient UI states (generating / revising / saving) are **not** durable truth — they are
derived UI state, never persisted as authority.

Importance is **orthogonal** to status: `required | optional`.

### 2.3 Unit kinds (Core-owned vocabulary)

```
STORY_FRAME
CHARACTER
RELATIONSHIP_INTENT
ARC_DIRECTION
BOOK_RULE
FOUNDATION_HOOK
TIMELINE_ANCHOR
TIMELINE_CONSTRAINT
```

Core owns the valid vocabulary. AI cannot invent new kinds.

**Story Frame** is four independent units:

```
Theme & Tone
Core Conflict
World / Setting
Ending Direction
```

**Character policy:**

- Protagonist is always `required`.
- AI proposes importance for other characters using **typed reasons**; human can override.
- Core owns the reason vocabulary:

```
PROTAGONIST
CO_PROTAGONIST
CORE_CONFLICT_PARTICIPANT
PRIMARY_ANTAGONIST
CENTRAL_RELATIONSHIP
ARC_REQUIRED
SUPPORTING
FUTURE_ONLY
MINOR
```

  AI proposes a classification/reason; Human may override.
- `optional` characters do not block initial Foundation readiness **unless** an
  authoritative downstream Arc/Plan actually depends on the character — then the
  dependency makes that character gating.

**Relationship split (no duplication of Canon):**

| Layer | Owns |
|---|---|
| Foundation | Relationship **Intent** |
| Canon / runtime | Actual current Relationship **State** |
| Arc Plan | Target movement during the current Arc |

Relationship Intent importance tiers (Core-owned): `CENTRAL | ARC_RELEVANT | RUNTIME_ONLY`.
AI proposes a tier; Human may override. Foundation owns Relationship Intent **only** —
actual current Relationship State stays in Canon and is never duplicated into Foundation,
and the Arc Plan owns current-Arc target movement.

**Arc Direction:** Foundation owns macro Arc/Volume destination. Detailed Major Beats and
chapter planning belong to Planning V2 (§4).

**Book Rules:** logical grouping in UI/Markdown may remain, but each rule has stable
identity/governance. Typed rule kinds:

```
POV
LANGUAGE
STYLE
CONTENT_BOUNDARY
WORLD_INVARIANT
CHARACTER_INVARIANT
RELATIONSHIP_CONSTRAINT
STRUCTURE_CONSTRAINT
```

**Foundation Hooks:** major story promises with stable IDs. Two authority levels:

```
FOUNDATION_HOOK   — Foundation-level promise
RUNTIME_HOOK      — arises during writing; becomes authoritative only through
                    Phase 4 Human State Review
```

Core-owned hook lifecycle: `PROPOSED | ACTIVE | ADVANCED | DORMANT | READY_FOR_PAYOFF |
RESOLVED | DEFERRED | ABANDONED`.

- Hook state follows **Canon evidence**, never Planning's own prediction.
- A REQUIRED Foundation Hook cannot be silently `ABANDONED` by AI.
- Runtime hooks become authoritative only through Phase 4 Human State Review.
- Runtime hooks cannot silently escalate into central Foundation direction.
- Payoff windows integrate with Scoped Authorization: where a payoff constitutes an
  author-level decision, it requires the corresponding authorization.

**Timeline split:**

| Layer | Owns |
|---|---|
| Foundation | Timeline Intent / anchors / ordering constraints |
| Arc Planning | Timing windows / milestones |
| Canon | Actual established chronology / current story date |

Timeline constraints: `HARD | SOFT | TARGET`.

### 2.4 Dependencies

- Core owns allowed dependency semantics (what kinds may depend on what).
- AI selects **concrete valid instance links**; it does not invent dependency kinds.
- Human approval covers **both** the unit content and the dependency declaration.
- Invalidation is **DIRECT ONLY**:

```
A changes
→ direct dependent B stale.
C depends on B
→ C does NOT immediately stale.
If B is later revised and its authoritative content actually changes,
then C becomes stale.
```

No recursive cascade at change time.

### 2.5 Revision policy

```
published Foundation
→ Revision Draft
→ edit / AI revise
→ dependency impact
→ Canon conflict classification
→ Human review
→ Publish next immutable version
```

During revision, Planner and Writer **keep reading the previous published Foundation**.
Draft decisions are not authority.

**Published history:** current materialized representation + immutable published versions.

**Restore:** restore-as-new-revision. **Never** move the authority pointer backwards.

**External edits:** if externally modified Markdown no longer matches the approved
revision, detect `EXTERNAL_CHANGE_DETECTED` and offer conceptually:

```
Compare
Adopt into Revision
Discard External Change
```

External content **never inherits approval**.

### 2.6 Legacy books

- Parse existing Foundation into V2-compatible units as **`legacy_established`** — NOT automatically approved.
- Books with existing chapters continue **compatibility mode** (existing workflow keeps working).
- Human may choose **Upgrade Foundation**:

```
legacy content
→ V2 revision
→ AI preflight
→ current Canon check
→ Human review
→ Publish Foundation V2 v1
```

Upgrade does **not** rewrite existing chapters or historical Canon.

---

## 3. Foundation intelligence pipeline

### 3.1 Pipeline

```
Idea / Brief
→ Adaptive Intake
→ Current Story Understanding
→ Idea Readiness
→ Global Foundation Generation
→ mechanical validation
→ Global Foundation Reviewer
→ bounded targeted repair
→ Human Unit Review
→ Publish Gate
→ transactional publication
```

### 3.2 Adaptive Intake

- Extract known information **first**; never ask what was already supplied.
- Ask only **MUST-KNOW** gaps. Typical gap count: **0–3**, adaptive, not rigid.

MUST-KNOW conceptually includes:

```
story mode / genre
protagonist
core premise
central dramatic engine / conflict
target scale
writing language
```

Helpful-but-non-blocking may include:

```
ending preference
antagonist
supporting cast
tone
hooks
additional world detail
```

The Architect may **propose** helpful missing material.

### 3.3 Generation strategy

- **Generate globally once** for coherence; **review globally**; **repair locally**.
- Do NOT repeatedly regenerate the whole Foundation for local issues.
- Mechanical/schema repair retries are separate from semantic repair rounds.
- Semantic auto-repair: **maximum 2 rounds**; stop early on pass.
- Same issue still failing after 2 rounds → `NEEDS_HUMAN_DIRECTION`.

**Reviewer/repair separation:** the Reviewer only diagnoses; the Repair Agent proposes
changes; a **separate** reviewer invocation verifies repairs. The same physical model is
allowed, but not the same call self-certifying its repair.

### 3.4 Finding schema

Structured Foundation finding schema must include conceptually:

```
findingId
unitId
category
severity
repairScope
evidence
suggestedAction
```

Severity: `MINOR | IMPORTANT | BLOCKING`.
Repair scope: `LOCAL | MULTI_UNIT | AUTHOR_DECISION`.

Policy:

| Severity + scope | Handling |
|---|---|
| MINOR + LOCAL | auto-repair allowed |
| IMPORTANT + LOCAL | auto-repair **plus mandatory targeted re-review** |
| MULTI_UNIT | no silent repair |
| AUTHOR_DECISION | Human |
| BLOCKING unresolved | **no Publish** |

Scores remain **informational only**; score thresholds are never authoritative.

### 3.5 Canon conflict model for Foundation revisions

```
FUTURE_SAFE
UNCERTAIN
CANON_CONFLICT
```

**Two-layer classifier:**

- Layer 1 — deterministic Core: a concrete structured contradiction may produce `CANON_CONFLICT`.
- Layer 2 — semantic AI: a semantic concern may produce `UNCERTAIN` only.
- **AI semantic suspicion alone cannot create hard `CANON_CONFLICT`.**
- Every result carries evidence.

**UNCERTAIN resolution:** human chooses `COMPATIBLE` or `REVISE`. `COMPATIBLE` produces a
durable **Human Resolution Record** bound to: revision, unit, finding, evidence, Canon
revision, human resolver. Do not reuse blindly when evidence or Canon changes.

### 3.6 Publish gate

Foundation Publish requires ALL of:

```
all required units ready
no Canon conflicts
required uncertainties resolved
required stale units handled
dependency graph valid
content revisions/hashes valid
no unresolved external changes
```

**Chapter 1 Foundation readiness** requires authoritative:

```
Theme & Tone
Core Conflict
World / Setting
Ending Direction
Protagonist
other REQUIRED major characters
first Arc/Volume Direction
required Book Rules
```

Optional future details do not block initial planning.

---

## 4. Planning V2 data model & lifecycle

### 4.1 Artifacts

| Artifact | Nature |
|---|---|
| **Published Arc Plan** | Authoritative (human Publish boundary) |
| **Major Beats** | Part of Arc authority |
| **Rolling Lookahead** | Advisory |
| **Human Direction** | Scoped Human Authority |
| **Author Authorization** | Typed/scoped Human Authority |
| **Detailed Chapter Plan** | Execution proposal |
| **Execution Snapshot** | Immutable execution contract |

### 4.2 Arc Plan

Immutable published versions; Human Publish boundary. Conceptual metadata:

```
arcId
version
parentVersion
foundationVersion
baseCanonRevision
goal
requiredBeats
optionalBeats
relationshipMovements
hookMovements
timing
authorizations
dependencies
changedBeats
changedAuthorizations
publishedAt
restoredFromVersion?
```

Restore of an old Arc Plan = **new revision** against current Foundation/Canon.

### 4.3 Major Beats

Stable lifecycle:

```
PENDING
IN_PROGRESS
SATISFIED
BLOCKED
SUPERSEDED
```

Importance: `REQUIRED | OPTIONAL`.
Typed Beat categories include:

```
EVENT
FACT_CHANGE
HOOK_STATE
RELATIONSHIP_CHANGE
CHARACTER_CHANGE
GOAL_CHANGE
KNOWLEDGE_CHANGE
PRESSURE_CHANGE
ARC_TURN
```

**Beat state comes from Canon evidence, never from Planning's own prediction.** Use
deterministic evidence where possible; use semantic verification where necessary:

```
SATISFIED
NOT_SATISFIED
UNCERTAIN
```

- Semantic uncertainty mid-Arc normally remains `IN_PROGRESS`.
- Escalate only when required for an authority decision (e.g., closing the Arc).
- AI may **not** silently supersede a REQUIRED Beat when that changes Arc direction.

### 4.4 Rolling Lookahead

Persisted but **non-authoritative**. Lifecycle:

```
CURRENT
STALE
SUPERSEDED
CONSUMED
```

No `APPROVED` state. Default horizon: next **2–3 lightweight chapter intentions**.
Only the next chapter receives a Detailed Chapter Plan.

### 4.5 Human Direction

Durable scoped authority. Scopes conceptually:

```
EXACT_CHAPTER
CHAPTER_WINDOW
ARC
UNTIL_CONDITION
```

Lifecycle:

```
ACTIVE
SATISFIED
UNSATISFIED
EXPIRED
SUPERSEDED
CANCELLED
```

- Human Directions cannot silently violate higher authority.
- Conflict between Human Directions is **explicit** — no latest-wins. Human chooses
  override / replace / keep / edit.

### 4.6 Author Decisions & Authorization

Author Decisions use Core-owned vocabulary including:

```
MAJOR_CHARACTER_DEATH
IDENTITY_REVEAL
RELATIONSHIP_COMMITMENT
RELATIONSHIP_BREAK
MAJOR_GOAL_CHANGE
MAJOR_ALLIANCE_CHANGE
MAJOR_BETRAYAL
MAJOR_SECRET_REVEAL
MAJOR_HOOK_RESOLUTION
ANTAGONIST_ROLE_CHANGE
WORLD_RULE_EXCEPTION
MAJOR_TIMELINE_JUMP
ARC_DIRECTION_CHANGE
ENDING_DIRECTION_CHANGE
```

Authorization supports scoped permission such as:

```
EXACT_CHAPTER
CHAPTER_WINDOW
ARC
CONDITION
FROM_ARC
```

`CONDITION` uses **Core-owned typed condition kinds** such as:

```
after_hook_advanced
after_hook_resolved
after_arc_started
after_arc_climax
after_chapter
after_relationship_state
after_fact_exists
```

Core owns condition semantics. AI may bind concrete subjects/instances but may not invent
arbitrary condition kinds.

Consumption semantics (unchanged):

```
ONE_TIME
REUSABLE
```

**Authorization is consumed ONLY when Canon confirms the event.** Planning intent or failed
Writer attempts do **not** consume it.

### 4.7 Detailed Chapter Plan

Evolves/reuses existing Castor **ChapterIntent + ChapterMemo** rather than replacing the
existing planning subsystem wholesale. The Detailed Plan binds:

```
Foundation version
Arc Plan version
Canon revision
Human Directions
Authorizations
dependencies
rules
chapter goal
scenes/movements
hooks
relationships
timing
mustKeep
mustAvoid
```

- **Before Writer:** a mutable proposal.
- **After Execution Snapshot:** the plan used by that attempt is immutable.

### 4.8 Execution Attempt defects

```
PROSE_DEFECT
PLAN_DEFECT
AUTHORITY_DEFECT
CANON_CONFLICT
```

| Defect | Handling |
|---|---|
| PROSE_DEFECT | Revise under the **same** snapshot (Phase 6 domain) |
| PLAN_DEFECT | Abort attempt; create a fresh plan/snapshot |
| AUTHORITY_DEFECT | Route through the Authority Resolver |
| CANON_CONFLICT | **Hard stop** |

Maximum **2 automatic semantic replans** per chapter (separate from Phase 6 prose retry
policy).

### 4.9 Arc completion

Evidence-based. Outcomes:

```
NOT_READY
READY_TO_CLOSE
ARC_COMPLETION_UNCERTAIN
```

- If current Arc is ready **and** next Arc Plan is already Published → close/activate automatically.
- If next Arc Plan is missing → prepare/publish it **before** transition.

---

## 5. Planning intelligence & risk-based gate

### 5.1 Arc flow

```
Published Foundation
→ Arc Planner
→ Arc Plan Draft
→ deterministic checks
→ semantic reviewer
→ bounded local repair
→ Human Publish
→ Published Arc Plan
```

Even a `PREFLIGHT_PASS` Arc Plan remains **Draft until Human Publish**.

### 5.2 Detailed chapter flow

```
latest Canon
+ Published Foundation
+ Published Arc Plan
+ valid Lookahead
+ Human Directions
+ Authorizations
+ dependencies
+ Book Rules
→ fresh Detailed Chapter Plan
```

Every next chapter's Detailed Plan is **regenerated fresh after the latest Canon**.
Lookahead may guide it but is never reused as a full plan.

### 5.3 Planning Gate — Layer 1 (deterministic Core)

Checks include:

```
current Foundation / Arc / Canon versions
stale dependencies
required units
hard Canon contradictions
Book Rules
hard Timeline constraints
Human Direction conflicts
Authorization validity / consumption
chapter sequence
unresolved state review (Phase 4)
```

Hard deterministic violation → `CONFLICT` with concrete evidence.

### 5.4 Planning Gate — Layer 2 (semantic reviewer)

Checks:

```
motivation
relationship progression
reveal timing
hook payoff readiness
scene causality
Arc progression
pacing
author-level decisions
```

AI semantic outcomes:

```
SAFE
UNCERTAIN
AUTHOR_DECISION
```

- **AI semantic suspicion cannot independently create hard `CONFLICT`.**
- **SAFE** = within existing authority, no significant semantic risk requiring Human.
  SAFE does **not** mean quality perfection, and SAFE does **not** auto-run Writer —
  the human still deliberately presses Write Chapter.
- **UNCERTAIN** requires Human resolution only when the ambiguity materially affects
  execution/authority.
- **AUTHOR_DECISION** requires authorization or the correct authority revision.
- Already-authorized decisions at correct scope: **do not ask Human again.**

### 5.5 Bounded repair

Shared finding schema (same as §3.4). LOCAL issues may be repaired up to **2 semantic
rounds**, with separate verification. No local repair may broaden authority.

Plan scope may produce `PLAN_SCOPE_TOO_BROAD` rather than silently dropping required
context.

---

## 6. Context composer & token governance

### 6.1 Architecture

```
Authority Spine
+ Declared Dependency Retrieval
+ Recent Continuity
+ Semantic Supplement
```

Principle: **authority before relevance.**

Profiles (at minimum): `PLANNER_CONTEXT | WRITER_CONTEXT | REVIEWER_CONTEXT`.

Priority hierarchy:

```
P0 — Mandatory Authority
P1 — Declared Dependencies
P2 — Recent Continuity
P3 — Semantic Story Memory
P4 — Stylistic History
```

**P0 cannot be silently dropped or semantically summarized simply to fit.**

### 6.2 Context budget policy

```
1. deterministic typed projection / compaction
2. trim soft context
3. semantic compression only for non-authoritative / advisory material
4. narrow / replan if plan scope is too broad
5. CONTEXT_BUDGET_EXCEEDED if mandatory context still cannot fit
```

- **Do not call the LLM after a hard context-budget failure.**
- **No automatic model switch to escape budget.** If the configured model cannot safely
  fit mandatory context, Context Composer must not silently switch providers/models — it
  uses the normal configured provider/model routing policy. If mandatory context still
  cannot fit after safe compaction → `CONTEXT_BUDGET_EXCEEDED`.
- Reserve model output tokens **BEFORE** calculating available input budget.
- Budget considers: model context limit, reserved output, system/tool overhead, safety
  margin, tokenization/counting strategy. Do not assume every provider/model shares limits.

### 6.3 Projection vs summary

- Structured projection must be distinguished from semantic summary.
- Hard authority prefers **deterministic projection**.
- Semantic compression is allowed for: old chapter summaries, soft history, advisory
  Lookahead, stylistic examples, semantic memories.
- Do **NOT** semantic-compress away the exact semantics of:

```
hard Canon facts
hard Book Rules
Human Directions
Authorization scopes
Foundation invariants
Execution Snapshot contract
```

### 6.4 ContextBundle provenance

Includes conceptually:

```
bundleId
profile
task
Foundation version
Arc Plan version
Canon revision
sections
source provenance
dependency refs
semantic retrieval refs
budget
token estimates
compactions
omittedDueToBudget
```

### 6.5 Retrieval truth & staleness

- Production retrieval must **exclude rejected / non-canonical Writer attempts** from
  Canon/story-memory truth.
- Search index/cache is derived/rebuildable — **never authority**.
- Draft Foundation/Arc revisions must **not leak** into normal Planner/Writer production
  retrieval while older Published authority remains active.
- ContextBundle becomes **stale** if bound authority/Canon/dependencies change before
  Execution Snapshot creation.

### 6.6 Token / call observability (instrumentation only)

Each production LLM call retains usage/provenance metadata where available, conceptually:

```
task
contextProfile
contextBundleId
model
provider
estimatedInputTokens
actualInputTokens   (when provider reports it)
outputTokens        (when provider reports it)
```

This is instrumentation only. Phase 5 does **not** expand into a cost-dashboard project.

---

## 7. Persistence, transactions, recovery & compatibility

### 7.1 Persistence layers

```
AUTHORITATIVE            — committed truth
WORKING                  — drafts / revisions (never authority)
DERIVED / REBUILDABLE    — indexes, caches, materializations
```

Published Foundation and Arc Plan: **current materialized + immutable published history**.
No delta replay required for normal reads.

### 7.2 Transaction Coordinator semantics (reused/evolved)

```
PREPARE
VALIDATE
STAGE
JOURNAL
COMMIT
MATERIALIZE CURRENT
FINALIZE
```

- AI generation/review happens **before** the Publish transaction.
- The Publish transaction is **deterministic and short**.
- Immediately before commit, revalidate: base authority current, Canon compatibility,
  content hashes, Human resolutions, required readiness, dependency graph.
- If base changed → `REVISION_BASE_STALE`.
- Journal must be sufficient for deterministic crash recovery.

Crash semantics:

```
before COMMIT  → old authority remains truth
after COMMIT   → new committed authority remains truth; rebuild incomplete
                 materialization/caches
```

**Authority switch + direct dependency invalidation are ONE logical transaction.** Never
leave: new Foundation authority + known dependent future plan falsely CURRENT.

### 7.3 Execution freeze & settlement

- Foundation/Arc revisions do **not** rewrite written chapters or Canon.
- Execution Snapshot creation is **atomic**. If authority/Canon/context changed during
  freeze → `EXECUTION_PREPARE_FAILED`; Writer must not start.
- Execution attempts preserve immutable snapshot provenance.
- Provider failures preserve failure records and do **not** consume authorizations.
- **Authorization consumption occurs with Canon settlement.** Canon commit + one-time
  authorization consumption are logically atomic.
- Beat semantic evaluation may run **after** Canon commit; Canon correctness never depends
  on semantic Beat reviewer success.

### 7.4 Recovery truth priority

```
committed authoritative history
→ authoritative current manifests / materialization
→ transaction journals
→ working drafts
→ derived caches / indexes
```

Detect immutable-history corruption explicitly; never silently adopt corrupted authority.
Reuse/evolve existing Castor atomic-write/recovery/snapshot primitives after repository
audit — do **not** build a parallel persistence stack. Implementation must reuse/evolve
the existing repository structure; exact physical placement is selected during
implementation planning.

### 7.5 Legacy compatibility

Keep existing: `inkos.json`, `INKOS_*` env vars, `.inkos/` paths, existing book layouts,
existing package compatibility contracts — unless a real migration requires otherwise.

Books need explicit governance capability/version markers conceptually:
`Foundation: legacy | v2` and `Planning: legacy | v2`. **Do not infer governance mode
from file existence alone.**

- Old books may continue the legacy workflow.
- Upgrade to V2 is **opt-in**.
- Once V2 Foundation authority is Published, do **not** run legacy Foundation as
  simultaneous competing authority.
- Historical ChapterIntent/ChapterMemo remain truthful historical artifacts; do not
  rewrite their provenance as if V2 existed in the past.

Schema migrations: forward-only, idempotent, recoverable, testable.

Authority-changing operations require **book-scoped coordination/locking** — no
last-write-wins for concurrent Studio/CLI authority changes.

Human Directions and Human Resolutions are **durable governance state**, not merely chat
history.

---

## 8. Studio + CLI human governance UX

Studio and CLI share the **same Core Governance Kernel**. Studio = rich Human governance
UX; CLI = safe operational surface. **No duplicated readiness/authority logic.**

Core provides structured readiness with:

```
blockingReasons
warnings
nextRecommendedAction
```

### 8.1 Studio workspace

Main long-form conceptual workspace (do not unnecessarily redesign unrelated navigation):

```
Overview
Foundation
Planning
Chapters
Story State / Canon
History / Governance
```

### 8.2 Foundation UX

- Unit-level review; clear statuses; required/optional visibility; dependencies; findings;
  diffs; revision workspace; history; **Publish boundary**.
- Approved units default **read-only**. Human must explicitly **Open Revision** before
  modification/AI revision.
- Revision UI clearly shows: current Published authority, current Revision Draft, which
  version production currently uses.
- **Diff-first review** for later revisions.
- Batch approval allowed **only** for safe clean units.

### 8.3 Arc Planning UX

- Published Arc Plan, Major Beat progress, advisory Rolling Lookahead, next Detailed Plan.
- Arc Plan Publish is **explicit**.
- Lookahead has **no Approve button**.
- Human Direction natural language is parsed into structured scope, shown to Human, and
  becomes authority **only after confirmation**.
- Conflicting Human Directions require explicit resolution.

### 8.4 Detailed Plan states

- **SAFE:** no separate approval required. Human may: View Plan, Add Direction,
  Regenerate, Write Chapter.
- **UNCERTAIN / AUTHOR_DECISION:** explain the exact issue, evidence, existing authority,
  and valid next actions.
- **CONFLICT:** hard block. **No "Write Anyway" authority bypass.**

### 8.5 Write Chapter action

```
revalidate
→ compose context
→ budget check
→ freeze Execution Snapshot
→ Writer
```

One deliberate Write action produces **at most ONE chapter**.

Phase 4 remains:

```
Draft
→ Audit / Revision
→ Human State Review
→ Final Confirm
→ Canon
```

After Canon settlement, the following occur automatically **where deterministic**:
authorization consumption, dependency impact, Beat evidence, Lookahead revalidation,
Arc readiness, next-planning readiness.

Healthy daily flow stays:

```
Plan → SAFE → Write → Review → Final Confirm → Next
```

Governance complexity surfaces only when genuinely needed.

### 8.6 CLI safety

CLI must **never** provide production bypass flags such as `--force`, `--ignore-canon`,
`--skip-authority` for Writer authority. Existing `castor write next` may remain but must
respect the same governance gates.

---

## 9. Testing strategy & acceptance criteria

### 9.1 Testing layers

```
Domain invariants
Component contracts
Transaction / failure tests
Workflow integration
End-to-end story scenarios
```

All Core invariants (§1.3) are directly tested.

### 9.2 Foundation coverage

```
unit lifecycle
importance / readiness
direct dependency invalidation
Reviewer finding schema
repair write-scope enforcement
Canon conflict classification
Human Resolution binding
Publish
stale-base rejection
external edit adoption
legacy upgrade
```

### 9.3 Planning coverage

```
Arc Publish boundary
immutable versions
Major Beat Canon evidence
Lookahead non-authority
Human Direction persistence / conflict
Scoped Authorization
Planning Gate truth table
automatic repair limits
Detailed Plan immutability after snapshot
selective revalidation
Arc completion
```

### 9.4 Planning Gate truth contract

| Deterministic | Semantic | Authority | Result |
|---|---|---|---|
| clean | clean | sufficient | `SAFE` |
| clean | uncertain | — | `UNCERTAIN` |
| clean | new major decision | missing | `AUTHOR_DECISION` |
| hard violation | — | — | `CONFLICT` |
| — | — | already authorized, correct scope | `SAFE` |

### 9.5 Context tests

```
priority trimming
P0 preservation
reserved output
stale bundle detection
false-memory exclusion
no LLM call after CONTEXT_BUDGET_EXCEEDED
```

### 9.6 Fault-injection tests

Injection points:

```
before staging
after staging
before COMMIT
immediately after COMMIT
during current materialization
during dependency invalidation materialization
during journal finalization
Execution Prepare race
```

Invariant after any authority transaction failure: the system exposes **either the old
authority or the fully committed new authority** — never half authority.

### 9.7 Compatibility & parity

- Legacy regression fixtures cover existing `inkos.json`, `.inkos`, Foundation files,
  ChapterIntent, ChapterMemo, chapters, Canon/state.
- Legacy → V2 upgrade must **not** change chapter prose hashes or historical Canon.
- Studio/Core/CLI parity is tested; CLI cannot bypass gates.

### 9.8 E2E scenarios

```
A. New story from natural brief through Chapter 1 Canon and Chapter 2 planning.
B. Healthy SAFE chapter with minimal Human friction.
C. Missing-authority author decision.
D. Mid-book Foundation revision causing future Planning invalidation but no historical rewrite.
E. PLAN_DEFECT causing aborted attempt + fresh replan/snapshot.
F. Evidence-driven Arc completion and transition.
```

LLM tests use mocks/fixtures, not real external API calls.

### 9.9 Regression & environment discipline

Preserve existing Core/Studio/CLI/provider/Phase 4 regression suites. Known pre-existing
environment-specific failures remain separately classified; new regressions are never
disguised as environmental.

### 9.10 Security / path safety

AI-generated IDs can never become arbitrary filesystem paths. Authoritative writes use
validated Core mappings.

---

## Phase 5 scope boundary

**Phase 5 includes:**

```
Foundation Intelligence
Planning Intelligence
the Governance Kernel required to safely connect them
Context Composer foundation
transaction / recovery integration
Studio / CLI governance integration
Writer Execution Snapshot gate
```

**Phase 5 explicitly does NOT include deep Phase 6 autonomous prose quality work:**

- no deep prose repair loops
- no advanced prose critic specialization
- no multi-pass autonomous chapter polishing
- no automatic multi-chapter writing

Phase 6 remains **autonomous work INSIDE ONE CHAPTER only**. Never automatically write
5–20 chapters. One chapter per deliberate run.

**Phase 5 also does NOT implement Phase 7 Story Intelligence:**

- advanced long-term continuity intelligence
- character stagnation analytics
- relationship drift analytics
- mystery/clue optimization
- foreshadow/payoff scoring
- global pacing intelligence
- theme drift / repetition intelligence

Phase 5 provides only the architecture/data needed for those future features.

---

## Phase 5 definition of done

Phase 5 may only be declared COMPLETE if:

- the approved design/spec is implemented,
- required Phase 5 acceptance scenarios pass,
- no new Critical findings remain,
- no unresolved Important findings remain,
- no unexplained product regressions remain,
- legacy compatibility is verified,
- transaction/recovery fault tests pass,
- Studio and CLI share the same Core governance logic,
- Phase 4 Canon settlement semantics remain intact.

If implementation later reaches technical completion but genuine independent review
infrastructure is unavailable, the honest status is:

```
PHASE 5 — TECHNICALLY COMPLETE /
FORMAL INDEPENDENT SIGN-OFF PENDING
```

Independent review is never claimed when review was only performed in-process.

After successful full Phase 5 completion, the intended milestone tag is **`v0.2.0`** —
NOT created by this documentation task.
