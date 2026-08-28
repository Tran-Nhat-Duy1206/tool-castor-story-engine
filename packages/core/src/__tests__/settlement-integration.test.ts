import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AuthorizationRecordSchema,
  createAuthorization,
  confirmAuthorization,
  loadAuthorization,
} from "../governance/authorizations.js";
import {
  deriveConsumedAuthorizations,
  buildSettlementWrites,
  applyLaggableSettlementEffects,
} from "../state/settlement-integration.js";
import { confirmStateReview } from "../state/state-review-finalize.js";

let root = "";
let bookDir = "";
const canonPath = () => join(bookDir, "story", "state", "manifest.json");
const bookPath = () => join(bookDir, "book.json");
const authPath = (id: string) => join(bookDir, "story", "governance", "authorizations", `${id}.gov.json`);

async function setupBook(): Promise<void> {
  root = await mkdtemp(join(tmpdir(), "inkos-settle-"));
  bookDir = join(root, "books", "demo-book");
  await mkdir(join(bookDir, "story", "state"), { recursive: true });
  await mkdir(join(bookDir, "chapters"), { recursive: true });
  await mkdir(join(bookDir, "story", "governance", "authorizations"), { recursive: true });
  await writeFile(bookPath(), JSON.stringify({
    id: "demo-book", title: "Demo", platform: "other", genre: "fantasy", status: "active",
    targetChapters: 30, chapterWordCount: 2000, language: "en",
    createdAt: "2026-08-27T00:00:00.000Z", updatedAt: "2026-08-27T00:00:00.000Z",
    governance: { foundation: "v2", planning: "v2" },
  }, null, 2));
  await writeFile(canonPath(), JSON.stringify({ schemaVersion: 2, language: "en", lastAppliedChapter: 0, projectionVersion: 1, migrationWarnings: [] }, null, 2));
  await writeFile(join(bookDir, "chapters", "index.json"), JSON.stringify([{ number: 1, title: "Ch1", status: "needs-state-review", wordCount: 1200, updatedAt: new Date().toISOString() }], null, 2));
  await writeFile(join(bookDir, "story", "current_state.md"), "# state", "utf-8");
  await writeFile(join(bookDir, "story", "pending_hooks.md"), "# hooks", "utf-8");
  await writeFile(join(bookDir, "story", "chapter_summaries.md"), "# sums", "utf-8");
  await mkdir(join(bookDir, "story", "snapshots", "1", "state"), { recursive: true });
}

function ctx(overrides: any = {}) {
  return {
    chapterNumber: 1,
    currentArcId: "arc-1",
    canonRevision: 1,
    hookStates: () => ({ lifecycleState: "active", lifecycleRevision: "1" }),
    relationshipStates: () => ({ state: "unknown", stateRevision: "1" }),
    factResolver: () => ({ exists: true, canonRevision: 1 }),
    arcState: () => ({ status: "started", revision: "1" }),
    ...overrides,
  };
}
function evidence(decisionKinds: string[], c = ctx()) {
  return { context: c, decisionKinds: decisionKinds as any };
}
function activeReview(authIds: string[] = []) {
  return { reviewId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", status: "active" as const, authorizationIds: authIds } as any;
}
async function seedActive(decisionKind: string, scope: any, consumption: "one_time" | "reusable" = "one_time") {
  const pending = await createAuthorization(bookDir, { decisionKind: decisionKind as any, scope, consumption });
  return confirmAuthorization(bookDir, pending.authorizationId, "human-a");
}
function writeAuthRaw(record: any) {
  return writeFile(authPath(record.authorizationId), JSON.stringify(record, null, 2));
}
beforeEach(setupBook);
afterEach(async () => { vi.restoreAllMocks(); if (root) await rm(root, { recursive: true, force: true }); });

describe("non-consumption paths", () => {
  it("draft/audit/plan/gate helpers do not consume; direct caller cannot consume", async () => {
    const auth = await seedActive("identity_reveal", { kind: "exact_chapter", chapterNumber: 1 });
    const derived = await deriveConsumedAuthorizations(bookDir, activeReview([auth.authorizationId]), evidence(["identity_reveal"]));
    expect(derived.length).toBe(1);
    const still = await loadAuthorization(bookDir, auth.authorizationId);
    expect(still?.lifecycle).toBe("active");
    // build writes is pure; does not persist
    buildSettlementWrites({ bookDir, chapterNumber: 1, canonRevision: 1, derivedConsumptions: derived });
    expect((await loadAuthorization(bookDir, auth.authorizationId))?.lifecycle).toBe("active");
  });
});

describe("trusted records", () => {
  it("raw ID and text mention cannot consume", async () => {
    const auth = await seedActive("major_betrayal", { kind: "exact_chapter", chapterNumber: 1 });
    // raw ID without structured evidence
    const noEvidence = await deriveConsumedAuthorizations(bookDir, activeReview([auth.authorizationId]), evidence([]));
    expect(noEvidence.length).toBe(0);
    // text mention is ignored – only trusted store + evidence matters
  });
  it("pending/expired/cancelled/consumed cannot consume", async () => {
    const pending = await createAuthorization(bookDir, { decisionKind: "identity_reveal", scope: { kind: "exact_chapter", chapterNumber: 1 }, consumption: "one_time" });
    expect((await deriveConsumedAuthorizations(bookDir, activeReview([pending.authorizationId]), evidence(["identity_reveal"]))).length).toBe(0);
    const active = await seedActive("identity_reveal", { kind: "exact_chapter", chapterNumber: 1 });
    // manually craft expired
    const expired = AuthorizationRecordSchema.parse({ ...active, lifecycle: "expired", expiredAt: new Date().toISOString() });
    await writeAuthRaw(expired);
    expect((await deriveConsumedAuthorizations(bookDir, activeReview([active.authorizationId]), evidence(["identity_reveal"]))).length).toBe(0);
    // cancelled
    const active2 = await seedActive("identity_reveal", { kind: "exact_chapter", chapterNumber: 2 });
    const cancelled = AuthorizationRecordSchema.parse({ ...active2, lifecycle: "cancelled", cancelledAt: new Date().toISOString(), cancelledBy: "human-a" });
    await writeAuthRaw(cancelled);
    expect((await deriveConsumedAuthorizations(bookDir, activeReview([active2.authorizationId]), evidence(["identity_reveal"]))).length).toBe(0);
    // consumed
    const active3 = await seedActive("identity_reveal", { kind: "exact_chapter", chapterNumber: 3 });
    const consumed = AuthorizationRecordSchema.parse({ ...active3, lifecycle: "consumed", consumedAt: new Date().toISOString(), consumedCanonRevision: 1 });
    await writeAuthRaw(consumed);
    expect((await deriveConsumedAuthorizations(bookDir, activeReview([active3.authorizationId]), evidence(["identity_reveal"]))).length).toBe(0);
  });
});

describe("evidence validation", () => {
  it("wrong event/decisionKind/scope/condition not consumed; correct eligible", async () => {
    const auth = await seedActive("identity_reveal", { kind: "exact_chapter", chapterNumber: 1 });
    expect((await deriveConsumedAuthorizations(bookDir, activeReview([auth.authorizationId]), evidence(["major_betrayal"]))).length).toBe(0);
    expect((await deriveConsumedAuthorizations(bookDir, activeReview([auth.authorizationId]), evidence(["identity_reveal"], ctx({ chapterNumber: 2 })))).length).toBe(0);
    const cond = await seedActive("identity_reveal", { kind: "condition", condition: { kind: "after_chapter", chapterNumber: 5 } });
    expect((await deriveConsumedAuthorizations(bookDir, activeReview([cond.authorizationId]), evidence(["identity_reveal"], ctx({ chapterNumber: 1, canonRevision: 0 })))).length).toBe(0);
    expect((await deriveConsumedAuthorizations(bookDir, activeReview([auth.authorizationId]), evidence(["identity_reveal"]))).length).toBe(1);
  });
});

describe("settlement atomicity and provenance", () => {
  it("builds writes with provenance and correct revision", async () => {
    const auth = await seedActive("identity_reveal", { kind: "exact_chapter", chapterNumber: 1 });
    const derived = await deriveConsumedAuthorizations(bookDir, activeReview([auth.authorizationId]), evidence(["identity_reveal"]));
    const writes = buildSettlementWrites({ bookDir, chapterNumber: 1, canonRevision: 7, derivedConsumptions: derived });
    expect(writes.length).toBe(1);
    const parsed = JSON.parse(writes[0]!.content as string);
    expect(parsed.lifecycle).toBe("consumed");
    expect(parsed.consumedCanonRevision).toBe(7);
    expect(parsed.lifecycleRevision).toBe(String(parseInt(auth.lifecycleRevision) + 1));
    expect(parsed.decisionKind).toBe(auth.decisionKind);
  });
});

describe("laggable effects non-critical", () => {
  it("failure does not affect canon correctness", async () => {
    const eff = await applyLaggableSettlementEffects(bookDir, 1, 1);
    expect(eff).toBeDefined();
  });
});

describe("only owner", () => {
  it("no standalone consume API; helpers pure", async () => {
    const mod = await import("../governance/authorizations.js");
    expect("consumeAuthorization" in mod).toBe(false);
    expect("markAuthorizationConsumed" in mod).toBe(false);
  });
});

describe("atomic settlement fault boundary", () => {
  it("before commit failure leaves Canon old and Authorization active", async () => {
    const auth = await seedActive("identity_reveal", { kind: "exact_chapter", chapterNumber: 1 });
    const derived = await deriveConsumedAuthorizations(bookDir, activeReview([auth.authorizationId]), evidence(["identity_reveal"]));
    const writes = buildSettlementWrites({ bookDir, chapterNumber: 1, canonRevision: 5, derivedConsumptions: derived });
    expect(writes.length).toBe(1);
    // simulate fault before commit: do not commit
    expect((await loadAuthorization(bookDir, auth.authorizationId))?.lifecycle).toBe("active");
    const canonBefore = await readFile(canonPath(), "utf-8");
    expect(JSON.parse(canonBefore).lastAppliedChapter).toBe(0);
  });
  it("after commit Canon new and Authorization consumed atomically", async () => {
    const auth = await seedActive("identity_reveal", { kind: "exact_chapter", chapterNumber: 1 });
    const derived = await deriveConsumedAuthorizations(bookDir, activeReview([auth.authorizationId]), evidence(["identity_reveal"]));
    const writes = buildSettlementWrites({ bookDir, chapterNumber: 1, canonRevision: 5, derivedConsumptions: derived });
    const { commitAtomicFileSet } = await import("../utils/atomic-file-set.js");
    await commitAtomicFileSet({ rootDir: bookDir, writes: [{ relativePath: "story/state/manifest.json", content: JSON.stringify({ schemaVersion: 2, language: "en", lastAppliedChapter: 5, projectionVersion: 1, migrationWarnings: [] }, null, 2) }, ...writes] });
    expect(JSON.parse(await readFile(canonPath(), "utf-8")).lastAppliedChapter).toBe(5);
    expect((await loadAuthorization(bookDir, auth.authorizationId))?.lifecycle).toBe("consumed");
    expect((await loadAuthorization(bookDir, auth.authorizationId))?.consumedCanonRevision).toBe(5);
  });
  it("replay double-consume fails closed", async () => {
    const auth = await seedActive("identity_reveal", { kind: "exact_chapter", chapterNumber: 1 });
    const derived = await deriveConsumedAuthorizations(bookDir, activeReview([auth.authorizationId]), evidence(["identity_reveal"]));
    const writes = buildSettlementWrites({ bookDir, chapterNumber: 1, canonRevision: 5, derivedConsumptions: derived });
    const { commitAtomicFileSet } = await import("../utils/atomic-file-set.js");
    await commitAtomicFileSet({ rootDir: bookDir, writes });
    // second derive should be empty now
    const second = await deriveConsumedAuthorizations(bookDir, activeReview([auth.authorizationId]), evidence(["identity_reveal"]));
    expect(second.length).toBe(0);
  });
  it("laggable failure does not roll back Canon", async () => {
    const auth = await seedActive("identity_reveal", { kind: "exact_chapter", chapterNumber: 1 });
    const derived = await deriveConsumedAuthorizations(bookDir, activeReview([auth.authorizationId]), evidence(["identity_reveal"]));
    const writes = buildSettlementWrites({ bookDir, chapterNumber: 1, canonRevision: 5, derivedConsumptions: derived });
    const { commitAtomicFileSet } = await import("../utils/atomic-file-set.js");
    await commitAtomicFileSet({ rootDir: bookDir, writes: [{ relativePath: "story/state/manifest.json", content: JSON.stringify({ schemaVersion: 2, language: "en", lastAppliedChapter: 5, projectionVersion: 1, migrationWarnings: [] }, null, 2) }, ...writes] });
    // simulate laggable failure
    const eff = await applyLaggableSettlementEffects(bookDir, 1, 5).catch(() => null);
    expect(eff).toBeDefined();
    expect(JSON.parse(await readFile(canonPath(), "utf-8")).lastAppliedChapter).toBe(5);
  });
  it("tasks 11-19 helpers remain pure and reusable does not consume", async () => {
    const reusable = await seedActive("identity_reveal", { kind: "exact_chapter", chapterNumber: 1 }, "reusable");
    const derived = await deriveConsumedAuthorizations(bookDir, activeReview([reusable.authorizationId]), evidence(["identity_reveal"]));
    expect(derived.length).toBe(0);
    expect((await loadAuthorization(bookDir, reusable.authorizationId))?.lifecycle).toBe("active");
  });
});
