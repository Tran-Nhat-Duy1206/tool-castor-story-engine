import { saveStoryGraph, StoryGraphSchema } from "@actalk/castor-core";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// INKOS_PROJECT_ROOT in dev/e2e is ../../test-project (relative to packages/studio).
// From this file (packages/studio/e2e/fixtures/seed-graph.ts) that is 4 levels up,
// then down into test-project.
export const E2E_PROJECT_ROOT = resolve(__dirname, "../../../..", "test-project");
export const E2E_PROJECT_ID = "e2e-player-demo";

const graph = StoryGraphSchema.parse({
  schemaVersion: 1,
  projectId: E2E_PROJECT_ID,
  title: "E2E 试玩剧本",
  variables: [{ name: "trust", type: "counter", default: 0, desc: "信任" }],
  nodes: [
    {
      id: "start",
      title: "开场",
      type: "start",
      sceneDesc: "你站在宫门前。",
      choices: [
        {
          id: "trustup",
          text: "交出证据（信任+1）",
          targetNodeId: "mid",
          effects: [{ var: "trust", op: "add", value: 1 }],
        },
        {
          id: "hide",
          text: "藏起证据",
          targetNodeId: "mid",
          effects: [],
        },
      ],
    },
    {
      id: "mid",
      title: "抉择",
      type: "branch",
      sceneDesc: "侍卫盯着你。",
      choices: [
        {
          id: "good",
          text: "坦白",
          targetNodeId: "endGood",
          effects: [],
          condition: { var: "trust", op: ">=", value: 1 },
        },
        {
          id: "bad",
          text: "逃跑",
          targetNodeId: "endBad",
          effects: [],
        },
      ],
    },
    { id: "endGood", title: "真相结局", type: "ending", choices: [] },
    { id: "endBad", title: "逃亡结局", type: "ending", choices: [] },
  ],
  endings: [
    {
      id: "g",
      nodeId: "endGood",
      title: "真相大白",
      type: "good",
      description: "你赢得了信任。",
    },
    {
      id: "b",
      nodeId: "endBad",
      title: "亡命天涯",
      type: "bad",
      description: "你消失在夜色里。",
    },
  ],
});

export async function seedE2EGraph(): Promise<void> {
  await saveStoryGraph(E2E_PROJECT_ROOT, E2E_PROJECT_ID, graph);
}
