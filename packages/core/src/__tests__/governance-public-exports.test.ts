import { describe, expect, it } from "vitest";
import {
  confirmAuthorization,
  createAuthorization,
  confirmHumanDirection,
  parseHumanDirectionDraft,
  resolveDirectionConflict,
  publishArcPlan,
} from "../index.js";

/**
 * Public-boundary regression test for the Phase 5 governance API.
 *
 * Studio's server and the CLI import these names from the Core public barrel.
 * When the barrel stopped re-exporting the authorizations and arc-pipeline
 * blocks, Node ESM's strict named-export check crashed Studio at startup
 * before the HTTP server could bind. This test imports from the public barrel
 * (not the implementation modules) so that any future removal of a governance
 * export from the public boundary fails here instead of at application
 * startup.
 *
 * Note: the migration plan also lists `listAuthorizations` and
 * `getHumanDirections` as required public exports, but no function with either
 * name has ever been implemented in Core (verified against the full git
 * history of `packages/core/src/index.ts`). They are resolved through the
 * Studio server's dynamic-import fallbacks and are therefore not asserted
 * here; implementing them would be new governance API surface, which is out
 * of scope for the startup P0 repair.
 */
describe("governance public exports", () => {
  const requiredExports: ReadonlyArray<[name: string, value: unknown]> = [
    ["confirmAuthorization", confirmAuthorization],
    ["createAuthorization", createAuthorization],
    ["confirmHumanDirection", confirmHumanDirection],
    ["parseHumanDirectionDraft", parseHumanDirectionDraft],
    ["resolveDirectionConflict", resolveDirectionConflict],
    ["publishArcPlan", publishArcPlan],
  ];

  it.each(requiredExports)("%s is exported as a function from the public barrel", (_name, value) => {
    expect(value, `public barrel export "${_name}" must be defined`).toBeDefined();
    expect(typeof value).toBe("function");
  });
});
