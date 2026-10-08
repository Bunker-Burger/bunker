import { expect, test } from "@playwright/test";

/*
 * BB-09: with the browser clock on a Tuesday night in Tucumán, the "Martes de Smash" rule is in
 * effect: the card strikes the real price, and the checkout explains the single applied promotion.
 * Layout must hold with the extra price line down to 320 px.
 */

// Tuesday 2026-10-13 21:00 in Tucumán (UTC-3).
const TUESDAY_NIGHT = new Date("2026-10-14T00:00:00Z");

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: TUESDAY_NIGHT });
});

for (const width of [320, 1280]) {
  test(`shows the promotional price and explains the applied promotion at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");

    const card = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Smash Búnker Doble" }) });
    await expect(card.locator("s.compare-at")).toHaveText("Antes $ 7.800");
    await expect(card.getByText("$ 6.630")).toBeVisible();
    await expect(card.getByText("Martes de Smash: 15% de descuento en productos seleccionados")).toBeVisible();

    await card.getByRole("button", { name: "Agregar Smash Búnker Doble" }).click();
    const applied = page.getByTestId("applied-promotion");
    await expect(applied).toContainText("Promoción: Martes de Smash");
    await expect(applied).toContainText("-$ 1.170");
    await expect(applied).toContainText("No se acumula con otras promociones.");

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("shows no promotion outside the Tuesday window", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-15T00:00:00Z"));
  await page.goto("/");
  const card = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Smash Búnker Doble" }) });
  await expect(card.getByText("$ 7.800")).toBeVisible();
  await expect(card.locator("s.compare-at")).toHaveCount(0);
});
