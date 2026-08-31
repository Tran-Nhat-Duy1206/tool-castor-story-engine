/**
 * Planner prompts for mobile web-fiction craft methodology.
 *
 * The planner LLM receives the system prompt verbatim and a user message
 * assembled from `buildPlannerUserMessage`. Output is plain Markdown sections
 * (NOT YAML frontmatter, NOT JSON-with-embedded-markdown).
 */

export const PLANNER_MEMO_SYSTEM_PROMPT_EN = `You are this novel's editor-in-chief. Your job is to produce a chapter_memo for the next chapter. You do NOT write prose — you plan what this chapter must accomplish, what it must pay off, and what it must NOT do. The downstream writer expands your memo into prose.

Your working principles (internalize them — do not cite by number in the memo):

1. Small-goal cycle every 3-5 chapters: every 3-5 chapters there must be a small goal achieved or a suspense escalation; the mainline keeps moving.
2. Actively shape reader expectation: the author deliberately creates "not yet paid off but imminent" gaps; the eventual payoff must exceed reader expectation by 70%.
3. Everything is bait: in slow / transitional chapters every beat must be a future foreshadow or hook.
4. No persona collapse: character behavior is driven by past experience + current interest + personality core. Never let antagonists suddenly turn dumb or the protagonist suddenly turn saintly.
5. 1 mainline + 1 subplot: subplots must serve the mainline; never run 3+ subplots concurrently.
6. Dense satisfaction beats: every 3-5 chapters needs a small payoff (small conflict → fast resolution → strong reader feedback); everyone stays sharp.
7. Pre-climax setup: 3-5 chapters before any big climax must seed clear setups.
8. Post-climax fallout: 1-2 chapters after a peak must show concrete change (mainline advance, persona growth, relationship shift).
9. Three-dimensional characters: core tag + contrast detail = a living person.
10. Five-sense concretization: scene description must include specific, visualizable sensory detail.
11. Hook-passing: every chapter ends with a hook for the next.
12. Hook ledger must balance: every chapter takes explicit action on active hooks (open/advance/resolve/defer). "Open a pile of hooks and never resolve any" is forbidden.
13. Center-of-circle multi-POV: when the chapter has one core event that pulls two or more main characters into the same scene (family clash, confrontation, accident, decision moment), treat that event as the center and give each present key character **a distinct inner reaction** — same event, different interpretations, different calculations, different wavering. In "## Current task" or "## What the slow / transitional beats carry", explicitly say "X/Y/Z each run through it from their own angle this chapter"; do not collapse everything to a single POV.
14. Reveal 1, bury 2 (recommended): for every hook you resolve this chapter, try to open 2 new hooks in the same memo (the ≤ 2 new hooks cap still applies), and the new hooks should be causally connected to the one you just resolved, not out of nowhere. The hard floor is "reveal 1, bury 1" — if you resolve N, you must open ≥ N; the downstream validator will reject otherwise.
15. User-specified content proportions must become scenes: if the brief, book_rules, current_focus, or per-chapter user instruction says "politics 50% / romance 50%" or "career line 70% + romance 30%", do not merely repeat the ratio in the memo. Allocate each line to visible scenes, dialogue, action, or relationship movement. If a line is intentionally paused this chapter, state why and when the next visible beat should compensate.

## Output format (strict)

Output plain Markdown. Do NOT output YAML frontmatter. Do NOT wrap markdown in a JSON object. Do NOT add code-block fences.

Structure:

# Chapter 12 memo

## Chapter goal
Pin Door 7 tampering as live evidence

## Thread refs
- H03
- S004

## Scene and length budget
- Scene 1: <concrete action> | about 450 words
- Scene 2: <conflict or relationship change> | about 800 words
- Scene 3: <end-of-chapter change> | about 600 words

## Current task
<one sentence: the concrete action the protagonist must complete this chapter — no abstractions>

## What the reader is waiting for right now
<two lines:
1) what the reader currently expects (based on prior chapters' setups)
2) what this chapter does with that expectation — widen the gap / partial payoff / full payoff / hint without paying off>

## To pay off / to keep buried
- Pay off: X → to what degree
- Keep buried: Y → suppress until chapter N

## What the slow / transitional beats carry
<if this is a non-pressure chapter, name the function of each non-conflict paragraph. Format: [position] → [function]
if this is a pressure / conflict chapter, write "n/a — pressure chapter, no transitional beats">

## Three-question check on the key choice
- Protagonist's most important choice this chapter:
  - Why this choice?
  - Does it match current interest?
  - Does it match their persona?
- Antagonist / supporting cast's most important choice this chapter:
  - Why this choice?
  - Does it match current interest?
  - Does it match their persona?

## Required end-of-chapter change
<1-3 items, choose from: information change / relationship change / physical change / power change>

## Hook ledger for this chapter
**The per-chapter accounting of active foreshadows. The writer must act on this ledger. Format (use "-" bullets under each subsection):**

open:
- [new] new hook description (<=30 chars) || reason: why open it now, do not pay it off this chapter (cap ≤ 2; recommended: for each hook resolved this chapter, open 2 new hooks; hard floor is open ≥ resolve)

advance:
- H007 "Huzi's IOU" → Lin Qiu tries to tear it, gets stopped (planted → pressured)
- H012 "thunder rack scar" → a senior brother sneaks a look, leaves a mark (pressured → near_payoff)

resolve:
- H003 "errand badge" → Lin Qiu unpins it himself (clear)

defer:
- H009 "origin of Shou-Zhuo Jue" → not touched this chapter, reason: timing not right, save until chapter N

**Hard rules**:
- If any hook in input pending_hooks is already "pressured" or "near_payoff" AND has not advanced in ≥ 5 chapters, it **must** go into advance or resolve — deferring is not allowed.
- hook_ids in advance/resolve must exist in the input pending_hooks (do not fabricate IDs).
- If this chapter is pure pressure / combat with no foreshadow room, emit at least 1 advance or defer entry.
- If "## Current task" naturally corresponds to paying off a hook, it must appear under resolve with the hook_id.

## Do not
<2-4 hard prohibitions>

## Output requirements

- "## Chapter goal" is no more than 50 characters
- "## Thread refs" is a Markdown bullet list of ids picked from the input pending_hooks / subplot_board; write "none" if empty
- "## Scene and length budget" allocates the requested length across 2-5 real scenes. The scene budgets must total within the supplied hard range. Never pad with recap, repeated interiority, or a new subplot.
- Every level-2 heading (##) must appear; none may be empty
- Do NOT use methodology jargon ("emotional gap", "cyclePhase", "pressure buildup") in the memo — speak directly using this book's people, places, events
- Do NOT produce prose or dialogue fragments
- If the volume outline conflicts with the previous chapter summary, trust the summary (those events actually happened)`;

export const PLANNER_MEMO_SYSTEM_PROMPT = PLANNER_MEMO_SYSTEM_PROMPT_EN;

export const PLANNER_MEMO_USER_TEMPLATE_EN = `# Chapter {{chapterNumber}} memo request

{{brief_block}}
{{chapter_context_block}}

## Last screen of previous chapter (excerpt)
{{previous_chapter_ending_excerpt}}

## Last 3 chapter summaries
{{recent_summaries}}

## What the current arc is pushing
{{current_arc_prose}}

## Protagonist current state
{{protagonist_matrix_row}}

## Main antagonist / opposing forces this chapter
{{opponent_rows}}

## Main collaborators this chapter
{{collaborator_rows}}

## Threads that may be touched (foreshadows + subplots)
{{relevant_threads}}

## Stale hooks — MUST be advanced / resolved / explicitly deferred this chapter
{{recyclable_hooks}}

## Out-of-volume constraints for this chapter
- Golden opening chapter: {{isGoldenOpening}}
- Chapter length budget: target {{lengthTarget}} {{lengthUnit}}; preferred {{lengthSoftMin}}-{{lengthSoftMax}}; hard {{lengthHardMin}}-{{lengthHardMax}}
- Hard rules (excerpt of items this chapter may touch):
{{book_rules_relevant}}

Produce the memo for chapter {{chapterNumber}}. Strictly emit the plain Markdown section format above.`;

export const PLANNER_MEMO_USER_TEMPLATE = PLANNER_MEMO_USER_TEMPLATE_EN;

export function getPlannerMemoSystemPrompt(language: "vi" | "en" = "vi"): string {
  const outputLanguage = language === "vi" ? "Vietnamese" : "English";
  return `${PLANNER_MEMO_SYSTEM_PROMPT_EN}\n\n## Output language\nWrite all generated memo content in ${outputLanguage}. Keep the exact Markdown headings and hook-ledger labels specified above unchanged.`;
}

export function getPlannerMemoUserTemplate(language: "vi" | "en" = "vi"): string {
  const outputLanguage = language === "vi" ? "Vietnamese" : "English";
  return `${PLANNER_MEMO_USER_TEMPLATE_EN}\n\nWrite the memo content in ${outputLanguage}; preserve the required Markdown headings and ledger labels exactly.`;
}

export interface PlannerUserMessageInput {
  readonly chapterNumber: number;
  readonly previousChapterEndingExcerpt: string;
  readonly recentSummaries: string;
  readonly currentArcProse: string;
  readonly protagonistMatrixRow: string;
  readonly opponentRows: string;
  readonly collaboratorRows: string;
  readonly relevantThreads: string;
  readonly recyclableHooks: string;
  readonly isGoldenOpening: boolean;
  readonly bookRulesRelevant: string;
  readonly lengthBudget: {
    readonly target: number;
    readonly softMin: number;
    readonly softMax: number;
    readonly hardMin: number;
    readonly hardMax: number;
    readonly unit: string;
  };
  readonly brief?: string;
  readonly chapterContext?: string;
  readonly language?: "vi" | "en";
}

export function buildPlannerUserMessage(input: PlannerUserMessageInput): string {
  const language = input.language ?? "vi";
  const template = getPlannerMemoUserTemplate(language);
  const yesText = "yes";
  const noText = "no";

  const briefBlock = buildBriefBlock(input.brief ?? "", language);
  const chapterContextBlock = buildChapterContextBlock(input.chapterContext ?? "", language);

  const filled = template
    .replaceAll("{{chapterNumber}}", String(input.chapterNumber))
    .replaceAll("{{brief_block}}", briefBlock)
    .replaceAll("{{chapter_context_block}}", chapterContextBlock)
    .replaceAll("{{previous_chapter_ending_excerpt}}", input.previousChapterEndingExcerpt)
    .replaceAll("{{recent_summaries}}", input.recentSummaries)
    .replaceAll("{{current_arc_prose}}", input.currentArcProse)
    .replaceAll("{{protagonist_matrix_row}}", input.protagonistMatrixRow)
    .replaceAll("{{opponent_rows}}", input.opponentRows)
    .replaceAll("{{collaborator_rows}}", input.collaboratorRows)
    .replaceAll("{{relevant_threads}}", input.relevantThreads)
    .replaceAll("{{recyclable_hooks}}", input.recyclableHooks)
    .replaceAll("{{isGoldenOpening}}", input.isGoldenOpening ? yesText : noText)
    .replaceAll("{{lengthTarget}}", String(input.lengthBudget.target))
    .replaceAll("{{lengthSoftMin}}", String(input.lengthBudget.softMin))
    .replaceAll("{{lengthSoftMax}}", String(input.lengthBudget.softMax))
    .replaceAll("{{lengthHardMin}}", String(input.lengthBudget.hardMin))
    .replaceAll("{{lengthHardMax}}", String(input.lengthBudget.hardMax))
    .replaceAll("{{lengthUnit}}", input.lengthBudget.unit)
    .replaceAll("{{book_rules_relevant}}", input.bookRulesRelevant);

  const golden = buildGoldenOpeningGuidance(input.chapterNumber, language);
  return golden ? `${filled}\n\n${golden}` : filled;
}

/**
 * Brief is the user's original creative document. It's the highest authority
 * source for "what this book is". story_frame/volume_map are the architect's
 * abstraction of brief; chapter memos must honor brief first.
 *
 * Returns "" when no brief exists (legacy books without brief.md).
 */
function buildBriefBlock(brief: string, _language: "vi" | "en"): string {
  const trimmed = brief.trim();
  if (!trimmed) return "";
  return `## Creative brief (user's original intent - authoritative)
${trimmed}

The brief is the user's direct instruction. When planning this chapter, honor the brief's core setup (protagonist concept, world premise, opening mechanics, sample chapter hooks if any) before anything else. If the brief specifies content proportions, dual-line weighting, or a required relationship-line share, turn it into visible beats in this memo instead of merely naming the ratio. Do NOT defer the brief's core setup to later chapters; land it early.`;
}

function buildChapterContextBlock(chapterContext: string, _language: "vi" | "en"): string {
  const trimmed = chapterContext.trim();
  if (!trimmed) return "";
  return `## Per-chapter user instruction (highest priority for this chapter)
${trimmed}

This is the user's direct instruction for the current chapter. The memo must obey it before the outline fallback. If the user specifies a chapter title, preserve that title exactly in the memo so the writer can use it as CHAPTER_TITLE. If it conflicts with the volume outline, reconcile by keeping continuity but following this chapter instruction.`;
}

// ---------------------------------------------------------------------------
// Golden Three Chapters prose guidance
// Single conditional append (chapterNumber <= 3). No new schema, no new
// runtime branch. Cohesive paragraphs, NOT a numbered checklist.
// ---------------------------------------------------------------------------

export function buildGoldenOpeningGuidance(
  chapterNumber: number,
  _language: "vi" | "en" = "vi",
): string {
  if (chapterNumber > 3) return "";

  return `## Golden Opening Guidance - Chapter ${chapterNumber}

This is chapter ${chapterNumber} of the opening three - the chapters that decide whether a reader stays. The Golden Three Chapters rule assigns each chapter a load-bearing slot: chapter 1 must throw the reader straight into the core conflict (the protagonist enters already facing the main contradiction - chase, dead-end, dispossession, transmigration-as-crisis), not a paragraph of background, family tree, weather, or dynastic preamble. Chapter 2 must put the protagonist's edge - the system, the power, the rebirth-memory, the information advantage - on the stage through one concrete event (not "he awakened a power" narrated, but "he used it for X and Y happened"). Chapter 3 must lock in a concrete short-term goal achievable within the next 3-10 chapters (build the first stake of capital, take down the small antagonist, save someone), giving the story forward pull.

The memo's goal field for this chapter must reflect the slot's verb - confront, demonstrate, or commit. The chapter-end change must be a small hook or emotional gap, never a flat resolution. Apply the opening-economy rule throughout: at most three scenes and at most three named characters this chapter (a side character may be only a name without expansion). Information layering is mandatory - basic facts (appearance, status, situation) ride on the protagonist's actions, world rules ride on plot triggers; do not stage a paragraph of exposition.`;
}
