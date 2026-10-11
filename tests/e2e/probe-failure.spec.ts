import { expect, test } from "@playwright/test";

test("deliberate failure probe to verify artifacts", async ({ page }) => {
  await page.goto("/");
  expect(1).toBe(2);
});
