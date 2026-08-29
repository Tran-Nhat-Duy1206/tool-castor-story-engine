import type { StoryGraph } from "@actalk/castor-core/interactive-film/graph-schema";

export interface FlowNodeData {
  readonly label: string;
  readonly nodeType: string;
}
export interface FlowNode {
  readonly id: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly data: FlowNodeData;
  readonly type: "story";
}
export interface FlowEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly label: string;
}

const COL = 280;
const ROW = 140;

export function layoutStoryGraph(graph: StoryGraph): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const ids = new Set(graph.nodes.map((n) => n.id));
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  const start = graph.nodes.find((n) => n.type === "start") ?? graph.nodes[0];
  const depth = new Map<string, number>();
  if (start) {
    const queue: Array<{ id: string; d: number }> = [{ id: start.id, d: 0 }];
    while (queue.length > 0) {
      const { id, d } = queue.shift()!;
      if (depth.has(id)) continue;
      depth.set(id, d);
      const node = nodeMap.get(id);
      if (!node) continue;
      for (const choice of node.choices) {
        if (ids.has(choice.targetNodeId) && !depth.has(choice.targetNodeId)) {
          queue.push({ id: choice.targetNodeId, d: d + 1 });
        }
      }
    }
  }
  const maxDepth = depth.size > 0 ? Math.max(...depth.values()) : 0;
  for (const node of graph.nodes) {
    if (!depth.has(node.id)) depth.set(node.id, maxDepth + 1);
  }

  const rowByDepth = new Map<number, number>();
  const nodes: FlowNode[] = graph.nodes.map((node) => {
    const d = depth.get(node.id) ?? 0;
    const row = rowByDepth.get(d) ?? 0;
    rowByDepth.set(d, row + 1);
    return {
      id: node.id,
      position: node.position ?? { x: d * COL, y: row * ROW },
      data: { label: node.title || node.id, nodeType: node.type },
      type: "story",
    };
  });

  const edges: FlowEdge[] = [];
  for (const node of graph.nodes) {
    for (const choice of node.choices) {
      if (!ids.has(choice.targetNodeId)) continue;
      edges.push({ id: `${node.id}->${choice.id}`, source: node.id, target: choice.targetNodeId, label: choice.text });
    }
  }

  return { nodes, edges };
}
