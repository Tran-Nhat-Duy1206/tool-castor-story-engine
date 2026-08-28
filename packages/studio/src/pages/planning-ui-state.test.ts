import { describe, it, expect } from "vitest";
import { getGatePanel, getValidActions, shouldShowWriteButton, hasNoApproveForSafe, hasNoWriteAnyway, lookaheadIsAdvisory, isPendingNotAuthority, isActiveAuthority, isAuthorizationPendingNotAuthority, planningCacheKey, isArcDraftNotPublished } from "./planning-ui-state.js";

describe("planning-ui-state pure",()=>{
  it("getGatePanel SAFE",()=>{ expect(getGatePanel({verdict:"SAFE"} as any)).toBe("safe"); });
  it("getGatePanel UNCERTAIN",()=>{ expect(getGatePanel({verdict:"UNCERTAIN"} as any)).toBe("uncertain"); });
  it("getGatePanel AUTHOR_DECISION",()=>{ expect(getGatePanel({verdict:"AUTHOR_DECISION"} as any)).toBe("author_decision"); });
  it("getGatePanel CONFLICT",()=>{ expect(getGatePanel({verdict:"CONFLICT"} as any)).toBe("conflict"); });
  it("getValidActions SAFE includes write",()=>{ expect(getValidActions({verdict:"SAFE"} as any)).toContain("write"); });
  it("getValidActions CONFLICT is block",()=>{ expect(getValidActions({verdict:"CONFLICT"} as any)).toContain("block"); });
  it("shouldShowWriteButton true only for SAFE",()=>{ expect(shouldShowWriteButton({verdict:"SAFE"} as any)).toBe(true); expect(shouldShowWriteButton({verdict:"CONFLICT"} as any)).toBe(false); expect(shouldShowWriteButton({verdict:"UNCERTAIN"} as any)).toBe(false); expect(shouldShowWriteButton({verdict:"AUTHOR_DECISION"} as any)).toBe(false); });
  it("hasNoApproveForSafe",()=>{ expect(hasNoApproveForSafe({verdict:"SAFE"} as any)).toBe(true); });
  it("hasNoWriteAnyway",()=>{ expect(hasNoWriteAnyway()).toBe(true); });
  it("lookaheadIsAdvisory",()=>{ expect(lookaheadIsAdvisory()).toBe(true); });
  it("isPendingNotAuthority",()=>{ expect(isPendingNotAuthority({status:"pending"} as any)).toBe(true); expect(isPendingNotAuthority({status:"active"} as any)).toBe(false); });
  it("isActiveAuthority",()=>{ expect(isActiveAuthority({status:"active"} as any)).toBe(true); expect(isActiveAuthority({status:"pending"} as any)).toBe(false); });
  it("isAuthorizationPendingNotAuthority",()=>{ expect(isAuthorizationPendingNotAuthority({status:"pending"} as any)).toBe(true); });
  it("planningCacheKey contains bookId",()=>{ expect(planningCacheKey("bookA")).toContain("bookA"); expect(planningCacheKey("bookA")).not.toBe(planningCacheKey("bookB")); });
  it("isArcDraftNotPublished",()=>{ expect(isArcDraftNotPublished({draftId:"d1"} as any, {published:{arcId:"a1"}} as any)).toBe(true); });
  it("pending direction display mode", async()=>{ const { getPendingDirectionDisplayMode } = await import("./planning-ui-state.js"); expect(getPendingDirectionDisplayMode({status:"pending"} as any)).toBe("pending"); });
  it("lookahead stale/current", async()=>{ const { getLookaheadStatusLabel } = await import("./planning-ui-state.js"); expect(getLookaheadStatusLabel({status:"current"} as any)).toBe("current"); expect(getLookaheadStatusLabel({status:"stale"} as any)).toBe("stale"); });
  it("Published-vs-Draft", async()=>{ const { getPublishedVsDraftMode } = await import("./planning-ui-state.js"); expect(getPublishedVsDraftMode({published:{arcId:"a1"}}, {draftId:"d1"} as any).mode).toBe("draft"); expect(getPublishedVsDraftMode({published:{arcId:"a1"}}, null).mode).toBe("published-only"); });
});
