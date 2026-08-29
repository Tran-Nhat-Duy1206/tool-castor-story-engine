import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FoundationFindingCategorySchema,
  FoundationFindingSchema,
  applyBoundedFoundationRepair,
  reviewFoundationRevision,
  saveFoundationReviewFinding,
  verifyFoundationRepairs,
  type FoundationFinding,
} from "../foundation/review.js";
import { governedContentHash } from "../foundation/manifest.js";
import { loadFoundationFinding } from "../governance/conflicts.js";

let root = "";
let bookDir = "";

const UNIT_A = "sf-core-conflict";
const UNIT_B = "sf-world-setting";
const A_ORIGINAL = "Core premise.\nAlpha issue sentence.\nEnding direction.\n";
const A_REPAIRED = "Core premise.\nAlpha repaired sentence.\nEnding direction.\n";
const B_ORIGINAL = "World stays untouched.\n";
const PUBLISHED = "PUBLISHED FOUNDATION — immutable context.\n";

async function setupBook(): Promise<void> {
  root = await mkdtemp(join(tmpdir(), "castor-foundation-review-"));
  bookDir = join(root, "books", "review-book");
  await mkdir(join(bookDir, "story", "outline"), { recursive: true });
  await mkdir(join(bookDir, "story", "state"), { recursive: true });
  await writeFile(join(bookDir, "story", "outline", "story_frame.md"), PUBLISHED, "utf-8");
  await writeFile(
    join(bookDir, "story", "state", "manifest.json"),
    JSON.stringify({ schemaVersion: 2, language: "en", lastAppliedChapter: 7, projectionVersion: 1, migrationWarnings: [] }),
    "utf-8",
  );
}

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
  bookDir = "";
});

async function seedRevision(
  revisionId: string,
  units: ReadonlyArray<{ unitId: string; content: string; contentRevision?: number; state?: string; approvedRevision?: number }> = [
    { unitId: UNIT_A, content: A_ORIGINAL },
    { unitId: UNIT_B, content: B_ORIGINAL },
  ],
): Promise<void> {
  const dir = join(bookDir, "story", "revisions", revisionId);
  await mkdir(dir, { recursive: true });
  const unitStates = [];
  for (const unit of units) {
    await writeFile(join(dir, `${unit.unitId}.md`), unit.content, "utf-8");
    unitStates.push({
      unitId: unit.unitId,
      contentRevision: unit.contentRevision ?? 1,
      contentHash: governedContentHash(unit.content),
      ...(unit.state ? { state: unit.state } : {}),
      ...(unit.approvedRevision !== undefined ? { approvedRevision: unit.approvedRevision } : {}),
    });
  }
  await writeFile(join(dir, "draft.gov.json"), `${JSON.stringify({ revisionId, unitStates }, null, 2)}\n`, "utf-8");
}

function finding(overrides: Partial<FoundationFinding> = {}): FoundationFinding {
  return {
    findingId: "finding-a",
    revisionId: "rev-a",
    unitId: UNIT_A,
    contentRevision: 1,
    contentHash: governedContentHash(A_ORIGINAL),
    category: "story_core",
    severity: "minor",
    repairScope: "local",
    evidence: "Alpha issue sentence.",
    suggestedAction: "Alpha repaired sentence.",
    ...overrides,
  };
}

async function persist(value: FoundationFinding): Promise<void> {
  await saveFoundationReviewFinding(bookDir, value);
}

async function bytes(path: string): Promise<string> {
  return readFile(join(bookDir, path), "utf-8");
}

async function repairRecord(revisionId: string, round: number): Promise<Record<string, unknown>> {
  return JSON.parse(await bytes(`story/revisions/${revisionId}/repair-round-${round}.gov.json`)) as Record<string, unknown>;
}

describe("FoundationFinding contract + reviewFoundationRevision", () => {
  it("reviews the EXACT requested Revision Draft and returns its current bound findings", async () => {
    await setupBook();
    await seedRevision("rev-a");
    await persist(finding());
    const findings = await reviewFoundationRevision(bookDir, "rev-a");
    expect(findings).toEqual([finding()]);
  });

  it("keeps Revision A/B isolated — reviewing A neither reads nor returns B", async () => {
    await setupBook();
    await seedRevision("rev-a");
    await seedRevision("rev-b", [{ unitId: UNIT_A, content: "Revision B different content.\n" }]);
    await persist(finding());
    await persist(finding({
      findingId: "finding-b",
      revisionId: "rev-b",
      contentHash: governedContentHash("Revision B different content.\n"),
      evidence: "Revision B different content.",
      suggestedAction: "Revision B repaired content.",
    }));
    // Corrupt B after its finding was persisted. A review must remain unaffected.
    await writeFile(join(bookDir, "story", "revisions", "rev-b", `${UNIT_A}.md`), "B changed without state.\n", "utf-8");
    await expect(reviewFoundationRevision(bookDir, "rev-a")).resolves.toEqual([finding()]);
  });

  it("runtime-validates the finite Core-owned category vocabulary", async () => {
    expect(FoundationFindingCategorySchema.options).toEqual([
      "story_core", "character", "relationship", "world", "structure", "pacing_feasibility",
      "hook", "timeline", "book_rule", "dependency", "internal_consistency", "author_intent_alignment",
    ]);
    expect(() => FoundationFindingCategorySchema.parse("invented_by_ai")).toThrow();
    await setupBook();
    await seedRevision("rev-a");
    await expect(saveFoundationReviewFinding(bookDir, {
      ...finding(),
      category: "invented_by_ai",
    } as unknown as FoundationFinding)).rejects.toThrow();
  });

  it("runtime-validates finite severity and repairScope vocabularies", async () => {
    await setupBook();
    await seedRevision("rev-a");
    expect(() => FoundationFindingSchema.parse({ ...finding(), severity: "critical" })).toThrow();
    await expect(saveFoundationReviewFinding(bookDir, {
      ...finding(),
      severity: "critical",
    } as unknown as FoundationFinding)).rejects.toThrow();

    expect(() => FoundationFindingSchema.parse({ ...finding(), repairScope: "global" })).toThrow();
    await expect(saveFoundationReviewFinding(bookDir, {
      ...finding(),
      repairScope: "global",
    } as unknown as FoundationFinding)).rejects.toThrow();
  });

  it("enforces path-safe governance IDs and rejects directory traversal", async () => {
    await setupBook();
    await seedRevision("rev-a");
    await expect(reviewFoundationRevision(bookDir, "../escaped")).rejects.toThrow();
    await expect(saveFoundationReviewFinding(bookDir, {
      ...finding(),
      findingId: "../../escaped",
    })).rejects.toThrow();
    await expect(applyBoundedFoundationRepair(bookDir, "../escaped", [UNIT_A], [finding()], 1)).rejects.toThrow();
    await expect(applyBoundedFoundationRepair(bookDir, "rev-a", ["../escaped-unit"], [finding()], 1)).rejects.toThrow();
  });

  it("binds every finding to revisionId + unitId + exact contentRevision/hash", async () => {
    await setupBook();
    await seedRevision("rev-a");
    await persist(finding());
    const [loaded] = await reviewFoundationRevision(bookDir, "rev-a");
    expect(loaded).toMatchObject({
      revisionId: "rev-a",
      unitId: UNIT_A,
      contentRevision: 1,
      contentHash: governedContentHash(A_ORIGINAL),
    });
  });
});

describe("applyBoundedFoundationRepair policy", () => {
  for (const policyFinding of [
    { label: "BLOCKING", severity: "blocking" as const, repairScope: "local" as const },
    { label: "MULTI_UNIT", severity: "minor" as const, repairScope: "multi_unit" as const },
    { label: "AUTHOR_DECISION", severity: "minor" as const, repairScope: "author_decision" as const },
  ]) {
    it(`rejects a caller subset that omits a current ${policyFinding.label} finding on the same target unit`, async () => {
      await setupBook();
      await seedRevision("rev-a");
      const local = finding({ findingId: "minor-a" });
      const protectedFinding = finding({
        findingId: `protected-${policyFinding.repairScope}-${policyFinding.severity}`,
        severity: policyFinding.severity,
        repairScope: policyFinding.repairScope,
        evidence: "Core premise.",
        suggestedAction: "Changed core premise.",
      });
      await persist(local);
      await persist(protectedFinding);
      const before = await bytes(`story/revisions/rev-a/${UNIT_A}.md`);
      await expect(applyBoundedFoundationRepair(bookDir, "rev-a", [UNIT_A], [local], 1)).rejects.toThrow(/omitted current findings/i);
      expect(await bytes(`story/revisions/rev-a/${UNIT_A}.md`)).toBe(before);
      expect((await reviewFoundationRevision(bookDir, "rev-a")).map((item) => item.findingId).sort())
        .toEqual([local.findingId, protectedFinding.findingId].sort());
    });
  }

  it("does not repair any finding on a unit that has a coexisting Human-routed finding", async () => {
    await setupBook();
    await seedRevision("rev-a");
    const local = finding({ findingId: "minor-a" });
    const blocker = finding({
      findingId: "blocker-a",
      severity: "blocking",
      evidence: "Core premise.",
      suggestedAction: "Changed core premise.",
    });
    await persist(local);
    await persist(blocker);
    const result = await applyBoundedFoundationRepair(bookDir, "rev-a", [UNIT_A], [local, blocker], 1);
    expect(result).toEqual({ status: "needs_human_direction", round: 1, remaining: [local, blocker] });
    expect(await bytes(`story/revisions/rev-a/${UNIT_A}.md`)).toBe(A_ORIGINAL);
  });

  it("REJECTS a stale finding after the draft changed", async () => {
    await setupBook();
    await seedRevision("rev-a");
    const old = finding();
    await persist(old);
    await seedRevision("rev-a", [
      { unitId: UNIT_A, content: "Edited after finding.\n", contentRevision: 2 },
      { unitId: UNIT_B, content: B_ORIGINAL },
    ]);
    await expect(applyBoundedFoundationRepair(bookDir, "rev-a", [UNIT_A], [old], 1)).rejects.toThrow(/stale|changed/i);
  });

  it("allows MINOR + LOCAL repair and writes only the requested revision unit", async () => {
    await setupBook();
    await seedRevision("rev-a");
    const item = finding();
    await persist(item);
    await expect(applyBoundedFoundationRepair(bookDir, "rev-a", [UNIT_A], [item], 1))
      .resolves.toEqual({ status: "repaired", round: 1 });
    expect(await bytes(`story/revisions/rev-a/${UNIT_A}.md`)).toBe(A_REPAIRED);
  });

  it("allows IMPORTANT + LOCAL but persists mandatory targeted re-review as pending", async () => {
    await setupBook();
    await seedRevision("rev-a");
    const item = finding({ severity: "important" });
    await persist(item);
    await applyBoundedFoundationRepair(bookDir, "rev-a", [UNIT_A], [item], 1);
    expect(await repairRecord("rev-a", 1)).toMatchObject({
      status: "pending_verification",
      importantFindingIds: [item.findingId],
    });
    await expect(verifyFoundationRepairs(bookDir, "rev-a", [UNIT_A], [item], 1)).resolves.toEqual([]);
    expect(await repairRecord("rev-a", 1)).toMatchObject({ status: "verified" });
  });

  it("NEVER silently repairs MULTI_UNIT findings", async () => {
    await setupBook();
    await seedRevision("rev-a");
    const item = finding({ repairScope: "multi_unit" });
    await persist(item);
    const before = await bytes(`story/revisions/rev-a/${UNIT_A}.md`);
    const result = await applyBoundedFoundationRepair(bookDir, "rev-a", [UNIT_A], [item], 1);
    expect(result).toEqual({ status: "needs_human_direction", round: 1, remaining: [item] });
    expect(await bytes(`story/revisions/rev-a/${UNIT_A}.md`)).toBe(before);
  });

  it("routes AUTHOR_DECISION to Human without repair", async () => {
    await setupBook();
    await seedRevision("rev-a");
    const item = finding({ repairScope: "author_decision" });
    await persist(item);
    const result = await applyBoundedFoundationRepair(bookDir, "rev-a", [UNIT_A], [item], 1);
    expect(result).toEqual({ status: "needs_human_direction", round: 1, remaining: [item] });
    expect(await bytes(`story/revisions/rev-a/${UNIT_A}.md`)).toBe(A_ORIGINAL);
  });

  it("leaves unresolved BLOCKING findings Publish-blocking", async () => {
    await setupBook();
    await seedRevision("rev-a");
    const item = finding({ severity: "blocking" });
    await persist(item);
    const result = await applyBoundedFoundationRepair(bookDir, "rev-a", [UNIT_A], [item], 1);
    expect(result).toEqual({ status: "needs_human_direction", round: 1, remaining: [item] });
  });

  it("allows semantic repair round 1", async () => {
    await setupBook();
    await seedRevision("rev-a");
    const item = finding();
    await persist(item);
    await expect(applyBoundedFoundationRepair(bookDir, "rev-a", [UNIT_A], [item], 1))
      .resolves.toEqual({ status: "repaired", round: 1 });
  });

  it("allows semantic repair round 2 only after separate round-1 verification", async () => {
    await setupBook();
    await seedRevision("rev-a");
    const first = finding();
    await persist(first);
    await applyBoundedFoundationRepair(bookDir, "rev-a", [UNIT_A], [first], 1);
    await verifyFoundationRepairs(bookDir, "rev-a", [UNIT_A], [first], 1);
    const second = finding({
      findingId: "finding-round2",
      contentRevision: 2,
      contentHash: governedContentHash(A_REPAIRED),
      evidence: "Core premise.",
      suggestedAction: "Core premise improved.",
    });
    await persist(second);
    await expect(applyBoundedFoundationRepair(bookDir, "rev-a", [UNIT_A], [second], 2))
      .resolves.toEqual({ status: "repaired", round: 2 });
  });

  it("refuses round 2 while round 1 still awaits separate verification", async () => {
    await setupBook();
    await seedRevision("rev-a");
    const first = finding();
    await persist(first);
    await applyBoundedFoundationRepair(bookDir, "rev-a", [UNIT_A], [first], 1);
    const second = finding({
      findingId: "finding-round2",
      contentRevision: 2,
      contentHash: governedContentHash(A_REPAIRED),
      evidence: "Core premise.",
      suggestedAction: "Core premise improved.",
    });
    await persist(second);
    await expect(applyBoundedFoundationRepair(bookDir, "rev-a", [UNIT_A], [second], 2)).rejects.toThrow(/verified round 1|verification/i);
  });

  it("enforces the 2-round cap — round >2 creates no hidden third repair", async () => {
    await setupBook();
    await seedRevision("rev-a");
    const item = finding();
    await persist(item);
    const before = await bytes(`story/revisions/rev-a/${UNIT_A}.md`);
    const result = await applyBoundedFoundationRepair(bookDir, "rev-a", [UNIT_A], [item], 3);
    expect(result).toEqual({ status: "needs_human_direction", round: 3, remaining: [item] });
    expect(await bytes(`story/revisions/rev-a/${UNIT_A}.md`)).toBe(before);
  });

  it("makes each semantic round single-use so round 1 cannot be replayed indefinitely", async () => {
    await setupBook();
    await seedRevision("rev-a");
    const item = finding();
    await persist(item);
    await applyBoundedFoundationRepair(bookDir, "rev-a", [UNIT_A], [item], 1);
    await expect(applyBoundedFoundationRepair(bookDir, "rev-a", [UNIT_A], [item], 1)).rejects.toThrow(/already used|hidden retry/i);
  });

  it("enforces LOCAL write scope — sibling unit B remains byte-identical", async () => {
    await setupBook();
    await seedRevision("rev-a");
    const item = finding();
    await persist(item);
    const siblingBefore = await bytes(`story/revisions/rev-a/${UNIT_B}.md`);
    await applyBoundedFoundationRepair(bookDir, "rev-a", [UNIT_A], [item], 1);
    expect(await bytes(`story/revisions/rev-a/${UNIT_B}.md`)).toBe(siblingBefore);
  });

  it("enforces Revision A/B write isolation — repair A never writes B", async () => {
    await setupBook();
    await seedRevision("rev-a");
    await seedRevision("rev-b", [{ unitId: UNIT_A, content: "Revision B content.\n" }]);
    const item = finding();
    await persist(item);
    const beforeB = await bytes(`story/revisions/rev-b/${UNIT_A}.md`);
    await applyBoundedFoundationRepair(bookDir, "rev-a", [UNIT_A], [item], 1);
    expect(await bytes(`story/revisions/rev-b/${UNIT_A}.md`)).toBe(beforeB);
  });

  it("cannot modify a unit with approval-shaped state and never creates approval fields", async () => {
    await setupBook();
    await seedRevision("rev-a", [
      { unitId: UNIT_A, content: A_ORIGINAL, state: "approved", approvedRevision: 1 },
      { unitId: UNIT_B, content: B_ORIGINAL },
    ]);
    const item = finding();
    await persist(item);
    const result = await applyBoundedFoundationRepair(bookDir, "rev-a", [UNIT_A], [item], 1);
    expect(result.status).toBe("needs_human_direction");
    const state = JSON.parse(await bytes("story/revisions/rev-a/draft.gov.json")) as Record<string, unknown>;
    expect(JSON.stringify(state)).not.toContain("approvalRecords");
    expect(await bytes(`story/revisions/rev-a/${UNIT_A}.md`)).toBe(A_ORIGINAL);
  });

  it("rejects fabricated finding that is not persisted on disk", async () => {
    await setupBook();
    await seedRevision("rev-a");
    const fabricated = finding({ findingId: "fabricated-id" });
    await expect(applyBoundedFoundationRepair(bookDir, "rev-a", [UNIT_A], [fabricated], 1)).rejects.toThrow();
  });

  it("rejects caller finding that tampers with persisted state (evidence/suggestion/severity)", async () => {
    await setupBook();
    await seedRevision("rev-a");
    const item = finding();
    await persist(item);
    const tampered = { ...item, suggestedAction: "Tampered suggested action." };
    await expect(applyBoundedFoundationRepair(bookDir, "rev-a", [UNIT_A], [tampered], 1))
      .rejects.toThrow(/does not match trusted persisted state/i);
  });

  it("rejects caller finding targeting a different revision", async () => {
    await setupBook();
    await seedRevision("rev-a");
    const item = finding({ revisionId: "rev-other" });
    await expect(applyBoundedFoundationRepair(bookDir, "rev-a", [UNIT_A], [item], 1))
      .rejects.toThrow(/belongs to revision rev-other, not rev-a/i);
  });

  it("rejects finding targeting a unit outside requested LOCAL targets", async () => {
    await setupBook();
    await seedRevision("rev-a");
    const item = finding({ unitId: UNIT_B, evidence: "World stays untouched.", suggestedAction: "World setting repaired." });
    await persist(item);
    await expect(applyBoundedFoundationRepair(bookDir, "rev-a", [UNIT_A], [item], 1))
      .rejects.toThrow(/outside requested LOCAL targets/i);
  });

  it("safely handles missing evidence in draft without modifying content", async () => {
    await setupBook();
    await seedRevision("rev-a");
    const item = finding({ evidence: "Non-existent excerpt that is absent from draft." });
    await persist(item);
    const result = await applyBoundedFoundationRepair(bookDir, "rev-a", [UNIT_A], [item], 1);
    expect(result).toEqual({ status: "needs_human_direction", round: 1, remaining: [item] });
    expect(await bytes(`story/revisions/rev-a/${UNIT_A}.md`)).toBe(A_ORIGINAL);
  });

  it("safely handles ambiguous evidence occurring multiple times without modifying content", async () => {
    await setupBook();
    const ambiguousContent = "Repeated phrase here.\nMiddle text.\nRepeated phrase here.\n";
    await seedRevision("rev-a", [{ unitId: UNIT_A, content: ambiguousContent }]);
    const item = finding({
      contentHash: governedContentHash(ambiguousContent),
      evidence: "Repeated phrase here.",
      suggestedAction: "Single repaired phrase.",
    });
    await persist(item);
    const result = await applyBoundedFoundationRepair(bookDir, "rev-a", [UNIT_A], [item], 1);
    expect(result).toEqual({ status: "needs_human_direction", round: 1, remaining: [item] });
    expect(await bytes(`story/revisions/rev-a/${UNIT_A}.md`)).toBe(ambiguousContent);
  });

  it("safely handles no-op suggested action equal to evidence without modifying content", async () => {
    await setupBook();
    await seedRevision("rev-a");
    const item = finding({ suggestedAction: "Alpha issue sentence." });
    await persist(item);
    const result = await applyBoundedFoundationRepair(bookDir, "rev-a", [UNIT_A], [item], 1);
    expect(result).toEqual({ status: "needs_human_direction", round: 1, remaining: [item] });
    expect(await bytes(`story/revisions/rev-a/${UNIT_A}.md`)).toBe(A_ORIGINAL);
  });

  it("successfully applies and verifies multiple valid repairs on the same unit", async () => {
    await setupBook();
    const multiContent = "First sentence to fix.\nMiddle paragraph.\nSecond sentence to fix.\n";
    await seedRevision("rev-a", [{ unitId: UNIT_A, content: multiContent }]);
    const f1 = finding({
      findingId: "f1",
      contentHash: governedContentHash(multiContent),
      evidence: "First sentence to fix.",
      suggestedAction: "First sentence fixed.",
    });
    const f2 = finding({
      findingId: "f2",
      contentHash: governedContentHash(multiContent),
      evidence: "Second sentence to fix.",
      suggestedAction: "Second sentence fixed.",
    });
    await persist(f1);
    await persist(f2);
    const outcome = await applyBoundedFoundationRepair(bookDir, "rev-a", [UNIT_A], [f1, f2], 1);
    expect(outcome).toEqual({ status: "repaired", round: 1 });
    expect(await bytes(`story/revisions/rev-a/${UNIT_A}.md`)).toBe(
      "First sentence fixed.\nMiddle paragraph.\nSecond sentence fixed.\n",
    );
    const remaining = await verifyFoundationRepairs(bookDir, "rev-a", [UNIT_A], [f1, f2], 1);
    expect(remaining).toEqual([]);
    expect(await repairRecord("rev-a", 1)).toMatchObject({ status: "verified" });
  });

  it("correctly handles replacement text containing special patterns like $& and $1", async () => {
    await setupBook();
    await seedRevision("rev-a");
    const item = finding({
      evidence: "Alpha issue sentence.",
      suggestedAction: "Price was $100 and value was $& intact.",
    });
    await persist(item);
    const outcome = await applyBoundedFoundationRepair(bookDir, "rev-a", [UNIT_A], [item], 1);
    expect(outcome).toEqual({ status: "repaired", round: 1 });
    expect(await bytes(`story/revisions/rev-a/${UNIT_A}.md`)).toBe(
      "Core premise.\nPrice was $100 and value was $& intact.\nEnding direction.\n",
    );
    const remaining = await verifyFoundationRepairs(bookDir, "rev-a", [UNIT_A], [item], 1);
    expect(remaining).toEqual([]);
  });
});

describe("separate verification", () => {
  it("repair cannot self-certify; verifyFoundationRepairs is a separate current-draft read", async () => {
    await setupBook();
    await seedRevision("rev-a");
    const item = finding({ severity: "important" });
    await persist(item);
    await applyBoundedFoundationRepair(bookDir, "rev-a", [UNIT_A], [item], 1);
    expect(await repairRecord("rev-a", 1)).toMatchObject({ status: "pending_verification" });
    // Sabotage the repaired output before verification while RETAINING the
    // suggested replacement. A weak string-only verifier would falsely pass;
    // exact post-repair revision/hash verification must reject it.
    const sabotaged = `${A_REPAIRED}Unrelated sabotage retained the suggestion.\n`;
    await writeFile(join(bookDir, "story", "revisions", "rev-a", `${UNIT_A}.md`), sabotaged, "utf-8");
    const raw = JSON.parse(await bytes("story/revisions/rev-a/draft.gov.json")) as {
      revisionId: string;
      unitStates: Array<{ unitId: string; contentRevision: number; contentHash: string }>;
    };
    raw.unitStates[0]!.contentRevision = 3;
    raw.unitStates[0]!.contentHash = governedContentHash(sabotaged);
    await writeFile(join(bookDir, "story", "revisions", "rev-a", "draft.gov.json"), JSON.stringify(raw, null, 2), "utf-8");
    const remaining = await verifyFoundationRepairs(bookDir, "rev-a", [UNIT_A], [item], 1);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.evidence).toBe(item.evidence);
    expect(await repairRecord("rev-a", 1)).toMatchObject({ status: "pending_verification" });
  });

  it("refuses verification when no separate pending repair invocation exists", async () => {
    await setupBook();
    await seedRevision("rev-a");
    const item = finding();
    await persist(item);
    await expect(verifyFoundationRepairs(bookDir, "rev-a", [UNIT_A], [item], 1)).rejects.toThrow();
  });
});

describe("authority immutability + Task 6 compatibility", () => {
  it("keeps Published Foundation and Canon byte-identical", async () => {
    await setupBook();
    await seedRevision("rev-a");
    const item = finding();
    await persist(item);
    const publishedBefore = await bytes("story/outline/story_frame.md");
    const canonBefore = await bytes("story/state/manifest.json");
    await reviewFoundationRevision(bookDir, "rev-a");
    await applyBoundedFoundationRepair(bookDir, "rev-a", [UNIT_A], [item], 1);
    expect(await bytes("story/outline/story_frame.md")).toBe(publishedBefore);
    expect(await bytes("story/state/manifest.json")).toBe(canonBefore);
  });

  it("persists a Task 7 superset finding that Task 6 can still read", async () => {
    await setupBook();
    await seedRevision("rev-a");
    const item = finding();
    await persist(item);
    const task6View = await loadFoundationFinding(bookDir, item.revisionId, item.findingId);
    expect(task6View).toMatchObject({
      findingId: item.findingId,
      revisionId: item.revisionId,
      unitId: item.unitId,
      contentRevision: item.contentRevision,
      contentHash: item.contentHash,
      evidence: [{ source: "foundation-reviewer", detail: item.evidence }],
    });
  });
});
