# InkOS Evolution — V1 Specification

**Status:** FINAL v1.0
**Project:** InkOS Evolution Fork
**Default Story Language:** Vietnamese (`vi`)
**Supported Story Languages:** Vietnamese (`vi`) and English (`en`)
**Purpose:** Define the first implementation milestone for transforming InkOS into a highly automated but human-controllable long-form story system.

> This document defines WHAT V1 must achieve.
> It is NOT an implementation plan.

---

# 1. Product Goal

V1 must preserve the strongest part of InkOS:

> **High automation from idea to long-form story.**

The desired workflow remains:

```text
Idea
 ↓
Story Foundation
 ↓
Planning
 ↓
Generate Chapter
 ↓
Audit
 ↓
Extract Story-State Changes
 ↓
Human Review
 ↓
Commit Canon
 ↓
Generate Next Chapter
```

The fundamental improvement is:

> InkOS must no longer behave like a black box whose story knowledge the author cannot inspect or correct.

The AI performs most of the work.

The human remains the final authority over the story.

---

# 2. Core V1 Principle

## AI automates. Human owns Canon.

InkOS may:

* generate facts;
* infer relationships;
* update character state;
* discover timeline events;
* create hooks;
* advance plot threads;
* plan chapters;
* write prose;
* audit continuity.

But the user must be able to:

* inspect those results;
* approve them;
* reject them;
* correct them;
* manually add missing information;
* manually change current story state.

User-confirmed Canon has higher authority than AI assumptions.

---

# 3. Do Not Rebuild InkOS

This project is a progressive evolution of the existing InkOS repository.

We are NOT:

```text
Deleting InkOS
      ↓
Building another story engine
```

We are doing:

```text
Existing InkOS
      ↓
Understand
      ↓
Expose
      ↓
Make Editable
      ↓
Add Human Governance
      ↓
Improve
```

Existing working subsystems must be reused whenever practical.

---

# 4. Existing Canon Architecture

The repository audit confirmed that InkOS already uses structured canonical state under:

```text
story/state/*.json
```

V1 must build on this architecture.

Do NOT introduce an independent Canon database simply for Studio.

The conceptual architecture remains:

```text
                 story/state/*.json
                  CANONICAL STATE
                         │
             ┌───────────┴───────────┐
             ↓                       ↓
       InkOS Automation            Studio
             ↓                       ↓
       Write / Audit           Inspect / Edit
             │                       │
             └───────────┬───────────┘
                         ↓
                  SAME CANON
```

There must not be:

```text
Core Canon
+
Studio Canon
+
Markdown Canon
```

with competing mutable truths.

---

# 5. State Projections

The audit confirmed that InkOS contains projection logic such as:

```text
state-projections.ts
```

which renders human-readable views from structured state.

Canonical direction:

```text
Structured Canon
      ↓
Projection
      ↓
Human-readable view
```

Projection files are not to become an independent Canon source.

Manual edits should target structured Canon through proper Core/server APIs.

---

# 6. Preserve Existing Persistence Safety

InkOS already contains:

```text
commitAtomicFileSet
```

and per-chapter state snapshots.

V1 must preserve these mechanisms.

Studio must NOT implement unsafe arbitrary writes such as:

```text
fs.writeFile(...)
```

directly against Canon files without using the proper persistence path.

A failed write must leave the previous valid state intact.

---

# 7. Story State Visibility

Studio must gain visibility into the structured story state InkOS actually uses.

A future structure may look conceptually like:

```text
Story State

├── Characters / Character State
├── Current Facts
├── Relationships
├── Timeline State
├── Plot / Subplot State
├── Hooks / Open Threads
├── Chapter State
├── Planning State
└── Other Canonical State
```

The exact categories must follow the real InkOS schemas.

Do not invent duplicate structures solely because they exist in `PROJECT_VISION.md`.

---

# 8. All Author-Relevant Story State Must Be Editable

The user has decided:

> If a piece of story state is wrong or does not follow the intended story direction, the author must be able to correct it.

Therefore V1 should not permanently prohibit editing an author-relevant Canon category merely because InkOS generated it.

Examples include:

* character facts;
* character current state;
* age;
* goals;
* motivations;
* relationships;
* current locations;
* knowledge;
* important objects;
* timeline facts;
* subplot state;
* hooks;
* important story facts;
* planning information;
* story progress;
* other author-facing Canon.

However, **technical bookkeeping is different from story meaning**.

Internal data such as:

* hashes;
* snapshot identifiers;
* derived indexes;
* recovery markers;
* internal fingerprints;
* implementation metadata;

should not normally be edited directly by the author.

The user edits the **story meaning**.

InkOS updates the necessary technical representation.

---

# 9. Manual Story-State Editor

The user must always be able to open Studio and manually correct current Canon.

Example:

```text
Character: Elara

Age:
22

Current Location:
Blackwood Manor

Knowledge:
Knows about the hidden passage

Relationship with Adrian:
Cautious trust
```

If something is wrong:

```text
22 → 23
```

the user saves it.

Future generation must use `23`.

The user should not need to ask an LLM:

> "Please remember that Elara is 23 now."

---

# 10. Canon Is Time-Aware

A manual correction to current state does NOT automatically rewrite history.

Example:

```text
Chapter 1–15:
Elara.age = 22

One-year time skip

Chapter 16+:
Elara.age = 23
```

If InkOS incorrectly keeps:

```text
Elara.age = 22
```

after the time skip, the user may correct the current state:

```text
22 → 23
```

This means:

> Elara is 23 from the current story position forward.

It does NOT mean:

> Rewrite Chapters 1–15 to say she was 23.

Existing fact history and chapter snapshots should be reused wherever possible to represent past state.

---

# 11. Manual Editing Does Not Automatically Rewrite Old Chapters

This is an explicit V1 rule.

When the user changes current Canon:

```text
Elara.age = 22
        ↓
Elara.age = 23
```

InkOS does NOT automatically rewrite previous prose.

Old chapters remain historical story artifacts.

Future chapters use the new current Canon.

If necessary, later versions may provide historical conflict tools, but automatic historical rewriting is not part of V1.

---

# 12. Automatic Chapter Generation Remains the Default

V1 must not turn InkOS into a manual scene-by-scene writing application.

The main user action remains conceptually:

```text
Generate Next Chapter
```

InkOS may internally perform:

```text
Plan
 ↓
Scene planning
 ↓
Write
 ↓
Compile
 ↓
Audit
```

without requiring user interaction during every step.

Human intervention happens primarily **after the chapter pipeline finishes**.

---

# 13. Mandatory Post-Chapter State Review

This is a core V1 feature.

After InkOS finishes generating and auditing a chapter, it must identify important story-state changes.

Example:

```text
Chapter 12 completed

PROPOSED STORY STATE CHANGES

Character:
+ Elara now knows about the hidden passage

Relationship:
Elara → Adrian
Distrust → Cautious trust

Timeline:
+ 17 October 1887

Character State:
+ Adrian injured his left hand

Plot:
+ Burned medical record discovered
```

The user receives controls such as:

```text
Accept
Edit
Reject
```

The user may also manually add a state change that InkOS failed to detect.

---

# 14. State Review Is a Chapter Gate

The user has decided that state review should be mandatory before continuing the automatic story pipeline.

Chapter lifecycle should conceptually include:

```text
PLANNING
   ↓
WRITING
   ↓
DRAFTED
   ↓
AUDITING
   ↓
NEEDS_STATE_REVIEW
   ↓
READY
```

When:

```text
Chapter 12 = NEEDS_STATE_REVIEW
```

the normal:

```text
Generate Next Chapter
```

workflow should not continue to Chapter 13.

After state review:

```text
Chapter 12 = READY
```

Chapter 13 may be generated.

This prevents the next chapter from building on unreviewed or incorrect state.

---

# 15. User Can Add Missing State Changes

The AI extractor is not assumed to be perfect.

During post-chapter review, the user may notice:

> InkOS forgot that Elara learned a particular secret.

The user must be able to add that information manually before confirming the chapter state.

Therefore post-chapter review supports:

```text
Accept AI change
Edit AI change
Reject AI change
Add missing change manually
```

---

# 16. Explicit Story Event vs AI Inference

State review should distinguish, where possible, between:

```text
EXPLICIT STORY EVENT
```

and:

```text
AI INFERENCE
```

Example explicit event:

> Adrian broke his left arm.

Proposed state:

```text
Adrian.injury = broken left arm
```

If the user rejects this despite the prose explicitly stating it, Studio should warn:

```text
This information appears explicitly in Chapter 12.

Rejecting this state update may create a Canon conflict.

[Reject Anyway]
[Edit Chapter]
[Cancel]
```

The human still has final authority.

---

# 17. Inferred State Can Be Rejected Normally

Example:

```text
AI inference:
Elara trusts Adrian more after this conversation.
```

This may be subjective.

The user may simply reject or edit it.

Not every AI inference is Canon.

---

# 18. Human Review Commits Canon

The desired state flow is:

```text
Chapter prose
     ↓
State extraction
     ↓
Proposed changes
     ↓
Human review
     ↓
Accepted / edited changes
     ↓
Canonical State Commit
```

Rejected changes do not enter current Canon.

---

# 19. Write Next Must Respect Confirmed State

This is one of the most important acceptance criteria.

Given:

```text
Current Canon:
Elara.age = 22
```

After a one-year time skip, the user changes:

```text
22 → 23
```

and confirms the state.

The next chapter generation must receive:

```text
Elara.age = 23
```

If Studio displays 23 but the Writer receives stale 22, V1 has failed.

---

# 20. State Rebuild Must Not Silently Undo User Decisions

The DSH audit identified code paths where state may be:

* rebuilt;
* reduced;
* reconstructed;
* projected;
* recovered from chapter snapshots.

Implementation must trace these overwrite paths carefully.

A confirmed user correction must not disappear because InkOS later reads a stale projection or older derived state.

---

# 21. Preserve Fact History

V1 should reuse InkOS existing:

* fact history;
* structured runtime state;
* chapter snapshots;
* reconstruction mechanisms;

rather than creating another history database unless absolutely necessary.

Conceptually:

```text
CURRENT STATE

Elara.age = 23
```

may coexist with historical evidence:

```text
Ch1:
Elara.age = 22

Ch16:
Elara.age = 23
```

---

# 22. Vietnamese + English Only

The target product supports only:

```text
Vietnamese — vi
English    — en
```

Chinese is being removed from the product.

This is no longer a long-term optional direction.

It is an explicit migration requirement.

---

# 23. Default Language

Default story language:

```text
vi
```

New story creation should default to:

```text
Vietnamese
```

English remains available as the second language.

---

# 24. New Project Language Options

New projects should expose only:

```text
Vietnamese
English
```

Chinese must not remain a normal new-project option.

---

# 25. Chinese Projects Must Be Migrated

Chinese is not retained indefinitely as a legacy story language.

When an existing Chinese InkOS project is encountered, the migration target is:

```text
Chinese Project
      ↓
Choose Target
      ↓
Vietnamese
or
English
```

The converted project then becomes a normal:

```text
vi
```

or:

```text
en
```

project.

---

# 26. Chinese Story Content Is Translated

Migration should convert Chinese author/story-facing content into the chosen target language.

This includes relevant content such as:

* chapter prose;
* story foundation;
* outline;
* planning material;
* summaries;
* character descriptions;
* location descriptions;
* story facts;
* relationships;
* hooks;
* subplots;
* human-readable state content;
* human-facing projected content;
* review/audit textual artifacts where required.

The migration goal is not merely:

```text
language = zh
```

becoming:

```text
language = vi
```

while leaving the entire novel Chinese.

The story itself is migrated.

---

# 27. Do Not Translate Stable Internal Identifiers

Chinese migration must distinguish story content from implementation identifiers.

Do NOT blindly translate:

```text
character_001
subplot_014
chapter_008
```

Do NOT translate schema keys simply because they are English.

Do NOT mutate stable internal enum values merely for localization.

Preserve where applicable:

* stable IDs;
* schema keys;
* internal enums;
* hashes;
* snapshot IDs;
* references;
* machine-facing identifiers.

Translate human/story-facing text.

---

# 28. Remove Chinese Product Behavior

Chinese-specific product behavior should progressively be classified into:

```text
REPLACE WITH VIETNAMESE
MAKE LANGUAGE-NEUTRAL
REMOVE
```

There is no final three-language target.

Final architecture:

```text
             InkOS Core
                 │
          Language Layer
                 │
       ┌─────────┴─────────┐
       ↓                   ↓
 Vietnamese             English
```

not:

```text
Chinese
Vietnamese
English
```

---

# 29. Do Not Blindly Search/Replace `zh` → `vi`

The audit confirmed Chinese assumptions exist in areas such as:

* language schemas;
* defaults;
* prompts;
* character counting;
* word counting;
* slugifiers;
* state projections;
* language inference;
* index rebuilds;
* tests.

Migration must handle these according to semantics.

---

# 30. Vietnamese Must Be Native Generation

Vietnamese projects should generate Vietnamese directly.

Expected:

```text
Vietnamese Idea
      ↓
Vietnamese Foundation
      ↓
Vietnamese Planning
      ↓
Vietnamese Writing
      ↓
Vietnamese Audit
      ↓
Vietnamese Story State
```

Not:

```text
Chinese / English
      ↓
Translate
      ↓
Vietnamese
```

Translation is only for migration of old Chinese content.

---

# 31. English Remains Native

English projects continue through the English pipeline.

Vietnamese instructions must not leak into English generation.

---

# 32. Language-Aware Length Measurement

Vietnamese and English should use word-oriented length semantics.

Conceptually:

```text
Vietnamese → words
English    → words
```

Existing Chinese character-count assumptions must not carry into Vietnamese projects.

The implementation should reuse/generalize:

```text
LengthCountingModeSchema
```

where appropriate.

---

# 33. Language Inference

Explicit project language takes priority.

Prefer:

```text
project.language = vi
```

over guessing from text.

`inferLanguage` must not silently classify Vietnamese projects as Chinese because of CJK-era defaults.

---

# 34. Vietnamese Slugs

Existing CJK-oriented slug behavior must be generalized.

Example:

```text
Người Vợ Trong Bức Chân Dung
```

must generate a stable filesystem-safe project identifier.

Vietnamese diacritics must be handled predictably.

The exact slug format belongs in the implementation plan.

---

# 35. Studio Interface Language

V1 does not require translating the entire application interface into Vietnamese.

Studio UI may remain English.

This specification concerns:

```text
Story Language
```

not necessarily:

```text
Application UI Language
```

UI localization may happen later.

---

# 36. Existing Automation Must Remain

V1 does NOT rewrite major functioning subsystems such as:

* Planner;
* Writer;
* Composer;
* Audit;
* Context Builder;
* provider architecture;
* streaming;
* retries;
* chapter persistence;
* chapter snapshots;
* state recovery;
* state-degraded recovery.

Only minimal changes required to support V1 should touch them.

---

# 37. Context System

InkOS already contains substantial context infrastructure including systems such as:

* ComposerAgent;
* governed working sets;
* memory retrieval;
* context transforms;
* context compression;
* forecast context.

V1 does not redesign this infrastructure.

V1 only ensures:

> Confirmed current Canon reaches the context consumed by future generation.

---

# 38. Context Inspector Is Deferred

The future product should expose:

```text
What information will be sent to the LLM?
```

including token information.

This is not required for V1.

---

# 39. Recovery and Retry Must Be Preserved

Existing handling for:

* interrupted streams;
* empty responses;
* transient API failures;
* partial generation;
* chapter recovery;
* snapshots;
* persisted draft restoration;

must continue to work.

---

# 40. Failed Generation Must Not Destroy Approved Canon

Example:

```text
User confirms Chapter 12 state
        ↓
Canon saved
        ↓
Generate Chapter 13
        ↓
LLM fails
```

Expected:

```text
Chapter 12 Canon remains valid.
```

Generation failures must not roll approved Canon back to stale values.

---

# 41. Failed Save Must Be Atomic

Example:

```text
User edits Canon
      ↓
Validation succeeds
      ↓
Persistence failure
```

Expected:

```text
Previous Canon remains intact.
```

There must not be partially updated canonical files.

---

# 42. State Editing Validation

Manual story-state changes must be validated before persistence.

Invalid structured state must not be committed.

The UI should present human-readable errors instead of only raw validator exceptions.

Example:

```text
Could not save Character State.

The selected relationship references a character
that does not exist.

No Canon changes were written.
```

---

# 43. Internal Technical State

The author should be able to change story meaning, but V1 should protect technical integrity.

Internal technical fields may be:

```text
READ_ONLY
SYSTEM_MANAGED
```

rather than manually editable.

This does not violate:

> Every story state must be correctable.

The user corrects the underlying story concept; the system updates technical metadata.

---

# 44. Dead / Vestigial Systems

The repository audit identified incomplete or vestigial areas including examples such as:

```text
subplotOps
emotionalArcOps
characterMatrixOps
models/state.ts
```

V1 must not assume these are reliable merely because code exists.

Before exposing one of these systems:

```text
Verify reader
Verify writer
Verify reducer
Verify persistence
Verify generation consumption
```

Cleanup is not a V1 goal unless something directly blocks implementation.

---

# 45. Studio and CLI Must Share the Same Core

Do not build separate state behavior for Studio.

Desired:

```text
              InkOS Core
              /        \
             /          \
           CLI         Studio
```

Both operate on the same underlying project and canonical state.

---

# 46. Main Studio Areas for V1

Exact visual design is not fixed.

Minimal conceptual navigation:

```text
Overview
Plan
Chapters
Story State
Audit
Settings
```

`Story State` becomes the main interface for understanding and correcting Canon.

---

# 47. Post-Chapter Review UI

Conceptually:

```text
Chapter 12 — State Review

5 proposed changes

1. Character Knowledge
   Elara discovered the hidden passage.
   [Accept] [Edit] [Reject]

2. Relationship
   Elara → Adrian
   Distrust → Cautious trust
   [Accept] [Edit] [Reject]

3. Character State
   Adrian injured his left hand.
   Explicit in prose
   [Accept] [Edit] [Reject]

4. Timeline
   Current date → 17 October 1887
   [Accept] [Edit] [Reject]

[+ Add Missing State Change]

[Confirm Chapter State]
```

After confirmation:

```text
Chapter READY
```

---

# 48. Normal State Editor

Separate from post-chapter review, the user can always open current story state.

Example:

```text
Story State → Characters → Elara

Age:
23

Current Location:
Blackwood Manor

Current Goal:
Find Evelyn

Knowledge:
- Hidden passage
- Harrow signed false record

[Edit]
```

This handles mistakes discovered later.

---

# 49. No Automatic Historical Rewrite

Explicitly prohibited in V1:

```text
Current Canon edited
      ↓
Automatically rewrite every old chapter
```

No.

If a current state correction is made, future generation respects it.

Past prose remains untouched unless the user explicitly chooses to edit it separately.

---

# 50. V1 Non-Goals

V1 does NOT require:

* complete Codex redesign;
* separate Canon database;
* full provenance system;
* user-lock metadata;
* automatic historical prose fixing;
* advanced conflict repair;
* visual timeline editor;
* advanced relationship graph;
* dedicated Secret manager;
* dedicated Clue manager;
* complete Plot Thread redesign;
* Context Inspector;
* token/cost dashboard;
* multi-model router;
* batch-generation redesign;
* advanced scene editor;
* Vietnamese application UI;
* cloud sync;
* collaboration;
* TTS;
* cover generation;
* video generation;
* replacing Writer;
* replacing Planner;
* replacing Audit;
* replacing Context Builder;
* rewriting InkOS from scratch.

---

# 51. Required V1 Test Areas

Implementation must cover at least:

### Canon loading

Studio can load current structured state.

### Canon editing

Valid user edits persist.

### Validation

Invalid edits do not persist.

### Atomic failure

Failed saves preserve previous valid Canon.

### Write-next integration

Confirmed edits reach subsequent generation.

### Post-chapter state review

A completed chapter enters:

```text
NEEDS_STATE_REVIEW
```

before becoming:

```text
READY
```

### State gate

Next chapter cannot normally run while previous chapter state remains unreviewed.

### Accept

Accepted state enters Canon.

### Edit

Edited proposal enters Canon using the user value.

### Reject

Rejected proposal does not enter Canon.

### Manual addition

User can add missing state information.

### Explicit-event warning

Rejecting state clearly supported by chapter prose generates a warning.

### Current-state correction

Changing current state does not rewrite historical chapters.

### Vietnamese project

Foundation, planning, writing, audit and state operate in Vietnamese.

### English project

Existing English behavior continues.

### Chinese migration

Chinese projects can be converted to Vietnamese or English without corrupting stable internal identifiers.

### Vietnamese length mode

Uses word-oriented counting.

### Vietnamese slug

Vietnamese titles produce stable identifiers.

### Existing recovery

Touched code does not break current recovery mechanisms.

---

# 52. Baseline

Initial baseline before implementation:

```text
InkOS: 1.8.0

Node:
24.19.0

pnpm:
9.15.9

Install:
PASS

Build:
PASS

Typecheck:
PASS

Tests:
1856 passed
2 known Windows symlink EPERM failures

Git:
clean
```

Those two symlink failures are known baseline environment failures.

They must not be counted as V1 regressions.

---

# 53. Acceptance Scenario — Normal Chapter

```text
Generate Chapter 12
      ↓
Planning
      ↓
Writing
      ↓
Audit
      ↓
Extract State
      ↓
NEEDS_STATE_REVIEW
```

User:

```text
Accepts 4
Edits 2
Rejects 1
Adds 1 missing fact
```

Then:

```text
Confirm
      ↓
Canonical state updated
      ↓
Chapter 12 READY
      ↓
Generate Chapter 13 available
```

PASS.

---

# 54. Acceptance Scenario — Time Skip

Before:

```text
Elara.age = 22
```

Chapter contains a one-year time skip.

InkOS fails to update age.

User opens Story State:

```text
22 → 23
```

Save.

Expected:

```text
Current Canon:
Elara.age = 23
```

Old chapters remain unchanged.

Future generation uses:

```text
23
```

PASS.

---

# 55. Acceptance Scenario — Missing AI Extraction

Chapter clearly reveals:

> Elara now knows Malcolm forged the record.

AI fails to extract this state.

During review user selects:

```text
Add Missing State Change
```

and adds the knowledge.

After confirmation:

```text
Elara knows Malcolm forged the record
```

is available to future generation.

PASS.

---

# 56. Acceptance Scenario — Reject Explicit Event

Chapter prose explicitly states:

> Adrian broke his left arm.

AI proposes:

```text
Adrian.injury = broken left arm
```

User chooses Reject.

Studio warns:

```text
This state change is explicitly supported by the chapter prose.
Rejecting it may create a Canon conflict.
```

User may still:

```text
Reject Anyway
Edit Chapter
Cancel
```

Human remains final authority.

PASS.

---

# 57. Acceptance Scenario — Vietnamese New Project

User creates a new project.

Default language:

```text
Vietnamese
```

Idea:

```text
Một cô gái kết hôn với một quý tộc bí ẩn...
```

Expected:

```text
Foundation → Vietnamese
Planning   → Vietnamese
Writing    → Vietnamese
Audit      → Vietnamese
State      → Vietnamese
```

Length semantics are word-based.

PASS.

---

# 58. Acceptance Scenario — English Project

User selects:

```text
English
```

Existing English behavior remains functional.

Vietnamese instructions do not leak into generation.

PASS.

---

# 59. Acceptance Scenario — Chinese Migration

An existing Chinese project is detected.

User chooses:

```text
Convert to Vietnamese
```

or:

```text
Convert to English
```

Story-facing Chinese content is translated.

Stable internal identifiers remain intact.

Project language becomes:

```text
vi
```

or:

```text
en
```

The converted project continues through the normal InkOS pipeline.

PASS.

---

# 60. Definition of V1 Success

V1 succeeds when the user can truthfully say:

> **I can still give InkOS an idea and let it automatically build and write my long-form story. After each chapter, I can see what InkOS thinks changed, approve or correct those changes, add anything it missed, and only then continue. If InkOS later gets the story state wrong, I can open Studio and fix the current Canon myself without rewriting old chapters. The next chapter respects my correction. The system is Vietnamese-first, also supports English, and Chinese projects are migrated into one of those two languages.**

That is V1.

---

# 61. Development Rule

Every implementation decision should begin with:

> **Does InkOS already have a working mechanism for this?**

If yes:

```text
REUSE
EXPOSE
EXTEND
```

before:

```text
DUPLICATE
REPLACE
REWRITE
```

---

# 62. Implementation Handoff

Before writing code, DSH must read:

```text
PROJECT_VISION.md
V1_SPEC.md
```

and the completed repository-audit findings.

The next DSH task is:

> **Create a detailed implementation plan based on the real repository architecture. Do not implement yet.**

The plan must identify:

* exact existing files involved;
* exact state schemas;
* persistence APIs to reuse;
* overwrite/rebuild paths;
* Studio server/client boundaries;
* chapter lifecycle changes;
* state-review storage semantics;
* Vietnamese language migration sites;
* Chinese conversion strategy;
* tests to add before each behavioral change;
* compatibility risks.

Only after the implementation plan is reviewed and approved should code changes begin.

---

# Final Principle

> **Do not make InkOS less automatic.
> Make its automation visible, reviewable, correctable and author-controlled.**
