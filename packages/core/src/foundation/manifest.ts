import { z } from "zod";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  FoundationDependencyRefSchema,
  FoundationUnitKindSchema,
  FoundationUnitStatusSchema,
  ImportanceSchema,
  SafeGovernanceIdSchema,
} from "../governance/contracts.js";
import { computeProseRevision } from "../utils/prose-revision.js";
import { safeChildPath } from "../utils/path-safety.js";

// ===========================================================================
// Foundation V2 unit manifests with logical content locators (Task 2).
//
// Markdown remains the CREATIVE CONTENT AUTHORITY. The manifest stores only
// governance metadata: identity, locator, hash, revision, approval metadata,
// dependencies, provenance — NEVER creative prose (no shadow Story Bible).
//
// Persistence lives under story/foundation-v2/<unit-id>.gov.json, with the
// manifest path derived ONLY from a validated SafeGovernanceId.
// Task 2 is NOT an authority-switch transaction (that is Task 9): write is a
// small atomic single-file write following the state-review-store convention.
// ===========================================================================

// ---------------------------------------------------------------------------
// Book-relative content locator paths: relative, contained, non-absolute.
// ---------------------------------------------------------------------------

export const SafeRelPathSchema = z
  .string()
  .min(1, "sourceRelPath must not be empty")
  .max(512, "sourceRelPath exceeds 512 characters")
  .refine(
    (value) => !value.startsWith("/") && !value.startsWith("\\") && !/^[a-zA-Z]:/.test(value),
    "sourceRelPath must be book-relative, not absolute",
  )
  .refine(
    (value) => !/[\u0000-\u001f\u007f]/.test(value),
    "sourceRelPath must not contain control characters",
  )
  .refine(
    (value) => value.split(/[\\/]/).every((segment) => segment !== "" && segment !== "." && segment !== ".."),
    "sourceRelPath must not traverse or escape the book root",
  );
export type SafeRelPath = z.infer<typeof SafeRelPathSchema>;

// ---------------------------------------------------------------------------
// Source-key schema for legacy/source locator selectors (e.g. book_rules H2
// heading text). DIFFERENT from SafeGovernanceId: it selects EXISTING Markdown
// identities and may contain ordinary punctuation REQUIRED by real headings
// Core narrative engine processing.
// NEVER interpreted as a path — it is never passed into path.join/safeChildPath
// as a path component. The manifest unitId remains SafeGovernanceId (path-safe).
// ---------------------------------------------------------------------------

export const FoundationSourceKeySchema = z
  .string()
  .min(1, "source key must not be empty")
  .max(256, "source key exceeds 256 characters")
  .refine(
    (value) => !/[\u0000-\u001f\u007f]/.test(value),
    "source key must not contain control characters (incl. CR/LF)",
  );
export type FoundationSourceKey = z.infer<typeof FoundationSourceKeySchema>;

// ---------------------------------------------------------------------------
// Logical content locator — the approved model:
//   whole_file | section | rule | entry
// Multiple logical units may share one physical Markdown file.
// ---------------------------------------------------------------------------

export const StoryFrameSectionKeySchema = z.enum([
  "theme_tone",
  "core_conflict",
  "world_setting",
  "ending_direction",
]);
export type StoryFrameSectionKey = z.infer<typeof StoryFrameSectionKeySchema>;

export const FoundationContentLocatorSchema = z.discriminatedUnion("contentKind", [
  z.object({ contentKind: z.literal("whole_file"), sourceRelPath: SafeRelPathSchema }).strict(),
  z.object({
    contentKind: z.literal("section"),
    sourceRelPath: SafeRelPathSchema,
    sectionKey: StoryFrameSectionKeySchema,
  }).strict(),
  z.object({
    contentKind: z.literal("rule"),
    sourceRelPath: SafeRelPathSchema,
    ruleId: FoundationSourceKeySchema,   // selector for the EXISTING H2 rule heading — NOT a path component, NOT SafeGovernanceId
  }).strict(),
  z.object({
    contentKind: z.literal("entry"),
    sourceRelPath: SafeRelPathSchema,
    entryKey: SafeGovernanceIdSchema,
  }).strict(),
]);
export type FoundationContentLocator = z.infer<typeof FoundationContentLocatorSchema>;

// ---------------------------------------------------------------------------
// Unit manifest — strict (fail-closed) so unexpected prose/content fields can
// never silently become part of governance data. `status: "stale"` is the ONE
// durable staleness truth — there is NO durable `stale: boolean`.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Provenance envelope — intentionally EMPTY (reserved, zero free-form payload).
//
// Governance JSON is metadata only; creative prose must NEVER be duplicated
// into JSON. This envelope reserves the provenance slot while structurally
// forbidding ANY free-form payload today. Later Tasks may extend it ONLY with
// explicit typed technical metadata fields when a concrete requirement exists
// — they must never reintroduce Record<string, unknown|string>, arbitrary JSON
// blobs, or free-form prose fields as a governance escape hatch.
// ---------------------------------------------------------------------------

export const FoundationUnitProvenanceSchema = z.object({}).strict();
export type FoundationUnitProvenance = z.infer<typeof FoundationUnitProvenanceSchema>;

export const FoundationUnitManifestSchema = z
  .object({
    unitId: SafeGovernanceIdSchema,
    kind: FoundationUnitKindSchema,
    importance: ImportanceSchema,
    status: FoundationUnitStatusSchema,
    locator: FoundationContentLocatorSchema,
    contentHash: z.string().min(1),
    contentRevision: z.number().int().min(1),
    approvedRevision: z.number().int().min(1).optional(),
    dependencies: z.array(FoundationDependencyRefSchema).default([]),
    approvedAt: z.string().datetime().optional(),
    approvedBy: z.string().min(1).optional(),
    provenance: FoundationUnitProvenanceSchema.optional(),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    // Revision invariant (structural only): status "approved" REQUIRES the
    // explicitly approved contentRevision to equal the current contentRevision.
    if (manifest.status === "approved") {
      if (manifest.approvedRevision === undefined) {
        ctx.addIssue({ code: "custom", path: ["approvedRevision"], message: "approved units require an approvedRevision" });
      } else if (manifest.approvedRevision !== manifest.contentRevision) {
        ctx.addIssue({
          code: "custom",
          path: ["approvedRevision"],
          message: "approved units require approvedRevision === contentRevision",
        });
      }
    }
  });
export type FoundationUnitManifest = z.infer<typeof FoundationUnitManifestSchema>;

/**
 * MANIFEST-LEVEL STRUCTURAL approval predicate (Task 2 scope only).
 *
 * This is NOT the full Publish Gate: it establishes only
 * `status === "approved" AND approvedRevision === contentRevision`.
 * Task 9 later re-checks trusted Markdown hash, current Canon, dependencies,
 * external changes and Human resolutions before creating Foundation authority.
 * Later Tasks must NOT treat `isUnitApproved()` as the entire Publish Gate.
 */
export function isUnitApproved(manifest: FoundationUnitManifest): boolean {
  return manifest.status === "approved" && manifest.approvedRevision === manifest.contentRevision;
}

/**
 * PURE content-change transition expressing the structural revision invariant:
 * a governed content edit increments contentRevision and moves the unit to
 * `needs_review`, clearing prior approval metadata. Performs NO filesystem or
 * content mutation, grants NO authority, creates NO Human approval — the actual
 * Human approval workflow belongs to Task 8.
 */
export function unitContentEdited(manifest: FoundationUnitManifest): FoundationUnitManifest {
  return {
    ...manifest,
    contentRevision: manifest.contentRevision + 1,
    status: "needs_review",
    approvedRevision: undefined,
    approvedAt: undefined,
    approvedBy: undefined,
  };
}

/**
 * Content hash for a governed logical unit — reuses the existing repository
 * prose-revision primitive (computeProseRevision). Deterministic: unchanged
 * governed content ⇒ unchanged hash.
 */
export function governedContentHash(content: string): string {
  return computeProseRevision(content);
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function manifestRoot(bookDir: string): string {
  return join(bookDir, "story", "foundation-v2");
}

function manifestPathFor(bookDir: string, unitId: string): string {
  // unitId is already a validated SafeGovernanceId (schema-validated on write);
  // re-validate before deriving the path so unsafe values can never reach the
  // filesystem mapping.
  const safe = SafeGovernanceIdSchema.parse(unitId);
  return join(manifestRoot(bookDir), `${safe}.gov.json`);
}

// Atomic single-file write (tmp sibling → rename over target, Windows-safe),
// mirroring the state-review-store convention. NOT the Phase 5
// TransactionCoordinator — that belongs to Task 9; Task 2 is not an
// authority-switch transaction.
async function writeFileAtomic(target: string, content: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const tmpPath = `${target}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, content, "utf-8");
  try {
    await rename(tmpPath, target);
  } catch (error) {
    await import("node:fs/promises").then(({ rm }) => rm(tmpPath, { force: true }));
    throw error;
  }
}

/**
 * Persist one validated unit manifest. `manifest` is schema-validated first
 * (unknown kinds/statuses/fields fail closed); the manifest path is derived
 * ONLY from the validated SafeGovernanceId. Source Markdown is NEVER rewritten.
 */
export async function writeUnitManifest(bookDir: string, manifest: FoundationUnitManifest): Promise<void> {
  const validated = FoundationUnitManifestSchema.parse(manifest);
  const path = manifestPathFor(bookDir, validated.unitId);
  await writeFileAtomic(path, `${JSON.stringify(validated, null, 2)}\n`);
}

/**
 * Read every persisted unit manifest under story/foundation-v2/. Each file is
 * re-validated on read; corrupt/unknown persisted governance data FAILS
 * CLOSED (throws) — no silent arbitrary enum acceptance.
 */
export async function readUnitManifests(bookDir: string): Promise<Map<string, FoundationUnitManifest>> {
  const root = manifestRoot(bookDir);
  const entries = await readdir(root).catch(() => [] as string[]);
  const manifests = new Map<string, FoundationUnitManifest>();
  for (const entry of entries) {
    if (!entry.endsWith(".gov.json")) continue;
    const raw = await readFile(join(root, entry), "utf-8");
    const parsed = FoundationUnitManifestSchema.parse(JSON.parse(raw));
    manifests.set(parsed.unitId, parsed);
  }
  return manifests;
}

// ---------------------------------------------------------------------------
// Governed content extraction (grounded in the ACTUAL Castor Markdown format)
// ---------------------------------------------------------------------------

const STORY_FRAME_SECTION_ORDER: ReadonlyArray<StoryFrameSectionKey> = [
  "theme_tone",
  "core_conflict",
  "world_setting",
  "ending_direction",
];

interface MarkdownSection {
  readonly heading: string;
  readonly body: string;
}

/**
 * Split Markdown into level-2 (`## `) headed sections in document order.
 * Content between headings belongs to the preceding heading; preamble before
 * the first heading is ignored for governed-unit extraction.
 */
function splitLevel2Sections(raw: string): ReadonlyArray<MarkdownSection> {
  const sections: MarkdownSection[] = [];
  const lines = raw.split(/\r?\n/);
  let currentHeading: string | null = null;
  let currentBody: string[] = [];
  const flush = (): void => {
    if (currentHeading !== null) {
      sections.push({ heading: currentHeading, body: currentBody.join("\n").trim() });
    }
    currentBody = [];
  };
  for (const line of lines) {
    const match = /^##\s+(.+)$/.exec(line);
    if (match) {
      flush();
      currentHeading = match[1]!.trim();
    } else {
      currentBody.push(line);
    }
  }
  flush();
  return sections;
}

/**
 * Extract the governed logical content for a locator from the existing
 * repository Markdown format:
 * - section: story_frame's four prose paragraphs carry free-form `## ` headings;
 *   the architect's hard contract emits EXACTLY four in the fixed conceptual
 *   order (theme → conflict → world → ending), so the canonical sectionKey is
 *   mapped POSITIONALLY (heading index 0..3). The extractor FAILS CLOSED when
 *   the file does not contain EXACTLY four level-2 sections. Section ORDER is
 *   an existing Castor legacy-format contract: Task 2 validates count/shape
 *   only — it cannot semantically detect a Human swapping two free-form
 *   headings, and such external semantic remapping is NOT silently repaired
 *   here (later external-edit/revision governance handles intentional
 *   structural changes). No new persistent convention, no migration.
 * - rule: book_rules.md is a rules card of `## `-headed rules; ruleId is the
 *   actual heading text (existing identity).
 * - entry: pending_hooks.md is a pipe table; entryKey is the hook_id in the
 *   first column.
 * - whole_file: the whole file content.
 */
export async function extractGovernedContent(bookDir: string, locator: FoundationContentLocator): Promise<string> {
  const resolvedPath = safeChildPath(bookDir, locator.sourceRelPath); // throws on escape
  if (locator.contentKind === "whole_file") {
    return readFile(resolvedPath, "utf-8");
  }
  const raw = await readFile(resolvedPath, "utf-8");

  if (locator.contentKind === "section") {
    const sections = splitLevel2Sections(raw);
    if (sections.length !== STORY_FRAME_SECTION_ORDER.length) {
      throw new Error(
        `Story Frame positional contract violated for ${locator.sourceRelPath}: `
        + `expected exactly ${STORY_FRAME_SECTION_ORDER.length} level-2 sections, found ${sections.length}`,
      );
    }
    const index = STORY_FRAME_SECTION_ORDER.indexOf(locator.sectionKey);
    if (index < 0) return "";
    const section = sections[index];
    return section?.body ?? "";
  }

  if (locator.contentKind === "rule") {
    const sections = splitLevel2Sections(raw);
    const matched = sections.find((section) => section.heading === locator.ruleId);
    return matched?.body ?? "";
  }

  // entry: pipe-table row whose first cell equals entryKey.
  const headerCells = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    const cells = trimmed.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length === 0) continue;
    if (cells.every((cell) => /^-+$/.test(cell))) continue; // separator row
    if (headerCells.size === 0) {
      for (const cell of cells) headerCells.add(cell);
      continue;
    }
    if (cells[0] === locator.entryKey) {
      return trimmed.replace(/^\||\|$/g, "").trim();
    }
  }
  return "";
}
