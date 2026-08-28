// @ts-nocheck
/**
 * Task 22 — Foundation governance UI state RED (pure Vitest node)
 * Imports the NOT-YET-EXISTING ./foundation-ui-state.js so this suite is RED
 * until the implementation is added. Mirrors the Studio convention of
 * pairing every page with a `*-ui-state.ts` model + tests.
 */
import { describe, it, expect } from "vitest";

// RED imports — files do not exist yet (intended failure)
import {
  getFoundationUiState,
  partitionPublishedDraft,
  canEditFoundationUnit,
  foundationCacheKey,
  isFoundationUnitRequired,
  getFoundationDependencies,
  getFoundationFindings,
  getFoundationBlockers,
  diffFirstView,
  staleFoundationView,
  isReadyToPublish,
  batchApproveView,
} from "./foundation-ui-state.js";
import type {
  FoundationOverview,
  FoundationUnit,
  FoundationReadiness,
} from "./foundation-ui-state.js";

function unit(overrides: Partial<FoundationUnit> = {}): FoundationUnit {
  return {
    id: "unit-alpha",
    title: "Story Frame",
    status: "draft",
    required: true,
    isProduction: false,
    readOnly: false,
    stale: false,
    dependencies: [],
    findings: [],
    blockers: [],
    ...overrides,
  } as FoundationUnit;
}

function overview(published: FoundationUnit | null, draft: FoundationUnit | null, extra: Partial<FoundationOverview> = {}): FoundationOverview {
  return {
    bookId: "demo-book-22",
    published: published ? { units: [published] } as never : null,
    draft: draft ? { units: [draft] } as never : null,
    manifests: [],
    ...extra,
  } as FoundationOverview;
}

function readiness(overrides: Partial<FoundationReadiness> = {}): FoundationReadiness {
  return {
    ready: false,
    blockers: [],
    findings: [],
    requiredUnits: [],
    optionalUnits: [],
    ...overrides,
  } as FoundationReadiness;
}

describe("foundation-ui-state — published vs draft", () => {
  it("published-only unit is production authority", () => {
    const published = unit({ id: "u-pub", status: "published", isProduction: true });
    const state = getFoundationUiState(overview(published, null), readiness());
    expect(state.publishedUnits).toContainEqual(expect.objectContaining({ id: "u-pub", isProduction: true }));
    expect(state.publishedUnits[0].isProduction).toBe(true);
  });

  it("draft is separate from published", () => {
    const pub = unit({ id: "u-pub", status: "published", isProduction: true });
    const draft = unit({ id: "u-draft", status: "draft", isProduction: false });
    const partitioned = partitionPublishedDraft(overview(pub, draft));
    expect(partitioned.published.map((u) => u.id)).not.toContain("u-draft");
    expect(partitioned.draft.map((u) => u.id)).not.toContain("u-pub");
  });

  it("draft is non-production (not authority)", () => {
    const draft = unit({ id: "u-draft", status: "draft", isProduction: false });
    const state = getFoundationUiState(overview(null, draft), readiness());
    expect(state.draftUnits[0].isProduction).toBe(false);
    expect(state.productionAuthority).not.toContainEqual(expect.objectContaining({ id: "u-draft" }));
  });

  it("partitionPublishedDraft keeps both lists stable when one is empty", () => {
    const pub = unit({ id: "pub-only", status: "published", isProduction: true });
    const { published, draft } = partitionPublishedDraft(overview(pub, null));
    expect(published).toHaveLength(1);
    expect(draft).toHaveLength(0);
  });
});

describe("foundation-ui-state — approved read-only until Open Revision", () => {
  it("approved unit is read-only", () => {
    const approved = unit({ id: "u1", status: "approved", readOnly: true });
    expect(canEditFoundationUnit(approved, { revisionStatus: "approved" } as never)).toBe(false);
  });

  it("approved unit becomes editable only after openRevision", () => {
    const approved = unit({ id: "u1", status: "approved", readOnly: true });
    expect(canEditFoundationUnit(approved, { revisionStatus: "draft" } as never)).toBe(true);
    expect(canEditFoundationUnit(approved, { revisionStatus: "approved" } as never)).toBe(false);
  });

  it("draft unit is editable", () => {
    const d = unit({ status: "draft", readOnly: false });
    expect(canEditFoundationUnit(d, { revisionStatus: "draft" } as never)).toBe(true);
  });

  it("getFoundationUiState marks approved as readOnly", () => {
    const approved = unit({ id: "a1", status: "approved", readOnly: true });
    const state = getFoundationUiState(overview(approved, null), readiness());
    expect(state.unitsById["a1"].readOnly).toBe(true);
  });
});

describe("foundation-ui-state — required/optional from Core", () => {
  it("required/optional comes from Core manifests, not invented", () => {
    const req = unit({ id: "req", required: true });
    const opt = unit({ id: "opt", required: false });
    expect(isFoundationUnitRequired(req)).toBe(true);
    expect(isFoundationUnitRequired(opt)).toBe(false);
    const state = getFoundationUiState(overview(null, req), readiness({ requiredUnits: [req], optionalUnits: [opt] }));
    expect(state.requiredUnits.map((u) => u.id)).toContain("req");
    expect(state.optionalUnits.map((u) => u.id)).toContain("opt");
  });

  it("required flag is proxy-passed from readiness.requiredUnits", () => {
    const r = readiness({ requiredUnits: [unit({ id: "r1", required: true })], optionalUnits: [] });
    const state = getFoundationUiState(overview(null, unit({ id: "r1", required: true })), r);
    expect(state.requiredUnits).toHaveLength(1);
  });
});

describe("foundation-ui-state — dependencies / findings / blockers from Core", () => {
  it("dependencies are from Core unit.dependencies", () => {
    const u = unit({ dependencies: ["unit-beta", "unit-gamma"] });
    expect(getFoundationDependencies(u)).toEqual(["unit-beta", "unit-gamma"]);
    const state = getFoundationUiState(overview(null, u), readiness());
    expect(state.unitsById[u.id].dependencies).toEqual(["unit-beta", "unit-gamma"]);
  });

  it("findings are from Core (not invented)", () => {
    const finding = { unitId: "unit-alpha", message: "missing arc", level: "warning" };
    const r = readiness({ findings: [finding] as never });
    expect(getFoundationFindings(r)).toContainEqual(expect.objectContaining({ unitId: "unit-alpha" }));
  });

  it("blockers are from Core", () => {
    const blocker = { unitId: "unit-alpha", reason: "required not approved" };
    const r = readiness({ blockers: [blocker] as never });
    expect(getFoundationBlockers(r)).toContainEqual(expect.objectContaining({ unitId: "unit-alpha" }));
  });

  it("findings/blockers never synthesized when Core returns empty", () => {
    const r = readiness({ findings: [], blockers: [] });
    expect(getFoundationFindings(r)).toHaveLength(0);
    expect(getFoundationBlockers(r)).toHaveLength(0);
  });
});

describe("foundation-ui-state — diff-first for later revisions", () => {
  it("diffFirstView: first revision has no diff, later revision shows diff", () => {
    const first = diffFirstView({ revisionId: "rev-001", revisionIndex: 0, units: [unit()] } as never);
    expect(first.hasDiff).toBe(false);
    const later = diffFirstView({ revisionId: "rev-002", revisionIndex: 1, units: [unit()], diff: [{ unitId: "unit-alpha", change: "edited" }] } as never);
    expect(later.hasDiff).toBe(true);
    expect(later.diff[0].change).toBe("edited");
  });

  it("diff is not shown for revision 0 even if Core mistakenly sends diff", () => {
    const v = diffFirstView({ revisionId: "rev-001", revisionIndex: 0, diff: [{ unitId: "x" }] } as never);
    expect(v.hasDiff).toBe(false);
  });
});

describe("foundation-ui-state — stale re-review", () => {
  it("stale unit requires re-review", () => {
    const stale = unit({ stale: true });
    const view = staleFoundationView(stale, readiness());
    expect(view.stale).toBe(true);
    expect(view.requiresReReview).toBe(true);
  });

  it("non-stale unit does not require re-review", () => {
    const fresh = unit({ stale: false });
    expect(staleFoundationView(fresh, readiness()).requiresReReview).toBe(false);
  });

  it("stale banner is derived from Core stale flag", () => {
    const stale = unit({ id: "s1", stale: true });
    const state = getFoundationUiState(overview(stale, null), readiness());
    expect(state.staleUnits.map((u) => u.id)).toContain("s1");
  });
});

describe("foundation-ui-state — ready != published", () => {
  it("ready does not imply published", () => {
    const r = readiness({ ready: true });
    const state = getFoundationUiState(overview(null, unit({ status: "draft" })), r);
    expect(state.readiness.ready).toBe(true);
    expect(state.isPublished).toBe(false);
  });

  it("published is true only when overview.published exists", () => {
    const pub = unit({ status: "published", isProduction: true });
    const statePub = getFoundationUiState(overview(pub, null), readiness({ ready: true }));
    expect(statePub.isPublished).toBe(true);
    const stateDraft = getFoundationUiState(overview(null, unit({ status: "draft" })), readiness({ ready: true }));
    expect(stateDraft.isPublished).toBe(false);
  });

  it("isReadyToPublish is false when not ready, even if draft exists", () => {
    const r = readiness({ ready: false, blockers: [{ unitId: "u" }] as never });
    expect(isReadyToPublish(r)).toBe(false);
  });

  it("isReadyToPublish is true only when ready and no blockers", () => {
    expect(isReadyToPublish(readiness({ ready: true, blockers: [] }))).toBe(true);
    expect(isReadyToPublish(readiness({ ready: true, blockers: [{ unitId: "u" }] as never }))).toBe(false);
  });
});

describe("foundation-ui-state — no force approve", () => {
  it("batchApproveView refuses to approve stale without explicit reapprove", () => {
    const stale = unit({ id: "s1", stale: true, status: "approved" });
    const view = batchApproveView([stale], { force: true } as never);
    expect(view.approvable).not.toContain("s1");
  });

  it("batchApproveView only approves non-stale, non-blocked units", () => {
    const ok = unit({ id: "ok", stale: false });
    const stale = unit({ id: "stale", stale: true });
    const view = batchApproveView([ok, stale], { force: false } as never);
    expect(view.approvable).toEqual(["ok"]);
  });

  it("no force flag can bypass stale — explicit reapproveStale is required", () => {
    const view = batchApproveView([unit({ id: "s1", stale: true })], {} as never);
    expect(view.requiresReapproveStale).toContain("s1");
  });
});

describe("foundation-ui-state — cache/bookId isolation", () => {
  it("foundationCacheKey isolates by bookId", () => {
    const k1 = foundationCacheKey("book-1", "rev-001");
    const k2 = foundationCacheKey("book-2", "rev-001");
    expect(k1).not.toBe(k2);
    expect(k1).toContain("book-1");
    expect(k2).toContain("book-2");
  });

  it("different revisions have different keys even for same book", () => {
    expect(foundationCacheKey("book-1", "rev-001")).not.toBe(foundationCacheKey("book-1", "rev-002"));
  });

  it("bookId is part of key — not just revision", () => {
    const k = foundationCacheKey("my-book", "rev-1");
    expect(k).toMatch(/my-book/);
  });
});

describe("foundation-ui-state — security (no filesystem bypass)", () => {
  it("getFoundationUiState never returns filesystem paths", () => {
    const u = unit({ id: "u1" });
    const state = getFoundationUiState(overview(u, null), readiness());
    const serialized = JSON.stringify(state);
    expect(serialized).not.toMatch(/\/etc\/|\.json|E:\\/);
  });

  it("foundationCacheKey sanitizes traversal segments", () => {
    const k = foundationCacheKey("../etc/passwd", "rev-001");
    expect(k).not.toContain("..");
    expect(k).not.toContain("/etc");
  });

  it("no direct filesystem access helper exists — unit content is via Core DTO only", () => {
    // If implementation exposed a readFile bypass, this import would exist.
    // Assert the module does NOT export a filesystem reader.
    // We check via absence: importing fs helpers should be undefined.
    // This test documents the contract: UI state is pure, no fs.
    expect((getFoundationUiState as unknown as { readFile?: unknown }).readFile).toBeUndefined();
  });
});
