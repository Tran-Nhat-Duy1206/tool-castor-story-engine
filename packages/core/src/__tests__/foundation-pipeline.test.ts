import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArchitectAgent, type ArchitectOutput } from "../agents/architect.js";
import { FoundationReviewerAgent } from "../agents/foundation-reviewer.js";
import { adaptiveIntake, runFoundationPipeline } from "../foundation/pipeline.js";
import { loadFoundationRevision } from "../foundation/revision-service.js";
import { readRevisionUnitDraft } from "../governance/conflicts.js";
import { createVersionStore } from "../governance/versions.js";
import { loadUpgradeCandidate, prepareFoundationV2Upgrade } from "../foundation/bootstrap.js";
import * as publishModule from "../foundation/publish.js";

const STORY_UNIT = "sf-theme-tone";
const CLEAN_REVIEW = {
  passed: true,
  totalScore: 90,
  dimensions: [],
  overallFeedback: "clean",
};

const STORY_FRAME = [
  "## Theme and Tone", "Weak premise needs focus.",
  "## Core Conflict", "A sealed empire hunts the mapmaker.",
  "## World Setting", "Dream maps can alter waking roads.",
  "## Ending Direction", "Mara must choose freedom over certainty.",
].join("\n");

const GENERATED: ArchitectOutput = {
  storyBible: STORY_FRAME,
  volumeOutline: "Volume direction.",
  bookRules: "No resurrection.",
  currentState: "",
  pendingHooks: "A sealed letter.",
  storyFrame: STORY_FRAME,
  volumeMap: "Volume direction.",
  roles: [{ tier: "major", name: "Mara", content: "Mara wants freedom." }],
};

let root = "";
let bookDir = "";
let bookJsonPath = "";
let canonPath = "";

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

async function setupBook(): Promise<void> {
  root = await mkdtemp(join(tmpdir(), "castor-foundation-pipeline-"));
  bookDir = join(root, "books", "demo-book");
  bookJsonPath = join(bookDir, "book.json");
  canonPath = join(bookDir, "story", "state", "manifest.json");
  await mkdir(join(bookDir, "story", "state"), { recursive: true });
  await writeFile(join(root, "castor.json"), JSON.stringify({
    name: "pipeline-test",
    version: "0.1.0",
    language: "en",
    llm: {
      provider: "custom",
      service: "custom",
      configSource: "studio",
      baseUrl: "http://127.0.0.1:11434/v1",
      apiKey: "",
      model: "test-model",
      temperature: 0.1,
      thinkingBudget: 0,
      apiFormat: "chat",
      stream: false,
    },
  }, null, 2), "utf-8");
  await writeFile(bookJsonPath, `${JSON.stringify({
    id: "demo-book",
    title: "Demo",
    platform: "other",
    genre: "fantasy",
    status: "incubating",
    targetChapters: 30,
    chapterWordCount: 2000,
    language: "en",
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
    governance: { foundation: "legacy", planning: "legacy" },
  }, null, 2)}\n`, "utf-8");
  await writeFile(canonPath, `${JSON.stringify({
    schemaVersion: 2,
    language: "en",
    lastAppliedChapter: 0,
    projectionVersion: 1,
    migrationWarnings: [],
  }, null, 2)}\n`, "utf-8");
}

function localFinding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    unitId: STORY_UNIT,
    category: "story_core",
    severity: "minor",
    repairScope: "local",
    evidence: "Weak premise",
    suggestedAction: "Focused premise",
    ...overrides,
  };
}

function reviewWithFindings(findings: ReadonlyArray<Record<string, unknown>>) {
  return {
    passed: findings.length === 0,
    totalScore: findings.length === 0 ? 90 : 70,
    dimensions: [],
    overallFeedback: findings.length === 0 ? "clean" : "needs work",
    findings,
  };
}

async function runCleanPipeline() {
  vi.spyOn(ArchitectAgent.prototype, "generateFoundation").mockResolvedValue(GENERATED);
  vi.spyOn(FoundationReviewerAgent.prototype, "review").mockResolvedValue(CLEAN_REVIEW);
  return runFoundationPipeline(bookDir);
}

async function createLegacyCandidate(): Promise<string> {
  await mkdir(join(bookDir, "story", "outline"), { recursive: true });
  await writeFile(join(bookDir, "story", "outline", "story_frame.md"), [
    "# Story Frame",
    "## 主题与基调", "Legacy theme.",
    "## 核心冲突", "Legacy conflict.",
    "## 世界观底色", "Legacy world.",
    "## 结局方向", "Legacy ending.",
  ].join("\n"), "utf-8");
  await writeFile(join(bookDir, "story", "outline", "volume_map.md"), "Legacy volume map.\n", "utf-8");
  await writeFile(join(bookDir, "story", "book_rules.md"), "", "utf-8");
  await writeFile(join(bookDir, "story", "pending_hooks.md"), "", "utf-8");
  const candidate = await prepareFoundationV2Upgrade(bookDir);
  return candidate.candidateId;
}

beforeEach(async () => {
  await setupBook();
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (root) await rm(root, { recursive: true, force: true });
});

describe("adaptiveIntake", () => {
  it("extracts known information first and asks only unknown must-know gaps", async () => {
    const result = await adaptiveIntake(bookDir, {
      protagonist: "Mara",
      premise: "A cartographer maps forbidden dreams",
      conflict: "The map awakens its prison",
    });
    expect(result.mustKnowGaps).not.toEqual(expect.arrayContaining(["protagonist", "core premise", "central conflict"]));
    expect(result.mustKnowGaps).not.toContain("genre");
    expect(result.mustKnowGaps).not.toContain("writing language");
  });

  it("limits genuine must-know gaps to three", async () => {
    const result = await adaptiveIntake(bookDir, {});
    expect(result.mustKnowGaps.length).toBeGreaterThan(0);
    expect(result.mustKnowGaps.length).toBeLessThanOrEqual(3);
  });

  it("keeps helpful proposals separate and non-blocking", async () => {
    const result = await adaptiveIntake(bookDir, {
      protagonist: "Mara",
      premise: "A dream map",
      conflict: "The map fights its maker",
      scale: "30 chapters",
    });
    expect(result.helpfulProposals.length).toBeGreaterThan(0);
    expect(result.mustKnowGaps).not.toEqual(expect.arrayContaining([...result.helpfulProposals]));
  });
});

describe("runFoundationPipeline durable boundary", () => {
  it("creates a durable Task 8 revision and returns the same loadable revisionId", async () => {
    const result = await runCleanPipeline();
    expect(result.status).toBe("ready_for_human_review");
    if (result.status !== "ready_for_human_review") throw new Error("unexpected result");
    const draft = await loadFoundationRevision(bookDir, result.revisionId);
    expect(draft.revisionId).toBe(result.revisionId);
    expect(draft.approvalRecords).toEqual([]);
    expect(draft.unitStates.map((unit) => unit.unitId)).toEqual(expect.arrayContaining([
      "sf-theme-tone",
      "sf-core-conflict",
      "sf-world-setting",
      "sf-ending-direction",
      "arc-direction",
    ]));
    expect(draft.unitStates.some((unit) => unit.unitId.startsWith("character-"))).toBe(true);
    expect(draft.unitStates.every((unit) => unit.state !== "approved")).toBe(true);
  });

  it("runs review only after the exact revision is durable", async () => {
    vi.spyOn(ArchitectAgent.prototype, "generateFoundation").mockResolvedValue(GENERATED);
    let durableRevisionId = "";
    vi.spyOn(FoundationReviewerAgent.prototype, "review").mockImplementation(async (params) => {
      const revisions = await readdir(join(bookDir, "story", "revisions"));
      expect(revisions).toHaveLength(1);
      durableRevisionId = revisions[0]!;
      const draft = await loadFoundationRevision(bookDir, durableRevisionId);
      const exact = await readRevisionUnitDraft(bookDir, draft.revisionId, STORY_UNIT);
      expect(params.foundation.storyFrame).toContain(exact);
      return CLEAN_REVIEW;
    });
    const result = await runFoundationPipeline(bookDir);
    expect(result.status).toBe("ready_for_human_review");
    if (result.status === "ready_for_human_review") expect(result.revisionId).toBe(durableRevisionId);
  });

  it("passes the persisted Human brief to the one global Architect generation", async () => {
    await writeFile(join(bookDir, "story", "brief.md"), "Premise: Mara maps forbidden dreams.\n", "utf-8");
    const generate = vi.spyOn(ArchitectAgent.prototype, "generateFoundation").mockResolvedValue(GENERATED);
    vi.spyOn(FoundationReviewerAgent.prototype, "review").mockResolvedValue(CLEAN_REVIEW);
    await runFoundationPipeline(bookDir);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0]![1]).toContain("Mara maps forbidden dreams");
  });

  it("selects derivative review mode from persisted book configuration", async () => {
    const book = JSON.parse(await readFile(bookJsonPath, "utf-8"));
    book.parentBookId = "parent-book";
    await writeFile(bookJsonPath, `${JSON.stringify(book, null, 2)}\n`, "utf-8");
    vi.spyOn(ArchitectAgent.prototype, "generateFoundation").mockResolvedValue(GENERATED);
    const review = vi.spyOn(FoundationReviewerAgent.prototype, "review").mockResolvedValue(CLEAN_REVIEW);
    await runFoundationPipeline(bookDir);
    expect(review.mock.calls[0]![0].mode).toBe("series");
  });

  it("ignores reviewer-supplied identity/hash bindings and binds findings to the exact durable revision", async () => {
    vi.spyOn(ArchitectAgent.prototype, "generateFoundation").mockResolvedValue(GENERATED);
    vi.spyOn(FoundationReviewerAgent.prototype, "review").mockResolvedValue(reviewWithFindings([localFinding({
      findingId: "fabricated-finding",
      revisionId: "wrong-revision",
      contentRevision: 999,
      contentHash: "fabricated-hash",
      repairScope: "author_decision",
    })]) as never);
    const result = await runFoundationPipeline(bookDir);
    expect(result.status).toBe("needs_human_direction");
    if (result.status !== "needs_human_direction") throw new Error("unexpected result");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.revisionId).toBe(result.revisionId);
    expect(result.findings[0]!.findingId).not.toBe("fabricated-finding");
    expect(result.findings[0]!.contentRevision).not.toBe(999);
    expect(result.findings[0]!.contentHash).not.toBe("fabricated-hash");
  });

  it("keeps legacy reviewer scores informational when no typed findings exist", async () => {
    vi.spyOn(ArchitectAgent.prototype, "generateFoundation").mockResolvedValue(GENERATED);
    vi.spyOn(FoundationReviewerAgent.prototype, "review").mockResolvedValue({
      passed: false,
      totalScore: 10,
      dimensions: [{ name: "score", score: 10, feedback: "informational only" }],
      overallFeedback: "score thresholds are not authority",
    });
    const result = await runFoundationPipeline(bookDir);
    expect(result.status).toBe("ready_for_human_review");
  });

  it("repairs the exact same durable revision locally without rerunning Architect", async () => {
    const generate = vi.spyOn(ArchitectAgent.prototype, "generateFoundation").mockResolvedValue(GENERATED);
    const review = vi.spyOn(FoundationReviewerAgent.prototype, "review")
      .mockResolvedValueOnce(reviewWithFindings([localFinding()]) as never)
      .mockResolvedValueOnce(CLEAN_REVIEW);
    const result = await runFoundationPipeline(bookDir);
    expect(result.status).toBe("ready_for_human_review");
    if (result.status !== "ready_for_human_review") throw new Error("unexpected result");
    expect(await readRevisionUnitDraft(bookDir, result.revisionId, STORY_UNIT)).toContain("Focused premise");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(review).toHaveBeenCalledTimes(2);
  });

  it("important/local repair receives a separate targeted re-review", async () => {
    vi.spyOn(ArchitectAgent.prototype, "generateFoundation").mockResolvedValue(GENERATED);
    const review = vi.spyOn(FoundationReviewerAgent.prototype, "review")
      .mockResolvedValueOnce(reviewWithFindings([localFinding({ severity: "important" })]) as never)
      .mockResolvedValueOnce(CLEAN_REVIEW);
    const result = await runFoundationPipeline(bookDir);
    expect(result.status).toBe("ready_for_human_review");
    expect(review).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["multi_unit", "minor"],
    ["author_decision", "minor"],
    ["local", "blocking"],
  ] as const)("routes %s/%s findings to Human with the same revision", async (repairScope, severity) => {
    vi.spyOn(ArchitectAgent.prototype, "generateFoundation").mockResolvedValue(GENERATED);
    vi.spyOn(FoundationReviewerAgent.prototype, "review").mockResolvedValue(
      reviewWithFindings([localFinding({ repairScope, severity })]) as never,
    );
    const result = await runFoundationPipeline(bookDir);
    expect(result.status).toBe("needs_human_direction");
    if (result.status !== "needs_human_direction") throw new Error("unexpected result");
    expect((await loadFoundationRevision(bookDir, result.revisionId)).revisionId).toBe(result.revisionId);
  });

  it("caps semantic repair at two rounds and returns the same resumable revisionId", async () => {
    vi.spyOn(ArchitectAgent.prototype, "generateFoundation").mockResolvedValue(GENERATED);
    let call = 0;
    const review = vi.spyOn(FoundationReviewerAgent.prototype, "review").mockImplementation(async (params) => {
      call += 1;
      const evidence = call === 1 ? "Weak premise" : call === 2 ? "Focused premise" : "Sharper premise";
      const suggestedAction = call === 1 ? "Focused premise" : call === 2 ? "Sharper premise" : "Final premise";
      return reviewWithFindings([localFinding({ evidence, suggestedAction })]) as never;
    });
    const result = await runFoundationPipeline(bookDir);
    expect(result.status).toBe("needs_human_direction");
    if (result.status !== "needs_human_direction") throw new Error("unexpected result");
    expect(result.remainingRounds).toBe(0);
    expect(review).toHaveBeenCalledTimes(3);
    expect((await loadFoundationRevision(bookDir, result.revisionId)).revisionId).toBe(result.revisionId);
  });

  it("returns generation_failed without revisionId when Architect fails before persistence", async () => {
    vi.spyOn(ArchitectAgent.prototype, "generateFoundation").mockRejectedValue(new Error("provider unavailable"));
    const result = await runFoundationPipeline(bookDir);
    expect(result).toEqual({ status: "generation_failed", reasons: [expect.stringMatching(/provider unavailable/)] });
    expect(await exists(join(bookDir, "story", "revisions"))).toBe(false);
  });

  it("preserves and returns revisionId when review fails after persistence", async () => {
    vi.spyOn(ArchitectAgent.prototype, "generateFoundation").mockResolvedValue(GENERATED);
    vi.spyOn(FoundationReviewerAgent.prototype, "review").mockRejectedValue(new Error("review transport failed"));
    const result = await runFoundationPipeline(bookDir);
    expect(result.status).toBe("generation_failed");
    if (result.status !== "generation_failed") throw new Error("unexpected result");
    expect(result.revisionId).toBeTruthy();
    await expect(loadFoundationRevision(bookDir, result.revisionId!)).resolves.toBeTruthy();
  });
});

describe("upgrade candidate handoff", () => {
  it("loads the persisted Task 3 candidate, keeps it, and produces a durable revision", async () => {
    const candidateId = await createLegacyCandidate();
    const generate = vi.spyOn(ArchitectAgent.prototype, "generateFoundation");
    vi.spyOn(FoundationReviewerAgent.prototype, "review").mockImplementation(async (params) => {
      expect(params.foundation.storyBible).toContain("Legacy");
      return CLEAN_REVIEW;
    });
    const result = await runFoundationPipeline(bookDir, { upgradeCandidateId: candidateId });
    expect(result.status).toBe("ready_for_human_review");
    if (result.status !== "ready_for_human_review") throw new Error("unexpected result");
    await expect(loadFoundationRevision(bookDir, result.revisionId)).resolves.toBeTruthy();
    await expect(loadUpgradeCandidate(bookDir, candidateId)).resolves.toBeTruthy();
    expect(generate).not.toHaveBeenCalled();
  });

  it("repairs a local finding on the exact upgrade-candidate unit without deleting the candidate", async () => {
    const candidateId = await createLegacyCandidate();
    vi.spyOn(FoundationReviewerAgent.prototype, "review")
      .mockResolvedValueOnce(reviewWithFindings([{
        unitId: "sf-theme-tone",
        category: "story_core",
        severity: "minor",
        repairScope: "local",
        evidence: "Legacy theme.",
        suggestedAction: "Improved legacy theme.",
      }]) as never)
      .mockResolvedValueOnce(CLEAN_REVIEW);
    const result = await runFoundationPipeline(bookDir, { upgradeCandidateId: candidateId });
    expect(result.status).toBe("ready_for_human_review");
    if (result.status !== "ready_for_human_review") throw new Error("unexpected result");
    expect(await readRevisionUnitDraft(bookDir, result.revisionId, "sf-theme-tone")).toBe("Improved legacy theme.");
    await expect(loadUpgradeCandidate(bookDir, candidateId)).resolves.toBeTruthy();
  });

  it("fails closed when a persisted candidate's source content changed", async () => {
    const candidateId = await createLegacyCandidate();
    vi.spyOn(FoundationReviewerAgent.prototype, "review").mockResolvedValue(CLEAN_REVIEW);
    await writeFile(join(bookDir, "story", "outline", "story_frame.md"), "externally changed candidate source\n", "utf-8");
    const changedSource = await runFoundationPipeline(bookDir, { upgradeCandidateId: candidateId });
    expect(changedSource.status).toBe("generation_failed");
    expect(await exists(join(bookDir, "story", "revisions"))).toBe(false);
  });

  it("fails closed for missing or corrupt candidates before creating a revision", async () => {
    vi.spyOn(FoundationReviewerAgent.prototype, "review").mockResolvedValue(CLEAN_REVIEW);
    const missing = await runFoundationPipeline(bookDir, { upgradeCandidateId: "missing-candidate" });
    expect(missing.status).toBe("generation_failed");
    await mkdir(join(bookDir, "story", "foundation-v2-candidates"), { recursive: true });
    await writeFile(join(bookDir, "story", "foundation-v2-candidates", "corrupt.gov.json"), "{bad", "utf-8");
    const corrupt = await runFoundationPipeline(bookDir, { upgradeCandidateId: "corrupt" });
    expect(corrupt.status).toBe("generation_failed");
    expect(await exists(join(bookDir, "story", "revisions"))).toBe(false);
  });
});

describe("non-authority guarantees for every outcome", () => {
  it.each(["ready", "human", "failed"] as const)("%s outcome never approves, publishes, flips marker, or mutates Canon", async (mode) => {
    const bookBefore = await readFile(bookJsonPath, "utf-8");
    const canonBefore = await readFile(canonPath, "utf-8");
    const publish = vi.spyOn(publishModule, "publishFoundation");
    vi.spyOn(ArchitectAgent.prototype, "generateFoundation").mockResolvedValue(GENERATED);
    if (mode === "ready") {
      vi.spyOn(FoundationReviewerAgent.prototype, "review").mockResolvedValue(CLEAN_REVIEW);
    } else if (mode === "human") {
      vi.spyOn(FoundationReviewerAgent.prototype, "review").mockResolvedValue(
        reviewWithFindings([localFinding({ repairScope: "author_decision" })]) as never,
      );
    } else {
      vi.spyOn(FoundationReviewerAgent.prototype, "review").mockRejectedValue(new Error("review failed"));
    }
    const result = await runFoundationPipeline(bookDir);
    expect(["ready_for_human_review", "needs_human_direction", "generation_failed"]).toContain(result.status);
    expect(await createVersionStore(bookDir).readCurrentVersion("foundation", "foundation")).toBeNull();
    expect(await readFile(bookJsonPath, "utf-8")).toBe(bookBefore);
    expect(await readFile(canonPath, "utf-8")).toBe(canonBefore);
    expect(publish).not.toHaveBeenCalled();
    if ("revisionId" in result && result.revisionId) {
      const draft = await loadFoundationRevision(bookDir, result.revisionId);
      expect(draft.approvalRecords).toEqual([]);
      expect(draft.unitStates.every((unit) => unit.state !== "approved")).toBe(true);
    }
  });
});
