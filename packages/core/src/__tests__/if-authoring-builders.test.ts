import { describe, expect, it } from "vitest";
import {
  buildWorldAnchorDelta,
  buildAddVariableDelta,
  buildDefineEndingDelta,
  buildRemoveNodeDelta,
  buildConnectChoiceDelta,
} from "../interactive-film/authoring-tools.js";
import { StoryGraphDeltaSchema } from "../interactive-film/delta.js";
import { StoryNodeSchema } from "../interactive-film/graph-schema.js";

describe("delta builders", () => {
  it("world anchor patch", () => {
    const d = buildWorldAnchorDelta({ theme: "mock_text" });
    expect(() => StoryGraphDeltaSchema.parse(d)).not.toThrow();
    expect(d.worldAnchor).toEqual({ theme: "mock_text" });
  });
  it("add variable", () => {
    const d = buildAddVariableDelta({ name: "trust", type: "counter", default: 0, desc: "mock_text" });
    expect(d.variables?.upsert?.[0].name).toBe("trust");
  });
  it("define ending", () => {
    const d = buildDefineEndingDelta({ id: "g", nodeId: "e", title: "mock_text", type: "good", description: "" });
    expect(d.endings?.upsert?.[0].nodeId).toBe("e");
  });
  it("remove node", () => {
    expect(buildRemoveNodeDelta("n1").nodes?.remove).toEqual(["n1"]);
  });
  it("connect choice = node upsert", () => {
    const node = StoryNodeSchema.parse({ id: "s", type: "branch", choices: [{ id: "c1", text: "A", targetNodeId: "n2" }] });
    const d = buildConnectChoiceDelta(node);
    expect(d.nodes?.upsert?.[0].choices?.[0].targetNodeId).toBe("n2");
  });
});
