# Castor Machine Prompt Language Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Converge Castor-owned production machine prompts to English canonical maintenance language without changing schemas, authority semantics, book-language routing, or story behavior beyond unavoidable wording equivalence.

**Architecture:** Inventory every production prompt family first, establish contract tests around each high-risk prompt boundary, then migrate one family at a time. Prompt text remains a machine contract: English canonical instructions must explicitly honor each book's configured output language, while UI locale is never consulted for story-language routing.

**Tech Stack:** TypeScript, existing `packages/core/src/prompts/**` prompt registry/pack system, Vitest, Phase 4/5 governance tests, real configured LLM provider for bounded acceptance probes.

**Spec:** `docs/superpowers/specs/2026-08-29-castor-canonical-identity-migration-design.md` Sections 21.7–21.9, 22.6, 23, and 24.

## Global Constraints

- Plan 1 identity migration and Plan 2 localization must be Human-accepted before this plan starts.
- Machine prompt maintenance language becomes English canonical where Castor owns the prompt.
- UI locale and book output language remain independent.
- Do not mechanically bulk-translate prompts.
- Preserve structured output/schema instructions, authority/safety semantics, output-language routing, and existing deterministic Core gates.
- Do not redesign prompt quality, characters, genre methodology, or Phase 4/5 behavior in the same checkpoint.
- User-authored prompt overrides and imported content are data; do not rewrite them merely because the built-in prompt language changes.
- Real-model probes use a temporary/controlled configured provider and must not expose API keys.
- One checkpoint at a time: autonomous inside a checkpoint, Human-controlled between checkpoints.
- No push, tag, package publish, release, or Phase 6.

---

### Task 1: Inventory and classify every Castor-owned production prompt

**Files:**
- Create: `docs/migrations/castor-machine-prompt-inventory.md`
- Inspect: `packages/core/src/prompts/builtin-prompts.ts`
- Inspect: `packages/core/src/prompts/prompt-pack.ts`
- Inspect: `packages/core/src/prompts/short-fiction.ts`
- Inspect: `packages/core/src/prompts/index.ts`
- Inspect: `packages/core/src/agents/**`
- Inspect: `packages/core/src/pipeline/**`
- Inspect: `packages/core/src/governance/**`
- Inspect: `packages/core/skills/**`
- Inspect: project-level prompt-pack loading paths discovered from `prompt-pack.ts`

**Interfaces:**
- Consumes: current prompt registry/pack loading behavior.
- Produces: an exhaustive inventory with one owner, risk class, target language state, output schema, and verification command per prompt family.

- [ ] **Step 1: Scan prompt-bearing source without editing it**

```powershell
rg -n --hidden --glob '!node_modules' --glob '!dist' --glob '!.git' 'systemPrompt|prompt|Prompt|instructions|messages|role:\s*["'"']system|[\p{Han}]' packages/core/src packages/core/skills
```

- [ ] **Step 2: Build the inventory table**

For every Castor-owned prompt, record:

```text
ID | exact file | exported function/constant | caller | current language | output schema/format | book-language input | authority impact | risk | target checkpoint
```

Risk must be one of:

```text
HIGH    Foundation, Planner/Gate/Replan, Writer/Reviser, Auditor/Reviewer, State Review extraction
MEDIUM  Short/Play/translation/forecast/other structured production agents
LOW     explanatory/helper prompts with no authority or durable structured output
USER    user/project override; never rewrite automatically
```

- [ ] **Step 3: Identify all prompt override precedence rules**

Read `packages/core/src/prompts/prompt-pack.ts` and document exactly how built-in prompts, project prompt packs, and user overrides resolve. Mark user-owned files `USER` and exclude them from automatic translation.

- [ ] **Step 4: Record baseline tests and representative fixtures for every HIGH family**

For each HIGH family, record the existing test files that validate its schema/authority behavior. If none exists, mark the missing contract test as required in the family's task below.

- [ ] **Step 5: Commit inventory only**

```powershell
git add docs/migrations/castor-machine-prompt-inventory.md
git commit -m "docs: inventory Castor machine prompt contracts"
```

**HUMAN GATE P1:** Stop if any prompt cannot be classified as Castor-owned vs user-owned, or if translating it would require changing an API/schema.

---

### Task 2: Add a prompt-language and contract audit harness

**Files:**
- Create: `scripts/audit-castor-machine-prompts.mjs`
- Create: `scripts/__tests__/audit-castor-machine-prompts.test.mjs` if that script-test convention exists after Plan 1; otherwise place the test beside the repository's existing script tests.
- Modify: root `package.json`

**Interfaces:**
- Consumes: inventory from Task 1.
- Produces: `pnpm audit:castor-machine-prompts`, which blocks unclassified Chinese Castor-owned machine prompts but permits user content, legacy fixtures, and explicitly staged exceptions.

- [ ] **Step 1: Write a RED fixture test**

Fixture input containing a Castor-owned prompt such as:

```text
...
```

must fail with an error identifying the exact file/category. A fixture explicitly marked `USER` must not fail.

- [ ] **Step 2: Run RED test**

```powershell
node --test scripts/__tests__/audit-castor-machine-prompts.test.mjs
```

Expected: FAIL because the audit does not yet exist.

- [ ] **Step 3: Implement the minimal inventory-backed scanner**

The scanner must not simply ban Han characters globally. It must distinguish:

```text
Castor-owned machine prompt => must be English or explicitly staged
user/import content => allowed
legacy/test fixture => allowed
historical attribution => allowed
```

- [ ] **Step 4: Add root script**

```json
"audit:castor-machine-prompts": "node scripts/audit-castor-machine-prompts.mjs"
```

- [ ] **Step 5: Run the audit on the current tree**

```powershell
pnpm audit:castor-machine-prompts
```

Expected before migrations: fail only on inventory-classified Castor-owned non-English prompt families.

- [ ] **Step 6: Commit harness**

```powershell
git add scripts/audit-castor-machine-prompts.mjs scripts/__tests__/audit-castor-machine-prompts.test.mjs package.json
git commit -m "test: audit Castor machine prompt language contracts"
```

---

### Task 3: Migrate Foundation generation and Foundation review prompts

**Files:**
- Modify: exact Foundation prompt files/functions recorded in `docs/migrations/castor-machine-prompt-inventory.md`
- Test: existing Foundation governance/generation tests recorded in the inventory
- Create if absent: `packages/core/src/__tests__/foundation-prompt-contract.test.ts`

**Interfaces:**
- Consumes: Foundation brief/book language and existing structured output contract.
- Produces: English canonical Foundation instructions with identical schema and Human Publish authority boundary.

- [ ] **Step 1: Write/extend RED contract tests before changing prompt text**

Assert the assembled Foundation prompt contains explicit requirements equivalent to:

```text
Return the existing required structured format/schema.
Treat generated Foundation as a proposal/draft, never Human Published authority.
Honor the book's configured output language.
Do not infer story output language from UI locale.
```

Also assert no production Foundation prompt path reads `CASTOR_LOCALE` to choose story language.

- [ ] **Step 2: Capture a deterministic baseline fixture**

Using the existing prompt builder, snapshot/hash the non-natural-language structural markers: required keys, delimiters, JSON/schema names, enum values, and authority terms. Do not snapshot prose wording as a behavioral oracle.

- [ ] **Step 3: Convert only the Castor-owned Foundation instruction prose to English**

Keep all schema property names and authority terms exact. Do not alter Foundation content policy or add new creative guidance.

- [ ] **Step 4: Run targeted Foundation and Phase 5 authority tests**

Use the exact commands recorded by Task 1, plus the new contract test.

Expected: GREEN; no Published Foundation appears without Human Publish.

- [ ] **Step 5: Run one bounded real-model Foundation probe**

Use a disposable book and real configured provider twice if affordable:

```text
book language = English => Foundation output English
book language = Vietnamese => Foundation output Vietnamese
```

UI locale may be either; record it and prove it does not control output language.

- [ ] **Step 6: Commit**

```powershell
git add <exact-foundation-files-from-inventory> packages/core/src/__tests__/foundation-prompt-contract.test.ts
git commit -m "refactor(prompts): canonicalize Foundation prompts in English"
```

**HUMAN GATE P3:** Report schema/authority regression results and real-model output-language evidence.

---

### Task 4: Migrate Planner, Planning Gate semantic review, and bounded replan prompts

**Files:**
- Modify: exact Planner/Gate/Replan prompt owners recorded by Task 1, expected under `packages/core/src/agents/**`, `packages/core/src/pipeline/**`, and/or `packages/core/src/prompts/**`
- Test: existing Phase 5 planning/gate/replan tests from inventory
- Create if absent: `packages/core/src/__tests__/planning-prompt-contract.test.ts`

**Interfaces:**
- Consumes: Published Foundation, Published Arc, Human Direction/Authorization evidence, book language, deterministic gate inputs.
- Produces: existing plan schemas only; never expands authority.

- [ ] **Step 1: Write RED structural/authority assertions**

The assembled prompts must preserve requirements equivalent to:

```text
AI proposes; Human authority remains external.
Do not manufacture Human Direction or Authorization.
Do not treat Draft Foundation/Arc as Published authority.
Return the exact existing plan/replan structured contract.
Honor book language for user-visible planning content where the current contract requires it.
```

- [ ] **Step 2: Verify deterministic Planning Gate remains outside model authority**

Add a regression assertion around the current architecture proving prompt migration cannot directly change the deterministic final Gate verdict or bypass required Core validation.

- [ ] **Step 3: Convert Planner/Gate/Replan instruction prose to English canonical**

Do not alter max semantic replan count, conflict handling, Human decision rules, or plan schema.

- [ ] **Step 4: Run targeted Phase 5 planning tests**

Include SAFE/UNCERTAIN/AUTHOR_DECISION/CONFLICT scenarios and the max-two semantic-replan boundary where present.

- [ ] **Step 5: Run a bounded real-model plan probe**

On a disposable published Foundation/Arc fixture, generate one detailed plan and verify:

```text
schema parse succeeds
book language honored
no Human authority fabricated
no internal instructions leaked to user-visible plan
```

- [ ] **Step 6: Commit and stop at Human gate**

```powershell
git add <exact-planning-files-from-inventory> packages/core/src/__tests__/planning-prompt-contract.test.ts
git commit -m "refactor(prompts): canonicalize planning prompts in English"
```

**HUMAN GATE P4.**

---

### Task 5: Migrate Writer and revision prompts

**Files:**
- Modify: exact Writer/Reviser prompt files from Task 1 inventory
- Test: existing writer/gate/chapter persistence suites
- Create if absent: `packages/core/src/__tests__/writer-prompt-contract.test.ts`

**Interfaces:**
- Consumes: authorized ContextBundle/Detailed Plan/book language.
- Produces: prose only through the existing one-Write/one-chapter governed pipeline.

- [ ] **Step 1: Add RED Writer prompt contract tests**

Assert the assembled Writer prompt retains explicit requirements equivalent to:

```text
write only the requested chapter
honor the configured book language
follow supplied plan/canon/context
never expose plan IDs, snapshots, schemas, or internal instructions in prose
return prose in the existing expected format
```

- [ ] **Step 2: Add language-routing regression**

Construct prompt inputs with:

```text
UI locale vi-VN + book language English
UI locale en-US + book language Vietnamese
```

and prove the Writer instruction source is book language, not UI locale.

- [ ] **Step 3: Convert only Writer/Reviser machine instructions to English**

Do not add stylistic improvement requirements in this task. Preserve existing creative constraints semantically.

- [ ] **Step 4: Run writer + chapter persistence + governed gate regressions**

Include the existing one deliberate Write → max one chapter tests and audit-failed Canon hotfix regression.

- [ ] **Step 5: Run two bounded real-model Writer probes**

Use disposable test books/plans:

```text
vi-VN UI + English book => English prose
 en-US UI + Vietnamese book => Vietnamese prose
```

For each inspect:

```text
no internal metadata leakage
no prompt text leakage
no truncation caused by changed format
one writer call / one chapter only
```

Do not Final Confirm merely to validate prompt language unless the normal acceptance fixture requires it; preserve Human boundary.

- [ ] **Step 6: Commit**

```powershell
git add <exact-writer-files-from-inventory> packages/core/src/__tests__/writer-prompt-contract.test.ts
git commit -m "refactor(prompts): canonicalize Writer prompts in English"
```

**HUMAN GATE P5:** Chapter quality differences that are subjective are reported, not silently "fixed" in this migration checkpoint.

---

### Task 6: Migrate Auditor/Reviewer and Human State Review extraction prompts

**Files:**
- Modify: exact Auditor/Reviewer/State Review prompt owners from Task 1
- Test: existing audit, State Review, Final Confirm, chapter-persistence tests
- Create if absent: `packages/core/src/__tests__/review-prompt-contract.test.ts`

**Interfaces:**
- Consumes: chapter prose, Canon/context, existing schemas.
- Produces: audit findings/proposals only; Human remains sole settlement authority.

- [ ] **Step 1: Write RED schema and authority tests**

Assert English canonical prompts still require:

```text
exact existing audit/proposal schema
facts must be evidenced by chapter/context
proposal != Canon
AI may not confirm/settle its own proposals
Human Final Confirm remains external
book language does not change machine schema keys
```

- [ ] **Step 2: Convert Auditor/Reviewer prompts to English**

Preserve severity taxonomy and pass/fail semantics exactly.

- [ ] **Step 3: Convert State Review extraction prompts to English**

Preserve proposal schema, provenance/evidence requirements, and no-authority rule.

- [ ] **Step 4: Run regressions**

Include:

```text
audit pass
audit fail
needs-state-review
pre-confirm Canon unchanged
Final Confirm settlement
post-acceptance audit-failed Canon hotfix
```

- [ ] **Step 5: Run one real-model review probe**

Use a disposable chapter with known facts and one tempting unsupported inference. Verify the model returns parseable findings/proposals and does not turn unsupported inference into settled Canon.

- [ ] **Step 6: Commit**

```powershell
git add <exact-review-files-from-inventory> packages/core/src/__tests__/review-prompt-contract.test.ts
git commit -m "refactor(prompts): canonicalize review prompts in English"
```

**HUMAN GATE P6.**

---

### Task 7: Migrate remaining Castor-owned prompt families without rewriting user overrides

**Files:**
- Modify: remaining MEDIUM/LOW Castor-owned files from inventory, including as applicable `packages/core/src/prompts/builtin-prompts.ts`, `packages/core/src/prompts/short-fiction.ts`, other agent/skill prompt owners
- Test: exact family-specific tests recorded in inventory

**Interfaces:**
- Consumes/produces: each family's existing public contract unchanged.
- Produces: zero unclassified Castor-owned non-English machine prompts.

- [ ] **Step 1: Group remaining prompts by independent product family**

At minimum separate where present:

```text
Short Fiction
Play / interactive world / interactive film
translation
forecast/branch exploration
cover/marketing helpers
agent/tool-loop system prompts
```

Do not change multiple unrelated families in one commit if they have independent behavior/tests.

- [ ] **Step 2: For each family, add/identify a structural contract test before translation**

The test must assert its exact existing structured keys/formats and relevant language-routing rule.

- [ ] **Step 3: Translate one family to English canonical**

Do not rewrite `prompt/<pack>/**` project overrides or imported user prompt packs.

- [ ] **Step 4: Run that family's tests and a real-model probe when the family creates durable/structured output**

Expected: parseable output, same schema, correct requested content language.

- [ ] **Step 5: Commit each independent family separately**

Use commit names such as:

```text
refactor(prompts): canonicalize Short prompts in English
refactor(prompts): canonicalize Play prompts in English
```

- [ ] **Step 6: Run prompt audit**

```powershell
pnpm audit:castor-machine-prompts
```

Expected: GREEN except occurrences explicitly classified as user/import/history/test data.

**HUMAN GATE P7:** Present remaining non-English occurrences and their allowed classifications.

---

### Task 8: Full cross-language, authority, and prompt-contract regression

**Files:**
- Modify only tests/audit allowlist if a demonstrated classification gap exists; no production prompt rewrites in this task.

**Interfaces:**
- Consumes: all migrated prompt families.
- Produces: verification package proving prompt-language migration preserved system contracts.

- [ ] **Step 1: Run all new prompt contract tests**

Run Foundation, planning, Writer, review, and each remaining family contract suite.

- [ ] **Step 2: Run Phase 4/5 authority partitions**

At minimum include:

```text
Foundation Publish
Arc Publish
Planning Gate + replan boundary
Human Direction/Authorization
Writer gate
chapter persistence
audit-failed Canon hotfix
State Review/Final Confirm
Task 25 legacy-v2 upgrade/recovery
Phase 5 acceptance
```

- [ ] **Step 3: Run repository verification**

```powershell
pnpm typecheck
pnpm build
pnpm test
pnpm audit:castor-identity
pnpm audit:castor-localization
pnpm audit:castor-machine-prompts
```

Report exact counts and known unrelated Windows EPERM/symlink baselines rather than hiding them.

- [ ] **Step 4: Verify the four-row language matrix at prompt-input level**

```text
vi-VN UI + English book => English story output contract
 en-US UI + Vietnamese book => Vietnamese story output contract
 vi-VN UI + Vietnamese book => Vietnamese story output contract
 en-US UI + English book => English story output contract
```

No row may alter authority state.

- [ ] **Step 5: Independent review**

Fresh reviewer must specifically search for:

```text
schema drift
translated enum/JSON keys
authority wording weakened or removed
UI locale leaking into story language
user prompt overrides rewritten
internal prompt leakage into prose
mechanical Chinese→English mistranslation with behavior impact
unclassified Castor-owned non-English prompts
```

Required: Critical 0 / Important 0.

**HUMAN GATE P8:** No real-user final acceptance until this verification package is accepted.

---

### Task 9: Real human-like Chapter 1 acceptance with a real provider

**Files:**
- No production modifications.
- Evidence only in untracked smoke/evidence locations or an explicitly approved evidence path.

**Interfaces:**
- Consumes: completed Plans 1–3.
- Produces: final black-box product acceptance report followed by read-only white-box evidence.

- [ ] **Step 1: Configure a real provider normally in Castor**

Use a temporary/controlled QA API key if possible. Never print or place it in prompts/log evidence.

- [ ] **Step 2: Set product locale to `vi-VN` and create a new English-language book through Castor Studio**

Use the previously approved real-user story brief for **The Clockmaker's Last Apprentice** or another Human-approved equivalent. Do not create files/API state manually.

- [ ] **Step 3: Black-box journey through the normal UI**

Exactly:

```text
Create Book
→ Foundation generation/review/Publish
→ Arc generation/Publish
→ Detailed Plan
→ Planning Gate / Human Direction if required
→ ONE deliberate Write Chapter action
→ Audit
→ Human State Review
→ Final Confirm
→ STOP
```

Do not generate Chapter 2.

- [ ] **Step 4: Record real-user evidence**

Record duration, visible provider/model, visible tokens/cost if available, errors/retries, UX friction, and full Chapter 1 quality review. Verify UI remains Vietnamese while story artifacts required by the English book are English.

- [ ] **Step 5: Perform read-only white-box verification after the journey**

Verify:

```text
one Chapter 1 only
one deliberate Writer path except any visible authorized retry
no Chapter 2
Canon unchanged before Final Confirm when evidence permits
Canon advances only through Human settlement
no early Authorization consumption
no internal prompt text/metadata leakage
Foundation/Plan/Chapter language follows book, not UI locale
```

- [ ] **Step 6: Produce final acceptance report and do not fix findings**

Classify findings Critical / Important / UX / Story Quality / Minor / Improvement. Any Critical or authority/data-integrity Important blocks acceptance and requires a separately authorized hotfix workflow.

**HUMAN GATE P9 — PLAN 3 / CASTOR MIGRATION ACCEPTANCE:** Stop. No push/tag/release unless the Human separately authorizes it.
