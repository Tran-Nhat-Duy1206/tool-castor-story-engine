# Castor Identity and Legacy Migration Implementation Plan

> **For Duy:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Castor the only canonical active product identity while preserving safe one-way compatibility for legacy InkOS config/runtime data and preserving all Phase 4/5 authority semantics.

**Architecture:** Establish a known-good bootable baseline first, then migrate package/CLI identity, introduce explicit Castor identity/legacy adapters at configuration boundaries, and finally remove active InkOS branding. Core story/governance logic receives canonical Castor-shaped inputs; compatibility logic stays at the edges and may never create Human authority or mutate Canon merely because a project was renamed.

**Tech Stack:** TypeScript, pnpm workspaces, Node.js >=22, Vitest, Studio server/client, existing atomic file helpers and Phase 4/5 governance tests.

**Authoritative spec:** `docs/superpowers/specs/2026-08-29-castor-canonical-identity-migration-design.md`, Sections 0–20 and 24. This plan implements identity/package/config/runtime/env migration only. Localization is Plan 2; machine-prompt language migration is Plan 3.

---

## Execution rules

- Work only on branch `feature/human-controlled-story-state-v1` unless the Human explicitly authorizes another branch.
- Use RED → GREEN → REFACTOR for every behavioral change.
- One checkpoint at a time. Inside a checkpoint, fix ordinary test/type/import failures autonomously; stop for architecture/spec conflict, scope expansion, authority ambiguity, repeated failed fixes, or an unclassifiable regression.
- **Autonomous inside the checkpoint, human-controlled between checkpoints.**
- Never change Foundation/Arc Publish semantics, Planning Gate semantics, Human Direction/Authorization authority, Final Confirm settlement, Canon semantics, or one deliberate Write → at most one chapter.
- Never bulk search/replace `inkos` blindly. Every remaining InkOS occurrence must end in an approved attribution/history/legacy-compatibility bucket.
- Do not push, tag, publish npm packages, create a release, or start Phase 6.
- Preserve existing untracked smoke evidence unless the Human explicitly asks to delete/archive it.

## Checkpoint 0 — Repair the pre-existing Studio startup P0 and establish a boot baseline

### Task 0.1 — Record baseline and reproduce the named-export failure

**Read:**
- `packages/core/src/index.ts`
- `packages/core/src/governance/authorizations.ts`
- `packages/studio/src/api/server.ts`
- `packages/cli/src/index.ts`

**Step 1: Record the starting commit and tracked status.**

Run:

```powershell
git rev-parse HEAD
git status --short
```

Expected: record the HEAD. Do not delete unrelated untracked smoke files.

**Step 2: Reproduce the clean startup failure before changing production code.**

Run:

```powershell
pnpm build
pnpm --filter @actalk/inkos-core build
pnpm --filter @actalk/inkos-studio build
node packages/cli/dist/index.js studio
```

Expected on the pre-fix baseline: startup fails before the Studio server binds, with an ESM named-export error equivalent to:

```text
SyntaxError: The requested module '@actalk/inkos-core' does not provide an export named 'confirmAuthorization'
```

If the exact baseline no longer reproduces, STOP and investigate before applying the documented fix; do not assume the report is still current.

### Task 0.2 — Add RED public-boundary regression tests

**Create:** `packages/core/src/__tests__/governance-public-exports.test.ts`

Test the public barrel import, not the implementation module. Import these names from `../index.js` and assert each is a function:

```text
confirmAuthorization
createAuthorization
listAuthorizations
confirmHumanDirection
parseHumanDirectionDraft
getHumanDirections
resolveDirectionConflict
```

Run:

```powershell
pnpm --filter @actalk/inkos-core test -- governance-public-exports.test.ts
```

Expected RED: one or more public exports are missing/undefined or module import fails.

### Task 0.3 — Add a RED Studio startup contract test

**Create:** `packages/studio/src/api/__tests__/startup-smoke.test.ts`

The test must load the built/server entry through the normal package boundary or launch the server on an ephemeral/test port and assert it becomes reachable. It must fail on a missing Core named export before the fix.

Do not mock the Core barrel in this test.

Run the narrow test with the Studio package's existing Vitest configuration, e.g.:

```powershell
pnpm --filter @actalk/inkos-studio test -- startup-smoke.test.ts
```

If the current Studio test layout requires a different exact path/command, use the package's existing test convention; keep the test purpose unchanged.

Expected RED: server import/start fails at the public package boundary.

### Task 0.4 — Restore the exact missing Core public export block

**Modify:** `packages/core/src/index.ts`

Before editing, inspect the known-good historical export shape:

```powershell
git show c11ba6e2:packages/core/src/index.ts | Select-String -Pattern 'authorizations' -Context 3,12
git show d22d71f1 -- packages/core/src/index.ts
```

Restore the public exports from `./governance/authorizations.js` required by current consumers. Do not rename functions or invent a new governance API.

Run:

```powershell
pnpm --filter @actalk/inkos-core test -- governance-public-exports.test.ts
pnpm --filter @actalk/inkos-studio test -- startup-smoke.test.ts
pnpm --filter @actalk/inkos-core typecheck
pnpm --filter @actalk/inkos-studio typecheck
```

Expected GREEN.

### Task 0.5 — Verify a real normal startup

Run:

```powershell
pnpm build
node packages/cli/dist/index.js studio
```

In a second PowerShell window, verify the announced Studio URL actually answers. If the normal port is 4567:

```powershell
Invoke-WebRequest http://127.0.0.1:4567 -UseBasicParsing | Select-Object StatusCode
```

Expected: HTTP success and a living process, not merely a printed "Starting" banner.

Stop the server normally afterward.

### Task 0.6 — Regression slice and commit

Run the directly affected Phase 5 governance/Studio tests, plus Core/Studio build and typecheck. At minimum include the existing Human Direction/Authorization, State Review/Confirm, and chapter persistence suites that consume the public boundary.

Commit only this P0 repair:

```powershell
git add packages/core/src/index.ts packages/core/src/__tests__/governance-public-exports.test.ts packages/studio/src/api/__tests__/startup-smoke.test.ts
git commit -m "fix(core): restore governance public exports for studio startup"
```

**HUMAN GATE 0:** Report starting/final HEAD, exact tests, real startup evidence, diff summary, and independent review. Required before broad identity migration: Critical 0, Important 0. Do not continue until Human approval.

---

## Checkpoint 1 — Build a complete InkOS identity inventory and freeze the migration boundary

### Task 1.1 — Generate a repository-wide inventory

**Create:** `docs/migrations/castor-identity-inventory.md`

Run from repo root:

```powershell
rg -n --hidden --glob '!node_modules' --glob '!dist' --glob '!.git' 'InkOS|inkos|INKOS_|@actalk/inkos|\.inkos|inkos\.json' .
```

Classify every occurrence into exactly one of:

```text
ACTIVE-PACKAGE
ACTIVE-CLI
ACTIVE-CONFIG
ACTIVE-RUNTIME
ACTIVE-ENV
ACTIVE-UI-LOG
ACTIVE-DOC
LEGAL-ATTRIBUTION
LEGACY-COMPAT
LEGACY-TEST-FIXTURE
HISTORICAL-PROVENANCE
```

The inventory must include at least the currently known active package surfaces:

- `package.json`
- `packages/core/package.json`
- `packages/cli/package.json`
- `packages/studio/package.json`
- `pnpm-lock.yaml`
- `scripts/prepare-package-for-publish.mjs`
- `scripts/restore-package-json.mjs`
- `scripts/verify-no-workspace-protocol.mjs`
- production imports using `@actalk/inkos-*`
- `inkos.json` readers/writers
- `.inkos/` readers/writers
- `INKOS_*` readers/writers
- user-agent/product banners/Doctor strings
- README/docs references.

Do not edit production code during the inventory task.

### Task 1.2 — Turn inventory into executable acceptance checks

**Create:** `scripts/audit-castor-identity.mjs`

The script should scan tracked production/user-facing files and fail if an InkOS occurrence remains outside explicit allowlisted paths/categories. The allowlist may include:

- `LICENSE` / legal notices;
- derived-project attribution sections;
- explicit legacy migration modules;
- legacy migration tests/fixtures/docs.

Do not globally ignore whole production directories.

**Create:** `scripts/__tests__/audit-castor-identity.test.mjs` if the repository already tests Node scripts; otherwise add a deterministic fixture-driven test in the nearest existing script-test convention.

RED first: current repo should fail the active-identity audit.

Add root script in `package.json`:

```json
"audit:castor-identity": "node scripts/audit-castor-identity.mjs"
```

Do not make the audit GREEN yet by over-broad allowlisting.

Commit the inventory/audit harness separately.

**HUMAN GATE 1:** Present the inventory counts by category and any ambiguous occurrences. Stop if any occurrence cannot be classified without an architecture decision.

---

## Checkpoint 2 — Rename workspace packages and CLI identity atomically

### Task 2.1 — Write RED package-identity contract tests

**Create:** `scripts/__tests__/castor-package-identity.test.mjs` (or nearest existing script-test location).

Test the manifests as data. Required post-migration assertions:

```text
root package name == castor-story-engine
packages/core name == @actalk/castor-core
packages/cli name == @actalk/castor
packages/studio name == @actalk/castor-studio
CLI bin keys == [castor]
no workspace dependency name begins @actalk/inkos
```

Run it before changing manifests and record RED.

### Task 2.2 — Rename package manifests

**Modify:**
- `package.json`
- `packages/core/package.json`
- `packages/cli/package.json`
- `packages/studio/package.json`

Required mapping:

```text
inkos                -> castor-story-engine
@actalk/inkos-core   -> @actalk/castor-core
@actalk/inkos        -> @actalk/castor
@actalk/inkos-studio -> @actalk/castor-studio
```

In `packages/cli/package.json`, remove the `inkos` bin entry completely; retain only `castor`.

Update workspace filter scripts to the Castor package names.

### Task 2.3 — Rename all workspace package imports and script references

Use the inventory, not an unreviewed blanket replacement. Update production/test imports and package filters from `@actalk/inkos-*` to `@actalk/castor-*`.

Known consumers include:

- `packages/studio/src/api/server.ts`
- CLI production code under `packages/cli/src/**`
- package/test code importing the Core public barrel
- package-preparation and verification scripts.

After edits, run:

```powershell
rg -n --hidden --glob '!node_modules' --glob '!dist' '@actalk/inkos' packages scripts package.json pnpm-workspace.yaml
```

Expected: only explicit legacy compatibility/test/attribution references, ideally none in workspace package wiring.

### Task 2.4 — Regenerate lockfile and verify clean package graph

Run:

```powershell
pnpm install --lockfile-only
pnpm --filter @actalk/castor-core build
pnpm --filter @actalk/castor-studio build
pnpm --filter @actalk/castor build
pnpm typecheck
```

Expected: package graph resolves only through Castor workspace names.

Run the RED package-identity test again; expected GREEN.

### Task 2.5 — Verify CLI exposes only `castor`

Build the CLI and inspect its manifest/bin behavior:

```powershell
pnpm --filter @actalk/castor build
node packages/cli/dist/index.js --help
```

If the repo has a local bin/link test convention, add/extend it so `castor --help` works from a packed/local workspace package and no Castor package manifest publishes an `inkos` executable alias.

Commit package/CLI identity atomically.

**HUMAN GATE 2:** Report package graph, lockfile diff, CLI bin proof, build/typecheck results, and identity-audit delta. Critical 0 / Important 0 required before config migration.

---

## Checkpoint 3 — Introduce canonical Castor identity constants and one-way `inkos.json` → `castor.json` migration

### Task 3.1 — Locate current config ownership before editing

Run:

```powershell
rg -n --hidden --glob '!node_modules' --glob '!dist' 'inkos\.json|configSource|set-global|Global Config|project config' packages scripts
```

Record the exact current config loader/writer paths in `docs/migrations/castor-identity-inventory.md` before edits. Do not duplicate config ownership into a new subsystem if an existing config module already owns it.

### Task 3.2 — Add canonical identity constants at the configuration boundary

**Create or extend the existing config/identity module discovered in Task 3.1.** If no suitable shared module exists, create:

`packages/core/src/config/product-identity.ts`

with canonical constants such as:

```ts
export const CASTOR_PRODUCT_NAME = "Castor Story Engine";
export const CASTOR_CONFIG_FILENAME = "castor.json";
export const LEGACY_INKOS_CONFIG_FILENAME = "inkos.json";
export const CASTOR_RUNTIME_DIRNAME = ".castor";
export const LEGACY_INKOS_RUNTIME_DIRNAME = ".inkos";
```

Do not place story authority logic here.

Export only what downstream packages legitimately need through `packages/core/src/index.ts` or the established public subpath pattern.

### Task 3.3 — Write RED config-migration tests

**Create:** `packages/core/src/__tests__/castor-config-migration.test.ts` or colocate with the existing config tests discovered in Task 3.1.

Required scenarios:

1. only `inkos.json` exists → validate and create equivalent `castor.json`;
2. only `castor.json` exists → use it, do not touch legacy path;
3. both exist, semantically same → Castor remains canonical;
4. both conflict → Castor wins + non-secret warning, no merge;
5. invalid legacy config → no partial `castor.json`;
6. migration replay → idempotent;
7. secret-bearing values are never printed in diagnostics;
8. after migration, subsequent saves update `castor.json`, not `inkos.json`.

Before production changes, run the narrow test and record RED.

### Task 3.4 — Implement one-way config migration using existing atomic file primitives

Modify the existing project/global config loader/writer discovered in Task 3.1; keep the adapter at the edge.

Required algorithm:

```text
if castor.json exists:
  validate/use castor.json
  if inkos.json also exists and meaningful values conflict:
    emit redacted warning
else if inkos.json exists:
  validate legacy shape
  map to canonical Castor shape
  atomically write castor.json
  leave legacy file untouched
  use castor.json thereafter
else:
  continue normal new-Castor setup
```

Do not derive story Canon or Human authority from config migration.

Run narrow tests → GREEN.

### Task 3.5 — Verify new-project behavior

Add/extend public-surface test(s) to create/configure a fresh project through the normal Castor API/CLI path and assert:

```text
castor.json exists
inkos.json does not get newly created
```

Run affected config/CLI/Studio tests plus Core/CLI/Studio typecheck/build.

Commit config migration separately.

**HUMAN GATE 3:** Include before/after fixture evidence, conflict behavior, secret-redaction proof, and proof no story-state files changed during config-only migration.

---

## Checkpoint 4 — Migrate `.inkos/` runtime state to `.castor/` without touching story authority

### Task 4.1 — Inventory current runtime-directory ownership

Run:

```powershell
rg -n --hidden --glob '!node_modules' --glob '!dist' '\.inkos|INKOS_HOME|runtimeDir|cacheDir|session' packages scripts
```

Document exact production owners in the inventory.

Distinguish runtime/cache/preferences from `story/state/*.json`. Never classify Canon as runtime cache.

### Task 4.2 — Write RED runtime migration tests

**Create:** `packages/core/src/__tests__/castor-runtime-migration.test.ts` or the nearest runtime/config test module.

Test:

- `.inkos/` only → safe one-way migration/read into `.castor/`;
- `.castor/` only → no legacy mutation;
- both → `.castor/` canonical, no implicit merge/overwrite;
- injected copy/write failure → no half-written canonical runtime and legacy preserved;
- migration replay → idempotent;
- story/state/Foundation/Arc/chapter files remain byte-identical;
- migration cannot create/consume Authorization or advance `lastAppliedChapter`.

Record RED.

### Task 4.3 — Implement the runtime adapter at the boundary

Use the existing atomic/staging helpers where multiple files move together. Prefer copy/validate/commit semantics over destructive rename so legacy evidence remains recoverable.

New projects must create `.castor/` only.

Run narrow tests → GREEN.

### Task 4.4 — Add a legacy-book authority preservation fixture test

Use an existing representative Phase 5 legacy fixture/book if one exists. Otherwise create a minimal deterministic test fixture under the existing test-fixture convention, not under production `books/`.

Before opening/migrating, hash or serialize authoritative artifacts:

```text
Foundation published content/version
Published Arc content/version
story/state/*.json
Human review receipts
authorization/governance records
chapter prose
```

Open through the new Castor public path, allow runtime/config migration, then assert those authoritative artifacts are unchanged.

Commit runtime migration separately.

**HUMAN GATE 4:** Required evidence includes authority hashes before/after and failure-injection recovery.

---

## Checkpoint 5 — Replace active `INKOS_*` environment variables with explicit `CASTOR_*` canonical mappings

### Task 5.1 — Build the explicit environment mapping inventory

Run:

```powershell
rg -n --hidden --glob '!node_modules' --glob '!dist' 'INKOS_[A-Z0-9_]+' packages scripts README*.md docs
```

List every active variable and its intended Castor counterpart in `docs/migrations/castor-identity-inventory.md`.

Known examples include:

```text
INKOS_STUDIO_PORT  -> CASTOR_STUDIO_PORT
INKOS_PROJECT_ROOT -> CASTOR_PROJECT_ROOT
INKOS_SKILL_DIRS   -> CASTOR_SKILL_DIRS
```

No wildcard copying of arbitrary `INKOS_*` names.

### Task 5.2 — Write RED environment compatibility tests

**Create:** `packages/core/src/__tests__/castor-env-compat.test.ts` or the existing environment/config test module.

Per mapped key test:

- only Castor set → Castor value;
- only legacy set → use legacy as compatibility fallback;
- both same → Castor value;
- both different → Castor value + redacted deprecation/conflict warning;
- unknown `INKOS_*` → not magically mapped;
- emitted help/docs/settings refer to Castor key.

### Task 5.3 — Implement a single compatibility resolver

Add the explicit map/resolver to the config boundary identified earlier. Update callers to ask the resolver for canonical Castor values rather than reading both names ad hoc.

Update package scripts such as Studio dev/server commands from `INKOS_*` to `CASTOR_*` canonical variables.

Run narrow tests and affected Studio/CLI tests → GREEN.

Commit env migration separately.

**HUMAN GATE 5:** Present complete env mapping and confirm no unclassified active `INKOS_*` remains.

---

## Checkpoint 6 — Convert active product-owned branding, diagnostics, user-agent, and normal docs to Castor

### Task 6.1 — Write RED product-brand audit cases

Extend `scripts/audit-castor-identity.mjs` fixtures so it fails on active examples such as:

```text
Starting InkOS Studio
InkOS Doctor
InkOS/<version>
use inkos studio
```

while allowing clearly marked legal/history/legacy references.

### Task 6.2 — Update active product-owned strings

Using the inventory, update active production strings in:

- CLI startup/help/Doctor code under `packages/cli/src/**`;
- Studio server/client product branding under `packages/studio/src/**`;
- Core user-agent/product labels under `packages/core/src/**`;
- active scripts/examples.

Do not rewrite historical persisted trace provenance merely to make it say Castor.

### Task 6.3 — Update identity docs without removing attribution

**Modify:**
- `README.md`
- `README.en.md`
- normal quick-start/development docs identified by the inventory.

At this checkpoint, docs become Castor-first in names/commands/config references, but full Vietnamese/English localization belongs to Plan 2.

Keep a prominent derived-project notice and AGPL attribution. Do not claim the project was written from scratch.

### Task 6.4 — Run the identity audit

```powershell
pnpm audit:castor-identity
rg -n --hidden --glob '!node_modules' --glob '!dist' --glob '!.git' 'InkOS|inkos|INKOS_|@actalk/inkos|\.inkos|inkos\.json' .
```

For every remaining occurrence, annotate/classify it in the inventory. Any active product occurrence outside approved buckets blocks completion.

Commit branding/docs identity cleanup.

**HUMAN GATE 6:** Human reviews remaining InkOS occurrences and attribution wording before final acceptance.

---

## Checkpoint 7 — Full identity/compatibility acceptance and clean Castor startup

### Task 7.1 — Run targeted migration tests

Run all new tests from Checkpoints 0–6 plus existing config, CLI, Studio startup, Human Direction/Authorization, State Review/Confirm, chapter persistence, Task 25 upgrade/recovery, and Phase 5 acceptance suites.

Expected: no new failure. Known unrelated Windows symlink/EPERM baselines must be reported exactly, not silently ignored.

### Task 7.2 — Run package-wide verification

Run:

```powershell
pnpm typecheck
pnpm build
pnpm test
pnpm audit:castor-identity
```

If monorepo `pnpm test` is too large or has known platform-specific failures, run and report partitioned package test commands with exact pass/fail counts. Do not replace a failed full run with selective tests without explaining it.

### Task 7.3 — Fresh new-Castor smoke

From a temporary test workspace, use normal Castor surfaces to create/configure a fresh project/book enough to prove:

```text
castor command works
Castor Studio boots
castor.json is created
.castor/ is used when runtime state is needed
no new inkos.json is created
no new .inkos/ is created
normal output says Castor
```

Do not yet spend real model tokens on the full Chapter 1 acceptance; that final browser/provider acceptance occurs after Plans 2 and 3.

### Task 7.4 — Legacy-project migration smoke

Use a disposable copy of a representative legacy project containing `inkos.json` and relevant `.inkos/` data.

Record authoritative hashes before migration, open through Castor, migrate, and verify:

```text
castor.json created/used
.castor/ canonical where applicable
legacy source preserved
Foundation/Arc/Canon/chapter/receipts/authorization unchanged
```

### Task 7.5 — Independent review

Use a fresh reviewer context. Provide:

- authoritative spec;
- this plan;
- diff from Checkpoint 0 approved baseline;
- new test list;
- migration smoke evidence;
- remaining InkOS audit classifications.

Reviewer must specifically search for:

```text
silent config merge
secret leakage
legacy overwrite/data loss
Canon mutation caused by migration
Human authority creation/consumption
old package import leakage
inkos CLI alias leakage
new project creating old artifacts
```

Required acceptance: **Critical 0, Important 0**.

### Task 7.6 — Final checkpoint report

Report:

```text
starting HEAD
final HEAD
commits by checkpoint
files changed
tests + exact counts
build/typecheck results
new-project smoke
legacy-project smoke
authority hash comparison
remaining InkOS occurrences by allowed bucket
independent review findings
tracked worktree status
untracked evidence intentionally preserved
```

Do not push/tag/release.

**HUMAN GATE 7 — PLAN 1 ACCEPTANCE:** Stop. Plan 2 (vi-VN/en-US localization) begins only after Human accepts identity + legacy migration.
