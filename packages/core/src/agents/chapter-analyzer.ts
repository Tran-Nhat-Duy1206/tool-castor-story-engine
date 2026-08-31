import { BaseAgent } from "./base.js";
import type { BookConfig } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";
import type { ContextPackage, RuleStack } from "../models/input-governance.js";
import { readGenreProfile, readBookRules } from "./rules-reader.js";
import { parseWriterOutput, type ParsedWriterOutput } from "./writer-parser.js";
import { buildGovernedMemoryEvidenceBlocks } from "../utils/governed-context.js";
import {
  buildGovernedCharacterMatrixWorkingSet,
  buildGovernedHookWorkingSet,
} from "../utils/governed-working-set.js";
import { filterEmotionalArcs, filterSubplots } from "../utils/context-filter.js";
import { countChapterLength, resolveLengthCountingMode } from "../utils/length-metrics.js";
import { retrieveMemorySelection } from "../utils/memory-retrieval.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  readStoryFrame,
  readVolumeMap,
  readCharacterContext,
  readCurrentStateWithFallback,
} from "../utils/outline-paths.js";

export interface AnalyzeChapterInput {
  readonly book: BookConfig;
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly chapterContent: string;
  readonly chapterTitle?: string;
  readonly chapterIntent?: string;
  readonly contextPackage?: ContextPackage;
  readonly ruleStack?: RuleStack;
}

export type AnalyzeChapterOutput = ParsedWriterOutput;

export class ChapterAnalyzerAgent extends BaseAgent {
  get name(): string {
    return "chapter-analyzer";
  }

  async analyzeChapter(input: AnalyzeChapterInput): Promise<AnalyzeChapterOutput> {
    const { book, bookDir, chapterNumber, chapterContent, chapterTitle } = input;
    const { profile: genreProfile, body: genreBody } =
      await readGenreProfile(this.ctx.projectRoot, book.genre);
    const resolvedLanguage = book.language ?? genreProfile.language;

    // Read current truth files (same set as writer.ts). Phase 5: prefer the
    // new prose outline (story_frame / volume_map) and roles/ directory.
    const placeholder = this.missingFilePlaceholder(resolvedLanguage);
    const [
      currentState, ledger, hooks,
      subplotBoard, emotionalArcs, characterMatrix,
      storyBible, volumeOutline,
    ] = await Promise.all([
      // Phase 5 consolidation: derive initial state from roles + seed hooks
      // when current_state.md is still the architect seed placeholder.
      readCurrentStateWithFallback(bookDir, placeholder),
      this.readFileOrDefault(join(bookDir, "story/particle_ledger.md"), resolvedLanguage),
      this.readFileOrDefault(join(bookDir, "story/pending_hooks.md"), resolvedLanguage),
      this.readFileOrDefault(join(bookDir, "story/subplot_board.md"), resolvedLanguage),
      this.readFileOrDefault(join(bookDir, "story/emotional_arcs.md"), resolvedLanguage),
      readCharacterContext(bookDir, placeholder),
      readStoryFrame(bookDir, placeholder),
      readVolumeMap(bookDir, placeholder),
    ]);
    const parsedBookRules = await readBookRules(bookDir);
    const bookRulesBody = parsedBookRules?.body ?? "";
    const bookRules = parsedBookRules?.rules;
    const governedMode = Boolean(input.chapterIntent && input.contextPackage && input.ruleStack);
    const memorySelection = await retrieveMemorySelection({
      bookDir,
      chapterNumber,
      goal: this.buildMemoryGoal(chapterTitle, chapterContent),
      outlineNode: this.findOutlineNode(volumeOutline, chapterNumber),
    });
    const chapterSummaries = this.renderSummarySnapshot(
      memorySelection.summaries,
      resolvedLanguage,
    );
    const governedMemoryBlocks = input.contextPackage
      ? buildGovernedMemoryEvidenceBlocks(input.contextPackage, resolvedLanguage)
      : undefined;
    const hooksWorkingSet = governedMode && input.contextPackage
      ? buildGovernedHookWorkingSet({
          hooksMarkdown: hooks,
          contextPackage: input.contextPackage,
          chapterIntent: input.chapterIntent,
          chapterNumber,
          language: resolvedLanguage,
        })
      : hooks;
    const subplotWorkingSet = governedMode
      ? filterSubplots(subplotBoard)
      : subplotBoard;
    const emotionalWorkingSet = governedMode
      ? filterEmotionalArcs(emotionalArcs, chapterNumber)
      : emotionalArcs;
    const matrixWorkingSet = governedMode && input.chapterIntent && input.contextPackage
      ? buildGovernedCharacterMatrixWorkingSet({
          matrixMarkdown: characterMatrix,
          chapterIntent: input.chapterIntent,
          contextPackage: input.contextPackage,
          protagonistName: bookRules?.protagonist?.name,
        })
      : characterMatrix;
    const reducedControlBlock = governedMode && input.chapterIntent && input.contextPackage && input.ruleStack
      ? this.buildReducedControlBlock(input.chapterIntent, input.contextPackage, input.ruleStack, resolvedLanguage)
      : "";

    const systemPrompt = this.buildSystemPrompt(
      book,
      genreProfile,
      genreBody,
      bookRulesBody,
      resolvedLanguage,
    );

    const userPrompt = this.buildUserPrompt({
      language: resolvedLanguage,
      chapterNumber,
      chapterContent,
      chapterTitle,
      currentState,
      ledger: genreProfile.numericalSystem ? ledger : "",
      hooks: hooksWorkingSet,
      chapterSummaries,
      subplotBoard: subplotWorkingSet,
      emotionalArcs: emotionalWorkingSet,
      characterMatrix: matrixWorkingSet,
      bibleBlock: !governedMode && storyBible !== this.missingFilePlaceholder(resolvedLanguage)
        ? resolvedLanguage === "en"
          ? `\n## Story Bible\n${storyBible}\n`
          : `\n## World Setting\n${storyBible}\n`
        : "",
      outlineOrControlBlock: reducedControlBlock || (
        volumeOutline !== this.missingFilePlaceholder(resolvedLanguage)
          ? resolvedLanguage === "en"
            ? `\n## Volume Outline\n${volumeOutline}\n`
            : `\n## Volume Outline\n${volumeOutline}\n`
          : ""
      ),
      hooksBlock: governedMemoryBlocks?.hooksBlock
        ?? (
          hooksWorkingSet !== this.missingFilePlaceholder(resolvedLanguage)
            ? resolvedLanguage === "en"
              ? `\n## Current Hooks\n${hooksWorkingSet}\n`
              : `\n## Pending Hooks Pool\n${hooksWorkingSet}\n`
            : ""
        ),
      summariesBlock: governedMemoryBlocks?.summariesBlock
        ?? (
          chapterSummaries !== this.missingFilePlaceholder(resolvedLanguage)
            ? resolvedLanguage === "en"
              ? `\n## Existing Chapter Summaries\n${chapterSummaries}\n`
              : `\n## Existing Chapter Summaries\n${chapterSummaries}\n`
            : ""
        ),
      volumeSummariesBlock: governedMemoryBlocks?.volumeSummariesBlock ?? "",
      subplotBlock: subplotWorkingSet !== this.missingFilePlaceholder(resolvedLanguage)
        ? resolvedLanguage === "en"
          ? `\n## Current Subplot Board\n${subplotWorkingSet}\n`
          : `\n## Subplot Board\n${subplotWorkingSet}\n`
        : "",
      emotionalBlock: emotionalWorkingSet !== this.missingFilePlaceholder(resolvedLanguage)
        ? resolvedLanguage === "en"
          ? `\n## Current Emotional Arcs\n${emotionalWorkingSet}\n`
          : `\n## Emotional Arcs\n${emotionalWorkingSet}\n`
        : "",
      matrixBlock: matrixWorkingSet !== this.missingFilePlaceholder(resolvedLanguage)
        ? resolvedLanguage === "en"
          ? `\n## Current Character Matrix\n${matrixWorkingSet}\n`
          : `\n## Character Matrix\n${matrixWorkingSet}\n`
        : "",
    });

    const response = await this.chat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.3 },
    );

    const countingMode = resolveLengthCountingMode(book.language ?? genreProfile.language);
    const output = parseWriterOutput(chapterNumber, response.content, genreProfile, countingMode);
    const canonicalContent = chapterContent;
    const canonicalWordCount = countChapterLength(canonicalContent, countingMode);

    // If LLM didn't return a title, use the one from input or derive from chapter number
    if (
      chapterTitle
      && (
        output.title === this.defaultChapterTitle(chapterNumber, resolvedLanguage)
        || output.title === `Chapter ${chapterNumber}`
      )
    ) {
      return {
        ...output,
        title: chapterTitle,
        content: canonicalContent,
        wordCount: canonicalWordCount,
      };
    }

    return {
      ...output,
      content: canonicalContent,
      wordCount: canonicalWordCount,
    };
  }

  private buildSystemPrompt(
    book: BookConfig,
    genreProfile: GenreProfile,
    genreBody: string,
    bookRulesBody: string,
    language: "vi" | "en",
  ): string {
    const outputLanguage = language === "en" ? "English" : "Vietnamese";
    const numericalBlock = genreProfile.numericalSystem
      ? "- This genre tracks numerical/resource systems; UPDATED_LEDGER must capture every resource change shown in the chapter."
      : "- This genre has no numerical system; leave UPDATED_LEDGER empty.";
    return `You are a fiction continuity analyst. Analyze a finished chapter, extract every state change, and update the tracking files.

LANGUAGE REQUIREMENT: Write all output content in ${outputLanguage}. Keep the === TAG === markers and machine field names unchanged. Do not use Chinese. Repeat CHAPTER_CONTENT exactly in its original language.

## Working Mode
You are not writing new prose. Read completed chapter text and update the book's truth files incrementally rather than rebuilding them.

## What To Extract
- Character entrances, exits, injuries, breakthroughs, deaths, and status changes
- Location movement and scene transitions
- Item or resource gains and losses
- Hook setup, advancement, and payoff
- Emotional arc and subplot movement
- Relationship and information-boundary changes

## Book Information
- Title: ${book.title}
- Genre: ${genreProfile.name} (${book.genre})
- Platform: ${book.platform}
${numericalBlock}

## Genre Guidance
${genreBody}
${bookRulesBody ? `\n## Book Rules\n${bookRulesBody}` : ""}

## Output Format
Use these delimiters exactly:
=== CHAPTER_TITLE ===
(Title text only.)
=== CHAPTER_CONTENT ===
(Repeat the original chapter content exactly.)
=== PRE_WRITE_CHECK ===
(Leave empty.)
=== POST_SETTLEMENT ===
(Leave empty.)
=== UPDATED_STATE ===
Markdown table: Field | Value, covering Current Chapter, Current Location, Protagonist State, Current Goal, Current Constraint, Current Alliances, and Current Conflict.
=== UPDATED_LEDGER ===
(Fully updated resource ledger when applicable; otherwise empty.)
=== UPDATED_HOOKS ===
Markdown table preserving every known hook and its latest status. Keep existing machine columns unchanged.
=== CHAPTER_SUMMARY ===
One Markdown table row covering Chapter, Title, Characters, Key Events, State Changes, Hook Activity, Mood, and Chapter Type.
=== UPDATED_SUBPLOTS ===
Updated subplot board as Markdown.
=== UPDATED_EMOTIONAL_ARCS ===
Updated emotional arcs as Markdown.
=== UPDATED_CHARACTER_MATRIX ===
One ## section per character with bullet fields Role, Tags, Contrast, Speech, Personality, Motivation, Current, Relationships, Known, and Unknown.

Rules: apply incremental updates; reflect every factual change; do not miss resources, movement, relationships, or information changes; keep each character's knowledge boundary exact.`;
  }
  private buildUserPrompt(params: {
    readonly language: "vi" | "en";
    readonly chapterNumber: number;
    readonly chapterContent: string;
    readonly chapterTitle?: string;
    readonly currentState: string;
    readonly ledger: string;
    readonly hooks: string;
    readonly chapterSummaries: string;
    readonly subplotBoard: string;
    readonly emotionalArcs: string;
    readonly characterMatrix: string;
    readonly hooksBlock: string;
    readonly summariesBlock: string;
    readonly volumeSummariesBlock: string;
    readonly subplotBlock: string;
    readonly emotionalBlock: string;
    readonly matrixBlock: string;
    readonly bibleBlock: string;
    readonly outlineOrControlBlock: string;
  }): string {
    const outputLanguage = params.language === "en" ? "English" : "Vietnamese";
    const titleLine = params.chapterTitle ? `Chapter title: ${params.chapterTitle}\n` : "";
    const ledgerBlock = params.ledger ? `\n## Current Resource Ledger\n${params.ledger}\n` : "";
    return `Analyze chapter ${params.chapterNumber} and update all tracking files. Write analysis output in ${outputLanguage}; keep machine tags unchanged.
${titleLine}
## Chapter Content
${params.chapterContent}

## Current State
${params.currentState}
${ledgerBlock}${params.hooksBlock}${params.volumeSummariesBlock}${params.subplotBlock}${params.emotionalBlock}${params.matrixBlock}${params.summariesBlock}${params.outlineOrControlBlock}${params.bibleBlock}

Return the result strictly in the === TAG === format.`;
  }
  private buildReducedControlBlock(
    chapterIntent: string,
    contextPackage: ContextPackage,
    ruleStack: RuleStack,
    language: "vi" | "en",
  ): string {
    const selectedContext = contextPackage.selectedContext
      .map((entry) => `- ${entry.source}: ${entry.reason}${entry.excerpt ? ` | ${entry.excerpt}` : ""}`)
      .join("\n");
    const overrides = ruleStack.activeOverrides.length > 0
      ? ruleStack.activeOverrides
        .map((override) => `- ${override.from} -> ${override.to}: ${override.reason} (${override.target})`)
        .join("\n")
      : "- none";

    return language === "en"
      ? `\n## Chapter Control Inputs (compiled by Planner/Composer)
${chapterIntent}

### Selected Context
${selectedContext || "- none"}

### Rule Stack
- Hard guardrails: ${ruleStack.sections.hard.join(", ") || "(none)"}
- Soft constraints: ${ruleStack.sections.soft.join(", ") || "(none)"}
- Diagnostic rules: ${ruleStack.sections.diagnostic.join(", ") || "(none)"}

### Active Overrides
${overrides}\n`
      : `\n## Chapter Control Input (Compiled by Planner/Composer)
${chapterIntent}

### Selected Context
${selectedContext || "- none"}

### Rule Stack
- Hard Guardrails: ${ruleStack.sections.hard.join("、") || "()"}
- Soft Constraints: ${ruleStack.sections.soft.join("、") || "()"}
- Diagnostic Rules: ${ruleStack.sections.diagnostic.join("、") || "()"}

### Current Overrides
${overrides}\n`;
  }

  private buildMemoryGoal(chapterTitle: string | undefined, chapterContent: string): string {
    return [chapterTitle ?? "", chapterContent]
      .filter((part) => part.trim().length > 0)
      .join("\n\n");
  }

  private findOutlineNode(volumeOutline: string, chapterNumber: number): string | undefined {
    if (!volumeOutline || volumeOutline === this.missingFilePlaceholder("vi") || volumeOutline === this.missingFilePlaceholder("en")) {
      return undefined;
    }

    const lines = volumeOutline.split("\n").map((line) => line.trim()).filter(Boolean);
    const chapterPatterns = [
      new RegExp(`^#+\\s*Chapter\\s*${chapterNumber}\\b`, "i"),
      new RegExp(`^#+\\s*Chương \\s*${chapterNumber}\\s*`),
    ];

    const heading = lines.find((line) => chapterPatterns.some((pattern) => pattern.test(line)));
    if (!heading) return undefined;

    const headingIndex = lines.indexOf(heading);
    const nextLine = lines[headingIndex + 1];
    return nextLine && !nextLine.startsWith("#") ? nextLine : heading.replace(/^#+\s*/, "");
  }

  private renderSummarySnapshot(
    summaries: ReadonlyArray<{
      chapter: number;
      title: string;
      characters: string;
      events: string;
      stateChanges: string;
      hookActivity: string;
      mood: string;
      chapterType: string;
    }>,
    language: "vi" | "en",
  ): string {
    if (summaries.length === 0) {
      return this.missingFilePlaceholder(language);
    }

    const header = language === "en"
      ? [
          "| Chapter | Title | Characters | Key Events | State Changes | Hook Activity | Mood | Chapter Type |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
      : [
          "|  |  |  |  |  |  |  |  |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
        ];

    const rows = summaries.map((summary) => [
      summary.chapter,
      summary.title,
      summary.characters,
      summary.events,
      summary.stateChanges,
      summary.hookActivity,
      summary.mood,
      summary.chapterType,
    ].map((cell) => this.escapeTableCell(String(cell))).join(" | "));

    return [
      ...header,
      ...rows.map((row) => `| ${row} |`),
    ].join("\n");
  }

  private escapeTableCell(value: string): string {
    return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
  }

  private async readFileOrDefault(path: string, language: "vi" | "en"): Promise<string> {
    try {
      return await readFile(path, "utf-8");
    } catch {
      return this.missingFilePlaceholder(language);
    }
  }

  private missingFilePlaceholder(language: "vi" | "en"): string {
    return language === "en" ? "(file not created yet)" : "()";
  }

  private defaultChapterTitle(chapterNumber: number, language: "vi" | "en"): string {
    return language === "en" ? `Chapter ${chapterNumber}` : `Chapter ${chapterNumber}`;
  }
}
