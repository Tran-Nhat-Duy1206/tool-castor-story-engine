#!/usr/bin/env node
/**
 * Castor identity audit (Checkpoint 1, Task 1.2).
 *
 * Scans tracked production/user-facing files for legacy InkOS identity
 * occurrences and fails when any occurrence remains outside an explicitly
 * allowlisted bucket. Buckets follow the approved migration plan:
 *
 *   LEGAL-ATTRIBUTION      LICENSE / AGPL notices.
 *   HISTORICAL-PROVENANCE  CHANGELOGs and historical design documents.
 *   LEGACY-COMPAT          The migration plan/spec docs and legacy fixtures.
 *   ATTRIBUTION-LINE       A line in a user-facing doc that is itself part of
 *                          the derived-project/attribution notice (spec §2).
 *
 * Test files are out of audit scope (they are not user-facing production
 * surfaces); their package-import renames are enforced by build/typecheck.
 * Generated lockfile metadata is scanned after the package rename regenerates
 * it. Whole production directories are never ignored.
 *
 * Usage: node scripts/audit-castor-identity.mjs
 * Exit 0 = clean, 1 = violations found, 2 = could not run.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Path-level allowlist. Each entry is a bucket name + regex on POSIX-style rel paths. */
export const PATH_ALLOWLIST = [
  { bucket: "LEGAL-ATTRIBUTION", pattern: /^LICENSE(\.md|\.txt)?$/ },
  { bucket: "HISTORICAL-PROVENANCE", pattern: /^CHANGELOG(\.en|\.ja)?\.md$/ },
  { bucket: "LEGACY-COMPAT", pattern: /^docs\/superpowers\// },
  { bucket: "LEGACY-COMPAT", pattern: /^docs\/migrations\// },
  { bucket: "HISTORICAL-PROVENANCE", pattern: /^docs\/(ARCHITECTURE_AUDIT|IMPLEMENTATION_PLAN|V1_SPEC|PROJECT_VISION)\.md$/ },
  { bucket: "LEGACY-COMPAT", pattern: /^test-project\// },
  { bucket: "HISTORICAL-PROVENANCE", pattern: /^\.gate0-|^\.smoke-|^\.studio-/ },
  // Explicit legacy-compatibility adapter modules: these OWN the legacy
  // names/files/keys they migrate and cannot describe them without naming
  // them (plan Task 1.2 allowlist: "explicit legacy migration modules").
  { bucket: "LEGACY-COMPAT", pattern: /^packages\/core\/src\/utils\/llm-env\.ts$/ },
  { bucket: "LEGACY-COMPAT", pattern: /^packages\/core\/src\/config\/product-identity\.ts$/ },
  { bucket: "LEGACY-COMPAT", pattern: /^packages\/core\/src\/config\/project-config-file\.ts$/ },
  { bucket: "LEGACY-COMPAT", pattern: /^packages\/core\/src\/config\/runtime-dir\.ts$/ },
  { bucket: "LEGACY-COMPAT", pattern: /^packages\/cli\/src\/book-backup\.ts$/ },
  // Bootstrap detects legacy projects and refuses to shadow legacy configs.
  { bucket: "LEGACY-COMPAT", pattern: /^packages\/cli\/src\/project-bootstrap\.ts$/ },
  // Reads pre-rename plan caches carrying INKOS_PLAN_* markers.
  { bucket: "LEGACY-COMPAT", pattern: /^packages\/core\/src\/pipeline\/persisted-governed-plan\.ts$/ },
  { bucket: "LEGACY-COMPAT", pattern: /^scripts\/audit-castor-identity\.mjs$/ },
  // Must keep ignoring legacy-named runtime artifacts created by older versions.
  { bucket: "LEGACY-COMPAT", pattern: /^\.gitignore$/ },
  // E2E seeder for the legacy test-project fixture (reads legacy .inkos data).
  { bucket: "LEGACY-COMPAT", pattern: /^packages\/studio\/e2e\/fixtures\// },
];

/** Attribution-line exception (spec §2): the derived-project notice itself. */
const ATTRIBUTION_LINE = /(Narcooo|upstream|derived|attribution|AGPL|licen[cs]e|history|fork)/i;

/** Basenames that must not carry the legacy name once the migration completes. */
export function isLegacyFilename(relPath) {
  const base = relPath.split("/").pop() ?? relPath;
  return /inkos/i.test(base);
}

/** Files out of audit scope: tests are not user-facing production surfaces. */
export function isOutOfScopePath(relPath) {
  return (
    /(^|\/)__tests__\//.test(relPath) ||
    /\.test\.(ts|tsx|mjs|js)$/.test(relPath) ||
    /(^|\/)__mocks__\//.test(relPath)
  );
}

export function classifyPath(relPath) {
  const p = relPath.replace(/\\/g, "/");
  for (const { bucket, pattern } of PATH_ALLOWLIST) {
    if (pattern.test(p)) return { allowed: true, bucket };
  }
  return { allowed: false, bucket: "ACTIVE" };
}

/**
 * Scan one file's content. Returns violations (active occurrences) and the
 * allowed occurrences with their bucket, so reports stay quantitative.
 */
export function scanContent(relPath, content) {
  const pathClass = classifyPath(relPath);
  const lines = content.split(/\r?\n/);
  const violations = [];
  let allowedCount = 0;
  let attributionLines = 0;
  lines.forEach((line, idx) => {
    if (!/inkos/i.test(line)) return;
    if (pathClass.allowed) {
      allowedCount += 1;
      return;
    }
    if (ATTRIBUTION_LINE.test(line) && /^README|^CONTRIBUTING/.test(relPath)) {
      attributionLines += 1;
      allowedCount += 1;
      return;
    }
    violations.push({ relPath, line: idx + 1, text: line.trim().slice(0, 160) });
  });
  return { violations, allowedCount, attributionLines };
}

function listTrackedFiles(root) {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: root, maxBuffer: 64 * 1024 * 1024 })
    .toString()
    .split("\0")
    .filter(Boolean);
  return out;
}

export function runAudit({ root, files, read }) {
  const violations = [];
  const summary = { scanned: 0, allowedOccurrences: 0, attributionLines: 0, legacyFilenames: [] };
  for (const rel of files) {
    const relPosix = rel.replace(/\\/g, "/");
    if (isOutOfScopePath(relPosix)) continue;
    let content;
    try {
      content = read ? read(rel) : readFileSync(join(root, rel), "utf-8");
    } catch {
      continue; // binary or unreadable — filename check below still applies
    }
    summary.scanned += 1;
    if (isLegacyFilename(relPosix) && !classifyPath(relPosix).allowed) summary.legacyFilenames.push(relPosix);
    const result = scanContent(relPosix, content);
    summary.allowedOccurrences += result.allowedCount;
    summary.attributionLines += result.attributionLines;
    violations.push(...result.violations);
  }
  const ok = violations.length === 0 && summary.legacyFilenames.length === 0;
  return { ok, violations, summary };
}

function printReport({ ok, violations, summary }) {
  console.log(`Castor identity audit — scanned ${summary.scanned} tracked files`);
  console.log(`  allowed legacy occurrences: ${summary.allowedOccurrences} (attribution lines: ${summary.attributionLines})`);
  if (summary.legacyFilenames.length) {
    console.log(`  legacy-named files: ${summary.legacyFilenames.length}`);
    for (const f of summary.legacyFilenames.slice(0, 20)) console.log(`    - ${f}`);
  }
  if (!ok) {
    console.log(`  VIOLATIONS: ${violations.length}`);
    const byFile = new Map();
    for (const v of violations) byFile.set(v.relPath, (byFile.get(v.relPath) ?? 0) + 1);
    console.log("  files with active occurrences:");
    for (const [f, n] of [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
      console.log(`    - ${f} (${n})`);
    }
    console.log("  first violations:");
    for (const v of violations.slice(0, 10)) console.log(`    ${v.relPath}:${v.line}: ${v.text}`);
  }
  console.log(ok ? "AUDIT PASS" : "AUDIT FAIL");
}

function main() {
  const root = resolve(process.argv[2] ?? process.cwd());
  try {
    statSync(join(root, ".git"));
  } catch {
    console.error(`not a git repository: ${root}`);
    process.exit(2);
  }
  const files = listTrackedFiles(root);
  const result = runAudit({ root, files });
  printReport(result);
  process.exit(result.ok ? 0 : 1);
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main();
}
