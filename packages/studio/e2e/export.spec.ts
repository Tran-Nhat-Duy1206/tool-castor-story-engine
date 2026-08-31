import { test, expect } from "@playwright/test";
import { seedExport, E2E_EXPORT_ID } from "./fixtures/seed-export";

test.beforeAll(async () => {
  await seedExport();
});

/**
 * Proves that the exported single-file HTML is fully self-contained and
 * playable without any connection to the app server.
 *
 * Strategy: fetch the HTML via page.request.get (still connected to our
 * server), then load the response text into a blank page via
 * page.setContent — which does NOT navigate to any origin, so the page
 * has no way to reach the dev server.  The embedded vanilla-JS player
 * must bootstrap itself purely from the data embedded in the HTML.
 */
test("exported single-file HTML is self-contained and playable", async ({ page }) => {
  // Step 1: fetch the exported HTML from the server.
  const res = await page.request.get(
    `/api/v1/projects/${E2E_EXPORT_ID}/export/html`,
  );
  expect(res.ok()).toBeTruthy();

  // Step 2: load the raw HTML string into a blank page (no server connection).
  const html = await res.text();
  await page.setContent(html, { waitUntil: "load" });

  // Step 3: the embedded player must have bootstrapped with no server.
  await expect(page.locator("#if-player")).toBeVisible();

  // Step 4: click the single choice in the start node.
  // The seed graph is start → (one choice "mock_val") → ending, so one click
  // reaches the ending and causes .ending-title to appear.
  await page.locator(".choice").first().click();

  // Step 5: the ending screen must appear.
  await expect(page.locator(".ending-title")).toBeVisible({ timeout: 10_000 });
});

test("export endpoints return correct content-type and disposition", async ({
  page,
}) => {
  const jsonRes = await page.request.get(
    `/api/v1/projects/${E2E_EXPORT_ID}/export/json`,
  );
  expect(jsonRes.ok()).toBeTruthy();
  expect(jsonRes.headers()["content-type"]).toContain("application/json");
  expect(jsonRes.headers()["content-disposition"]).toContain("attachment");

  const inkRes = await page.request.get(
    `/api/v1/projects/${E2E_EXPORT_ID}/export/ink`,
  );
  expect(inkRes.ok()).toBeTruthy();
  expect(inkRes.headers()["content-type"]).toContain("text/plain");
  expect(inkRes.headers()["content-disposition"]).toContain("attachment");
});
