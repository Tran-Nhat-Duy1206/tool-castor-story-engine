import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSecrets } from "../llm/secrets.js";

describe("loadSecrets legacy service id migration", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "castor-secrets-mig-"));
    await mkdir(join(root, ".castor"), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function seedSecrets(data: unknown): Promise<void> {
    await writeFile(join(root, ".castor", "secrets.json"), JSON.stringify(data, null, 2), "utf-8");
  }

  async function readSecretsRaw(): Promise<any> {
    return JSON.parse(await readFile(join(root, ".castor", "secrets.json"), "utf-8"));
  }

  it("siliconflow -> siliconcloud mock_text（mock_text id mock_text）", async () => {
    await seedSecrets({ services: { siliconflow: { apiKey: "sk-legacy" } } });
    const result = await loadSecrets(root);
    expect(result.services.siliconcloud).toEqual({ apiKey: "sk-legacy" });
    expect(result.services.siliconflow).toBeUndefined();

    const onDisk = await readSecretsRaw();
    expect(onDisk.services.siliconcloud).toEqual({ apiKey: "sk-legacy" });
    expect(onDisk.services.siliconflow).toBeUndefined();
  });

  it("mock_text id mock_text（mock_text）", async () => {
    await seedSecrets({
      services: {
        siliconflow: { apiKey: "sk-legacy" },
        siliconcloud: { apiKey: "sk-new" },
      },
    });
    const result = await loadSecrets(root);
    expect(result.services.siliconcloud).toEqual({ apiKey: "sk-new" });
    expect(result.services.siliconflow).toEqual({ apiKey: "sk-legacy" });
  });

  it("mock_text", async () => {
    await seedSecrets({ services: { openai: { apiKey: "sk-openai" } } });
    const before = await readFile(join(root, ".castor", "secrets.json"), "utf-8");
    await loadSecrets(root);
    const after = await readFile(join(root, ".castor", "secrets.json"), "utf-8");
    expect(after).toBe(before);
  });

  it("secrets mock_text services,mock_text", async () => {
    await rm(join(root, ".castor", "secrets.json"), { force: true });
    const result = await loadSecrets(root);
    expect(result).toEqual({ services: {} });
  });

  it("mock_text loadSecrets mock_text", async () => {
    await seedSecrets({ services: { siliconflow: { apiKey: "sk-legacy" } } });
    await loadSecrets(root);
    const r2 = await loadSecrets(root);
    expect(r2.services.siliconcloud).toEqual({ apiKey: "sk-legacy" });
    expect(r2.services.siliconflow).toBeUndefined();
  });
});
