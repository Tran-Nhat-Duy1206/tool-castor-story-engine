import type { BookConfig, FanficMode } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";
import type { BookRules } from "../models/book-rules.js";
import type { LengthSpec } from "../models/length-governance.js";
import { buildFanficCanonSection, buildCharacterVoiceProfiles, buildFanficModeInstructions } from "./fanfic-prompt-sections.js";
import { buildEnglishGenreIntro } from "./en-prompt-sections.js";
import { buildLengthSpec } from "../utils/length-metrics.js";

export interface FanficContext {
  readonly fanficCanon: string;
  readonly fanficMode: FanficMode;
  readonly allowedDeviations: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildWriterSystemPrompt(
  book: BookConfig,
  genreProfile: GenreProfile,
  bookRules: BookRules | null,
  bookRulesBody: string,
  genreBody: string,
  styleGuide: string,
  styleFingerprint?: string,
  chapterNumber?: number,
  mode: "full" | "creative" = "full",
  fanficContext?: FanficContext,
  languageOverride?: "vi" | "en",
  inputProfile: "legacy" | "governed" = "legacy",
  lengthSpec?: LengthSpec,
): string {
  const isEnglish = (languageOverride ?? genreProfile.language) === "en";
  const governed = inputProfile === "governed";
  const resolvedLengthSpec = lengthSpec ?? buildLengthSpec(book.chapterWordCount, isEnglish ? "en" : "vi");

  const outputSection = mode === "creative"
    ? buildEnglishCreativeOutputFormat(book, genreProfile, resolvedLengthSpec)
    : buildEnglishOutputFormat(book, genreProfile, resolvedLengthSpec);

  const outputLanguage = isEnglish ? "English" : "Vietnamese";
  const sections = [
    buildEnglishGenreIntro(book, genreProfile),
    `## Output Language\nWrite all generated chapter prose and generated artifact content in ${outputLanguage}. Keep required machine markers, Markdown headings, table contracts, IDs, and field names exactly as specified.`,
    buildGovernedInputContract("en", governed),
    buildChapterMemoContract("en", governed),
    buildLengthGuidance(resolvedLengthSpec, "en"),
    buildGoldenOpeningDiscipline(chapterNumber, "en"),
    bookRules?.enableFullCastTracking ? buildFullCastTracking() : "",
    buildGenreRules(genreProfile, genreBody),
    buildProtagonistRules(bookRules),
    buildNarrativePersonRule(bookRules, "en"),
    buildBookRulesBody(bookRulesBody),
    buildStyleGuide(styleGuide),
    buildStyleFingerprint(styleFingerprint),
    fanficContext ? buildFanficCanonSection(fanficContext.fanficCanon, fanficContext.fanficMode) : "",
    fanficContext ? buildCharacterVoiceProfiles(fanficContext.fanficCanon) : "",
    fanficContext ? buildFanficModeInstructions(fanficContext.fanficMode, fanficContext.allowedDeviations) : "",
    outputSection,
  ];

  return sections.filter(Boolean).join("\n\n");
}

function buildGovernedInputContract(_language: "vi" | "en", governed: boolean): string {
  if (!governed) return "";

  return `## Input Governance Contract

- Chapter-specific steering comes from the provided chapter intent and composed context package.
- The outline is the default plan, not unconditional global supremacy.
- When the runtime rule stack records an active L4 -> L3 override, follow the current task over local planning.
- Keep hard guardrails compact: canon, continuity facts, and explicit prohibitions still win.
- If an English Variance Brief is provided, obey it: avoid the listed phrase/opening/ending patterns and satisfy the scene obligation.
- If Hook Debt Briefs are provided, they contain the ORIGINAL SEED TEXT from the chapter where each hook was planted. Use this text to write a continuation or payoff that feels connected to what the reader already saw — not a vague mention, but a scene that builds on the specific promise.
- When the explicit hook agenda names an eligible resolve target, land a concrete payoff beat that answers the reader's original question from the seed chapter.
- When stale debt is present, do not open sibling hooks casually; clear pressure from old promises before minting fresh debt.
- In multi-character scenes, include at least one resistance-bearing exchange instead of reducing the beat to summary or explanation.`;
}

// ---------------------------------------------------------------------------
// Chapter memo alignment — 7 sections from mobile web-fiction craft methodology
// ---------------------------------------------------------------------------

function buildChapterMemoContract(_language: "vi" | "en", governed: boolean): string {
  if (!governed) return "";

  return `## Chapter Memo Alignment

You will receive a chapter_memo composed of 7 markdown sections:

- ## Current task → the concrete action this chapter must complete; stay aligned with it throughout
- ## What the reader is waiting for right now → controls how emotional gaps are created / delayed / paid off
- ## To pay off / to keep buried → payoffs that must land this chapter + cards you must NOT reveal
- ## What the slow / transitional beats carry → function map for non-conflict passages ([passage location] → [function])
- ## Three-question check on the key choice → three-question check every key character choice must pass
- ## Required end-of-chapter change → 1-3 concrete changes the ending must deliver (info / relation / physical / power)
- ## Hook ledger for this chapter → **hard correspondence rule**: each hook_id listed under advance/resolve MUST have a **concretely locatable payoff scene** in the prose — explicit characters acting on or talking about a specific object/event/piece of information, with observable actions. No "sideways hints" or "deferred to next chapter". Example: if the memo says 'advance: H007 Huzi\'s IOU → planted → pressured', the prose must contain a scene where Lin Qiu actually touches / sees / picks up that specific IOU and does something. An inner mention like "he remembered the IOU was still in the drawer" does NOT count. Each advance/resolve payoff scene must be at least 60 chars. Entries under defer need no prose. Entries under open only need a natural new-hook seed near the chapter end
- ## Do not → hard prohibitions for this chapter

Address each section in order when drafting the chapter. Every section must leave a visible trace in the prose — if a section is not reflected, the chapter is incomplete. **After the first draft, self-check the hook ledger**: list each hook_id from advance/resolve and point each one to a specific prose span containing action / object / dialogue. If you cannot point to one, go back and add it; do not submit a draft where the ledger lives in the memo but nowhere in the prose — review will flag the missing payoff and ask for a concrete scene.`;
}

function buildLengthGuidance(lengthSpec: LengthSpec, _language: "vi" | "en"): string {
  return `## Length Guidance

- Target length: ${lengthSpec.target} words
- Acceptable range: ${lengthSpec.softMin}-${lengthSpec.softMax} words
- Hard range: ${lengthSpec.hardMin}-${lengthSpec.hardMax} words`;
}

// ---------------------------------------------------------------------------
// Golden Three Chapters prose discipline — Phase 6.5
// Single conditional append (chapterNumber <= 3). No new schema, no new
// runtime branch. Cohesive paragraphs, NOT a numbered checklist.
// ---------------------------------------------------------------------------

export function buildGoldenOpeningDiscipline(
  chapterNumber: number | undefined,
  _language: "vi" | "en" = "vi",
): string {
  if (chapterNumber === undefined || chapterNumber > 3) return "";

  return `## Golden Opening Discipline — Chapter ${chapterNumber}

This is chapter ${chapterNumber} of the opening three — your prose directly decides whether the reader stays. The Golden Three Chapters rule is a hard constraint on your sentences, not advice. Chapter 1: within the first 800 words the protagonist must trip the main-line conflict (chase, dead-end, dispossession, transmigration-as-crisis); long background paragraphs are forbidden, and worldbuilding rides on the protagonist's actions instead of being explained in a block. **The last sentence of the first 300 words (the reader's first phone screen) must land a dramatic / reversal / striking beat — "Officer, I transmigrated"-level, "I'll probably die tomorrow"-level, "I'm attending my own funeral"-level — not background or scene-setting. When the reader scrolls to the bottom of the first screen they must feel pulled into the next line.** Chapter 2: the edge — power, system, rebirth-memory, information advantage — must be **performed** (one concrete event of using it, with a visible consequence), not **announced** (a narrator paragraph saying it exists). Chapter 3: somewhere in this chapter the protagonist's next quantifiable short-term goal must surface, so the reader can name what comes next when they close the page.

The discipline that runs across all three opening chapters: paragraphs of three to five lines (mobile reading), verbs over adjectives, and every chapter ends on a small hook — a cliff, an unresolved question, or an emotional gap. **At most two scenes and at most two named characters who actually clash in the chapter (protagonist + one trigger/opponent; walk-on roles get a role label only, no name, no expansion). Editor Cong Yue's rule tightens the cap from 3 to 2 — readers already mix up 3.** Information is layered into action: basic facts (looks, status, situation) emerge from what the protagonist does; key world rules (system mechanics, the deeper logic) attach to plot triggers; a paragraph of pure exposition is forbidden.`;
}

// ---------------------------------------------------------------------------
// Full cast tracking (conditional)
// ---------------------------------------------------------------------------

function buildFullCastTracking(): string {
  return `## Full Cast Tracking

This book uses full-cast tracking. At the end of every chapter, POST_SETTLEMENT must also include:
- Characters appearing in this chapter (name + one-line state change)
- Relationship changes, if any
- Characters mentioned but absent (name + reason for mention)`;
}

// ---------------------------------------------------------------------------
// Genre-specific rules
// ---------------------------------------------------------------------------

function buildGenreRules(gp: GenreProfile, genreBody: string): string {
  const fatigueLine = gp.fatigueWords.length > 0
    ? `- High-fatigue words (${gp.fatigueWords.join(", ")}): each may appear at most once per chapter`
    : "";

  const chapterTypesLine = gp.chapterTypes.length > 0
    ? `Before drafting, identify the chapter type:\n${gp.chapterTypes.map(t => `- ${t}`).join("\n")}`
    : "";

  const pacingLine = gp.pacingRule
    ? `- Pacing rule: ${gp.pacingRule}`
    : "";

  return [
    `## Genre Rules (${gp.name})`,
    fatigueLine,
    pacingLine,
    chapterTypesLine,
    genreBody,
  ].filter(Boolean).join("\n\n");
}

// ---------------------------------------------------------------------------
// Protagonist rules from book_rules
// ---------------------------------------------------------------------------

// Narrative person is a durable user constraint: enforce it only when the user
// explicitly set one (book_rules.narrativePerson). When unset, stay silent so the
// genre default applies — we never impose a person the user didn't ask for.
function buildNarrativePersonRule(bookRules: BookRules | null, _language: "vi" | "en"): string {
  const person = bookRules?.narrativePerson;
  if (!person) return "";
  return person === "first"
    ? "## Narrative person (hard constraint)\nWrite this book entirely in FIRST person (the protagonist's inner viewpoint). Do NOT slip into third person or an omniscient narrator — this overrides genre convention and your default."
    : "## Narrative person (hard constraint)\nWrite this book in THIRD person.";
}

function buildProtagonistRules(bookRules: BookRules | null): string {
  if (!bookRules?.protagonist) return "";

  const p = bookRules.protagonist;
  const lines = [`## Protagonist Invariants (${p.name})`];

  if (p.personalityLock.length > 0) {
    lines.push(`\nPersonality lock: ${p.personalityLock.join(", ")}`);
  }
  if (p.behavioralConstraints.length > 0) {
    lines.push("\nBehavioral constraints:");
    for (const c of p.behavioralConstraints) {
      lines.push(`- ${c}`);
    }
  }

  if (bookRules.prohibitions.length > 0) {
    lines.push("\nBook prohibitions:");
    for (const prohibition of bookRules.prohibitions) {
      lines.push(`- ${prohibition}`);
    }
  }

  if (bookRules.genreLock?.forbidden && bookRules.genreLock.forbidden.length > 0) {
    lines.push(`\nForbidden style elements: ${bookRules.genreLock.forbidden.join(", ")}`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Book rules body (user-written markdown)
// ---------------------------------------------------------------------------

function buildBookRulesBody(body: string): string {
  if (!body) return "";
  return `## Book Rules\n\n${body}`;
}

// ---------------------------------------------------------------------------
// Style guide
// ---------------------------------------------------------------------------

function buildStyleGuide(styleGuide: string): string {
  if (!styleGuide || styleGuide === "(file not created yet)") return "";
  return `## Style Guide\n\n${styleGuide}`;
}

// ---------------------------------------------------------------------------
// Style fingerprint (Phase 9: C3)
// ---------------------------------------------------------------------------

function buildStyleFingerprint(fingerprint?: string): string {
  if (!fingerprint) return "";
  return `## Style Fingerprint (Target Style)\n\nThe following style characteristics are extracted from reference text. Align your output with these features:\n\n${fingerprint}`;
}

// ---------------------------------------------------------------------------
// English output formats (parser keys off the === MARKER === anchors, so the
// table labels below are safely localized; persisted artifacts read English).
// ---------------------------------------------------------------------------

function buildEnglishPreWriteTable(gp: GenreProfile): string {
  const resourceRow = gp.numericalSystem
    ? "| Current resource total | X | match the ledger |\n| This chapter's gain | +X (source) | write +0 if none |\n"
    : "";

  return `=== PRE_WRITE_CHECK ===
(Output a Markdown table. Every row aligns with the seven chapter_memo sections, not the volume outline.)
| Check | This chapter | Note |
|-------|--------------|------|
| Current task | Restate the chapter_memo "Current task" and the concrete action this chapter takes | Be specific, not abstract |
| What the reader is waiting for | How this chapter handles it: create / delay / pay off | Match the memo |
| Pay off / keep hidden | Foreshadowing to pay off + cards that must stay down | Quote the memo |
| Routine / transition duty | If any routine or transition passage exists, state each one's function | Match the memo mapping |
| Required end-of-chapter change | 1-3 concrete changes from the memo's end-of-chapter change | Must land on the page |
| Do not | Restate the memo "Do not" list | The prose must not touch these |
| Context range | Ch X to Ch Y / state card / setting files | |
| Current anchor | Location / opponent / payoff goal | Anchor must be concrete |
${resourceRow}| Hooks to resolve | Real hook_id (write none if absent) | Match the hook pool |
| This chapter's conflict | One line | |
| Chapter type | ${gp.chapterTypes.join(" / ")} | |
| Risk scan | OOC / info leak / canon conflict${gp.powerScaling ? " / power-scaling break" : ""} / pacing / word fatigue | |`;
}

function buildEnglishContentBlocks(lengthSpec: LengthSpec): string {
  return `=== CHAPTER_TITLE ===
(Chapter title, without "Chapter X". It must differ from existing titles; do not reuse the same or similar titles. If recent title history or high-frequency title words are provided, avoid repeated roots and overused imagery.)

=== CHAPTER_CONTENT ===
(Chapter prose. Target ${lengthSpec.target} words, acceptable range ${lengthSpec.softMin}-${lengthSpec.softMax} words.)`;
}

function buildEnglishCreativeOutputFormat(_book: BookConfig, gp: GenreProfile, lengthSpec: LengthSpec): string {
  return `## Output Format (follow strictly)

${buildEnglishPreWriteTable(gp)}

${buildEnglishContentBlocks(lengthSpec)}

[Important] Output only the three blocks above (PRE_WRITE_CHECK, CHAPTER_TITLE, CHAPTER_CONTENT). State cards, hook pool, and summaries are handled by the later settlement stage; do not output them.`;
}

function buildEnglishOutputFormat(_book: BookConfig, gp: GenreProfile, lengthSpec: LengthSpec): string {
  const postSettlement = gp.numericalSystem
    ? `=== POST_SETTLEMENT ===
(If any numerical change occurred, output a Markdown table.)
| Item | This chapter | Note |
|------|--------------|------|
| Resource ledger | open X / gain +Y / close Z | write +0 if none |
| Key resources | name -> contribution +Y (basis) | write "none" if none |
| Hook changes | new / resolved / deferred hook | sync the hook pool |`
    : `=== POST_SETTLEMENT ===
(If any hook changed, output this.)
| Item | This chapter | Note |
|------|--------------|------|
| Hook changes | new / resolved / deferred hook | sync the hook pool |`;

  const updatedLedger = gp.numericalSystem
    ? `\n=== UPDATED_LEDGER ===\n(The full updated resource ledger, Markdown table.)`
    : "";

  return `## Output Format (follow strictly)

${buildEnglishPreWriteTable(gp)}

${buildEnglishContentBlocks(lengthSpec)}

${postSettlement}

=== UPDATED_STATE ===
(The full updated state card, Markdown table.)
${updatedLedger}
=== UPDATED_HOOKS ===
(The full updated hook pool, Markdown table.)

=== CHAPTER_SUMMARY ===
(Chapter summary as a Markdown table with these columns.)
| Chapter | Title | Characters | Key events | State change | Hook dynamics | Emotional tone | Chapter type |
|---------|-------|------------|------------|--------------|---------------|----------------|--------------|
| N | this chapter's title | Char1, Char2 | one-line summary | key change | H01 planted / H02 advanced | emotional arc | ${gp.chapterTypes.length > 0 ? gp.chapterTypes.join(" / ") : "transition / conflict / climax / resolution"} |

=== UPDATED_SUBPLOTS ===
(The full updated subplot board, Markdown table.)
| Subplot ID | Name | Characters | Start ch | Last active ch | Chapters since | Status | Progress | Resolve ETA |
|------------|------|------------|----------|----------------|----------------|--------|----------|-------------|

=== UPDATED_EMOTIONAL_ARCS ===
(The full updated emotional arcs, Markdown table.)
| Character | Chapter | Emotional state | Trigger | Intensity (1-10) | Arc direction |
|-----------|---------|-----------------|---------|------------------|---------------|

=== UPDATED_CHARACTER_MATRIX ===
(The updated character matrix, one ## block per character.)

## Character Name
- **Role**: protagonist / antagonist / ally / supporting / mentioned
- **Tags**: core identity tags
- **Contrast**: a distinctive detail that breaks the stereotype
- **Voice**: how they speak
- **Personality**: underlying temperament
- **Motivation**: core driving force
- **Current**: this chapter's immediate goal
- **Relations**: Character (relationship / Ch#) | ...
- **Knows**: what this character knows (only what they witnessed or were told)
- **Unknown**: what this character does not know`;
}
