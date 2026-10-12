import { expect, test, type Page } from "@playwright/test";
import { categories as fixtureCategories, products as fixtureProducts } from "../../src/data/catalog";
import type { Category, Product, PublicCatalogSnapshot } from "../../src/domain/types";
import { serializePublicCatalog } from "../../src/server/catalog/public-products";

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
  await expect(dialog.getByRole("button", { name: "Seguir pidiendo" })).toBeFocused();

  await dialog.getByRole("button", { name: "Seguir pidiendo" }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "Ver Oklahoma Onion" })).toBeFocused();
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

test("one orderable product of every public type reaches the same cart", async ({ page }) => {
  await page.goto("/");
  const products = [
    "Smash Búnker Doble",
    "Crispy Chicken Búnker",
    "Papas Búnker",
    "Limonada de la Casa"
  ];

  for (const name of products) {
    await page.getByRole("button", { name: `Agregar ${name}` }).click();
  }

  await expect(page.getByLabel("Carrito, 4 productos")).toBeVisible();
  const cart = page.getByRole("region", { name: "Carrito" });
  for (const name of products) {
    await expect(cart.getByText(name, { exact: true })).toBeVisible();
  }
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

/*
 * Review 1: the menu follows /api/store/products (products + categories of one read). Without
 * Supabase (CI), the page is server-rendered with no snapshot and shows the demo copy until this
 * answer arrives, so these cover "fallback, then the real answer".
 */
test.describe("with the catalog answered by the test", () => {
  // page.route() does not see requests made by the service worker.
  test.use({ serviceWorkers: "block" });

  const answer = (page: Page, reply: () => { status: number; json: unknown }) =>
    page.route("**/api/store/products", (route) => {
      const { status, json } = reply();
      return route.fulfill({ status, json, headers: { "cache-control": "no-store" } });
    });
  const snapshot = (catalog: PublicCatalogSnapshot) => () => ({ status: 200, json: serializePublicCatalog(catalog) });
  const fresh: Product = { ...fixtureProducts[0]!, id: "nueva-del-dia", slug: "nueva-del-dia", name: "Nueva del Día", featured: false };

  test("a verified empty menu (200 with empty lists) replaces the demo copy with an empty state", async ({ page }) => {
    await answer(page, snapshot({ products: [], categories: [] }));
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "La carta está vacía por ahora" })).toBeVisible();
    await expect(page.locator("#menu").getByRole("article")).toHaveCount(0);
    await expect(page.locator("#menu").getByRole("button")).toHaveCount(0);
    await expect(page.getByRole("searchbox")).toHaveCount(0);
  });

  test("a 503 keeps the menu as it was and marks it pending, never empty", async ({ page }) => {
    await answer(page, () => ({ status: 503, json: { error: "unavailable" } }));
    await page.goto("/");

    await expect(page.getByTestId("verification-status-note")).toContainText("Pendiente de verificar");
    await expect(page.getByRole("button", { name: "Ver Smash Búnker Doble" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "La carta está vacía por ahora" })).toHaveCount(0);
  });

  test("a shared link to a product only the fresh catalog has opens it and keeps the URL", async ({ page }) => {
    await answer(page, snapshot({ products: [...fixtureProducts, fresh], categories: fixtureCategories }));
    await page.goto("/?producto=nueva-del-dia");

    await expect(page.getByRole("dialog", { name: "Personalizar Nueva del Día" })).toBeVisible();
    await expect(page).toHaveURL(/\?producto=nueva-del-dia$/);
  });

  test("while the catalog cannot be verified (503) a shared link keeps its URL and is not declared missing", async ({ page }) => {
    await answer(page, () => ({ status: 503, json: { error: "unavailable" } }));
    await page.goto("/?producto=nueva-del-dia");

    await expect(page.getByRole("status").filter({ hasText: "No pudimos confirmar ese producto" })).toBeVisible();
    await expect(page).toHaveURL(/\?producto=nueva-del-dia$/);
    await expect(page.getByText("Ese producto ya no está disponible.")).toHaveCount(0);
  });

  test("an unknown product link is cleaned and announced once the catalog answers without it", async ({ page }) => {
    await answer(page, snapshot({ products: fixtureProducts, categories: fixtureCategories }));
    await page.goto("/?producto=no-existe");

    await expect(page.getByRole("status").filter({ hasText: "Ese producto ya no está disponible." })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("a demo product the store no longer publishes closes, cleans the URL and says so", async ({ page }) => {
    const withoutOklahoma = fixtureProducts.filter((product) => product.slug !== "oklahoma-onion");
    await answer(page, snapshot({ products: withoutOklahoma, categories: fixtureCategories }));
    await page.goto("/?producto=oklahoma-onion");

    await expect(page.getByRole("status").filter({ hasText: "Ese producto ya no está disponible." })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("button", { name: "Ver Oklahoma Onion" })).toHaveCount(0);
  });

  test("sections follow the live categories: names, order and a hidden one", async ({ page }) => {
    const live: Category[] = [
      { ...fixtureCategories[3]!, name: "Para tomar", sortOrder: 1 },
      { ...fixtureCategories[0]!, name: "Clásicas", sortOrder: 2 },
      { ...fixtureCategories[2]!, sortOrder: 3 }
    ];
    // The server stops publishing a hidden category's products along with it.
    const products = fixtureProducts.filter((product) => product.categoryId !== "sandwiches");
    await answer(page, snapshot({ products, categories: live }));
    await page.goto("/");

    const chips = page.getByRole("group", { name: "Secciones de la carta" }).getByRole("button");
    await expect(chips).toHaveText(["Todo", "Destacadas", "Para tomar", "Clásicas", "Papas"]);
    await expect(page.locator("#menu").getByRole("heading", { level: 2 })).toHaveText(["Las más pedidas", "Para tomar", "Papas"]);
  });
});
