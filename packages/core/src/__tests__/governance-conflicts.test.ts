import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyCanonConflictDeterministic,
  classifyCanonConflictSemantic,
  isResolutionStillValid,
  loadHumanResolution,
  resolveFoundationUncertainty,
  saveFoundationFinding,
  type ConflictEvidence,
  type FoundationConflictResult,
  type HumanResolutionRecord,
  type PersistedFoundationFinding,
} from "../governance/conflicts.js";
import { governedContentHash } from "../foundation/manifest.js";
import { bootstrapFoundation } from "../foundation/bootstrap.js";

// ===========================================================================
// Task 6 tests — revision-scoped two-layer conflict classification + trusted
// Human Resolution. Fixture mirrors the approved legacy book shape used by
// Tasks 2/3: published Foundation Markdown (story frame + book rules), Canon
// manifest, and an explicit revision working workspace under story/revisions/.
// ===========================================================================

let root = "";
let bookDir = "";

const PUBLISHED_FRAME = [
  "## mock_text",
  "mock_text：mock_text。",
  "",
  "## mock_text",
  "mock_text：mock_text。",
  "",
  "## mock_text",
  "mock_text：mock_text，mock_text。",
  "",
  "## mock_text",
  "mock_text：mock_text。",
  "",
].join("\n");

const CHANGED_FRAME = PUBLISHED_FRAME.replace(
  "mock_text：mock_text。",
  "mock_text：mock_text。",
);

const PUBLISHED_RULES = [
  "## mock_text",
  "- mock_text từ：mock_text",
  "",
  "## mock_text",
  "- mock_text",
  "",
].join("\n");

const RULES_WITHOUT_MAIN_RULE = [
  "## mock_text",
  "- mock_text",
  "",
].join("\n");

const CORE_CONFLICT_UNIT = "sf-core-conflict";

async function mainRuleUnitId(): Promise<string> {
  const { units } = await bootstrapFoundation(bookDir);
  const rule = units.find(
    (unit) => unit.kind === "book_rule" && unit.locator.contentKind === "rule" && unit.locator.ruleId === "mock_text",
  );
  if (!rule) throw new Error("fixture: published mock_text rule not bootstrapped");
  return rule.unitId;
}

async function setupBook(): Promise<void> {
  root = await mkdtemp(join(tmpdir(), "castor-conflicts-"));
  bookDir = join(root, "books", "conflicts-book");
  await mkdir(join(bookDir, "story", "outline"), { recursive: true });
  await mkdir(join(bookDir, "story", "state"), { recursive: true });
  await writeFile(
    join(bookDir, "book.json"),
    JSON.stringify({
      id: "conflicts-book",
      title: "Conflicts Book",
      platform: "tomato",
      genre: "xuanhuan",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
    "utf-8",
  );
  await writeFile(join(bookDir, "story", "outline", "story_frame.md"), PUBLISHED_FRAME, "utf-8");
  await writeFile(join(bookDir, "story", "outline", "volume_map.md"), "## mock_text\nChương mock_text。\n", "utf-8");
  await writeFile(join(bookDir, "story", "book_rules.md"), PUBLISHED_RULES, "utf-8");
  await writeFile(
    join(bookDir, "story", "state", "manifest.json"),
    JSON.stringify({
      schemaVersion: 2,
      language: "vi",
      lastAppliedChapter: 3,
      projectionVersion: 1,
      migrationWarnings: [],
    }),
    "utf-8",
  );
}

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = "";
    bookDir = "";
  }
});

// ---------------------------------------------------------------------------
// Revision workspace seeding helpers (simulate Task 8 persistence; Task 6 only
// READS the revision-scoped working root — never Published paths).
// ---------------------------------------------------------------------------

async function seedDraft(revisionId: string, unitId: string, content: string): Promise<void> {
  const dir = join(bookDir, "story", "revisions", revisionId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${unitId}.md`), content, "utf-8");
}

async function seedDraftState(
  revisionId: string,
  unitId: string,
  contentRevision: number,
  contentHash: string,
): Promise<void> {
  const dir = join(bookDir, "story", "revisions", revisionId);
  await mkdir(dir, { recursive: true });
  const statePath = join(dir, "draft.gov.json");
  let existing: { revisionId: string; unitStates: Array<{ unitId: string; contentRevision: number; contentHash: string }> };
  try {
    existing = JSON.parse(await readFile(statePath, "utf-8")) as typeof existing;
  } catch {
    existing = { revisionId, unitStates: [] };
  }
  const rest = existing.unitStates.filter((state) => state.unitId !== unitId);
  rest.push({ unitId, contentRevision, contentHash });
  await writeFile(
    statePath,
    `${JSON.stringify({ revisionId, unitStates: rest }, null, 2)}\n`,
    "utf-8",
  );
}

/** Seed a draft + its revision state exactly as Task 8's saveFoundationUnitDraft would. */
async function seedDraftRevision(
  revisionId: string,
  unitId: string,
  content: string,
  contentRevision: number,
): Promise<void> {
  await seedDraft(revisionId, unitId, content);
  await seedDraftState(revisionId, unitId, contentRevision, governedContentHash(content));
}

async function seedFinding(finding: PersistedFoundationFinding): Promise<void> {
  await saveFoundationFinding(bookDir, finding);
}

function findingFixture(overrides: Partial<PersistedFoundationFinding> = {}): PersistedFoundationFinding {
  return {
    findingId: "finding-core-1",
    revisionId: "rev-a",
    unitId: CORE_CONFLICT_UNIT,
    contentRevision: 1,
    contentHash: governedContentHash(PUBLISHED_FRAME),
    evidence: [
      { source: "draft-content-change", detail: "draft core conflict differs from published Foundation; semantic review required" },
    ],
    createdAt: "2026-02-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Snapshot byte fingerprints of the files Task 6 must NEVER touch. */
async function snapshotPublishedAndCanon(): Promise<Record<string, string>> {
  const files = [
    join(bookDir, "story", "outline", "story_frame.md"),
    join(bookDir, "story", "book_rules.md"),
    join(bookDir, "story", "state", "manifest.json"),
  ];
  const snapshot: Record<string, string> = {};
  for (const file of files) {
    snapshot[file] = await readFile(file, "utf-8");
  }
  return snapshot;
}

async function standardRevision(unitId: string = CORE_CONFLICT_UNIT): Promise<{ revisionId: string; unitId: string }> {
  await seedDraftRevision("rev-a", unitId, PUBLISHED_FRAME, 1);
  return { revisionId: "rev-a", unitId };
}

// ---------------------------------------------------------------------------
// Deterministic classification
// ---------------------------------------------------------------------------

describe("classifyCanonConflictDeterministic", () => {
  it("returns future_safe with Core evidence when the draft is identical to the published unit content", async () => {
    await setupBook();
    const { revisionId, unitId } = await standardRevision();
    const result = await classifyCanonConflictDeterministic(bookDir, revisionId, unitId);
    expect(result.kind).toBe("future_safe");
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.evidence[0]!.source).toBe("published-content-equality");
  });

  it("returns a hard canon_conflict with Core evidence when the draft violates the governed-content contract", async () => {
    await setupBook();
    const { revisionId } = await standardRevision();
    // Draft frame with only THREE level-2 sections breaks the story-frame
    // positional contract that extractGovernedContent enforces.
    await seedDraft(revisionId, CORE_CONFLICT_UNIT, [
      "## mock_text",
      "mock_text：mock_text。",
      "",
      "## mock_text",
      "mock_text：mock_text。",
      "",
    ].join("\n"));
    const result = await classifyCanonConflictDeterministic(bookDir, revisionId, CORE_CONFLICT_UNIT);
    expect(result.kind).toBe("canon_conflict");
    if (result.kind !== "canon_conflict") throw new Error("expected canon_conflict");
    expect(result.evidence.some((evidence) => evidence.source === "governed-content-contract")).toBe(true);
    expect(result.canonRevision).toBe(3);
  });

  it("returns a hard canon_conflict when the draft would remove a published governed rule", async () => {
    await setupBook();
    // Published rules include the "mock_text" rule; a draft rules file without that
    // heading would silently delete the published governed content.
    const ruleUnitId = await mainRuleUnitId();
    await seedDraftRevision("rev-rule", ruleUnitId, RULES_WITHOUT_MAIN_RULE, 2);
    const result = await classifyCanonConflictDeterministic(bookDir, "rev-rule", ruleUnitId);
    expect(result.kind).toBe("canon_conflict");
    expect(result.evidence.some((evidence) => evidence.source === "published-content-removal")).toBe(true);
  });

  it("hands off to semantic review (uncertain) when draft content changed but structure is intact", async () => {
    await setupBook();
    const { revisionId, unitId } = await standardRevision();
    await seedDraft(revisionId, unitId, CHANGED_FRAME);
    const result = await classifyCanonConflictDeterministic(bookDir, revisionId, unitId);
    expect(result.kind).toBe("uncertain");
    if (result.kind === "uncertain") {
      expect(result.semanticConcern.length).toBeGreaterThan(0);
    }
  });

  it("fails closed when the revision draft content is missing (never classifies against Published or another revision)", async () => {
    await setupBook();
    await expect(classifyCanonConflictDeterministic(bookDir, "rev-missing", CORE_CONFLICT_UNIT)).rejects.toThrow();
  });

  it("fails closed when the unit has no published Foundation baseline", async () => {
    await setupBook();
    await seedDraftRevision("rev-a", "ghost-unit", "## mock_text\nmock_text。\n", 1);
    await expect(classifyCanonConflictDeterministic(bookDir, "rev-a", "ghost-unit")).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Semantic classification (authority-limited layer)
// ---------------------------------------------------------------------------

describe("classifyCanonConflictSemantic", () => {
  it("can emit uncertain for changed draft content", async () => {
    await setupBook();
    const { revisionId, unitId } = await standardRevision();
    await seedDraft(revisionId, unitId, CHANGED_FRAME);
    const result = await classifyCanonConflictSemantic(bookDir, revisionId, unitId);
    expect(result.kind).toBe("uncertain");
    if (result.kind === "uncertain") {
      expect(result.semanticConcern.length).toBeGreaterThan(0);
    }
  });

  it("emits future_safe for unchanged draft content", async () => {
    await setupBook();
    const { revisionId, unitId } = await standardRevision();
    const result = await classifyCanonConflictSemantic(bookDir, revisionId, unitId);
    expect(result.kind).toBe("future_safe");
  });

  it("NEVER emits canon_conflict — even when a deterministic conflict condition is present", async () => {
    await setupBook();
    const { revisionId } = await standardRevision();
    // Deterministic layer sees a contract violation here (hard canon_conflict).
    await seedDraft(revisionId, CORE_CONFLICT_UNIT, [
      "## mock_text",
      "mock_text：mock_text。",
      "",
      "## mock_text",
      "mock_text：mock_text。",
      "",
    ].join("\n"));
    const deterministic = await classifyCanonConflictDeterministic(bookDir, revisionId, CORE_CONFLICT_UNIT);
    expect(deterministic.kind).toBe("canon_conflict");
    const semantic = await classifyCanonConflictSemantic(bookDir, revisionId, CORE_CONFLICT_UNIT);
    expect(semantic.kind).not.toBe("canon_conflict");
    // The semantic layer must not downgrade the hard conflict into future_safe either.
    expect(semantic.kind).toBe("uncertain");
  });
});

// ---------------------------------------------------------------------------
// Revision isolation (Revision A and Revision B coexist)
// ---------------------------------------------------------------------------

describe("revision isolation", () => {
  it("classifying revision A reads ONLY A's draft — never revision B's content", async () => {
    await setupBook();
    // Revision A: draft identical to published → future_safe.
    await seedDraftRevision("rev-a", CORE_CONFLICT_UNIT, PUBLISHED_FRAME, 1);
    // Revision B: draft changed → uncertain. If classifying A accidentally read
    // B's file, A would wrongly become uncertain.
    await seedDraftRevision("rev-b", CORE_CONFLICT_UNIT, CHANGED_FRAME, 1);
    const resultA = await classifyCanonConflictDeterministic(bookDir, "rev-a", CORE_CONFLICT_UNIT);
    expect(resultA.kind).toBe("future_safe");
    const resultB = await classifyCanonConflictDeterministic(bookDir, "rev-b", CORE_CONFLICT_UNIT);
    expect(resultB.kind).toBe("uncertain");
  });

  it("deleting revision B's draft does not affect classifying revision A", async () => {
    await setupBook();
    await seedDraftRevision("rev-a", CORE_CONFLICT_UNIT, PUBLISHED_FRAME, 1);
    await seedDraftRevision("rev-b", CORE_CONFLICT_UNIT, CHANGED_FRAME, 1);
    await rm(join(bookDir, "story", "revisions", "rev-b", `${CORE_CONFLICT_UNIT}.md`));
    const resultA = await classifyCanonConflictDeterministic(bookDir, "rev-a", CORE_CONFLICT_UNIT);
    expect(resultA.kind).toBe("future_safe");
    // B now fails closed — classification never silently falls back to Published.
    await expect(classifyCanonConflictDeterministic(bookDir, "rev-b", CORE_CONFLICT_UNIT)).rejects.toThrow();
  });

  it("Published Foundation is read-only context — a changed draft is never classified as if it were the Published content", async () => {
    await setupBook();
    const { revisionId, unitId } = await standardRevision();
    await seedDraft(revisionId, unitId, CHANGED_FRAME);
    const result = await classifyCanonConflictDeterministic(bookDir, revisionId, unitId);
    expect(result.kind).not.toBe("future_safe");
  });
});

// ---------------------------------------------------------------------------
// Trusted Human Resolution
// ---------------------------------------------------------------------------

describe("resolveFoundationUncertainty", () => {
  it("binds the EXACT persisted finding evidence — the caller cannot fabricate evidence", async () => {
    await setupBook();
    const { revisionId, unitId } = await standardRevision();
    const finding = findingFixture();
    await seedFinding(finding);
    const record = await resolveFoundationUncertainty({
      bookDir,
      revisionId,
      findingId: finding.findingId,
      choice: "compatible",
      humanActor: "humantest",
    });
    expect(record.evidence).toEqual(finding.evidence);
    expect(record.evidence).not.toEqual([]);
  });

  it("binds the CURRENT Canon revision — the caller cannot fabricate canonRevision", async () => {
    await setupBook();
    const { revisionId } = await standardRevision();
    const finding = findingFixture();
    await seedFinding(finding);
    const record = await resolveFoundationUncertainty({
      bookDir,
      revisionId,
      findingId: finding.findingId,
      choice: "revise",
      humanActor: "humantest",
    });
    expect(record.canonRevision).toBe(3); // manifest.lastAppliedChapter
  });

  it("binds revisionId + unitId from the persisted finding — the caller supplies neither", async () => {
    await setupBook();
    const { revisionId } = await standardRevision();
    const finding = findingFixture();
    await seedFinding(finding);
    const record = await resolveFoundationUncertainty({
      bookDir,
      revisionId,
      findingId: finding.findingId,
      choice: "compatible",
      humanActor: "humantest",
    });
    expect(record.revisionId).toBe(revisionId);
    expect(record.unitId).toBe(CORE_CONFLICT_UNIT);
    expect(record.findingId).toBe(finding.findingId);
    expect(record.resolver).toBe("humantest");
  });

  it("rejects a STALE finding — draft content changed since the finding was computed", async () => {
    await setupBook();
    const { revisionId, unitId } = await standardRevision();
    const finding = findingFixture();
    await seedFinding(finding);
    const first = await resolveFoundationUncertainty({
      bookDir,
      revisionId,
      findingId: finding.findingId,
      choice: "compatible",
      humanActor: "humantest",
    });
    expect(first.findingId).toBe(finding.findingId);
    // Simulate a draft edit after the finding was computed (Task 8 bump).
    await seedDraftRevision(revisionId, unitId, CHANGED_FRAME, 2);
    await expect(
      resolveFoundationUncertainty({
        bookDir,
        revisionId,
        findingId: finding.findingId,
        choice: "compatible",
        humanActor: "humantest",
      }),
    ).rejects.toThrow(/stale|changed/i);
  });

  it("fails closed when the persisted finding is missing", async () => {
    await setupBook();
    await standardRevision();
    await expect(
      resolveFoundationUncertainty({
        bookDir,
        revisionId: "rev-a",
        findingId: "no-such-finding",
        choice: "compatible",
        humanActor: "humantest",
      }),
    ).rejects.toThrow();
  });

  it("fails closed when the finding belongs to a different revision", async () => {
    await setupBook();
    await standardRevision();
    await seedFinding(findingFixture());
    // The finding lives under rev-a; resolving through rev-b must NOT find it.
    await expect(
      resolveFoundationUncertainty({
        bookDir,
        revisionId: "rev-b",
        findingId: "finding-core-1",
        choice: "compatible",
        humanActor: "humantest",
      }),
    ).rejects.toThrow();
  });

  it("rejects unsafe revision/finding identifiers at the path boundary", async () => {
    await setupBook();
    await expect(
      resolveFoundationUncertainty({
        bookDir,
        revisionId: "../../etc",
        findingId: "f1",
        choice: "compatible",
        humanActor: "humantest",
      }),
    ).rejects.toThrow();
  });

  it("persists the resolution record durably and loadable by resolutionId", async () => {
    await setupBook();
    const { revisionId } = await standardRevision();
    const finding = findingFixture();
    await seedFinding(finding);
    const record = await resolveFoundationUncertainty({
      bookDir,
      revisionId,
      findingId: finding.findingId,
      choice: "compatible",
      humanActor: "humantest",
    });
    const loaded = await loadHumanResolution(bookDir, record.resolutionId);
    expect(loaded).toEqual(record);
  });

  it("resolves a Task 7 SUPERSET finding record (extra reviewer fields tolerated on read)", async () => {
    await setupBook();
    const { revisionId } = await standardRevision();
    // Task 7 will persist category/severity/repairScope/suggestedAction at the
    // same location; Task 6's tolerant read view must still resolve it.
    const supersetPath = join(
      bookDir,
      "story", "governance", "findings", revisionId, "finding-superset.gov.json",
    );
    const dir = join(bookDir, "story", "governance", "findings", revisionId);
    await mkdir(dir, { recursive: true });
    await writeFile(
      supersetPath,
      JSON.stringify({
        ...findingFixture({ findingId: "finding-superset" }),
        category: "story_core",
        severity: "important",
        repairScope: "local",
        suggestedAction: "revise the core conflict paragraph",
      }, null, 2),
      "utf-8",
    );
    const record = await resolveFoundationUncertainty({
      bookDir,
      revisionId,
      findingId: "finding-superset",
      choice: "compatible",
      humanActor: "humantest",
    });
    expect(record.findingId).toBe("finding-superset");
  });

  it("fails closed when the persisted finding record is corrupt", async () => {
    await setupBook();
    const { revisionId } = await standardRevision();
    const dir = join(bookDir, "story", "governance", "findings", revisionId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "corrupt-finding.gov.json"), "{ not json", "utf-8");
    await expect(
      resolveFoundationUncertainty({
        bookDir,
        revisionId,
        findingId: "corrupt-finding",
        choice: "compatible",
        humanActor: "humantest",
      }),
    ).rejects.toThrow();
  });

  it("fails closed when the draft file is missing while revision state exists (inconsistent workspace)", async () => {
    await setupBook();
    const { revisionId } = await standardRevision();
    const finding = findingFixture();
    await seedFinding(finding);
    // Delete the draft file WITHOUT touching the revision state record.
    await rm(join(bookDir, "story", "revisions", revisionId, `${CORE_CONFLICT_UNIT}.md`));
    await expect(
      resolveFoundationUncertainty({
        bookDir,
        revisionId,
        findingId: finding.findingId,
        choice: "compatible",
        humanActor: "humantest",
      }),
    ).rejects.toThrow(/inconsistent workspace/i);
  });

  it("fails closed when the draft file was mutated WITHOUT updating the revision state (hash mismatch)", async () => {
    await setupBook();
    const { revisionId, unitId } = await standardRevision();
    const finding = findingFixture();
    await seedFinding(finding);
    const first = await resolveFoundationUncertainty({
      bookDir,
      revisionId,
      findingId: finding.findingId,
      choice: "compatible",
      humanActor: "humantest",
    });
    expect(first.findingId).toBe(finding.findingId);
    // Mutate ONLY the draft file — the revision state still records the old hash.
    await seedDraft(revisionId, unitId, CHANGED_FRAME);
    await expect(
      resolveFoundationUncertainty({
        bookDir,
        revisionId,
        findingId: finding.findingId,
        choice: "compatible",
        humanActor: "humantest",
      }),
    ).rejects.toThrow(/inconsistent workspace/i);
    // And the already-recorded resolution is no longer valid.
    await expect(isResolutionStillValid(bookDir, first.resolutionId)).resolves.toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Resolution validity (fail closed on ANY binding change)
// ---------------------------------------------------------------------------

describe("isResolutionStillValid", () => {
  async function seedValidResolution(): Promise<HumanResolutionRecord> {
    const { revisionId } = await standardRevision();
    const finding = findingFixture();
    await seedFinding(finding);
    return resolveFoundationUncertainty({
      bookDir,
      revisionId,
      findingId: finding.findingId,
      choice: "compatible",
      humanActor: "humantest",
    });
  }

  it("is true immediately after a valid resolution", async () => {
    await setupBook();
    const record = await seedValidResolution();
    await expect(isResolutionStillValid(bookDir, record.resolutionId)).resolves.toBe(true);
  });

  it("becomes FALSE when the bound revision's draft content changed", async () => {
    await setupBook();
    const record = await seedValidResolution();
    await seedDraftRevision(record.revisionId, record.unitId, CHANGED_FRAME, 2);
    await expect(isResolutionStillValid(bookDir, record.resolutionId)).resolves.toBe(false);
  });

  it("becomes FALSE when the bound finding/evidence changed", async () => {
    await setupBook();
    const record = await seedValidResolution();
    // Task 7 rewrote the finding with different evidence for the same content.
    await seedFinding(findingFixture({
      evidence: [{ source: "draft-content-change", detail: "a DIFFERENT concern than the original" }],
    }));
    await expect(isResolutionStillValid(bookDir, record.resolutionId)).resolves.toBe(false);
  });

  it("becomes FALSE when the bound finding is deleted", async () => {
    await setupBook();
    const record = await seedValidResolution();
    await rm(join(bookDir, "story", "governance", "findings", record.revisionId, `${record.findingId}.gov.json`));
    await expect(isResolutionStillValid(bookDir, record.resolutionId)).resolves.toBe(false);
  });

  it("becomes FALSE when the bound revision's draft file is deleted after resolution", async () => {
    await setupBook();
    const record = await seedValidResolution();
    await rm(join(bookDir, "story", "revisions", record.revisionId, `${record.unitId}.md`));
    await expect(isResolutionStillValid(bookDir, record.resolutionId)).resolves.toBe(false);
  });

  it("becomes FALSE when the Canon revision changed", async () => {
    await setupBook();
    const record = await seedValidResolution();
    const manifestPath = join(bookDir, "story", "state", "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as { lastAppliedChapter: number };
    manifest.lastAppliedChapter = 4;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
    await expect(isResolutionStillValid(bookDir, record.resolutionId)).resolves.toBe(false);
  });

  it("is FALSE for a missing resolution (fail closed)", async () => {
    await setupBook();
    await expect(isResolutionStillValid(bookDir, "no-such-resolution")).resolves.toBe(false);
  });

  it("is FALSE for a corrupt resolution record (fail closed)", async () => {
    await setupBook();
    const dir = join(bookDir, "story", "governance", "resolutions");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "corrupt-reso.gov.json"), "{ not json", "utf-8");
    await expect(isResolutionStillValid(bookDir, "corrupt-reso")).resolves.toBe(false);
  });
});

// ---------------------------------------------------------------------------
// No side effects on Published Foundation / Canon; no shadow prose
// ---------------------------------------------------------------------------

describe("authority immutability", () => {
  it("leaves Published Foundation and Canon byte-identical across classify + resolve", async () => {
    await setupBook();
    const before = await snapshotPublishedAndCanon();
    const { revisionId, unitId } = await standardRevision();
    // Simulate a Task 8 edit (draft file + revision state move together).
    await seedDraftRevision(revisionId, unitId, CHANGED_FRAME, 2);
    await classifyCanonConflictDeterministic(bookDir, revisionId, unitId);
    await classifyCanonConflictSemantic(bookDir, revisionId, unitId);
    const finding = findingFixture({
      contentRevision: 2,
      contentHash: governedContentHash(CHANGED_FRAME),
    });
    await seedFinding(finding);
    await resolveFoundationUncertainty({
      bookDir,
      revisionId,
      findingId: finding.findingId,
      choice: "compatible",
      humanActor: "humantest",
    });
    const after = await snapshotPublishedAndCanon();
    expect(after).toEqual(before);
  });

  it("serialized resolution JSON is governance metadata only — no creative prose duplication", async () => {
    await setupBook();
    const { revisionId } = await standardRevision();
    const finding = findingFixture();
    await seedFinding(finding);
    const record = await resolveFoundationUncertainty({
      bookDir,
      revisionId,
      findingId: finding.findingId,
      choice: "compatible",
      humanActor: "humantest",
    });
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain("mock_text");
    expect(serialized).not.toContain("mock_text");
    expect(serialized).not.toContain("mock_text");
  });
});
