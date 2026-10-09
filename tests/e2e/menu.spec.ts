import { expect, test } from "@playwright/test";

/*
 * BB-07: public menu and product drawer in a real browser (production build, static fallback
 * catalog): shareable URL, reload, Back, focus and scroll restoration, sold out, search.
 */

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("a shared link opens the product, survives a reload, and closing returns to its card", async ({ page }) => {
  await page.goto("/?producto=oklahoma-onion");
  const dialog = page.getByRole("dialog", { name: "Personalizar Oklahoma Onion" });
  await expect(dialog).toBeVisible();

  await page.reload();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cerrar personalizador" })).toBeFocused();

  await dialog.getByRole("button", { name: "Cerrar personalizador" }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "Ver Oklahoma Onion" })).toBeFocused();
});

test("an unknown product link cleans the URL and says so", async ({ page }) => {
  await page.goto("/?producto=no-existe");
  await expect(page.getByRole("status").filter({ hasText: "Ese producto ya no está disponible." })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("opening from a card and going Back closes it and restores scroll and focus", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Ver Limonada de la Casa" });
  await trigger.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(0);

  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Personalizar Limonada de la Casa" });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\?producto=limonada-de-la-casa$/);

  await page.goBack();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/$/);
  await expect(trigger).toBeFocused();
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - before)).toBeLessThanOrEqual(2);
});

test("keyboard: Escape closes and Tab never leaves the open drawer", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Ver Gaseosa Lata 354ml" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Personalizar Gaseosa Lata 354ml" });
  await expect(dialog).toBeVisible();

  for (let step = 0; step < 15; step += 1) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("sold-out products are shown, labelled and cannot be added", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Ver Pulled Pork Búnker" })).toHaveAccessibleDescription(/Agotado, no se puede pedir\./);
  await expect(page.getByRole("button", { name: "Pulled Pork Búnker agotado" })).toBeDisabled();

  await page.getByRole("button", { name: "Ver Pulled Pork Búnker" }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Producto agotado" })).toBeDisabled();
  await expect(page.getByLabel("Carrito, 0 productos")).toBeVisible();
});

test("search and section filters narrow the menu; the card's Agregar uses defaults", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("searchbox", { name: "Buscar en la carta" }).fill("limon");
  const menu = page.locator("#menu");
  await expect(menu.getByRole("heading", { level: 3 })).toHaveText(["Limonada de la Casa"]);

  await page.getByRole("button", { name: "Agregar Limonada de la Casa" }).click();
  await expect(page.getByLabel("Carrito, 1 productos")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("searchbox", { name: "Buscar en la carta" }).fill("");
  await page.getByRole("group", { name: "Secciones de la carta" }).getByRole("button", { name: "Papas" }).click();
  await expect(menu.getByRole("heading", { level: 2 })).toHaveText(["Papas"]);
  await expect(menu.getByRole("heading", { level: 3 })).toHaveText(["Papas Búnker", "Aros de Cebolla"]);
});

test("the section chips stay pinned while scrolling and jump back to the results", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Ver Limonada de la Casa" }).scrollIntoViewIfNeeded();
  const chips = page.getByRole("group", { name: "Secciones de la carta" });
  await expect(chips).toBeInViewport();

  await chips.getByRole("button", { name: "Papas", exact: true }).click();
  await expect(page.locator("#menu").getByRole("heading", { level: 2, name: "Papas" })).toBeInViewport();
  await expect(page.getByRole("button", { name: "Ver Papas Búnker" })).toBeInViewport();
});
