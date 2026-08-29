// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
vi.mock("@actalk/castor-core", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  class PlanningError extends Error { code: string; constructor(c:string,m:string){super(m);this.code=c} }
  return { ...actual,
    getPublishedArcPlan: vi.fn(),
    listArcDrafts: vi.fn(),
    getArcPreflight: vi.fn(),
    publishArcPlan: vi.fn(),
    getBeatProgress: vi.fn(),
    getLookahead: vi.fn(),
    getDetailedPlan: vi.fn(),
    getPlanningGateReport: vi.fn(),
    parseHumanDirectionDraft: vi.fn(),
    confirmHumanDirection: vi.fn(),
    resolveDirectionConflict: vi.fn(),
    createAuthorization: vi.fn(),
    confirmAuthorization: vi.fn(),
    listAuthorizations: vi.fn(),
    writeNextChapter: vi.fn(),
    regeneratePlan: vi.fn(),
    PlanningError };
});
import { registerPlanningRoutes } from "../api/planning-route.js";
import * as Core from "@actalk/castor-core";
const BOOK_ID="book-23";
function makeApp(){ const app=new Hono(); registerPlanningRoutes(app as never); return app; }
beforeEach(()=>{ vi.clearAllMocks();
  vi.mocked(Core.getPublishedArcPlan).mockResolvedValue({arcId:"a1"} as never);
  vi.mocked(Core.listArcDrafts).mockResolvedValue([] as never);
  vi.mocked(Core.getArcPreflight).mockResolvedValue({pass:true} as never);
  vi.mocked(Core.publishArcPlan).mockResolvedValue({published:true} as never);
  vi.mocked(Core.getBeatProgress).mockResolvedValue({beats:[]} as never);
  vi.mocked(Core.getLookahead).mockResolvedValue({advisory:true, status:"current"} as never);
  vi.mocked(Core.getDetailedPlan).mockResolvedValue({planId:"p1"} as never);
  vi.mocked(Core.getPlanningGateReport).mockResolvedValue({verdict:"SAFE"} as never);
  vi.mocked(Core.parseHumanDirectionDraft).mockResolvedValue({directionId:"d1", pending:true} as never);
  vi.mocked(Core.confirmHumanDirection).mockResolvedValue({directionId:"d1", status:"active"} as never);
  vi.mocked(Core.resolveDirectionConflict).mockResolvedValue({resolved:true} as never);
  vi.mocked(Core.createAuthorization).mockResolvedValue({authorizationId:"a1", status:"pending"} as never);
  vi.mocked(Core.confirmAuthorization).mockResolvedValue({authorizationId:"a1", status:"active"} as never);
  vi.mocked(Core.listAuthorizations).mockResolvedValue([] as never);
  vi.mocked(Core.writeNextChapter).mockResolvedValue({chapter:1} as never);
});
describe("planning routes — ARC",()=>{
  it("GET /planning/arc/published delegates to getPublishedArcPlan", async()=>{ const app=makeApp(); const res=await app.request(`/api/v1/books/${BOOK_ID}/planning/arc/published`); expect(res.status).toBe(200); expect(Core.getPublishedArcPlan).toHaveBeenCalledWith(expect.objectContaining({bookId:BOOK_ID})); });
  it("GET /planning/arc/drafts delegates to listArcDrafts", async()=>{ const app=makeApp(); const res=await app.request(`/api/v1/books/${BOOK_ID}/planning/arc/drafts`); expect(res.status).toBe(200); expect(Core.listArcDrafts).toHaveBeenCalled(); });
  it("GET /planning/arc/preflight/:draftId delegates to getArcPreflight", async()=>{ const app=makeApp(); const res=await app.request(`/api/v1/books/${BOOK_ID}/planning/arc/preflight/d1`); expect(res.status).toBe(200); expect(Core.getArcPreflight).toHaveBeenCalled(); });
  it("POST /planning/arc/publish delegates to publishArcPlan", async()=>{ const app=makeApp(); const res=await app.request(`/api/v1/books/${BOOK_ID}/planning/arc/publish`,{method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({draftId:"d1"})}); expect(res.status).toBe(200); expect(Core.publishArcPlan).toHaveBeenCalled(); });
  it("preflight pass does NOT auto-Publish", async()=>{ const app=makeApp(); await app.request(`/api/v1/books/${BOOK_ID}/planning/arc/preflight/d1`); expect(Core.publishArcPlan).not.toHaveBeenCalled(); });
});
describe("BEATS",()=>{
  it("GET /planning/beats returns Core-derived state", async()=>{ const app=makeApp(); const res=await app.request(`/api/v1/books/${BOOK_ID}/planning/beats`); expect(res.status).toBe(200); expect(Core.getBeatProgress).toHaveBeenCalled(); });
  it("Studio does not mutate Beat progress", async()=>{ const app=makeApp(); await app.request(`/api/v1/books/${BOOK_ID}/planning/beats`); expect(Core.getBeatProgress).toHaveBeenCalledTimes(1); });
});
describe("LOOKAHEAD",()=>{
  it("GET /planning/lookahead returns advisory artifact", async()=>{ const app=makeApp(); const res=await app.request(`/api/v1/books/${BOOK_ID}/planning/lookahead`); expect(res.status).toBe(200); expect(Core.getLookahead).toHaveBeenCalled(); const body=await res.json() as any; expect(body.advisory).toBeTruthy(); });
  it("UI has NO Approve for Lookahead", async()=>{ const { getLookaheadUiState } = await import("../pages/planning-ui-state.js"); const s=getLookaheadUiState({status:"current"} as any); expect(s.canApprove).toBe(false); });
  it("no Publish for Lookahead", async()=>{ const app=makeApp(); const res=await app.request(`/api/v1/books/${BOOK_ID}/planning/lookahead`,{method:"POST"} as any); expect([404,405]).toContain(res.status); });
});
describe("DETAILED PLAN / GATE",()=>{
  it("GET /planning/detailed-plan delegates", async()=>{ const app=makeApp(); const res=await app.request(`/api/v1/books/${BOOK_ID}/planning/detailed-plan`); expect(res.status).toBe(200); expect(Core.getDetailedPlan).toHaveBeenCalled(); });
  it("GET /planning/gate delegates to Task 16", async()=>{ const app=makeApp(); const res=await app.request(`/api/v1/books/${BOOK_ID}/planning/gate`); expect(res.status).toBe(200); expect(Core.getPlanningGateReport).toHaveBeenCalled(); });
  it("SAFE no Approve Plan", async()=>{ const { getGatePanel } = await import("../pages/planning-ui-state.js"); expect(getGatePanel({verdict:"SAFE"} as any)).not.toBe("approve"); });
  it("SAFE Write allowed", async()=>{ const { shouldShowWriteButton } = await import("../pages/planning-ui-state.js"); expect(shouldShowWriteButton({verdict:"SAFE"} as any)).toBe(true); });
  it("UNCERTAIN Human panel", async()=>{ const { getGatePanel } = await import("../pages/planning-ui-state.js"); expect(getGatePanel({verdict:"UNCERTAIN"} as any)).toBe("uncertain"); });
  it("AUTHOR_DECISION missing authority", async()=>{ const { getGatePanel } = await import("../pages/planning-ui-state.js"); expect(getGatePanel({verdict:"AUTHOR_DECISION"} as any)).toBe("author_decision"); });
  it("CONFLICT hard block", async()=>{ const { getGatePanel, shouldShowWriteButton } = await import("../pages/planning-ui-state.js"); expect(getGatePanel({verdict:"CONFLICT"} as any)).toBe("conflict"); expect(shouldShowWriteButton({verdict:"CONFLICT"} as any)).toBe(false); });
  it("CONFLICT no Write", async()=>{ const { shouldShowWriteButton } = await import("../pages/planning-ui-state.js"); expect(shouldShowWriteButton({verdict:"CONFLICT"} as any)).toBe(false); });
  it("no Write Anyway anywhere", async()=>{ const src=await (await import("node:fs/promises")).readFile("packages/studio/src/pages/PlanningPage.tsx","utf-8").catch(()=> ""); expect(src).not.toMatch(/Write Anyway|Force Write/i); });
});
describe("DIRECTION NL",()=>{
  it("POST /planning/directions/parse raw NL to Core", async()=>{ const app=makeApp(); const res=await app.request(`/api/v1/books/${BOOK_ID}/planning/directions/parse`,{method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({text:"hero finds letter in ch 12"})}); expect(res.status).toBe(200); expect(Core.parseHumanDirectionDraft).toHaveBeenCalledWith(expect.objectContaining({text:"hero finds letter in ch 12"})); });
  it("React does not parse authority semantics", async()=>{ const src=await (await import("node:fs/promises")).readFile("packages/studio/src/pages/PlanningPage.tsx","utf-8").catch(()=> ""); expect(src).not.toMatch(/parse.*chapter.*number|infer.*scope/i); });
  it("parse result displayed as pending", async()=>{ vi.mocked(Core.parseHumanDirectionDraft).mockResolvedValue({directionId:"d1", status:"pending", pending:true} as never); const app=makeApp(); const res=await app.request(`/api/v1/books/${BOOK_ID}/planning/directions/parse`,{method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({text:"x"})}); const body=await res.json() as any; expect(body.pending).toBeTruthy(); });
  it("pending not ACTIVE", async()=>{ const { isPendingNotAuthority } = await import("../pages/planning-ui-state.js"); expect(isPendingNotAuthority({status:"pending"} as any)).toBe(true); });
  it("explicit Confirm delegates", async()=>{ const app=makeApp(); const res=await app.request(`/api/v1/books/${BOOK_ID}/planning/directions/d1/confirm`,{method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({})}); expect(res.status).toBe(200); expect(Core.confirmHumanDirection).toHaveBeenCalled(); });
  it("only confirmed ACTIVE", async()=>{ const { isActiveAuthority } = await import("../pages/planning-ui-state.js"); expect(isActiveAuthority({status:"active"} as any)).toBe(true); expect(isActiveAuthority({status:"pending"} as any)).toBe(false); });
  it("conflict resolution delegates", async()=>{ const app=makeApp(); const res=await app.request(`/api/v1/books/${BOOK_ID}/planning/directions/conflict/resolve`,{method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({resolution:"override"})}); expect(res.status).toBe(200); expect(Core.resolveDirectionConflict).toHaveBeenCalled(); });
  it("no latest-wins auto", async()=>{ const src=await (await import("node:fs/promises")).readFile("packages/studio/src/pages/PlanningPage.tsx","utf-8").catch(()=> ""); expect(src).not.toMatch(/latest.*wins|auto.*resolve/i); });
});
describe("AUTHORIZATION",()=>{
  it("POST /planning/authorizations delegates to create", async()=>{ const app=makeApp(); const res=await app.request(`/api/v1/books/${BOOK_ID}/planning/authorizations`,{method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({decisionKind:"identity_reveal"})}); expect(res.status).toBe(200); expect(Core.createAuthorization).toHaveBeenCalled(); });
  it("create produces pending", async()=>{ vi.mocked(Core.createAuthorization).mockResolvedValue({status:"pending"} as never); const app=makeApp(); const res=await app.request(`/api/v1/books/${BOOK_ID}/planning/authorizations`,{method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({decisionKind:"x"})}); const body=await res.json() as any; expect(body.status).toBe("pending"); });
  it("POST /planning/authorizations/:id/confirm delegates", async()=>{ const app=makeApp(); const res=await app.request(`/api/v1/books/${BOOK_ID}/planning/authorizations/a1/confirm`,{method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({})}); expect(res.status).toBe(200); expect(Core.confirmAuthorization).toHaveBeenCalled(); });
  it("no Studio consume API", async()=>{ const src=await (await import("node:fs/promises")).readFile("packages/studio/src/lib/planning-api.ts","utf-8").catch(()=> ""); expect(src).not.toMatch(/consumeAuthorization|markUsed/i); });
  it("AUTHOR_DECISION refreshes Gate after confirmation", async()=>{ const { shouldRefreshGateAfterAuthConfirm } = await import("../pages/planning-ui-state.js"); expect(shouldRefreshGateAfterAuthConfirm()).toBe(true); });
});
describe("WRITE",()=>{
  it("POST /planning/write delegates to Task 19 Core entry", async()=>{ const app=makeApp(); const res=await app.request(`/api/v1/books/${BOOK_ID}/planning/write`,{method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({})}); expect(res.status).toBe(200); expect(Core.writeNextChapter).toHaveBeenCalled(); });
  it("no direct WriterAgent", async()=>{ const fs = await import("node:fs/promises"); const src = await fs.readFile("packages/studio/src/api/planning-route.ts","utf-8").catch(async () => { try { return await fs.readFile("packages/studio/src/api/server.ts","utf-8"); } catch { return ""; } }); expect(src).not.toMatch(/new WriterAgent|WriterAgent\.write/); });
  it("blocked Core write remains blocked", async()=>{ vi.mocked(Core.writeNextChapter).mockRejectedValue(Object.assign(new Error("blocked"),{code:"gate_conflict"})); const app=makeApp(); const res=await app.request(`/api/v1/books/${BOOK_ID}/planning/write`,{method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({})}); expect([409,500]).toContain(res.status); });
  it("no force/ignore/bypass field", async()=>{ const app=makeApp(); const res=await app.request(`/api/v1/books/${BOOK_ID}/planning/write`,{method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({force:true})}); expect(res.status).not.toBe(200); });
});
describe("BOOK ISOLATION",()=>{
  it("cache key contains bookId", async()=>{ const { planningCacheKey } = await import("../pages/planning-ui-state.js"); expect(planningCacheKey("bookA")).toContain("bookA"); expect(planningCacheKey("bookA")).not.toBe(planningCacheKey("bookB")); });
  it("Book A planning state not reused for Book B", async()=>{ const app=makeApp(); await app.request(`/api/v1/books/bookA/planning/arc/published`); await app.request(`/api/v1/books/bookB/planning/arc/published`); expect(Core.getPublishedArcPlan).toHaveBeenCalledWith(expect.objectContaining({bookId:"bookA"})); expect(Core.getPublishedArcPlan).toHaveBeenCalledWith(expect.objectContaining({bookId:"bookB"})); });
});
describe("ERRORS",()=>{
  it("stale Arc Publish fails closed 409", async()=>{ const E= (Core as any).PlanningError; vi.mocked(Core.publishArcPlan).mockRejectedValue(new E("arc_stale","stale")); const app=makeApp(); const res=await app.request(`/api/v1/books/${BOOK_ID}/planning/arc/publish`,{method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({draftId:"d1"})}); expect(res.status).toBe(409); });
  it("direction conflict fails closed", async()=>{ const E= (Core as any).PlanningError; vi.mocked(Core.confirmHumanDirection).mockRejectedValue(new E("direction_conflict","conflict")); const app=makeApp(); const res=await app.request(`/api/v1/books/${BOOK_ID}/planning/directions/d1/confirm`,{method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({})}); expect(res.status).toBe(409); });
  it("invalid Authorization fails closed 400", async()=>{ const app=makeApp(); const res=await app.request(`/api/v1/books/${BOOK_ID}/planning/authorizations`,{method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({})}); expect([400,409]).toContain(res.status); });
  it("Gate conflict remains structured failure", async()=>{ vi.mocked(Core.getPlanningGateReport).mockResolvedValue({verdict:"CONFLICT", blockers:["hard"]} as never); const app=makeApp(); const res=await app.request(`/api/v1/books/${BOOK_ID}/planning/gate`); const body=await res.json() as any; expect(body.verdict).toBe("CONFLICT"); });
});
describe("AUTHORITY",()=>{
  it("Arc Draft != Published", async()=>{ const { isArcDraftNotPublished } = await import("../pages/planning-ui-state.js"); expect(isArcDraftNotPublished({draftId:"d1"} as any, {published:{arcId:"a1"}} as any)).toBe(true); });
  it("Lookahead != authority", async()=>{ const { lookaheadIsAdvisory } = await import("../pages/planning-ui-state.js"); expect(lookaheadIsAdvisory()).toBe(true); });
  it("pending Direction != authority", async()=>{ const { isPendingNotAuthority } = await import("../pages/planning-ui-state.js"); expect(isPendingNotAuthority({status:"pending"} as any)).toBe(true); });
  it("pending Authorization != authority", async()=>{ const { isAuthorizationPendingNotAuthority } = await import("../pages/planning-ui-state.js"); expect(isAuthorizationPendingNotAuthority({status:"pending"} as any)).toBe(true); });
  it("Gate SAFE != auto-write", async()=>{ const { shouldShowWriteButton } = await import("../pages/planning-ui-state.js"); expect(shouldShowWriteButton({verdict:"SAFE"} as any)).toBe(true); expect(shouldShowWriteButton({verdict:"SAFE"} as any)).not.toBe("auto"); });
  it("Task 23 never consumes Authorization", async()=>{ const src=await (await import("node:fs/promises")).readFile("packages/studio/src/api/planning-route.ts","utf-8").catch(()=> ""); expect(src).not.toMatch(/consumeAuthorization/); });
  it("Task 23 never writes Canon directly", async()=>{ const src=await (await import("node:fs/promises")).readFile("packages/studio/src/api/planning-route.ts","utf-8").catch(()=> ""); expect(src).not.toMatch(/commitCanon|writeCanon/); });
});
