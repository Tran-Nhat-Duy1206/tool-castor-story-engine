# Castor Canonical Identity Migration Design

**Date:** 2026-08-29  
**Status:** AUTHORITATIVE DESIGN — Human approved. Implementation not started.  
**Repository:** `Tran-Nhat-Duy1206/tool-castor-story-engine`  
**Branch:** `feature/human-controlled-story-state-v1`

## 0. Decision

Castor Story Engine becomes the canonical product identity across source code, packages, CLI, configuration, runtime directories, environment variables, Studio, logs, diagnostics, documentation, examples, tests, and newly created user data.

InkOS remains only where required for:

1. historical attribution and AGPL notices;
2. one-way compatibility reads/migration of legacy InkOS project/config data;
3. tests and migration documentation that explicitly exercise legacy compatibility.

The normal Castor user experience must not expose InkOS branding or require InkOS commands.

The old `inkos` CLI command is removed. There is no deprecated runtime alias. Legacy compatibility is data/config compatibility, not a parallel CLI/product surface.

## 1. Product identity

Canonical product name:

- **Castor Story Engine**
- Short product name: **Castor**
- Web workbench: **Castor Studio**
- Diagnostics: **Castor Doctor**
- CLI executable: **`castor`**

Canonical workspace package identities:

- root private workspace: `castor-story-engine`
- `@actalk/castor-core`
- `@actalk/castor`
- `@actalk/castor-studio`

Canonical runtime/config identities:

- `castor.json`
- `.castor/`
- `CASTOR_*`
- `Castor/...` User-Agent and trace/product identifiers

New source code, tests, documentation, scripts, generated files, and runtime state must use the canonical Castor identity unless the code is explicitly implementing or testing legacy InkOS migration.

## 2. Attribution and project history

Castor is a substantially modified derivative work, not a claim that the codebase was authored from scratch.

The repository must preserve:

- the AGPL-3.0 license;
- Git history;
- existing upstream copyright/legal notices;
- a prominent derived-project notice identifying InkOS/Narcooo as the upstream origin;
- a prominent notice that Castor is a modified version maintained as an independent product.

The normal product may be branded entirely as Castor while the repository remains transparent about origin.

Recommended attribution wording:

> Castor Story Engine is a substantially modified and independently developed derivative of InkOS by Narcooo. Castor preserves the original project history, applicable copyright notices, and AGPL-3.0 obligations. The upstream InkOS code was not originally authored by the Castor maintainer.

Do not remove legally relevant notices merely to achieve a zero-string branding scan.

## 3. Scope boundary

This migration changes identity, namespace, configuration surface, compatibility loading, package wiring, documentation, and startup/product UX.

It MUST NOT redesign or alter the semantics of:

- Phase 4 Human-Governed Post-Chapter State Review;
- Phase 5 Foundation/Planning Intelligence;
- Canon authority boundaries;
- Foundation Publish semantics;
- Arc Publish semantics;
- Planning Gate semantics;
- Human Direction/Authorization semantics;
- Final Confirm settlement;
- one deliberate Write action producing at most one chapter;
- provider/model selection semantics;
- chapter prose or existing book Canon.

Behavioral changes discovered during migration are separate defects and require their own RED test and owner-level fix.

## 4. Pre-migration P0 baseline requirement

The current repository has a confirmed Studio startup regression: Studio imports governance APIs that Core defines but no longer re-exports from its public barrel.

Before broad identity migration begins, restore the missing Core public export boundary and establish a startup smoke test proving a fresh build can launch Castor Studio and bind its HTTP port.

This P0 repair is not part of the rename itself. It creates a known-good bootable baseline so migration regressions can be distinguished from pre-existing failures.

No broad rename may be used to hide or accidentally absorb this defect.

## 5. Package migration

Rename workspace package identities atomically across manifests, workspace dependencies, imports, scripts, publish-preparation utilities, tests, TypeScript configuration references, and lockfile metadata.

Required mapping:

```text
inkos                         -> castor-story-engine
@actalk/inkos-core            -> @actalk/castor-core
@actalk/inkos                 -> @actalk/castor
@actalk/inkos-studio          -> @actalk/castor-studio
```

The CLI package exposes only:

```json
{
  "bin": {
    "castor": "dist/index.js"
  }
}
```

Do not retain an `inkos` executable alias.

After package migration, production source imports must not depend on `@actalk/inkos-*` package names.

## 6. Configuration migration

### 6.1 Canonical config

New Castor projects use `castor.json` only.

Load order:

1. if `castor.json` exists, it is canonical;
2. otherwise, if `inkos.json` exists, treat it as legacy input and run one-way migration;
3. if both exist, `castor.json` wins and the loader must not silently merge competing authority/config values.

When both files exist and meaningful values conflict, surface a clear warning/diagnostic rather than silently reconciling them.

### 6.2 One-way migration

Migration from `inkos.json` must:

- parse and validate the legacy config;
- preserve provider/model/settings semantics;
- create a valid `castor.json` using the canonical schema;
- avoid mutating story Canon, Foundation, Arc, chapters, governance records, or execution snapshots;
- never overwrite an existing `castor.json` silently;
- be idempotent;
- report what was migrated without exposing secrets.

The legacy file may be retained as an untouched backup/source record unless a later explicit cleanup policy says otherwise. Castor must not keep writing updates to `inkos.json` after migration.

## 7. Runtime directory migration

Canonical project/user runtime directory becomes `.castor/`.

Legacy `.inkos/` is read only for compatibility/migration when `.castor/` does not yet contain the corresponding canonical state.

Rules:

- new projects create `.castor/`, never `.inkos/`;
- migration is one-way;
- an existing `.castor/` is never overwritten by `.inkos/` automatically;
- legacy import must preserve semantic content and relevant timestamps/provenance where practical;
- secrets are never echoed during migration;
- no story authority may be derived from runtime-cache migration.

## 8. Environment variables

All documented and newly emitted environment variables become `CASTOR_*`.

Example mapping:

```text
INKOS_STUDIO_PORT    -> CASTOR_STUDIO_PORT
INKOS_PROJECT_ROOT   -> CASTOR_PROJECT_ROOT
INKOS_SKILL_DIRS     -> CASTOR_SKILL_DIRS
...                  -> corresponding CASTOR_* name
```

Compatibility policy:

- `CASTOR_*` is authoritative;
- when the Castor variable is absent, a known legacy `INKOS_*` value may be read as a deprecated fallback;
- if both are present, Castor wins;
- conflicting dual definitions produce a non-secret warning;
- runtime/log output must refer to the Castor variable as the preferred setting;
- no new documentation should instruct users to set `INKOS_*` except the legacy migration guide.

The implementation must use an explicit compatibility map rather than unrestricted string substitution or wildcard environment copying.

## 9. CLI and user-facing branding

Every normal command/help/error/banner must use Castor branding.

Examples:

```text
castor studio
castor doctor
castor write next <book>
castor interact
Castor Studio
Castor Doctor
Starting Castor Studio on http://localhost:4567
```

Normal CLI help must not advertise `inkos` commands.

If a user invokes an old globally installed upstream `inkos` executable, that is outside Castor's new runtime compatibility contract. Castor is responsible for migrating legacy project data when invoked through `castor`, not for maintaining the upstream binary.

## 10. User-Agent, diagnostics, logs, telemetry labels, and generated metadata

Rename product-owned identifiers such as:

- InkOS user-agent strings;
- diagnostic headings;
- startup banners;
- trace producer/product labels;
- generated comments/headers that identify the current producer;
- internal error text that identifies the current product.

New values use Castor.

Historical persisted records that already contain InkOS provenance must not be rewritten merely for branding. Historical provenance is evidence, not active branding.

## 11. Documentation policy

README files, quick-start docs, examples, CLI examples, screenshots/captions, development instructions, and new specs must teach Castor-first usage.

InkOS may appear in documentation only for:

- the derived-project notice;
- license/history attribution;
- the legacy migration guide;
- comparison/history text where InkOS is genuinely the subject.

The README must not instruct new users to install or execute `@actalk/inkos` or `inkos` as the normal Castor workflow.

## 12. Legacy book compatibility

Legacy book content and authority are more important than naming cleanliness.

A legacy InkOS book opened by Castor must preserve, byte-for-byte where applicable:

- chapter prose;
- authoritative Foundation content/versions;
- Published Arc content/versions;
- `story/state/*.json` Canon values;
- Human review receipts;
- governance decisions/authorizations;
- execution snapshots/attempts;
- historical chapter files.

Identity migration must not create Human approval, Publish Foundation/Arc, consume Authorization, advance Canon, rewrite chapters, or alter historical settlement.

If a legacy book is incomplete/corrupt, migration fails closed with a diagnostic; it must not invent replacement authority.

## 13. New Castor project guarantee

A project created after migration must satisfy all of the following:

- created through `castor`/Castor Studio;
- canonical config is `castor.json`;
- runtime state/cache uses `.castor/`;
- normal environment/help references are `CASTOR_*`;
- workspace/runtime imports use Castor package names;
- logs and Studio use Castor branding;
- no new `inkos.json` or `.inkos/` is created;
- no normal user-facing InkOS command is required.

## 14. Migration architecture

Use explicit compatibility adapters rather than scattered special cases.

Recommended boundaries:

1. **Identity constants** — canonical product/package/config/runtime names.
2. **Legacy config adapter** — `inkos.json` -> validated Castor config.
3. **Legacy environment adapter** — explicit `INKOS_*` -> `CASTOR_*` fallback map.
4. **Legacy runtime adapter** — `.inkos/` -> `.castor/` migration/read compatibility.
5. **Migration diagnostics** — non-secret warnings and migration receipts/status.

Core business logic should consume canonical Castor-shaped configuration after these adapters run. It should not repeatedly branch on `inkos` vs `castor` throughout Foundation/Planning/Writer/Canon code.

## 15. Error handling

Migration errors must be actionable and fail closed.

Examples:

- invalid legacy config -> report exact field/category, do not create partial canonical config;
- conflicting `castor.json` + `inkos.json` -> use Castor, warn clearly, never merge silently;
- failed `.inkos/` migration -> leave legacy data intact and avoid half-written canonical state;
- permission/write failure -> leave original data intact;
- secret-bearing values -> redact in logs/reports;
- unsupported legacy shape -> stop with migration-required diagnostic rather than guessing.

Where multiple files must be migrated together, use atomic/staged file semantics consistent with existing repository safety patterns.

## 16. Testing strategy

### 16.1 Pre-migration startup gate

Before the identity migration:

- restore missing governance exports;
- clean build;
- launch Studio from the normal Castor entry;
- assert HTTP startup succeeds.

### 16.2 Package/compile contract

Tests must prove:

- all workspace dependencies use Castor package names;
- no production import uses `@actalk/inkos-*`;
- CLI exposes only `castor`;
- clean install/build/typecheck resolves all package edges.

### 16.3 Legacy config migration

Scenarios:

- only `inkos.json` -> creates equivalent `castor.json`;
- only `castor.json` -> no legacy path invoked;
- both identical -> Castor remains canonical;
- both conflicting -> Castor wins + warning;
- invalid legacy config -> no partial Castor file;
- migration replay -> idempotent;
- secrets never printed.

### 16.4 Environment compatibility

Scenarios:

- only `CASTOR_*` -> use it;
- only mapped `INKOS_*` -> compatibility fallback;
- both same -> Castor used;
- both conflicting -> Castor used + warning;
- unknown `INKOS_*` -> not copied magically.

### 16.5 Runtime directory migration

Scenarios:

- `.inkos/` only -> safe migration/read into `.castor/`;
- `.castor/` only -> no legacy mutation;
- both -> `.castor/` canonical, no merge;
- failure injection -> no partial canonical state and legacy preserved.

### 16.6 Legacy authority preservation

Open a real legacy fixture/book and verify hashes/semantic authority before and after migration:

- Foundation unchanged;
- Published Arc unchanged;
- Canon unchanged;
- chapters unchanged;
- receipts/authorizations unchanged;
- no new Human authority;
- no Canon advancement.

### 16.7 New Castor project

Create a new project through public Castor surfaces and verify no new InkOS-named config/runtime artifacts appear.

### 16.8 Real-user acceptance

After automated verification, rerun the previously defined real human-like browser test using a real configured provider:

Create Book -> Foundation -> Human Publish -> Arc Publish -> Detailed Plan -> Planning Gate -> Write exactly one Chapter -> Audit -> Human State Review -> Final Confirm.

This test must be black-box first and white-box read-only afterward.

## 17. Rename audit

At completion, perform a repository-wide case-sensitive and case-insensitive audit for:

```text
InkOS
inkos
INKOS_
@actalk/inkos
.inkos
inkos.json
```

Every remaining occurrence must be classified into exactly one approved bucket:

1. legal/attribution/history;
2. legacy compatibility implementation;
3. legacy compatibility test/fixture/documentation.

Any remaining occurrence outside those buckets blocks completion.

Generated build output is regenerated from canonical source and is not hand-edited.

## 18. Versioning and release

This migration is large enough to justify a distinct Castor release milestone, but implementation completion does not itself authorize release.

No implementation task may:

- push;
- create a tag;
- publish npm packages;
- create a release;
- start Phase 6.

Release/tag/publish remain separate Human-authorized actions after:

- automated migration acceptance;
- legacy compatibility acceptance;
- clean Castor startup;
- real-user Chapter 1 acceptance;
- independent review with zero Critical/Important findings.

## 19. Non-goals

This migration does not:

- claim Castor was written from scratch;
- remove required upstream attribution;
- change AGPL licensing obligations;
- redesign story governance;
- add Phase 6 autonomous multi-chapter writing;
- change story quality prompts merely because names changed;
- migrate or rewrite story prose for branding;
- keep an `inkos` CLI alias;
- maintain old `@actalk/inkos-*` workspace package identities as production aliases.

## 20. Acceptance criteria

The migration is technically complete only when all are true:

1. Castor Studio boots from a clean build.
2. Root/package identities are Castor canonical.
3. Production workspace imports use `@actalk/castor-*` only.
4. CLI exposes `castor` only.
5. New config/runtime identifiers are `castor.json`, `.castor/`, `CASTOR_*`.
6. Legacy `inkos.json`, `.inkos/`, and mapped `INKOS_*` inputs can be consumed/migrated safely.
7. A new Castor project creates no new InkOS-named artifacts.
8. A legacy InkOS project migrates without Canon/Foundation/Arc/chapter/authority mutation.
9. All normal user-facing UI/help/logs/docs identify Castor.
10. Remaining InkOS strings are limited to attribution/history/legacy compatibility buckets.
11. Existing Phase 4/5 authority invariants remain green.
12. Real-provider black-box Chapter 1 acceptance completes successfully.
13. Independent review reports Critical 0 / Important 0.
14. No push/tag/release occurs without separate Human approval.

## 21. Localization and language architecture

### 21.1 Product locale policy

Castor supports exactly two active product locales in this migration milestone:

- `vi-VN` — default locale;
- `en-US` — user-selectable English locale.

Active Chinese (`zh`, `zh-CN`, Chinese-first navigation/help/docs) is removed from normal product surfaces for this milestone.

This does not require deleting historical Chinese text from upstream history, fixtures, archived documentation, or compatibility tests when that text is evidence or required for regression coverage.

### 21.2 UI locale is independent from book language

The following invariant is mandatory:

```text
UI locale != Book language
```

Examples:

```text
UI locale: vi-VN
Book language: en
=> Studio/CLI labels are Vietnamese, generated chapter prose remains English.
```

```text
UI locale: en-US
Book language: vi
=> Studio/CLI labels are English, generated chapter prose remains Vietnamese.
```

Changing product locale must never mutate:

- book language;
- Foundation language/meaning;
- Arc/Plan authority;
- Canon;
- prompt language selection for book output;
- chapter prose;
- Authorization or Human decisions.

Book output language remains an explicit per-book/story concern.

### 21.3 User-facing localization boundary

Localize normal user-facing product surfaces, including where applicable:

- Castor Studio navigation, forms, buttons, labels, tooltips, empty states, dialogs, banners, progress text, validation text, and recoverable error messages;
- CLI help, command descriptions, common status/progress output, and user-actionable errors;
- Castor Doctor headings and actionable diagnostics;
- TUI menus/help/statuses where retained;
- onboarding/setup text;
- normal documentation and quick-start instructions.

Do not localize source identifiers, function names, TypeScript types, JSON schema property names, protocol keys, machine event IDs, status enum values, file format keys, or API contracts merely to make the source look Vietnamese.

Source code and machine-readable contracts remain English.

### 21.4 Localization implementation shape

Do not scatter hard-coded Vietnamese/English pairs across components.

Use a centralized locale catalog with stable semantic keys, conceptually:

```text
locales/
  vi-VN.json
  en-US.json
```

Example semantic keys:

```text
book.create
foundation.publish
arc.publish
chapter.write
review.stateReview
review.finalConfirm
provider.notConfigured
studio.startupFailure
```

Product code calls a translation resolver such as `t("chapter.write")` rather than embedding duplicate language conditionals.

Locale fallback order:

1. explicit saved user preference;
2. explicit project/session preference when a surface supports it;
3. `vi-VN` default.

Missing translation keys must fail visibly in development/test and must not silently display unrelated Chinese fallback strings.

### 21.5 Locale persistence

Studio locale preference is user/product preference, not story authority.

It may be persisted in a non-Canon Castor preference/config location.

Changing locale must not dirty story Canon or generate a new Foundation/Arc/Plan revision.

CLI may support an explicit locale preference/config and `CASTOR_LOCALE` with allowed values `vi-VN` and `en-US`.

If an unsupported locale is supplied, fail to `vi-VN` with an actionable warning rather than guessing.

### 21.6 Documentation languages

Canonical documentation targets for this milestone:

- `README.md` — Vietnamese-first;
- `README.en.md` — English.

Chinese/Japanese active README navigation may be removed if it is no longer maintained.

Historical/upstream references may remain when needed for attribution or migration documentation.

New user documentation should not default to Chinese.

### 21.7 Machine prompts

Production machine-facing prompts should converge on English as the canonical maintenance language where practical.

The goal is:

```text
User-facing product language: vi-VN / en-US
Machine prompt contract language: English canonical
Book output language: per-book setting
```

Chinese production prompts must not be mechanically translated and committed in bulk without behavior verification.

Each prompt family migrated from Chinese to English requires:

- preservation of required schema/format instructions;
- preservation of authority and safety semantics;
- preservation of language-routing behavior for the target book;
- targeted regression/golden tests where existing tests support them;
- real-model verification for high-risk Planner/Writer/Auditor contracts.

Prompt-language migration must be staged independently from package/config rename checkpoints so failures can be attributed correctly.

### 21.8 Prompt output-language invariant

English canonical machine prompts must still instruct the model to honor the book's configured language.

The implementation must not infer output language from Studio locale.

At minimum verify:

- `vi-VN` UI + English book => English Foundation/Plan/Chapter where book contract requires English;
- `en-US` UI + Vietnamese book => Vietnamese Foundation/Plan/Chapter where book contract requires Vietnamese.

### 21.9 Chinese active-surface removal

Remove Chinese from active normal surfaces such as:

- Studio navigation and dialogs;
- CLI/TUI help and product banners;
- Doctor/user-facing diagnostics;
- default README/quick-start flow;
- new-book templates intended for normal users;
- active locale selector/options.

Do not delete Chinese blindly from:

- historical Git content;
- upstream attribution;
- legacy fixtures;
- tests whose purpose is multilingual/legacy compatibility;
- story data explicitly authored in Chinese;
- imported user content.

Castor must continue to treat user-authored Chinese story/reference content as data, not as obsolete product branding.

## 22. Localization testing strategy

### 22.1 Studio locale tests

Verify the same representative Studio journey in both locales:

```text
vi-VN:
Create Book -> Foundation -> Arc -> Plan -> Write -> Audit -> State Review -> Final Confirm
```

All product-owned visible labels/messages in the tested journey are Vietnamese except proper nouns, technical identifiers intentionally exposed, model/user content, and legal attribution.

Repeat with `en-US` and verify equivalent English UI.

### 22.2 Cross-language independence matrix

Required matrix:

| UI locale | Book language | Expected product UI | Expected story output |
|---|---|---|---|
| `vi-VN` | English | Vietnamese | English |
| `en-US` | Vietnamese | English | Vietnamese |
| `vi-VN` | Vietnamese | Vietnamese | Vietnamese |
| `en-US` | English | English | English |

No row may change authority semantics.

### 22.3 Locale persistence tests

Verify:

- default first launch is `vi-VN`;
- switching to `en-US` persists across Studio restart;
- locale switch does not modify book files/Canon;
- unsupported locale fails safely to `vi-VN` with warning;
- `CASTOR_LOCALE` works for CLI where applicable.

### 22.4 Translation completeness audit

For active Studio/CLI/Doctor locale keys:

- every required key exists in `vi-VN`;
- every required key exists in `en-US`;
- no active key falls back to Chinese;
- no user-facing raw translation key is displayed.

### 22.5 Chinese surface audit

Perform repository/runtime scans for active product Chinese strings and classify each occurrence.

Allowed remaining Chinese categories:

1. user-authored/imported story data;
2. historical/upstream attribution/reference;
3. legacy/multilingual fixture or test data;
4. machine prompt pending an explicitly staged, tested prompt migration checkpoint.

Any Chinese string in an active normal UI/help/Doctor/default-doc surface outside those buckets blocks localization completion.

### 22.6 Prompt migration verification

For every high-risk prompt family converted to English canonical, verify at least:

- structured output/schema compatibility;
- output language routing;
- no authority instruction regression;
- no internal instruction leakage into prose;
- representative real-model execution where cost permits.

Planner, Writer, Auditor/Reviewer, Foundation generation/review, and State Review extraction are high-risk families.

## 23. Localization non-goals

Localization does not:

- translate TypeScript identifiers or JSON protocol keys into Vietnamese;
- force all books to Vietnamese;
- remove the ability to write Chinese user-authored stories if the existing book-language system supports them;
- claim Chinese source/history never existed;
- combine prompt rewrites with unrelated story-quality redesign;
- change Human authority semantics;
- make UI locale part of Canon.

The active product locale set is `vi-VN` and `en-US`; supported story languages remain a separate capability and may be broader.

## 24. Extended acceptance criteria

In addition to Section 20, completion of the Castor identity/localization migration requires:

1. `vi-VN` is the default product locale.
2. `en-US` can be selected and persists as a user preference.
3. Active normal Studio/CLI/Doctor surfaces have no Chinese default UI.
4. `README.md` is Vietnamese-first and `README.en.md` is English.
5. UI locale changes do not modify book language or Canon.
6. The four-row UI-locale/book-language matrix passes.
7. Production machine prompts targeted by this milestone are English canonical or explicitly documented as pending a staged prompt-migration checkpoint; no unreviewed mechanical translation is accepted.
8. Chinese story/imported user content remains valid data and is not deleted by branding/localization cleanup.
9. Translation catalogs are complete for representative production journeys in both locales.
10. Real-user Chapter 1 acceptance is executed at least once with `vi-VN` UI and an English-language book to prove UI/output separation.
11. Independent review reports Critical 0 / Important 0 for the localization boundary.
12. No push/tag/release occurs without separate Human approval.
