import { describe, expect, it } from "vitest";
import { moveNodeDelta, addNodeDelta, addChoiceDelta, removeChoiceDelta, removeChoicesDelta, removeNodeDelta } from "../lib/story-editor-deltas";
import { StoryNodeSchema } from "@actalk/castor-core";

const node = StoryNodeSchema.parse({ id: "s", type: "branch", title: "T", choices: [{ id: "c1", text: "A", targetNodeId: "e" }] });

describe("editor delta builders", () => {
  it("moveNodeDelta upserts the node with new position, preserving fields", () => {
    const d = moveNodeDelta(node, 12, 34) as { delta: { nodes: { upsert: any[] } } };
    const up = d.delta.nodes.upsert[0];
    expect(up.position).toEqual({ x: 12, y: 34 });
    expect(up.choices[0].targetNodeId).toBe("e"); // preserved
  });
  it("addNodeDelta upserts the given node", () => {
    const d = addNodeDelta(StoryNodeSchema.parse({ id: "n2", type: "normal", choices: [] })) as { delta: { nodes: { upsert: any[] } } };
    expect(d.delta.nodes.upsert[0].id).toBe("n2");
  });
  it("addChoiceDelta appends a choice to the source node", () => {
    const d = addChoiceDelta(node, { id: "c2", text: "mock_val", targetNodeId: "e2" }) as { delta: { nodes: { upsert: any[] } } };
    const up = d.delta.nodes.upsert[0];
    expect(up.choices.map((c: any) => c.id)).toEqual(["c1", "c2"]);
  });
  it("removeChoiceDelta drops the choice from the source node", () => {
    const d = removeChoiceDelta(node, "c1") as { delta: { nodes: { upsert: any[] } } };
    expect(d.delta.nodes.upsert[0].choices).toEqual([]);
  });
  it("removeChoicesDelta drops multiple choices in a single delta", () => {
    const multiNode = StoryNodeSchema.parse({
      id: "m",
      type: "branch",
      title: "Multi",
      choices: [
        { id: "c1", text: "A", targetNodeId: "e1" },
        { id: "c2", text: "B", targetNodeId: "e2" },
        { id: "c3", text: "C", targetNodeId: "e3" },
      ],
    });
    const d = removeChoicesDelta(multiNode, ["c1", "c3"]) as { delta: { nodes: { upsert: any[] } } };
    const remaining = d.delta.nodes.upsert[0].choices;
    expect(remaining.map((c: any) => c.id)).toEqual(["c2"]);
  });
  it("removeNodeDelta removes by id", () => {
    const d = removeNodeDelta("x") as { delta: { nodes: { remove: string[] } } };
    expect(d.delta.nodes.remove).toEqual(["x"]);
  });
});
