# Castor Vietnamese-English UI Localization Implementation Plan

> **For Duy:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `vi-VN` the default active product locale, add a persistent `en-US` switch, remove Chinese from active normal product surfaces, and guarantee UI locale never changes book output language or story authority.

**Architecture:** Introduce a centralized localization layer for product-owned strings, persist locale as non-Canon user/product preference, then migrate Studio/CLI/Doctor/TUI surfaces in slices. Keep source identifiers and machine contracts English. The localization layer must sit above story/governance logic and must never become an input to Canon or book-language authority.

**Tech Stack:** TypeScript, React/Vite Studio, Node CLI/TUI, Vitest, Playwright where existing, JSON/TS locale catalogs.

**Authoritative spec:** `docs/superpowers/specs/2026-08-29-castor-canonical-identity-migration-design.md`, Sections 21–24.

**Dependency:** Plan 1 (`2026-08-29-castor-identity-legacy-migration.md`) must be Human-accepted first so active product/package identity is already Castor.

---

## Execution rules

- Default locale: `vi-VN`.
- Supported active product locales for this milestone: `vi-VN`, `en-US` only.
- `UI locale != Book language` is a hard invariant.
- Locale changes may not mutate book files, Foundation, Arc, Plan, Canon, Human Direction/Authorization, Final Confirm receipts, or chapter prose.
- Do not translate TypeScript identifiers, JSON schema keys, protocol keys, enum/status values, machine event IDs, or file-format fields.
- Do not delete Chinese user-authored/imported story data.
- Do not push/tag/release or start Phase 6.
- One checkpoint at a time; Human gate between checkpoints.

## Checkpoint L0 — Inventory active user-facing language surfaces

### Task L0.1 — Build a localization inventory

**Create:** `docs/migrations/castor-localization-inventory.md`

Scan active code/docs:

```powershell
rg -n --hidden --glob '!node_modules' --glob '!dist' --glob '!.git' '[\p{Han}]' packages README*.md docs scripts
rg -n --hidden --glob '!node_modules' --glob '!dist' --glob '!.git' '|zh-CN|\bzh\b' packages README*.md docs scripts
```

Classify strings into:

```text
STUDIO-ACTIVE
CLI-ACTIVE
DOCTOR-ACTIVE
TUI-ACTIVE
DOC-ACTIVE
PROMPT-MACHINE
USER-DATA/FIXTURE
HISTORICAL/ATTRIBUTION
LEGACY-COMPAT
```

Do not modify production code during inventory.

### Task L0.2 — Define representative journeys

Record the exact visible strings/screens for these journeys so later completeness can be tested:

```text
Studio startup
Create Book
Foundation review/publish
Arc publish
Chapter Plan/Gate
Write progress
Audit
State Review
Final Confirm
Provider/settings
Common startup/provider errors
Doctor output
CLI --help
```

**HUMAN GATE L0:** Review inventory and decide any ambiguous Chinese text that may be active machine prompt vs active UI. Plan 3 owns machine prompts.

---

## Checkpoint L1 — Introduce the locale core and non-Canon preference persistence

### Task L1.1 — Write RED locale resolver tests

**Create:** a locale test module at the nearest shared UI/config location discovered in L0. If no shared module exists, use:

- `packages/studio/src/i18n/__tests__/i18n.test.ts`
- `packages/studio/src/i18n/index.ts`

Required RED cases:

```text
default locale => vi-VN
explicit vi-VN => vi-VN
explicit en-US => en-US
unsupported locale => vi-VN + actionable warning
missing key in active locale => test/dev-visible failure, not Chinese fallback
```

### Task L1.2 — Add centralized catalogs

**Create:**
- `packages/studio/src/i18n/locales/vi-VN.json`
- `packages/studio/src/i18n/locales/en-US.json`
- `packages/studio/src/i18n/index.ts`

Start with shared foundational keys only, e.g.:

```text
app.name
nav.books
book.create
common.save
common.cancel
common.retry
foundation.publish
arc.publish
chapter.write
review.stateReview
review.finalConfirm
provider.notConfigured
studio.startupFailure
```

Use semantic keys; do not encode language into key names.

### Task L1.3 — Persist Studio locale outside Canon

Inspect current Studio preferences/settings ownership. Add locale preference to a non-story/non-Canon preference location.

Required tests:

- first launch => `vi-VN`;
- switch `en-US`, restart => remains `en-US`;
- locale switch produces no diff under book story/Canon directories;
- switching locale does not create Foundation/Arc/Plan revisions.

If no suitable preference store exists, create the smallest product-preference store under `.castor/` or existing global settings ownership established by Plan 1; do not put locale inside book Canon.

### Task L1.4 — Add Studio language switch control

Place a normal locale switch in an existing settings/profile location; do not redesign navigation solely for localization.

User labels:

```text
Tiếng Việt
English
```

The switch updates the active UI immediately or on an explicitly documented reload if the current architecture cannot safely hot-switch. Prefer immediate update if straightforward.

Run narrow tests → GREEN.

**HUMAN GATE L1:** Human verifies switch behavior and confirms book files/Canon remain unchanged.

---

## Checkpoint L2 — Localize the core Studio story journey

### Task L2.1 — Add translation completeness test for the core journey

**Create/extend:** `packages/studio/src/i18n/__tests__/catalog-completeness.test.ts`

Define the required key set for the core long-form journey and assert both catalogs contain every key.

The test must fail if a raw semantic key would be shown to users.

### Task L2.2 — Convert core Studio surfaces from hard-coded strings

Modify the actual components discovered in L0 for:

```text
Create Book
Foundation draft/review/publish
Arc plan/review/publish
Detailed Chapter Plan
Planning Gate
Human Direction/Authorization controls
Write Chapter progress/status
Audit result
Human State Review
Final Confirm
```

Use `t("...")`; do not duplicate `locale === "vi-VN" ? ... : ...` conditionals across components.

Do not translate model-generated content, user story text, proper nouns, internal enum values that are intentionally machine-facing, or story-language output.

### Task L2.3 — Add two-locale component/integration tests

For representative screens, render once with `vi-VN` and once with `en-US` and assert visible labels correspond to the selected locale.

Where current Studio already has Playwright E2E, add a minimal locale-switch journey:

```text
launch default => Vietnamese labels visible
switch English => equivalent English labels visible
reload => English persists
```

Run relevant Studio unit/integration/E2E tests.

**HUMAN GATE L2:** Human browser-checks the full core story journey in both locales before moving to peripheral surfaces.

---

## Checkpoint L3 — Localize provider/settings, errors, progress, and startup surfaces

### Task L3.1 — Inventory and test user-actionable errors

From L0, select common product-owned errors such as:

```text
provider missing
API key missing
provider timeout
malformed response
startup failure
save failure
migration warning
retry/cancel/status messages
```

Add catalog keys and tests proving both locales have translations.

Never localize raw provider payloads by string replacement; wrap them with localized context while preserving technical details where useful.

### Task L3.2 — Convert settings/onboarding/provider surfaces

Update Studio provider/model/settings/onboarding UI to catalog-based strings.

Sensitive values must never enter translation interpolation logs.

### Task L3.3 — Convert startup/progress/validation UI

Migrate loading/progress banners, validation messages, empty states, confirmation dialogs, and recoverable errors discovered in L0.

Run Studio tests and locale completeness audit.

**HUMAN GATE L3:** Verify a real provider configuration screen and at least one safe simulated failure in both locales.

---

## Checkpoint L4 — Localize CLI, Doctor, and TUI active surfaces

### Task L4.1 — Add a shared or CLI-specific locale resolver

Prefer reusing a package-neutral locale utility if Plan 1 architecture makes that clean. Otherwise use a CLI-owned resolver; do not make CLI depend on browser-specific Studio code.

Support:

```text
CASTOR_LOCALE=vi-VN
CASTOR_LOCALE=en-US
```

Resolution order should follow the spec: explicit CLI/product preference → environment where applicable → `vi-VN` default.

### Task L4.2 — Write RED CLI locale tests

Test at least:

```text
castor --help default => Vietnamese product-owned descriptions
CASTOR_LOCALE=en-US castor --help => English descriptions
unsupported locale => Vietnamese + warning
castor doctor default => Vietnamese headings/actions
English doctor => English headings/actions
```

Keep command names/options stable; only user-facing descriptions/messages localize.

### Task L4.3 — Migrate CLI/Doctor/TUI strings

Modify active CLI/TUI/Doctor code discovered in L0. Preserve machine-readable `--json` output field names/status keys in English unless an existing contract explicitly treats message text as localized display content.

Run CLI/TUI/Doctor tests → GREEN.

**HUMAN GATE L4:** Human checks normal PowerShell `castor --help` and `castor doctor` in both locales.

---

## Checkpoint L5 — Make docs Vietnamese-first + English and remove active Chinese navigation

### Task L5.1 — Rewrite active README structure

**Modify:**
- `README.md` → Vietnamese-first canonical README.
- `README.en.md` → English canonical README.

Keep prominent AGPL/upstream derived-project attribution in both.

Remove active Chinese/Japanese navigation if those docs are no longer maintained. Do not delete historical files solely for visual cleanliness unless they are explicitly obsolete active docs and Human-approved for removal.

### Task L5.2 — Convert normal quick-start/developer docs

Using L0 inventory, update active docs users are expected to follow. Keep code commands/config names exactly canonical Castor names from Plan 1.

Do not translate source identifiers or example JSON keys.

### Task L5.3 — Add docs language audit

Add/extend a script test so canonical default docs do not contain unexplained active Chinese UI/instruction blocks.

Allowed Chinese in default docs only where quoting/importing/history genuinely requires it.

**HUMAN GATE L5:** Human reviews README Vietnamese wording and English counterpart before acceptance.

---

## Checkpoint L6 — Prove UI locale and book language are independent

### Task L6.1 — Add cross-language matrix tests

Use existing book-language configuration APIs/fixtures. Test all four rows:

| UI locale | Book language | UI expectation | Story-language expectation |
|---|---|---|---|
| vi-VN | English | Vietnamese | English |
| en-US | Vietnamese | English | Vietnamese |
| vi-VN | Vietnamese | Vietnamese | Vietnamese |
| en-US | English | English | English |

At automated-test level, assert locale does not alter the book language field/contract passed into Foundation/Planner/Writer.

### Task L6.2 — Add Canon non-mutation regression

For an existing governed v2 fixture:

1. hash/serialize Canon/Foundation/Arc/Plan state;
2. switch locale vi → en → vi;
3. verify all authoritative story artifacts byte/semantic-equivalent;
4. verify no Human decision/Authorization receipt created;
5. verify no revision increments solely from locale changes.

### Task L6.3 — Real-browser smoke without expensive writing

Open an existing disposable book and switch locales. Verify UI changes but displayed story text remains the same language/content.

Commit cross-language invariant tests.

**HUMAN GATE L6:** Required before any machine-prompt migration.

---

## Checkpoint L7 — Remove active Chinese product surfaces and run localization acceptance

### Task L7.1 — Add localization audit script

**Create:** `scripts/audit-castor-localization.mjs`

Audit active product source/default docs for Chinese/Han strings. Use explicit allowlists for:

```text
user/import fixtures
historical/upstream attribution
legacy compatibility fixtures/docs
machine prompts pending Plan 3
```

Do not globally allow all `prompt/` if some prompt-owned visible user strings exist; classify precisely.

Add root script:

```json
"audit:castor-localization": "node scripts/audit-castor-localization.mjs"
```

### Task L7.2 — Run full localization verification

Run:

```powershell
pnpm typecheck
pnpm build
pnpm test
pnpm audit:castor-identity
pnpm audit:castor-localization
```

Report exact package partitions and known unrelated Windows failures if any.

### Task L7.3 — Two-locale Studio acceptance

Using normal Studio startup:

1. first launch/default `vi-VN`;
2. traverse representative Create Book → Foundation/Arc/Plan/Write controls without necessarily making paid model calls;
3. switch `en-US` and traverse same surfaces;
4. restart Studio and verify preference persistence;
5. verify no active Chinese product labels in these journeys.

### Task L7.4 — Independent review

Fresh reviewer checks:

```text
hard-coded active UI language bypassing catalogs
Chinese fallback leakage
locale stored in Canon/book files
locale changing book output language
enum/protocol keys accidentally translated
raw provider secrets in localized errors
incomplete vi/en catalogs
```

Required: Critical 0 / Important 0.

### Task L7.5 — Final report

Report commits/checkpoints, key counts per locale, UI coverage, CLI/Doctor coverage, Chinese audit classifications, cross-language matrix, Canon non-mutation proof, exact tests, and worktree state.

Do not push/tag/release.

**HUMAN GATE L7 — PLAN 2 ACCEPTANCE:** Stop. Plan 3 begins only after Human accepts localization infrastructure and active surfaces.
