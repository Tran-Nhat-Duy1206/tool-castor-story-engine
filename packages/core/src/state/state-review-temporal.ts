/**
 * SINGLE temporal-position authority for State Review anchors (design §20).
 *
 *   effectiveChapter = sourceChapter <= confirmedSemanticHead
 *     ? confirmedSemanticHead + 1   // historical / head-parallel source
 *     : sourceChapter               // normal pending chapter
 *
 * `confirmedHead` is ALWAYS the live CONFIRMED SEMANTIC head
 * (`readLiveRuntimeStateSnapshot(bookDir).manifest.lastAppliedChapter`),
 * never the prose chapter-file prefix: after forward-governed historical
 * corrections the semantic head may legitimately lead the prose prefix, and
 * prose SOURCE chapters are not semantic EFFECTIVE slots.
 */

export function resolveEffectiveChapter(sourceChapter: number, confirmedHead: number): number {
  return sourceChapter <= confirmedHead ? confirmedHead + 1 : sourceChapter;
}
