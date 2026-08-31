import type { StoryGraph } from "./graph-schema.js";

export function summarizeStoryGraph(graph: StoryGraph): string {
  const lines: string[] = [];
  lines.push(`# Interactive Film: ${graph.title || graph.projectId}`);
  if (graph.worldAnchor) {
    const w = graph.worldAnchor;
    lines.push(`Core: ${w.storyCore} / Theme: ${w.theme} / Genre: ${w.genre} / Rules: ${w.worldRules} / Duration: ${w.durationMinutes}m`);
  }
  if (graph.variables.length > 0) {
    lines.push(`Variables: ${graph.variables.map((v) => v.name).join(", ")}`);
  }
  lines.push("Nodes:");
  for (const n of graph.nodes) {
    const edges = n.choices.map((c) => `${c.text}->${c.targetNodeId}`).join(", ");
    lines.push(`- ${n.id}[${n.type}] ${n.title}${edges ? ` -> ${edges}` : ""}`);
  }
  return lines.join("\n");
}

export function buildFilmAuthoringContext(graph: StoryGraph): string {
  const blocks: string[] = [summarizeStoryGraph(graph)];
  if (graph.characters.length > 0) {
    const chars = graph.characters.map((c) => {
      const vp = c.voiceProfile;
      const voice = vp ? [vp.speakingRhythm, vp.vocabulary].filter(Boolean).join(" / ") : "";
      return `- ${c.name} (${c.role}) Motivation: ${c.motivation}${voice ? ` Voice: ${voice}` : ""}`;
    });
    blocks.push(["Character Profiles:", ...chars].join("\n"));
  }
  return blocks.join("\n\n");
}
