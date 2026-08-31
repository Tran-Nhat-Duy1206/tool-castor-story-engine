/**
 * Real-browser multi-step E2E: user drives the agent authoring confirm flow.
 *
 * Flow:
 *  1. Open the film tree page (#/film/<id>) — the project must already exist.
 *  2. Click the "AI mock_val" button (data-testid="open-authoring").
 *  3. Type "mock_val" into the chat textarea and press Enter.
 *  4. Wait for the agent to stream and render the proposed-action confirm card.
 *  5. Click the confirm button (data-testid="confirm-action").
 *  6. Wait for execution, then cross-check the graph via the API endpoint.
 *
 * The dev server runs with CASTOR_AGENT_LLM_STUB=1 (set in playwright.config.ts),
 * so the agent deterministically proposes draft_structure when the user message
 * mentions "mock_val". No real LLM call is made.
 */

import { test, expect } from "@playwright/test";
import { seedAuthoringConfirm, E2E_AUTHOR_ID } from "./fixtures/seed-authoring-confirm";

test.beforeEach(async () => {
  await seedAuthoringConfirm();
});

test("user drives agent to draft a structure via the confirm flow", async ({ page }) => {
  // Step 1: navigate to the film tree page
  await page.goto(`/#/film/${E2E_AUTHOR_ID}`);

  // Wait for the tree page to mount (the film-title testid is set in StoryGraphTree
  // only after the graph loads; the project may not have a graph yet, so we wait
  // for the page's main content area to appear instead)
  await expect(page.getByTestId("open-authoring")).toBeVisible({ timeout: 15_000 });

  // Step 2: click the authoring button → navigates to #/film-author/<id>
  await page.getByTestId("open-authoring").click();

  // The ChatPage loads and immediately creates/loads an authoring session.
  // Wait for the chat input to become enabled (session ready).
  const chatInput = page.getByPlaceholder("mock_val...");
  await expect(chatInput).toBeVisible({ timeout: 20_000 });
  await expect(chatInput).toBeEnabled({ timeout: 20_000 });

  // Step 3: type the instruction and press Enter to send
  await chatInput.fill("mock_val");
  await chatInput.press("Enter");

  // Step 4: wait for the agent to stream and render the proposed-action card.
  // The stub emits propose_action immediately, but the SSE pipeline still goes
  // through the server → SSE event → store update → React render cycle.
  // We give it up to 60 s to account for any startup lag on the CI machine.
  await expect(page.getByTestId("confirm-action")).toBeVisible({ timeout: 60_000 });

  // Step 5: click the confirm button
  await page.getByTestId("confirm-action").click();

  // Step 6: cross-check via the graph API endpoint.
  // The stub's stubChatCompletion returns STRUCTURE_JSON (4 nodes) when the
  // prompt mentions "mock_val/nodes/mock_val". Poll until the graph has ≥4 nodes.
  await expect
    .poll(
      async () => {
        const res = await page.request.get(
          `/api/v1/projects/${E2E_AUTHOR_ID}/story-graph`,
        );
        if (!res.ok()) return 0;
        const g = (await res.json()) as { nodes: unknown[] };
        return g.nodes?.length ?? 0;
      },
      { timeout: 60_000, intervals: [1_000, 2_000, 3_000] },
    )
    .toBeGreaterThanOrEqual(4);
});
