import { saveStoryGraph, StoryGraphSchema } from "@actalk/castor-core";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// CASTOR_PROJECT_ROOT in dev/e2e is ../../test-project (relative to packages/studio).
// From this file (packages/studio/e2e/fixtures/seed-graph.ts) that is 4 levels up,
// then down into test-project.
export const E2E_PROJECT_ROOT = resolve(__dirname, "../../../..", "test-project");
export const E2E_PROJECT_ID = "e2e-player-demo";

const graph = StoryGraphSchema.parse({
  schemaVersion: 1,
  projectId: E2E_PROJECT_ID,
  title: "E2E mock_val",
  variables: [{ name: "trust", type: "counter", default: 0, desc: "mock_val" }],
  nodes: [
    {
      id: "start",
      title: "Mo dau",
      type: "start",
      sceneDesc: "mock_valCong dien。",
      choices: [
        {
          id: "trustup",
          text: "mock_val（mock_val+1）",
          targetNodeId: "mid",
          effects: [{ var: "trust", op: "add", value: 1 }],
        },
        {
          id: "hide",
          text: "mock_val",
          targetNodeId: "mid",
          effects: [],
        },
      ],
    },
    {
      id: "mid",
      title: "Quyet dinh",
      type: "branch",
      sceneDesc: "mock_val。",
      choices: [
        {
          id: "good",
          text: "mock_val",
          targetNodeId: "endGood",
          effects: [],
          condition: { var: "trust", op: ">=", value: 1 },
        },
        {
          id: "bad",
          text: "mock_val",
          targetNodeId: "endBad",
          effects: [],
        },
      ],
    },
    { id: "endGood", title: "Su thatmock_val", type: "ending", choices: [] },
    { id: "endBad", title: "mock_val", type: "ending", choices: [] },
  ],
  endings: [
    {
      id: "g",
      nodeId: "endGood",
      title: "Su thatmock_val",
      type: "good",
      description: "mock_val。",
    },
    {
      id: "b",
      nodeId: "endBad",
      title: "mock_val",
      type: "bad",
      description: "mock_valBong demmock_val。",
    },
  ],
});

export async function seedE2EGraph(): Promise<void> {
  await saveStoryGraph(E2E_PROJECT_ROOT, E2E_PROJECT_ID, graph);
}
