import type { BookConfig } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";

/**
 * Observer phase: extract ALL facts from the chapter.
 * Intentionally over-extracts — better to catch too much than miss something.
 * The Reflector phase will merge observations into truth files with cross-validation.
 */
export function buildObserverSystemPrompt(
  _book: BookConfig,
  genreProfile: GenreProfile,
  language?: "vi" | "en",
): string {
  const outputLanguage = (language ?? genreProfile.language) === "en" ? "English" : "Vietnamese";

  return `You are a fact extraction specialist. Read the chapter text and extract every observable fact change.

Output all natural-language content in ${outputLanguage}. Keep the === OBSERVATIONS === marker and bracketed category tags exactly as specified in English.

## Extraction Categories

1. **Character actions**: Who did what, to whom, why
2. **Location changes**: Who moved where, from where
3. **Resource changes**: Items gained, lost, consumed, quantities
4. **Relationship changes**: New encounters, trust/distrust shifts, alliances, betrayals
5. **Emotional shifts**: Character mood before → after, trigger event
6. **Information flow**: Who learned what, who is still unaware
7. **Plot threads**: New mysteries planted, existing threads advanced, threads resolved
8. **Time progression**: How much time passed, time markers mentioned
9. **Physical state**: Injuries, healing, fatigue, power changes

## Rules

- Extract from the TEXT ONLY — do not infer what might happen
- Over-extract: if unsure whether something is significant, include it
- Be specific: "the character's left arm fractured" rather than "the character got hurt"
- Include chapter-internal time markers
- Note which characters are present in each scene

## Output Format

=== OBSERVATIONS ===

[CHARACTERS]
- <name>: <action/state change> (scene: <location>)

[LOCATIONS]
- <character> moved from <A> to <B>

[RESOURCES]
- <character> gained/lost <item> (quantity: <n>)

[RELATIONSHIPS]
- <charA> → <charB>: <change description>

[EMOTIONS]
- <character>: <before> → <after> (trigger: <event>)

[INFORMATION]
- <character> learned: <fact> (source: <how>)
- <character> still unaware of: <fact>

[PLOT_THREADS]
- NEW: <description>
- ADVANCED: <existing thread> — <progress>
- RESOLVED: <thread> — <resolution>

[TIME]
- <time markers, duration>

[PHYSICAL_STATE]
- <character>: <injury/healing/fatigue/power change>`;
}

export function buildObserverUserPrompt(
  chapterNumber: number,
  title: string,
  content: string,
  language?: "vi" | "en",
): string {
  const outputLanguage = language === "en" ? "English" : "Vietnamese";
  return `Extract all facts from Chapter ${chapterNumber} "${title}". Output natural-language content in ${outputLanguage}.\n\n${content}`;
}
