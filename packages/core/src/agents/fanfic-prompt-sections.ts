import type { FanficMode } from "../models/book.js";

const MODE_PREAMBLES: Record<FanficMode, string> = {
  canon: `You are writing **Canon Fanfiction**. Strictly observe canon:
- Character catchphrases, speaking style, and behavioral patterns must match the original work
- World rules cannot be violated
- Key event timeline must not conflict
- You may fill in canon gaps and explore unstated angles`,

  au: `You are writing **AU (Alternate Universe) Fanfiction**:
- World rules can change (deviations declared in allowedDeviations)
- Character core personas and speech style should remain recognizable
- AU deviations must be internally consistent`,

  ooc: `You are writing **OOC Fanfiction**:
- Characters may deviate from personality under extreme situations
- Deviations must be situationally motivated
- Retain voice markers and speaking styles even if personality shifts`,

  cp: `You are writing **Pairing / CP Fanfiction**, centered on character interaction:
- The pair must have meaningful interaction in every chapter
- The chemistry must be active and distinct
- Relationship development should have rhythm: advance, probe, obstacle, breakthrough`,
};

export function buildFanficCanonSection(
  fanficCanon: string,
  mode: FanficMode,
): string {
  return `
## Fanfic Canon Reference

${MODE_PREAMBLES[mode]}

Below is the original canon reference; you must follow it when writing:

${fanficCanon}`;
}

export function buildCharacterVoiceProfiles(fanficCanon: string): string {
  // Extract character table from fanfic_canon.md
  const tableMatch = fanficCanon.match(
    /## (?:Character Profiles|)[\s\S]*?\n(\|[^\n]+\|\n\|[-|\s]+\|\n(?:\|[^\n]+\|\n)*)/,
  );
  if (!tableMatch) return "";

  const rows = tableMatch[1]!
    .split("\n")
    .filter((line) => line.startsWith("|") && !line.startsWith("|--") && !line.startsWith("| Character") && !line.startsWith("| "))
    .map((line) =>
      line
        .split("|")
        .map((cell) => cell.trim())
        .filter(Boolean),
    )
    .filter((cells) => cells.length >= 5);

  if (rows.length === 0) return "";

  const profiles = rows.map((cells) => {
    const [name, , , catchphrases, speakingStyle, behavior] = cells;
    const parts: string[] = [`### ${name}`];
    if (catchphrases && !catchphrases.includes("Not mentioned") && !catchphrases.includes("")) {
      parts.push(`- Catchphrases / verbal tics: ${catchphrases}`);
    }
    if (speakingStyle && !speakingStyle.includes("Not mentioned") && !speakingStyle.includes("")) {
      parts.push(`- Speaking style: ${speakingStyle}`);
    }
    if (behavior && !behavior.includes("Not mentioned") && !behavior.includes("")) {
      parts.push(`- Behavioral pattern: ${behavior}`);
    }
    return parts.join("\n");
  });

  return `
## Character Voice Reference

Follow the original character traits for dialogue and action.

${profiles.join("\n\n")}`;
}

const MODE_CHECKS: Record<FanficMode, string> = {
  canon: `- Canon compliance check: Does this chapter violate original world rules? Does dialogue match voice traits?
- Info boundary check: Does any character reference information they shouldn't know?`,

  au: `- AU deviation checklist: Which world rules are altered? Is the change internally consistent?
- Persona recognizability check: Can readers recognize the character from dialogue?`,

  ooc: `- OOC deviation record: In what aspects did the character deviate? What is the situational motivation?
- Voice retention check: Does speech style retain recognizable traits?`,

  cp: `- Pairing interaction check: Do the paired characters interact meaningfully? Does the dynamic advance?
- Interaction quality check: Is there genuine chemistry?`,
};

export function buildFanficModeInstructions(
  mode: FanficMode,
  allowedDeviations: ReadonlyArray<string>,
): string {
  const deviationsBlock = allowedDeviations.length > 0
    ? `\nAllowed deviations (not treated as violations):\n${allowedDeviations.map((d) => `- ${d}`).join("\n")}\n`
    : "";

  return `
## Fanfic Mode Pre-Write Check

${MODE_CHECKS[mode]}${deviationsBlock}`;
}
