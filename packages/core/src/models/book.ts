import { z } from "zod";
import { GovernanceMarkersSchema } from "../governance/contracts.js";

export const PlatformSchema = z.enum(["tomato", "feilu", "qidian", "other"]);
export type Platform = z.infer<typeof PlatformSchema>;

/**
 * Legacy compat: old books/configs may store platform as Chinese literals
 * "番茄", "起点", "飞卢", "其他"/"其它". We keep escaped \uXXXX checks so
 * existing data still normalizes correctly, but new code must not introduce
 * new literal Chinese — use canonical ids "tomato"/"qidian"/"feilu"/"other".
 *
 * Escaped forms:
 *  番茄 = \u756a\u8304
 *  起点 = \u8d77\u70b9
 *  飞卢 = \u98de\u5362
 *  其他 = \u5176\u4ed6
 *  其它 = \u5176\u5b83
 * Keeping \uXXXX here is intentional: it lets us read legacy books without
 * putting literal Han in new source. Do not add new Chinese literals.
 */
export function normalizePlatformId(platform: unknown): Platform | undefined {
  if (typeof platform !== "string") {
    return undefined;
  }

  const raw = platform.trim();
  if (!raw) {
    return undefined;
  }

  const lowered = raw.toLowerCase();
  const compact = lowered.replace(/[\s_-]+/g, "");

  if (compact === "tomato" || compact === "fanqie" || compact === "fanqienovel" || raw.includes("\u756a\u8304")) {
    return "tomato";
  }
  if (compact === "qidian" || compact === "qidianzhongwenwang" || raw.includes("\u8d77\u70b9")) {
    return "qidian";
  }
  if (compact === "feilu" || raw.includes("\u98de\u5362")) {
    return "feilu";
  }
  if (compact === "other" || compact === "others" || raw.includes("\u5176\u4ed6") || raw.includes("\u5176\u5b83")) {
    return "other";
  }

  return "other";
}

export function normalizePlatformOrOther(platform: unknown): Platform {
  return normalizePlatformId(platform) ?? "other";
}

export const GenreSchema = z.string().min(1);
export type Genre = z.infer<typeof GenreSchema>;

export const BookStatusSchema = z.enum([
  "incubating",
  "outlining",
  "active",
  "paused",
  "completed",
  "dropped",
]);
export type BookStatus = z.infer<typeof BookStatusSchema>;

export const FanficModeSchema = z.enum(["canon", "au", "ooc", "cp"]);
export type FanficMode = z.infer<typeof FanficModeSchema>;

export const BookConfigSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  platform: PlatformSchema,
  genre: GenreSchema,
  status: BookStatusSchema,
  targetChapters: z.number().int().min(1).default(200),
  chapterWordCount: z.number().int().min(1000).default(3000),
  language: z.enum(["vi", "en"]).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  parentBookId: z.string().optional(),
  fanficMode: FanficModeSchema.optional(),
  governance: GovernanceMarkersSchema.optional(),
  writing: z.object({
    reviewMode: z.enum(["auto", "manual"]).optional(),
    revisionGate: z.enum(["strict", "lenient", "always"]).optional(),
  }).optional(),
});

export type BookConfig = z.infer<typeof BookConfigSchema>;

export type ChapterReviewMode = "auto" | "manual";

/**
 * Resolve the effective chapter review mode for a book:
 * book-level `writing.reviewMode` (book.json) overrides the project-level
 * `writing.reviewMode` (castor.json); both unset falls back to "auto".
 */
export function resolveChapterReviewMode(
  book: Pick<BookConfig, "writing">,
  projectWriting?: { readonly reviewMode?: ChapterReviewMode },
): ChapterReviewMode {
  return book.writing?.reviewMode ?? projectWriting?.reviewMode ?? "auto";
}

export type RevisionGate = "strict" | "lenient" | "always";

/**
 * Resolve the effective manual-revision gate for a book:
 * book-level `writing.revisionGate` (book.json) overrides the project-level
 * `writing.revisionGate` (castor.json); both unset falls back to "strict".
 *
 * - "strict": apply only when audit counts do not worsen AND at least one of
 *   blocking/AI-tell improves (historical default behavior).
 * - "lenient": apply whenever audit counts do not worsen (no improvement required).
 * - "always": always apply manual revisions; audit counts are recorded only.
 */
export function resolveRevisionGate(
  book: Pick<BookConfig, "writing">,
  projectWriting?: { readonly revisionGate?: RevisionGate },
): RevisionGate {
  return book.writing?.revisionGate ?? projectWriting?.revisionGate ?? "strict";
}
