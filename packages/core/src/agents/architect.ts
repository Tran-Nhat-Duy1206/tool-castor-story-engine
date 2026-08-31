import { BaseAgent } from "./base.js";
import type { BookConfig, FanficMode } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";
import { readGenreProfile } from "./rules-reader.js";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { renderHookSnapshot } from "../utils/memory-retrieval.js";
import {
  shouldPromoteHook,
  type PromotionContext,
  type VolumeBoundary,
} from "../utils/hook-promotion.js";
import type { StoredHook } from "../state/memory-db.js";

// ---------------------------------------------------------------------------
// Phase 5 (v13) — Static architect layer collapse
// Phase 5 consolidation — 7 sections → 5 sections (output shrinks ~25–40%).
//
// Architect now produces 2 prose outline files + one-file-per-character roles/
// folder, plus compat pointer shims. The LLM output contract is 5 blocks:
//
//   === SECTION: story_frame ===   4 architect（architect / architect / architect+architect / architect）
//   === SECTION: volume_map ===    5 architect + architect「6 architect（architect + architect）」
//   === SECTION: roles ===         architect；architect（architect→architect→architect）
//   === SECTION: book_rules ===    architect Markdown architect，architect
//   === SECTION: pending_hooks ===  13-column architect；architect startChapter=0 architect
//
// Consolidation rules (MUST reflect in prompt):
//   - architect roles/<architect>.md，architect story_frame architect
//   - architect/architect story_frame.architect，architect book_rules architect
//   - architect volume_map architect，architect section
//     （architect 3 architect，architect）
//   - architect：architect → roles.architect；architect → pending_hooks (startChapter=0)；
//     architect/architect（architect/architect）→ architect story_frame.architect
//   - architect current_state section architect。architect current_state.md
//     （consolidator architect），architect。
//
// Budget table (4 content items — LLM sections):
//   story_frame ≤ 3000 chars / volume_map ≤ 5000 chars / roles architect ≤ 8000 chars
//   book_rules ≤ 1000 chars (Markdown rules card) / pending_hooks ≤ 2000 chars
//
// architect contract（architect）：
//   outline/story_frame.md      ← 4 prose sections
//   outline/volume_map.md       ← 5 prose sections + architect
//   roles/architect/<name>.md    ← one file per major character
//   roles/architect/<name>.md    ← one file per minor character
//   story_bible.md              ← compat shim
//   character_matrix.md         ← compat shim
//   book_rules.md               ← authoritative Markdown rules card
//   current_state.md            ← seed architect（architect consolidator architect）
//   pending_hooks.md            ← architect
//   emotional_arcs.md           ← runtime state
//
// 「architect」= architect LLM architect。architect prose architect prompt architect，
// architect。v6 architect。
// ---------------------------------------------------------------------------

export interface ArchitectRole {
  readonly tier: "major" | "minor";
  readonly name: string;
  readonly content: string;
}

export interface ArchitectOutput {
  // Legacy shape — kept for back-compat with consumers that still read the
  // old file names. Filled from the new prose sections below when Phase 5
  // architect runs; external callers see the same surface.
  readonly storyBible: string;
  readonly volumeOutline: string;
  readonly bookRules: string;
  readonly currentState: string;
  readonly pendingHooks: string;
  // Phase 5 new shape. Optional in the type surface so legacy test fixtures
  // that mock only the old fields continue to compile — the architect itself
  // always fills these at runtime.
  readonly storyFrame?: string;
  readonly volumeMap?: string;
  readonly rhythmPrinciples?: string;
  readonly roles?: ReadonlyArray<ArchitectRole>;
}

export class ArchitectIncompleteFoundationError extends Error {
  readonly missing: readonly string[];
  readonly partialContent: string;

  constructor(missing: readonly string[], partialContent: string, message?: string) {
    super(message ?? `Architect foundation incomplete; missing sections: ${missing.join(", ")}`);
    this.name = "ArchitectIncompleteFoundationError";
    this.missing = missing;
    this.partialContent = partialContent;
  }
}

class MissingArchitectSectionsError extends Error {
  readonly missing: readonly string[];
  readonly content: string;

  constructor(missing: readonly string[], content: string) {
    super(`Architect output missing required section${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`);
    this.name = "MissingArchitectSectionsError";
    this.missing = missing;
    this.content = content;
  }
}

export class ArchitectAgent extends BaseAgent {
  get name(): string {
    return "architect";
  }

  async generateFoundation(
    book: BookConfig,
    externalContext?: string,
    reviewFeedback?: string,
    options?: {
      reviseFrom?: {
        storyBible: string;
        volumeOutline: string;
        bookRules: string;
        characterMatrix: string;
        userFeedback: string;
      };
    },
  ): Promise<ArchitectOutput> {
    const { profile: gp, body: genreBody } =
      await readGenreProfile(this.ctx.projectRoot, book.genre);
    const resolvedLanguage = book.language ?? gp.language;

    const contextBlock = externalContext
      ? `\n\n## External Instructions\n${externalContext}\n`
      : "";
    const reviewFeedbackBlock = this.buildReviewFeedbackBlock(reviewFeedback, resolvedLanguage);
    const revisePrompt = options?.reviseFrom
      ? this.buildRevisePrompt(options.reviseFrom)
      : "";

    const numericalBlock = gp.numericalSystem
      ? "- The story uses a trackable numerical/resource system\n- Define numerical system and caps in book_rules"
      : "- No explicit numerical system";
    const powerBlock = gp.powerScaling ? "- Power scaling progression ladder required" : "";
    const eraBlock = gp.eraResearch ? "- Era-grounded story: weave era anchors into story_frame and book_rules" : "";

    const systemPrompt = this.buildFoundationPrompt(book, gp, genreBody, contextBlock, reviewFeedbackBlock, numericalBlock, powerBlock, eraBlock);

    const langPrefix = resolvedLanguage === "vi"
      ? `[OUTPUT LANGUAGE] Output all story prose, character names, and descriptions in Vietnamese. Keep the 5 === SECTION: <name> === headers in English.\n\n`
      : `[OUTPUT LANGUAGE] Output everything in English. Keep the 5 === SECTION: <name> === headers in English.\n\n`;
    const userMessage = resolvedLanguage === "en"
      ? `Generate the complete foundation for a ${gp.name} novel titled "${book.title}". Write everything in English.`
      : `Tạo thiết lập nền tảng hoàn chỉnh cho tiểu thuyết "${book.title}" thuộc thể loại ${gp.name}.`;

    const response = await this.chat([
      { role: "system", content: langPrefix + systemPrompt + revisePrompt },
      { role: "user", content: userMessage },
    ], { temperature: 0.8 });

    return this.parseSectionsWithRepair(response.content, resolvedLanguage);
  }

  private buildRevisePrompt(reviseFrom: {
    storyBible: string;
    volumeOutline: string;
    bookRules: string;
    characterMatrix: string;
    userFeedback: string;
  }): string {
    return `\n\n## Foundation Revision Task
You are revising an existing foundation draft based on user feedback.

Previous draft sections:

[story_frame]
${reviseFrom.storyBible || "(none)"}

[volume_map]
${reviseFrom.volumeOutline || "(none)"}

[book_rules]
${reviseFrom.bookRules || "(none)"}

[roles]
${reviseFrom.characterMatrix || "(none)"}

Revision requirements:
1. Output all 5 SECTION blocks in order: story_frame, volume_map, roles, book_rules, pending_hooks.
2. Keep all valid, agreed-upon lore and modify only what user feedback targets.
3. Ensure volume_map has prose narrative pacing.
4. Ensure roles have contrast details and active initial states.
5. Ensure pending_hooks captures all open mysteries.

User feedback:
${reviseFrom.userFeedback || "(none)"}
`;
  }

  private buildFoundationPrompt(
    book: BookConfig,
    gp: GenreProfile,
    genreBody: string,
    contextBlock: string,
    reviewFeedbackBlock: string,
    numericalBlock: string,
    powerBlock: string,
    eraBlock: string,
  ): string {
    return `You are the architect of this book. Your only job is to produce **prose-density foundation design** — not tables, not schema, not bullet lists. The book's aura comes from your prose density: Phase 3 planner reads sparse memos out of your volume_map only if it was written to chapter-level prose; the writer only produces living characters because your role sheets carry contrast details; the reviewer only catches hard errors because your story_frame set the tonal anchors.${contextBlock}${reviewFeedbackBlock}

## Book metadata
- Platform: ${book.platform}
- Genre: ${gp.name} (${book.genre})
- Target chapters: ${book.targetChapters}
- Chapter length: ${book.chapterWordCount}
- Title: ${book.title}

## Genre body
${genreBody}

## Output constraints
${numericalBlock}
${powerBlock}
${eraBlock}

## Output contract (5 === SECTION: === blocks)

## Deduplication rule (MANDATORY)
Do not duplicate the same fact across sections. The protagonist's arc lives only in roles; world hard-rules live only in story_frame; rhythm principles live only in the last paragraph of volume_map; character initial status lives only in roles.Current_State; initial hooks live only in pending_hooks (start_chapter=0 rows). **When the book is period fiction / historical fanfic / urban reincarnation** — anything pinned to a real year, season, or historic marker — weave the environment/era anchor into story_frame's world-tonal-ground paragraph (e.g. "July 1985, just after the SARS wave"). **For cultivation / high-fantasy / system genres that have no real-world year, skip it entirely** — do not fabricate an era anchor. If a section repeats content that belongs elsewhere, delete it.

## Output budget (over-budget means cut)
- story_frame ≤ 3000 chars
- volume_map ≤ 5000 chars
- roles ≤ 8000 chars total
- book_rules ≤ 1000 chars (ordinary Markdown rules card)
- pending_hooks ≤ 2000 chars

=== SECTION: story_frame ===

Four prose sections, ~600-900 chars each. No tables. No bullet lists. Real paragraphs. **Do NOT write the protagonist's full arc here** — that is owned by roles//<protagonist>.md. Use a single-line pointer inside this block (e.g. "The protagonist is X; full arc lives in roles//X.md").

## 01_Theme_and_Tonal_Ground
What is this book actually about — not "hero grows from weak to strong" (empty), but a concrete proposition. Then the tonal ground: warm / cold / fierce / severe — which, and why this and not another. End with a one-line pointer to the protagonist role file.

## 02_Core_Conflict_and_Foreground_Background_Story_Layers
The book's main tension — not "good vs evil" but "because A believes X and B believes Y, they will inevitably collide on Z". At least two opponents: one visible, one structural/systemic. Opponents have their own logic.

**This section must explicitly write out the foreground story / background story layers**:
- **Foreground story**: the surface conflict the reader sees every chapter (cases, combat, leveling up, romance, business moves). Each volume / arc has its own visible goal and closure point.
- **Background story**: the hidden machine running through the whole book — the puppet master, conspiracy, origin secret, systemic oppression, fated curse. The reader assembles it from fragments; full payoff lands near the finale.

The two layers must be causally linked, not parallel universes — every foreground conflict should trace back to some gear of the background machine turning. **Foreground-only story collapses into a set of disconnected episodes with no forward pull; background-only story is suffocating and never delivers. Write both in prose here, and name how they interlock.**

## 03_World_Tonal_Ground (hard rules + sensory tone + book-specific rules)
The world's operating rules. 3-5 unbreakable laws written as prose, not bullets. Sensory texture: wet or dry, fast or slow, noisy or quiet — give the writer an anchor. **This paragraph also absorbs the narrative prose that used to live in book_rules (narrative perspective, core conflict driver, book-specific rules).** Write them all here once. Do not repeat them in book_rules.

## 04_Endgame_Direction_and_Book_Objective
What the last chapter roughly feels like. The final shot: where, doing what, around whom, thinking what. A distant target for every planner call downstream.

**End this paragraph with a one-sentence Book Objective** (the root of the recursive OKR outline): when this book is done, the protagonist must reach a **verifiable end-state** (e.g., "rise from errand disciple to sect elder and publicly vindicate the parental case", "go from undocumented migrant worker to running three fur-trade companies and personally putting the ex-husband in prison"). Do NOT use vague words like "grow stronger" or "take revenge" — write a concrete state an outside observer can check "achieved / not achieved". This Book Objective is the root of the full-book OKR outline; volume_map will decompose it per volume below.

=== SECTION: volume_map ===

Prose volume map, **5 sections + 1 closing rhythm paragraph**. **Critical requirement: stay at volume-level prose only** — specify each volume's theme, emotional curve, cross-volume hooks, character stage goals, and volume-end irreversible changes. **Do NOT prescribe chapter-level tasks** (no "chapter 17 sends him home"). Chapter planning is the Phase 3 planner's job; the architect builds the skeleton, not the chapter list.

## 01_Volume_Themes_and_Emotional_Curves
How many volumes? Each volume's theme in one sentence; each volume's emotional curve as a paragraph (where pressured, where rewarding, where cold, where warm). Not mechanical rotation.

## 02_Cross_Volume_Hooks_and_Payoff_Promises (cover BOTH foreground and background layers)
Volume 1 plants hook A, paid off in volume N; volume 2 plants hook B, paid off in volume M. Prose, not tables. **Stay at volume-level** (e.g., "the origin mystery planted in volume 1 pays off in volume 3"); do not specify chapter numbers.

**Hooks must cover BOTH foreground and background layers** (matching the two-layer story established in story_frame.02):
- Foreground hooks: short-range arc-level hooks (case mystery, opponent identity, resource grab), paid off within 1-2 volumes
- Background hooks: full-book main-line hooks (ultimate truth, origin, systemic secret), paid off near the finale. The 3-7 load-bearing ones are core_hook=true

**If this paragraph only carries foreground hooks with no background seeds, you have lost the book's forward pull axis. Add them.**

## 03_Per_Volume_OKRs (Objective + 3 Key Results)
Recursive OKR outline that decomposes the Book Objective (root O set at the end of story_frame.04): every volume must explicitly state:
- **Objective (volume-level goal)**: a **verifiable state** the protagonist must reach by volume end, one sentence, logically chained to the Book Objective (e.g., if Book O = "become sect elder and vindicate the parental case", then Vol 1 O = "move from errand disciple into the registered disciple roster and recover the first lead pointing to the truth")
- **Key Results (3 items, quantifiable / observable)**: three concrete sub-achievements whose completion can be checked by an outside observer (e.g., KR1 = "take over the pharmacy garden steward seat", KR2 = "lock in a stable alliance with Lingan Peak", KR3 = "uncover the first half-page fragment of the parental case file"). No vague KRs like "gets stronger" / "matures".

Supporting characters' stage changes (master dies end of vol 2, opponent breaks bad in vol 3) go as notes under the relevant KR. Stage only — full arc lives in roles. **The 3 KRs per volume are the direct input for the planner: once it sees 3 KRs for a volume, it paces chapter tasks at roughly one KR advanced every 3-5 chapters.**

## 04_Volume_End_Mandatory_Changes
Each volume's last chapter must contain an irreversible event. Prose, one paragraph per volume. **Write what must happen, not which chapter**.

## 05_Rhythm_Principles (concrete + universal)
**This is the single home for rhythm principles — no separate rhythm_principles section exists.** Output 6 rhythm principles. **At least 3 must be concretized for this book** (e.g., "every 5 chapters in the first 30, hit one small payoff"); the rest may stay as universal rules (e.g., "no deus ex machina", "plant the foreshadow 3-5 chapters before the climax"). A mix of concrete + universal is valid. Bad: "rhythm must balance tension and release". Good: "every 5 chapters in the first 30 carries a small payoff landing in the last 300 chars of the chapter". Cover (order flexible, substitutions of equal weight are allowed): (1) climax spacing, (2) breath frequency, (3) hook density, (4) information release pacing, (5) payoff rhythm, (6) relationship advancement — each 2-3 sentences.

If the external instructions specify content proportions (for example politics/romance 50/50 or career/relationship weighting), this paragraph must turn that into a full-book rhythm promise: which volumes lean toward which line, which line must be visible in every 3-5 chapter mini-cycle, and which line carries fallout after climaxes. Do not merely say "keep it balanced."

=== SECTION: roles ===

One-file-per-character prose. **The protagonist card is the single source of truth for the protagonist's arc** — story_frame no longer carries it, and writer/planner both read it here.

---ROLE---
tier: major
name: <character name>
---CONTENT---
## Core_Tags
(3-5 tags + one sentence on why those tags)

## Contrast_Detail
(1-2 concrete details that contradict the core tags — "ice-cold killer but leaves fish bones for stray cats". Contrast detail is the formula for character dimensionality.)

## Back_Story
(Prose paragraph — how this person became who they are. Key past only, keep it lean.)

## Protagonist_Arc (start → end → cost)
**Mandatory for the protagonist; optional for other majors with substantial arcs.** Where they start (identity, situation, core flaw, initial desire); where they land (who they become, what they gain or lose); the irreversible cost they pay for that landing. Show internal displacement, not just growth. This section absorbs what used to live in story_frame.02_Protagonist_Arc.

## Current_State (initial state at chapter 0)
(Where they are at chapter 0, what's on their mind, most recent worry. **Character-only**: initial hooks go in pending_hooks start_chapter=0 rows; environment / era anchors (when the genre has a real year) are woven into story_frame's world-tonal-ground paragraph. No separate current_state section is produced.)

## Relationship_Network
(With protagonist, with other major characters. One line each. Relationships are dynamic, not labels.)

## Inner_Driver
(What they want, why, what they're willing to pay.)

## Growth_Arc
(Internal displacement across the book. Can be short for non-protagonists.)

---ROLE---
tier: major
name: <next major>
---CONTENT---
...

(Aim for 2-3 majors + 2-3 supporting majors. Quality over quantity — do not pad.)

---ROLE---
tier: minor
name: <minor name>
---CONTENT---
(Simplified: only 4 sections — Core_Tags / Contrast_Detail / Current_State / Relationship_to_Protagonist, 1-2 lines each.)

(3-5 minors.)

=== SECTION: book_rules ===

Output ordinary Markdown. Do NOT output YAML frontmatter, JSON, or code fences. This is a compact rules card readable by both runtime and writers; long narrative guidance already lives in story_frame.03_World_Tonal_Ground.

## Protagonist
- Name: <protagonist name>
- Personality lock: <3-5 personality keywords, comma-separated>
- Behavioral constraints: <3-5 behavioral boundaries>

## Genre Lock
- Primary: ${book.genre}
- Forbidden: <2-3 forbidden style/system intrusions>

## Narrative Person
<Write first person or third person ONLY if the user explicitly requested it; otherwise write "none".>

${gp.numericalSystem ? `## Numerical / Resource Rules
- Core resources: <core resource types>
- Hard cap: <setting-specific cap that cannot be broken by plot convenience>` : ""}

${gp.eraResearch ? `## Era Constraints
- <2-3 constraints tied to policy, prices, technology, or social environment>` : ""}

## Prohibitions
- <3-5 book-specific prohibitions>

=== SECTION: pending_hooks ===

Initial hook pool (Markdown table), Phase 7 extended columns:
| hook_id | start_chapter | type | status | last_advanced_chapter | expected_payoff | payoff_timing | depends_on | pays_off_in_arc | core_hook | half_life | notes |

Rules:
- Column 5 is a pure chapter number, not narrative description
- At book creation all planned hooks have last_advanced_chapter = 0
- Ordinary seed rows must not use status "open"; use "deferred" until prose actually advances them. Only load-bearing core / dependency / cross-volume hooks may be pre-promoted by the runtime into active hook debt
- Column 7 must be: immediate / near-term / mid-arc / slow-burn / endgame
- Column 8 (depends_on): upstream hook ids that must be planted / paid off before this one fires, formatted [H003, H007]; write "none" if no upstream
- Column 9 (pays_off_in_arc): free-form prose on where this hook is scheduled to pay off (e.g. "mid of volume 2", "right before the finale"). NOT parsed into chapter numbers
- Column 10 (core_hook): true / false. Core hooks are main-line load-bearing (central mystery, identity, key promise). A book typically has 3-7 cores; everything else is false
- Column 11 (half_life): optional integer chapters. If blank, derived from payoff_timing (immediate/near-term = 10, mid-arc = 30, slow-burn/endgame = 80)
- Put initial signal text in notes, not column 5
- **Initial world / alliance state**: any load-bearing initial condition ("protagonist carries the father's notebook", "the regime already watches the harbor") can be seeded as a start_chapter=0 row with a note-column tag indicating its initial-state nature.

## Final emphasis
- Fit ${book.platform} platform taste and ${gp.name} genre traits
- Protagonist persona clear with sharp behavioral boundaries
- Hooks planted with payoff promises; supporting characters have independent motivation
- **story_frame / volume_map / roles must be prose density — no bullet-list degradation**
- **book_rules is an ordinary Markdown rules card — no YAML, JSON, code fence, or long prose**
- **Do NOT emit rhythm_principles or current_state as separate sections** — rhythm principles live in the last paragraph of volume_map; character initial status goes in roles.Current_State; initial hooks go in pending_hooks (start_chapter=0 rows); environment / era anchors (only when the genre has a real year) are woven into story_frame's world-tonal-ground paragraph
- **pending_hooks table MUST carry Phase 7 extended columns — depends_on spells out the causal chain, pays_off_in_arc locks the approximate payoff location, core_hook marks main-line load-bearing hooks (3-7 per book), half_life only on priority hooks**

## Hard completeness check (read before generating)
You MUST emit all **5 SECTION blocks in order**: story_frame → volume_map → roles → book_rules → pending_hooks. Do NOT stop after story_frame or volume_map just because they ran long. Even if roles lists only 3 characters, book_rules is a small Markdown block, and pending_hooks has only 3 rows, all five must appear. The output is only considered delivered after the last row of pending_hooks is written.`;
  }

  // -------------------------------------------------------------------------
  // Parsing
  // -------------------------------------------------------------------------
  private async parseSectionsWithRepair(content: string, language: "vi" | "en"): Promise<ArchitectOutput> {
    try {
      return this.parseSections(content, language);
    } catch (error) {
      if (!(error instanceof MissingArchitectSectionsError)) {
        throw error;
      }

      const repaired = await this.repairMissingSections(error, language);
      try {
        return this.parseSections(repaired, language);
      } catch (repairError) {
        if (repairError instanceof MissingArchitectSectionsError) {
          const missing = repairError.missing.join("、");
          const message = language === "en"
            ? `The story foundation came back incomplete (missing: ${repairError.missing.join(", ")}). `
              + "This usually means the model didn't write every section in one pass — it's not a problem with your input. "
              + "Try again, or switch to a stronger model (e.g. deepseek-v4-pro / gpt-5.5) and regenerate."
            : `Thiết lập nền tảng chưa tạo hoàn chỉnh (thiếu: ${missing}). Vui lòng bấm thử lại hoặc sử dụng mô hình mạnh hơn.`;
          throw new ArchitectIncompleteFoundationError(
            repairError.missing,
            repairError.content,
            message,
          );
        }
        throw repairError;
      }
    }
  }

  private async repairMissingSections(
    error: MissingArchitectSectionsError,
    language: "vi" | "en",
  ): Promise<string> {
    const missingList = error.missing.join(", ");
    const system = language === "en"
      ? [
          "You repair Castor architect output formatting.",
          "The previous draft is partially useful but is missing required SECTION blocks.",
          "Do not invent a new book. Preserve usable existing content and add the missing parts.",
          "Return the complete output with exactly these 5 SECTION blocks in order: story_frame, volume_map, roles, book_rules, pending_hooks.",
          "book_rules must be ordinary Markdown, not YAML. pending_hooks must be a Markdown table.",
          "Do not explain the repair.",
        ].join("\n")
      : [
          "You are repairing the output format of Castor architect. Retain all valid content from the previous draft and supply only the missing sections. Output all 5 sections in order: story_frame, volume_map, roles, book_rules, pending_hooks. No conversational explanations.",
        ].join("\n");
    const user = language === "en"
      ? `Missing sections: ${missingList}\n\nOriginal partial output:\n\n${error.content}`
      : `Missing sections: ${missingList}\n\nIncomplete output:\n\n${error.content}`;

    const response = await this.chat([
      { role: "system", content: system },
      { role: "user", content: user },
    ], { temperature: 0.2 });
    return response.content;
  }

  private parseSections(content: string, language: "vi" | "en"): ArchitectOutput {
    const parsedSections = this.parseArchitectSectionMap(content);

    // Phase 5 new sections take precedence.
    const storyFrame = parsedSections.get("story_frame") ?? "";
    const volumeMap = parsedSections.get("volume_map") ?? "";
    const rhythmPrinciples = parsedSections.get("rhythm_principles") ?? "";
    const rolesRaw = parsedSections.get("roles") ?? "";

    // Legacy sections (still produced for back-compat where needed).
    // If the model used old section names we still accept them.
    const legacyStoryBible = parsedSections.get("story_bible") ?? "";
    const legacyVolumeOutline = parsedSections.get("volume_outline") ?? "";
    const bookRules = parsedSections.get("book_rules");
    // Phase 5 consolidation: current_state is no longer a required section.
    // Legacy books (v12 / Phase 5 initial / pre-revert) and import/fanfic
    // regenerations may still produce it — accept the value when present,
    // fall through to empty seed when absent (consolidator will populate at
    // runtime). Era/setting anchors that used to motivate a separate
    // current_state block now live naturally inside story_frame.architect
    // for genres that have a real-world year anchor; other genres (architect/architect/
    // architect) omit them entirely.
    const currentStateLegacy = parsedSections.get("current_state") ?? "";
    const pendingHooksRaw = parsedSections.get("pending_hooks");

    // 5-section required contract: story_frame (or legacy story_bible),
    // volume_map (or legacy volume_outline), roles, book_rules, pending_hooks.
    //
    // Backward compat: v12 outputs used story_bible/volume_outline and
    // embedded character data inside story_bible — they had no roles block.
    // When the model uses ONLY legacy section names, we accept an empty roles
    // list (consolidator/readers fall back to the character_matrix shim).
    // When the new story_frame / volume_map names are used we require roles.
    const usingLegacyOutlineNames = !storyFrame && !volumeMap
      && (legacyStoryBible.length > 0 || legacyVolumeOutline.length > 0);

    const missing: string[] = [];
    const effectiveStoryFrame = storyFrame || legacyStoryBible;
    const effectiveVolumeMap = volumeMap || legacyVolumeOutline;
    if (!effectiveStoryFrame) missing.push("story_frame");
    if (!effectiveVolumeMap) missing.push("volume_map");
    if (!rolesRaw.trim() && !usingLegacyOutlineNames) missing.push("roles");
    if (!bookRules) missing.push("book_rules");
    if (!pendingHooksRaw) missing.push("pending_hooks");
    if (missing.length > 0) {
      throw new MissingArchitectSectionsError(missing, content);
    }

    const roles = this.parseRoles(rolesRaw);
    const pendingHooks = this.normalizePendingHooksSection(
      this.stripTrailingAssistantCoda(pendingHooksRaw!),
      effectiveVolumeMap,
    );

    // Synthesize legacy-facing content from new prose (so back-compat callers
    // still receive real content instead of empty strings).
    const storyBible = legacyStoryBible || this.buildStoryBibleShim(language);
    const volumeOutline = legacyVolumeOutline || effectiveVolumeMap;

    return {
      storyBible,
      volumeOutline,
      bookRules: bookRules!,
      // currentState: empty string when architect no longer emits the section;
      // writeFoundationFiles seeds current_state.md with a placeholder so
      // consolidator / state-bootstrap readers find a valid file on first boot.
      currentState: currentStateLegacy,
      pendingHooks,
      storyFrame: effectiveStoryFrame,
      volumeMap: effectiveVolumeMap,
      rhythmPrinciples,
      roles,
    };
  }

  private parseArchitectSectionMap(content: string): Map<string, string> {
    const sectionPattern = /^\s{0,3}(?:#{1,6}\s*)?===\s*SECTION\s*[：:]\s*([^\n=]+?)\s*===\s*(?:#+\s*)?$/gim;
    const markerMatches = [...content.matchAll(sectionPattern)].map((match) => ({
      name: this.normalizeSectionName(match[1] ?? ""),
      index: match.index ?? 0,
      markerLength: match[0].length,
    }));
    if (markerMatches.length > 0) {
      return this.sliceArchitectSections(content, markerMatches);
    }

    const headingPattern = /^\s{0,3}#{1,3}\s+(.+?)\s*$/gim;
    const headingMatches = [...content.matchAll(headingPattern)]
      .map((match) => ({
        name: this.canonicalSectionNameFromHeading(match[1] ?? ""),
        index: match.index ?? 0,
        markerLength: match[0].length,
      }))
      .filter((match): match is { readonly name: string; readonly index: number; readonly markerLength: number } =>
        Boolean(match.name),
      );
    return this.sliceArchitectSections(content, headingMatches);
  }

  private sliceArchitectSections(
    content: string,
    matches: ReadonlyArray<{ readonly name: string; readonly index: number; readonly markerLength: number }>,
  ): Map<string, string> {
    const parsedSections = new Map<string, string>();
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i]!;
      const start = match.index + match.markerLength;
      const end = matches[i + 1]?.index ?? content.length;
      parsedSections.set(match.name, content.slice(start, end).trim());
    }
    return parsedSections;
  }

  /**
   * Parse ---ROLE---...---CONTENT---... blocks from the roles section.
   * Drops malformed entries silently — this is prose the LLM produced,
   * not machine input.
   */
  private parseRoles(raw: string): ReadonlyArray<ArchitectRole> {
    if (!raw.trim()) return [];

    const blocks = raw.split(/^---ROLE---$/m).map((chunk) => chunk.trim()).filter(Boolean);
    const roles: ArchitectRole[] = [];

    for (const block of blocks) {
      const contentSplit = block.split(/^---CONTENT---$/m);
      if (contentSplit.length < 2) continue;

      const headerRaw = contentSplit[0]!.trim();
      const content = contentSplit.slice(1).join("\n---CONTENT---\n").trim();

      const tierMatch = headerRaw.match(/tier\s*[:：]\s*(major|minor|vai_chinh|vai_phu)/i);
      const nameMatch = headerRaw.match(/name\s*[:：]\s*(.+)/i);
      if (!tierMatch || !nameMatch) continue;

      const tierValue = tierMatch[1]!.toLowerCase();
      const tier: "major" | "minor" = (tierValue === "major" || tierValue === "vai_chinh") ? "major" : "minor";
      const name = nameMatch[1]!.trim();
      if (!name || !content) continue;

      roles.push({ tier, name, content });
    }

    return roles;
  }

  private buildStoryBibleShim(language: "vi" | "en"): string {
    if (language === "en") {
      return `# Story Bible (compat pointer — deprecated)\n\n> This file is kept for external readers only. The authoritative source is now:\n> - outline/story_frame.md (theme / tonal ground / core conflict / world rules / endgame)\n> - outline/volume_map.md (chapter-granular plot map)\n> - roles/ directory (one-file-per-character sheets)\n`;
    }
    return `# Story Bible (con trỏ tương thích — đã ngừng dùng)\n\n> Tệp này chỉ giữ lại cho các trình đọc bên ngoài. Nguồn chính thức hiện là:\n> - outline/story_frame.md (chủ đề / phong cách / xung đột cốt lõi / quy tắc thế giới / kết cục)\n> - outline/volume_map.md (sơ đồ phân quyển chi tiết theo chương)\n> - thư mục roles/ (hồ sơ nhân vật từng người một thẻ)\n`;
  }

  private buildCharacterMatrixShim(roles: ReadonlyArray<ArchitectRole>, language: "vi" | "en"): string {
    const majorLines = roles.filter((role) => role.tier === "major")
      .map((role) => `- roles/major/${role.name}.md`);
    const minorLines = roles.filter((role) => role.tier === "minor")
      .map((role) => `- roles/minor/${role.name}.md`);

    if (language === "en") {
      return `# Character Matrix (compat pointer — deprecated)\n\n> This file is kept for external readers only. Authoritative source is now the roles/ directory (one-file-per-character).\n\n## Major characters\n\n${majorLines.join("\n") || "(none)"}\n\n## Minor characters\n\n${minorLines.join("\n") || "(none)"}\n`;
    }
    return `# Ma trận nhân vật (con trỏ tương thích — đã ngừng dùng)\n\n> Tệp này chỉ giữ lại cho các trình đọc bên ngoài. Nguồn chính thức hiện chuyển sang thư mục roles/ (mỗi người một thẻ).\n\n## Nhân vật chính\n\n${majorLines.join("\n") || "(không có)"}\n\n## Nhân vật phụ\n\n${minorLines.join("\n") || "(không có)"}\n`;
  }

  // -------------------------------------------------------------------------
  // File writing
  // -------------------------------------------------------------------------
  async writeFoundationFiles(
    bookDir: string,
    output: ArchitectOutput,
    _numericalSystem: boolean = true,
    language: "vi" | "en" = "vi",
    mode: "init" | "revise" = "init",
  ): Promise<void> {
    const storyDir = join(bookDir, "story");
    const outlineDir = join(storyDir, "outline");
    const rolesDir = join(storyDir, "roles");
    const rolesMajorDir = join(rolesDir, "major");
    const rolesMinorDir = join(rolesDir, "minor");

    await Promise.all([
      mkdir(storyDir, { recursive: true }),
      mkdir(outlineDir, { recursive: true }),
      mkdir(rolesMajorDir, { recursive: true }),
      mkdir(rolesMinorDir, { recursive: true }),
    ]);

    const writes: Array<Promise<void>> = [];

    const storyFrameBody = output.storyFrame ?? output.storyBible;
    const volumeMap = output.volumeMap ?? output.volumeOutline;
    const rhythmPrinciples = output.rhythmPrinciples ?? "";
    const roles = output.roles ?? [];
    const isPhase5Output = Boolean(output.storyFrame?.trim());

    if (mode === "revise" && !isPhase5Output) {
      throw new Error(
        "Architect revise mode produced legacy-format output (storyFrame empty). " +
        "The book's architecture files have NOT been modified.",
      );
    }

    if (mode === "revise") {
      await rm(rolesMajorDir, { recursive: true, force: true });
      await rm(rolesMinorDir, { recursive: true, force: true });
      await mkdir(rolesMajorDir, { recursive: true });
      await mkdir(rolesMinorDir, { recursive: true });
    }

    if (!isPhase5Output) {
      writes.push(writeFile(join(storyDir, "story_bible.md"), output.storyBible, "utf-8"));
      writes.push(writeFile(join(storyDir, "volume_outline.md"), output.volumeOutline, "utf-8"));
      writes.push(writeFile(join(storyDir, "book_rules.md"), output.bookRules, "utf-8"));
      writes.push(writeFile(
        join(storyDir, "character_matrix.md"),
        language === "en"
          ? "# Character Matrix\n\n<!-- One ## section per character. Add new characters as new ## blocks. -->\n"
          : "# Character Matrix\n\n<!-- One ## block per character -->\n",
        "utf-8",
      ));

      if (mode === "init") {
        const currentStateSeed = output.currentState?.trim()
          ? output.currentState
          : (language === "en"
              ? "# Current State\n\n> Seeded at book creation. Runtime state is appended by the consolidator after each chapter.\n"
              : "# Current State\n\n> Placeholder at book creation. Updated at runtime by consolidator.\n");
        writes.push(writeFile(join(storyDir, "current_state.md"), currentStateSeed, "utf-8"));
        writes.push(writeFile(join(storyDir, "pending_hooks.md"), output.pendingHooks, "utf-8"));
        writes.push(writeFile(
          join(storyDir, "emotional_arcs.md"),
          language === "en"
            ? "# Emotional Arcs\n\n| Character | Chapter | Emotional State | Trigger Event | Intensity (1-10) | Arc Direction |\n| --- | --- | --- | --- | --- | --- |\n"
            : "# Emotional Arcs\n\n| Character | Chapter | Emotional state | Trigger | Intensity (1-10) | Arc direction |\n|---|---|---|---|---|---|\n",
          "utf-8",
        ));
      }

      await Promise.all(writes);
      return;
    }

    const storyFrame = storyFrameBody.trim();

    // Phase 5 primary prose files
    writes.push(writeFile(join(outlineDir, "story_frame.md"), storyFrame, "utf-8"));
    writes.push(writeFile(join(outlineDir, "volume_map.md"), volumeMap, "utf-8"));
    // Phase 5 consolidation: rhythm principles live inside the last paragraph
    // of volume_map. A separate architect.md / rhythm_principles.md file is only
    // written when the architect happened to produce a standalone block (legacy
    // 7-section output / foundation-reviewer round-trips that still split it
    // out). Skipping the empty write avoids 0-byte files that mislead the UI
    // and fight against the "no duplication" rule — readers who need the rhythm
    // content already pull it from volume_map's closing paragraph.
    if (rhythmPrinciples.trim()) {
      const rhythmFileName = language === "en" ? "rhythm_principles.md" : "rhythm_principles.md";
      writes.push(writeFile(join(outlineDir, rhythmFileName), rhythmPrinciples, "utf-8"));
    }

    // Roles — one file per character
    for (const role of roles) {
      const targetDir = role.tier === "major" ? rolesMajorDir : rolesMinorDir;
      const safeName = role.name.replace(/[/\\:*?"<>|]/g, "_").trim();
      if (!safeName) continue;
      writes.push(writeFile(join(targetDir, `${safeName}.md`), role.content, "utf-8"));
    }

    // Compat shims — these are pointer files, not authoritative content.
    writes.push(writeFile(
      join(storyDir, "story_bible.md"),
      this.buildStoryBibleShim(language),
      "utf-8",
    ));
    writes.push(writeFile(
      join(storyDir, "character_matrix.md"),
      this.buildCharacterMatrixShim(roles, language),
      "utf-8",
    ));

    // Cleanup #1: volume_outline.md mirror removed. All readers now resolve
    // through readVolumeMap() in utils/outline-paths.ts, which prefers
    // outline/volume_map.md and falls back to legacy volume_outline.md for
    // books initialized before Phase 5.

    writes.push(writeFile(join(storyDir, "book_rules.md"), output.bookRules.trim() + "\n", "utf-8"));

    // Runtime state files.
    // Phase 5 consolidation: the architect no longer emits a current_state
    // section (only 3 genres — architect/architect/architect — benefit from a
    // separate era anchor, and those fold naturally into story_frame.architect).
    // We still write current_state.md with a seed placeholder so
    // isCompleteBookDirectory() sees it on first boot and the runtime
    // consolidator has a file to append each chapter's state into.
    // Per-character state lives in roles/*.Current_State; initial hook rows
    // live in pending_hooks with start_chapter=0. Legacy books / imports that
    // still produced the section keep their content as-is.
    if (mode === "init") {
      const currentStateSeed = output.currentState?.trim()
        ? output.currentState
        : (language === "en"
            ? "# Current State\n\n> Seeded at book creation. Runtime state is appended by the consolidator after each chapter. Initial per-character state lives in roles/*.Current_State; load-bearing initial world facts live in pending_hooks rows with start_chapter=0.\n"
            : "# Current State\n\n> Placeholder at book creation. Updated at runtime by consolidator.\n");
      writes.push(writeFile(join(storyDir, "current_state.md"), currentStateSeed, "utf-8"));
      writes.push(writeFile(join(storyDir, "pending_hooks.md"), output.pendingHooks, "utf-8"));
      writes.push(writeFile(
        join(storyDir, "emotional_arcs.md"),
        language === "en"
          ? "# Emotional Arcs\n\n| Character | Chapter | Emotional State | Trigger Event | Intensity (1-10) | Arc Direction |\n| --- | --- | --- | --- | --- | --- |\n"
          : "# Emotional Arcs\n\n| Character | Chapter | Emotional state | Trigger | Intensity (1-10) | Arc direction |\n|---|---|---|---|---|---|\n",
        "utf-8",
      ));
    }

    // Cleanup #2 (Option B): particle_ledger.md / subplot_board.md /
    // chapter_summaries.md are pure runtime logs appended by the writer's
    // settlement phase. The architect no longer seeds them here — mixing a
    // static "setting" seed with a runtime "append log" was the dual-purpose
    // mess that prompted the cleanup. If they don't exist yet, downstream
    // readers see the placeholder and the first chapter settlement creates
    // them naturally. The `_numericalSystem` parameter is kept for API
    // compatibility with existing callers.

    await Promise.all(writes);
  }

  /**
   * Reverse-engineer foundation from existing chapters.
   */
  async generateFoundationFromImport(
    book: BookConfig,
    chaptersText: string,
    externalContext?: string,
    reviewFeedback?: string,
    options?: { readonly importMode?: "continuation" | "series" },
  ): Promise<ArchitectOutput> {
    const { profile: gp, body: genreBody } =
      await readGenreProfile(this.ctx.projectRoot, book.genre);
    const resolvedLanguage = book.language ?? gp.language;
    const reviewFeedbackBlock = this.buildReviewFeedbackBlock(reviewFeedback, resolvedLanguage);

    const contextBlock = externalContext
      ? (resolvedLanguage === "en"
          ? `\n\n## External Instructions\n${externalContext}\n`
          : `\n\n## External Instructions\n${externalContext}\n`)
      : "";

    const numericalBlock = gp.numericalSystem
      ? (resolvedLanguage === "en"
          ? "- The story uses a trackable numerical/resource system"
          : "- The story uses a trackable numerical/resource system")
      : (resolvedLanguage === "en"
          ? "- No explicit numerical system"
          : "- No explicit numerical system");

    const isSeries = options?.importMode === "series";

    const continuationDirective = isSeries
      ? `## Continuation Direction Requirements\nThe continuation portion must open up new narrative space — new conflict vector, new location, new time horizon. Ignite within 5 chapters; at least 50% fresh scenes.`
      : `## Continuation Direction\nNaturally extend the existing arc. Advance existing conflicts, pay off planted hooks, introduce new complications organically.`;

    const systemPrompt = `You are a professional novel architect. Reverse-engineer a prose-density foundation from the source chapters and write the continuation path.${contextBlock}${reviewFeedbackBlock}

## Book metadata
- Title: ${book.title}
- Platform: ${book.platform}
- Genre: ${gp.name} (${book.genre})
- Target chapters: ${book.targetChapters}
- Chapter length: ${book.chapterWordCount}

## Genre body
${genreBody}

${numericalBlock}

${continuationDirective}

## Output contract
Follow the consolidated 5-section === SECTION: === layout: story_frame, volume_map, roles, book_rules, pending_hooks. Do NOT emit rhythm_principles or current_state — rhythm principles live in the last paragraph of volume_map; character initial status lives in roles.Current_State; initial hooks live in pending_hooks start_chapter=0 rows; era / setting anchors (only when the genre pins to a real year) are woven into story_frame's world-tonal-ground paragraph.

All prose must be derived from the source package. Do not invent settings. If the package says it is compressed, treat chapter catalog + excerpts as evidence for the foundation; the full chapters will be replayed later for detailed truth files. For volume_map, treat existing chapters as "review" (one paragraph) and continuation as prose chapter-level planning. Hook extraction must be complete for the evidence provided.`;

    const userMessage = `Below is the text package for "${book.title}". Derive foundation architecture from it:\n\n${chaptersText}`;
    const response = await this.chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ], { temperature: 0.5 });

    return this.parseSectionsWithRepair(response.content, resolvedLanguage);
  }

  async generateFanficFoundation(
    book: BookConfig,
    fanficCanon: string,
    fanficMode: FanficMode,
    reviewFeedback?: string,
  ): Promise<ArchitectOutput> {
    const { profile: gp, body: genreBody } =
      await readGenreProfile(this.ctx.projectRoot, book.genre);
    const reviewFeedbackBlock = this.buildReviewFeedbackBlock(reviewFeedback, book.language ?? "vi");

    const MODE_INSTRUCTIONS: Record<FanficMode, string> = {
      canon: "Plot takes place during canon gaps. Cannot alter established facts.",
      au: "Mark AU divergence points. Keep core personality intact.",
      ooc: "Mark character deviation triggers.",
      cp: "Plan volume outline along pairing relationship arc.",
    };

    const systemPrompt = `You are a professional fanfiction architect. Design foundation architecture in prose density based on canon.`;

    const response = await this.chat([
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Generate foundation architecture for fanfiction novel "${book.title}". Target: ${book.targetChapters} chapters, ${book.chapterWordCount} words per chapter.`,
      },
    ], { temperature: 0.7 });

    return this.parseSectionsWithRepair(response.content, book.language ?? "vi");
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  private buildReviewFeedbackBlock(
    reviewFeedback: string | undefined,
    language: "vi" | "en",
  ): string {
    const trimmed = reviewFeedback?.trim();
    if (!trimmed) return "";

    if (language === "en") {
      return `\n\n## Previous Review Feedback\nThe previous foundation draft was rejected. You must explicitly fix the following issues in this regeneration instead of paraphrasing the same design:\n\n${trimmed}\n`;
    }

    return `\n\n## Phản hồi duyệt vòng trước\nBản thiết lập nền tảng vòng trước chưa được thông qua. Bạn phải sửa các vấn đề sau:\n\n${trimmed}\n`;
  }

  private normalizeSectionName(name: string): string {
    return name
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[`"'*_]/g, " ")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  private canonicalSectionNameFromHeading(heading: string): string | null {
    const normalized = this.normalizeSectionName(heading);
    if ([
      "story_frame",
      "story_bible",
      "story_foundation",
      "foundation",
    ].some((name) => normalized.includes(name))
      || /(story_frame|story_bible|story_framework|khung_cau_chuyen)/.test(heading)) {
      return "story_frame";
    }
    if ([
      "volume_map",
      "volume_outline",
      "outline",
      "plot_map",
    ].some((name) => normalized.includes(name))
      || /(volume_map|volume_outline|so_do_quyen)/.test(heading)) {
      return "volume_map";
    }
    if ([
      "roles",
      "characters",
      "character_cards",
    ].some((name) => normalized.includes(name))
      || /(roles|character_cards|character_matrix|vai_tro)/.test(heading)) {
      return "roles";
    }
    if ([
      "book_rules",
      "rules",
      "writing_rules",
    ].some((name) => normalized.includes(name))
      || /(book_rules|writing_rules|quy_tac)/.test(heading)) {
      return "book_rules";
    }
    if ([
      "pending_hooks",
      "hooks",
      "hook_ledger",
    ].some((name) => normalized.includes(name))
      || /(pending_hooks|hook_pool|phuc_but)/.test(heading)) {
      return "pending_hooks";
    }
    if ([
      "rhythm_principles",
      "rhythm",
    ].some((name) => normalized.includes(name))
      || /(rhythm_principles|rhythm|nhip_dieu)/.test(heading)) {
      return "rhythm_principles";
    }
    if ([
      "current_state",
      "initial_state",
    ].some((name) => normalized.includes(name))
      || /(current_state|initial_state|trang_thai)/.test(heading)) {
      return "current_state";
    }
    return null;
  }

  private stripTrailingAssistantCoda(section: string): string {
    const lines = section.split("\n");
    const cutoff = lines.findIndex((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      return /^((?:|||)|If (?:you(?:'d)? like|you want|needed)|I can (?:continue|next))/i.test(trimmed);
    });

    if (cutoff < 0) {
      return section;
    }

    return lines.slice(0, cutoff).join("\n").trimEnd();
  }

  private normalizePendingHooksSection(section: string, volumeMapRaw: string): string {
    const rows = section
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("|"))
      .filter((line) => !line.includes("---"))
      .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))
      .filter((cells) => cells.some(Boolean));

    if (rows.length === 0) {
      return section;
    }

    const dataRows = rows.filter((row) => (row[0] ?? "").toLowerCase() !== "hook_id");
    if (dataRows.length === 0) {
      return section;
    }

    const language: "vi" | "en" = /[\u4e00-\u9fff]/.test(section) ? "vi" : "en";
    const normalizedHooks = dataRows.map((row, index) => {
      const rawProgress = row[4] ?? "";
      const normalizedProgress = this.parseHookChapterNumber(rawProgress);
      const seedNote = normalizedProgress === 0 && this.hasNarrativeProgress(rawProgress)
        ? (language === "vi" ? `initial signal: ${rawProgress}` : `initial signal: ${rawProgress}`)
        : "";

      const phase7 = row.length >= 12;
      const phase6 = row.length >= 8;
      const noteCellIndex = phase7 ? 11 : phase6 ? 7 : 6;
      const notes = this.mergeHookNotes(row[noteCellIndex] ?? "", seedNote, language);

      const base: Record<string, unknown> = {
        hookId: row[0] || `hook-${index + 1}`,
        startChapter: this.parseHookChapterNumber(row[1]),
        type: row[2] ?? "",
        status: row[3] ?? "open",
        lastAdvancedChapter: normalizedProgress,
        expectedPayoff: row[5] ?? "",
        payoffTiming: phase6 ? row[6] ?? "" : "",
        notes,
      };

      if (phase7) {
        base.dependsOn = this.parseDependsOnCell(row[7] ?? "");
        base.paysOffInArc = (row[8] ?? "").trim();
        base.coreHook = this.parseBooleanCell(row[9]);
        const halfLife = this.parseOptionalInt(row[10]);
        if (halfLife !== undefined) base.halfLifeChapters = halfLife;
      }

      return base as unknown as StoredHook;
    });

    // Phase 7 hotfix 2: pre-promote seeds based on the three structural rules
    // that don't need runtime advanced_count (core_hook / depends_on /
    // cross_volume). advanced_count-based promotion is applied later by the
    // consolidator at volume boundaries.
    const volumeBoundaries = this.parseVolumeBoundariesForPromotion(volumeMapRaw);
    const allSeedStartChapters = new Map<string, number>(
      normalizedHooks.map((hook) => [hook.hookId, hook.startChapter]),
    );
    const promotionContext: PromotionContext = {
      volumeBoundaries,
      currentChapter: 0,
      advancedCounts: new Map(),
      allSeedStartChapters,
    };
    const promotedHooks = normalizedHooks.map((hook) => {
      const decision = shouldPromoteHook(hook, promotionContext);
      const status = !decision.promote && hook.lastAdvancedChapter <= 0
        ? this.normalizeDormantSeedStatus(hook.status, language)
        : hook.status;
      return { ...hook, status, promoted: decision.promote };
    });

    return renderHookSnapshot(
      promotedHooks as unknown as Parameters<typeof renderHookSnapshot>[0],
      language,
    );
  }

  /**
   * Parse `architectNarchitect (A-Barchitect)` / `Volume N (chapters A-B)` headers from the
   * architect's volume_map prose. Best-effort: missing / unparseable blocks
   * return an empty list and cross-volume promotion simply never fires.
   */
  private parseVolumeBoundariesForPromotion(raw: string): ReadonlyArray<VolumeBoundary> {
    if (!raw) return [];
    const lines = raw.split("\n");
    const volumeHeader = /^(Volume\\s*\\d+|Volume\s+\d+)/i;
    const rangePattern = /[（(]\s*(?:|[Cc]hapters?\s+)?(\d+)\s*[-–~～—]\s*(\d+)\s*(?:)?\s*[）)]|(?:|[Cc]hapters?\s+)(\d+)\s*[-–~～—]\s*(\d+)\s*(?:)?/i;

    const volumes: VolumeBoundary[] = [];
    for (const rawLine of lines) {
      const line = rawLine.replace(/^#+\s*/, "").trim();
      if (!volumeHeader.test(line)) continue;
      const rangeMatch = line.match(rangePattern);
      if (!rangeMatch) continue;
      const startCh = parseInt(rangeMatch[1] ?? rangeMatch[3] ?? "0", 10);
      const endCh = parseInt(rangeMatch[2] ?? rangeMatch[4] ?? "0", 10);
      if (startCh <= 0 || endCh <= 0) continue;
      const rangeIndex = rangeMatch.index ?? line.length;
      const name = line.slice(0, rangeIndex).replace(/[（(]\s*$/, "").trim();
      if (name.length > 0) {
        volumes.push({ name, startCh, endCh });
      }
    }
    return volumes;
  }

  private normalizeDormantSeedStatus(status: string | undefined, language: "vi" | "en"): string {
    const normalized = status?.trim().toLowerCase() ?? "";
    if (!normalized || /^(open|opened|active)$/i.test(normalized)) {
      return language === "vi" ? "tạm hoãn" : "deferred";
    }
    return status?.trim() || (language === "vi" ? "tạm hoãn" : "deferred");
  }

  private parseHookChapterNumber(value: string | undefined): number {
    if (!value) return 0;
    const match = value.match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
  }

  private parseDependsOnCell(value: string): ReadonlyArray<string> {
    const trimmed = value.trim();
    if (!trimmed) return [];
    const lower = trimmed.toLowerCase();
    if (lower === "none" || lower === "n/a" || lower === "-" || trimmed === "none") return [];
    const stripped = trimmed.replace(/^[\[\(]\s*/, "").replace(/\s*[\]\)]$/, "");
    return stripped
      .split(/[,，、\/]+/)
      .map((item) => item.trim().replace(/^\*\*(.+)\*\*$/, "$1").trim())
      .filter((item) => item.length > 0);
  }

  private parseBooleanCell(value: string | undefined): boolean {
    const normalized = (value ?? "").trim().toLowerCase();
    if (!normalized) return false;
    return /^(true|yes|y|core|1|✓|✔)$/.test(normalized);
  }

  private parseOptionalInt(value: string | undefined): number | undefined {
    const normalized = (value ?? "").trim();
    if (!normalized) return undefined;
    const match = normalized.match(/\d+/);
    if (!match) return undefined;
    const parsed = parseInt(match[0], 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }

  private hasNarrativeProgress(value: string | undefined): boolean {
    const normalized = (value ?? "").trim().toLowerCase();
    if (!normalized) return false;
    return !["0", "none", "n/a", "na", "-", "none", "unadvanced"].includes(normalized);
  }

  private mergeHookNotes(notes: string, seedNote: string, language: "vi" | "en"): string {
    const trimmedNotes = notes.trim();
    const trimmedSeed = seedNote.trim();
    if (!trimmedSeed) {
      return trimmedNotes;
    }
    if (!trimmedNotes) {
      return trimmedSeed;
    }
    return language === "vi"
      ? `${trimmedNotes}（${trimmedSeed}）`
      : `${trimmedNotes} (${trimmedSeed})`;
  }
}
