import { saveStoryGraph, StoryGraphSchema } from "@actalk/castor-core";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));
export const E2E_ROOT = resolve(dir, "../../../..", "test-project");
export const E2E_FLOW_ID = "e2e-flow-demo";

export async function seedFlowGraph(): Promise<void> {
  await saveStoryGraph(E2E_ROOT, E2E_FLOW_ID, StoryGraphSchema.parse({
    schemaVersion: 1, projectId: E2E_FLOW_ID, title: "E2E mock_val", variables: [], characters: [],
    nodes: [
      { id: "s", type: "start", title: "Mo dau", choices: [{ id: "a", text: "mock_val", targetNodeId: "g" }, { id: "b", text: "mock_val", targetNodeId: "x" }] },
      { id: "g", type: "ending", title: "mock_val", choices: [] },
      { id: "x", type: "ending", title: "mock_val", choices: [] },
    ],
    endings: [{ id: "e1", nodeId: "g", title: "mock_val", type: "good", description: "" }, { id: "e2", nodeId: "x", title: "mock_val", type: "bad", description: "" }],
  }));
}
