import { execSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

/**
 * Rebuild @actalk/castor-core before E2E tests start.
 *
 * The E2E API server (tsx watch src/api/index.ts) imports core via the pnpm
 * workspace symlink, which resolves to packages/core/dist/index.js — the
 * compiled output, not the TypeScript source.  If dist/ is stale the server
 * runs old code regardless of what the TypeScript sources say, causing
 * otherwise-correct agent logic (e.g. the terminalToolResultTail guard) to be
 * silently absent at runtime.
 *
 * Rebuilding here ensures the dist is always fresh before tests run.
 */
export default function globalSetup(): void {
  const thisFile = fileURLToPath(import.meta.url);
  // From packages/studio/e2e: ../ = studio, ../../ = packages, ../../../ = the
  // worktree/workspace root (where pnpm-workspace.yaml lives). A fourth ../ would
  // point at the .worktrees parent, where the --filter matches nothing and the
  // build silently no-ops, leaving core dist stale (agent stub absent at runtime).
  const workspaceRoot = path.resolve(path.dirname(thisFile), "../../../");
  execSync("pnpm --filter @actalk/castor-core build", {
    cwd: workspaceRoot,
    stdio: "inherit",
  });
}
