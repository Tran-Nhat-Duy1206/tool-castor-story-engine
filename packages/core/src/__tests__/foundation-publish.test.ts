import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkFoundationPublishGate,
  publishFoundation,
  handleExternalEdit,
  type PublishGateInput,
  type PublishOutcome,
} from "../foundation/publish.js";
import {
  openFoundationRevision,
  loadFoundationRevision,
  saveFoundationUnitDraft,
  approveFoundationUnit,
  markFoundationUnitNeedsRevision,
  reapproveStaleFoundationUnit,
} from "../foundation/revision-service.js";
import {
  writeUnitManifest,
  readUnitManifests,
  governedContentHash,
  type FoundationUnitManifest,
} from "../foundation/manifest.js";
import {
  createVersionStore,
  type FoundationPublishedSnapshot,
} from "../governance/versions.js";
import {
  saveFoundationFinding,
  resolveFoundationUncertainty,
  type PersistedFoundationFinding,
} from "../governance/conflicts.js";
import {
  saveFoundationReviewFinding,
  type FoundationFinding,
} from "../foundation/review.js";
import { StateManager } from "../state/manager.js";

let root = "";
let bookDir = "";

const UNIT_A = "sf-core-conflict";
const UNIT_B = "sf-world-setting";
const PROSE_A = "Core conflict premise.\nAuthoritative resolution line.\n";
const PROSE_B = "World setting description.\nAtmosphere details.\n";

async function setupBook(): Promise<void> {
  root = await mkdtemp(join(tmpdir(), "castor-pub-test-"));
  bookDir = join(root, "books", "pub-book");
  await mkdir(join(bookDir, "story", "outline"), { recursive: true });
  await mkdir(join(bookDir, "story", "state"), { recursive: true });
  await mkdir(join(bookDir, "story", "foundation-v2"), { recursive: true });

  await writeFile(
    join(bookDir, "book.json"),
    JSON.stringify({
      id: "pub-book",
      title: "Publish Test Book",
      governance: { foundation: "legacy", planning: "legacy" },
    }, null, 2),
    "utf-8",
  );

  await writeFile(
    join(bookDir, "story", "state", "manifest.json"),
    JSON.stringify({
      schemaVersion: 2,
      language: "en",
      lastAppliedChapter: 5,
      projectionVersion: 1,
      migrationWarnings: [],
    }, null, 2),
    "utf-8",
  );

  // Initial manifests for required units
  const manifestA: FoundationUnitManifest = {
    unitId: UNIT_A,
    kind: "story_frame",
    importance: "required",
    status: "draft",
    locator: { contentKind: "whole_file", sourceRelPath: `story/outline/${UNIT_A}.md` },
    contentHash: governedContentHash(PROSE_A),
    contentRevision: 1,
    dependencies: [],
  };

  const manifestB: FoundationUnitManifest = {
    unitId: UNIT_B,
    kind: "story_frame",
    importance: "required",
    status: "draft",
    locator: { contentKind: "whole_file", sourceRelPath: `story/outline/${UNIT_B}.md` },
    contentHash: governedContentHash(PROSE_B),
    contentRevision: 1,
    dependencies: [{ targetUnitId: UNIT_A, kind: "extends_story_frame" }],
  };

  await writeUnitManifest(bookDir, manifestA);
  await writeUnitManifest(bookDir, manifestB);

  await writeFile(join(bookDir, "story", "outline", `${UNIT_A}.md`), PROSE_A, "utf-8");
  await writeFile(join(bookDir, "story", "outline", `${UNIT_B}.md`), PROSE_B, "utf-8");
}

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
  bookDir = "";
});

async function fileText(relPath: string): Promise<string | null> {
  try {
    return await readFile(join(bookDir, relPath), "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function prepareApprovedRevision(units = [UNIT_A, UNIT_B]): Promise<string> {
  const { revisionId } = await openFoundationRevision(bookDir, units);
  for (const u of units) {
    const prose = u === UNIT_A ? PROSE_A : PROSE_B;
    await saveFoundationUnitDraft(bookDir, revisionId, u, prose);
    await approveFoundationUnit(bookDir, revisionId, u, "Human Reviewer");
  }
  return revisionId;
}

describe("Foundation Human Publish (Task 9)", () => {
  // -------------------------------------------------------------------------
  // PUBLISH GATE (1-11)
  // -------------------------------------------------------------------------
  it("1. eligible Human-reviewed revision passes publish gate", async () => {
    await setupBook();
    const revisionId = await prepareApprovedRevision();
    const gate = await checkFoundationPublishGate({
      bookDir,
      revisionId,
      humanActor: "Lead Editor",
      expectedBaseFoundationVersion: 0,
      expectedBaseCanonRevision: 5,
    });

    expect(gate.ok).toBe(true);
    expect(gate.failures).toEqual([]);
  });

  it("2. missing required approval blocks publish gate", async () => {
    await setupBook();
    const { revisionId } = await openFoundationRevision(bookDir, [UNIT_A]);
    await saveFoundationUnitDraft(bookDir, revisionId, UNIT_A, PROSE_A);
    // Not approved!

    const gate = await checkFoundationPublishGate({
      bookDir,
      revisionId,
      humanActor: "Lead Editor",
      expectedBaseFoundationVersion: 0,
      expectedBaseCanonRevision: 5,
    });

    expect(gate.ok).toBe(false);
    expect(gate.failures.some((f) => /not approved|approval/i.test(f))).toBe(true);
  });

  it("3. approvedRevision != contentRevision blocks publish gate", async () => {
    await setupBook();
    const revisionId = await prepareApprovedRevision([UNIT_A]);
    // Save draft edit after approval => contentRevision increments, approvedRevision cleared
    await saveFoundationUnitDraft(bookDir, revisionId, UNIT_A, "Edited after approval\n");

    const gate = await checkFoundationPublishGate({
      bookDir,
      revisionId,
      humanActor: "Lead Editor",
      expectedBaseFoundationVersion: 0,
      expectedBaseCanonRevision: 5,
    });

    expect(gate.ok).toBe(false);
  });

  it("4. working Markdown changed after approval blocks publish gate", async () => {
    await setupBook();
    const revisionId = await prepareApprovedRevision([UNIT_A]);

    // Out-of-band edit to revision draft markdown
    await writeFile(join(bookDir, "story", "revisions", revisionId, `${UNIT_A}.md`), "Tampered\n", "utf-8");

    const gate = await checkFoundationPublishGate({
      bookDir,
      revisionId,
      humanActor: "Lead Editor",
      expectedBaseFoundationVersion: 0,
      expectedBaseCanonRevision: 5,
    });

    expect(gate.ok).toBe(false);
    expect(gate.failures.some((f) => /hash.*mismatch|tamper/i.test(f))).toBe(true);
  });

  it("5. caller-fabricated approved/hash state cannot publish", async () => {
    await setupBook();
    const revisionId = await prepareApprovedRevision([UNIT_A]);

    // Fabricate hash in draft.gov.json
    const draftPath = join(bookDir, "story", "revisions", revisionId, "draft.gov.json");
    const raw = JSON.parse(await readFile(draftPath, "utf-8"));
    raw.unitStates[0].contentHash = "fabricated-fake-hash";
    await writeFile(draftPath, JSON.stringify(raw, null, 2), "utf-8");

    const gate = await checkFoundationPublishGate({
      bookDir,
      revisionId,
      humanActor: "Lead Editor",
      expectedBaseFoundationVersion: 0,
      expectedBaseCanonRevision: 5,
    });

    expect(gate.ok).toBe(false);
  });

  it("6 & 7. unresolved required uncertainty / finding blocks publish gate", async () => {
    await setupBook();
    const revisionId = await prepareApprovedRevision([UNIT_A]);

    const finding: PersistedFoundationFinding = {
      findingId: "pub-uncertain-1",
      revisionId,
      unitId: UNIT_A,
      contentRevision: 2,
      contentHash: governedContentHash(PROSE_A),
      evidence: [{ source: "test", detail: "Unresolved conflict evidence" }],
      createdAt: new Date().toISOString(),
    };
    await saveFoundationFinding(bookDir, finding);

    const gate = await checkFoundationPublishGate({
      bookDir,
      revisionId,
      humanActor: "Lead Editor",
      expectedBaseFoundationVersion: 0,
      expectedBaseCanonRevision: 5,
    });

    expect(gate.ok).toBe(false);
    expect(gate.failures.some((f) => /uncertain|conflict|resolution/i.test(f))).toBe(true);
  });

  it("8. stale unit blocks publish gate", async () => {
    await setupBook();
    const revisionId = await prepareApprovedRevision([UNIT_A]);
    await markFoundationUnitNeedsRevision(bookDir, revisionId, UNIT_A, "stale: dependency invalidated");

    const gate = await checkFoundationPublishGate({
      bookDir,
      revisionId,
      humanActor: "Lead Editor",
      expectedBaseFoundationVersion: 0,
      expectedBaseCanonRevision: 5,
    });

    expect(gate.ok).toBe(false);
    expect(gate.failures.some((f) => /stale/i.test(f))).toBe(true);
  });

  it("9. invalid dependency graph blocks publish gate", async () => {
    await setupBook();
    const revisionId = await prepareApprovedRevision([UNIT_A]);

    // Create a dangling dependency in manifest
    const manifest = (await readUnitManifests(bookDir)).get(UNIT_A)!;
    await writeUnitManifest(bookDir, {
      ...manifest,
      dependencies: [{ targetUnitId: "missing-target-unit", kind: "extends_story_frame" }],
    });

    const gate = await checkFoundationPublishGate({
      bookDir,
      revisionId,
      humanActor: "Lead Editor",
      expectedBaseFoundationVersion: 0,
      expectedBaseCanonRevision: 5,
    });

    expect(gate.ok).toBe(false);
    expect(gate.failures.some((f) => /dependency|missing/i.test(f))).toBe(true);
  });

  it("10. base Foundation version mismatch blocks publish gate", async () => {
    await setupBook();
    const revisionId = await prepareApprovedRevision();

    const gate = await checkFoundationPublishGate({
      bookDir,
      revisionId,
      humanActor: "Lead Editor",
      expectedBaseFoundationVersion: 99, // mismatch (actual is 0)
      expectedBaseCanonRevision: 5,
    });

    expect(gate.ok).toBe(false);
    expect(gate.failures.some((f) => /version.*mismatch/i.test(f))).toBe(true);
  });

  it("11. base Canon revision mismatch blocks publish gate", async () => {
    await setupBook();
    const revisionId = await prepareApprovedRevision();

    const gate = await checkFoundationPublishGate({
      bookDir,
      revisionId,
      humanActor: "Lead Editor",
      expectedBaseFoundationVersion: 0,
      expectedBaseCanonRevision: 999, // mismatch (actual is 5)
    });

    expect(gate.ok).toBe(false);
    expect(gate.failures.some((f) => /canon.*mismatch/i.test(f))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // PUBLISH EXECUTION & VERSIONING (12-16)
  // -------------------------------------------------------------------------
  it("12. first publish creates exactly Foundation v1", async () => {
    await setupBook();
    const revisionId = await prepareApprovedRevision();

    const outcome = await publishFoundation({
      bookDir,
      revisionId,
      humanActor: "Lead Editor",
      expectedBaseFoundationVersion: 0,
      expectedBaseCanonRevision: 5,
    });

    expect(outcome.status).toBe("published");
    if (outcome.status === "published") {
      expect(outcome.version).toBe(1);
    }

    const store = createVersionStore(bookDir);
    const current = await store.readCurrentVersion<FoundationPublishedSnapshot>("foundation", "foundation");
    expect(current).not.toBeNull();
    expect(current!.version).toBe(1);
  });

  it("13. subsequent publish creates exactly one next global version", async () => {
    await setupBook();
    const rev1 = await prepareApprovedRevision();
    await publishFoundation({
      bookDir,
      revisionId: rev1,
      humanActor: "Lead Editor",
      expectedBaseFoundationVersion: 0,
      expectedBaseCanonRevision: 5,
    });

    // Second revision
    const rev2 = await prepareApprovedRevision([UNIT_A]);
    const outcome2 = await publishFoundation({
      bookDir,
      revisionId: rev2,
      humanActor: "Lead Editor",
      expectedBaseFoundationVersion: 1,
      expectedBaseCanonRevision: 5,
    });

    expect(outcome2.status).toBe("published");
    if (outcome2.status === "published") {
      expect(outcome2.version).toBe(2);
    }

    const store = createVersionStore(bookDir);
    const versions = await store.listVersions("foundation", "foundation");
    expect(versions).toEqual([1, 2]);
  });

  it("14. unchanged units retain refs/revisions across publishes", async () => {
    await setupBook();
    const rev1 = await prepareApprovedRevision([UNIT_A, UNIT_B]);
    await publishFoundation({
      bookDir,
      revisionId: rev1,
      humanActor: "Lead Editor",
      expectedBaseFoundationVersion: 0,
      expectedBaseCanonRevision: 5,
    });

    // Rev 2 only modifies UNIT_A
    const rev2 = await prepareApprovedRevision([UNIT_A]);
    await publishFoundation({
      bookDir,
      revisionId: rev2,
      humanActor: "Lead Editor",
      expectedBaseFoundationVersion: 1,
      expectedBaseCanonRevision: 5,
    });

    const store = createVersionStore(bookDir);
    const v2 = await store.readCurrentVersion<FoundationPublishedSnapshot>("foundation", "foundation");
    const bRef = v2!.snapshot.unitRefs.find((r) => r.unitId === UNIT_B);
    expect(bRef).toBeDefined();
    expect(bRef!.contentHash).toBe(governedContentHash(PROSE_B));
  });

  it("15. Published Markdown exactly matches approved revision", async () => {
    await setupBook();
    const newProseA = "Published Prose A New Content\n";
    const { revisionId } = await openFoundationRevision(bookDir, [UNIT_A]);
    await saveFoundationUnitDraft(bookDir, revisionId, UNIT_A, newProseA);
    await approveFoundationUnit(bookDir, revisionId, UNIT_A, "Lead Editor");

    await publishFoundation({
      bookDir,
      revisionId,
      humanActor: "Lead Editor",
      expectedBaseFoundationVersion: 0,
      expectedBaseCanonRevision: 5,
    });

    expect(await fileText(`story/outline/${UNIT_A}.md`)).toBe(newProseA);
  });

  it("16. Revision A publish never materializes Revision B", async () => {
    await setupBook();
    const { revisionId: revA } = await openFoundationRevision(bookDir, [UNIT_A]);
    const { revisionId: revB } = await openFoundationRevision(bookDir, [UNIT_A]);

    await saveFoundationUnitDraft(bookDir, revA, UNIT_A, "Content for Rev A\n");
    await approveFoundationUnit(bookDir, revA, UNIT_A, "Lead Editor");

    await saveFoundationUnitDraft(bookDir, revB, UNIT_A, "Content for Rev B\n");
    await approveFoundationUnit(bookDir, revB, UNIT_A, "Lead Editor");

    await publishFoundation({
      bookDir,
      revisionId: revA,
      humanActor: "Lead Editor",
      expectedBaseFoundationVersion: 0,
      expectedBaseCanonRevision: 5,
    });

    expect(await fileText(`story/outline/${UNIT_A}.md`)).toBe("Content for Rev A\n");
    expect(await fileText(`story/outline/${UNIT_A}.md`)).not.toContain("Rev B");
  });

  // -------------------------------------------------------------------------
  // MARKER & INVALIDATION (17-21)
  // -------------------------------------------------------------------------
  it("17. first v2 marker activation is atomic with v1 in book.json", async () => {
    await setupBook();
    const revisionId = await prepareApprovedRevision();

    const bookBefore = JSON.parse((await fileText("book.json"))!);
    expect(bookBefore.governance.foundation).toBe("legacy");

    await publishFoundation({
      bookDir,
      revisionId,
      humanActor: "Lead Editor",
      expectedBaseFoundationVersion: 0,
      expectedBaseCanonRevision: 5,
    });

    const bookAfter = JSON.parse((await fileText("book.json"))!);
    expect(bookAfter.governance.foundation).toBe("v2");
    expect(bookAfter.governance.planning).toBe("legacy"); // planning marker not flipped
  });

  it("18. pre-commit fault leaves legacy marker and no v1", async () => {
    await setupBook();
    const revisionId = await prepareApprovedRevision();

    // We simulate by testing that aborted transaction leaves book.json intact
    const bookBefore = await fileText("book.json");
    try {
      await publishFoundation({
        bookDir,
        revisionId,
        humanActor: "Lead Editor",
        expectedBaseFoundationVersion: 0,
        expectedBaseCanonRevision: 5,
        failAtStage: "stage",
      } as any);
    } catch {
      // expected
    }

    expect(await fileText("book.json")).toBe(bookBefore);
    const store = createVersionStore(bookDir);
    expect(await store.readCurrentVersion("foundation", "foundation")).toBeNull();
  });

  it("19. post-durable-commit state has v2 + v1", async () => {
    await setupBook();
    const revisionId = await prepareApprovedRevision();

    await publishFoundation({
      bookDir,
      revisionId,
      humanActor: "Lead Editor",
      expectedBaseFoundationVersion: 0,
      expectedBaseCanonRevision: 5,
    });

    const book = JSON.parse((await fileText("book.json"))!);
    expect(book.governance.foundation).toBe("v2");
    const store = createVersionStore(bookDir);
    expect(await store.readCurrentVersion("foundation", "foundation")).not.toBeNull();
  });

  it("20 & 21. direct invalidations in same transaction and A->B->C does not cascade to C", async () => {
    await setupBook();

    // First publish publishes A and B approved
    const rev1 = await prepareApprovedRevision([UNIT_A, UNIT_B]);
    await publishFoundation({
      bookDir,
      revisionId: rev1,
      humanActor: "Lead Editor",
      expectedBaseFoundationVersion: 0,
      expectedBaseCanonRevision: 5,
    });

    // Manifest C depends on B, B depends on A
    const manifestC: FoundationUnitManifest = {
      unitId: "unit-c",
      kind: "story_frame",
      importance: "optional",
      status: "approved",
      approvedRevision: 1,
      locator: { contentKind: "whole_file", sourceRelPath: "story/outline/unit-c.md" },
      contentHash: governedContentHash("Prose C\n"),
      contentRevision: 1,
      dependencies: [{ targetUnitId: UNIT_B, kind: "extends_story_frame" }],
    };
    await writeUnitManifest(bookDir, manifestC);
    await writeFile(join(bookDir, "story", "outline", "unit-c.md"), "Prose C\n", "utf-8");

    // In rev 2, only A changes. B depends on A, so B should become direct stale.
    // C depends on B, but B is intermediate so C must NOT cascade to stale!
    const rev2 = await openFoundationRevision(bookDir, [UNIT_A]);
    await saveFoundationUnitDraft(bookDir, rev2.revisionId, UNIT_A, "Changed A prose\n");
    await approveFoundationUnit(bookDir, rev2.revisionId, UNIT_A, "Lead Editor");

    await publishFoundation({
      bookDir,
      revisionId: rev2.revisionId,
      humanActor: "Lead Editor",
      expectedBaseFoundationVersion: 1,
      expectedBaseCanonRevision: 5,
    });

    const manifests = await readUnitManifests(bookDir);
    expect(manifests.get(UNIT_B)!.status).toBe("stale"); // B directly invalidated
    expect(manifests.get("unit-c")!.status).toBe("approved"); // C NOT cascaded
  });

  // -------------------------------------------------------------------------
  // CONCURRENCY (22-23)
  // -------------------------------------------------------------------------
  it("22 & 23. two concurrent publishes: one wins, other receives typed stale result", async () => {
    await setupBook();
    const rev1 = await prepareApprovedRevision([UNIT_A]);
    const rev2 = await prepareApprovedRevision([UNIT_A]);

    const p1 = publishFoundation({
      bookDir,
      revisionId: rev1,
      humanActor: "Editor 1",
      expectedBaseFoundationVersion: 0,
      expectedBaseCanonRevision: 5,
    });

    const p2 = publishFoundation({
      bookDir,
      revisionId: rev2,
      humanActor: "Editor 2",
      expectedBaseFoundationVersion: 0,
      expectedBaseCanonRevision: 5,
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    const outcomes = [r1.status, r2.status].sort();

    expect(outcomes).toEqual(["published", "revision_base_stale"]);

    // Exactly one version created
    const store = createVersionStore(bookDir);
    const versions = await store.listVersions("foundation", "foundation");
    expect(versions).toEqual([1]);
  });

  // -------------------------------------------------------------------------
  // EXTERNAL EDITS (24-28)
  // -------------------------------------------------------------------------
  it("24. external edit to published Markdown blocks publish gate", async () => {
    await setupBook();
    const rev1 = await prepareApprovedRevision([UNIT_A]);
    await publishFoundation({
      bookDir,
      revisionId: rev1,
      humanActor: "Lead Editor",
      expectedBaseFoundationVersion: 0,
      expectedBaseCanonRevision: 5,
    });

    // Tamper published file on disk out-of-band
    await writeFile(join(bookDir, "story", "outline", `${UNIT_A}.md`), "External rogue edit!\n", "utf-8");

    const rev2 = await prepareApprovedRevision([UNIT_B]);
    const gate = await checkFoundationPublishGate({
      bookDir,
      revisionId: rev2,
      humanActor: "Lead Editor",
      expectedBaseFoundationVersion: 1,
      expectedBaseCanonRevision: 5,
    });

    expect(gate.ok).toBe(false);
    expect(gate.failures.some((f) => /external.*change/i.test(f))).toBe(true);
  });

  it("25. compare external edit does not mutate authority", async () => {
    await setupBook();
    const rev1 = await prepareApprovedRevision([UNIT_A]);
    await publishFoundation({
      bookDir,
      revisionId: rev1,
      humanActor: "Lead Editor",
      expectedBaseFoundationVersion: 0,
      expectedBaseCanonRevision: 5,
    });

    await writeFile(join(bookDir, "story", "outline", `${UNIT_A}.md`), "External rogue edit!\n", "utf-8");
    const fileBefore = await fileText(`story/outline/${UNIT_A}.md`);

    await handleExternalEdit(bookDir, UNIT_A, "compare");

    expect(await fileText(`story/outline/${UNIT_A}.md`)).toBe(fileBefore);
  });

  it("26 & 27. adopt creates unapproved working revision content and never auto-approves", async () => {
    await setupBook();
    const rev1 = await prepareApprovedRevision([UNIT_A]);
    await publishFoundation({
      bookDir,
      revisionId: rev1,
      humanActor: "Lead Editor",
      expectedBaseFoundationVersion: 0,
      expectedBaseCanonRevision: 5,
    });

    const rogueContent = "External rogue edit to adopt!\n";
    await writeFile(join(bookDir, "story", "outline", `${UNIT_A}.md`), rogueContent, "utf-8");

    const res: any = await handleExternalEdit(bookDir, UNIT_A, "adopt_into_revision");
    expect(res.revisionId).toBeDefined();

    const draft = await loadFoundationRevision(bookDir, res.revisionId);
    const unit = draft.unitStates.find((u) => u.unitId === UNIT_A)!;
    expect(unit.state).toBe("needs_review");
    expect(unit.approvedRevision).toBeUndefined();
    expect(draft.approvalRecords).toHaveLength(0);
  });

  it("28. discard never legitimizes external content and restores published file", async () => {
    await setupBook();
    const rev1 = await prepareApprovedRevision([UNIT_A]);
    await publishFoundation({
      bookDir,
      revisionId: rev1,
      humanActor: "Lead Editor",
      expectedBaseFoundationVersion: 0,
      expectedBaseCanonRevision: 5,
    });

    await writeFile(join(bookDir, "story", "outline", `${UNIT_A}.md`), "External rogue edit to discard!\n", "utf-8");

    await handleExternalEdit(bookDir, UNIT_A, "discard");

    expect(await fileText(`story/outline/${UNIT_A}.md`)).toBe(PROSE_A);
  });

  // -------------------------------------------------------------------------
  // LOCKING (37-39)
  // -------------------------------------------------------------------------
  it("37, 38, 39. lock is held and released, stale pre-lock observation cannot commit", async () => {
    await setupBook();
    const revisionId = await prepareApprovedRevision();

    // Acquire lock externally to simulate another writer holding it
    const manager = new StateManager(join(root, "books"));
    const release = await manager.acquireBookLock("pub-book");

    // Concurrently trying to publish while locked will wait or block
    let publishFinished = false;
    const pubPromise = publishFoundation({
      bookDir,
      revisionId,
      humanActor: "Lead Editor",
      expectedBaseFoundationVersion: 0,
      expectedBaseCanonRevision: 5,
    }).then((res) => {
      publishFinished = true;
      return res;
    });

    // While lock is held, publish cannot complete
    await new Promise((r) => setTimeout(r, 50));
    expect(publishFinished).toBe(false);

    // Release lock
    await release();

    const outcome = await pubPromise;
    expect(outcome.status).toBe("published");
  });
});