import { z } from "zod";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { BookConfigSchema } from "../models/book.js";
import { StateManifestSchema } from "../models/runtime-state.js";
import { resolveGovernanceMarkers, SafeGovernanceIdSchema } from "../governance/contracts.js";
import {
  FoundationContentLocator,
  FoundationUnitManifest,
  FoundationUnitManifestSchema,
  extractGovernedContent,
  governedContentHash,
  readUnitManifests,
} from "./manifest.js";
import { StoryFrameSectionKey } from "./manifest.js";
import { safeChildPath } from "../utils/path-safety.js";

// ===========================================================================
// Legacy Foundation bootstrap + V2 upgrade candidate preparation (Task 3).
//
// Legacy books: parse existing Foundation Markdown into logical
// FoundationUnitManifest records with status = legacy_established (NEVER
// approved). No Markdown migration, no invented syntax — Task 2 locator
// contracts are reused verbatim.
//
// Upgrade candidate: durable, NON-authoritative, status "prepared" only.
// No Human approval, no preflight, no publish, no marker flip — those belong
// to Tasks 8/9/10. Candidate persistence lives under a Core-owned working
// root (story/foundation-v2-candidates/), NOT the Published Foundation paths.
// ===========================================================================

// ---------------------------------------------------------------------------
// Upgrade candidate — durable working record. Governance metadata only
// (revisionDraft carries FoundationUnitManifest records, which are metadata/
// refs/hashes — never creative prose; Task 2 no-shadow-prose invariant holds).
// ---------------------------------------------------------------------------

export const UpgradeCandidateSchema = z.object({
  candidateId: SafeGovernanceIdSchema,
  status: z.literal("prepared"),   // NEVER preflight/approved/published here
  revisionDraft: z.array(FoundationUnitManifestSchema).default([]),
  canonRevision: z.number().int().min(0),
  createdAt: z.string().datetime(),
}).strict();
export type UpgradeCandidate = z.infer<typeof UpgradeCandidateSchema>;

// ---------------------------------------------------------------------------
// Deterministic safe logical unit ids for generated legacy units.
// ---------------------------------------------------------------------------

/** Small deterministic non-cryptographic hash (FNV-1a) → 8 hex chars. */
function stableHash8(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

const STORY_FRAME_UNITS: ReadonlyArray<{ sectionKey: StoryFrameSectionKey; unitId: string }> = [
  { sectionKey: "theme_tone", unitId: "sf-theme-tone" },
  { sectionKey: "core_conflict", unitId: "sf-core-conflict" },
  { sectionKey: "world_setting", unitId: "sf-world-setting" },
  { sectionKey: "ending_direction", unitId: "sf-ending-direction" },
];

// ---------------------------------------------------------------------------
// Bootstrap result
// ---------------------------------------------------------------------------

export interface BootstrapResult {
  readonly mode: "legacy" | "v2";
  readonly units: ReadonlyArray<FoundationUnitManifest>;
  readonly upgradeCandidateReady: boolean;
}

async function readGovernanceMode(bookDir: string): Promise<"legacy" | "v2"> {
  const raw = await readFile(join(bookDir, "book.json"), "utf-8");
  const book = BookConfigSchema.parse(JSON.parse(raw));
  return resolveGovernanceMarkers(book).foundation; // unknown values fail closed via schema
}

async function readCanonRevision(bookDir: string): Promise<number> {
  try {
    const raw = await readFile(join(bookDir, "story", "state", "manifest.json"), "utf-8");
    return StateManifestSchema.parse(JSON.parse(raw)).lastAppliedChapter;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0; // no structured Canon yet
    throw error;
  }
}

function legacyUnit(params: {
  unitId: string;
  kind: FoundationUnitManifest["kind"];
  importance: FoundationUnitManifest["importance"];
  locator: FoundationContentLocator;
  content: string;
}): FoundationUnitManifest {
  return {
    unitId: params.unitId,
    kind: params.kind,
    importance: params.importance,
    status: "legacy_established",
    locator: params.locator,
    contentHash: governedContentHash(params.content),
    contentRevision: 1,
    dependencies: [],
  };
}

/**
 * Bootstrap a legacy book's existing Foundation Markdown into logical unit
 * manifests (status = legacy_established, NEVER approved). Markdown is read
 * only — never migrated or rewritten. When governance.foundation is already
 * "v2", the legacy bootstrap path is SKIPPED and existing V2 manifests are
 * loaded instead. Unknown governance values fail closed.
 */
export async function bootstrapFoundation(bookDir: string): Promise<BootstrapResult> {
  const mode = await readGovernanceMode(bookDir);
  if (mode === "v2") {
    const existing = await readUnitManifests(bookDir);
    return {
      mode,
      units: [...existing.values()],
      upgradeCandidateReady: false,
    };
  }

  const units: FoundationUnitManifest[] = [];

  // Story Frame — four independent units, positional section contract.
  for (const frame of STORY_FRAME_UNITS) {
    const content = await extractGovernedContent(bookDir, {
      contentKind: "section",
      sourceRelPath: "story/outline/story_frame.md",
      sectionKey: frame.sectionKey,
    });
    units.push(legacyUnit({
      unitId: frame.unitId,
      kind: "story_frame",
      importance: "required",
      locator: { contentKind: "section", sourceRelPath: "story/outline/story_frame.md", sectionKey: frame.sectionKey },
      content,
    }));
  }

  // Arc Direction — whole_file (NEVER a pipe-table entry locator).
  const volumeContent = await extractGovernedContent(bookDir, {
    contentKind: "whole_file",
    sourceRelPath: "story/outline/volume_map.md",
  });
  if (volumeContent.trim()) {
    units.push(legacyUnit({
      unitId: "arc-direction",
      kind: "arc_direction",
      importance: "required",
      locator: { contentKind: "whole_file", sourceRelPath: "story/outline/volume_map.md" },
      content: volumeContent,
    }));
  }

  // Book Rules — per real H2 heading (FoundationSourceKey), deterministic
  // safe unitId derived by hash, NEVER the raw heading text.
  const rulesRaw = await readFile(safeChildPath(bookDir, "story/book_rules.md"), "utf-8").catch(() => "");
  for (const section of splitH2Sections(rulesRaw)) {
    const content = await extractGovernedContent(bookDir, {
      contentKind: "rule",
      sourceRelPath: "story/book_rules.md",
      ruleId: section.heading,
    });
    if (!content.trim()) continue;
    units.push(legacyUnit({
      unitId: `book-rule-${stableHash8(section.heading)}`,
      kind: "book_rule",
      importance: "optional",
      locator: { contentKind: "rule", sourceRelPath: "story/book_rules.md", ruleId: section.heading },
      content,
    }));
  }

  // Hooks — per real pending_hooks pipe-table hook_id identity.
  const hooksRaw = await readFile(safeChildPath(bookDir, "story/pending_hooks.md"), "utf-8").catch(() => "");
  for (const hookId of listHookIds(hooksRaw)) {
    const content = await extractGovernedContent(bookDir, {
      contentKind: "entry",
      sourceRelPath: "story/pending_hooks.md",
      entryKey: hookId,
    });
    if (!content.trim()) continue;
    units.push(legacyUnit({
      unitId: `foundation-hook-${stableHash8(hookId)}`,
      kind: "foundation_hook",
      importance: "optional",
      locator: { contentKind: "entry", sourceRelPath: "story/pending_hooks.md", entryKey: hookId },
      content,
    }));
  }

  // Characters — whole-file role sheets under story/roles/<tier>/*.md.
  const roleEntries = await scanRoleSheets(bookDir);
  for (const sheet of roleEntries) {
    const content = await extractGovernedContent(bookDir, { contentKind: "whole_file", sourceRelPath: sheet.relPath });
    if (!content.trim()) continue;
    units.push(legacyUnit({
      unitId: `character-${stableHash8(sheet.relPath)}`,
      kind: "character",
      // Protagonist REQUIRED determination is a Human/review concern during
      // upgrade (Task 8); bootstrap snapshots legacy content without guessing.
      importance: "optional",
      locator: { contentKind: "whole_file", sourceRelPath: sheet.relPath },
      content,
    }));
  }

  return {
    mode: "legacy",
    units,
    upgradeCandidateReady: units.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Legacy Markdown scanners (grounded in the real Castor formats)
// ---------------------------------------------------------------------------

function splitH2Sections(raw: string): ReadonlyArray<{ heading: string }> {
  const headings: Array<{ heading: string }> = [];
  for (const line of raw.split(/\r?\n/)) {
    const match = /^##\s+(.+)$/.exec(line);
    if (match) headings.push({ heading: match[1]!.trim() });
  }
  return headings;
}

function listHookIds(raw: string): ReadonlyArray<string> {
  const ids: string[] = [];
  let headerSeen = false;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    const cells = trimmed.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length === 0) continue;
    if (cells.every((cell) => /^-+$/.test(cell))) continue;
    if (!headerSeen) {
      headerSeen = true;
      continue;
    }
    if (cells[0]) ids.push(cells[0]!);
  }
  return ids;
}

async function scanRoleSheets(bookDir: string): Promise<ReadonlyArray<{ relPath: string }>> {
  const tiers = ["", "major", "", "minor"];
  const sheets: Array<{ relPath: string }> = [];
  for (const tier of tiers) {
    const dir = join(bookDir, "story", "roles", tier);
    const entries = await readdir(dir).catch(() => [] as string[]);
    for (const entry of entries.filter((file) => file.endsWith(".md"))) {
      sheets.push({ relPath: `story/roles/${tier}/${entry}` });
    }
  }
  return sheets;
}

// ---------------------------------------------------------------------------
// Upgrade candidate persistence — Core-owned working root, path-safe candidateId.
// ---------------------------------------------------------------------------

function candidateRoot(bookDir: string): string {
  return join(bookDir, "story", "foundation-v2-candidates");
}

function candidatePathFor(bookDir: string, candidateId: string): string {
  const safe = SafeGovernanceIdSchema.parse(candidateId); // re-validate before any filename mapping
  return join(candidateRoot(bookDir), `${safe}.gov.json`);
}

async function writeFileAtomic(target: string, content: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const tmpPath = `${target}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, content, "utf-8");
  try {
    await rename(tmpPath, target);
  } catch (error) {
    await rm(tmpPath, { force: true });
    throw error;
  }
}

/**
 * Prepare a durable, NON-authoritative V2 upgrade candidate for a legacy book.
 * ZERO authority side effects: no publish, no approval, no preflight, no marker
 * flip, no Canon/Markdown/chapter writes — only the candidate file under the
 * Core-owned working root. Fails closed when the book is already V2 or the
 * governance markers are unknown.
 */
export async function prepareFoundationV2Upgrade(bookDir: string): Promise<UpgradeCandidate> {
  const mode = await readGovernanceMode(bookDir);
  if (mode === "v2") {
    throw new Error(`Cannot prepare a V2 upgrade candidate for book at ${bookDir}: governance.foundation is already "v2"`);
  }
  const { units } = await bootstrapFoundation(bookDir);
  const candidate: UpgradeCandidate = {
    candidateId: randomUUID(), // hyphens only — SafeGovernanceId-safe
    status: "prepared",
    revisionDraft: units.map((unit) => FoundationUnitManifestSchema.parse(unit)),
    canonRevision: await readCanonRevision(bookDir),
    createdAt: new Date().toISOString(),
  };
  await writeFileAtomic(candidatePathFor(bookDir, candidate.candidateId), `${JSON.stringify(candidate, null, 2)}\n`);
  return candidate;
}

/**
 * Load a durable upgrade candidate by candidateId. Corrupt/unknown persisted
 * candidate data FAILS CLOSED; unsafe candidateIds are rejected at the path
 * boundary.
 */
export async function loadUpgradeCandidate(bookDir: string, candidateId: string): Promise<UpgradeCandidate> {
  const path = candidatePathFor(bookDir, candidateId);
  const raw = await readFile(path, "utf-8");
  return UpgradeCandidateSchema.parse(JSON.parse(raw));
}

/** Remove a durable upgrade candidate. */
export async function deleteUpgradeCandidate(bookDir: string, candidateId: string): Promise<void> {
  const path = candidatePathFor(bookDir, candidateId);
  await rm(path, { force: true });
}
