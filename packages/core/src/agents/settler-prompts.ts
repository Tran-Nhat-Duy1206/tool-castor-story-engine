import type { BookConfig } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";
import type { BookRules } from "../models/book-rules.js";

export function buildSettlerSystemPrompt(
  book: BookConfig,
  genreProfile: GenreProfile,
  bookRules: BookRules | null,
  language?: "vi" | "en",
): string {
  const resolvedLang = language ?? genreProfile.language;
  const outputLanguageInstruction = resolvedLang === "en"
    ? "Output in English."
    : "Output in Vietnamese.";
  const numericalBlock = genreProfile.numericalSystem
    ? `\n- This genre has a numerical/resource system. You must track every resource change shown in the chapter in UPDATED_LEDGER
- Numerical reconciliation is mandatory: opening value + change = closing value; all three must be verifiable`
    : `\n- This genre has no numerical system; leave UPDATED_LEDGER empty`;

  const hookRules = `
## Hook Tracking Rules (Strict)

- New hook: add a hook_id only when the chapter introduces an unresolved question that will continue into later chapters and has a concrete payoff direction. Do not create a new hook for a rephrasing, restatement, or abstract summary of an existing hook
- Mentioned hook: when an existing hook is mentioned in this chapter but no new information appears and neither the reader's nor a character's understanding changes, put it in the mention array; do not update its latest advancement
- Advanced hook: when an existing hook gains a new fact, evidence, relationship change, risk escalation, or narrowed scope in this chapter, you **must** set its lastAdvancedChapter to the current chapter number and update its status and notes
- Resolved hook: when a hook is explicitly revealed, resolved, or invalidated in this chapter, set its status to "resolved" and describe how it was resolved in notes
- Deferred hook: mark a hook "deferred" only when the chapter explicitly shows that its thread is deliberately set aside, moved into the background, or postponed by the plot. Do not defer it mechanically just because several chapters have passed
- The current hook pool includes both active hooks and dormant seeds semantically relevant to this chapter. Dormant does not mean irrelevant: if this chapter activates, reframes, or makes one concrete, reuse its existing hookId and update its status, expected payoff, and notes in hookOps.upsert
- Determining whether a new expression in the chapter is still the same narrative promise is your semantic responsibility. Even if characters, numbers, evidence forms, or wording change, update the existing hookId whenever it continues the same mystery, conflict, or payoff promise; do not create a separate candidate
- Use newHookCandidates only for an entirely new narrative promise that no entry in the current hook pool can represent. The host validates structure only and will not infer semantic ownership from keywords
- Use semantic pacing for payoffTiming, not hard-coded chapter numbers. Allowed values: immediate / near-term / mid-arc / slow-burn / endgame
- **Mandatory rule**: do not treat another mention, a rephrased restatement, or an abstract recap as advancement. Update lastAdvancedChapter only when the state genuinely changes. Put an existing hook that merely appears into the mention array.`;

  const fullCastBlock = bookRules?.enableFullCastTracking
    ? `\n## Full-Cast Tracking\nPOST_SETTLEMENT must additionally include: characters appearing in this chapter, relationship changes between characters, and characters who are mentioned but do not appear.`
    : "";

  const langPrefix = `[OUTPUT LANGUAGE] ${outputLanguageInstruction} Apply this to all generated prose and values, including the state card, hooks, summaries, subplots, emotional arcs, and character matrix. Keep all === TAG === markers and JSON keys/enums unchanged.\n\n`;

  return `${langPrefix}You are a state-tracking analyst. Given a new chapter and the current truth files, produce the updates to those truth files.

## Operating Mode

You are not writing fiction. Your task is to:
1. Read the chapter carefully and extract every state change
2. Apply incremental updates based on the current tracking files
3. Follow the required === TAG === output format exactly

## Analysis Dimensions

Extract the following information from the chapter:
- Character appearances, exits, and state changes (injury, breakthrough, death, etc.)
- Movement and scene transitions
- Acquisition and consumption of items/resources
- Introduction, advancement, and resolution of hooks
- Emotional-arc changes
- Subplot progress
- Relationship changes and new information boundaries between characters

## Book Information

- Title: ${book.title}
- Genre: ${genreProfile.name} (${book.genre})
- Platform: ${book.platform}
${numericalBlock}
${hookRules}${fullCastBlock}

## Output Format (Follow Exactly)

${buildSettlerOutputFormat(genreProfile)}

## Key Rules

1. Update the state card and hook pool incrementally from the current tracking files; do not start over
2. Reflect every factual change in the chapter in the corresponding tracking file
3. Do not omit details: record numerical, location, relationship, and information changes
4. Keep information boundaries in the character interaction matrix accurate: a character knows only what they witnessed or otherwise learned

## Mandatory Rule: Record Only What Actually Happens in the Chapter

- **Extract only events and state changes explicitly depicted in the chapter.** Do not infer, predict, or add anything not written in the chapter
- If the chapter only says a character reaches a doorway without entering, the state card must not say that the character entered the room
- If the chapter merely suggests a possibility without confirming it, do not record it as an established fact
- Do not import plot points from the volume outline or other outlines before the chapter reaches them
- Do not delete or modify existing hooks unrelated to this chapter; update only hooks involved in the chapter
- For Chapter 1 in particular, the initial tracking files may contain outline-generated material. Retain only what the actual chapter supports; do not retain presets absent from the chapter
- **Hook exception**: unresolved questions, suspense, and hook clues present in the chapter must be recorded in hooks. This is not inference; it is extraction of narrative promises from the text. If the chapter suggests a mystery, conflict, or secret without answering it, it is a hook and must be recorded`;
}

function buildSettlerOutputFormat(gp: GenreProfile): string {
  const chapterTypeExample = gp.chapterTypes.length > 0
    ? gp.chapterTypes[0]
    : "main plot advancement";

  return `=== POST_SETTLEMENT ===
(Briefly describe state changes, hook advancement, and settlement considerations in this chapter; Markdown tables or bullet points are allowed)

=== RUNTIME_STATE_DELTA ===
(Output valid JSON only; do not add Markdown or explanations)
\`\`\`json
{
  "chapter": 12,
  "currentStatePatch": {
    "currentLocation": "optional",
    "protagonistState": "optional",
    "currentGoal": "optional",
    "currentConstraint": "optional",
    "currentAlliances": "optional",
    "currentConflict": "optional"
  },
  "hookOps": {
    "upsert": [
      {
        "hookId": "mentor-oath",
        "startChapter": 8,
        "type": "relationship",
        "status": "progressing",
        "lastAdvancedChapter": 12,
        "expectedPayoff": "reveal the truth behind the debt to the mentor",
        "payoffTiming": "slow-burn",
        "notes": "why this hook advances, is deferred, or is resolved in this chapter"
      }
    ],
    "mention": ["hookId mentioned without genuine advancement in this chapter"],
    "resolve": ["resolved hookId"],
    "defer": ["deferred hookId"]
  },
  "newHookCandidates": [
    {
      "type": "mystery",
      "expectedPayoff": "what this new hook should eventually pay off",
      "payoffTiming": "near-term",
      "notes": "why this chapter creates a new unresolved question"
    }
  ],
  "chapterSummary": {
    "chapter": 12,
    "title": "chapter title",
    "characters": "character 1, character 2",
    "events": "one-sentence summary of key events",
    "stateChanges": "one-sentence summary of state changes",
    "hookActivity": "mentor-oath advanced",
    "mood": "tense",
    "chapterType": "${chapterTypeExample}"
  },
  "subplotOps": [],
  "emotionalArcOps": [],
  "characterMatrixOps": [],
  "notes": []
}
\`\`\`

Rules:
1. Output deltas only; do not rewrite complete truth files
2. Every chapter-number field must be an integer, not natural-language text
3. hookOps.upsert may contain only hookIds already present in the current hook pool; never invent a new hookId. Reuse the existing id whenever the same narrative promise continues semantically
4. Add a brand-new unresolved thread to newHookCandidates only after confirming that the current hook pool contains no equivalent narrative promise
5. If an old hook is only mentioned without a genuine state change, put it in mention and do not update lastAdvancedChapter
6. If this chapter advances an old hook, lastAdvancedChapter must equal the current chapter number
7. If this chapter resolves or defers a hook, include it in the resolve or defer array
8. chapterSummary.chapter must equal the current chapter number`;
}

export function buildSettlerUserPrompt(params: {
  readonly chapterNumber: number;
  readonly title: string;
  readonly content: string;
  readonly currentState: string;
  readonly ledger: string;
  readonly hooks: string;
  readonly chapterSummaries: string;
  readonly subplotBoard: string;
  readonly emotionalArcs: string;
  readonly characterMatrix: string;
  readonly volumeOutline: string;
  readonly observations?: string;
  readonly selectedEvidenceBlock?: string;
  readonly governedControlBlock?: string;
  readonly validationFeedback?: string;
}): string {
  const ledgerBlock = params.ledger
    ? `\n## Current Resource Ledger\n${params.ledger}\n`
    : "";

  const summariesBlock = params.chapterSummaries !== "(file not created yet)"
    ? `\n## Existing Chapter Summaries\n${params.chapterSummaries}\n`
    : "";

  const subplotBlock = params.subplotBoard !== "(file not created yet)"
    ? `\n## Current Subplot Board\n${params.subplotBoard}\n`
    : "";

  const emotionalBlock = params.emotionalArcs !== "(file not created yet)"
    ? `\n## Current Emotional Arcs\n${params.emotionalArcs}\n`
    : "";

  const matrixBlock = params.characterMatrix !== "(file not created yet)"
    ? `\n## Current Character Interaction Matrix\n${params.characterMatrix}\n`
    : "";

  const observationsBlock = params.observations
    ? `\n## Observation Log (Extracted by the Observer; Includes All Factual Changes in This Chapter)\n${params.observations}\n\nUse the observation log and chapter text above to update every tracking file. Ensure that each change in the observation log appears in the corresponding file.\n`
    : "";
  const selectedEvidenceBlock = params.selectedEvidenceBlock
    ? `\n## Selected Long-Range Evidence\n${params.selectedEvidenceBlock}\n`
    : "";
  const controlBlock = params.governedControlBlock ?? "";
  const outlineBlock = controlBlock.length === 0
    ? `\n## Volume Outline\n${params.volumeOutline}\n`
    : "";
  const validationFeedbackBlock = params.validationFeedback
    ? `\n## State Validation Feedback\n${params.validationFeedback}\n\nCorrect these contradictions strictly. Modify only the truth files; do not rewrite the chapter or introduce facts absent from it.\n`
    : "";

  return `Analyze the text of Chapter ${params.chapterNumber}, "${params.title}", and update every tracking file.
${observationsBlock}
${validationFeedbackBlock}
## Chapter Text

${params.content}
${controlBlock}

## Current State Card
${params.currentState}
${ledgerBlock}
## Current Hook Pool (Including Active Hooks and Dormant Seeds Semantically Relevant to This Chapter)
${params.hooks}
${selectedEvidenceBlock}${summariesBlock}${subplotBlock}${emotionalBlock}${matrixBlock}
${outlineBlock}

Output the settlement result using the exact === TAG === format.`;
}
