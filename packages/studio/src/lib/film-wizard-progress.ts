import type { StoryGraph } from "@actalk/castor-core/interactive-film/graph-schema";

export type Phase = "world" | "scale" | "structure" | "workshop" | "validate";
export type PhaseStatus = "empty" | "partial" | "done";
export const WIZARD_PHASES: readonly Phase[] = ["world", "scale", "structure", "workshop", "validate"];

export function computePhaseProgress(graph: StoryGraph): Record<Phase, PhaseStatus> {
  // world
  const hasCore = Boolean(graph.worldAnchor?.storyCore?.trim());
  const hasChar = graph.characters.length > 0;
  const world: PhaseStatus = hasCore && hasChar ? "done" : hasCore ? "partial" : "empty";
  // scale: placeholder, always empty (P2)
  const scale: PhaseStatus = "empty";
  // structure: start + ending + at least one edge
  const hasStart = graph.nodes.some((n) => n.type === "start");
  const hasEnding = graph.nodes.some((n) => n.type === "ending");
  const hasEdge = graph.nodes.some((n) => n.choices.length > 0);
  const structure: PhaseStatus = hasStart && hasEnding && hasEdge ? "done" : graph.nodes.length > 0 ? "partial" : "empty";
  // workshop: ratio of non-ending nodes with sceneDesc or dialogue
  const content = graph.nodes.filter((n) => n.type !== "ending");
  const filled = content.filter((n) => Boolean(n.sceneDesc?.trim()) || (n.dialogue?.length ?? 0) > 0);
  const workshop: PhaseStatus = content.length === 0 ? "empty" : filled.length === content.length ? "done" : filled.length > 0 ? "partial" : "empty";
  // validate: done if there's something to validate and no structural error is the runtime's concern; here partial/done by content presence
  const validate: PhaseStatus = graph.nodes.length > 0 && graph.endings.length > 0 ? "partial" : "empty";
  return { world, scale, structure, workshop, validate };
}

export function computeStaleFlags(
  graph: StoryGraph,
  phaseRevs: Record<string, number> | undefined,
  currentRev: number,
): Record<Phase, boolean> {
  const progress = computePhaseProgress(graph);
  const flag = (p: Phase): boolean => {
    const rev = phaseRevs?.[p];
    return typeof rev === "number" && rev < currentRev && progress[p] !== "empty";
  };
  return { world: flag("world"), scale: flag("scale"), structure: flag("structure"), workshop: flag("workshop"), validate: flag("validate") };
}
