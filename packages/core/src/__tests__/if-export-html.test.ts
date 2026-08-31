import { describe, expect, it } from "vitest";
import { buildPlayableHtml } from "../interactive-film/export-html.js";
import { StoryGraphSchema } from "../interactive-film/graph-schema.js";

const graph = StoryGraphSchema.parse({
  schemaVersion: 1, projectId: "p", title: "mock_text", variables: [{ name: "trust", type: "counter", default: 0, desc: "" }],
  nodes: [
    { id: "s", type: "start", title: "Mo dau", sceneDesc: "Cong dien", imageSlot: { prompt: "mock_text", assetRef: "interactive-films/p/assets/nodes/s.png" },
      choices: [{ id: "c", text: "mock_text", targetNodeId: "e", effects: [{ var: "trust", op: "add", value: 1 }] }] },
    { id: "e", type: "ending", title: "Su that", choices: [] },
  ],
  endings: [{ id: "g1", nodeId: "e", title: "Su that", type: "good" }],
});

describe("buildPlayableHtml", () => {
  it("is self-contained (no external http references)", () => {
    const html = buildPlayableHtml(graph);
    expect(html).toContain("<!doctype html>");
    expect(html).not.toMatch(/src=["']https?:\/\//);
    expect(html).not.toMatch(/href=["']https?:\/\//);
  });
  it("embeds the graph and a player marker", () => {
    const html = buildPlayableHtml(graph);
    expect(html).toContain("mock_text");
    expect(html).toContain("trust"); // graph embedded
    expect(html).toMatch(/data-if-player|id="if-player"/); // player root marker
  });
  it("inlines provided asset data URIs", () => {
    const html = buildPlayableHtml(graph, { assetDataUris: { "interactive-films/p/assets/nodes/s.png": "data:image/png;base64,AAAA" } });
    expect(html).toContain("data:image/png;base64,AAAA");
  });

  // XSS: Fix 1 — title must be entity-escaped in <title> and <h1>
  it("escapes XSS payload in graph title (Fix 1)", () => {
    const xssGraph = StoryGraphSchema.parse({
      schemaVersion: 1,
      projectId: "xss-title",
      title: '</title><script>BAD</script>',
      nodes: [{ id: "s", type: "start", title: "start", choices: [] }],
    });
    const html = buildPlayableHtml(xssGraph);
    // The raw injection string must not appear — it should be entity-escaped
    expect(html).not.toContain('<script>BAD</script>');
    expect(html).toContain('&lt;script&gt;BAD&lt;/script&gt;');
  });

  // Determinism parity: relational ops must Number()-coerce both operands (mirrors evaluator.ts)
  it("player evalCond uses Number() coercion for relational ops (parity with evaluator)", () => {
    const html = buildPlayableHtml(graph);
    // All four relational ops must use Number(v) and Number(c.value)
    expect(html).toMatch(/Number\(v\)\s*>=\s*Number\(c\.value\)/);
    expect(html).toMatch(/Number\(v\)\s*<=\s*Number\(c\.value\)/);
    expect(html).toMatch(/Number\(v\)\s*>\s*Number\(c\.value\)/);
    expect(html).toMatch(/Number\(v\)\s*<\s*Number\(c\.value\)/);
    // Raw lexical comparison must not appear for relational ops
    expect(html).not.toMatch(/return v>=c\.value/);
    expect(html).not.toMatch(/return v<=c\.value/);
    expect(html).not.toMatch(/return v>c\.value/);
    expect(html).not.toMatch(/return v<c\.value/);
    // add/sub effects must Number()-coerce
    expect(html).toMatch(/Number\(vars\[e\.var\]\|\|0\)\+Number\(e\.value\)/);
    expect(html).toMatch(/Number\(vars\[e\.var\]\|\|0\)-Number\(e\.value\)/);
  });

  // XSS: Fix 2 — node content embedded in JSON is escaped by esc() so the raw onerror attribute never appears
  it("does not embed raw onerror attribute from node content (Fix 2)", () => {
    const xssGraph = StoryGraphSchema.parse({
      schemaVersion: 1,
      projectId: "xss-node",
      title: "safe title",
      nodes: [
        {
          id: "s",
          type: "start",
          title: '<img src=x onerror=alert(1)>',
          sceneDesc: "safe",
          dialogue: [{ speaker: '<b onerror=BAD>', text: 'hello' }],
          choices: [{ id: "c1", text: '<svg onload=evil()>', targetNodeId: "e" }],
        },
        { id: "e", type: "ending", title: "end", choices: [] },
      ],
    });
    const html = buildPlayableHtml(xssGraph);
    // esc() turns < into < in the JSON payload, so the literal tag never appears in the static HTML
    expect(html).not.toContain('<img src=x onerror=');
    expect(html).not.toContain('<b onerror=');
    expect(html).not.toContain('<svg onload=');
  });
});
