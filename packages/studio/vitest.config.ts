import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      // Subpath aliases must precede the bare package alias: a string alias also
      // matches `<key>/...`, so the bare entry would otherwise swallow these.
      // The app/build resolves these subpaths via core's package.json "exports"
      // (browser-safe, zod-only); tests resolve them to source like the bare pkg.
      "@actalk/castor-core/interactive-film/evaluator": resolve(__dirname, "../core/src/interactive-film/evaluator.ts"),
      "@actalk/castor-core/interactive-film/graph-schema": resolve(__dirname, "../core/src/interactive-film/graph-schema.ts"),
      "@actalk/castor-core/forecast/schema": resolve(__dirname, "../core/src/forecast/schema.ts"),
      "@actalk/castor-core": resolve(__dirname, "../core/src/index.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    fileParallelism: false,
    // server.ts is large enough that first-load esbuild transforms can exceed
    // Vitest's default 5s timeout on a cold full-suite run.
    testTimeout: 30_000,
  },
});
