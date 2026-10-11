import { expect, test } from "@playwright/test";

/* BB-18: while the texts are under review, the menu does not link them, but each URL still answers. */

test("the menu footer keeps the allergen notice and links no legal page", async ({ page }) => {
  await page.goto("/");

  // Inside <main>, so not a contentinfo landmark in a real browser: found by its notice.
  const footer = page.locator("footer", { hasText: "La carta no informa alérgenos." });
  await expect(footer).toBeVisible();
  await expect(footer.getByRole("navigation", { name: "Textos legales" })).toHaveCount(0);
  await expect(page.locator('a[href^="/legal/"]')).toHaveCount(0);
});

for (const [path, heading] of [
  ["/legal/terminos", "Términos de uso"],
  ["/legal/privacidad", "Privacidad"],
  ["/legal/cancelaciones", "Cancelaciones y devoluciones"]
] as const) {
  test(`${path} is reachable directly, marked under review and not indexed`, async ({ page }) => {
    const response = await page.goto(path);

    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByRole("note")).toContainText("Texto en revisión");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  });
}
