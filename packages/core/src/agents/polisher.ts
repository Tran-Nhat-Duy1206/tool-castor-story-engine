import { BaseAgent } from "./base.js";
import type { ChapterMemo } from "../models/input-governance.js";

export interface PolishChapterInput {
  readonly chapterContent: string;
  readonly chapterNumber: number;
  readonly chapterMemo?: ChapterMemo;
  readonly language?: "vi" | "en";
  readonly temperature?: number;
}

export interface PolishChapterOutput {
  readonly polishedContent: string;
  readonly changed: boolean;
  readonly tokenUsage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
}

/**
 * File-layer polisher — runs AFTER the reviewer+reviser cycle accepts the
 * chapter's structure. Polisher ONLY touches prose surface: sentence craft,
 * paragraph shape, wording, punctuation, five-sense immersion, dialogue
 * naturalness. It is forbidden from changing plot, character, or mainline.
 *
 * If a structural/plot issue is found, the polisher marks it in a comment
 * line (`[polisher-note] ...`) for the next reviewer iteration and leaves
 * the prose untouched — it does NOT attempt to rewrite across that boundary.
 */
export class PolisherAgent extends BaseAgent {
  get name(): string {
    return "polisher";
  }

  async polishChapter(input: PolishChapterInput): Promise<PolishChapterOutput> {
    const language = input.language ?? "vi";
    const isEnglish = language === "en";
    const isVietnamese = language === "vi";

    const memoBlock = input.chapterMemo
      ? isEnglish || isVietnamese
        ? `\n\n## Chapter Memo (do NOT let polish drift from this goal)\nGoal: ${input.chapterMemo.goal}\n\n${input.chapterMemo.body}`
        : `\n\n## 章节备忘（润色不得偏离此目标）\ngoal：${input.chapterMemo.goal}\n\n${input.chapterMemo.body}`
      : "";

    const systemPrompt = isEnglish || isVietnamese
      ? buildEnglishSystemPrompt()
      : buildChineseSystemPrompt();

    const userPrompt = isEnglish || isVietnamese
      ? `Polish chapter ${input.chapterNumber}. Return the polished chapter in full, nothing else — no JSON, no headers, no commentary.${memoBlock}\n\n## Chapter Under Polish\n${input.chapterContent}`
      : `请润色第${input.chapterNumber}章。只返回完整的润色后正文，不要 JSON、不要标题、不要解释。${memoBlock}\n\n## 待润色章节\n${input.chapterContent}`;

    const response = await this.chat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { temperature: input.temperature ?? 0.4 },
    );

    const raw = response.content.trim();
    // Strip any leading fenced code block wrapper if the model wraps the
    // chapter body defensively.
    const stripped = stripWrappingFence(raw);
    const polishedContent = stripped.length > 0 ? stripped : input.chapterContent;
    return {
      polishedContent,
      changed: polishedContent !== input.chapterContent,
      tokenUsage: response.usage,
    };
  }
}

function stripWrappingFence(text: string): string {
  const fence = text.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```\s*$/);
  return fence?.[1]?.trim() ?? text;
}

function buildChineseSystemPrompt(): string {
  return buildEnglishSystemPrompt();
}

function buildEnglishSystemPrompt(): string {
  return `You are a professional English web-fiction prose polisher.

## Polisher Scope (hard constraints)

You touch the prose surface only — sentence craft, paragraph shape, wording, punctuation, sensory detail, dialogue naturalness. You are FORBIDDEN from adding or removing plot beats, changing character setup, or altering the mainline. If you notice plot/structure problems, append a "[polisher-note] ..." line at the very end of the chapter for the next reviewer pass — do NOT attempt to fix them in the prose.

Structure is the Reviewer's job. Do not invent beats to patch a weak chapter.

## 6 prose-level reader-pain patterns you must eliminate

- Ineffective description: long-winded environment setup or off-topic dialogue filler. Compress to a single telling stroke.
- Over-purple prose: adjective carpet-bombing, words chosen for flourish instead of emotion. Let language serve feeling, not performance.
- Weak prose: muddy meaning, unclear referents, illogical jumps, flat language. Rewrite into clear, image-carrying sentences.
- Bad formatting: walls of text, inconsistent layout, un-broken dialogue. Standardise to mobile-reader-friendly shape.
- (extension) AI-tell residue: excessive transitions, rhetorical hedges, stage-direction voiceover, analytical-report phrasing. Replace with colloquial idiom or concrete action.
- (extension) Crowd-face reactions: do not write "everyone gasped in unison" — pick one or two characters and write specific reactions.

## Prose-layer hard rules

- Paragraphs: 3-5 lines each for mobile reading; break anything over 7 lines, but do not shatter an action+reaction beat into loss of rhythm.
- Sentence variety: forbid 3+ consecutive sentences with the same structure or subject; alternate long and short.
- Verbs > adjectives: noun+verb drives the image; at most 1-2 precise adjectives per sentence.
- Five senses: at least 1-2 sensory details per scene (sight / sound / smell / touch / taste), but avoid mechanical stacking.
- Dialogue naturalness: each character has distinct voice (vocabulary, sentence length, verbal tics); dialogue must fit current identity, emotion, information scope; no "..." filler in place of real exchange.
- Externalise emotion: replace "he felt angry" with "he crushed the teacup, scalding tea running through his fingers".
- Delete narrator conclusions ("At this moment he finally understood power" — cut) and AI hedge words ("obviously", "as if", "couldn't help but").

## Output contract

Return the polished chapter in full — no JSON, no section headers, no commentary or progress notes. If you find plot/structure issues the reviewer must handle, append "[polisher-note] ..." lines at the very end, one per line. Omit the block if there are no notes.

Preserve the vast majority of sentences. Only rewrite those that truly need it — do not rewrite whole paragraphs. Total length change must stay within ±15% of the original.`;
}
