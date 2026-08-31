import { BaseAgent } from "./base.js";
import type { FanficMode } from "../models/book.js";

export interface FanficCanonOutput {
  readonly worldRules: string;
  readonly characterProfiles: string;
  readonly keyEvents: string;
  readonly powerSystem: string;
  readonly writingStyle: string;
  readonly fullDocument: string;
}

const MODE_LABELS: Record<FanficMode, string> = {
  canon: "Canon (strictly follows source material)",
  au: "AU / Alternate Universe (rules may vary, core personas retained)",
  ooc: "OOC (personas may deviate from source)",
  cp: "CP / Pairing (relationship dynamics focused)",
};

const SOURCE_CHUNK_CHARS = 50_000;

export class FanficCanonImporter extends BaseAgent {
  get name(): string {
    return "fanfic-canon-importer";
  }

  async importFromText(
    sourceText: string,
    sourceName: string,
    fanficMode: FanficMode,
  ): Promise<FanficCanonOutput> {
    const source = await this.prepareSourceText(sourceText, sourceName);

    const modeLabel = MODE_LABELS[fanficMode];

    const systemPrompt = `You are a professional fanfiction canon analyst. Your task is to extract structured canon information from source material for a fanfiction writing engine.

Fanfic mode: ${modeLabel}

Extract the following sections separated by === SECTION: <name> === markers:

=== SECTION: world_rules ===
World rules (geography, physical laws, magic/power systems, factions/organizations, social structures).
If the source does not contain explicit world rules, infer reasonably from available information.

=== SECTION: character_profiles ===
Character profile table, one row per important character:

| Character | Role / Identity | Persona Core | Catchphrases / Verbal Tics | Speaking Style | Behavioral Patterns | Key Relationships | Info Boundary |
|-----------|-----------------|--------------|----------------------------|----------------|---------------------|-------------------|---------------|

Requirements:
- Catchphrases / verbal tics must be precisely extracted from source text if present
- Speaking style describes tone, word choice preferences, sentence patterns
- Behavioral patterns describe typical reactions in concrete situations
- Info boundary notes what the character knows vs does not know
- Extract between 3 and 15 characters

=== SECTION: key_events ===
Key event timeline:

| No. | Event | Involved Characters | Constraints on Fanfic Writing |
|-----|-------|---------------------|--------------------------------|

Ordered chronologically or by appearance, noting constraints on fanfic creation.

=== SECTION: power_system ===
Power / ability system (if applicable). Include tier classifications, core rules, known limitations.
If the source has no explicit power system, output "(Source has no explicit power system)".

=== SECTION: writing_style ===
Source writing style characteristics:

1. Narrative POV and person (first-person / third-person limited / omniscient, switching frequency)
2. Sentence cadence (long/short variation, paragraph length, dialogue ratio)
3. Scene description methods (sensory details, imagery, environmental density)
4. Dialogue tags and formatting
5. Emotional expression (interiority vs exterior action vs environmental reflection)
6. Rhetorical tendencies (metaphors, figurative language)
7. Pacing shifts (tension -> release transitions, chapter endings)

Support each item with 1-2 source quotes. Extract only genuine textual features.

Extraction principles:
- Faithful to source material; do not fabricate information
- When info is missing, mark "(Not mentioned in source)" rather than making things up
- Character voice and tics are top priority
- Writing style extraction must be grounded in actual text evidence
${source.compiled ? "\nNote: The source is long. The input below is a compiled semantic dossier; refer to chunk numbers and evidence." : ""}`;

    const response = await this.chat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Source material for "${sourceName}":\n\n${source.text}` },
      ],
      { temperature: 0.3 },
    );

    const content = response.content;
    const extract = (tag: string): string => {
      const regex = new RegExp(
        `=== SECTION: ${tag} ===\\s*([\\s\\S]*?)(?==== SECTION:|$)`,
      );
      const match = content.match(regex);
      return match?.[1]?.trim() ?? "";
    };

    const worldRules = extract("world_rules");
    const characterProfiles = extract("character_profiles");
    const keyEvents = extract("key_events");
    const powerSystem = extract("power_system");
    const writingStyle = extract("writing_style");

    const meta = [
      "---",
      "meta:",
      `  sourceFile: "${sourceName}"`,
      `  fanficMode: "${fanficMode}"`,
      `  generatedAt: "${new Date().toISOString()}"`,
    ].join("\n");

    const fullDocument = [
      `# Fanfic Canon ("${sourceName}")`,
      "",
      "## World Rules",
      worldRules || "(No explicit world rules extracted from source)",
      "",
      "## Character Profiles",
      characterProfiles || "(No character profiles extracted from source)",
      "",
      "## Key Event Timeline",
      keyEvents || "(No key events extracted from source)",
      "",
      "## Power System",
      powerSystem || "(Source has no explicit power system)",
      "",
      "## Writing Style",
      writingStyle || "(Insufficient source material for style extraction)",
      "",
      meta,
    ].join("\n");

    return { worldRules, characterProfiles, keyEvents, powerSystem, writingStyle, fullDocument };
  }

  private async prepareSourceText(sourceText: string, sourceName: string): Promise<{ readonly text: string; readonly compiled: boolean }> {
    if (sourceText.length <= SOURCE_CHUNK_CHARS) {
      return { text: sourceText, compiled: false };
    }

    const chunks = splitIntoChunks(sourceText, SOURCE_CHUNK_CHARS);
    const notes: string[] = [];
    for (let index = 0; index < chunks.length; index++) {
      const response = await this.chat(
        [
          {
            role: "system",
            content: [
              "You are a fanfic canon compiler. Your job is to compress a source fragment into a structured Markdown dossier for downstream extraction.",
              "Do not continue the story, do not invent facts. Retain only genuine world rules, characters, relationships, key events, power systems, catchphrases, speaking styles, and textual evidence.",
              "Omit sections that have no information in this chunk. Preserve chunk index for traceability.",
            ].join("\n"),
          },
          {
            role: "user",
            content: [
              `Source: "${sourceName}"`,
              `Chunk: ${index + 1}/${chunks.length}`,
              "",
              chunks[index],
            ].join("\n"),
          },
        ],
        { temperature: 0.2 },
      );
      const content = response.content.trim();
      if (content) {
        notes.push([`## Chunk ${index + 1}/${chunks.length}`, content].join("\n\n"));
      }
    }

    return {
      compiled: true,
      text: [
        `# "${sourceName}" Semantic Dossier`,
        "",
        "The following content was compiled from the full source text by Castor for downstream canon extraction. It is not truncated.",
        "",
        ...notes,
      ].join("\n"),
    };
  }
}

function splitIntoChunks(text: string, chunkChars: number): string[] {
  const chunks: string[] = [];
  for (let offset = 0; offset < text.length; offset += chunkChars) {
    chunks.push(text.slice(offset, offset + chunkChars));
  }
  return chunks;
}
