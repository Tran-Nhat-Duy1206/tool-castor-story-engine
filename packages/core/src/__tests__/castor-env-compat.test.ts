import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLLMEnvLayers, castorEnv } from "../utils/llm-env.js";

/**
 * Castor environment compatibility contract (Checkpoint 5, plan Task 5.2).
 *
 * CASTOR_* is authoritative; known legacy INKOS_* keys are read as a
 * deprecated fallback through an explicit map (no wildcard copying); when
 * both are set Castor wins and a non-secret warning names the key.
 */

let roots: string[] = [];
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "castor-env-compat-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true }).catch(() => undefined)));
});

const CLEAN_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith("INKOS_") && !k.startsWith("CASTOR_")),
) as NodeJS.ProcessEnv;

describe("env compatibility resolver", () => {
  it("only CASTOR_* set → Castor value", () => {
    const env = { ...CLEAN_ENV, CASTOR_STUDIO_PORT: "4600" };
    expect(castorEnv("CASTOR_STUDIO_PORT", env)).toBe("4600");
  });

  it("only mapped legacy INKOS_* set → compatibility fallback", () => {
    const env = { ...CLEAN_ENV, INKOS_STUDIO_PORT: "4601" };
    expect(castorEnv("CASTOR_STUDIO_PORT", env)).toBe("4601");
  });

  it("both set with same value → Castor value, no warning", () => {
    const env = { ...CLEAN_ENV, CASTOR_STUDIO_PORT: "4602", INKOS_STUDIO_PORT: "4602" };
    const warnings: string[] = [];
    expect(castorEnv("CASTOR_STUDIO_PORT", env, warnings)).toBe("4602");
    expect(warnings.length).toBe(0);
  });

  it("both set with different values → Castor value + non-secret key-name warning", () => {
    const env = { ...CLEAN_ENV, CASTOR_STUDIO_PORT: "4603", INKOS_STUDIO_PORT: "4604" };
    const warnings: string[] = [];
    expect(castorEnv("CASTOR_STUDIO_PORT", env, warnings)).toBe("4603");
    expect(warnings.join("\n")).toContain("INKOS_STUDIO_PORT");
    expect(warnings.join("\n")).toContain("deprecated");
  });

  it("unknown INKOS_* names are not magically mapped", () => {
    const env = { ...CLEAN_ENV, INKOS_TOTALLY_UNKNOWN_VAR: "x" };
    expect(castorEnv("CASTOR_TOTALLY_UNKNOWN_VAR", env)).toBeUndefined();
  });

  it("empty/unset → undefined", () => {
    expect(castorEnv("CASTOR_STUDIO_PORT", CLEAN_ENV)).toBeUndefined();
  });
});

describe("env layer normalization (llm-env)", () => {
  it("legacy INKOS_LLM_* in project .env is visible under CASTOR_LLM_* keys", async () => {
    const root = await tempRoot();
    await writeFile(join(root, ".env"), "INKOS_LLM_MODEL=legacy-model\nINKOS_LLM_API_KEY=sk-legacy\n", "utf-8");
    const layers = await loadLLMEnvLayers(root, { ...CLEAN_ENV });
    expect(layers.project["CASTOR_LLM_MODEL"]).toBe("legacy-model");
    expect(layers.project["CASTOR_LLM_API_KEY"]).toBe("sk-legacy");
    // the legacy key is normalized away inside the layer maps
    expect(layers.project["INKOS_LLM_MODEL"]).toBeUndefined();
  });

  it("both files define the same key with different values → Castor key kept, warning emitted", async () => {
    const root = await tempRoot();
    await writeFile(join(root, ".env"), "CASTOR_LLM_MODEL=castor-model\n", "utf-8");
    const globalEnvPath = join(root, "global.env");
    await writeFile(globalEnvPath, "INKOS_LLM_MODEL=legacy-model\n", "utf-8");
    // loadLLMEnvLayers reads the global file through resolveGlobalEnvPath();
    // emulate the same normalization by feeding the process layer.
    const layers = await loadLLMEnvLayers(
      root,
      { ...CLEAN_ENV, INKOS_LLM_MODEL: "legacy-process", CASTOR_LLM_MODEL: "castor-process" } as NodeJS.ProcessEnv,
    );
    expect(layers.process["CASTOR_LLM_MODEL"]).toBe("castor-process");
    expect(layers.process["INKOS_LLM_MODEL"]).toBeUndefined();
    expect((layers.warnings ?? []).join("\n")).toContain("INKOS_LLM_MODEL");
  });

  it("layer warnings surface without echoing values", async () => {
    const root = await tempRoot();
    await writeFile(join(root, ".env"), "CASTOR_LLM_API_KEY=sk-castor\nINKOS_LLM_API_KEY=sk-legacy\n", "utf-8");
    const layers = await loadLLMEnvLayers(root, { ...CLEAN_ENV });
    const all = JSON.stringify(layers.warnings ?? []);
    expect(all).toContain("INKOS_LLM_API_KEY");
    expect(all).not.toContain("sk-castor");
    expect(all).not.toContain("sk-legacy");
  });
});
