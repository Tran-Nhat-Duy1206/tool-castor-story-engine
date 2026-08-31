import { test, expect } from "@playwright/test";
import { seedE2EGraph, E2E_PROJECT_ID } from "./fixtures/seed-graph";

test.beforeAll(async () => {
  await seedE2EGraph(); // Testmock_val：mock_val
});

test("mock_val good mock_val，mock_val", async ({ page }) => {
  // 1. mock_val（mock_val）
  await page.goto(`/#/play/${E2E_PROJECT_ID}`);

  // 2. mock_val"mock_val"
  await page.getByTestId("player-start").click();

  // 3. Mo dau：HUD mock_val trust=0
  await expect(page.getByTestId("player-node-title")).toHaveText("Mo dau");
  await expect(page.getByTestId("hud-trust")).toHaveText("0");

  // 4. mock_val"mock_val（mock_val+1）"——mock_val
  await page.getByTestId("choice-trustup").click();

  // 5. mock_valQuyet dinhmock_val，HUD mock_val trust=1（mock_val）
  await expect(page.getByTestId("player-node-title")).toHaveText("Quyet dinh");
  await expect(page.getByTestId("hud-trust")).toHaveText("1");

  // 6. mock_val trust>=1，"mock_val"mock_val
  await expect(page.getByTestId("choice-good")).toBeVisible();
  await page.getByTestId("choice-good").click();

  // 7. mock_val good mock_val，mock_val/mock_val/mock_val
  await expect(page.getByTestId("player-ending")).toBeVisible();
  await expect(page.getByTestId("player-ending-type")).toHaveText("good");
  await expect(page.getByTestId("player-ending-title")).toHaveText("Su thatmock_val");
  await expect(page.getByTestId("player-unlocked")).toContainText("1 / 2");
});

test("mock_val trust mock_val（mock_val bad mock_val）", async ({ page }) => {
  await page.goto(`/#/play/${E2E_PROJECT_ID}`);
  await page.getByTestId("player-start").click();

  // mock_val"mock_val"——trust mock_val 0
  await page.getByTestId("choice-hide").click();
  await expect(page.getByTestId("hud-trust")).toHaveText("0");

  // trust<1，"mock_val"mock_val，mock_val"mock_val"
  await expect(page.getByTestId("choice-good")).toHaveCount(0);
  await page.getByTestId("choice-bad").click();

  await expect(page.getByTestId("player-ending-type")).toHaveText("bad");
});
