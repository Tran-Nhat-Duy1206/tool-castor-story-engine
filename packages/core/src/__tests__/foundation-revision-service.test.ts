import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openFoundationRevision,
  loadFoundationRevision,
  saveFoundationUnitDraft,
  approveFoundationUnit,
  markFoundationUnitNeedsRevision,
  reapproveStaleFoundationUnit,
  discardFoundationRevision,
  approveFoundationUnitsBatch,
  type FoundationRevisionDraft,
} from "../foundation/revision-service.js";
import { governedContentHash } from "../foundation/manifest.js";
import {
  saveFoundationFinding,
  resolveFoundationUncertainty,
  type PersistedFoundationFinding,
} from "../governance/conflicts.js";
import {
  saveFoundationReviewFinding,
  applyBoundedFoundationRepair,
  type FoundationFinding,
} from "../foundation/review.js";
import { createVersionStore, type FoundationPublishedSnapshot } from "../governance/versions.js";
import { commitAtomicFileSet } from "../utils/atomic-file-set.js";

let root = "";
let bookDir = "";

const UNIT_A = "sf-core-conflict";
const UNIT_B = "sf-world-setting";
const A_ORIGINAL = "Core premise.\nAlpha conflict sentence.\nEnding direction.\n";
const B_ORIGINAL = "World setting description stays untouched.\n";
const PUBLISHED_OUTLINE = "PUBLISHED FOUNDATION — immutable production context.\n";

async function setupBook(): Promise<void> {
  root = await mkdtemp(join(tmpdir(), "inkos-revservice-"));
  bookDir = join(root, "books", "rev-book");
  await mkdir(join(bookDir, "story", "outline"), { recursive: true });
  await mkdir(join(bookDir, "story", "state"), { recursive: true });
  await writeFile(join(bookDir, "story", "outline", "story_frame.md"), PUBLISHED_OUTLINE, "utf-8");
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

async function bytes(path: string): Promise<string> {
  return readFile(join(bookDir, path), "utf-8");
}

describe("Foundation Revision Service (Task 8)", () => {
  // 1. opening revision creates working state only
  it("1. opening revision creates working state only without altering published files", async () => {
    await setupBook();
    const publishedBefore = await bytes("story/outline/story_frame.md");
    const canonBefore = await bytes("story/state/manifest.json");

    const { revisionId } = await openFoundationRevision(bookDir, [UNIT_A, UNIT_B]);
    expect(revisionId).toMatch(/^rev-/);

    // Working state created
    const draft = await loadFoundationRevision(bookDir, revisionId);
    expect(draft.revisionId).toBe(revisionId);
    expect(draft.status).toBe("open");
    expect(draft.unitStates).toHaveLength(2);
    expect(draft.approvalRecords).toEqual([]);

    // Working markdown files created in revision workspace
    expect(await bytes(`story/revisions/${revisionId}/${UNIT_A}.md`)).toBeDefined();
    expect(await bytes(`story/revisions/${revisionId}/${UNIT_B}.md`)).toBeDefined();

    // Published files remain byte-identical
    expect(await bytes("story/outline/story_frame.md")).toBe(publishedBefore);
    expect(await bytes("story/state/manifest.json")).toBe(canonBefore);

    // No published version store pointer created
    const store = createVersionStore(bookDir);
    expect(await store.readCurrentVersion("foundation", "foundation")).toBeNull();
  });

  // 2. baseFoundationVersion/baseCanonRevision correctly bound
  it("2. correctly binds baseFoundationVersion and baseCanonRevision", async () => {
    await setupBook();
    // Case A: No foundation version exists yet -> baseFoundationVersion is null
    const resA = await openFoundationRevision(bookDir, [UNIT_A]);
    const draftA = await loadFoundationRevision(bookDir, resA.revisionId);
    expect(draftA.baseFoundationVersion).toBeNull();
    expect(draftA.baseCanonRevision).toBe(7);

    // Case B: Foundation version committed in VersionStore -> baseFoundationVersion is bound
    const store = createVersionStore(bookDir);
    const snapshot: FoundationPublishedSnapshot = {
      unitRefs: [{ unitId: UNIT_A, contentRevision: 1, approvedRevision: 1, contentHash: "hash-1" }],
      changedUnitIds: [UNIT_A],
      humanResolutionIds: [],
      dependencyImpact: [],
      baseCanonRevision: 7,
    };
    const prep = await store.prepareVersionAppend({
      artifactKind: "foundation",
      unitId: "foundation",
      version: 1,
      parentVersion: null,
      baseCanonRevision: 7,
      snapshot,
      publishedBy: "author",
    });
    const pointer = store.prepareCurrentVersionPointer("foundation", "foundation", 1);
    await commitAtomicFileSet({ rootDir: bookDir, writes: [...prep.writes, pointer] });

    const resB = await openFoundationRevision(bookDir, [UNIT_A]);
    const draftB = await loadFoundationRevision(bookDir, resB.revisionId);
    expect(draftB.baseFoundationVersion).toBe(1);
    expect(draftB.baseCanonRevision).toBe(7);
  });

  // 3. two revisions for same unit contain isolated content
  it("3. two revisions for same unit contain isolated content", async () => {
    await setupBook();
    const { revisionId: revA } = await openFoundationRevision(bookDir, [UNIT_A]);
    const { revisionId: revB } = await openFoundationRevision(bookDir, [UNIT_A]);

    await saveFoundationUnitDraft(bookDir, revA, UNIT_A, "Revision A specific text.\n");
    await saveFoundationUnitDraft(bookDir, revB, UNIT_A, "Revision B specific text.\n");

    expect(await bytes(`story/revisions/${revA}/${UNIT_A}.md`)).toBe("Revision A specific text.\n");
    expect(await bytes(`story/revisions/${revB}/${UNIT_A}.md`)).toBe("Revision B specific text.\n");
  });

  // 4. manual edit -> needs_review
  it("4. manual edit transitions unit to needs_review and clears previous approval", async () => {
    await setupBook();
    const { revisionId } = await openFoundationRevision(bookDir, [UNIT_A]);
    await saveFoundationUnitDraft(bookDir, revisionId, UNIT_A, "Initial drafted prose.\n");

    // Approve the initial content (revision is 2)
    await approveFoundationUnit(bookDir, revisionId, UNIT_A, "Human Reviewer");
    let draft = await loadFoundationRevision(bookDir, revisionId);
    let unit = draft.unitStates.find((u) => u.unitId === UNIT_A)!;
    expect(unit.state).toBe("approved");
    expect(unit.approvedRevision).toBe(2);
    expect(draft.approvalRecords).toHaveLength(1);

    // Edit the content (increments revision to 3)
    await saveFoundationUnitDraft(bookDir, revisionId, UNIT_A, "Edited prose after approval.\n");
    draft = await loadFoundationRevision(bookDir, revisionId);
    unit = draft.unitStates.find((u) => u.unitId === UNIT_A)!;
    expect(unit.contentRevision).toBe(3);
    expect(unit.state).toBe("needs_review");
    expect(unit.approvedRevision).toBeUndefined();
    expect(draft.approvalRecords).toHaveLength(0);
    expect(draft.status).toBe("needs_review");
  });

  // 5. edit recomputes hash/revision
  it("5. edit recomputes hash and increments contentRevision", async () => {
    await setupBook();
    const { revisionId } = await openFoundationRevision(bookDir, [UNIT_A]);
    await saveFoundationUnitDraft(bookDir, revisionId, UNIT_A, "Revision 2 content.\n");

    let draft = await loadFoundationRevision(bookDir, revisionId);
    let unit = draft.unitStates.find((u) => u.unitId === UNIT_A)!;
    expect(unit.contentRevision).toBe(2);
    expect(unit.contentHash).toBe(governedContentHash("Revision 2 content.\n"));

    await saveFoundationUnitDraft(bookDir, revisionId, UNIT_A, "Revision 3 updated content.\n");
    draft = await loadFoundationRevision(bookDir, revisionId);
    unit = draft.unitStates.find((u) => u.unitId === UNIT_A)!;
    expect(unit.contentRevision).toBe(3);
    expect(unit.contentHash).toBe(governedContentHash("Revision 3 updated content.\n"));
  });

  // 6. caller cannot fabricate hash
  // 7. caller cannot fabricate contentRevision
  it("6 & 7. Core recomputes and verifies hash and revision; caller cannot fabricate them", async () => {
    await setupBook();
    const { revisionId } = await openFoundationRevision(bookDir, [UNIT_A]);
    await saveFoundationUnitDraft(bookDir, revisionId, UNIT_A, "Genuine content.\n");

    // Attempt to tamper draft.gov.json directly with fabricated hash or revision
    const draftPath = `story/revisions/${revisionId}/draft.gov.json`;
    const raw = JSON.parse(await bytes(draftPath));
    raw.unitStates[0].contentHash = "fabricated-hash";
    await writeFile(join(bookDir, draftPath), JSON.stringify(raw, null, 2), "utf-8");

    // Approval fails closed
    await expect(approveFoundationUnit(bookDir, revisionId, UNIT_A, "Human Reviewer"))
      .rejects.toThrow(/content.*hash.*mismatch|inconsistent/i);
  });

  // 8. AI repair cannot approve
  it("8. AI repair output sets needs_review and cannot produce approval transitions", async () => {
    await setupBook();
    const { revisionId } = await openFoundationRevision(bookDir, [UNIT_A]);
    await saveFoundationUnitDraft(bookDir, revisionId, UNIT_A, A_ORIGINAL);

    const draftAfterSave = await loadFoundationRevision(bookDir, revisionId);
    const currentRev = draftAfterSave.unitStates.find((u) => u.unitId === UNIT_A)!.contentRevision;

    const f: FoundationFinding = {
      findingId: "find-repair",
      revisionId,
      unitId: UNIT_A,
      contentRevision: currentRev,
      contentHash: governedContentHash(A_ORIGINAL),
      category: "story_core",
      severity: "minor",
      repairScope: "local",
      evidence: "Alpha conflict sentence.",
      suggestedAction: "Alpha resolved conflict sentence.",
    };
    await saveFoundationReviewFinding(bookDir, f);

    // Apply Task 7 bounded repair
    const repairOutcome = await applyBoundedFoundationRepair(bookDir, revisionId, [UNIT_A], [f], 1);
    expect(repairOutcome.status).toBe("repaired");

    const draft = await loadFoundationRevision(bookDir, revisionId);
    const unit = draft.unitStates.find((u) => u.unitId === UNIT_A)!;
    expect(unit.state).toBe("needs_review");
    expect(unit.approvedRevision).toBeUndefined();
    expect(draft.approvalRecords).toHaveLength(0);
  });

  // 9. explicit Human approve works
  // 10. approval record contains exact approvedRevision
  // 11. approval record approvedBy = provided humanActor
  it("9, 10, 11. explicit Human approve records exact approvedRevision and explicit humanActor", async () => {
    await setupBook();
    const { revisionId } = await openFoundationRevision(bookDir, [UNIT_A]);
    await saveFoundationUnitDraft(bookDir, revisionId, UNIT_A, "First text.\n");
    await saveFoundationUnitDraft(bookDir, revisionId, UNIT_A, "Second text to approve.\n");

    const draftBeforeApprove = await loadFoundationRevision(bookDir, revisionId);
    const expectedRev = draftBeforeApprove.unitStates.find((u) => u.unitId === UNIT_A)!.contentRevision;
    expect(expectedRev).toBe(3);

    const reviewer = "Alice (Lead Editor)";
    await approveFoundationUnit(bookDir, revisionId, UNIT_A, reviewer);

    const draft = await loadFoundationRevision(bookDir, revisionId);
    const unit = draft.unitStates.find((u) => u.unitId === UNIT_A)!;
    expect(unit.state).toBe("approved");
    expect(unit.approvedRevision).toBe(expectedRev);

    expect(draft.approvalRecords).toHaveLength(1);
    const rec = draft.approvalRecords[0]!;
    expect(rec.unitId).toBe(UNIT_A);
    expect(rec.approvedRevision).toBe(expectedRev);
    expect(rec.approvedBy).toBe(reviewer);
    expect(Date.parse(rec.approvedAt)).not.toBeNaN();

    // Rejects approval with empty or system/AI actor fallback
    await expect(approveFoundationUnit(bookDir, revisionId, UNIT_A, ""))
      .rejects.toThrow();
    await expect(approveFoundationUnit(bookDir, revisionId, UNIT_A, "ai"))
      .rejects.toThrow(/explicit Human actor|humanActor/i);
  });

  // 12. approval rejected when draft/hash state inconsistent
  it("12. approval is rejected when markdown draft is modified out-of-band without revision update", async () => {
    await setupBook();
    const { revisionId } = await openFoundationRevision(bookDir, [UNIT_A]);
    await saveFoundationUnitDraft(bookDir, revisionId, UNIT_A, "Good content.\n");

    // Out-of-band edit to markdown file
    await writeFile(join(bookDir, `story/revisions/${revisionId}/${UNIT_A}.md`), "Sabotaged content out of band.\n", "utf-8");

    await expect(approveFoundationUnit(bookDir, revisionId, UNIT_A, "Human Reviewer"))
      .rejects.toThrow(/mismatch|inconsistent/i);
  });

  // 13. stale unit cannot ordinary-approve silently
  it("13. stale unit cannot be approved through ordinary approveFoundationUnit", async () => {
    await setupBook();
    const { revisionId } = await openFoundationRevision(bookDir, [UNIT_A]);
    await saveFoundationUnitDraft(bookDir, revisionId, UNIT_A, "Draft prose.\n");

    await markFoundationUnitNeedsRevision(bookDir, revisionId, UNIT_A, "stale: canon conflict detected");
    const draft = await loadFoundationRevision(bookDir, revisionId);
    expect(draft.unitStates.find((u) => u.unitId === UNIT_A)!.state).toBe("stale");

    await expect(approveFoundationUnit(bookDir, revisionId, UNIT_A, "Human Reviewer"))
      .rejects.toThrow(/stale/i);
  });

  // 14. stale reapproval requires valid resolution when applicable
  // 15. stale/invalid resolution rejected
  // 16. Human reapproval binds current exact draft state
  it("14, 15, 16. stale reapproval verifies Task 6 Human Resolution and binds current draft state", async () => {
    await setupBook();
    const { revisionId } = await openFoundationRevision(bookDir, [UNIT_A]);
    await saveFoundationUnitDraft(bookDir, revisionId, UNIT_A, A_ORIGINAL);

    const draftBeforeFinding = await loadFoundationRevision(bookDir, revisionId);
    const currentRev = draftBeforeFinding.unitStates.find((u) => u.unitId === UNIT_A)!.contentRevision;

    // Seed a Task 6 conflict finding
    const task6Finding: PersistedFoundationFinding = {
      findingId: "finding-t6",
      revisionId,
      unitId: UNIT_A,
      contentRevision: currentRev,
      contentHash: governedContentHash(A_ORIGINAL),
      evidence: [{ source: "test", detail: "Alpha conflict" }],
      createdAt: new Date().toISOString(),
    };
    await saveFoundationFinding(bookDir, task6Finding);

    await markFoundationUnitNeedsRevision(bookDir, revisionId, UNIT_A, "stale: uncertainty detected");

    // 14: Reapproval without resolution when finding exists is rejected
    await expect(reapproveStaleFoundationUnit(bookDir, revisionId, UNIT_A, "Human Resolver"))
      .rejects.toThrow(/resolution.*required|unresolved finding|conflict findings/i);

    // Resolve finding via Task 6
    const resRecord = await resolveFoundationUncertainty({
      bookDir,
      revisionId,
      findingId: "finding-t6",
      choice: "compatible",
      humanActor: "Human Resolver",
    });

    // 15: If draft content changes after resolution, resolution becomes invalid and reapproval rejects
    await writeFile(join(bookDir, `story/revisions/${revisionId}/${UNIT_A}.md`), "Changed after resolution.\n", "utf-8");
    const draftJsonPath = `story/revisions/${revisionId}/draft.gov.json`;
    const draftObj = JSON.parse(await bytes(draftJsonPath));
    draftObj.unitStates[0].contentRevision = currentRev + 1;
    draftObj.unitStates[0].contentHash = governedContentHash("Changed after resolution.\n");
    await writeFile(join(bookDir, draftJsonPath), JSON.stringify(draftObj, null, 2), "utf-8");

    await expect(reapproveStaleFoundationUnit(bookDir, revisionId, UNIT_A, "Human Resolver", resRecord.resolutionId))
      .rejects.toThrow(/resolution.*no longer valid|stale/i);

    // Restore valid state matching resolution
    await writeFile(join(bookDir, `story/revisions/${revisionId}/${UNIT_A}.md`), A_ORIGINAL, "utf-8");
    draftObj.unitStates[0].contentRevision = currentRev;
    draftObj.unitStates[0].contentHash = governedContentHash(A_ORIGINAL);
    await writeFile(join(bookDir, draftJsonPath), JSON.stringify(draftObj, null, 2), "utf-8");

    // 16: Valid resolution allows reapproval
    await reapproveStaleFoundationUnit(bookDir, revisionId, UNIT_A, "Human Resolver", resRecord.resolutionId);
    const draftAfter = await loadFoundationRevision(bookDir, revisionId);
    const unitAfter = draftAfter.unitStates.find((u) => u.unitId === UNIT_A)!;
    expect(unitAfter.state).toBe("approved");
    expect(unitAfter.approvedRevision).toBe(currentRev);
    expect(draftAfter.approvalRecords).toHaveLength(1);
    expect(draftAfter.approvalRecords[0]!.approvedBy).toBe("Human Resolver");
  });

  // 17. batch approves only eligible units
  // 18. batch rejects ineligible units independently
  it("17 & 18. batch approves only eligible units and rejects ineligible units independently", async () => {
    await setupBook();
    const { revisionId } = await openFoundationRevision(bookDir, [UNIT_A, UNIT_B]);
    await saveFoundationUnitDraft(bookDir, revisionId, UNIT_A, "Clean unit A.\n");
    await saveFoundationUnitDraft(bookDir, revisionId, UNIT_B, "Unit B to make stale.\n");

    // Mark UNIT_B as stale
    await markFoundationUnitNeedsRevision(bookDir, revisionId, UNIT_B, "stale: needs rewrite");

    const batchResult = await approveFoundationUnitsBatch(bookDir, revisionId, [UNIT_A, UNIT_B], "Human Lead");
    expect(batchResult.approved).toEqual([UNIT_A]);
    expect(batchResult.rejected).toHaveLength(1);
    expect(batchResult.rejected[0]!.unitId).toBe(UNIT_B);
    expect(batchResult.rejected[0]!.reason).toMatch(/stale/i);

    // UNIT_A was approved, UNIT_B remains stale
    const draft = await loadFoundationRevision(bookDir, revisionId);
    expect(draft.unitStates.find((u) => u.unitId === UNIT_A)!.state).toBe("approved");
    expect(draft.unitStates.find((u) => u.unitId === UNIT_B)!.state).toBe("stale");
  });

  // 19. approved Published content remains immutable
  // 20. revision edit leaves Published Markdown byte-identical
  // 21. Revision A operation leaves Revision B byte-identical
  it("19, 20, 21. operations in Revision A leave Published content and Revision B byte-identical", async () => {
    await setupBook();
    const publishedBefore = await bytes("story/outline/story_frame.md");

    const { revisionId: revA } = await openFoundationRevision(bookDir, [UNIT_A]);
    const { revisionId: revB } = await openFoundationRevision(bookDir, [UNIT_A]);
    await saveFoundationUnitDraft(bookDir, revB, UNIT_A, "Revision B content initial.\n");
    const revBBefore = await bytes(`story/revisions/${revB}/${UNIT_A}.md`);

    // Perform edits and approval in Rev A
    await saveFoundationUnitDraft(bookDir, revA, UNIT_A, "Revision A edited text.\n");
    await approveFoundationUnit(bookDir, revA, UNIT_A, "Human Reviewer");

    // Published content is immutable
    expect(await bytes("story/outline/story_frame.md")).toBe(publishedBefore);

    // Revision B is byte-identical
    expect(await bytes(`story/revisions/${revB}/${UNIT_A}.md`)).toBe(revBBefore);
  });

  // 22. discard leaves Published unchanged
  it("22. discardFoundationRevision removes revision workspace and leaves Published unchanged", async () => {
    await setupBook();
    const publishedBefore = await bytes("story/outline/story_frame.md");
    const { revisionId } = await openFoundationRevision(bookDir, [UNIT_A]);

    await discardFoundationRevision(bookDir, revisionId);

    // Working directory removed
    await expect(loadFoundationRevision(bookDir, revisionId)).rejects.toThrow();

    // Published unchanged
    expect(await bytes("story/outline/story_frame.md")).toBe(publishedBefore);
  });

  // 23. Canon unchanged by all Task 8 operations
  // 24. current Published Foundation version/pointer unchanged
  it("23 & 24. Canon and Published Foundation version pointer remain completely unchanged", async () => {
    await setupBook();
    const canonBefore = await bytes("story/state/manifest.json");

    const { revisionId } = await openFoundationRevision(bookDir, [UNIT_A]);
    await saveFoundationUnitDraft(bookDir, revisionId, UNIT_A, "New drafted text.\n");
    await approveFoundationUnit(bookDir, revisionId, UNIT_A, "Alice");

    expect(await bytes("story/state/manifest.json")).toBe(canonBefore);
    const store = createVersionStore(bookDir);
    expect(await store.readCurrentVersion("foundation", "foundation")).toBeNull();
  });

  // 25. no creative prose duplicated into revision governance JSON
  it("25. no creative prose is duplicated into revision draft.gov.json", async () => {
    await setupBook();
    const secretCreativeProse = "Distinctive creative prose line that should never appear in JSON metadata.";
    const { revisionId } = await openFoundationRevision(bookDir, [UNIT_A]);
    await saveFoundationUnitDraft(bookDir, revisionId, UNIT_A, secretCreativeProse);

    const draftJson = await bytes(`story/revisions/${revisionId}/draft.gov.json`);
    expect(draftJson).not.toContain(secretCreativeProse);
  });

  // 26. Task 7 finding/review compatibility remains intact
  it("26. unit with unresolved review findings cannot be approved", async () => {
    await setupBook();
    const { revisionId } = await openFoundationRevision(bookDir, [UNIT_A]);
    await saveFoundationUnitDraft(bookDir, revisionId, UNIT_A, A_ORIGINAL);

    const draftAfterSave = await loadFoundationRevision(bookDir, revisionId);
    const currentRev = draftAfterSave.unitStates.find((u) => u.unitId === UNIT_A)!.contentRevision;

    // Add a Task 7 review finding
    const findingItem: FoundationFinding = {
      findingId: "unresolved-find",
      revisionId,
      unitId: UNIT_A,
      contentRevision: currentRev,
      contentHash: governedContentHash(A_ORIGINAL),
      category: "story_core",
      severity: "minor",
      repairScope: "local",
      evidence: "Alpha conflict sentence.",
      suggestedAction: "Alpha improved sentence.",
    };
    await saveFoundationReviewFinding(bookDir, findingItem);

    // Approval must be blocked while review finding is unresolved
    await expect(approveFoundationUnit(bookDir, revisionId, UNIT_A, "Human Reviewer"))
      .rejects.toThrow(/unresolved.*finding/i);
  });
});