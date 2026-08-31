import { describe, expect, it } from "vitest";
import { SessionKindSchema } from "../interaction/session.js";
import { RequestedIntentSchema, ActionPayloadSchema } from "../interaction/action-envelope.js";

describe("phase-2b envelope extensions", () => {
  it("accepts the new session kind", () => {
    expect(SessionKindSchema.parse("interactive-film-authoring")).toBe("interactive-film-authoring");
  });
  it("accepts the confirm-class intents", () => {
    for (const i of ["draft_structure", "connect_choice", "remove_node"]) {
      expect(RequestedIntentSchema.parse(i)).toBe(i);
    }
  });
  it("accepts draftStructure payload", () => {
    const p = ActionPayloadSchema.parse({ draftStructure: { projectId: "p", instruction: "mock_text" } });
    expect(p.draftStructure?.projectId).toBe("p");
  });
  it("accepts connectChoice + removeNode payloads", () => {
    expect(ActionPayloadSchema.parse({ connectChoice: { projectId: "p", node: { id: "s", type: "branch", choices: [] } } }).connectChoice?.projectId).toBe("p");
    expect(ActionPayloadSchema.parse({ removeNode: { projectId: "p", nodeId: "n1" } }).removeNode?.nodeId).toBe("n1");
  });
});
