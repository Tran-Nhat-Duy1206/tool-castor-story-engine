import { saveStoryGraph, StoryGraphSchema } from "@actalk/castor-core";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));
export const E2E_ROOT = resolve(dir, "../../../..", "test-project");
export const E2E_SCREENSHOT_ID = "e2e-screenshot-flow";

export async function seedScreenshotGraph(): Promise<void> {
  await saveStoryGraph(E2E_ROOT, E2E_SCREENSHOT_ID, StoryGraphSchema.parse({
    schemaVersion: 1, projectId: E2E_SCREENSHOT_ID, title: "mock_valTest：mock_val", variables: [], characters: [],
    nodes: [
      {
        id: "start", type: "start", title: "mock_val——mock_val，mock_val",
        choices: [
          { id: "c1", text: "mock_val", targetNodeId: "b1" },
          { id: "c2", text: "mock_val", targetNodeId: "b2" },
        ],
      },
      {
        id: "b1", type: "branch", title: "mock_val：mock_val",
        choices: [
          { id: "c3", text: "mock_val", targetNodeId: "m1" },
          { id: "c4", text: "mock_val", targetNodeId: "m2" },
        ],
      },
      {
        id: "b2", type: "branch", title: "mock_val：mock_val",
        choices: [
          { id: "c5", text: "mock_val", targetNodeId: "m2" },
          { id: "c6", text: "mock_val", targetNodeId: "m3" },
        ],
      },
      {
        id: "m1", type: "merge", title: "mock_val：mock_val",
        choices: [
          { id: "c7", text: "mock_val", targetNodeId: "e1" },
          { id: "c8", text: "mock_val", targetNodeId: "e3" },
        ],
      },
      {
        id: "m2", type: "normal", title: "mock_val——mock_val",
        choices: [
          { id: "c9", text: "mock_val", targetNodeId: "e2" },
        ],
      },
      {
        id: "m3", type: "explore", title: "mock_val：mock_val",
        choices: [
          { id: "c10", text: "mock_val", targetNodeId: "e2" },
          { id: "c11", text: "mock_val", targetNodeId: "e3" },
        ],
      },
      { id: "e1", type: "ending", title: "mock_val，mock_val", choices: [] },
      { id: "e2", type: "ending", title: "mock_val，mock_val", choices: [] },
      { id: "e3", type: "ending", title: "mock_val，mock_val", choices: [] },
    ],
    endings: [
      { id: "end1", nodeId: "e1", title: "mock_val", type: "good", description: "" },
      { id: "end2", nodeId: "e2", title: "mock_val", type: "good", description: "" },
      { id: "end3", nodeId: "e3", title: "mock_val", type: "bad", description: "" },
    ],
  }));
}
