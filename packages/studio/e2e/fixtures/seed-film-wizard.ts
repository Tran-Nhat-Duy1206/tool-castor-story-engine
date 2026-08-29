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
      title: "E2E 向导样例",
      worldAnchor: {
        storyCore: "古代宫廷查账",
        theme: "信任与背叛",
        genre: "宫斗",
        worldRules: "无魔法，以权谋为核心",
        durationMinutes: 30,
      },
      characters: [
        { id: "mei", name: "阿梅", role: "protagonist", motivation: "查清真相" },
        { id: "wang", name: "王大人", role: "antagonist", motivation: "掩盖账目" },
      ],
      variables: [],
      nodes: [
        {
          id: "start",
          type: "start",
          title: "宫门入口",
          sceneDesc: "清晨，阿梅持令牌踏入宫门，四周侍卫森严。",
          choices: [
            { id: "c1", text: "正面质问王大人", targetNodeId: "branch" },
            { id: "c2", text: "秘密搜集证据", targetNodeId: "branch" },
          ],
        },
        {
          id: "branch",
          type: "branch",
          title: "关键抉择",
          sceneDesc: "证据在手，阿梅面临最后抉择。",
          choices: [
            { id: "b1", text: "公开揭露", targetNodeId: "good-end" },
            { id: "b2", text: "私下和解", targetNodeId: "bad-end" },
          ],
        },
        {
          id: "good-end",
          type: "ending",
          title: "真相大白",
          choices: [],
        },
        {
          id: "bad-end",
          type: "ending",
          title: "遗憾收场",
          choices: [],
        },
      ],
      endings: [
        {
          id: "e1",
          nodeId: "good-end",
          title: "正义得彰",
          type: "good",
          description: "阿梅成功揭露贪腐。",
        },
        {
          id: "e2",
          nodeId: "bad-end",
          title: "妥协换平静",
          type: "bad",
          description: "阿梅与王大人达成秘密协议。",
        },
      ],
    }),
  );
}
