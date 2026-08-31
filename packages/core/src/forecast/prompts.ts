export type ForecastLanguage = "vi" | "en";

export interface ForecastPromptInput {
  readonly contextMarkdown: string;
  readonly divergence: string;
  readonly branchCount: number;
  readonly horizon: number;
  readonly baseChapter: number;
  readonly options?: ReadonlyArray<string>;
}

export function buildForecastSystemPrompt(_language: ForecastLanguage): string {
  return [
    "You are the narrative forecast assistant for a long-form novel.",
    "Task: starting from the canonical context and the author's divergence point, project several mutually isolated, non-canonical candidate futures for the author to compare.",
    "Rules:",
    "- Branches are mutually exclusive: each assumes a different resolution of the divergence point and must not reference or depend on sibling branches.",
    "- Branches are planning material, not prose: beats describe what happens, not scene-level detail.",
    "- Respect canon: every projection must stay consistent with established facts, character locks, and world rules; any necessary conflict must be listed under risks.",
    "- Output exactly one JSON object. No explanations, no markdown headings, no code fences.",
  ].join("\n");
}

export function buildForecastUserPrompt(input: ForecastPromptInput, _language: ForecastLanguage): string {
  const firstChapter = input.baseChapter + 1;
  const optionsBlock = input.options && input.options.length > 0
    ? [
        "## Candidate options from author",
        "",
        ...input.options.map((option, index) => `- Option ${index + 1}: ${option}`),
      ].join("\n")
    : "";

  return [
    input.contextMarkdown,
    "",
    "## Divergence point",
    "",
    input.divergence,
    ...(optionsBlock ? ["", optionsBlock] : []),
    "",
    "## Output requirements",
    "",
    `Produce exactly ${input.branchCount} candidate branches. Each branch covers roughly ${input.horizon} future chapters starting at chapter ${firstChapter}.`,
    "Return JSON with exactly this shape (field names must match):",
    forecastJsonShape(firstChapter, "en"),
  ].join("\n");
}

export function buildForecastRepairPrompt(validationError: string, _language: ForecastLanguage): string {
  return [
    `Your previous output failed validation: ${validationError}`,
    "Re-output the complete JSON object only, fixing the problem above. No explanations, no code fences.",
  ].join("\n");
}

export function forecastJsonShape(firstChapter: number, _language: ForecastLanguage): string {
  return [
    "{",
    '  "branches": [',
    "    {",
    '      "title": "short branch title",',
    '      "premise": "the assumption this branch makes about the divergence point",',
    `      "beats": [{ "chapter": integer chapter number starting at ${firstChapter}, "summary": "what happens in that chapter" }],`,
    '      "characterDecisions": [{ "character": "name", "decision": "the key decision this character makes" }],',
    '      "projectedChanges": {',
    '        "characters": ["projected character state changes"],',
    '        "relationships": ["projected relationship changes"],',
    '        "world": ["projected world/faction changes"],',
    '        "hooks": ["which hooks advance, fire, or break"]',
    "      },",
    '      "risks": [{ "kind": "continuity|causality|character", "description": "consistency risk" }],',
    '      "uncertainties": ["open uncertainties"],',
    '      "intentAlignment": { "score": integer 0-100, "rationale": "how well this matches the author intent and current focus" }',
    "    }",
    "  ]",
    "}",
  ].join("\n");
}
