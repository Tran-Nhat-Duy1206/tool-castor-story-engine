import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Failure injection (spec §15 / §16.5, plan Task 4.2): fail the legacy→staging
// copy. The adapter must leave NO canonical residue so the next attempt
// retries cleanly instead of being permanently blocked by an empty or partial
// canonical directory.
const cpState = { failNext: false };
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    cp: (async (src: Parameters<typeof actual.cp>[0], dest: Parameters<typeof actual.cp>[1], opts?: Parameters<typeof actual.cp>[2]) => {
      if (cpState.failNext && String(src).includes(".inkos")) {
        cpState.failNext = false;
        throw new Error("Injected IO failure during migration copy");
      }
      return actual.cp(src, dest, opts);
    }) as typeof actual.cp,
  };
});

import { castorRuntimePath, resolveRuntimePath } from "../config/runtime-dir.js";

let roots: string[] = [];
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "castor-runtime-failure-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  cpState.failNext = false;
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true }).catch(() => undefined)));
});

describe("runtime migration failure injection", () => {
  it("directory resource: failed copy leaves no canonical residue; retry succeeds", async () => {
    const root = await tempRoot();
    const legacyDir = join(root, ".inkos", "materials");
    await mkdir(legacyDir, { recursive: true });
    await writeFile(join(legacyDir, "b.md"), "legacy content", "utf-8");

    cpState.failNext = true;
    await expect(resolveRuntimePath(root, "materials")).rejects.toThrow("Injected IO failure");
    await expect(readFile(castorRuntimePath(root, "materials", "b.md"), "utf-8")).rejects.toBeTruthy();

    // Retry after the transient failure exposes the legacy content.
    const dir = await resolveRuntimePath(root, "materials");
    expect(await readFile(join(dir, "b.md"), "utf-8")).toBe("legacy content");
  });

  it("file resource: failed copy leaves no canonical residue; retry succeeds", async () => {
    const root = await tempRoot();
    const legacyDir = join(root, ".inkos");
    await mkdir(legacyDir, { recursive: true });
    await writeFile(join(legacyDir, "secrets.json"), '{"services":{}}', "utf-8");

    cpState.failNext = true;
    await expect(resolveRuntimePath(root, "secrets.json")).rejects.toThrow("Injected IO failure");
    await expect(readFile(castorRuntimePath(root, "secrets.json"), "utf-8")).rejects.toBeTruthy();

    const resolved = await resolveRuntimePath(root, "secrets.json");
    expect(await readFile(resolved, "utf-8")).toBe('{"services":{}}');
  });

  it("staging debris from a failed attempt does not leak into the canonical tree", async () => {
    const root = await tempRoot();
    const legacyDir = join(root, ".inkos", "materials");
    await mkdir(legacyDir, { recursive: true });
    await writeFile(join(legacyDir, "b.md"), "legacy content", "utf-8");

    cpState.failNext = true;
    await expect(resolveRuntimePath(root, "materials")).rejects.toThrow("Injected IO failure");

    const { readdir } = await import("node:fs/promises");
    const castorDir = join(root, ".castor");
    const entries = await readdir(castorDir).catch(() => [] as string[]);
    expect(entries.filter((e) => e.startsWith("materials"))).toEqual([]);
    expect(entries.filter((e) => e.startsWith(".castor-migrate-"))).toEqual([]);
  });
});
