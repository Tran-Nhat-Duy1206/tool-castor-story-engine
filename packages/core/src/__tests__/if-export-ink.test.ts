import { describe, expect, it } from "vitest";
import { exportInk } from "../interactive-film/export-ink.js";
import { StoryGraphSchema } from "../interactive-film/graph-schema.js";

const graph = StoryGraphSchema.parse({
  schemaVersion: 1, projectId: "p", title: "T",
  variables: [{ name: "trust", type: "counter", default: 0, desc: "" }],
  nodes: [
    { id: "s", type: "start", title: "Mo dau", sceneDesc: "Cong dien", dialogue: [{ speaker: "A Mei", text: "Kiem tra so sach", emotion: "kien dinh" }],
      choices: [
        { id: "a", text: "Cong khai", targetNodeId: "e1", effects: [{ var: "trust", op: "add", value: 1 }] },
        { id: "b", text: "mock_text", targetNodeId: "e2", condition: { var: "trust", op: ">=", value: 1 } },
      ] },
    { id: "e1", type: "ending", title: "Su that", choices: [] },
    { id: "e2", type: "ending", title: "mock_text", choices: [] },
  ],
  endings: [{ id: "g1", nodeId: "e1", title: "Su that", type: "good" }, { id: "b1", nodeId: "e2", title: "mock_text", type: "bad" }],
});

describe("exportInk", () => {
  it("declares variables", () => { expect(exportInk(graph)).toContain("VAR trust = 0"); });
  it("emits a knot per node", () => { const ink = exportInk(graph); expect(ink).toContain("=== node_s ==="); expect(ink).toContain("=== node_e1 ==="); });
  it("maps a choice with a divert", () => { expect(exportInk(graph)).toMatch(/\*\s*\[Cong khai\][\s\S]*?->\s*node_e1/); });
  it("emits a choice's effect before its divert (so it actually applies)", () => {
    const ink = exportInk(graph);
    const eff = ink.indexOf("~ trust += 1");
    const div = ink.indexOf("-> node_e1");
    expect(eff).toBeGreaterThan(-1);
    expect(div).toBeGreaterThan(-1);
    expect(eff).toBeLessThan(div);
  });
  it("maps a conditional choice", () => { expect(exportInk(graph)).toMatch(/\{\s*trust\s*>=\s*1\s*\}/); });
  it("maps an effect", () => { expect(exportInk(graph)).toMatch(/~\s*trust\s*\+=\s*1/); });
  it("ends ending knots with -> END", () => { const ink = exportInk(graph); const e1 = ink.slice(ink.indexOf("=== node_e1 ===")); expect(e1).toContain("-> END"); });
});
