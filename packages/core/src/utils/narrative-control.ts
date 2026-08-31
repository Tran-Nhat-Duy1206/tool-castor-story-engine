import type { ChapterIntent, ChapterMemo, ContextPackage } from "../models/input-governance.js";

const HOOK_ID_PATTERN = /\bH\d+\b/gi;
const HOOK_SLUG_PATTERN = /\b[a-z]+(?:-[a-z]+){1,3}\b/g;
const CHAPTER_REF_PATTERN = /\b(?:ch(?:apter)?|chương)\s*\d+\b/giu;

const REPLACEMENTS: Readonly<Record<"vi" | "en", ReadonlyArray<readonly [RegExp, string]>>> = {
  vi: [
    [/\bcác chương trước\b/giu, "những cảnh trước đó"],
    [/\bchương này cần\b/giu, "việc trước mắt là"],
  ],
  en: [
    [/\bprevious chapters\b/gi, "earlier scenes"],
    [/\bthis chapter needs to\b/gi, "the current move is to"],
  ],
};

export function sanitizeNarrativeControlText(text: string, language: "vi" | "en" = "vi"): string {
  const thread = language === "vi" ? "tuyến này" : "this thread";
  const earlierScene = language === "vi" ? "một cảnh trước đó" : "an earlier scene";
  let result = text.replace(HOOK_ID_PATTERN, thread).replace(HOOK_SLUG_PATTERN, thread);
  result = result.replace(CHAPTER_REF_PATTERN, earlierScene);
  for (const [pattern, replacement] of REPLACEMENTS[language]) result = result.replace(pattern, replacement);
  return result;
}

export function renderMemoAsNarrativeBlock(
  memo: ChapterMemo,
  intent: ChapterIntent | undefined,
  language: "vi" | "en" = "vi",
): string {
  const sanitize = (text: string) => sanitizeNarrativeControlText(text, language);
  const sections: string[] = [`## Goal\n- ${sanitize(memo.goal)}`];
  if (intent?.arcContext) sections.push(`## Arc Context\n- ${sanitize(intent.arcContext)}`);
  if (memo.threadRefs.length > 0) {
    sections.push(`## Thread Refs\n${memo.threadRefs.map((id) => `- ${id}`).join("\n")}`);
  }
  if (memo.isGoldenOpening) {
    sections.push("## Golden Opening\n- This is a golden opening chapter; prioritize dense hooks and high-tempo pacing.");
  }
  if (memo.body.trim()) sections.push(sanitize(memo.body));
  return sections.join("\n\n");
}

export function buildNarrativeIntentBrief(
  chapterIntent: string,
  language: "vi" | "en" = "vi",
): string {
  const sections = [
    { heading: "## Goal", label: "Goal" },
    { heading: "## Outline Node", label: "Outline Node" },
    { heading: "## Must Keep", label: "Keep" },
    { heading: "## Must Avoid", label: "Avoid" },
    { heading: "## Style Emphasis", label: "Style" },
    { heading: "## Structured Directives", label: "Directives" },
  ] as const;

  return sections.map(({ heading, label }) => {
    const section = extractMarkdownSection(chapterIntent, heading);
    if (!section) return null;
    const lines = section.split("\n").map((line) => line.trim()).filter(Boolean)
      .filter((line) => !["- none", "(not found)", "- không có"].includes(line.toLocaleLowerCase(language)));
    if (lines.length === 0) return null;
    const normalized = lines
      .map((line) => line.startsWith("- ") ? line.slice(2) : line)
      .map((line) => sanitizeNarrativeControlText(line, language))
      .filter(Boolean).map((line) => `- ${line}`).join("\n");
    return `## ${label}\n${normalized}`;
  }).filter((section): section is string => Boolean(section)).join("\n\n");
}

export function renderNarrativeSelectedContext(
  entries: ReadonlyArray<ContextPackage["selectedContext"][number]>,
  language: "vi" | "en" = "vi",
): string {
  return entries.map((entry, index) => [
    `### Evidence ${index + 1}`,
    `- reason: ${sanitizeNarrativeControlText(entry.reason, language)}`,
    entry.excerpt ? `- detail: ${sanitizeNarrativeControlText(entry.excerpt, language)}` : "",
  ].filter(Boolean).join("\n")).join("\n\n");
}

export function sanitizeNarrativeEvidenceBlock(
  block: string | undefined,
  language: "vi" | "en" = "vi",
): string | undefined {
  if (!block) return undefined;
  const withoutSources = block.replace(
    /(^|\n)-\s+(?:story|runtime)\/[^:\n]+:\s*/g,
    (_match, prefix: string) => `${prefix}- evidence: `,
  );
  return sanitizeNarrativeControlText(withoutSources, language);
}

function extractMarkdownSection(content: string, heading: string): string | undefined {
  const lines = content.split("\n");
  let buffer: string[] | null = null;
  for (const line of lines) {
    if (line.trim() === heading) {
      buffer = [];
      continue;
    }
    if (buffer && line.startsWith("## ") && line.trim() !== heading) break;
    if (buffer) buffer.push(line);
  }
  const section = buffer?.join("\n").trim();
  return section || undefined;
}
