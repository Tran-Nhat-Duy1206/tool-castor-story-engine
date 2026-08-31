import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile, access } from "node:fs/promises";import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadProjectConfigFile,
  saveProjectConfigFile,
} from "../config/project-config-file.js";
import { StateManager } from "../state/manager.js";

/**
 * Castor project-config file contract (Checkpoint 3, plan Tasks 3.3-3.5).
 *
 * Canonical config is castor.json. Legacy castor.json is a one-way migration
 * input: read once, materialize an equivalent castor.json, never rewritten.
 * Story Canon/state must never be touched by config migration.
 */

const VALID_CONFIG = {
  name: "migrate-me",
  version: "0.1.0",
  language: "en",
  llm: {
    provider: "openai",
    service: "custom",
    configSource: "studio",
    baseUrl: "",
    model: "",
    apiFormat: "chat",
    stream: true,
  },
  notify: [],
};

let roots: string[] = [];
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "castor-config-migration-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true }).catch(() => undefined)));
});

describe("castor.json canonical config (migration scenarios)", () => {
  it("1. only castor.json → validates and creates an equivalent castor.json; legacy file untouched", async () => {
    const root = await tempRoot();
    const legacyPath = join(root, "castor.json");
    const legacyRaw = JSON.stringify(VALID_CONFIG, null, 2);
    await writeFile(legacyPath, legacyRaw, "utf-8");

    const result = await loadProjectConfigFile(root);
    expect(result.source).toBe("legacy-migrated");
    expect(result.config).toMatchObject({ name: VALID_CONFIG.name, language: "en" });
    // Spec §6.2: report what was migrated. The receipt is informational —
    // no conflict warning, and no secret values.
    expect(result.warnings.join("\n")).toContain("Migrated legacy castor.json");
    expect(result.warnings.join("\n")).not.toContain("conflict");

    const castorRaw = await readFile(join(root, "castor.json"), "utf-8");
    expect(JSON.parse(castorRaw)).toEqual(VALID_CONFIG);

    // legacy input must remain byte-identical
    expect(await readFile(legacyPath, "utf-8")).toBe(legacyRaw);
  });

  it("2. only castor.json → used directly; legacy path never invoked or created", async () => {
    const root = await tempRoot();
    await writeFile(join(root, "castor.json"), JSON.stringify(VALID_CONFIG, null, 2), "utf-8");

    const result = await loadProjectConfigFile(root);
    expect(result.source).toBe("castor");
    await expect(access(join(root, "castor.json"))).rejects.toBeTruthy();
    expect(result.warnings.length).toBe(0);
  });

  it("3. both exist with equivalent content → castor.json canonical, no warning", async () => {
    const root = await tempRoot();
    await writeFile(join(root, "castor.json"), JSON.stringify(VALID_CONFIG, null, 2), "utf-8");
    await writeFile(join(root, "castor.json"), JSON.stringify(VALID_CONFIG, null, 2), "utf-8");

    const result = await loadProjectConfigFile(root);
    expect(result.source).toBe("castor");
    expect(result.warnings.length).toBe(0);
  });

  it("4. both exist with conflicting values → castor wins, non-secret key-name warning, no merge", async () => {
    const root = await tempRoot();
    const castorConfig = { ...VALID_CONFIG, language: "en" };
    const legacyConfig = { ...VALID_CONFIG, language: "vi", name: "other-name" };
    await writeFile(join(root, "castor.json"), JSON.stringify(castorConfig, null, 2), "utf-8");
    await writeFile(join(root, "castor.json"), JSON.stringify(legacyConfig, null, 2), "utf-8");

    const result = await loadProjectConfigFile(root);
    expect(result.source).toBe("castor");
    expect(result.config).toEqual(castorConfig); // castor wins, no merge
    expect(result.warnings.join("\n")).toContain("castor.json");
    expect(result.warnings.join("\n")).toContain("language");
    expect(result.warnings.join("\n")).toContain("name");
  });

  it("4b. conflicting values are never echoed in diagnostics (secret redaction)", async () => {
    const root = await tempRoot();
    const castorConfig = { ...VALID_CONFIG, llm: { ...VALID_CONFIG.llm, apiKey: "sk-canonical" } };
    const legacyConfig = { ...VALID_CONFIG, llm: { ...VALID_CONFIG.llm, apiKey: "sk-legacy-secret" } };
    await writeFile(join(root, "castor.json"), JSON.stringify(castorConfig, null, 2), "utf-8");
    await writeFile(join(root, "castor.json"), JSON.stringify(legacyConfig, null, 2), "utf-8");

    const result = await loadProjectConfigFile(root);
    const all = result.warnings.join("\n") + JSON.stringify(result.config);
    expect(all).not.toContain("sk-legacy-secret");
    expect(all).toContain("sk-canonical"); // canonical values are legitimately present in config
  });

  it("5. invalid legacy config → actionable error, no partial castor.json", async () => {
    const root = await tempRoot();
    await writeFile(join(root, "castor.json"), "{ not valid json", "utf-8");

    await expect(loadProjectConfigFile(root)).rejects.toThrow(/invalid|not valid/i);
    await expect(access(join(root, "castor.json"))).rejects.toBeTruthy();
  });

  it("6. migration replay is idempotent (second read uses castor.json, no rewrite)", async () => {
    const root = await tempRoot();
    await writeFile(join(root, "castor.json"), JSON.stringify(VALID_CONFIG, null, 2), "utf-8");

    const first = await loadProjectConfigFile(root);
    expect(first.source).toBe("legacy-migrated");
    const castorStat1 = (await readFile(join(root, "castor.json"), "utf-8"));

    const second = await loadProjectConfigFile(root);
    expect(second.source).toBe("castor");
    expect(second.warnings.length).toBe(0);
    expect(await readFile(join(root, "castor.json"), "utf-8")).toBe(castorStat1);
  });

  it("7. no config at all → actionable not-found error mentioning castor.json", async () => {
    const root = await tempRoot();
    await expect(loadProjectConfigFile(root)).rejects.toThrow(/castor\.json/);
  });

  it("8. after migration, save writes castor.json only; castor.json stays byte-identical", async () => {
    const root = await tempRoot();
    const legacyRaw = JSON.stringify(VALID_CONFIG, null, 2);
    await writeFile(join(root, "castor.json"), legacyRaw, "utf-8");
    await loadProjectConfigFile(root);

    const updated = { ...VALID_CONFIG, language: "vi" };
    await saveProjectConfigFile(root, updated);

    expect(JSON.parse(await readFile(join(root, "castor.json"), "utf-8"))).toEqual(updated);
    expect(await readFile(join(root, "castor.json"), "utf-8")).toBe(legacyRaw);

    // and a fresh read sees the saved canonical value
    const reread = await loadProjectConfigFile(root);
    expect(reread.config.language).toBe("vi");
  });

  it("9. new Castor project (bootstrap parity) — saveProjectConfigFile creates castor.json, never castor.json", async () => {
    const root = await tempRoot();
    await saveProjectConfigFile(root, VALID_CONFIG);
    const files = await readdir(root);
    expect(files).toContain("castor.json");
    expect(files).not.toContain("castor.json");
  });

  it("10. StateManager project config goes through the canonical file after migration", async () => {
    const root = await tempRoot();
    await writeFile(join(root, "castor.json"), JSON.stringify(VALID_CONFIG, null, 2), "utf-8");
    const sm = new StateManager(root);
    const loaded = await sm.loadProjectConfig();
    expect(loaded).toMatchObject({ name: VALID_CONFIG.name });
    await sm.saveProjectConfig({ ...VALID_CONFIG, language: "vi" });
    expect(JSON.parse(await readFile(join(root, "castor.json"), "utf-8"))).toMatchObject({ language: "vi" });
    expect(await readFile(join(root, "castor.json"), "utf-8")).toBe(JSON.stringify(VALID_CONFIG, null, 2));
  });

  it("11. config migration never creates or mutates story state", async () => {
    const root = await tempRoot();
    await mkdir(join(root, "books"), { recursive: true });
    await writeFile(join(root, "castor.json"), JSON.stringify(VALID_CONFIG, null, 2), "utf-8");
    const before = await readdir(join(root, "books"));
    await loadProjectConfigFile(root);
    await saveProjectConfigFile(root, VALID_CONFIG);
    expect(await readdir(join(root, "books"))).toEqual(before);
  });
});

