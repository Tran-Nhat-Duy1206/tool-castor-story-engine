import type { StoryNode } from "@actalk/castor-core/interactive-film/graph-schema";

export function genNodeId(): string {
  return `node-${crypto.randomUUID().slice(0, 8)}`;
}
export function genChoiceId(): string {
  return `choice-${crypto.randomUUID().slice(0, 8)}`;
}

export function moveNodeDelta(node: StoryNode, x: number, y: number): { delta: unknown } {
  return { delta: { nodes: { upsert: [{ ...node, position: { x, y } }] } } };
}
export function addNodeDelta(node: StoryNode): { delta: unknown } {
  return { delta: { nodes: { upsert: [node] } } };
}
export function addChoiceDelta(
  sourceNode: StoryNode,
  choice: { id: string; text: string; targetNodeId: string },
): { delta: unknown } {
  return { delta: { nodes: { upsert: [{ ...sourceNode, choices: [...sourceNode.choices, choice] }] } } };
}
export function removeChoiceDelta(sourceNode: StoryNode, choiceId: string): { delta: unknown } {
  return { delta: { nodes: { upsert: [{ ...sourceNode, choices: sourceNode.choices.filter((c) => c.id !== choiceId) }] } } };
}
export function removeChoicesDelta(sourceNode: StoryNode, choiceIds: string[]): { delta: unknown } {
  const drop = new Set(choiceIds);
  return { delta: { nodes: { upsert: [{ ...sourceNode, choices: sourceNode.choices.filter((c) => !drop.has(c.id)) }] } } };
}
export function removeNodeDelta(nodeId: string): { delta: unknown } {
  return { delta: { nodes: { remove: [nodeId] } } };
}
