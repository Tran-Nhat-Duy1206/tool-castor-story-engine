import { createHash } from "node:crypto";

/**
 * Task 2 — prose revision + deterministic evidence verification (Phase 4).
 *
 * Pure string helpers ONLY: no filesystem access, no Canon loaders, no LLM or
 * semantic classifier, no global mutation. Later tasks read the exact durable
 * chapter-file bytes and pass that exact string into `computeProseRevision`.
 */

/**
 * Deterministic 16-hex fingerprint of the EXACT content bytes (UTF-8).
 *
 * Mirrors the repo's revision convention (`computeCanonRevision`,
 * canon-service.ts:167). Deliberately performs NO Unicode normalization:
 * composed and decomposed forms that render identically are DIFFERENT durable
 * byte sequences and therefore different revisions.
 */
export function computeProseRevision(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16);
}

/**
 * Exact deterministic normalization for evidence quote matching:
 *   1. Unicode NFC normalization
 *   2. collapse consecutive whitespace (/\s+/g) to one ASCII space
 *   3. trim
 *   4. lowercase
 *
 * Nothing else: punctuation stays significant, CJK-internal spacing is never
 * invented away, no accent stripping, no stemming/tokenization/fuzzy matching.
 */
export function normalizeForEvidenceMatch(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Deterministic quote-presence verification against the bound prose.
 *
 * Fails closed on an empty normalized quote so empty/whitespace-only evidence
 * can never be classified as verified-explicit via "".includes("") === true.
 */
export function evidenceQuoteVerified(quote: string, prose: string): boolean {
  const normalizedQuote = normalizeForEvidenceMatch(quote);
  if (normalizedQuote.length === 0) return false;
  return normalizeForEvidenceMatch(prose).includes(normalizedQuote);
}
