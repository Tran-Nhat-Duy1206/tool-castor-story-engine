import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyPath, isLegacyFilename, isOutOfScopePath, runAudit, scanContent } from "../audit-castor-identity.mjs";

describe("audit-castor-identity classifyPath", () => {
  it("allowlists legal attribution and historical provenance buckets", () => {
    assert.equal(classifyPath("LICENSE").bucket, "LEGAL-ATTRIBUTION");
    assert.equal(classifyPath("CHANGELOG.md").bucket, "HISTORICAL-PROVENANCE");
    assert.equal(classifyPath("CHANGELOG.en.md").bucket, "HISTORICAL-PROVENANCE");
    assert.equal(classifyPath("docs/ARCHITECTURE_AUDIT.md").bucket, "HISTORICAL-PROVENANCE");
  });

  it("allowlists migration/legacy documentation buckets", () => {
    assert.equal(classifyPath("docs/superpowers/plans/x.md").bucket, "LEGACY-COMPAT");
    assert.equal(classifyPath("docs/migrations/castor-identity-inventory.md").bucket, "LEGACY-COMPAT");
    assert.equal(classifyPath("test-project/inkos.json").bucket, "LEGACY-COMPAT");
  });

  it("treats active production and user-facing files as ACTIVE (not allowed)", () => {
    for (const p of [
      "package.json",
      "packages/core/src/index.ts",
      "packages/studio/src/api/server.ts",
      "packages/cli/src/commands/studio.ts",
      "README.md",
      "skills/SKILL.md",
      "inkos.json",
      "scripts/prepare-package-for-publish.mjs",
      "pnpm-lock.yaml",
      ".github/workflows/release.yml",
    ]) {
      assert.equal(classifyPath(p).allowed, false, p);
    }
  });

  it("never ignores whole production directories", () => {
    assert.equal(classifyPath("packages/core/src/anything.ts").allowed, false);
    assert.equal(classifyPath("packages/cli/src/anything.ts").allowed, false);
  });
});

describe("audit-castor-identity scope + filename rules", () => {
  it("excludes test files from the scan scope", () => {
    assert.equal(isOutOfScopePath("packages/core/src/__tests__/foo.test.ts"), true);
    assert.equal(isOutOfScopePath("packages/studio/src/api/__tests__/startup-smoke.test.ts"), true);
    assert.equal(isOutOfScopePath("packages/core/src/index.ts"), false);
    assert.equal(isOutOfScopePath("README.md"), false);
  });

  it("flags legacy-named files regardless of content", () => {
    assert.equal(isLegacyFilename("inkos.json"), true);
    assert.equal(isLegacyFilename("assets/inkos-text.svg"), true);
    assert.equal(isLegacyFilename("castor.json"), false);
    assert.equal(isLegacyFilename("packages/core/src/index.ts"), false);
  });
});

describe("audit-castor-identity scanContent", () => {
  it("flags active occurrences with file:line evidence", () => {
    const { violations } = scanContent("packages/cli/src/commands/studio.ts", 'log("Starting InkOS Studio");\nlog("ok");\nlog("use inkos doctor");\n');
    assert.equal(violations.length, 2);
    assert.equal(violations[0].line, 1);
    assert.equal(violations[1].line, 3);
  });

  it("passes attribution lines in user-facing docs (spec §2)", () => {
    const line = "Castor Story Engine is a substantially modified derivative of InkOS by Narcooo.";
    const { violations, attributionLines } = scanContent("README.md", line + "\n");
    assert.equal(violations.length, 0);
    assert.equal(attributionLines, 1);
  });

  it("does not accept the attribution exception in production code files", () => {
    const line = "Castor Story Engine is a derivative of InkOS by Narcooo.";
    const { violations } = scanContent("packages/core/src/foo.ts", line + "\n");
    assert.equal(violations.length, 1);
  });

  it("counts occurrences inside allowlisted buckets as allowed", () => {
    const { violations, allowedCount } = scanContent("CHANGELOG.md", "## v1.0 InkOS rename\n");
    assert.equal(violations.length, 0);
    assert.equal(allowedCount, 1);
  });

  it("flags the active branding examples from plan Task 6.1", () => {
    for (const active of [
      'log("Starting InkOS Studio on http://localhost:4567");',
      'checks.push({ name: "InkOS Doctor" });',
      'const CASTOR_USER_AGENT = "InkOS/1.3.5";',
      "use inkos studio to open the workbench",
    ]) {
      const { violations } = scanContent("packages/cli/src/commands/studio.ts", active + "\n");
      assert.equal(violations.length, 1, active);
    }
  });

  it("does not flag legacy-named files inside allowlisted buckets", () => {
    const result = runAudit({
      root: process.cwd(),
      files: ["test-project/inkos.json", "assets/inkos-text.svg", "castor.json"],
      read: (rel) => (rel === "assets/inkos-text.svg" ? "<svg>inkos</svg>" : "{}"),
    });
    assert.deepEqual(result.summary.legacyFilenames, ["assets/inkos-text.svg"]);
    assert.equal(result.ok, false);
  });

  it("passes when only attribution/history/legacy buckets remain", () => {
    const result = runAudit({
      root: process.cwd(),
      files: [
        "LICENSE",
        "CHANGELOG.md",
        "docs/migrations/castor-identity-inventory.md",
        "packages/core/src/utils/llm-env.ts",
        ".gitignore",
        "test-project/inkos.json",
      ],
      read: () => "InkOS by Narcooo, upstream attribution — legacy inkos.json compatibility\n",
    });
    assert.equal(result.ok, true, JSON.stringify(result.violations?.slice(0, 3)));
  });
});

describe("audit-castor-identity runAudit (fixture-driven)", () => {
  const fixtures = [
    { rel: "packages/cli/src/commands/studio.ts", content: 'log("Starting InkOS Studio");\n' },
    { rel: "README.md", content: "Castor is a derivative of InkOS by Narcooo, per attribution.\n" },
    { rel: "CHANGELOG.md", content: "history: inkos notes\n" },
    { rel: "packages/core/src/__tests__/x.test.ts", content: "inkos import legacy test\n" },
    { rel: "inkos.json", content: "{}\n" },
    { rel: "packages/core/src/index.ts", content: "export const ok = 1;\n" },
  ];

  function audit() {
    return runAudit({
      root: process.cwd(),
      files: fixtures.map((f) => f.rel),
      read: (rel) => fixtures.find((f) => f.rel === rel)?.content,
    });
  }

  it("fails while active occurrences and legacy filenames remain", () => {
    const result = audit();
    assert.equal(result.ok, false);
    assert.ok(result.violations.some((v) => v.relPath === "packages/cli/src/commands/studio.ts"));
    assert.deepEqual(result.summary.legacyFilenames, ["inkos.json"]);
  });

  it("becomes clean when active surfaces are migrated to Castor", () => {
    const migrated = [
      { rel: "packages/cli/src/commands/studio.ts", content: 'log("Starting Castor Studio");\n' },
      { rel: "README.md", content: "Castor is a derivative of InkOS by Narcooo, per attribution.\n" },
      { rel: "CHANGELOG.md", content: "history: inkos notes\n" },
      { rel: "packages/core/src/__tests__/x.test.ts", content: "inkos import legacy test\n" },
      { rel: "castor.json", content: "{}\n" },
      { rel: "packages/core/src/index.ts", content: "export const ok = 1;\n" },
    ];
    const result = runAudit({
      root: process.cwd(),
      files: migrated.map((f) => f.rel),
      read: (rel) => migrated.find((f) => f.rel === rel)?.content,
    });
    assert.equal(result.ok, true, JSON.stringify(result.violations?.slice(0, 3)));
  });
});
