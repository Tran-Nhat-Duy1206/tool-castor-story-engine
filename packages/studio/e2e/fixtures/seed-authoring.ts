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
      title: "E2E 创作样例",
      worldAnchor: {
        storyCore: "查账",
        theme: "信任",
        genre: "宫斗",
        worldRules: "无魔法",
        durationMinutes: 20,
      },
      variables: [],
      characters: [],
      nodes: [
        {
          id: "s",
          type: "start",
          title: "开场",
          sceneDesc: "旧场景",
          choices: [{ id: "c", text: "go", targetNodeId: "e" }],
        },
        {
          id: "e",
          type: "ending",
          title: "结局",
          choices: [],
        },
      ],
      endings: [
        { id: "g", nodeId: "e", title: "好结局", type: "good", description: "" },
      ],
    }),
  );
}
