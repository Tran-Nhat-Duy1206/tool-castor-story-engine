import { saveStoryGraph, StoryGraphSchema } from "@actalk/castor-core";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));
export const E2E_ROOT = resolve(dir, "../../../..", "test-project");
export const E2E_SCREENSHOT_ID = "e2e-screenshot-flow";

export async function seedScreenshotGraph(): Promise<void> {
  await saveStoryGraph(E2E_ROOT, E2E_SCREENSHOT_ID, StoryGraphSchema.parse({
    schemaVersion: 1, projectId: E2E_SCREENSHOT_ID, title: "截图测试：复杂剧情图", variables: [], characters: [],
    nodes: [
      {
        id: "start", type: "start", title: "故事开端——世界陷入危机，英雄踏上征途",
        choices: [
          { id: "c1", text: "选择战斗", targetNodeId: "b1" },
          { id: "c2", text: "选择和平谈判", targetNodeId: "b2" },
        ],
      },
      {
        id: "b1", type: "branch", title: "战斗之路：面对敌军主力部队",
        choices: [
          { id: "c3", text: "正面强攻突破防线", targetNodeId: "m1" },
          { id: "c4", text: "绕道偷袭补给线", targetNodeId: "m2" },
        ],
      },
      {
        id: "b2", type: "branch", title: "谈判之路：寻求和平解决方案",
        choices: [
          { id: "c5", text: "提出停战条约", targetNodeId: "m2" },
          { id: "c6", text: "寻找第三方盟友", targetNodeId: "m3" },
        ],
      },
      {
        id: "m1", type: "merge", title: "大决战：命运在此一举",
        choices: [
          { id: "c7", text: "胜利突破", targetNodeId: "e1" },
          { id: "c8", text: "壮烈牺牲", targetNodeId: "e3" },
        ],
      },
      {
        id: "m2", type: "normal", title: "关键转折——所有道路交汇于此",
        choices: [
          { id: "c9", text: "继续前进", targetNodeId: "e2" },
        ],
      },
      {
        id: "m3", type: "explore", title: "探索：神秘盟友的秘密据点",
        choices: [
          { id: "c10", text: "成功说服加入", targetNodeId: "e2" },
          { id: "c11", text: "遭到拒绝离开", targetNodeId: "e3" },
        ],
      },
      { id: "e1", type: "ending", title: "英雄凯旋，世界得救光明重现", choices: [] },
      { id: "e2", type: "ending", title: "和平协议签署，永久停战时代", choices: [] },
      { id: "e3", type: "ending", title: "英雄牺牲，传说永存于世间", choices: [] },
    ],
    endings: [
      { id: "end1", nodeId: "e1", title: "胜利", type: "good", description: "" },
      { id: "end2", nodeId: "e2", title: "和平", type: "good", description: "" },
      { id: "end3", nodeId: "e3", title: "悲剧", type: "bad", description: "" },
    ],
  }));
}
