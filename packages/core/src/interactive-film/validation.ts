import type { StoryGraph, StoryNode } from "./graph-schema.js";
import { enumerateRuntimePaths } from "./paths.js";

export interface ValidationIssue {
  readonly code: "DEAD_END" | "BROKEN_LINK" | "UNREACHABLE" | "NO_PATH_TO_ENDING" | "VARIABLE_UNWRITTEN" | "VARIABLE_UNUSED" | "ENDING_VARIETY" | "IMAGE_MISSING" | "GATED_UNREACHABLE" | "ENDING_UNREACHABLE" | "ILLUSORY_BRANCH" | "LINEAR_GRAPH" | "ISOLATED_NODE" | "LONG_LINEAR_CHAIN";
  readonly level: "error" | "warning" | "info";
  readonly message: string;
  readonly nodeIds: readonly string[];
}

export interface ValidationReport {
  readonly ok: boolean;
  readonly issues: readonly ValidationIssue[];
}

function label(node: StoryNode): string {
  return node.title || node.id;
}

export function validateStoryGraph(graph: StoryGraph): ValidationReport {
  const issues: ValidationIssue[] = [];
  const ids = new Set(graph.nodes.map((n) => n.id));
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  // BROKEN_LINK
  for (const node of graph.nodes) {
    for (const c of node.choices) {
      if (!ids.has(c.targetNodeId)) {
        issues.push({
          code: "BROKEN_LINK",
          level: "error",
          message: `Lựa chọn "${c.text}" của nút "${label(node)}" trỏ đến nút không tồn tại ${c.targetNodeId}`,
          nodeIds: [node.id],
        });
      }
    }
  }

  // DEAD_END: non-ending node with no exits to existing nodes
  for (const node of graph.nodes) {
    if (node.type === "ending") continue;
    const hasExit = node.choices.some((c) => ids.has(c.targetNodeId));
    if (!hasExit) {
      issues.push({
        code: "DEAD_END",
        level: "error",
        message: `Nút phi kết thúc "${label(node)}" không có lối ra nào`,
        nodeIds: [node.id],
      });
    }
  }

  // UNREACHABLE: not reachable from start via static BFS
  const start = graph.nodes.find((n) => n.type === "start");
  const reachable = new Set<string>();
  if (start) {
    const queue = [start.id];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (reachable.has(cur)) continue;
      reachable.add(cur);
      const node = nodeMap.get(cur);
      if (!node) continue;
      for (const c of node.choices) {
        if (ids.has(c.targetNodeId) && !reachable.has(c.targetNodeId)) {
          queue.push(c.targetNodeId);
        }
      }
    }
  }
  for (const node of graph.nodes) {
    if (!reachable.has(node.id)) {
      issues.push({
        code: "UNREACHABLE",
        level: "error",
        message: `Nút "${label(node)}" không thể tiếp cận từ nút bắt đầu`,
        nodeIds: [node.id],
      });
    }
  }

  // NO_PATH_TO_ENDING
  const endingIds = new Set(graph.endings.map((e) => e.nodeId).filter((id) => ids.has(id)));
  const canReachEnding = new Set<string>(endingIds);
  const rev = new Map<string, string[]>();
  for (const n of graph.nodes) {
    for (const c of n.choices) {
      if (!rev.has(c.targetNodeId)) rev.set(c.targetNodeId, []);
      rev.get(c.targetNodeId)!.push(n.id);
    }
  }
  const revQueue = [...endingIds];
  while (revQueue.length > 0) {
    const cur = revQueue.shift()!;
    for (const pred of rev.get(cur) ?? []) {
      if (!canReachEnding.has(pred)) {
        canReachEnding.add(pred);
        revQueue.push(pred);
      }
    }
  }
  for (const node of graph.nodes) {
    if (reachable.has(node.id) && !canReachEnding.has(node.id)) {
      issues.push({
        code: "NO_PATH_TO_ENDING",
        level: "error",
        message: `Nút "${label(node)}" không thể dẫn tới bất kỳ kết thúc nào`,
        nodeIds: [node.id],
      });
    }
  }

  return { ok: issues.every((i) => i.level !== "error"), issues };
}

export function reviewStoryGraph(graph: StoryGraph): ValidationReport {
  const issues: ValidationIssue[] = [...validateStoryGraph(graph).issues];

  const reads = new Set<string>();
  const writes = new Set<string>();
  for (const node of graph.nodes) {
    for (const choice of node.choices) {
      if (choice.condition) reads.add(choice.condition.var);
      for (const effect of choice.effects) writes.add(effect.var);
    }
  }
  for (const v of reads) {
    if (!writes.has(v)) {
      issues.push({
        code: "VARIABLE_UNWRITTEN",
        level: "warning",
        message: `Biến "${v}" được đọc bởi điều kiện lựa chọn, nhưng không có lựa chọn nào ghi vào nó`,
        nodeIds: [],
      });
    }
  }
  for (const v of graph.variables.map((vv) => vv.name)) {
    if (!reads.has(v) && !writes.has(v)) {
      issues.push({
        code: "VARIABLE_UNUSED",
        level: "info",
        message: `Biến "${v}" đã khai báo nhưng không được sử dụng`,
        nodeIds: [],
      });
    }
  }

  if (graph.endings.length >= 2) {
    const types = new Set(graph.endings.map((e) => e.type));
    if (types.size === 1) {
      issues.push({
        code: "ENDING_VARIETY",
        level: "info",
        message: `Tất cả ${graph.endings.length} kết thúc đều cùng một loại (${[...types][0]})`,
        nodeIds: graph.endings.map((e) => e.nodeId),
      });
    }
  }

  for (const node of graph.nodes) {
    if (node.type !== "ending" && !node.imageSlot?.assetRef) {
      issues.push({
        code: "IMAGE_MISSING",
        level: "info",
        message: `Nút "${node.title || node.id}" chưa có ảnh minh họa`,
        nodeIds: [node.id],
      });
    }
  }

  const { paths, truncated } = enumerateRuntimePaths(graph);
  const reachedNodeIds = new Set<string>();
  for (const p of paths) {
    for (const id of p.nodeIds) reachedNodeIds.add(id);
  }
  const edgeReachable = computeEdgeReachable(graph);

  if (!truncated) {
    for (const node of graph.nodes) {
      if (node.type === "start" || node.type === "ending") continue;
      if (edgeReachable.has(node.id) && !reachedNodeIds.has(node.id)) {
        issues.push({
          code: "GATED_UNREACHABLE",
          level: "warning",
          message: `Nút "${node.title || node.id}" bị chặn bởi điều kiện biến không thể thỏa mãn`,
          nodeIds: [node.id],
        });
      }
    }

    for (const ending of graph.endings) {
      if (!reachedNodeIds.has(ending.nodeId)) {
        issues.push({
          code: "ENDING_UNREACHABLE",
          level: "warning",
          message: `Kết thúc "${ending.title}" không có đường đi thực tế nào dẫn tới`,
          nodeIds: [ending.nodeId],
        });
      }
    }
  }

  const hasBranch = graph.nodes.some((n) => n.choices.length >= 2);
  const hasNormalNode = graph.nodes.some((n) => n.type === "normal");
  if (graph.nodes.some((n) => n.type === "start") && graph.endings.length > 0 && hasNormalNode && !hasBranch) {
    issues.push({
      code: "LINEAR_GRAPH",
      level: "info",
      message: "Cốt truyện hoàn toàn tuyến tính, không có phân nhánh",
      nodeIds: [],
    });
  }

  const incoming = new Set<string>();
  for (const n of graph.nodes) for (const c of n.choices) incoming.add(c.targetNodeId);
  for (const node of graph.nodes) {
    if (node.type !== "start" && node.type !== "ending" && !incoming.has(node.id)) {
      if (issues.some((i) => i.code === "UNREACHABLE" && (i.nodeIds as readonly string[]).includes(node.id))) continue;
      issues.push({
        code: "ISOLATED_NODE",
        level: "info",
        message: `Nút "${node.title || node.id}" không có lựa chọn nào trỏ đến`,
        nodeIds: [node.id],
      });
    }
  }

  for (const node of graph.nodes) {
    if (node.choices.length >= 2) {
      const targets = new Set(node.choices.map((c) => c.targetNodeId));
      const allNoEffect = node.choices.every((c) => (c.effects?.length ?? 0) === 0);
      if (targets.size === 1 && allNoEffect) {
        issues.push({
          code: "ILLUSORY_BRANCH",
          level: "info",
          message: `Tất cả lựa chọn của nút "${node.title || node.id}" đều dẫn về cùng một đích mà không có hiệu ứng khác biệt`,
          nodeIds: [node.id],
        });
      }
    }
  }

  const CHAIN_THRESHOLD = 5;
  const longChainHeads = findLongLinearChainHeads(graph, CHAIN_THRESHOLD);
  for (const id of longChainHeads) {
    issues.push({
      code: "LONG_LINEAR_CHAIN",
      level: "info",
      message: `Từ nút "${id}" có một chuỗi tuyến tính dài (>= ${CHAIN_THRESHOLD} nút)`,
      nodeIds: [id],
    });
  }

  return { ok: issues.every((i) => i.level !== "error"), issues };
}

function computeEdgeReachable(graph: StoryGraph): Set<string> {
  const start = graph.nodes.find((n) => n.type === "start");
  const reachable = new Set<string>();
  if (!start) return reachable;
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const queue = [start.id];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (reachable.has(cur)) continue;
    reachable.add(cur);
    const node = nodeById.get(cur);
    if (!node) continue;
    for (const choice of node.choices) {
      if (!reachable.has(choice.targetNodeId)) queue.push(choice.targetNodeId);
    }
  }
  return reachable;
}

function findLongLinearChainHeads(graph: StoryGraph, threshold: number): string[] {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const isChainNode = (id: string): boolean => {
    const n = nodeById.get(id);
    return n !== undefined && n.type === "normal" && n.choices.length === 1;
  };
  const incomingIsChainNode = new Map<string, boolean>();
  for (const n of graph.nodes) {
    for (const c of n.choices) {
      if (isChainNode(n.id)) {
        incomingIsChainNode.set(c.targetNodeId, true);
      }
    }
  }
  const heads: string[] = [];
  for (const node of graph.nodes) {
    if (!isChainNode(node.id)) continue;
    if (incomingIsChainNode.get(node.id)) continue;
    let length = 0;
    let cur: string | undefined = node.id;
    const visited = new Set<string>();
    while (cur !== undefined && isChainNode(cur) && !visited.has(cur)) {
      visited.add(cur);
      length++;
      const chainNode: StoryNode = nodeById.get(cur)!;
      cur = chainNode.choices[0].targetNodeId;
    }
    if (length >= threshold) heads.push(node.id);
  }
  return heads;
}
