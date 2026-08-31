import { saveStoryGraph, StoryGraphSchema } from "@actalk/castor-core";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));
export const E2E_ROOT = resolve(dir, "../../../..", "test-project");
export const E2E_WIZ_ID = "e2e-film-wizard-demo";

export async function seedFilmWizard(): Promise<void> {
  await saveStoryGraph(
    E2E_ROOT,
    E2E_WIZ_ID,
    StoryGraphSchema.parse({
      schemaVersion: 1,
      projectId: E2E_WIZ_ID,
      title: "E2E mock_val",
      worldAnchor: {
        storyCore: "mock_valKiem tra so sach",
        theme: "mock_val",
        genre: "mock_val",
        worldRules: "mock_val，mock_val",
        durationMinutes: 30,
      },
      characters: [
        { id: "mei", name: "A Mei", role: "protagonist", motivation: "mock_valSu that" },
        { id: "wang", name: "mock_val", role: "antagonist", motivation: "mock_val" },
      ],
      variables: [],
      nodes: [
        {
          id: "start",
          type: "start",
          title: "mock_val",
          sceneDesc: "mock_val，A Meimock_val，mock_val。",
          choices: [
            { id: "c1", text: "mock_val", targetNodeId: "branch" },
            { id: "c2", text: "mock_val", targetNodeId: "branch" },
          ],
        },
        {
          id: "branch",
          type: "branch",
          title: "mock_valQuyet dinh",
          sceneDesc: "mock_val，A Meimock_valQuyet dinh。",
          choices: [
            { id: "b1", text: "Cong khaimock_val", targetNodeId: "good-end" },
            { id: "b2", text: "mock_val", targetNodeId: "bad-end" },
          ],
        },
        {
          id: "good-end",
          type: "ending",
          title: "Su thatmock_val",
          choices: [],
        },
        {
          id: "bad-end",
          type: "ending",
          title: "mock_val",
          choices: [],
        },
      ],
      endings: [
        {
          id: "e1",
          nodeId: "good-end",
          title: "mock_val",
          type: "good",
          description: "A Meimock_val。",
        },
        {
          id: "e2",
          nodeId: "bad-end",
          title: "mock_val",
          type: "bad",
          description: "A Meimock_val。",
        },
      ],
    }),
  );
}
