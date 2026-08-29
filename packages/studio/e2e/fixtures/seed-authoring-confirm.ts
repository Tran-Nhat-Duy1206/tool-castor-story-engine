import {
  saveStoryGraph,
  StoryGraphSchema,
  createAndPersistBookSession,
  saveSecrets,
} from "@actalk/castor-core";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readdir, rm } from "node:fs/promises";

const dir = fileURLToPath(new URL(".", import.meta.url));
const E2E_ROOT = resolve(dir, "../../../..", "test-project");

export const E2E_AUTHOR_ID = "e2e-authoring-confirm";

/**
 * Seed the project directory that the dev server needs for the authoring
 * confirm E2E. The dev server uses test-project/ as its CASTOR_PROJECT_ROOT.
 * We create:
 *  - test-project/interactive-films/<E2E_AUTHOR_ID>/story-graph.json
 *    (minimal graph so StoryGraphTree renders and shows the open-authoring button)
 *  - test-project/.castor/secrets.json
 *    (a fake DeepSeek API key so the UI's model picker goes to "ready" state
 *     and ChatPage auto-selects a model, allowing sendMessage to proceed past
 *     the "请先选择一个模型" guard)
 *  - a fresh book session so the agent endpoint can load it
 *
 * IMPORTANT: we do NOT touch test-project/castor.json — that file is shared
 * across all E2E tests and must not be overwritten.
 *
 * The actual LLM calls are bypassed by CASTOR_AGENT_LLM_STUB=1 set in
 * playwright.config.ts, so the fake API key is never sent to any real service.
 */
export async function seedAuthoringConfirm(): Promise<void> {
  // Delete all stale sessions for this project from previous test runs.
  // ChatPage picks the most-recently-updated session (ids[0] from listBookSessions);
  // stale sessions with old message history can confuse the test.
  // Sessions now live canonically under .castor/sessions; the pre-rename
  // .castor/sessions location is cleaned too for older runs.
  for (const dir of [resolve(E2E_ROOT, ".castor", "sessions"), resolve(E2E_ROOT, ".castor", "sessions")]) {
    try {
      const files = await readdir(dir);
      await Promise.all(
        files
          .filter((f) => f.startsWith(`e2e-confirm-seed-`) && f.endsWith(".jsonl"))
          .map((f) => rm(resolve(dir, f), { force: true })),
      );
  } catch {
    // sessions dir may not exist on first run — ignore
  }
  }

  // Write a minimal story graph so StoryGraphTree can load the film page
  // without returning an error. The agent will overwrite this with a 4-node
  // graph once the confirm flow executes.
  await saveStoryGraph(
    E2E_ROOT,
    E2E_AUTHOR_ID,
    StoryGraphSchema.parse({
      schemaVersion: 1,
      projectId: E2E_AUTHOR_ID,
      title: "E2E 确认流程样例",
      worldAnchor: {
        storyCore: "测试",
        theme: "测试",
        genre: "现代",
        worldRules: "无设定",
        durationMinutes: 10,
      },
      variables: [],
      characters: [],
      nodes: [
        {
          id: "s",
          type: "start",
          title: "开场",
          sceneDesc: "起始场景",
          choices: [{ id: "c1", text: "继续", targetNodeId: "e" }],
        },
        {
          id: "e",
          type: "ending",
          title: "结局",
          choices: [],
        },
      ],
      endings: [
        { id: "g", nodeId: "e", title: "结局", type: "good", description: "" },
      ],
    }),
  );

  // Write a fake secrets.json so the UI's /api/v1/services endpoint reports
  // DeepSeek as "connected". The dev server then returns DeepSeek's static
  // model list from /api/v1/services/models, which allows ChatPage to
  // auto-select a model and pass the sendMessage guard.
  // The CASTOR_AGENT_LLM_STUB=1 env var ensures no real API call is made.
  await saveSecrets(E2E_ROOT, {
    services: {
      deepseek: { apiKey: "stub-key-e2e-not-real" },
    },
  });

  // Pre-create a session so the directory tree is complete before the browser
  // loads. ChatPage will POST /api/v1/chat/sessions to create its own session,
  // but the directory must already exist.
  const sessionId = `e2e-confirm-seed-${Date.now()}`;
  await createAndPersistBookSession(
    E2E_ROOT,
    E2E_AUTHOR_ID,
    sessionId,
    "interactive-film-authoring",
  );
}
