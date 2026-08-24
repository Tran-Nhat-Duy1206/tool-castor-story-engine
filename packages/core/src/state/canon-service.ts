import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ChapterSummariesStateSchema,
  CurrentStateStateSchema,
  HooksStateSchema,
  StateManifestSchema,
} from "../models/runtime-state.js";
import { validateRuntimeState } from "./state-validator.js";
import type {
  ChapterSummariesState,
  CurrentStateState,
  HooksState,
  StateManifest,
} from "../models/runtime-state.js";

/**
 * Read-only Core boundary over the canonical structured runtime state
 * (`story/state/*.json`).
 *
 * This is the ONLY sanctioned entry point for non-pipeline consumers (Studio
 * server, tooling) that need to inspect canonical story state. It adds no
 * storage of its own: `story/state/*.json` remains the single Canon store,
 * and markdown projections stay derived views.
 *
 * PURITY CONTRACT — this module performs ZERO filesystem writes:
 * - no bootstrap from markdown projections
 * - no repair / regeneration / re-serialization of state files
 * - no mkdir, no file creation
 * A healthy canonical book is only ever opened for reading. Markdown
 * projections are NEVER used as fallback canon here; missing or invalid
 * structured state raises {@link CanonUnavailableError} instead. (The
 * pipeline's `loadRuntimeStateSnapshot` keeps its own bootstrap behavior;
 * this boundary deliberately does not share it.)
 */

export interface StoryCanonView {
  readonly manifest: StateManifest;
  readonly currentState: CurrentStateState;
  readonly hooks: HooksState;
  readonly chapterSummaries: ChapterSummariesState;
}

export const CANON_SECTIONS = ["manifest", "current_state", "hooks", "chapter_summaries"] as const;

export type CanonSection = (typeof CANON_SECTIONS)[number];

export function isCanonSection(value: string | undefined): value is CanonSection {
  return typeof value === "string" && (CANON_SECTIONS as ReadonlyArray<string>).includes(value);
}

export type CanonSectionValue =
  | StateManifest
  | CurrentStateState
  | HooksState
  | ChapterSummariesState;

export function readCanonSection(view: StoryCanonView, section: CanonSection): CanonSectionValue {
  switch (section) {
    case "manifest":
      return view.manifest;
    case "current_state":
      return view.currentState;
    case "hooks":
      return view.hooks;
    case "chapter_summaries":
      return view.chapterSummaries;
    default:
      throw new Error(`Unknown canon section: ${String(section)}`);
  }
}

/** One concrete reason why canonical structured state could not be read. */
export interface CanonIssue {
  /** Relative scope only: a bare state filename or a validator path. Never an absolute path. */
  readonly scope: string;
  readonly code:
    | "missing_canon_file"
    | "unreadable_canon_json"
    | "invalid_canon_schema"
    | "cross_file_invalid";
  readonly message: string;
}

/** Raised when a book exists but its canonical structured state cannot be safely read. */
export class CanonUnavailableError extends Error {
  readonly code = "canon_unavailable" as const;
  readonly issues: ReadonlyArray<CanonIssue>;

  constructor(issues: ReadonlyArray<CanonIssue>) {
    super(`Canonical structured state is unavailable: ${issues.map((issue) => issue.message).join("; ")}`);
    this.name = "CanonUnavailableError";
    this.issues = issues;
  }
}

const CANON_STATE_SCHEMAS = {
  "manifest.json": StateManifestSchema,
  "current_state.json": CurrentStateStateSchema,
  "hooks.json": HooksStateSchema,
  "chapter_summaries.json": ChapterSummariesStateSchema,
} as const;

async function readCanonFile(
  stateDir: string,
  fileName: keyof typeof CANON_STATE_SCHEMAS,
): Promise<{ value: unknown } | { issue: CanonIssue }> {
  let raw: string;
  try {
    raw = await readFile(join(stateDir, fileName), "utf-8");
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    return {
      issue: {
        scope: fileName,
        code: missing ? "missing_canon_file" : "unreadable_canon_json",
        // Fixed copy only — raw IO error strings embed absolute paths.
        message: missing
          ? `${fileName}: canonical state file not found`
          : `${fileName}: canonical state file could not be read`,
      },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      issue: {
        scope: fileName,
        code: "unreadable_canon_json",
        message: `${fileName}: content is not valid JSON`,
      },
    };
  }

  const result = CANON_STATE_SCHEMAS[fileName].safeParse(parsed);
  if (!result.success) {
    return {
      issue: {
        scope: fileName,
        code: "invalid_canon_schema",
        message: `${fileName}: ${result.error.issues
          .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
          .join("; ")}`,
      },
    };
  }
  return { value: result.data };
}

/**
 * Load and validate the full canonical view for a book directory.
 *
 * PURE READ: reads exactly the four fixed canonical state files, parses them
 * against the runtime-state schemas and applies the existing cross-file
 * validator. Any problem throws {@link CanonUnavailableError} with
 * machine-readable issues (`code: "canon_unavailable"`); nothing is written,
 * created or repaired, and markdown projections are never consulted.
 */
export async function readStoryCanon(bookDir: string): Promise<StoryCanonView> {
  const stateDir = join(bookDir, "story", "state");

  const entries = await Promise.all(
    (Object.keys(CANON_STATE_SCHEMAS) as Array<keyof typeof CANON_STATE_SCHEMAS>).map(
      async (fileName) => ({ fileName, outcome: await readCanonFile(stateDir, fileName) }),
    ),
  );

  const issues: CanonIssue[] = [];
  const values = new Map<keyof typeof CANON_STATE_SCHEMAS, unknown>();
  for (const { fileName, outcome } of entries) {
    if ("issue" in outcome) {
      issues.push(outcome.issue);
    } else {
      values.set(fileName, outcome.value);
    }
  }

  if (issues.length === 0) {
    const snapshot = {
      manifest: values.get("manifest.json") as StateManifest,
      currentState: values.get("current_state.json") as CurrentStateState,
      hooks: values.get("hooks.json") as HooksState,
      chapterSummaries: values.get("chapter_summaries.json") as ChapterSummariesState,
    };
    for (const problem of validateRuntimeState(snapshot)) {
      issues.push({
        scope: problem.path || "(cross-file)",
        code: "cross_file_invalid",
        message: `${problem.code}: ${problem.message}`,
      });
    }
  }

  if (issues.length > 0) {
    throw new CanonUnavailableError(issues);
  }

  return {
    manifest: values.get("manifest.json") as StateManifest,
    currentState: values.get("current_state.json") as CurrentStateState,
    hooks: values.get("hooks.json") as HooksState,
    chapterSummaries: values.get("chapter_summaries.json") as ChapterSummariesState,
  };
}
