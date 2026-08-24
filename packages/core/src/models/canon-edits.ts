import { z } from "zod";

/**
 * P3A Core-owned Canon edit contract (T3A.1).
 *
 * This module is the SINGLE semantic source for manual Canon mutations.
 * - The Studio server imports these Zod schemas at runtime to validate request
 *   bodies — no duplicate Studio-local contract may exist.
 * - The browser client consumes the TypeScript types via TYPE-ONLY imports
 *   only (the package exports map keeps the core main entry out of browser
 *   bundles).
 *
 * Scope is deliberately narrow: `setFact` / `removeFact` on current-state
 * facts. No raw whole-state replacement, no filesystem paths, no hook or
 * chapter-summary operations, and NO origin/provenance fields (amended D5).
 */

export const CanonEditSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("setFact"),
    subject: z.string().trim().min(1),
    predicate: z.string().trim().min(1),
    object: z.string().trim().min(1),
  }).strict(),
  z.object({
    kind: z.literal("removeFact"),
    subject: z.string().trim().min(1),
    predicate: z.string().trim().min(1),
  }).strict(),
]);

export type CanonEdit = z.infer<typeof CanonEditSchema>;

export const CanonCommitRequestSchema = z.object({
  edits: z.array(CanonEditSchema).min(1),
  expectedRevision: z.string().min(8),
});

export type CanonCommitRequest = z.infer<typeof CanonCommitRequestSchema>;
