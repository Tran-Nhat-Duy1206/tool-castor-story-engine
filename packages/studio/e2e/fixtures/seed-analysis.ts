import { saveStoryGraph, StoryGraphSchema } from "@actalk/castor-core";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));
export const E2E_ROOT = resolve(dir, "../../../..", "test-project");
export const E2E_ANALYSIS_ID = "e2e-analysis-panel-demo";

/**
 * Seeds a story graph that exercises the full AnalysisPanel:
 *
 * - start node → 2 unconditional branches → 2 endings (≥2 runtime paths for emotion arc + path distribution)
 * - dialogue lines with known-lexicon emotion strings (kien dinh, mock_val, mock_val, mock_val)
 * - one GATED_UNREACHABLE node: "locked" is edge-reachable (a conditional choice targets it from start)
 *   but no runtime path ever reaches it because trust starts at 0 and is never written to ≥9
 *   → triggers validation-issue-GATED_UNREACHABLE
 */
export async function seedAnalysis(): Promise<void> {
  await saveStoryGraph(
    E2E_ROOT,
    E2E_ANALYSIS_ID,
    StoryGraphSchema.parse({
      schemaVersion: 1,
      projectId: E2E_ANALYSIS_ID,
      title: "E2E mock_val",
      variables: [
        { name: "trust", type: "counter", default: 0, desc: "mock_val，mock_val，mock_val 9" },
      ],
      nodes: [
        {
          id: "start",
          type: "start",
          title: "mock_val",
          sceneDesc: "mock_val，mock_val。",
          dialogue: [
            { speaker: "mock_val", text: "mock_val。", emotion: "kien dinh" },
            { speaker: "mock_val", text: "mock_val。", emotion: "mock_val" },
          ],
          choices: [
            { id: "c1", text: "mock_val", targetNodeId: "good-end" },
            { id: "c2", text: "mock_val", targetNodeId: "bad-end" },
            {
              id: "c3",
              text: "mock_val",
              targetNodeId: "locked",
              condition: { var: "trust", op: ">=", value: 9 },
            },
          ],
        },
        {
          id: "good-end",
          type: "ending",
          title: "mock_val",
          sceneDesc: "mock_val，mock_val。",
          dialogue: [
            { speaker: "mock_val", text: "mock_val！", emotion: "mock_val" },
          ],
          choices: [],
        },
        {
          id: "bad-end",
          type: "ending",
          title: "mock_val",
          sceneDesc: "mock_val，mock_val。",
          dialogue: [
            { speaker: "mock_val", text: "mock_val。", emotion: "mock_val" },
          ],
          choices: [],
        },
        {
          // Intentional GATED_UNREACHABLE: edge-reachable (start→locked via c3) but trust is
          // never written, so the condition trust>=9 is never satisfied at runtime.
          id: "locked",
          type: "normal",
          title: "mock_val",
          sceneDesc: "mock_val。",
          dialogue: [],
          choices: [{ id: "c4", text: "mock_val", targetNodeId: "good-end" }],
        },
      ],
      endings: [
        {
          id: "eg1",
          nodeId: "good-end",
          title: "mock_val",
          type: "good",
          description: "mock_val，mock_val。",
        },
        {
          id: "eb1",
          nodeId: "bad-end",
          title: "mock_val",
          type: "bad",
          description: "mock_val，mock_val。",
        },
      ],
    }),
  );
}
