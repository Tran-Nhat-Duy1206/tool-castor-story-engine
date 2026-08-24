import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { ChapterMetaSchema, type ChapterMeta } from "../models/chapter.js";
import { StateReviewArtifactSchema, StateReviewError } from "../models/state-review.js";
import { ACTIVE_REVIEW_RELPATH } from "./state-review-store.js";

/**
 * Task 5 — THE Core advancement gate (Phase 4).
 *
 * READ-ONLY: no chapter-index writes, no artifact/receipt mutation, no Canon
 * writes, no bootstrap/heal, no directory creation, no second lock, and no
 * Writer/pipeline involvement. Later pipeline tasks (7) consume this single
 * rule; nothing here generates anything.
 *
 * Frozen semantics:
 *   A. nextChapter > 1 ⇒ the chapter-index entry for nextChapter-1 must have
 *      status "approved" (the repository's READY state). Anything else blocks.
 *   B. active/stale anchor-bearing artifacts BLOCK iff
 *      effectiveChapter <= nextChapter (historical-correction rule).
 *   C. rebuild_required/rebuild_failed shells BLOCK iff
 *      sourceChapter < nextChapter (source-based; the historical bypass was
 *      explicitly rejected during plan hardening).
 *   D. Resolved receipt history NEVER blocks — discovery reads only top-level
 *      story/runtime entries matching chapter-NNNN.state-review.json, so the
 *      receipts subtree can never match.
 *   E. A matched pending artifact that fails JSON/schema validation FAILS
 *      CLOSED with a typed error naming the file — corruption is never
 *      skipped, never masked by an earlier blocker.
 *
 * Deterministic precedence among non-corrupt failures:
 *   1. previous-chapter readiness,
 *   2. earliest pending artifact by ascending filename chapter.
 * Corruption is evaluated DURING the scan, before any blocker is thrown, so
 * it always surfaces regardless of readiness or other blockers.
 */

const PENDING_ARTIFACT_PATTERN = /^chapter-(\d{4,})\.state-review\.json$/;

async function readChapterIndexEntry(
  bookDir: string,
  chapterNumber: number,
): Promise<{ readonly found: false } | { readonly found: true; readonly entry: ChapterMeta }> {
  let raw: string;
  try {
    raw = await readFile(join(bookDir, "chapters", "index.json"), "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { found: false };
    throw new StateReviewError(
      "state_review_invalid_change",
      `chapters/index.json could not be read (${String(error)})`,
    );
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    throw new StateReviewError(
      "state_review_invalid_change",
      `chapters/index.json is not valid JSON (${String(error)})`,
    );
  }
  if (!Array.isArray(parsedJson)) {
    throw new StateReviewError(
      "state_review_invalid_change",
      "chapters/index.json must be a JSON array of chapter records",
    );
  }
  const entries = parsedJson.map((entry) => ChapterMetaSchema.parse(entry));
  const entry = entries.find((candidate) => candidate.number === chapterNumber);
  return entry ? { found: true, entry } : { found: false };
}

/**
 * Assert the story may generate `nextChapter`.
 *
 * Resolves when advancement is allowed; throws `StateReviewError` otherwise.
 */
export async function assertCanAdvanceStory(
  bookDir: string,
  nextChapter: number,
): Promise<void> {
  if (!Number.isInteger(nextChapter) || nextChapter < 1) {
    throw new StateReviewError(
      "state_review_invalid_change",
      `assertCanAdvanceStory requires a positive integer nextChapter, received ${String(nextChapter)}`,
    );
  }

  // ---- Rules B/C/D/E FIRST: pending-artifact scan --------------------------
  // The scan runs BEFORE the readiness throw so that a CORRUPT matched
  // artifact can never be masked by an earlier non-corrupt failure: any
  // JSON/schema failure below throws immediately.
  const runtimeDir = join(bookDir, "story", "runtime");
  let fileNames: string[];
  try {
    fileNames = await readdir(runtimeDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      fileNames = [];
    } else {
      throw error;
    }
  }

  const matched = fileNames
    .map((name) => PENDING_ARTIFACT_PATTERN.exec(name))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ fileName: match[0], chapter: Number(match[1]) }))
    .sort((left, right) => left.chapter - right.chapter);

  // Canonical-path validation: a file that LOOKS like a pending artifact but
  // is not the exact name ACTIVE_REVIEW_RELPATH would produce for its parsed
  // chapter (e.g. padded beyond canonical width) must not silently masquerade
  // as governance state — fail closed, naming the offending file.
  for (const candidate of matched) {
    // ACTIVE_REVIEW_RELPATH is bookDir-relative; discovery sees bare names.
    const canonicalFileName = ACTIVE_REVIEW_RELPATH(candidate.chapter).split("/").pop()!;
    if (canonicalFileName !== candidate.fileName) {
      throw new StateReviewError(
        "state_review_invalid_change",
        `State Review artifact ${candidate.fileName} does not use the canonical `
        + `filename ${ACTIVE_REVIEW_RELPATH(candidate.chapter)} and cannot be trusted. `
        + "Rename or resolve it before generating further chapters. "
        + "Open State Review in Studio.",
      );
    }
  }

  const blockers: string[] = [];
  for (const { fileName } of matched) {
    let raw: string;
    try {
      raw = await readFile(join(runtimeDir, fileName), "utf-8");
    } catch (error) {
      throw new StateReviewError(
        "state_review_invalid_change",
        `State Review artifact ${fileName} could not be read (${String(error)})`,
      );
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch (error) {
      throw new StateReviewError(
        "state_review_invalid_change",
        `State Review artifact ${fileName} is not valid JSON and cannot be trusted. `
        + `Resolve or repair ${fileName} before generating further chapters. `
        + `(${String(error)}) Open State Review in Studio.`,
      );
    }
    const parsed = StateReviewArtifactSchema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new StateReviewError(
        "state_review_invalid_change",
        `State Review artifact ${fileName} failed schema validation and cannot be trusted. `
        + `Resolve or repair ${fileName} before generating further chapters. `
        + "Open State Review in Studio.",
      );
    }

    const artifact = parsed.data;
    if (artifact.status === "active" || artifact.status === "stale") {
      // Rule B: historical-correction temporal rule — <=, not equality.
      if (artifact.effectiveChapter <= nextChapter) {
        blockers.push(
          `State Review for chapter ${artifact.sourceChapter} is unresolved and `
          + `its proposed changes affect chapter ${artifact.effectiveChapter}, which is `
          + `not ahead of chapter ${nextChapter}. Resolve chapter ${artifact.sourceChapter}'s `
          + "State Review in Studio before generating chapter "
          + `${nextChapter}. Open State Review in Studio.`,
        );
      }
    } else {
      // Rule C: shells are source-based; no effectiveChapter anchor exists.
      if (artifact.sourceChapter < nextChapter) {
        blockers.push(
          `${artifact.status === "rebuild_required" ? "Rebuild required" : "Rebuild failed"} `
          + `state was recorded for chapter ${artifact.sourceChapter}: its State Review `
          + `is unresolved and blocks generation of chapter ${nextChapter}. `
          + "Open State Review in Studio.",
        );
      }
    }
  }

  // ---- Rule A: previous-chapter readiness (approved === READY) -------------
  if (nextChapter > 1) {
    const previous = await readChapterIndexEntry(bookDir, nextChapter - 1);
    if (!previous.found || previous.entry.status !== "approved") {
      const statusText = previous.found ? previous.entry.status : "no chapter record";
      throw new StateReviewError(
        "state_review_incomplete",
        `Chapter ${nextChapter - 1} has not completed its review gate `
        + `(status: ${statusText}). Chapter ${nextChapter} cannot be generated `
        + "until it completes State Review. Open State Review in Studio.",
      );
    }
  }

  if (blockers.length > 0) {
    // Earliest pending artifact wins; corruption above already threw.
    throw new StateReviewError("state_review_conflict", blockers[0]!);
  }
}
