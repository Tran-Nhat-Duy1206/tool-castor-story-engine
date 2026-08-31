export type ShortFictionLanguage = "vi" | "en";

export interface ShortFictionReferencePromptInput {
  readonly text?: string;
}

export interface ShortFictionOutlinePromptInput {
  readonly direction: string;
  readonly chapterCount: number;
  readonly charsPerChapter: number;
  readonly reference?: ShortFictionReferencePromptInput;
}

export interface ShortFictionOutlineReviewPromptInput {
  readonly direction: string;
  readonly outline: {
    readonly rawContent: string;
  };
  readonly reference?: ShortFictionReferencePromptInput;
}

export interface ShortFictionOutlineRevisionPromptInput extends ShortFictionOutlineReviewPromptInput {
  readonly review: string;
  readonly chapterCount: number;
  readonly charsPerChapter: number;
}

export interface ShortFictionDraftPromptInput {
  readonly direction: string;
  readonly outlineMarkdown: string;
  readonly chapterCount: number;
  readonly charsPerChapter: number;
}

export interface ShortFictionDraftContinuationPromptInput extends ShortFictionDraftPromptInput {
  readonly existingDraftMarkdown: string;
  readonly missingChapters: readonly number[];
}

export interface ShortFictionDraftReviewPromptInput extends ShortFictionDraftPromptInput {
  readonly draftMarkdown: string;
}

export interface ShortFictionDraftRevisionPromptInput extends ShortFictionDraftPromptInput {
  readonly review: string;
}

export interface ShortFictionPackagePromptInput {
  readonly direction: string;
  readonly outlineMarkdown: string;
  readonly draftMarkdown: string;
  readonly draftTitle: string;
}

export function buildShortFictionOutlineSystemPrompt(language: ShortFictionLanguage = "vi"): string {
  const outputLanguage = language === "vi" ? "Vietnamese" : "English";
  return [
    "You are the managing editor for short web fiction. Your job is to turn one creative direction into a complete short-story plan.",
    `Output all plan content in ${outputLanguage}. Keep machine tags and structure unchanged.`,
    "Work only from this direction and any reference text the user supplied; never claim to have read, quoted, or inherited material that was not provided.",
    "Content comes first: the title, the opening, the pressure on the protagonist, the evidence/relationship/identity leverage, the escalation chain, the reversal chain, and the payoff landing must be strong enough to carry a single-pass full draft.",
    "Do not over-structure and do not output JSON/YAML. Write human-readable Markdown, but the chapter plan must be dense enough that a writer can draft the whole story in one pass.",
    "A short defaults to 12-18 chapters at roughly 600-800 words per chapter. The story must be complete — not the first five chapters of a novel starter kit.",
    "Return only the final story plan for the writer; do not place task restatement, analysis, or internal reasoning in the deliverable.",
  ].join("\n");
}

export function buildShortFictionOutlineUserPrompt(
  input: ShortFictionOutlinePromptInput,
  language: ShortFictionLanguage = "vi",
): string {
  const outputLanguage = language === "vi" ? "Vietnamese" : "English";
  return [
    "## Creative Direction",
    input.direction,
    "",
    "## Target Spec",
    `A complete short story of ${input.chapterCount} chapters, about ${input.charsPerChapter} words per chapter. Output in ${outputLanguage}.`,
    "",
    input.reference?.text ? "## Optional Reference Text\n" + input.reference.text.trim() + "\n" : "",
    "## Deliverable",
    `Start with one platform-ready clickable title, then the full story plan in ${outputLanguage}. The plan must make clear why the protagonist is pinned down, what payoff the reader is waiting for, how the protagonist turns the tables, how evidence/relationships/identity/rules escalate step by step, why the antagonist strikes back, and how the ending lands.`,
    "The chapter plan must spell out, chapter by chapter: the direction of the chapter title, the key on-page scene, the characters' actions, the escalation or payoff, and the reason to keep reading at the chapter break.",
    "Tags are allowed, but do not enumerate a tag table; tags serve premise selection and writing — they never replace the story.",
    "",
    "## Output Format",
    "=== SHORT_FICTION_PLAN_TITLE ===",
    "Exactly one platform-ready title on a single line",
    "=== SHORT_FICTION_PLAN ===",
    `The full story plan in Markdown (${outputLanguage}), covering: genre/audience, title direction, the opening hook, characters and relationships, the core pressure, how the protagonist wins, the escalation chain, the reversal chain, the ending payoff, and the chapter-by-chapter plan.`,
  ].filter(Boolean).join("\n");
}

export function buildShortFictionOutlineReviewSystemPrompt(language: ShortFictionLanguage = "vi"): string {
  const outputLanguage = language === "vi" ? "Vietnamese" : "English";
  return [
    "You are a short-fiction outline reviewer. You do not assign scores and you do not police plagiarism.",
    `Output all review notes in ${outputLanguage}.`,
    "Your job is to judge whether this story plan can carry a single-pass full draft: is the genre engine clear, do character motivations hold, does the pressure chain escalate, is the antagonist's counterattack believable, is the ending payoff big enough.",
    "Review like a real reader and a real editor, not a checklist machine.",
    "Output Markdown. Name the flaws that would make the finished draft fall flat, and the strengths worth keeping.",
  ].join("\n");
}

export function buildShortFictionOutlineReviewUserPrompt(
  input: ShortFictionOutlineReviewPromptInput,
  language: ShortFictionLanguage = "vi",
): string {
  const outputLanguage = language === "vi" ? "Vietnamese" : "English";
  return [
    "## Creative Direction",
    input.direction,
    "",
    input.reference?.text ? "## Optional Reference Text\n" + input.reference.text.trim() + "\n" : "",
    "## Story Plan Under Review",
    input.outline.rawContent,
    "",
    `## Review Focus (${outputLanguage})`,
    "- Is this a complete short story, rather than a partial tryout plan?",
    "- Do the title, the opening, and the first three chapters give readers a reason to click and keep reading?",
    "- Is the outline dense enough, or will the writer run out of material in the back half?",
    "- Do the key scenes contain character action, counterattack, and payoff, instead of bare result summaries?",
    "- Will readers be thrown out of the story by timeline, relationship, evidence-access, physical-state, or common-sense problems?",
  ].filter(Boolean).join("\n");
}

export function buildShortFictionOutlineRevisionFollowup(
  input: ShortFictionOutlineRevisionPromptInput,
  language: ShortFictionLanguage = "vi",
): string {
  const outputLanguage = language === "vi" ? "Vietnamese" : "English";
  return [
    `Based on the outline review above, produce the complete second version of the story plan in ${outputLanguage}.`,
    "This is round two of the same project: do not start over from scratch, and do not output a list of edits instead of the plan.",
    `Keep the structure at ${input.chapterCount} chapters of about ${input.charsPerChapter} words each.`,
    "Keep the genre engine and relationships that work; fix the flaws that would make the finished draft fall flat.",
    "",
    "## Outline Review",
    input.review.trim(),
    "",
    "## Output Format",
    "=== SHORT_FICTION_PLAN_TITLE ===",
    "Exactly one platform-ready title on a single line",
    "=== SHORT_FICTION_PLAN ===",
    `The complete second-version story plan in Markdown (${outputLanguage}).`,
  ].join("\n");
}

export function buildShortFictionWriterSystemPrompt(language: ShortFictionLanguage = "vi"): string {
  const outputLanguage = language === "vi" ? "Vietnamese" : "English";
  return [
    `You are a short-fiction BatchWriter. You write the complete short story in one API pass in ${outputLanguage}, following the story plan.`,
    `Write natural, native ${outputLanguage} prose. Vary sentence length; mix short punchy sentences with longer flowing ones, and keep the narrative voice consistent throughout.`,
    "This is not serialized-novel continuation and not chapter synopsis. Every chapter needs drama happening on the page: character action, dialogue or reaction, a shift in the situation, and a reason to keep reading at the chapter break.",
    "Keep the drama dialed up, web-fiction style: real-world pressure may be amplified as far as readers will still believe, but never so absurd that immersion breaks.",
    "The story title and chapter titles must read like platform content, not literary summaries. Keep the prose paced for mobile reading — short paragraphs, but never telegram-style fragments.",
    "The word count is a calibration, not an averaging exercise. Big scenes may run long and transitions short; a clearly short chapter usually means you wrote a synopsis and must add real scenes.",
    "Output must strictly use the specified blocks. No author notes, no word-count remarks, no review comments, no format explanations.",
  ].join("\n");
}

export function buildShortFictionWriterUserPrompt(
  input: ShortFictionDraftPromptInput,
  language: ShortFictionLanguage = "vi",
): string {
  const outputLanguage = language === "vi" ? "Vietnamese" : "English";
  return [
    "## Task",
    `Write the complete ${input.chapterCount}-chapter story in one pass in ${outputLanguage}, about ${input.charsPerChapter} words per chapter.`,
    "Read the full story plan before writing. The prose must carry the plan's pressure chain, evidence chain, reversal chain, and emotional payoff — do not swerve into a different story midway.",
    "",
    buildShortFictionCraftPrompt(language),
    "",
    "## Creative Direction",
    input.direction,
    "",
    "## Story Plan",
    input.outlineMarkdown,
    "",
    "## Output Format",
    "=== SHORT_FICTION_TITLE ===",
    "The story title — plain text, platform-ready, nothing else",
    "=== SHORT_FICTION_OPENING_HOOK ===",
    "An optional pre-story hook of about 130 words; if no standalone teaser is needed, still write the small first-screen scene that opens chapter 1",
    ...Array.from({ length: input.chapterCount }, (_, index) => {
      const chapter = index + 1;
      return [
        `=== CHAPTER ${chapter} TITLE ===`,
        "Chapter title — plain text only, no #, no \"Chapter N\" prefix",
        `=== CHAPTER ${chapter} CONTENT ===`,
        `Chapter ${chapter} prose — full scenes, no synopsis, no author notes`,
      ].join("\n");
    }),
  ].join("\n");
}

export function buildShortFictionDraftContinuationUserPrompt(
  input: ShortFictionDraftContinuationPromptInput,
  language: ShortFictionLanguage = "vi",
): string {
  const missing = input.missingChapters.join(", ");
  const outputLanguage = language === "vi" ? "Vietnamese" : "English";
  return [
    "## Task",
    `The previous draft was truncated or skipped chapters. Write ONLY the missing chapters: ${missing} in ${outputLanguage}.`,
    `Stay calibrated to the complete ${input.chapterCount}-chapter short at about ${input.charsPerChapter} words per chapter.`,
    "Do not rewrite finished chapters, do not write summary notes, do not apologize, do not output review comments.",
    "",
    buildShortFictionCraftPrompt(language),
    "",
    "## Creative Direction",
    input.direction,
    "",
    "## Story Plan",
    input.outlineMarkdown,
    "",
    "## Existing Draft (for continuity only — do not rewrite)",
    input.existingDraftMarkdown,
    "",
    "## Output Format",
    ...input.missingChapters.map((chapter) => [
      `=== CHAPTER ${chapter} TITLE ===`,
      "Chapter title — plain text only, no #, no \"Chapter N\" prefix",
      `=== CHAPTER ${chapter} CONTENT ===`,
      `Chapter ${chapter} prose — full scenes, no synopsis, no author notes`,
    ].join("\n")),
  ].join("\n");
}

export function buildShortFictionDraftReviewSystemPrompt(language: ShortFictionLanguage = "vi"): string {
  const outputLanguage = language === "vi" ? "Vietnamese" : "English";
  return [
    `You are a short-fiction draft reviewer. Output all review notes in ${outputLanguage}.`,
    "You judge only whether the content can sell, reads smoothly, and keeps pulling the reader forward; do not turn the review into deterministic scoring.",
    "Focus on: the title, chapter titles, the opening, character motivation, the timeline, relationships, evidence and access, escalating pressure, the antagonist's counterattack, whether the back half sags, and whether the ending payoff lands.",
    "Output Markdown. Separate the problems that would visibly stop readers from reading on from the small blemishes that are acceptable.",
  ].join("\n");
}

export function buildShortFictionDraftReviewUserPrompt(
  input: ShortFictionDraftReviewPromptInput,
  language: ShortFictionLanguage = "vi",
): string {
  const outputLanguage = language === "vi" ? "Vietnamese" : "English";
  return [
    "## Creative Direction",
    input.direction,
    "",
    "## Original Story Plan",
    input.outlineMarkdown,
    "",
    "## Draft Under Review",
    input.draftMarkdown,
    "",
    `## Review Instructions (${outputLanguage})`,
    "Talk like a person: where does this story pull, where does it break immersion, where does it read like a synopsis, where does the back half sag, which title or chapter titles would nobody tap?",
    "Never condemn a chapter just for running slightly short or long; judge first whether the content is complete, dramatic, and paying off.",
  ].join("\n");
}

export function buildShortFictionDraftRevisionFollowup(
  input: ShortFictionDraftRevisionPromptInput,
  language: ShortFictionLanguage = "vi",
): string {
  const outputLanguage = language === "vi" ? "Vietnamese" : "English";
  return [
    `Based on the review notes, write the complete second-version draft in ${outputLanguage}.`,
    "This is round two of the same story: keep what worked in the last version, fix what breaks immersion or kills the desire to keep reading.",
    "Do not output a list of suggested edits, and do not patch just a few chapters — output the complete draft.",
    "",
    "## Review Notes",
    input.review.trim(),
    "",
    `## Round-Two Priorities (${outputLanguage})`,
    "- Fix the immersion-breaking problems: timeline, logic, relationships, evidence access, physical state.",
    "- Add real scenes to the back half; never close on result summaries.",
    "- Keep the title, opening, chapter titles, and main title consistent with the prose, though the title may be re-sharpened from the final draft for platform click appeal.",
    "- Word count is calibration only: pad short chapters with real scenes; trim long ones by cutting explanation and repeated reactions.",
    "",
    "## Output Format",
    "=== SHORT_FICTION_TITLE ===",
    "The story title — plain text, platform-ready, nothing else",
    "=== SHORT_FICTION_OPENING_HOOK ===",
    "An optional pre-story hook of about 130 words; if no standalone teaser is needed, still write the small first-screen scene that opens chapter 1",
    ...Array.from({ length: input.chapterCount }, (_, index) => {
      const chapter = index + 1;
      return [
        `=== CHAPTER ${chapter} TITLE ===`,
        "Chapter title — plain text only, no #, no \"Chapter N\" prefix",
        `=== CHAPTER ${chapter} CONTENT ===`,
        `Chapter ${chapter} prose — full scenes, no synopsis, no author notes`,
      ].join("\n");
    }),
  ].join("\n");
}

export function buildShortFictionPackageSystemPrompt(language: ShortFictionLanguage = "vi"): string {
  const outputLanguage = language === "vi" ? "Vietnamese" : "English";
  return [
    `You are a short-fiction packaging editor. From the final draft you produce the synopsis, the selling points, and the cover-image prompt in ${outputLanguage}.`,
    "Never invent a main title different from the draft's. All packaging must revolve around the draft's actual title and plot.",
    "Think of the cover prompt as a mobile portrait book cover: 3:4 vertical, a large title zone, strong character emotion, one or two instantly recognizable props, high-contrast colors — not a movie poster.",
  ].join("\n");
}

export function buildShortFictionPackageUserPrompt(
  input: ShortFictionPackagePromptInput,
  language: ShortFictionLanguage = "vi",
): string {
  const outputLanguage = language === "vi" ? "Vietnamese" : "English";
  return [
    "## Creative Direction",
    input.direction,
    "",
    "## Story Plan",
    input.outlineMarkdown.trim(),
    "",
    "## Final Draft",
    input.draftMarkdown.trim(),
    "",
    "## Output Format",
    "=== SHORT_FICTION_PACKAGE_TITLE ===",
    input.draftTitle,
    "=== SHORT_FICTION_INTRO ===",
    `A platform synopsis (${outputLanguage}) of about 80-150 words that grabs the conflict, the pressure, and the payoff — never a spoiler-filled play-by-play.`,
    "=== SHORT_FICTION_SELLING_POINTS ===",
    "- 3 to 6 selling points, one per line",
    "=== SHORT_FICTION_COVER_PROMPT ===",
    "An English cover-generation prompt: 3:4 portrait, main title zone, character emotion, props, color palette, typography style, and what to avoid.",
  ].join("\n");
}

function buildShortFictionCraftPrompt(language: ShortFictionLanguage = "vi"): string {
  const outputLanguage = language === "vi" ? "Vietnamese" : "English";
  return [
    `## Craft Reminders (${outputLanguage})`,
    "- Salt dissolves in the soup: values and ambition show through action, never through slogans.",
    "- Show, don't tell: let behavior, evidence, concrete detail, and staging make the reader feel a character's state.",
    "- Simile restraint: do not lean on similes as default rhetoric — at most one simile per scene; prefer a precise verb and a concrete action over a figure of speech.",
    "- Anti-AI wording: avoid AI-tell filler words and cliché transitions; keep analytical report language out of the prose.",
    "- No padding: every scene must advance conflict, causality, emotion, evidence, pressure, payoff, or a relationship.",
    "- The climax is a scene, not a recap: eruptions of conflict, reversals, life-or-death beats, and reveals must play out beat by beat on the page (action, dialogue, the five senses).",
    "- Payoffs need setup: every reversal, comeuppance, reconciliation, revenge, or identity reveal must ride a chain of evidence and causality.",
    "- Side characters need motives: even the oppressor acts from interest, misjudgment, or fear — never a brainless plot device.",
    "- Everyday detail must become bait: each detail carries evidence, emotion, characterization, or a later reversal.",
    "- Mobile-first: short paragraphs, dense information, no vague lyricism or decorative filler.",
  ].join("\n");
}
