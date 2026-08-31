import { test, expect } from "@playwright/test";
import { saveStoryGraph, StoryGraphSchema } from "@actalk/castor-core";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));
const E2E_ROOT = resolve(dir, "../../..", "test-project");

const FILM_A_ID = "e2e-film-list-alpha";
const FILM_B_ID = "e2e-film-list-beta";

function makeGraph(projectId: string, title: string) {
  return StoryGraphSchema.parse({
    schemaVersion: 1,
    projectId,
    title,
    variables: [],
    nodes: [{ id: "s", type: "start", sceneDesc: "desc", choices: [] }],
    endings: [],
  });
}

test.beforeAll(async () => {
  await saveStoryGraph(E2E_ROOT, FILM_A_ID, makeGraph(FILM_A_ID, "Alpha Testmock_val"));
  await saveStoryGraph(E2E_ROOT, FILM_B_ID, makeGraph(FILM_B_ID, "Beta Testmock_val"));
});

test("sidebar lists film projects and clicking a project opens the wizard", async ({ page }) => {
  await page.goto("/#/");

  const section = page.getByTestId("film-projects-section");
  await expect(section).toBeVisible({ timeout: 10_000 });

  await expect(page.getByTestId(`film-project-${FILM_A_ID}`)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId(`film-project-${FILM_B_ID}`)).toBeVisible({ timeout: 10_000 });

  await page.getByTestId(`film-project-${FILM_A_ID}`).click();
  await expect(page.getByTestId("film-wizard")).toBeVisible({ timeout: 20_000 });
  expect(page.url()).toContain(`#/studio/film/${FILM_A_ID}`);
});
