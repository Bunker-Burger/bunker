import { expect, test } from "@playwright/test";

// TEMPORARY BB-17 artifact verification. Never merge this probe.
test("BB-17 controlled failure captures screenshot and trace", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "LA CARTA DEL BÚNKER" })).toBeVisible();
  expect("probe-intentionally-fails").toBe("not-equal-on-purpose");
});
