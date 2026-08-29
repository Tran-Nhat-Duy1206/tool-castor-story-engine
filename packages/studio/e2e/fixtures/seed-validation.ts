import { saveStoryGraph, StoryGraphSchema } from "@actalk/castor-core";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));
export const E2E_ROOT = resolve(dir, "../../../..", "test-project");
export const E2E_VAL_ID = "e2e-validation-demo";

export async function seedValidationGraph(): Promise<void> {
  await saveStoryGraph(E2E_ROOT, E2E_VAL_ID, StoryGraphSchema.parse({
    schemaVersion: 1, projectId: E2E_VAL_ID, title: "E2E 校验样例", variables: [{ name: "trust", type: "counter", default: 0, desc: "" }], characters: [],
    nodes: [
      { id: "s", type: "start", title: "开场", sceneDesc: "宫门前", choices: [{ id: "c", text: "去", targetNodeId: "e", condition: { var: "trust", op: ">=", value: 1 } }] }, // reads trust (never written) -> VARIABLE_UNWRITTEN; no image -> IMAGE_MISSING
      { id: "e", type: "ending", title: "结局", choices: [] },
    ],
    endings: [{ id: "g1", nodeId: "e", title: "好结局", type: "good", description: "" }],
  }));
}
