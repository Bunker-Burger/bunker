import { expect, test } from "@playwright/test";
import { openScreen } from "./screens";

test("home renders the menu and an empty cart", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "LA CARTA DEL BÚNKER" })).toBeVisible();
  const cart = await openScreen(page, "carrito");
  await expect(cart.getByRole("heading", { name: "Tu carrito está vacío" })).toBeVisible();
});

test("adding a product updates the cart counter", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Agregar Smash Búnker Doble" }).click();

  await expect(page.getByLabel("Carrito, 1 productos")).toBeVisible();
});
