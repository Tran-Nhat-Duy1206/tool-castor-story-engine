import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Castor package identity contract (Checkpoint 2, Task 2.1).
 *
 * Asserts the workspace manifests as data:
 *   - root package name == castor-story-engine
 *   - packages/core  name == @actalk/castor-core
 *   - packages/cli   name == @actalk/castor
 *   - packages/studio name == @actalk/castor-studio
 *   - CLI bin keys == [castor] exactly (no castor alias)
 *   - no workspace dependency name begins with @actalk/castor
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function readJson(rel) {
  return JSON.parse(readFileSync(resolve(repoRoot, rel), "utf-8"));
}

function workspaceDeps(manifest) {
  const sections = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
  const found = [];
  for (const section of sections) {
    for (const name of Object.keys(manifest[section] ?? {})) found.push({ section, name });
  }
  return found;
}

describe("castor package identity", () => {
  const manifests = {
    root: readJson("package.json"),
    core: readJson("packages/core/package.json"),
    cli: readJson("packages/cli/package.json"),
    studio: readJson("packages/studio/package.json"),
  };

  it("root workspace package is castor-story-engine", () => {
    assert.equal(manifests.root.name, "castor-story-engine");
  });

  it("core package is @actalk/castor-core", () => {
    assert.equal(manifests.core.name, "@actalk/castor-core");
  });

  it("cli package is @actalk/castor", () => {
    assert.equal(manifests.cli.name, "@actalk/castor");
  });

  it("studio package is @actalk/castor-studio", () => {
    assert.equal(manifests.studio.name, "@actalk/castor-studio");
  });

  it("cli exposes exactly the castor bin (no castor alias)", () => {
    assert.deepEqual(Object.keys(manifests.cli.bin ?? {}), ["castor"]);
  });

  it("no workspace dependency name begins with @actalk/castor", () => {
    for (const [pkg, manifest] of Object.entries(manifests)) {
      const legacy = workspaceDeps(manifest).filter((d) => d.name.startsWith("@actalk/castor"));
      assert.deepEqual(legacy, [], `${pkg} has legacy workspace deps`);
    }
  });

  it("all workspace dependencies resolve to castor package names", () => {
    const castorNames = new Set([
      manifests.core.name,
      manifests.cli.name,
      manifests.studio.name,
    ]);
    for (const [pkg, manifest] of Object.entries(manifests)) {
      for (const dep of workspaceDeps(manifest)) {
        if (dep.name.startsWith("@actalk/")) {
          assert.ok(castorNames.has(dep.name), `${pkg} depends on non-castor workspace package ${dep.name}`);
        }
      }
    }
  });
});
