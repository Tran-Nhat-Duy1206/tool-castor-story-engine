# InkOS Evolution — Product Vision

**Status:** Product direction / source of intent
**Purpose:** Define what this fork of InkOS is intended to become.
**Important:** This document is NOT an implementation plan and does not prescribe specific architecture unless explicitly stated.

---

# 1. Core Vision

This project will **evolve the existing InkOS codebase**, not rebuild it from scratch.

The strongest capability of InkOS is its automation:

> Idea → Story Foundation → Planning → Long-form Writing → Audit → Story State Update → Continue Writing

That automation must remain a core strength of the product.

The main limitation we want to solve is that the user currently has too little direct visibility and control over the story knowledge used by the system.

The future product should therefore combine:

> **InkOS-level automation + human-visible, human-editable story control.**

The AI should do most of the repetitive work, while the user remains the final authority over the story.

---

# 2. Primary User Experience

The ideal workflow is:

```text
User provides an idea as text
        ↓
InkOS builds the story foundation
        ↓
InkOS creates planning material
        ↓
User can inspect and modify the generated information
        ↓
Generate Next Chapter
        ↓
Automatic writing
        ↓
Automatic audit
        ↓
System detects story-state changes
        ↓
User may inspect/correct important changes
        ↓
Generate Next Chapter
        ↓
Continue until the novel is complete
```

The user should **not** be required to manually plan every scene or write every chapter.

Automation remains the default.

Manual control exists when the user wants or needs it.

---

# 3. Core Principle: Human-Owned Canon

The AI does not own the truth of the story.

The **user owns the Canon**.

If AI-generated information conflicts with user-confirmed information, user-confirmed information wins.

Example:

```text
AI generated:
Elara age = 24

User changes:
Elara age = 22

Canonical truth:
Elara age = 22
```

Future generations must respect the confirmed value.

If prose or generated state conflicts with Canon, the system should expose the conflict rather than silently changing Canon.

---

# 4. Human-in-the-Loop, Not Human-in-the-Way

The system should remain highly automated.

We do NOT want to turn InkOS into a workflow where the user has to approve every minor detail.

The intended behavior is:

### Minor or temporary information

May be updated automatically when safe.

Examples:

* current location
* temporary injuries
* object possession
* minor scene events
* chapter progression

### Important Canon changes

Should eventually be visible and reviewable by the user.

Examples:

* age
* identity
* family relationship
* death
* major relationship change
* important timeline event
* character motivation
* major backstory
* secrets
* reveals
* world rules
* major plot twists

The exact approval rules may evolve after the existing InkOS architecture is understood.

---

# 5. What Must Be Preserved From InkOS

Unless there is a strong technical reason otherwise, preserve and improve existing working systems rather than replacing them.

Important capabilities to preserve include:

* automatic story creation from an idea
* story foundation generation
* long-form story planning
* `write next`
* automatic chapter generation
* continuity handling
* story-state tracking
* audit/review pipeline
* recovery/resume behavior
* provider abstraction
* CLI workflows
* Studio
* existing project/book compatibility
* existing exports
* retries and failure handling
* existing structured state that is already useful

Do not replace a working subsystem simply because a new implementation looks cleaner.

---

# 6. Main Problems We Want to Solve

The current InkOS workflow is powerful but too opaque for the desired use case.

The user needs to be able to see and correct what the system believes about the story.

The project should progressively improve visibility and editability of information such as:

* story foundation
* characters
* character state
* locations
* important objects
* organizations
* relationships
* timeline
* story facts
* world rules
* plot threads
* subplots
* hooks
* clues
* secrets
* reveals
* unresolved questions
* chapter plans
* scene plans where useful
* continuity state
* relevant AI memory/context

Before creating new systems for these concepts, investigate what InkOS already contains and reuse existing structured state whenever possible.

---

# 7. Studio Direction

Studio should progressively become the main visual interface for understanding and controlling a story.

A future Studio may provide areas such as:

```text
Overview

Plan

Chapters

Story Data / Codex
  Characters
  Locations
  Relationships
  Objects

Story State
  Timeline
  Facts
  Plot Threads
  Clues
  Secrets
  Hooks

Audit

Context

AI Settings
```

This is a product direction, not a fixed UI specification.

The existing Studio architecture should be studied before deciding how these screens are implemented.

---

# 8. Editable Story Data

Important story data should eventually be directly editable by the user.

A user should not need to:

* edit obscure internal files manually
* ask the LLM to remember a correction
* regenerate a story foundation just to fix one fact
* depend on the LLM to repair simple structured information

Example future interaction:

```text
Character: Elara Whitmore

Age: 22
Role: Protagonist
Current Location: Blackwood Manor
Goal: Discover her real identity
Relationship with Adrian: Distrustful attraction

[Edit]
[Save]
```

The next generation should use the updated information.

---

# 9. Data Provenance

Where useful, important facts should eventually be able to record where they came from.

Possible provenance categories:

```text
USER_CREATED
USER_EDITED
AI_GENERATED
STORY_EVENT
INFERRED
```

User-created or user-edited information should have higher authority than AI inference.

Example:

```text
Age: 22
Source: USER_EDITED
```

versus:

```text
Adrian may distrust Malcolm
Source: INFERRED
```

An inference should not automatically become permanent Canon without sufficient justification.

The existing InkOS state model must be studied before designing this feature.

---

# 10. Lockable Canon

The future system should support the concept of facts that the AI is not allowed to silently change.

Example:

```text
Elara.age = 22
Locked by user
```

If generated prose says:

```text
Elara was twenty-four...
```

the system should eventually be capable of detecting:

```text
CANON CONFLICT

Canonical value:
22

Generated prose:
24
```

and allow the user to decide how to resolve it.

---

# 11. Secrets and Knowledge Boundaries

Long-form fiction often contains information that is true for the author but unknown to characters.

The system should eventually distinguish between:

```text
Author knows the secret
Character A knows the secret
Character B suspects the secret
POV character does not know the secret
Reader has received only clues
```

Example:

```text
Secret:
Evelyn is Elara's mother

Canonical truth:
TRUE

Known by:
Malcolm
Adrian

Unknown to:
Elara

Target reveal:
Chapter 20
```

The AI may need access to the secret for foreshadowing while still being forbidden from revealing it early through the POV character.

Before adding a new Secret system, investigate whether InkOS already has equivalent truth/hook/subplot/governance mechanisms.

---

# 12. Plot and Clue Tracking

The system should eventually make long-running narrative elements visible.

Examples:

```text
Plot Thread:
Who is the woman in the portrait?

Opened:
Chapter 2

Last advanced:
Chapter 14

Target resolution:
Chapter 20

Status:
Active
```

and:

```text
Clue:
Portrait resembles Elara

Introduced:
Chapter 2

Related secret:
Evelyn is Elara's mother

Status:
Introduced
```

Possible states may include:

```text
Planned
Introduced
Reinforced
Resolved
Abandoned
```

Do not create duplicate systems if InkOS already tracks these concepts.

---

# 13. Timeline Visibility

The user should eventually have a clear representation of important story chronology.

Example:

```text
12 October 1887
Elara arrives at Blackwood Manor

13 October 1887
Elara discovers the portrait

14 October 1887
Dr. Harrow arrives
```

Timeline inconsistencies should be detectable.

The user should also be able to correct timeline data directly when InkOS or the LLM makes a mistake.

---

# 14. Chapter and Scene Control

The user experience should remain chapter-oriented.

The primary action should remain something similar to:

```text
Generate Next Chapter
```

The user should not be forced to generate every scene manually.

Internally, the engine may plan or generate scene-by-scene if that improves quality, reliability, context control, or recovery.

The user may eventually inspect and edit:

```text
Chapter Goal
Chapter Plan
Scenes
POV
Characters
Locations
Required Events
Forbidden Reveals
Ending Beat
```

but automation should create these by default.

---

# 15. Vietnamese + English Only

This fork of InkOS will support **two primary story languages only**:

```text
Vietnamese — vi-VN
English    — en
```

Chinese is **not part of the target product direction**.

The original InkOS codebase may currently contain Chinese-specific:

* prompts
* system instructions
* UI text
* default values
* story templates
* examples
* tests
* validation rules
* language detection
* foundation generation behavior
* planning behavior
* writing behavior
* review/audit behavior
* documentation
* CLI messages
* Studio labels

These existing Chinese-oriented components must be identified during the repository audit.

The long-term direction is:

```text
Original InkOS

Chinese
English
    ↓

This Fork

Vietnamese
English
```

---

## Language Priority

Vietnamese is the primary language this fork is being improved for.

English remains fully supported.

The intended language configuration is:

```text
Story Language:
Vietnamese | English
```

with locale information where appropriate:

```text
Vietnamese:
vi-VN

English:
en
```

There should not be a Chinese story-language option in the final target product.

---

## Vietnamese Must Replace Chinese Where Chinese Is Currently the Default

If the existing InkOS system currently assumes Chinese as its default language, the fork should progressively replace that behavior with Vietnamese.

Conceptually:

```text
Existing behavior:

Default Language
    ↓
Chinese
```

should become:

```text
Fork behavior:

Default Language
    ↓
Vietnamese
```

when doing so is compatible with the approved migration plan.

English should remain available as an explicit alternative.

---

## Language Must Be Project-Level Configuration

Language support should not depend only on repeatedly adding instructions such as:

```text
Write in Vietnamese.
```

A story project should explicitly know its language.

Example:

```text
language: vi-VN
```

or:

```text
language: en
```

This setting should propagate consistently through the relevant story pipeline.

---

## Vietnamese Pipeline

When a project uses Vietnamese:

```text
Idea Analysis
      ↓
Vietnamese

Story Foundation
      ↓
Vietnamese

Planning
      ↓
Vietnamese

Outline
      ↓
Vietnamese

Scene Planning
      ↓
Vietnamese

Chapter Writing
      ↓
Vietnamese

Review
      ↓
Vietnamese

Audit
      ↓
Vietnamese

Story-State Extraction
      ↓
Vietnamese

Generated Studio Content
      ↓
Vietnamese
```

The system should generate natural Vietnamese directly whenever possible rather than generate Chinese or English first and translate afterward.

---

## English Pipeline

When the project language is English:

```text
Idea Analysis
      ↓
English

Story Foundation
      ↓
English

Planning
      ↓
English

Outline
      ↓
English

Scene Planning
      ↓
English

Chapter Writing
      ↓
English

Review
      ↓
English

Audit
      ↓
English

Story-State Extraction
      ↓
English
```

Vietnamese-specific instructions must not leak into English projects.

---

## Remove Chinese Product Behavior Progressively

Do NOT perform a blind global deletion of Chinese text.

Chinese support must first be audited and classified.

For every Chinese-specific component, determine whether it should be:

```text
REPLACE WITH VIETNAMESE
REMOVE
KEEP TEMPORARILY FOR BACKWARD COMPATIBILITY
REFACTOR INTO LANGUAGE-NEUTRAL LOGIC
```

Examples:

### Chinese prose prompt

Prefer:

```text
Chinese-specific prompt
        ↓
Language-neutral prompt system
        ↓
Vietnamese prompt
English prompt
```

rather than simply hard-coding Vietnamese into every existing Chinese branch.

---

## Language-Neutral Core Where Possible

Core story logic should not depend unnecessarily on a specific natural language.

Prefer:

```text
Story Engine
     ↓
Language Configuration
     ↓
┌──────────────┬──────────────┐
│ Vietnamese   │ English      │
└──────────────┴──────────────┘
```

over duplicated systems such as:

```text
VietnameseEngine
EnglishEngine
```

Only language-specific writing rules, prompts, metrics, validation or linguistic behavior should differ where necessary.

---

## Chinese-Specific Logic Must Be Audited

During repository analysis, explicitly identify:

1. Every Chinese-specific system prompt.
2. Every Chinese-specific writing prompt.
3. Chinese-specific planner behavior.
4. Chinese-specific foundation behavior.
5. Chinese-specific audit/review instructions.
6. Chinese-specific word/character counting logic.
7. Chinese-specific validation.
8. Chinese-specific CLI output.
9. Chinese-specific Studio UI.
10. Chinese-specific templates.
11. Chinese-specific tests.
12. Chinese-specific documentation.
13. Chinese-specific defaults.
14. Any `zh`, `zh-CN`, `cn`, `Chinese`, or equivalent language branches.
15. Any logic that assumes Chinese character counts instead of word counts.

Do not modify these during the initial architecture audit.

First report where they exist and how they affect the system.

---

## Length Measurement Must Respect Language

Vietnamese and English should normally use **word-based length measurement**, not Chinese character-based length measurement.

For example:

```text
Vietnamese:
Target ≈ 3,000 words

English:
Target ≈ 3,000 words
```

Existing Chinese character-count assumptions should not silently carry into Vietnamese projects.

The repository audit must determine whether InkOS already has language-aware length metrics that can be reused.

---

## Backward Compatibility With Old Chinese Projects

Removing Chinese from the target product does not automatically mean old InkOS Chinese projects should be destroyed or become unreadable.

During migration, distinguish between:

```text
Creating new Chinese projects
```

and:

```text
Reading legacy Chinese InkOS projects
```

Target behavior:

* New projects: Vietnamese or English only.
* Existing Vietnamese projects: supported.
* Existing English projects: supported.
* Existing legacy Chinese projects: preserve readability/import compatibility where practical.
* Continued Chinese generation is not a product priority.

Do not sacrifice existing project safety simply to remove Chinese UI options.

---

## Studio Language Direction

The Studio should eventually expose only:

```text
Vietnamese
English
```

for new story language selection.

For example:

```text
Story Language

◉ Vietnamese
○ English
```

Chinese should not appear as a normal new-project language option in the final product.

---

## Product UI Language vs Story Language

Story language and application UI language are separate concepts.

The initial priority is **story-generation language**:

```text
Vietnamese
English
```

The Studio UI itself may initially remain English where this reduces unnecessary migration work.

A Vietnamese Studio interface can be implemented separately.

Do not mix these two requirements.

---

## Final Language Principle

The target language architecture is:

```text
                     InkOS Core
                         │
                  Language Config
                         │
              ┌──────────┴──────────┐
              ↓                     ↓
         Vietnamese              English
           vi-VN                   en
```

Not:

```text
Chinese + English + Vietnamese
```

and not:

```text
Chinese system
     ↓
Translate output to Vietnamese
```

The final goal is:

> **Vietnamese and English are native first-class writing languages of the system. Chinese is progressively removed from the product direction, while legacy project safety is preserved where practical.**

# 16. Context Transparency

A future version should make it possible to understand what information is sent to the LLM.

Example:

```text
Chapter 24 Context

Foundation            1,200 tokens
Chapter Plan            600
Characters            2,100
Previous Chapter      4,000
Relevant History      2,700
Plot Threads          1,000
Timeline                700
Writing Rules           500
```

This will help diagnose:

* excessive context size
* irrelevant context
* forgotten information
* token cost
* model limits
* continuity failures

Do not redesign the context builder before understanding the current InkOS implementation.

---

# 17. Efficient Context, Not Maximum Context

A large context window does not mean the system should always send the entire novel.

The long-term direction is:

> Send the most relevant story information required for the current task.

For example, a chapter involving three characters should not automatically require full detailed biographies of forty unrelated characters.

However, context optimization should happen only after the current InkOS context and memory systems have been audited.

---

# 18. Multi-Model Capability

The architecture should eventually allow different tasks to use different models if useful.

Example:

```text
Planner   → Model A
Writer    → Model B
Reviewer  → Model C
Metadata  → Model D
```

A user should also be able to use one model for everything.

This is a future capability and should not unnecessarily complicate the first migration stages.

---

# 19. Safe Generation

Generation failures must never destroy good existing work.

Important principles:

* current draft survives failed rewrite
* partial generation should be recoverable when possible
* completed scenes should not needlessly regenerate
* retries should not silently replace good content
* state updates should not corrupt the story when later pipeline stages fail

InkOS already contains recovery and persistence mechanisms.

Investigate and preserve them before adding new behavior.

---

# 20. Checkpoint and Resume

Long-running generation should ideally have clear checkpoints.

Conceptually:

```text
Chapter 14

Planning       ✓
Scene 1        ✓
Scene 2        ✓
Scene 3        generating...
Audit          pending
State Update   pending
```

If generation fails during Scene 3, the system should reuse valid completed work whenever possible.

Existing InkOS recovery mechanisms must be understood before designing replacements.

---

# 21. Audit Philosophy

Use deterministic code for facts that software can check reliably.

Examples:

* missing IDs
* broken references
* invalid schemas
* chapter ordering
* malformed state
* duplicate identifiers

Use LLM judgment for narrative problems such as:

* character consistency
* plot logic
* POV
* pacing
* foreshadowing
* repetitive prose
* dialogue quality
* emotional continuity

Do not use expensive probabilistic reasoning when deterministic validation is sufficient.

---

# 22. State Changes After Writing

After generating a chapter, the system may discover story-state changes.

Example:

```text
New event:
Elara discovered the hidden passage

Relationship change:
Elara → Adrian
Distrust → cautious trust

New clue:
Burned medical record

Temporary state:
Adrian injured his left hand
```

A future version should make important changes visible.

Minor safe changes may remain automatic.

Major Canon changes should ultimately be reviewable.

The exact implementation should build on existing InkOS state-reduction and persistence mechanisms where possible.

---

# 23. Backward Compatibility

Existing InkOS books are valuable and should not be broken unnecessarily.

Progressive migration is preferred.

If data formats evolve:

```text
v1 → v2 → v3
```

provide migration paths when practical.

Avoid destructive migrations during early development.

Where necessary, old and new representations may temporarily coexist.

---

# 24. Progressive Evolution

This project should evolve InkOS in stages.

General philosophy:

```text
Understand
    ↓
Expose
    ↓
Allow Editing
    ↓
Add Governance
    ↓
Improve Context
    ↓
Improve Automation
```

Do not begin by replacing the core generation engine.

Whenever possible:

```text
Existing working InkOS system
        ↓
Expose it
        ↓
Make it controllable
        ↓
Improve it
```

rather than:

```text
Delete existing system
        ↓
Build a new one
```

---

# 25. Source of Truth Before Duplication

Before implementing any new:

* Canon database
* Codex
* timeline database
* clue manager
* relationship manager
* plot-thread system
* memory system
* context system

first determine whether InkOS already has an equivalent or partially equivalent system.

Prefer:

```text
Reuse
Extend
Expose
Structure
```

before:

```text
Duplicate
Replace
```

---

# 26. CLI Must Remain Valuable

Studio may become the primary visual interface, but CLI should not be broken unnecessarily.

Existing commands such as automated long-form writing should continue to work when practical.

A useful principle is:

> Studio and CLI should operate on the same underlying story engine and story state.

The UI should not become a completely separate implementation of InkOS behavior.

---

# 27. Local-First Direction

The current primary use case is a local writing tool.

The project does not need to become a cloud SaaS platform.

Local story ownership and portability are important.

The user's novel should remain accessible even without the Studio UI.

---

# 28. Things We Are NOT Trying to Build Right Now

Do not expand scope into unrelated product areas.

Not current priorities:

* social network
* publishing marketplace
* collaborative Google-Docs-style editing
* subscription/payment platform
* mobile application
* full Microsoft Word replacement
* cover-generation suite
* video-generation suite
* TTS production pipeline
* dozens of autonomous agents
* complete Novelcrafter clone
* rewriting InkOS from zero

These may be considered separately in the future if needed.

---

# 29. Development Philosophy

Changes should be incremental.

For major subsystems:

1. Understand current behavior.
2. Preserve tests and baseline behavior.
3. Expose existing functionality where possible.
4. Add tests for the desired behavior.
5. Make the smallest necessary change.
6. Verify backward compatibility.
7. Only then move to the next subsystem.

Avoid combining:

```text
data migration
+
generation rewrite
+
UI redesign
+
context rewrite
```

in one change.

---

# 30. Current Development Baseline

At the beginning of this fork's evolution:

```text
InkOS: 1.8.0
Platform: Windows
Node: 24.19.0
pnpm: 9.15.9

pnpm install --frozen-lockfile:
PASS

pnpm build:
PASS

pnpm typecheck:
PASS

pnpm test:
1856 passed
2 known Windows symlink EPERM failures

pnpm lint:
Workspace packages currently do not define lint scripts.

Git working tree:
Clean
```

The two symlink-related test failures are considered known environment-specific baseline failures unless later investigation proves otherwise.

Do not change production behavior merely to eliminate those two baseline failures.

---

# 31. Immediate Next Step

The next step is NOT implementation.

The next step is to audit the existing InkOS repository and understand:

* current architecture
* current story data
* current structured state
* current sources of truth
* current persistence
* current generation flow
* current audit flow
* current context construction
* current Studio capabilities
* current CLI capabilities
* current recovery systems

Only after this audit should we decide:

```text
KEEP
KEEP + EXPOSE
MODIFY
ADD
REFACTOR LATER
REPLACE LATER
REMOVE
```

The audit must inform the implementation plan.
LANGUAGE MIGRATION AUDIT

Identify every Chinese-specific component in the repository.

Search for and trace:
- Chinese
- zh
- zh-CN
- Chinese-language prompts
- Chinese character-count assumptions
- Chinese defaults
- Chinese templates
- Chinese tests
- Chinese UI labels

For each occurrence classify it as:

KEEP FOR LEGACY COMPATIBILITY
REPLACE WITH VIETNAMESE
MAKE LANGUAGE-NEUTRAL
REMOVE LATER

Do not modify anything during this audit.
---

# 32. Final Product Principle

The intended product can be summarized as:

> **InkOS should remain an automated AI story engine, but it should no longer be a black box.**

The user provides an idea and AI handles most of the work.

At the same time, the user can inspect, understand, add, correct, lock, and override the story knowledge that matters.

**AI automates the writing process.
The human remains the author and final authority.**
