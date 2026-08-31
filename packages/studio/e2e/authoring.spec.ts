import { test, expect } from "@playwright/test";
import { seedAuthoringGraph, E2E_FILM_ID } from "./fixtures/seed-authoring";

test.beforeAll(async () => {
  await seedAuthoringGraph();
});

test("user edits a node's scene inline in the tree view and it persists", async ({ page }) => {
  await page.goto(`/#/film/${E2E_FILM_ID}`);
  await expect(page.getByTestId("film-title")).toContainText("E2E mock_val");

  const scene = page.getByTestId("film-scene-s");
  await expect(scene).toHaveValue("mock_val");
  await scene.fill("mock_valMo daumock_val");
  await page.getByTestId("film-save-s").click();

  // After save + refetch, the textarea reflects the persisted value
  await expect(page.getByTestId("film-scene-s")).toHaveValue("mock_valMo daumock_val");

  // Cross-check via the player: open it and confirm the start node shows the new scene
  await page.getByTestId("film-play").click();
  await page.getByTestId("player-start").click();
  await expect(page.getByTestId("player-screen")).toContainText("mock_valMo daumock_val");
});
