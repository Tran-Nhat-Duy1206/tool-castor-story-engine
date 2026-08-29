import { Command } from "commander";
import { StateManager } from "@actalk/castor-core";
import * as Core from "@actalk/castor-core";
import { findProjectRoot, resolveBookId, log, logError } from "../utils.js";

// -----------------------------------------------------------------------------
// READ-ONLY Foundation operational command
//
// Subcommands:
//   castor foundation status  <book>  — readiness via Core
//   castor foundation inspect <book>  — published version + overview via Core
//   castor foundation units   <book>  — unit manifest list via Core
//
// Invariants:
// - READ-ONLY: never opens/saves/approves/publishes, never writes governance
//   files. Mutations belong in Studio (castor studio).
// - Display is Core-derived: governance mode, Published Foundation version,
//   readiness (blockingReasons, warnings, nextRecommendedAction), unit summary.
//   Do NOT calculate readiness locally — delegate to Core.
// - Uses existing CLI conventions: Commander, log/logError, --json, --verbose.
//   No --force / --ignore flags.
// -----------------------------------------------------------------------------

type ReadinessReport = {
  blockingReasons: ReadonlyArray<string>;
  warnings: ReadonlyArray<string>;
  nextRecommendedAction: string | null;
  [k: string]: unknown;
};

type UnitManifestLite = {
  unitId: string;
  status: string;
  kind: string;
  importance: string;
  contentHash?: string;
  contentRevision?: number;
  approvedRevision?: number;
  dependencies?: ReadonlyArray<{ targetUnitId: string; kind: string }>;
  locator?: { sourceRelPath: string; contentKind: string; [k: string]: unknown };
  [k: string]: unknown;
};

function asArray<T>(v: unknown): ReadonlyArray<T> {
  return Array.isArray(v) ? (v as T[]) : [];
}

function normalizeReadiness(raw: unknown): ReadinessReport {
  if (!raw || typeof raw !== "object") {
    return { blockingReasons: [], warnings: [], nextRecommendedAction: null };
  }
  const r = raw as Record<string, unknown>;
  // Support both canonical and alias shapes used by stubs:
  // - { blockingReasons, warnings, nextRecommendedAction }
  // - { blockers, findings } (stub for getFoundationReadiness)
  // - { ready, blockers } etc.
  const blockingReasons =
    asArray<string>(r.blockingReasons).length > 0
      ? asArray<string>(r.blockingReasons)
      : asArray<string>(r.blockers).length > 0
        ? asArray<string>(r.blockers)
        : asArray<string>(r.blockingReasons ?? r.blockers);
  const warnings =
    asArray<string>(r.warnings).length > 0
      ? asArray<string>(r.warnings)
      : asArray<string>(r.findings ?? r.warnings);
  const nextRecommendedAction =
    typeof r.nextRecommendedAction === "string"
      ? r.nextRecommendedAction
      : typeof r.nextAction === "string"
        ? (r.nextAction as string)
        : null;
  return {
    blockingReasons,
    warnings,
    nextRecommendedAction,
    ...r,
  } as ReadinessReport;
}

function normalizeManifests(raw: unknown): UnitManifestLite[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as UnitManifestLite[];
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.manifests)) return o.manifests as UnitManifestLite[];
    if (Array.isArray(o.units)) return o.units as UnitManifestLite[];
    const anyO = o as unknown as Record<string, unknown>;
    const pub = anyO.published as Record<string, unknown> | undefined;
    if (pub && Array.isArray(pub.units)) return pub.units as UnitManifestLite[];
  }
  return [];
}

async function getGovernanceMode(bookDir: string): Promise<string> {
  // Prefer Core contract helper if available (read-only).
  const anyCore = Core as unknown as Record<string, unknown>;
  try {
    if (typeof anyCore.resolveGovernanceMarkers === "function") {
      const raw = await import("node:fs/promises").then((fs) => fs.readFile(`${bookDir}/book.json`, "utf-8"));
      const book = JSON.parse(raw);
      const markers = (anyCore.resolveGovernanceMarkers as (b: unknown) => { foundation: string })(book);
      if (markers && typeof markers.foundation === "string") return markers.foundation;
    }
  } catch {
    // fall through to bootstrap result
  }
  try {
    const anyBootstrap = anyCore.bootstrapFoundation as ((dir: string) => Promise<{ mode: string }>) | undefined;
    if (typeof anyBootstrap === "function") {
      const res = await anyBootstrap(bookDir);
      if (res && typeof res.mode === "string") return res.mode;
    }
  } catch {
    // ignore
  }
  return "unknown";
}

async function getPublishedVersion(bookDir: string): Promise<number | null> {
  const anyCore = Core as unknown as Record<string, unknown>;
  try {
    const factory = anyCore.createVersionStore as ((dir: string) => {
      readCurrentVersion: (kind: string, id: string) => Promise<{ version: number } | null>;
      listVersions: (kind: string, id: string) => Promise<number[]>;
    }) | undefined;
    if (typeof factory === "function") {
      const store = factory(bookDir);
      const cur = await store.readCurrentVersion("foundation", "foundation");
      if (cur && typeof cur.version === "number") return cur.version;
      // fallback: highest listed version if current pointer missing (redundant)
      const list = await store.listVersions("foundation", "foundation");
      if (list.length > 0) return list[list.length - 1] ?? null;
      return null;
    }
  } catch {
    // ignore — fall through
  }
  // Try getFoundationOverview alias shape which may carry version/currentVersion
  try {
    const fn = anyCore.getFoundationOverview as ((p: Record<string, unknown>) => Promise<unknown>) | undefined;
    if (typeof fn === "function") {
      const ov = (await fn({ bookDir })) as Record<string, unknown>;
      if (typeof ov.version === "number") return ov.version as number;
      if (typeof ov.currentVersion === "number") return ov.currentVersion as number;
      if (ov.published && typeof (ov.published as Record<string, unknown>).version === "number") {
        return (ov.published as Record<string, unknown>).version as number;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

async function getUnitManifests(bookDir: string): Promise<UnitManifestLite[]> {
  const anyCore = Core as unknown as Record<string, unknown>;
  // 1) Preferred: readUnitManifests (governance read, no bootstrap side effect beyond reading)
  try {
    const fn = anyCore.readUnitManifests as ((dir: string) => Promise<Map<string, unknown> | unknown[]>) | undefined;
    if (typeof fn === "function") {
      const res = await fn(bookDir);
      if (res instanceof Map) return [...res.values()] as UnitManifestLite[];
      const arr = normalizeManifests(res);
      if (arr.length > 0 || res instanceof Map) return arr;
    }
  } catch {
    // continue
  }
  // 2) listFoundationManifests (Core stub alias)
  try {
    const fn = anyCore.listFoundationManifests as ((p: Record<string, unknown>) => Promise<unknown>) | undefined;
    if (typeof fn === "function") {
      // try both param shapes
      let res: unknown = null;
      try {
        res = await fn({ bookDir, bookId: bookDir });
      } catch {
        res = await fn({ bookDir } as Record<string, unknown>);
      }
      const arr = normalizeManifests(res);
      if (arr.length > 0) return arr;
    }
  } catch {
    // continue
  }
  // 3) bootstrapFoundation (read-only snapshot; does NOT publish)
  try {
    const fn = anyCore.bootstrapFoundation as ((dir: string) => Promise<{ units: unknown[] }>) | undefined;
    if (typeof fn === "function") {
      const res = await fn(bookDir);
      return normalizeManifests(res.units ?? res);
    }
  } catch {
    // ignore
  }
  return [];
}

async function getReadiness(bookDir: string, manifests: ReadonlyArray<UnitManifestLite>): Promise<ReadinessReport> {
  const anyCore = Core as unknown as Record<string, unknown>;

  // Preferred: evaluateFoundationReadiness(bookDir, manifests) — Core deterministic evaluation
  try {
    const fn = anyCore.evaluateFoundationReadiness as
      | ((dir: string, m: ReadonlyArray<unknown>) => Promise<unknown>)
      | undefined;
    if (typeof fn === "function") {
      const res = await fn(bookDir, manifests as unknown as ReadonlyArray<unknown>);
      return normalizeReadiness(res);
    }
  } catch {
    // continue
  }

  // Fallback: getFoundationReadiness({ bookDir } | { bookId }) alias
  try {
    const fn = anyCore.getFoundationReadiness as ((p: Record<string, unknown>) => Promise<unknown>) | undefined;
    if (typeof fn === "function") {
      let res: unknown = null;
      try {
        res = await fn({ bookDir });
      } catch {
        res = await fn({ bookId: bookDir } as Record<string, unknown>);
      }
      return normalizeReadiness(res);
    }
  } catch {
    // continue
  }

  // Last resort: bootstrap + evaluate (if the previous path missed manifests)
  try {
    const boot = anyCore.bootstrapFoundation as ((dir: string) => Promise<{ units: unknown[] }>) | undefined;
    const evalFn = anyCore.evaluateFoundationReadiness as
      | ((dir: string, m: ReadonlyArray<unknown>) => Promise<unknown>)
      | undefined;
    if (typeof boot === "function" && typeof evalFn === "function") {
      const b = await boot(bookDir);
      const ms = normalizeManifests(b.units ?? b);
      const res = await evalFn(bookDir, ms as unknown as ReadonlyArray<unknown>);
      return normalizeReadiness(res);
    }
  } catch {
    // ignore
  }

  // Read-only fallback mock — do NOT calculate locally, just report unknown
  return {
    blockingReasons: ["Readiness unavailable: Core readiness API not found (fallback)."],
    warnings: [],
    nextRecommendedAction: "Open Studio to review Foundation: castor studio",
  };
}

async function collectFoundationSnapshot(bookId: string, bookDir: string) {
  const [governanceMode, publishedVersion, manifests] = await Promise.all([
    getGovernanceMode(bookDir),
    getPublishedVersion(bookDir),
    getUnitManifests(bookDir),
  ]);
  const readiness = await getReadiness(bookDir, manifests);

  // Unit status summary — derived from manifests (Core), not computed readiness
  const byStatus: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  const byImportance: Record<string, number> = {};
  for (const m of manifests) {
    byStatus[m.status] = (byStatus[m.status] ?? 0) + 1;
    byKind[m.kind] = (byKind[m.kind] ?? 0) + 1;
    byImportance[m.importance] = (byImportance[m.importance] ?? 0) + 1;
  }

  return {
    bookId,
    bookDir,
    governanceMode,
    publishedVersion,
    manifests,
    readiness,
    summary: {
      totalUnits: manifests.length,
      byStatus,
      byKind,
      byImportance,
    },
  };
}

function renderSnapshotHuman(snapshot: Awaited<ReturnType<typeof collectFoundationSnapshot>>, verbose: boolean): void {
  log(`Foundation — ${snapshot.bookId}`);
  log(`  Governance mode: ${snapshot.governanceMode}`);
  log(`  Published Foundation version: ${snapshot.publishedVersion ?? "(none — not yet published)"}`);
  log(`  Book dir: ${snapshot.bookDir}`);
  log("");
  log(`  Readiness (Core):`);
  if (snapshot.readiness.blockingReasons.length === 0) {
    log(`    Blocking: (none)`);
  } else {
    log(`    Blocking (${snapshot.readiness.blockingReasons.length}):`);
    for (const r of snapshot.readiness.blockingReasons) log(`      - ${r}`);
  }
  if (snapshot.readiness.warnings.length === 0) {
    log(`    Warnings: (none)`);
  } else {
    log(`    Warnings (${snapshot.readiness.warnings.length}):`);
    for (const w of snapshot.readiness.warnings) log(`      - ${w}`);
  }
  log(`    Next: ${snapshot.readiness.nextRecommendedAction ?? "(none — ready)"}`);
  log("");
  log(`  Units: ${snapshot.summary.totalUnits} total`);
  if (snapshot.summary.totalUnits > 0) {
    log(`    by status: ${Object.entries(snapshot.summary.byStatus).map(([k, v]) => `${k}=${v}`).join(", ")}`);
    log(`    by kind: ${Object.entries(snapshot.summary.byKind).map(([k, v]) => `${k}=${v}`).join(", ")}`);
    log(`    by importance: ${Object.entries(snapshot.summary.byImportance).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  }
  if (verbose && snapshot.manifests.length > 0) {
    log("");
    log(`  Units (verbose):`);
    for (const m of snapshot.manifests) {
      const rev = m.contentRevision != null ? ` rev ${m.contentRevision}${m.approvedRevision != null ? ` (approved ${m.approvedRevision})` : ""}` : "";
      const hash = m.contentHash ? ` hash ${String(m.contentHash).slice(0, 12)}` : "";
      log(`    - ${m.unitId} [${m.kind}/${m.importance}/${m.status}]${rev}${hash}`);
      if (m.locator) log(`        locator: ${m.locator.sourceRelPath} (${m.locator.contentKind})`);
      if (m.dependencies && m.dependencies.length > 0) {
        log(`        deps: ${m.dependencies.map((d) => d.targetUnitId).join(", ")}`);
      }
    }
  }
  log("");
  log(`  Note: Foundation is read-only here. To edit/approve/publish, open Studio: castor studio`);
}

export const foundationCommand = new Command("foundation").description(
  "Foundation governance — read-only status/inspection (mutations live in Studio)",
);

foundationCommand
  .command("status")
  .description("Show Foundation readiness (read-only, Core-derived)")
  .argument("[book-id]", "Book ID (auto-detected if only one book)")
  .option("--json", "Output JSON")
  .option("--verbose", "Verbose output")
  .action(async (bookIdArg: string | undefined, opts: { json?: boolean; verbose?: boolean }) => {
    try {
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const state = new StateManager(root);
      const bookDir = state.bookDir(bookId);
      const snapshot = await collectFoundationSnapshot(bookId, bookDir);

      if (opts.json) {
        log(JSON.stringify(snapshot, null, 2));
        return;
      }
      renderSnapshotHuman(snapshot, Boolean(opts.verbose));
    } catch (e) {
      if (opts.json) log(JSON.stringify({ error: String(e) }));
      else logError(`Failed to get foundation status: ${e}`);
      process.exit(1);
    }
  });

foundationCommand
  .command("inspect")
  .description("Inspect Published Foundation and overview (read-only)")
  .argument("[book-id]", "Book ID (auto-detected if only one book)")
  .option("--json", "Output JSON")
  .option("--verbose", "Verbose output (show manifests)")
  .action(async (bookIdArg: string | undefined, opts: { json?: boolean; verbose?: boolean }) => {
    try {
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const state = new StateManager(root);
      const bookDir = state.bookDir(bookId);

      // Core read-only APIs: getFoundationOverview + listFoundationManifests / readUnitManifests
      const anyCore = Core as unknown as Record<string, unknown>;
      let overview: unknown = null;
      try {
        const fn = anyCore.getFoundationOverview as ((p: Record<string, unknown>) => Promise<unknown>) | undefined;
        if (typeof fn === "function") {
          // Try param shapes used by stubs
          try {
            overview = await fn({ bookId, bookDir });
          } catch {
            overview = await fn({ bookDir } as Record<string, unknown>);
          }
        }
      } catch {
        // ignore — overview optional
      }

      const snapshot = await collectFoundationSnapshot(bookId, bookDir);

      const payload = {
        ...snapshot,
        overview: overview ?? null,
      };

      if (opts.json) {
        log(JSON.stringify(payload, null, 2));
        return;
      }

      // Human-readable: reuse snapshot + show overview hint
      renderSnapshotHuman(snapshot, Boolean(opts.verbose));

      if (overview && typeof overview === "object") {
        const ov = overview as Record<string, unknown>;
        if (ov.draft || ov.published) {
          log(`  Overview (Core):`);
          if (ov.published) log(`    published: ${JSON.stringify(ov.published).slice(0, 200)}${JSON.stringify(ov.published).length > 200 ? "…" : ""}`);
          if (ov.draft) log(`    draft: ${JSON.stringify(ov.draft).slice(0, 200)}${JSON.stringify(ov.draft).length > 200 ? "…" : ""}`);
          log("");
        }
      }
    } catch (e) {
      if (opts.json) log(JSON.stringify({ error: String(e) }));
      else logError(`Failed to inspect foundation: ${e}`);
      process.exit(1);
    }
  });

foundationCommand
  .command("units")
  .description("List Foundation unit manifests (read-only)")
  .argument("[book-id]", "Book ID (auto-detected if only one book)")
  .option("--json", "Output JSON")
  .option("--verbose", "Verbose output (hash/revision/locator)")
  .action(async (bookIdArg: string | undefined, opts: { json?: boolean; verbose?: boolean }) => {
    try {
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const state = new StateManager(root);
      const bookDir = state.bookDir(bookId);

      // Core read-only API: listFoundationManifests or bootstrapFoundation via helper
      const snapshot = await collectFoundationSnapshot(bookId, bookDir);

      if (opts.json) {
        log(
          JSON.stringify(
            {
              bookId: snapshot.bookId,
              governanceMode: snapshot.governanceMode,
              publishedVersion: snapshot.publishedVersion,
              readiness: snapshot.readiness,
              summary: snapshot.summary,
              manifests: snapshot.manifests,
            },
            null,
            2,
          ),
        );
        return;
      }

      log(`Foundation units — ${bookId}`);
      log(`  Governance: ${snapshot.governanceMode} | Published version: ${snapshot.publishedVersion ?? "(none)"}`);
      log(`  Readiness: ${snapshot.readiness.blockingReasons.length} blocking, ${snapshot.readiness.warnings.length} warnings | next: ${snapshot.readiness.nextRecommendedAction ?? "(ready)"}`);
      log(`  Total: ${snapshot.summary.totalUnits}`);
      if (snapshot.manifests.length === 0) {
        log(`  (no unit manifests found)`);
      } else {
        for (const m of snapshot.manifests) {
          if (opts.verbose) {
            const rev = m.contentRevision != null ? ` rev ${m.contentRevision}${m.approvedRevision != null ? `→${m.approvedRevision}` : ""}` : "";
            const hash = m.contentHash ? ` ${String(m.contentHash).slice(0, 12)}` : "";
            log(`  - ${m.unitId}  ${m.kind}/${m.importance}  ${m.status}${rev}${hash}`);
            log(`      ${m.locator?.sourceRelPath ?? "(no locator)"} [${m.locator?.contentKind ?? "?"}]`);
          } else {
            log(`  - ${m.unitId}  ${m.kind}/${m.importance}  ${m.status}`);
          }
        }
      }
      log("");
      log(`  Read-only. Mutate in Studio: castor studio`);
    } catch (e) {
      if (opts.json) log(JSON.stringify({ error: String(e) }));
      else logError(`Failed to list foundation units: ${e}`);
      process.exit(1);
    }
  });
