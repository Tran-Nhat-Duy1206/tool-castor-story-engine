import { test, expect } from "@playwright/test";
import { seedFilmImageGraph, E2E_IMG_ID } from "./fixtures/seed-film-image";

test.beforeAll(async () => { await seedFilmImageGraph(); });

test("node image renders in the tree and the player (mock_val+mock_val)", async ({ page }) => {
  await page.goto(`/#/film/${E2E_IMG_ID}`);
  const thumb = page.getByTestId("node-image-s");
  await expect(thumb).toBeVisible();
  // the <img> actually loaded (naturalWidth > 0), proving the serve endpoint works
  await expect.poll(async () => thumb.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);

  await page.getByTestId("film-play").click();
  await page.getByTestId("player-start").click();
  await expect(page.getByTestId("player-image")).toBeVisible();
});
