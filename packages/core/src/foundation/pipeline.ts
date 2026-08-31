import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { BookConfigSchema, type BookConfig } from "../models/book.js";
import { createLLMClient } from "../llm/provider.js";
import { loadProjectConfig } from "../utils/config-loader.js";
import { ArchitectAgent, type ArchitectOutput } from "../agents/architect.js";
import {
  FoundationReviewerAgent,
  type FoundationReviewResult,
} from "../agents/foundation-reviewer.js";
import { SafeGovernanceIdSchema, resolveGovernanceMarkers } from "../governance/contracts.js";
import { readCurrentCanonRevision, readRevisionUnitDraft, readVerifiedRevisionUnitState } from "../governance/conflicts.js";
import { extractGovernedContent, governedContentHash, type FoundationUnitManifest } from "./manifest.js";
import { loadUpgradeCandidate } from "./bootstrap.js";
import {
  openFoundationRevision,
  saveFoundationUnitDraft,
} from "./revision-service.js";
import {
  FoundationFindingSchema,
  applyBoundedFoundationRepair,
  reviewFoundationRevision,
  saveFoundationReviewFinding,
  verifyFoundationRepairs,
  type FoundationFinding,
  type FoundationFindingCategory,
} from "./review.js";

// ===========================================================================
// Phase 5 Task 10 — Foundation intelligence pipeline.
//
// This is a working-state pipeline only. It creates the durable Task 8 revision
// before semantic review, binds every Task 7 finding/repair to that revision,
// and stops at the Human review boundary. It deliberately imports no approval
// or publish operation and never writes Published Foundation, version pointers,
// governance markers, Planning authority, or Canon.
// ===========================================================================

export interface AdaptiveIntakeResult {
  readonly mustKnowGaps: ReadonlyArray<string>;
  readonly helpfulProposals: ReadonlyArray<string>;
}

export type FoundationPipelineResult =
  | {
      readonly status: "ready_for_human_review";
      readonly revisionId: string;
      readonly findings: ReadonlyArray<FoundationFinding>;
    }
  | {
      readonly status: "needs_human_direction";
      readonly revisionId: string;
      readonly findings: ReadonlyArray<FoundationFinding>;
      readonly remainingRounds: number;
    }
  | {
      readonly status: "generation_failed";
      readonly reasons: ReadonlyArray<string>;
      readonly revisionId?: string;
    };

export interface FoundationPipelineOptions {
  readonly upgradeCandidateId?: string;
}

interface WorkingUnit {
  readonly unitId: string;
  readonly content: string;
  readonly role: "story" | "volume" | "rules" | "hooks" | "characters" | "other";
  readonly heading?: string;
}

interface ReviewFindingProposal {
  readonly findingId?: string;
  readonly unitId?: string;
  readonly category?: FoundationFindingCategory;
  readonly severity?: "minor" | "important" | "blocking";
  readonly repairScope?: "local" | "multi_unit" | "author_decision";
  readonly evidence?: string;
  readonly suggestedAction?: string;
}

type PipelineReviewResult = Omit<FoundationReviewResult, "findings"> & {
  readonly findings?: ReadonlyArray<ReviewFindingProposal>;
};

const STORY_FRAME_UNITS = [
  { unitId: "sf-theme-tone", heading: "Theme and Tone" },
  { unitId: "sf-core-conflict", heading: "Core Conflict" },
  { unitId: "sf-world-setting", heading: "World Setting" },
  { unitId: "sf-ending-direction", heading: "Ending Direction" },
] as const;

const FRESH_UNIT_IDS = {
  volume: "arc-direction",
  rules: "foundation-book-rules",
  hooks: "foundation-pending-hooks",
  characters: "foundation-characters",
} as const;

const MUST_KNOW = [
  { key: "protagonist", label: "protagonist", aliases: ["protagonist", "main character", "nhân vật chính"] },
  { key: "premise", label: "core premise", aliases: ["premise", "core premise", "story premise", "tiền đề", "tiền đề cốt lõi"] },
  { key: "conflict", label: "central conflict", aliases: ["conflict", "central conflict", "dramatic engine", "xung đột", "xung đột trung tâm"] },
] as const;

const HELPFUL = [
  { label: "ending preference", aliases: ["ending", "ending preference", "kết thúc", "kết truyện"] },
  { label: "antagonist", aliases: ["antagonist", "phản diện"] },
  { label: "tone", aliases: ["tone", "style", "giọng điệu", "phong cách"] },
  { label: "supporting cast", aliases: ["supporting cast", "supporting characters", "nhân vật phụ"] },
] as const;

function nonEmpty(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizedKnown(known: Record<string, string>): Map<string, string> {
  const result = new Map<string, string>();
  for (const [key, value] of Object.entries(known)) {
    if (nonEmpty(value)) result.set(key.trim().toLowerCase(), value.trim());
  }
  return result;
}

function hasAlias(values: Map<string, string>, aliases: ReadonlyArray<string>): boolean {
  return aliases.some((alias) => values.has(alias.toLowerCase()));
}

function briefContainsKnown(brief: string, aliases: ReadonlyArray<string>): boolean {
  if (!brief.trim()) return false;
  return aliases.some((alias) => {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|\\n)\\s*(?:${escaped})\\s*[：:]\\s*\\S+`, "iu").test(brief);
  });
}

/**
 * Extract deterministic known fields first, then return at most three genuine
 * blockers. Optional creative preferences are proposals only and never enter
 * mustKnowGaps.
 */
export async function adaptiveIntake(
  bookDir: string,
  known: Record<string, string>,
): Promise<AdaptiveIntakeResult> {
  const values = normalizedKnown(known);
  let book: BookConfig | null = null;
  try {
    book = BookConfigSchema.parse(JSON.parse(await readFile(resolve(bookDir, "book.json"), "utf-8")));
  } catch {
    // A missing/corrupt book is handled by runFoundationPipeline. Intake still
    // reports only gaps it can establish rather than inventing known values.
  }
  const brief = await readFile(resolve(bookDir, "story", "brief.md"), "utf-8").catch(() => "");

  // BookConfig already establishes genre, target scale, and writing language.
  const structuralGaps: string[] = [];
  if (!book?.genre && !hasAlias(values, ["genre", "story mode", "thể loại"])) structuralGaps.push("story mode / genre");
  if (!book?.targetChapters && !hasAlias(values, ["scale", "target scale", "target chapters", "quy mô", "số chương"])) structuralGaps.push("target scale");
  if (!book?.language && !hasAlias(values, ["language", "writing language", "ngôn ngữ", "ngôn ngữ viết"])) structuralGaps.push("writing language");

  const creativeGaps = MUST_KNOW
    .filter((field) => !hasAlias(values, field.aliases) && !briefContainsKnown(brief, field.aliases))
    .map((field) => field.label);

  const helpfulProposals = HELPFUL
    .filter((field) => !hasAlias(values, field.aliases) && !briefContainsKnown(brief, field.aliases))
    .map((field) => field.label);

  return {
    mustKnowGaps: [...structuralGaps, ...creativeGaps].slice(0, 3),
    helpfulProposals,
  };
}

function stableHash8(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function splitStoryFrame(raw: string): ReadonlyArray<{ heading: string; body: string }> {
  const sections: Array<{ heading: string; body: string }> = [];
  let heading: string | null = null;
  let body: string[] = [];
  const flush = (): void => {
    if (heading !== null) sections.push({ heading, body: body.join("\n").trim() });
    body = [];
  };
  for (const line of raw.split(/\r?\n/)) {
    const matched = /^##\s+(.+)$/.exec(line);
    if (matched) {
      flush();
      heading = matched[1]!.trim();
    } else {
      body.push(line);
    }
  }
  flush();
  if (sections.length !== STORY_FRAME_UNITS.length) {
    throw new Error(
      `Architect Story Frame mechanical contract requires exactly ${STORY_FRAME_UNITS.length} level-2 sections; found ${sections.length}`,
    );
  }
  return sections;
}

function freshWorkingUnits(output: ArchitectOutput): ReadonlyArray<WorkingUnit> {
  const storySections = splitStoryFrame(output.storyFrame ?? output.storyBible);
  const units: WorkingUnit[] = STORY_FRAME_UNITS.map((identity, index) => ({
    unitId: identity.unitId,
    content: storySections[index]!.body,
    role: "story",
    heading: storySections[index]!.heading || identity.heading,
  }));
  units.push(
    { unitId: FRESH_UNIT_IDS.volume, content: output.volumeMap ?? output.volumeOutline, role: "volume" },
    { unitId: FRESH_UNIT_IDS.rules, content: output.bookRules, role: "rules" },
    { unitId: FRESH_UNIT_IDS.hooks, content: output.pendingHooks, role: "hooks" },
  );
  if (output.roles && output.roles.length > 0) {
    for (const role of output.roles) {
      units.push({
        unitId: `character-${stableHash8(`${role.tier}:${role.name}`)}`,
        content: role.content,
        role: "characters",
        heading: role.name,
      });
    }
  } else {
    units.push({ unitId: FRESH_UNIT_IDS.characters, content: "", role: "characters" });
  }
  if (new Set(units.map((unit) => unit.unitId)).size !== units.length) {
    throw new Error("Architect generation produced duplicate Foundation unit identities");
  }
  return units.map((unit) => ({ ...unit, unitId: SafeGovernanceIdSchema.parse(unit.unitId) }));
}

function roleForManifest(manifest: FoundationUnitManifest): WorkingUnit["role"] {
  switch (manifest.kind) {
    case "story_frame": return "story";
    case "arc_direction": return "volume";
    case "book_rule": return "rules";
    case "foundation_hook": return "hooks";
    case "character": return "characters";
    default: return "other";
  }
}

async function candidateWorkingUnits(
  bookDir: string,
  candidateId: string,
): Promise<ReadonlyArray<WorkingUnit>> {
  const candidate = await loadUpgradeCandidate(bookDir, candidateId);
  if (candidate.status !== "prepared" || candidate.revisionDraft.length === 0) {
    throw new Error(`Upgrade candidate "${candidateId}" is incompatible or empty`);
  }
  const currentCanonRevision = await readCurrentCanonRevision(bookDir);
  if (candidate.canonRevision !== currentCanonRevision) {
    throw new Error(
      `Upgrade candidate "${candidateId}" is stale: Canon revision ${candidate.canonRevision} != current ${currentCanonRevision}`,
    );
  }
  const units: WorkingUnit[] = [];
  for (const manifest of candidate.revisionDraft) {
    const content = await extractGovernedContent(bookDir, manifest.locator);
    if (governedContentHash(content) !== manifest.contentHash) {
      throw new Error(`Upgrade candidate "${candidateId}" source changed for unit ${manifest.unitId}`);
    }
    units.push({
      unitId: SafeGovernanceIdSchema.parse(manifest.unitId),
      content,
      role: roleForManifest(manifest),
    });
  }
  return units;
}

async function materializeDurableRevision(
  bookDir: string,
  revisionId: string,
  units: ReadonlyArray<WorkingUnit>,
): Promise<void> {
  for (const unit of units) {
    await saveFoundationUnitDraft(bookDir, revisionId, unit.unitId, unit.content);
  }
}

async function readExactFoundation(
  bookDir: string,
  revisionId: string,
  units: ReadonlyArray<WorkingUnit>,
): Promise<ArchitectOutput> {
  const grouped: Record<WorkingUnit["role"], string[]> = {
    story: [],
    volume: [],
    rules: [],
    hooks: [],
    characters: [],
    other: [],
  };
  for (const unit of units) {
    const content = await readRevisionUnitDraft(bookDir, revisionId, unit.unitId);
    if (content === null) throw new Error(`Durable revision ${revisionId} lost unit ${unit.unitId}`);
    const unitLabel = `[unitId=${unit.unitId}]`;
    const rendered = unit.role === "story"
      ? `## ${unitLabel} ${unit.heading ?? unit.unitId}\n${content}`
      : unit.role === "characters" && unit.heading
        ? `# ${unitLabel} ${unit.heading}\n\n${content}`
        : `## ${unitLabel}\n${content}`;
    grouped[unit.role].push(rendered);
  }
  const join = (role: WorkingUnit["role"]): string => grouped[role].filter(Boolean).join("\n\n");
  const storyBible = [join("story"), join("characters"), join("other")].filter(Boolean).join("\n\n");
  return {
    storyBible,
    volumeOutline: join("volume"),
    bookRules: join("rules"),
    currentState: "",
    pendingHooks: join("hooks"),
    storyFrame: join("story"),
    volumeMap: join("volume"),
  };
}

async function createAgents(bookDir: string, book: BookConfig): Promise<{
  readonly architect: ArchitectAgent;
  readonly reviewer: FoundationReviewerAgent;
}> {
  const projectRoot = resolve(bookDir, "..", "..");
  const config = await loadProjectConfig(projectRoot, { requireApiKey: false });
  const client = createLLMClient(config.llm);
  const context = {
    client,
    model: config.llm.model,
    projectRoot,
    bookId: book.id,
  };
  return {
    architect: new ArchitectAgent(context),
    reviewer: new FoundationReviewerAgent(context),
  };
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function bindFindingProposal(
  bookDir: string,
  revisionId: string,
  units: ReadonlyArray<WorkingUnit>,
  proposal: ReviewFindingProposal,
): Promise<FoundationFinding> {
  let unit = units.find((item) => item.unitId === proposal.unitId);
  if (!unit && nonEmpty(proposal.evidence)) {
    const matchingUnits: WorkingUnit[] = [];
    for (const candidate of units) {
      const candidateContent = await readRevisionUnitDraft(bookDir, revisionId, candidate.unitId);
      if (candidateContent?.includes(proposal.evidence!)) matchingUnits.push(candidate);
    }
    if (matchingUnits.length === 1) unit = matchingUnits[0];
  }
  if (!unit) {
    throw new Error("Reviewer finding does not identify one exact durable Foundation unit");
  }
  const state = await readVerifiedRevisionUnitState(bookDir, revisionId, unit.unitId);
  const content = await readRevisionUnitDraft(bookDir, revisionId, unit.unitId);
  if (!state || content === null) throw new Error(`Cannot bind finding to ${revisionId}/${unit.unitId}`);
  if (nonEmpty(proposal.evidence) && !content.includes(proposal.evidence!)) {
    throw new Error(`Reviewer evidence does not occur in exact unit ${unit.unitId}`);
  }
  const fallbackEvidence = content.trim().slice(0, 4096) || `Unit ${unit.unitId} requires Human review`;
  const finding = FoundationFindingSchema.parse({
    // Reviewer identity/bindings are proposals, never trusted persisted truth.
    // Core allocates a fresh id and supplies the exact revision/hash binding.
    findingId: `pipeline-finding-${randomUUID()}`,
    revisionId,
    unitId: unit.unitId,
    contentRevision: state.contentRevision,
    contentHash: state.contentHash,
    category: proposal.category ?? "internal_consistency",
    severity: proposal.severity ?? "blocking",
    repairScope: proposal.repairScope ?? "author_decision",
    evidence: nonEmpty(proposal.evidence) ? proposal.evidence!.slice(0, 4096) : fallbackEvidence,
    suggestedAction: nonEmpty(proposal.suggestedAction)
      ? proposal.suggestedAction!.slice(0, 4096)
      : "Human direction is required before this Foundation unit can proceed.",
  });
  await saveFoundationReviewFinding(bookDir, finding);
  return finding;
}

async function runExactReview(params: {
  readonly bookDir: string;
  readonly revisionId: string;
  readonly units: ReadonlyArray<WorkingUnit>;
  readonly reviewer: FoundationReviewerAgent;
  readonly book: BookConfig;
}): Promise<ReadonlyArray<FoundationFinding>> {
  const foundation = await readExactFoundation(params.bookDir, params.revisionId, params.units);
  const reviewMode: "original" | "fanfic" | "series" = params.book.fanficMode
    ? "fanfic"
    : params.book.parentBookId
      ? "series"
      : "original";
  const raw = await params.reviewer.review({
    foundation,
    mode: reviewMode,
    language: params.book.language === "en" ? "en" : "vi",
    targetChapters: params.book.targetChapters,
    structuredFindings: true,
  }) as PipelineReviewResult;

  const proposals = raw.findings ?? [];
  if (proposals.length > 0) {
    for (const proposal of proposals) {
      await bindFindingProposal(params.bookDir, params.revisionId, params.units, proposal);
    }
  }
  // The legacy reviewer score/pass flag is informational only. It must never
  // fabricate an authority-blocking finding from a score threshold; only typed
  // diagnostic findings enter Task 7 governance and repair policy.
  return reviewFoundationRevision(params.bookDir, params.revisionId);
}

function isAutoRepairable(finding: FoundationFinding): boolean {
  return finding.repairScope === "local"
    && (finding.severity === "minor" || finding.severity === "important");
}

/**
 * Generate/materialize once, persist first, globally review the exact durable
 * draft, then use Task 7's local two-round repair policy. All successful paths
 * stop at a Human-reviewable Task 8 revision; there is no approval or publish
 * transition in this module.
 */
export async function runFoundationPipeline(
  bookDir: string,
  opts: FoundationPipelineOptions = {},
): Promise<FoundationPipelineResult> {
  let revisionId: string | undefined;
  try {
    const book = BookConfigSchema.parse(JSON.parse(await readFile(resolve(bookDir, "book.json"), "utf-8")));
    const { architect, reviewer } = await createAgents(bookDir, book);

    let units: ReadonlyArray<WorkingUnit>;
    if (opts.upgradeCandidateId) {
      if (resolveGovernanceMarkers(book).foundation !== "legacy") {
        throw new Error("Upgrade candidates are compatible only with legacy Foundation authority");
      }
      units = await candidateWorkingUnits(bookDir, opts.upgradeCandidateId);
    } else {
      // Intake extracts durable book knowledge before generation. Genuine gaps
      // and optional proposals are context only: they never become approvals or
      // authority, and optional proposals are explicitly non-blocking.
      const intake = await adaptiveIntake(bookDir, {});
      const brief = await readFile(resolve(bookDir, "story", "brief.md"), "utf-8").catch(() => "");
      const intakeContext = [
        brief.trim() ? `Human-supplied story brief:\n${brief.trim()}` : "No separate story brief was supplied.",
        intake.mustKnowGaps.length > 0
          ? `Unresolved MUST-KNOW gaps (do not claim these as Human-confirmed): ${intake.mustKnowGaps.join(", ")}.`
          : "No unresolved MUST-KNOW gaps were detected from persisted input.",
        intake.helpfulProposals.length > 0
          ? `Optional non-blocking ideas may be proposed for: ${intake.helpfulProposals.join(", ")}.`
          : "No optional proposals are needed.",
      ].join("\n\n");
      // Global Architect generation occurs exactly once. No semantic repair path
      // calls it again; local repair is delegated exclusively to Task 7.
      const generated = await architect.generateFoundation(book, intakeContext);
      units = freshWorkingUnits(generated);
    }

    if (units.length === 0) throw new Error("Architect generation produced no Foundation units");
    // Critical ordering boundary: assign revisionId immediately after Task 8
    // creates it, before unit materialization or semantic review. Any later
    // failure therefore returns the same durable, resumable revisionId.
    ({ revisionId } = await openFoundationRevision(bookDir, units.map((unit) => unit.unitId)));
    await materializeDurableRevision(bookDir, revisionId, units);

    let findings = await runExactReview({ bookDir, revisionId, units, reviewer, book });
    if (findings.length === 0) {
      return { status: "ready_for_human_review", revisionId, findings };
    }

    for (let round = 1; round <= 2; round += 1) {
      // Human-routed findings are never silently modified. Conservatively stop
      // the semantic loop rather than staling them through another unit edit.
      if (findings.some((finding) => !isAutoRepairable(finding))) {
        return {
          status: "needs_human_direction",
          revisionId,
          findings,
          remainingRounds: 3 - round,
        };
      }

      const targetUnitIds = [...new Set(findings.map((finding) => finding.unitId))];
      const outcome = await applyBoundedFoundationRepair(
        bookDir,
        revisionId,
        targetUnitIds,
        findings,
        round,
      );
      if (outcome.status === "needs_human_direction") {
        return {
          status: "needs_human_direction",
          revisionId,
          findings: outcome.remaining,
          remainingRounds: 2 - round,
        };
      }
      if (outcome.status === "clean") {
        return { status: "ready_for_human_review", revisionId, findings: [] };
      }

      // Separate invocation verifies exact Task 7 repair output. The semantic
      // reviewer then reads the durable revision again (mandatory targeted
      // re-review for IMPORTANT+LOCAL, also safe for MINOR+LOCAL).
      const verificationRemaining = await verifyFoundationRepairs(
        bookDir,
        revisionId,
        targetUnitIds,
        findings,
        round,
      );
      if (verificationRemaining.length > 0) {
        return {
          status: "needs_human_direction",
          revisionId,
          findings: verificationRemaining,
          remainingRounds: 2 - round,
        };
      }

      findings = await runExactReview({ bookDir, revisionId, units, reviewer, book });
      if (findings.length === 0) {
        return { status: "ready_for_human_review", revisionId, findings };
      }
    }

    return {
      status: "needs_human_direction",
      revisionId,
      findings,
      remainingRounds: 0,
    };
  } catch (error) {
    return {
      status: "generation_failed",
      reasons: [safeError(error)],
      ...(revisionId ? { revisionId } : {}),
    };
  }
}
