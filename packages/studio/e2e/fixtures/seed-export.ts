import { saveStoryGraph, StoryGraphSchema } from "@actalk/castor-core";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";

const dir = fileURLToPath(new URL(".", import.meta.url));
export const E2E_ROOT = resolve(dir, "../../../..", "test-project");
export const E2E_EXPORT_ID = "e2e-export-demo";

// Minimal valid 1×1 transparent PNG (67 bytes).
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

/**
 * Seeds a story graph with a single start → ending hop for the export E2E test.
 *
 * The graph is designed so that clicking one `.choice` button in the exported
 * self-contained HTML is enough to reach the ending node, which causes
 * `.ending-title` to appear.
 *
 * An imageSlot pointing to a real PNG exercises the base64-inlining code path
 * in the html export endpoint.
 */
export async function seedExport(): Promise<void> {
  const assetRef = `interactive-films/${E2E_EXPORT_ID}/assets/nodes/start.png`;

  await saveStoryGraph(
    E2E_ROOT,
    E2E_EXPORT_ID,
    StoryGraphSchema.parse({
      schemaVersion: 1,
      projectId: E2E_EXPORT_ID,
      title: "E2E 导出样例",
      variables: [],
      nodes: [
        {
          id: "start",
          type: "start",
          title: "开场白",
          sceneDesc: "古老宫殿门前，主角站在石阶上。",
          dialogue: [
            { speaker: "主角", text: "是时候做出选择了。", emotion: "坚定" },
          ],
          imageSlot: { prompt: "宫殿入口", assetRef },
          choices: [
            { id: "c1", text: "踏入宫殿", targetNodeId: "end" },
          ],
        },
        {
          id: "end",
          type: "ending",
          title: "命运已定",
          sceneDesc: "一切尘埃落定。",
          dialogue: [],
          choices: [],
        },
      ],
      endings: [
        {
          id: "eg1",
          nodeId: "end",
          title: "命运已定",
          type: "good",
          description: "主角踏入宫殿，迎接命运。",
        },
      ],
    }),
  );

  // Write the PNG file so the html endpoint can inline it as base64.
  const absPath = resolve(E2E_ROOT, assetRef);
  await mkdir(resolve(absPath, ".."), { recursive: true });
  await writeFile(absPath, PNG);
}
