import { BaseAgent } from "./base.js";
import type { GenreProfile } from "../models/genre-profile.js";
import type { BookRules } from "../models/book-rules.js";
import type { LengthSpec } from "../models/length-governance.js";
import type { AuditIssue } from "./continuity.js";
import type { ChapterIntent, ChapterMemo, ContextPackage, RuleStack } from "../models/input-governance.js";
import { readGenreProfile, readBookLanguage, readBookRules } from "./rules-reader.js";
import { countChapterLength } from "../utils/length-metrics.js";
import { buildGovernedMemoryEvidenceBlocks } from "../utils/governed-context.js";
import { filterSummaries } from "../utils/context-filter.js";
import {
  buildGovernedCharacterMatrixWorkingSet,
  buildGovernedHookWorkingSet,
} from "../utils/governed-working-set.js";
import { applySpotFixPatches, parseSpotFixPatches } from "../utils/spot-fix-patches.js";
import {
  buildNarrativeIntentBrief,
  renderMemoAsNarrativeBlock,
  renderNarrativeSelectedContext,
  sanitizeNarrativeEvidenceBlock,
} from "../utils/narrative-control.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  readStoryFrame,
  readVolumeMap,
  readCharacterContext,
  readCurrentStateWithFallback,
} from "../utils/outline-paths.js";

export type ReviseMode = "auto" | "polish" | "rewrite" | "rework" | "anti-detect" | "spot-fix";

export const DEFAULT_REVISE_MODE: ReviseMode = "auto";

export interface ReviseOutput {
  readonly revisedContent: string;
  readonly wordCount: number;
  readonly fixedIssues: ReadonlyArray<string>;
  readonly tokenUsage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
}

type AutoOutputMode = "patch-only" | "rewrite-only" | "allow-full";

function buildTieredIssueList(issues: ReadonlyArray<AuditIssue>): string {
  const critical: string[] = [];
  const high: string[] = [];
  const medium: string[] = [];

  for (const issue of issues) {
    const line = `- ${issue.category}: ${issue.description}`;
    if (issue.severity === "critical") {
      critical.push(line);
    } else if (issue.severity === "warning") {
      high.push(line);
    } else {
      medium.push(line);
    }
  }

  const parts: string[] = [];
  if (critical.length > 0) {
    parts.push(`## Critical — Must Fix\n${critical.join("\n")}`);
  }
  if (high.length > 0) {
    parts.push(`## High — Should Improve\n${high.join("\n")}`);
  }
  if (medium.length > 0) {
    parts.push(`## Medium — Reference\n${medium.join("\n")}`);
  }

  return parts.join("\n\n");
}

const MODE_DESCRIPTIONS: Record<ReviseMode, string> = {
  auto: "", // auto mode uses buildAutoSystemPrompt instead
  polish: "Polish: change only expression, rhythm, and paragraph breathing; do not change facts or plot outcomes. Do not add or remove paragraphs, rename people, places, or items, add plot events or dialogue, or change causality. Only replace wording, adjust sentence order, and refine punctuation rhythm.",
  rewrite: "Rewrite: you may reorganize problematic passages and adjust imagery or narrative force, but preserve most original sentences and paragraphs whenever possible. Unless the problem spans the whole chapter, do not rewrite the entire chapter; revise only the problematic passage and its immediate context while preserving core facts and character motivations.",
  rework: "Rework: you may restructure scene progression and conflict organization, but do not change the core setting or the outcomes of major events.",
  "anti-detect": `Anti-detection rewrite: reduce detectable AI-generation patterns without changing the plot.

Techniques:
1. Break sentence-pattern regularity: alternate short and long sentences unpredictably.
2. Prefer natural colloquial phrasing over generic formal transitions.
3. Remove repetitive aspect particles, auxiliaries, and mechanical verb chains where the output language permits.
4. Reduce formulaic transition words; use character thought or direct action to shift beats.
5. Externalize emotion through concrete action instead of naming the emotion.
6. Remove narrator conclusions; let actions carry the implication.
7. Make group reactions specific and individualized instead of saying everyone reacted identically.
8. Vary paragraph length, from one-line beats to longer passages.
9. Replace generic AI-tell words and stock comparisons with concrete sensory detail.`,
  "spot-fix": "Spot fix: modify only the specific sentences or paragraphs identified by the review notes. Preserve all other content exactly. Limit changes to the problematic sentence and at most one sentence before and after it. Do not alter unrelated passages.",
};

export class ReviserAgent extends BaseAgent {
  get name(): string {
    return "reviser";
  }

  async reviseChapter(
    bookDir: string,
    chapterContent: string,
    chapterNumber: number,
    issues: ReadonlyArray<AuditIssue>,
    mode: ReviseMode = DEFAULT_REVISE_MODE,
    genre?: string,
    options?: {
      chapterIntent?: string;
      chapterMemo?: ChapterMemo;
      chapterIntentData?: ChapterIntent;
      contextPackage?: ContextPackage;
      ruleStack?: RuleStack;
      lengthSpec?: LengthSpec;
      baselineChapter?: number;
    },
  ): Promise<ReviseOutput> {
    const baselineStoryDir = options?.baselineChapter === undefined
      ? join(bookDir, "story")
      : join(bookDir, "story", "snapshots", String(options.baselineChapter));
    const [currentState, ledger, hooks, styleGuideRaw, volumeOutline, storyBible, characterMatrix, chapterSummaries, parentCanon, fanficCanon] = await Promise.all([
      options?.baselineChapter === undefined
        ? readCurrentStateWithFallback(bookDir, "()")
        : this.readFileSafe(join(baselineStoryDir, "current_state.md")),
      this.readFileSafe(join(baselineStoryDir, "particle_ledger.md")),
      this.readFileSafe(join(baselineStoryDir, "pending_hooks.md")),
      this.readFileSafe(join(bookDir, "story/style_guide.md")),
      readVolumeMap(bookDir, "()"),
      readStoryFrame(bookDir, "()"),
      options?.baselineChapter === undefined
        ? readCharacterContext(bookDir, "()")
        : this.readSnapshotCharacterContext(bookDir, baselineStoryDir),
      this.readFileSafe(join(baselineStoryDir, "chapter_summaries.md")),
      this.readFileSafe(join(bookDir, "story/parent_canon.md")),
      this.readFileSafe(join(bookDir, "story/fanfic_canon.md")),
    ]);

    // Load genre profile and book rules
    const genreId = genre ?? "other";
    const [{ profile: gp }, bookLanguage] = await Promise.all([
      readGenreProfile(this.ctx.projectRoot, genreId),
      readBookLanguage(bookDir),
    ]);
    const parsedRules = await readBookRules(bookDir);
    const bookRules = parsedRules?.rules ?? null;

    // Fallback: use book_rules body when style_guide.md doesn't exist.
    // Phase 5 hotfix 2: parsedRules.body is only populated for legacy
    // book_rules.md sources — story_frame.md frontmatter yields an empty
    // body, and an empty string is NOT a usable style guide. Treat
    // missing/empty body as "no fallback available".
    const legacyRulesBody = parsedRules?.body?.trim();
    const styleGuide = styleGuideRaw !== "()"
      ? styleGuideRaw
      : (legacyRulesBody || "(no style guide)");

    const isEnglish = (bookLanguage ?? gp.language) === "en";
    const resolvedLanguage = isEnglish ? "en" : "vi";

    const issueList = mode === "auto"
      ? buildTieredIssueList(issues)
      : issues
          .map((i) => `- [${i.severity}] ${i.category}: ${i.description}\n  Suggestion: ${i.suggestion}`)
          .join("\n");

    const numericalRule = gp.numericalSystem
      ? "\n3. Numerical errors must be fixed precisely — cross-check before and after"
      : "";
    const protagonistBlock = bookRules?.protagonist
      ? `\n\nProtagonist lock: ${bookRules.protagonist.name} — ${bookRules.protagonist.personalityLock.join(", ")}. Revisions must not violate the protagonist profile.`
      : "";
    // Length guardrail only used by legacy modes (manual CLI revise).
    // Auto mode delegates length to normalize, not reviser.
    const lengthGuardrail = mode !== "auto" && options?.lengthSpec
      ? "\n8. Keep the chapter word count within the target range; allow only minor deviation when fixing critical issues truly requires it"
      : "";
    const langPrefix = isEnglish
      ? "Output in English. This applies to FIXED_ISSUES, PATCHES, and REVISED_CONTENT.\n\n"
      : "Output in Vietnamese. This applies to FIXED_ISSUES, PATCHES, and REVISED_CONTENT.\n\n";
    const governedMode = Boolean(options?.chapterIntent && options?.contextPackage && options?.ruleStack);
    const hooksWorkingSet = governedMode && options?.contextPackage
      ? buildGovernedHookWorkingSet({
          hooksMarkdown: hooks,
          contextPackage: options.contextPackage,
          chapterNumber,
          language: resolvedLanguage,
        })
      : hooks;
    const chapterSummariesWorkingSet = governedMode
      ? filterSummaries(chapterSummaries, chapterNumber)
      : chapterSummaries;
    const characterMatrixWorkingSet = governedMode
      ? buildGovernedCharacterMatrixWorkingSet({
          matrixMarkdown: characterMatrix,
          chapterIntent: options?.chapterIntent ?? volumeOutline,
          contextPackage: options!.contextPackage!,
          protagonistName: bookRules?.protagonist?.name,
        })
      : characterMatrix;

    const autoOutputMode = mode === "auto" ? resolveAutoOutputMode(issues) : "allow-full";
    const systemPromptBase = mode === "auto"
      ? this.buildAutoSystemPrompt({ langPrefix, gp, protagonistBlock, numericalRule, lengthGuardrail, resolvedLanguage, lengthSpec: options?.lengthSpec, autoOutputMode })
      : this.buildLegacySystemPrompt({ langPrefix, gp, protagonistBlock, numericalRule, lengthGuardrail, mode, resolvedLanguage });
    const systemPrompt = await this.withPromptPackGuidance(systemPromptBase, "longform.reviser");

    const ledgerBlock = gp.numericalSystem
      ? `\n## Resource Ledger\n${ledger}`
      : "";
    const governedMemoryBlocks = options?.contextPackage
      ? buildGovernedMemoryEvidenceBlocks(options.contextPackage, resolvedLanguage)
      : undefined;
    const hookDebtBlock = governedMemoryBlocks?.hookDebtBlock ?? "";
    const hooksBlock = governedMemoryBlocks?.hooksBlock
      ?? `\n## Pending Hooks\n${hooksWorkingSet}\n`;
    const outlineBlock = volumeOutline !== "()"
      ? `\n## Volume Outline\n${volumeOutline}\n`
      : "";
    const bibleBlock = !governedMode && storyBible !== "()"
      ? `\n## World-Building Reference\n${storyBible}\n`
      : "";
    const matrixBlock = characterMatrixWorkingSet !== "()"
      ? `\n## Character Interaction Matrix\n${characterMatrixWorkingSet}\n`
      : "";
    const summariesBlock = governedMemoryBlocks?.summariesBlock
      ?? (chapterSummariesWorkingSet !== "()"
        ? `\n## Chapter Summaries\n${chapterSummariesWorkingSet}\n`
        : "");
    const volumeSummariesBlock = governedMemoryBlocks?.volumeSummariesBlock ?? "";

    const hasParentCanon = parentCanon !== "()";
    const hasFanficCanon = fanficCanon !== "()";

    const canonBlock = hasParentCanon
      ? `\n## Parent Canon Reference (Revision Only)\nThis book is a side story. Follow canon constraints during revision and do not change canon facts.\n${parentCanon}\n`
      : "";

    const fanficCanonBlock = hasFanficCanon
      ? `\n## Fanfiction Canon Reference (Revision Only)\nThis is fanfiction. Follow the canon character profiles and world rules, do not violate canon facts, and preserve each character's original speech habits.\n${fanficCanon}\n`
      : "";
    const reducedControlBlock = options?.contextPackage && options.ruleStack
      ? this.buildReducedControlBlock(options.chapterMemo, options.chapterIntentData, options.chapterIntent, options.contextPackage, options.ruleStack, resolvedLanguage)
      : "";
    // Length guardrail only in legacy modes — auto mode delegates length to normalize.
    const lengthGuidanceBlock = mode !== "auto" && options?.lengthSpec
      ? `\n## Length Guardrail\nTarget length: ${options.lengthSpec.target}\nAllowed range: ${options.lengthSpec.softMin}-${options.lengthSpec.softMax}\nHard range: ${options.lengthSpec.hardMin}-${options.lengthSpec.hardMax}\nIf the revision exceeds the allowed range, first compress redundant explanation, repeated actions, and low-information sentences. Do not add subplots or remove core facts.\n`
      : "";
    const styleGuideBlock = reducedControlBlock.length === 0
      ? `\n## Style Guide\n${styleGuide}`
      : "";

    const userPrompt = `Revise Chapter ${chapterNumber}.

## Review Issues
${issueList}

## Current State
${currentState}
${ledgerBlock}
${sanitizeNarrativeEvidenceBlock(hookDebtBlock, resolvedLanguage) ?? ""}${sanitizeNarrativeEvidenceBlock(hooksBlock, resolvedLanguage) ?? ""}${sanitizeNarrativeEvidenceBlock(volumeSummariesBlock, resolvedLanguage) ?? ""}${reducedControlBlock || outlineBlock}${bibleBlock}${matrixBlock}${sanitizeNarrativeEvidenceBlock(summariesBlock, resolvedLanguage) ?? ""}${canonBlock}${fanficCanonBlock}${styleGuideBlock}${lengthGuidanceBlock}

## Chapter to Revise
${chapterContent}`;

    const response = await this.chat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.3 },
    );

    const output = this.parseOutput(
      response.content,
      mode,
      chapterContent,
      autoOutputMode,
    );
    const wordCount = options?.lengthSpec
      ? countChapterLength(output.revisedContent, options.lengthSpec.countingMode)
      : output.wordCount;
    return { ...output, wordCount, tokenUsage: response.usage };
  }

  private parseOutput(
    content: string,
    mode: ReviseMode,
    originalChapter: string,
    autoOutputMode: AutoOutputMode = "allow-full",
  ): ReviseOutput {
    const extract = (tag: string): string => {
      const regex = new RegExp(
        `=== ${tag} ===\\s*([\\s\\S]*?)(?==== [A-Z_]+ ===|$)`,
      );
      const match = content.match(regex);
      return match?.[1]?.trim() ?? "";
    };

    const fixedRaw = extract("FIXED_ISSUES");
    const fixedIssues = fixedRaw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const makeResult = (revisedContent: string, applied: boolean): ReviseOutput => ({
      revisedContent,
      wordCount: revisedContent.length,
      fixedIssues: applied ? fixedIssues : [],
    });

    // Auto mode obeys the auditor's structured repair scope. It never infers
    // semantic intent from issue prose.
    if (mode === "auto") {
      if (autoOutputMode === "patch-only") {
        const patchesRaw = extract("PATCHES");
        if (patchesRaw) {
          const patches = parseSpotFixPatches(patchesRaw);
          if (patches.length > 0) {
            const patchResult = applySpotFixPatches(originalChapter, patches);
            if (patchResult.applied && patchResult.appliedPatchCount / patches.length >= 0.5) {
              return makeResult(patchResult.revisedContent, true);
            }
          }
        }
        return makeResult(originalChapter, false);
      }

      if (autoOutputMode === "rewrite-only") {
        const revisedContent = extract("REVISED_CONTENT");
        if (revisedContent) {
          return makeResult(revisedContent, true);
        }
        // No rewrite produced — don't fall back to patches; structural issues
        // cannot be safely patched. Return original unchanged.
        return makeResult(originalChapter, false);
      }

      const revisedContent = extract("REVISED_CONTENT");
      if (revisedContent) {
        return makeResult(revisedContent, true);
      }
      const patchesRaw = extract("PATCHES");
      if (patchesRaw) {
        const patches = parseSpotFixPatches(patchesRaw);
        if (patches.length > 0) {
          const patchResult = applySpotFixPatches(originalChapter, patches);
          if (patchResult.applied && patchResult.appliedPatchCount / patches.length >= 0.5) {
            return makeResult(patchResult.revisedContent, true);
          }
        }
      }
      // Both empty — no fix
      return makeResult(originalChapter, false);
    }

    // Legacy spot-fix mode: patches only
    if (mode === "spot-fix") {
      const patches = parseSpotFixPatches(extract("PATCHES"));
      const patchResult = applySpotFixPatches(originalChapter, patches);
      return makeResult(patchResult.revisedContent, patchResult.applied);
    }

    // Legacy rewrite/polish/rework/anti-detect: full content
    const revisedContent = extract("REVISED_CONTENT");
    return makeResult(revisedContent || originalChapter, revisedContent.length > 0);
  }

  private buildAutoSystemPrompt(params: {
    langPrefix: string;
    gp: GenreProfile;
    protagonistBlock: string;
    numericalRule: string;
    lengthGuardrail: string;
    resolvedLanguage: "vi" | "en";
    lengthSpec?: LengthSpec;
    autoOutputMode: AutoOutputMode;
  }): string {
    const { langPrefix, gp, protagonistBlock, numericalRule, resolvedLanguage, lengthSpec, autoOutputMode } = params;
    // lengthGuardrail intentionally not used in auto mode — length constraint is embedded in REVISED_CONTENT description
    const rewriteLengthConstraint = lengthSpec
      ? `\n  HARD CONSTRAINT: The revised chapter must stay within ${lengthSpec.softMin}-${lengthSpec.softMax} characters (target: ${lengthSpec.target}, ±25%). This is non-negotiable — do not exceed this range.`
      : "";

    const routingDirectiveEn = autoOutputMode === "rewrite-only"
      ? "\n\nROUTING: The reviewer's blocking issues are structural / semantic (character collapse, mainline drift, missing payoff, timeline break, unpaid hook, memo drift, etc.). You MUST output REVISED_CONTENT — do not emit PATCHES, they cannot fix this class of problem. If you cannot safely rewrite, say so in FIXED_ISSUES and leave REVISED_CONTENT empty."
      : autoOutputMode === "patch-only"
        ? "\n\nROUTING: The reviewer's blocking issues are local (wording, paragraph shape, fatigue word, information boundary, knowledge pollution). You MUST output PATCHES only — do not rewrite the whole chapter. If patches are not possible, leave PATCHES empty."
        : "";
    return `${langPrefix}You are a professional ${gp.name} web-fiction revision editor. Fix the chapter according to the review notes.${protagonistBlock}${routingDirectiveEn}

PATCHES and REVISED_CONTENT serve different problems — choose by problem type, not preference:

PATCHES — for local text issues (wording, dialogue, AI-tell phrases, small continuity errors).
  Each PATCH quotes the passage to change (a sentence, a paragraph, or multiple paragraphs) and provides a replacement. Untouched text stays exactly as-is.

REVISED_CONTENT — for whole-chapter issues (length compression, structural rewrite, pacing restructure, major plot realignment).
  Outputs the full revised chapter. When Critical issues include length or structural problems, you must use REVISED_CONTENT — patches cannot compress or restructure a chapter.${rewriteLengthConstraint}

If Critical issues include both local and whole-chapter problems, use REVISED_CONTENT (it addresses everything in one pass).

Revision principles:
1. Fix root causes — do not apply superficial polish${numericalRule}
2. Hook status must stay in sync with the hooks board. If hook debt briefs are provided, preserve hook payoff scenes
3. Do not alter the plot direction or core conflicts
4. Preserve the original language style, rhythm, and pacing — do not compress transitional scenes or remove breathing room
5. Emotion through action (never "he felt angry" — show it). Values through behavior, not slogans
6. Different characters speak differently. No "everyone gasped in unison"
7. Escalate: bad things stack, each worse than the last

Cycle-aware revision:
- If this chapter should be "aftermath" but is still escalating tension, rewrite the densest conflict passage into a change-showing passage — who lost what, whose attitude shifted, what the new normal is
- If this chapter should be "climax" but has no clear payoff, find the closest scene to a reward and amplify it — make the promised release exceed reader expectations
- Daily passages that don't serve the main line: rewrite as "bait" — add a detail pointing to the future, a hint, a character reaction that seeds curiosity

Output format:

=== FIXED_ISSUES ===
(List each fix on its own line; if a safe local fix is not possible, explain here)

=== PATCHES ===
(Output local patches if applicable. Omit this section entirely if using REVISED_CONTENT)
--- PATCH 1 ---
TARGET_TEXT:
(Exact quote from the original that identifies the passage to change)
REPLACEMENT_TEXT:
(Replacement text for this passage)
--- END PATCH ---

=== REVISED_CONTENT ===
(Full revised chapter content — only when PATCHES cannot solve the problem. Omit this section if using PATCHES)`;
  }

  private buildLegacySystemPrompt(params: {
    langPrefix: string;
    gp: GenreProfile;
    protagonistBlock: string;
    numericalRule: string;
    lengthGuardrail: string;
    mode: ReviseMode;
    resolvedLanguage: "vi" | "en";
  }): string {
    const { langPrefix, gp, protagonistBlock, numericalRule, lengthGuardrail, mode } = params;
    const modeDesc = MODE_DESCRIPTIONS[mode];
    const outputFormat = mode === "spot-fix"
      ? `=== FIXED_ISSUES ===
(List each fix on its own line; if a safe spot fix is impossible, explain why here)

=== PATCHES ===
--- PATCH 1 ---
TARGET_TEXT:
(An exact quote from the original that uniquely identifies the sentence or passage)
REPLACEMENT_TEXT:
(The local replacement text)
--- END PATCH ---`
      : `=== FIXED_ISSUES ===
(List each fix on its own line)

=== REVISED_CONTENT ===
(The complete revised chapter)`;

    return `${langPrefix}You are a professional ${gp.name} web-fiction revision editor. Fix the chapter according to the review notes.${protagonistBlock}

Revision mode: ${modeDesc}

Revision principles:
1. Control the scope of changes according to the selected mode.
2. Fix root causes rather than applying superficial polish.${numericalRule}
4. The chapter must obey established facts and hook constraints, but do not output or rewrite state files; the host will recalculate state from the revised chapter.
5. Do not change the plot direction or core conflicts.
6. Preserve the original language style and rhythm.
${lengthGuardrail}
${mode === "spot-fix" ? "\n9. Spot-fix mode may output only local patches, never a full-chapter rewrite; TARGET_TEXT must match the original uniquely.\n10. If extensive rewriting is required, explain that it cannot be fixed safely in spot-fix mode and leave PATCHES empty." : ""}

Output format:

${outputFormat}`;
  }

  private async readFileSafe(path: string): Promise<string> {
    try {
      return await readFile(path, "utf-8");
    } catch {
      return "()";
    }
  }

  private async readSnapshotCharacterContext(
    bookDir: string,
    snapshotStoryDir: string,
  ): Promise<string> {
    const snapshotMatrix = await this.readFileSafe(join(snapshotStoryDir, "character_matrix.md"));
    if (snapshotMatrix !== "()") return snapshotMatrix;
    return readCharacterContext(bookDir, "()");
  }

  private buildReducedControlBlock(
    memo: ChapterMemo | undefined,
    intent: ChapterIntent | undefined,
    chapterIntent: string | undefined,
    contextPackage: ContextPackage,
    ruleStack: RuleStack,
    resolvedLanguage: "vi" | "en",
  ): string {
    const selectedContext = renderNarrativeSelectedContext(contextPackage.selectedContext, resolvedLanguage)
      .replace(/^### /gm, "- ");
    const overrides = ruleStack.activeOverrides.length > 0
      ? ruleStack.activeOverrides
        .map((override) => `- ${override.from} -> ${override.to}: ${override.reason} (${override.target})`)
        .join("\n")
      : "- none";
    // Prefer memo-based narrative block; fall back to legacy intent markdown
    const narrativeBlock = memo
      ? renderMemoAsNarrativeBlock(memo, intent, resolvedLanguage)
      : chapterIntent
        ? buildNarrativeIntentBrief(chapterIntent, resolvedLanguage)
        : "(none)";

    return `\n## Chapter Control Input (Compiled by Planner/Composer)
${narrativeBlock}

### Selected Context
${selectedContext || "- none"}

### Rule Stack
- Hard guardrails: ${ruleStack.sections.hard.join(", ") || "(none)"}
- Soft constraints: ${ruleStack.sections.soft.join(", ") || "(none)"}
- Diagnostic rules: ${ruleStack.sections.diagnostic.join(", ") || "(none)"}

### Active Overrides
${overrides}\n`;
  }
}

function resolveAutoOutputMode(issues: ReadonlyArray<AuditIssue>): AutoOutputMode {
  if (issues.length === 0) {
    return "allow-full";
  }
  const scopedBlocking = issues.filter((issue) => issue.severity !== "info" && issue.repairScope);
  if (scopedBlocking.length > 0) {
    if (scopedBlocking.some((issue) => issue.repairScope === "structural")) {
      return "rewrite-only";
    }
    if (
      scopedBlocking.length === issues.filter((issue) => issue.severity !== "info").length
      && scopedBlocking.every((issue) => issue.repairScope === "local")
    ) {
      return "patch-only";
    }
  }

  const blocking = issues.filter((issue) => issue.severity !== "info");
  if (blocking.length === 0) {
    return "patch-only"; // only hints / info — at most local polish
  }
  // Unknown scope is intentionally not guessed from natural-language labels.
  // The reviser may choose the safest representation from the actual issue text.
  return "allow-full";
}
