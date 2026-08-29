import { saveStoryGraph, StoryGraphSchema } from "@actalk/castor-core";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));
export const E2E_ROOT = resolve(dir, "../../../..", "test-project");
export const E2E_FE_ID = "e2e-flow-editor-demo";

export async function seedFlowEditorGraph(): Promise<void> {
  await saveStoryGraph(E2E_ROOT, E2E_FE_ID, StoryGraphSchema.parse({
    schemaVersion: 1, projectId: E2E_FE_ID, title: "E2E 编辑器样例", variables: [], characters: [],
    nodes: [
      { id: "s", type: "start", title: "开场", choices: [{ id: "c", text: "go", targetNodeId: "e" }] },
      { id: "e", type: "ending", title: "结局", choices: [] },
    ],
    endings: [{ id: "g1", nodeId: "e", title: "好", type: "good", description: "" }],
  }));
}
