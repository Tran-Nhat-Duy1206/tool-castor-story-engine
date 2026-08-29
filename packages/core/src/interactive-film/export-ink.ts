import type { StoryGraph, StoryNode, Choice } from "./graph-schema.js";

function sanitize(id: string): string {
  const s = id.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[0-9]/.test(s) ? `n_${s}` : s;
}
const knot = (id: string) => `node_${sanitize(id)}`;
const effectLine = (e: { var: string; op: string; value: number | string | boolean }): string => {
  const v = typeof e.value === "string" ? JSON.stringify(e.value) : String(e.value);
  if (e.op === "add") return `    ~ ${sanitize(e.var)} += ${v}`;
  if (e.op === "sub") return `    ~ ${sanitize(e.var)} -= ${v}`;
  return `    ~ ${sanitize(e.var)} = ${v}`; // set
};

export function exportInk(graph: StoryGraph): string {
  const lines: string[] = [];
  lines.push(`// ${graph.title || graph.projectId} — exported from Castor interactive film`);
  for (const v of graph.variables) {
    const d = typeof v.default === "string" ? JSON.stringify(v.default) : String(v.default);
    lines.push(`VAR ${sanitize(v.name)} = ${d}`);
  }
  const start = graph.nodes.find((n) => n.type === "start") ?? graph.nodes[0];
  if (start) lines.push("", `-> ${knot(start.id)}`);
  const endingNodeIds = new Set(graph.endings.map((e) => e.nodeId));
  for (const node of graph.nodes) {
    lines.push("", `=== ${knot(node.id)} ===`);
    if (node.title) lines.push(`# ${node.title}`);
    if (node.sceneDesc) lines.push(node.sceneDesc);
    for (const d of node.dialogue ?? []) lines.push(`${d.speaker}: ${d.text}`);
    if (node.type === "ending" || endingNodeIds.has(node.id)) {
      lines.push("-> END");
      continue;
    }
    if (node.choices.length === 0) { lines.push("-> END"); continue; }
    for (const c of node.choices as Choice[]) {
      const cond = c.condition ? ` {${sanitize(c.condition.var)} ${c.condition.op} ${typeof c.condition.value === "string" ? JSON.stringify(c.condition.value) : c.condition.value}}` : "";
      lines.push(`*${cond} [${c.text}]`);
      for (const e of c.effects ?? []) lines.push(effectLine(e));
      lines.push(`    -> ${knot(c.targetNodeId)}`);
    }
  }
  return lines.join("\n") + "\n";
}
