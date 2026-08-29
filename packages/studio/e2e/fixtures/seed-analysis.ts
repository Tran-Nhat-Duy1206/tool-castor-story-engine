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
 * - dialogue lines with known-lexicon emotion strings (坚定, 紧张, 喜悦, 绝望)
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
      title: "E2E 分析面板样例",
      variables: [
        { name: "trust", type: "counter", default: 0, desc: "信任值，从未被写入，永远不会达到 9" },
      ],
      nodes: [
        {
          id: "start",
          type: "start",
          title: "危机前夕",
          sceneDesc: "主角站在岔路口，前路未知。",
          dialogue: [
            { speaker: "主角", text: "我必须做出选择。", emotion: "坚定" },
            { speaker: "旁白", text: "空气中弥漫着紧张气息。", emotion: "紧张" },
          ],
          choices: [
            { id: "c1", text: "选择信任", targetNodeId: "good-end" },
            { id: "c2", text: "选择放弃", targetNodeId: "bad-end" },
            {
              id: "c3",
              text: "尝试解锁隐藏路线",
              targetNodeId: "locked",
              condition: { var: "trust", op: ">=", value: 9 },
            },
          ],
        },
        {
          id: "good-end",
          type: "ending",
          title: "胜利结局",
          sceneDesc: "阳光照耀，一切圆满。",
          dialogue: [
            { speaker: "主角", text: "我们做到了！", emotion: "喜悦" },
          ],
          choices: [],
        },
        {
          id: "bad-end",
          type: "ending",
          title: "悲剧结局",
          sceneDesc: "黑暗笼罩，无力回天。",
          dialogue: [
            { speaker: "主角", text: "一切都结束了。", emotion: "绝望" },
          ],
          choices: [],
        },
        {
          // Intentional GATED_UNREACHABLE: edge-reachable (start→locked via c3) but trust is
          // never written, so the condition trust>=9 is never satisfied at runtime.
          id: "locked",
          type: "normal",
          title: "锁定节点",
          sceneDesc: "这条路需要极高的信任值才能开启。",
          dialogue: [],
          choices: [{ id: "c4", text: "通往结局", targetNodeId: "good-end" }],
        },
      ],
      endings: [
        {
          id: "eg1",
          nodeId: "good-end",
          title: "信任得偿",
          type: "good",
          description: "主角选择信任，赢得了胜利。",
        },
        {
          id: "eb1",
          nodeId: "bad-end",
          title: "放弃的代价",
          type: "bad",
          description: "主角选择放弃，走向悲剧。",
        },
      ],
    }),
  );
}
