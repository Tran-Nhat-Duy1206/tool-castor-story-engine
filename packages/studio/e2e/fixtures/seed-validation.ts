import { saveStoryGraph, StoryGraphSchema } from "@actalk/castor-core";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));
export const E2E_ROOT = resolve(dir, "../../../..", "test-project");
export const E2E_VAL_ID = "e2e-validation-demo";

export async function seedValidationGraph(): Promise<void> {
  await saveStoryGraph(E2E_ROOT, E2E_VAL_ID, StoryGraphSchema.parse({
    schemaVersion: 1, projectId: E2E_VAL_ID, title: "E2E mock_val", variables: [{ name: "trust", type: "counter", default: 0, desc: "" }], characters: [],
    nodes: [
      { id: "s", type: "start", title: "Mo dau", sceneDesc: "Cong dien", choices: [{ id: "c", text: "mock_val", targetNodeId: "e", condition: { var: "trust", op: ">=", value: 1 } }] }, // reads trust (never written) -> VARIABLE_UNWRITTEN; no image -> IMAGE_MISSING
      { id: "e", type: "ending", title: "mock_val", choices: [] },
    ],
    endings: [{ id: "g1", nodeId: "e", title: "mock_val", type: "good", description: "" }],
  }));
}
