import { saveStoryGraph, StoryGraphSchema } from "@actalk/castor-core";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";

const dir = fileURLToPath(new URL(".", import.meta.url));
export const E2E_ROOT = resolve(dir, "../../../..", "test-project");
export const E2E_IMG_ID = "e2e-image-demo";
const PNG = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00,0x00,0x00,0x0d,0x49,0x48,0x44,0x52,0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01,0x08,0x06,0x00,0x00,0x00,0x1f,0x15,0xc4,0x89,0x00,0x00,0x00,0x0a,0x49,0x44,0x41,0x54,0x78,0x9c,0x63,0x00,0x01,0x00,0x00,0x05,0x00,0x01,0x0d,0x0a,0x2d,0xb4,0x00,0x00,0x00,0x00,0x49,0x45,0x4e,0x44,0xae,0x42,0x60,0x82]);

export async function seedFilmImageGraph(): Promise<void> {
  const assetRef = `interactive-films/${E2E_IMG_ID}/assets/nodes/s.png`;
  await saveStoryGraph(E2E_ROOT, E2E_IMG_ID, StoryGraphSchema.parse({
    schemaVersion: 1, projectId: E2E_IMG_ID, title: "E2E mock_val", variables: [], characters: [],
    nodes: [
      { id: "s", type: "start", title: "Mo dau", sceneDesc: "Cong dien", imageSlot: { prompt: "mock_val", assetRef }, choices: [{ id: "c", text: "go", targetNodeId: "e" }] },
      { id: "e", type: "ending", title: "mock_val", choices: [] },
    ],
    endings: [{ id: "g", nodeId: "e", title: "mock_val", type: "good", description: "" }],
  }));
  const abs = resolve(E2E_ROOT, assetRef);
  await mkdir(resolve(abs, ".."), { recursive: true });
  await writeFile(abs, PNG);
}
