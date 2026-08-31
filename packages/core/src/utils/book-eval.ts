import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { StateManager } from "../state/manager.js";
import { analyzeAITells } from "../agents/ai-tells.js";
import { computeAnalytics } from "./analytics.js";

export interface ChapterEval {
  readonly number: number;
  readonly title: string;
  readonly wordCount: number;
  readonly auditIssueCount: number;
  readonly aiTellCount: number;
  readonly aiTellDensity: number;
  readonly paragraphWarnings: number;
  readonly status: string;
}

export interface BookEval {
  readonly bookId: string;
  readonly totalChapters: number;
  readonly totalWords: number;
  readonly auditPassRate: number;
  readonly avgAiTellDensity: number;
  readonly avgParagraphWarnings: number;
  readonly hookResolveRate: number;
  readonly duplicateTitles: number;
  readonly qualityScore: number;
  readonly chapters: ReadonlyArray<ChapterEval>;
  readonly qualityTrend: ReadonlyArray<{ readonly chapter: number; readonly score: number }>;
}

export interface EvaluateBookQualityOptions {
  readonly state: StateManager;
  readonly bookId: string;
  readonly chapters?: string;
}

export function computeChapterEvalScore(ch: ChapterEval): number {
  let score = 100;
  score -= ch.auditIssueCount * 5;
  score -= ch.aiTellDensity * 20;
  score -= ch.paragraphWarnings * 3;
  return Math.max(0, Math.min(100, score));
}

function parseChapterRange(range?: string): { readonly start: number; readonly end: number } {
  if (!range) return { start: 1, end: Infinity };
  const parts = range.split("-");
  const start = parseInt(parts[0] ?? "", 10);
  const end = parts[1] ? parseInt(parts[1], 10) : start;
  return {
    start: Number.isFinite(start) ? start : 1,
    end: Number.isFinite(end) ? end : Infinity,
  };
}

function duplicateTitleCount(titles: ReadonlyArray<string>): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const title of titles) {
    const norm = title.trim().toLowerCase();
    if (seen.has(norm)) duplicates += 1;
    seen.add(norm);
  }
  return duplicates;
}

function computeHookResolveRate(content: string): number {
  if (!content.trim()) return 0;
  let totalHooks = 0;
  let resolvedHooks = 0;
  for (const line of content.split("\n")) {
    if (!/^\|.*\|.*\|/.test(line)) continue;
    if (line.includes("---") || /hook|/i.test(line)) continue;
    totalHooks += 1;
    if (/resolved||/i.test(line)) resolvedHooks += 1;
  }
  return totalHooks > 0 ? Math.round((resolvedHooks / totalHooks) * 100) : 0;
}

export async function evaluateBookQuality(options: EvaluateBookQualityOptions): Promise<BookEval> {
  const { state, bookId } = options;
  const index = await state.loadChapterIndex(bookId);
  const bookDir = state.bookDir(bookId);
  const chaptersDir = join(bookDir, "chapters");
  const { start, end } = parseChapterRange(options.chapters);
  const filteredIndex = index.filter((ch) => ch.number >= start && ch.number <= end);
  const chapterFiles = await readdir(chaptersDir).catch(() => [] as string[]);
  const chapterEvals: ChapterEval[] = [];

  for (const ch of filteredIndex) {
    const paddedNum = String(ch.number).padStart(4, "0");
    const file = chapterFiles.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
    const content = file ? await readFile(join(chaptersDir, file), "utf-8") : "";
    const aiTells = content ? analyzeAITells(content) : { issues: [] };
    const paragraphs = content
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0 && !p.startsWith("#"));
    const shortParas = paragraphs.filter((p) => p.length < 35);
    const paragraphWarnings = shortParas.length > paragraphs.length * 0.4 ? 1 : 0;
    const aiTellDensity = content.length > 0
      ? (aiTells.issues.length / content.length) * 1000
      : 0;

    chapterEvals.push({
      number: ch.number,
      title: ch.title,
      wordCount: ch.wordCount,
      auditIssueCount: ch.auditIssues.length,
      aiTellCount: aiTells.issues.length,
      aiTellDensity: Math.round(aiTellDensity * 100) / 100,
      paragraphWarnings,
      status: ch.status,
    });
  }

  const hooksContent = await readFile(join(bookDir, "story", "pending_hooks.md"), "utf-8").catch(() => "");
  const hookResolveRate = computeHookResolveRate(hooksContent);
  const duplicateTitles = duplicateTitleCount(index.map((ch) => ch.title));
  const analytics = computeAnalytics(bookId, index);
  const avgAiTellDensity = chapterEvals.length > 0
    ? chapterEvals.reduce((s, c) => s + c.aiTellDensity, 0) / chapterEvals.length
    : 0;
  const avgParagraphWarnings = chapterEvals.length > 0
    ? chapterEvals.reduce((s, c) => s + c.paragraphWarnings, 0) / chapterEvals.length
    : 0;
  const qualityScore = Math.round(
    analytics.auditPassRate * 0.3
    + Math.max(0, 100 - avgAiTellDensity * 30) * 0.25
    + Math.max(0, 100 - avgParagraphWarnings * 10) * 0.15
    + hookResolveRate * 0.2
    + Math.max(0, 100 - duplicateTitles * 20) * 0.1,
  );

  return {
    bookId,
    totalChapters: filteredIndex.length,
    totalWords: filteredIndex.reduce((s, c) => s + c.wordCount, 0),
    auditPassRate: analytics.auditPassRate,
    avgAiTellDensity: Math.round(avgAiTellDensity * 100) / 100,
    avgParagraphWarnings: Math.round(avgParagraphWarnings * 100) / 100,
    hookResolveRate,
    duplicateTitles,
    qualityScore,
    chapters: chapterEvals,
    qualityTrend: chapterEvals.map((ch) => ({
      chapter: ch.number,
      score: computeChapterEvalScore(ch),
    })),
  };
}
