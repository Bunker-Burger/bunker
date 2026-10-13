import { expect, type Page } from "@playwright/test";

/*
 * Issue #54: `/` shows one screen at a time (menu, cart, checkout), as in the canonical captures.
 * Tests reach a screen the way a customer does, through the bottom navigation.
 */

const SCREENS = {
  menu: { link: /^Menú$/, region: "LA CARTA DEL BÚNKER" },
  carrito: { link: /^Carrito, \d+ productos$/, region: "Tu pedido" },
  checkout: { link: /^Checkout$/, region: "Finalizar pedido" }
} as const;

export async function openScreen(page: Page, screen: keyof typeof SCREENS) {
  const { link, region } = SCREENS[screen];
  await page.getByRole("navigation", { name: "Navegación principal" }).getByRole("link", { name: link }).click();
  const target = page.getByRole("region", { name: region });
  await expect(target).toBeVisible();
  return target;
}
