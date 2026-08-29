import { afterEach, describe, expect, it } from "vitest";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  castorRuntimeDir,
  castorRuntimePath,
  resolveRuntimePath,
} from "../config/runtime-dir.js";
import { loadSecrets, saveSecrets } from "../llm/secrets.js";
import { loadProjectConfigFile, saveProjectConfigFile } from "../config/project-config-file.js";

/**
 * Castor runtime directory contract (Checkpoint 4, plan Tasks 4.2-4.4).
 *
 * Canonical runtime state lives in .castor/. Legacy .inkos/ is read only for
 * one-way compatibility: content is copied into the canonical tree when the
 * canonical counterpart is missing; the legacy tree itself is never modified
 * and can never overwrite an existing canonical file. Story authority
 * (books/, story/state, governance records) is never derived from or mutated
 * by runtime migration.
 */

let roots: string[] = [];
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "castor-runtime-migration-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true }).catch(() => undefined)));
});

async function writeLegacy(root: string, rel: string, content: string): Promise<string> {
  const p = join(root, ".inkos", rel);
  await mkdir(join(p, ".."), { recursive: true });
  await writeFile(p, content, "utf-8");
  return p;
}

describe("runtime dir adapter", () => {
  it("pure helpers always name the canonical .castor tree", () => {
    expect(castorRuntimeDir("/p")).toMatch(/[\\/.]\.castor$/);
    expect(castorRuntimePath("/p", "materials")).toContain(".castor");
  });

  it(".inkos only → resource copied one-way into .castor, legacy byte-identical", async () => {
    const root = await tempRoot();
    const legacyRaw = `{"services":{"kkaiapi":{"apiKey":"sk-test-123"}}}`;
    const legacyPath = await writeLegacy(root, "secrets.json", legacyRaw);

    const resolved = await resolveRuntimePath(root, "secrets.json");
    expect(resolved).toBe(castorRuntimePath(root, "secrets.json"));
    expect(await readFile(resolved, "utf-8")).toBe(legacyRaw);
    expect(await readFile(legacyPath, "utf-8")).toBe(legacyRaw);
  });

  it(".castor only → legacy never consulted", async () => {
    const root = await tempRoot();
    await mkdir(castorRuntimeDir(root), { recursive: true });
    await writeFile(castorRuntimePath(root, "secrets.json"), "canonical", "utf-8");

    const resolved = await resolveRuntimePath(root, "secrets.json");
    expect(await readFile(resolved, "utf-8")).toBe("canonical");
    await expect(access(join(root, ".inkos"))).rejects.toBeTruthy();
  });

  it("both exist → canonical wins; legacy never overwrites .castor content", async () => {
    const root = await tempRoot();
    await mkdir(castorRuntimeDir(root), { recursive: true });
    await writeFile(castorRuntimePath(root, "secrets.json"), "canonical", "utf-8");
    await writeLegacy(root, "secrets.json", "legacy");

    const resolved = await resolveRuntimePath(root, "secrets.json");
    expect(await readFile(resolved, "utf-8")).toBe("canonical");
  });

  it("migration replay is idempotent", async () => {
    const root = await tempRoot();
    await writeLegacy(root, "secrets.json", "legacy");
    await resolveRuntimePath(root, "secrets.json");
    await resolveRuntimePath(root, "secrets.json");
    expect(await readFile(castorRuntimePath(root, "secrets.json"), "utf-8")).toBe("legacy");
  });

  it("missing everywhere → canonical path returned, nothing created", async () => {
    const root = await tempRoot();
    const resolved = await resolveRuntimePath(root, "uploads", "s1", "file.txt");
    expect(resolved).toBe(castorRuntimePath(root, "uploads", "s1", "file.txt"));
    await expect(access(castorRuntimeDir(root))).rejects.toBeTruthy();
  });

  it("directories migrate recursively (materials tree)", async () => {
    const root = await tempRoot();
    await writeLegacy(root, "materials/note.md", "hello");
    const dir = await resolveRuntimePath(root, "materials");
    const files = await readdir(dir);
    expect(files).toContain("note.md");
    expect(await readFile(join(dir, "note.md"), "utf-8")).toBe("hello");
  });
});

describe("secrets through the runtime adapter", () => {
  it("legacy .inkos/secrets.json is visible after migration; saves go to .castor only", async () => {
    const root = await tempRoot();
    const legacyRaw = JSON.stringify({ services: { kkaiapi: { apiKey: "sk-legacy" } } }, null, 2);
    const legacyPath = await writeLegacy(root, "secrets.json", legacyRaw);

    const loaded = await loadSecrets(root);
    expect(loaded.services.kkaiapi?.apiKey).toBe("sk-legacy");

    await saveSecrets(root, { services: { kkaiapi: { apiKey: "sk-new" } } });
    const canonical = JSON.parse(await readFile(castorRuntimePath(root, "secrets.json"), "utf-8"));
    expect(canonical.services.kkaiapi.apiKey).toBe("sk-new");
    expect(await readFile(legacyPath, "utf-8")).toBe(legacyRaw);
    expect(JSON.stringify(canonical)).not.toContain("sk-legacy");
  });

  it("secrets values never appear in thrown error messages", async () => {
    const root = await tempRoot();
    await writeLegacy(root, "secrets.json", "{ broken json with sk-secret-value");
    try {
      await loadSecrets(root);
      // invalid JSON → treated as empty secrets, not a crash
      expect(true).toBe(true);
    } catch (e) {
      expect(String(e)).not.toContain("sk-secret-value");
    }
  });
});

describe("legacy project authority preservation (Task 4.4 fixture)", () => {
  it("opening + migrating a legacy project leaves books/, story/state, receipts and .inkos/ byte-identical", async () => {
    const root = await tempRoot();
    // Legacy project: config, runtime resources, and authoritative story state.
    await writeLegacy(root, "secrets.json", JSON.stringify({ services: { custom: { apiKey: "sk-fixed" } } }));
    await writeLegacy(root, "materials/lore.md", "The clocks stopped at 11:47.");
    await writeLegacy(root, "sessions/s1/transcript.md", "human: continue\n");
    const configRaw = JSON.stringify({
      name: "legacy-book", version: "0.1.0", language: "en",
      llm: { provider: "openai", service: "custom", configSource: "studio", baseUrl: "", model: "", apiFormat: "chat", stream: true },
      notify: [],
    }, null, 2);
    const legacyConfigPath = join(root, "inkos.json");
    await writeFile(legacyConfigPath, configRaw, "utf-8");

    const stateFile = join(root, "books", "legacy-book", "story", "state", "canon.json");
    await mkdir(join(stateFile, ".."), { recursive: true });
    const canonSnapshot = JSON.stringify({ lastAppliedChapter: 1, entities: { "evelyn-hart": { age: 21 } } }, null, 2);
    await writeFile(stateFile, canonSnapshot, "utf-8");
    const receipt = join(root, "books", "legacy-book", "story", "governance", "receipts", "final-confirm-ch1.json");
    await mkdir(join(receipt, ".."), { recursive: true });
    const receiptSnapshot = JSON.stringify({ chapter: 1, human: "approved" }, null, 2);
    await writeFile(receipt, receiptSnapshot, "utf-8");

    // Hash everything authoritative before.
    const before = {
      canon: await readFile(stateFile, "utf-8"),
      receipt: await readFile(receipt, "utf-8"),
      legacyConfig: await readFile(join(root, "inkos.json"), "utf-8"),
      secrets: await readFile(join(root, ".inkos", "secrets.json"), "utf-8"),
    };

    // Open through the new Castor public paths (config + runtime + secrets).
    await loadProjectConfigFile(root);
    await saveProjectConfigFile(root, JSON.parse(before.legacyConfig));
    await loadSecrets(root);
    await resolveRuntimePath(root, "materials");
    await resolveRuntimePath(root, "sessions");

    // Authoritative artifacts unchanged.
    expect(await readFile(stateFile, "utf-8")).toBe(before.canon);
    expect(await readFile(receipt, "utf-8")).toBe(before.receipt);
    expect(await readFile(join(root, "inkos.json"), "utf-8")).toBe(before.legacyConfig);
    expect(await readFile(join(root, ".inkos", "secrets.json"), "utf-8")).toBe(before.secrets);

    // Migration created no authority artifacts and did not advance Canon.
    const castorTree = await readdir(castorRuntimeDir(root));
    expect(castorTree).not.toContain("books");
    expect(castorTree).not.toContain("authorizations");
    expect(await readFile(stateFile, "utf-8")).toContain('"lastAppliedChapter": 1');
  });
});
