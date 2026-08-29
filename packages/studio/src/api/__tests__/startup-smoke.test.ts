import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, access, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Studio startup contract test.
 *
 * Launches the real Studio server entry exactly the way the CLI launches it
 * (`node --import <tsx loader> packages/studio/src/api/index.ts <root>` with
 * CASTOR_STUDIO_PORT), on an ephemeral port against a disposable project root,
 * and asserts the announced HTTP endpoint becomes reachable.
 *
 * The child imports Core through the real package boundary (Core dist), so a
 * missing named export in the Core public barrel crashes the child before the
 * server binds — exactly the production failure mode. The Core barrel is
 * deliberately NOT mocked.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const studioPackageRoot = resolve(__dirname, "..", "..", "..");
const repoRoot = resolve(studioPackageRoot, "..", "..");
const studioEntry = join(studioPackageRoot, "src", "api", "index.ts");
const tsxLoader = join(studioPackageRoot, "node_modules", "tsx", "dist", "loader.mjs");
const frontendIndex = join(studioPackageRoot, "dist", "index.html");

async function getFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address && typeof address === "object") {
        const port = address.port;
        probe.close(() => resolvePort(port));
      } else {
        probe.close(() => reject(new Error("failed to obtain a free port")));
      }
    });
  });
}

async function waitForHttpReady(
  port: number,
  child: ChildProcess,
  deadlineMs: number,
): Promise<{ ok: true } | { ok: false; reason: string; stderr: string }> {
  type Failure = { ok: false; reason: string; stderr: string };
  const deadline = Date.now() + deadlineMs;
  let stderr = "";
  const failure = new Promise<Failure>((resolveFailure) => {
    child.once("exit", (code, signal) => {
      resolveFailure({
        ok: false,
        reason: `Studio server process exited before becoming reachable (code=${code}, signal=${signal})`,
        stderr,
      });
    });
  });
  child.stderr?.setEncoding("utf-8");
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });

  while (Date.now() < deadline) {
    const exited = await Promise.race([
      failure,
      new Promise<false>((resolveRace) => setTimeout(() => resolveRace(false), 250)),
    ]);
    if (exited) return exited;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(1500),
      });
      // Any HTTP response proves the server bound its port and answers.
      return { ok: true };
    } catch {
      // not ready yet — keep polling until the deadline
    }
  }
  return { ok: false, reason: `Studio server did not become reachable within ${deadlineMs}ms`, stderr };
}

describe("studio startup smoke", () => {
  let projectRoot: string;
  const startedChildren: ChildProcess[] = [];

  beforeAll(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "castor-studio-startup-smoke-"));
    // The Studio entry expects a normal project root (config + books dir),
    // the same minimal shape the CLI creates for a fresh project.
    await mkdir(join(projectRoot, "books"), { recursive: true });
    await writeFile(
      join(projectRoot, "castor.json"),
      JSON.stringify(
        {
          name: "castor-studio-startup-smoke",
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
          daemon: {
            schedule: { radarCron: "0 */6 * * *", writeCron: "*/15 * * * *" },
            maxConcurrentBooks: 3,
          },
        },
        null,
        2,
      ),
      "utf-8",
    );
  });

  afterAll(async () => {
    for (const child of startedChildren.splice(0)) {
      if (child.exitCode === null && !child.killed) {
        const exited = new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
        child.kill();
        // Let the child release its handles (notably on Windows) before the
        // temp project root is removed, so cleanup cannot race the shutdown.
        await Promise.race([exited, new Promise((resolveWait) => setTimeout(resolveWait, 3000))]);
      }
    }
    if (projectRoot) {
      await rm(projectRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("boots the Studio server and answers HTTP on the announced port", async () => {
    // Smoke contract: the frontend must be pre-built (`pnpm build`), otherwise
    // the entry silently spends minutes running `npx vite build` first.
    await expect(
      access(frontendIndex),
      "packages/studio/dist/index.html is missing — run `pnpm build` before the startup smoke test",
    ).resolves.toBeUndefined();

    const port = await getFreePort();
    const child = spawn("node", ["--import", pathToFileURL(tsxLoader).href, studioEntry, projectRoot], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CASTOR_STUDIO_PORT: String(port) },
    });
    startedChildren.push(child);

    const outcome = await waitForHttpReady(port, child, 25_000);
    if (!outcome.ok) {
      const tail = outcome.stderr.trim().split(/\r?\n/).slice(-15).join("\n");
      throw new Error(`${outcome.reason}\n--- child stderr (last 15 lines) ---\n${tail}`);
    }

    const response = await fetch(`http://127.0.0.1:${port}/`, {
      signal: AbortSignal.timeout(5000),
    });
    expect(response.status).toBe(200);
  }, 40_000);
});
