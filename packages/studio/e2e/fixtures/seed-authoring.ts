import { saveStoryGraph, StoryGraphSchema } from "@actalk/castor-core";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));
export const E2E_ROOT = resolve(dir, "../../../..", "test-project");
export const E2E_FILM_ID = "e2e-authoring-demo";

export async function seedAuthoringGraph(): Promise<void> {
  await saveStoryGraph(
    E2E_ROOT,
    E2E_FILM_ID,
    StoryGraphSchema.parse({
      schemaVersion: 1,
      projectId: E2E_FILM_ID,
      title: "E2E mock_val",
      worldAnchor: {
        storyCore: "Kiem tra so sach",
        theme: "mock_val",
        genre: "mock_val",
        worldRules: "mock_val",
        durationMinutes: 20,
      },
      variables: [],
      characters: [],
      nodes: [
        {
          id: "s",
          type: "start",
          title: "Mo dau",
          sceneDesc: "mock_val",
          choices: [{ id: "c", text: "go", targetNodeId: "e" }],
        },
        {
          id: "e",
          type: "ending",
          title: "mock_val",
          choices: [],
        },
      ],
      endings: [
        { id: "g", nodeId: "e", title: "mock_val", type: "good", description: "" },
      ],
    }),
  );
}
