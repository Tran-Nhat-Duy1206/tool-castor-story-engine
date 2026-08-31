import { BaseAgent } from "./base.js";
import type { ArchitectOutput } from "./architect.js";

export interface FoundationReviewFindingProposal {
  readonly unitId: string;
  readonly category: string;
  readonly severity: "minor" | "important" | "blocking";
  readonly repairScope: "local" | "multi_unit" | "author_decision";
  readonly evidence: string;
  readonly suggestedAction: string;
}

export interface FoundationReviewResult {
  readonly passed: boolean;
  readonly totalScore: number;
  readonly dimensions: ReadonlyArray<{
    readonly name: string;
    readonly score: number;
    readonly feedback: string;
  }>;
  readonly overallFeedback: string;
  /**
   * Optional during legacy compatibility. Task 10 labels every review excerpt
   * with durable unit ids and consumes these structured proposals through Core
   * validation; scores remain informational and never fabricate findings.
   */
  readonly findings?: ReadonlyArray<FoundationReviewFindingProposal>;
}

export class FoundationReviewParseError extends Error {
  constructor(readonly missingDimensions: ReadonlyArray<number>) {
    super(`Foundation review output is missing dimension${missingDimensions.length === 1 ? "" : "s"}: ${missingDimensions.join(", ")}`);
    this.name = "FoundationReviewParseError";
  }
}

const PASS_THRESHOLD = 80;
const DIMENSION_FLOOR = 60;

export class FoundationReviewerAgent extends BaseAgent {
  get name(): string {
    return "foundation-reviewer";
  }

  async review(params: {
    readonly foundation: ArchitectOutput;
    readonly mode: "original" | "fanfic" | "series";
    readonly sourceCanon?: string;
    readonly styleGuide?: string;
    readonly language: "vi" | "en";
    readonly targetChapters?: number;
    /** Task 10 requires a durable exact-unit findings payload; legacy callers may omit it. */
    readonly structuredFindings?: boolean;
  }): Promise<FoundationReviewResult> {
    const canonBlock = params.sourceCanon
      ? `\n## Source Canon Reference\n${params.sourceCanon}\n`
      : "";
    const styleBlock = params.styleGuide
      ? `\n## Source Style Reference\n${params.styleGuide}\n`
      : "";

    const dimensions = params.mode === "original"
      ? this.originalDimensions(params.language, params.targetChapters)
      : this.derivativeDimensions(params.language, params.mode);

    const systemPrompt = this.buildReviewPrompt(
      dimensions,
      canonBlock,
      styleBlock,
      params.language,
    );

    const userPrompt = this.buildFoundationExcerpt(params.foundation, params.language);

    const response = await this.chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ], { temperature: 0.3 });

    return this.parseReviewResult(response.content, dimensions, params.structuredFindings === true);
  }

  private originalDimensions(_language: "vi" | "en", targetChapters?: number): ReadonlyArray<string> {
    const target = Number.isFinite(targetChapters) && targetChapters && targetChapters > 0
      ? Math.round(targetChapters)
      : 40;
    const openingWindow = Math.min(5, target);
    const repeatWindow = Math.min(10, Math.max(3, target));
    return [
      `Core Conflict (Is there a clear, compelling central conflict that can sustain the requested ${target} chapters?)`,
      `Opening Momentum (Can the first ${openingWindow} chapters create a page-turning hook?)`,
      "World Coherence (Is the worldbuilding internally consistent and specific?)",
      "Character Differentiation (Are the main characters distinct in voice and motivation?)",
      `Pacing Feasibility (Does the outline fit the requested ${target} chapters and avoid repeating the same beat for ${repeatWindow} chapters?)`,
    ];
  }

  private derivativeDimensions(_language: "vi" | "en", mode: "fanfic" | "series"): ReadonlyArray<string> {
    const modeLabel = mode === "fanfic" ? "Fan Fiction" : "Series";
    return [
      `Source DNA Preservation (Does the ${modeLabel} respect the original's world rules, character personalities, and established facts?)`,
      "New Narrative Space (Is there a clear divergence point or new territory that gives the story room to be ORIGINAL, not a retelling?)",
      "Core Conflict (Is the new story's central conflict compelling and distinct from the original?)",
      "Opening Momentum (Can the first 5 chapters create a page-turning hook without requiring 3 chapters of setup?)",
      "Pacing Feasibility (Does the outline avoid the trap of re-walking the original's plot beats?)",
    ];
  }

  private buildReviewPrompt(
    dimensions: ReadonlyArray<string>,
    canonBlock: string,
    styleBlock: string,
    language: "vi" | "en",
  ): string {
    const outputLanguage = language === "vi" ? "Vietnamese" : "English";
    return `You are a senior fiction editor reviewing a new book's foundation (worldbuilding + outline + rules).

Output all natural-language feedback in ${outputLanguage}. Keep all required tags, JSON keys, and enum values exactly as specified in English.

Score each dimension (0-100) with specific feedback:

${dimensions.map((dim, i) => `${i + 1}. ${dim}`).join("\n")}

## Scoring
- 80+ Pass — ready to write
- 60-79 Needs revision
- <60 Fundamental direction problem

## Output format (strict)
=== DIMENSION: 1 ===
Score: {0-100}
Feedback: {specific feedback}

=== DIMENSION: 2 ===
Score: {0-100}
Feedback: {specific feedback}

...

=== FINDINGS_JSON ===
[{"unitId":"exact unitId from the input","category":"story_core|character|relationship|world|structure|pacing_feasibility|hook|timeline|book_rule|dependency|internal_consistency|author_intent_alignment","severity":"minor|important|blocking","repairScope":"local|multi_unit|author_decision","evidence":"one unique exact excerpt from that unit","suggestedAction":"complete replacement text for evidence"}]
Output [] when there is no specific finding. Never fabricate a finding from score alone; a LOCAL finding requires exact single-unit replacement evidence and action.

=== OVERALL ===
Total: {weighted average}
Passed: {yes/no}
Summary: {1-2 paragraphs — biggest problem and best quality}
${canonBlock}${styleBlock}

Be strict. 80 means "ready to write without changes."`;
  }

  private buildFoundationExcerpt(foundation: ArchitectOutput, language: "vi" | "en"): string {
    const outputLanguage = language === "vi" ? "Vietnamese" : "English";
    return `The requested output language is ${outputLanguage}.

## Story Bible
${foundation.storyBible}

## Volume Outline
${foundation.volumeOutline}

## Book Rules
${foundation.bookRules}

## Initial State
${foundation.currentState}

## Initial Hooks
${foundation.pendingHooks}`;
  }

  private parseReviewResult(
    content: string,
    dimensions: ReadonlyArray<string>,
    requireStructuredFindings: boolean,
  ): FoundationReviewResult {
    const parsedDimensions: Array<{ readonly name: string; readonly score: number; readonly feedback: string }> = [];
    const missingDimensions: number[] = [];

    for (let i = 0; i < dimensions.length; i++) {
      const regex = new RegExp(
        `=== DIMENSION: ${i + 1} ===\\s*[\\s\\S]*?Score[：:]\\s*(\\d+)[\\s\\S]*?Feedback[：:]\\s*([\\s\\S]*?)(?==== |$)`,
      );
      const match = content.match(regex);
      if (!match) {
        missingDimensions.push(i + 1);
        continue;
      }
      parsedDimensions.push({
        name: dimensions[i]!,
        score: parseInt(match[1]!, 10),
        feedback: match[2]!.trim(),
      });
    }

    if (missingDimensions.length > 0) {
      throw new FoundationReviewParseError(missingDimensions);
    }

    const totalScore = parsedDimensions.length > 0
      ? Math.round(parsedDimensions.reduce((sum, d) => sum + d.score, 0) / parsedDimensions.length)
      : 0;
    const anyBelowFloor = parsedDimensions.some((d) => d.score < DIMENSION_FLOOR);
    const passed = totalScore >= PASS_THRESHOLD && !anyBelowFloor;

    const overallMatch = content.match(
      /=== OVERALL ===[\s\S]*?Summary[：:]\s*([\s\S]*?)$/,
    );
    const overallFeedback = overallMatch ? overallMatch[1]!.trim() : "(parse failed)";

    const findingsMatch = content.match(/=== FINDINGS_JSON ===\s*([\s\S]*?)(?==== OVERALL ===|$)/);
    if (requireStructuredFindings && !findingsMatch) {
      throw new Error("Foundation reviewer output is missing required FINDINGS_JSON");
    }
    let findings: ReadonlyArray<FoundationReviewFindingProposal> | undefined;
    if (findingsMatch) {
      const jsonText = findingsMatch[1]!
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");
      const parsed = JSON.parse(jsonText) as unknown;
      if (!Array.isArray(parsed)) throw new Error("Foundation reviewer FINDINGS_JSON must be an array");
      findings = parsed.map((item, index) => {
        if (typeof item !== "object" || item === null) {
          throw new Error(`Foundation reviewer finding ${index} must be an object`);
        }
        const value = item as Record<string, unknown>;
        const stringFields = ["unitId", "category", "severity", "repairScope", "evidence", "suggestedAction"] as const;
        for (const field of stringFields) {
          if (typeof value[field] !== "string" || value[field].trim().length === 0) {
            throw new Error(`Foundation reviewer finding ${index} has invalid ${field}`);
          }
        }
        return {
          unitId: value.unitId as string,
          category: value.category as string,
          severity: value.severity as FoundationReviewFindingProposal["severity"],
          repairScope: value.repairScope as FoundationReviewFindingProposal["repairScope"],
          evidence: value.evidence as string,
          suggestedAction: value.suggestedAction as string,
        };
      });
    }

    return { passed, totalScore, dimensions: parsedDimensions, overallFeedback, findings };
  }
}
