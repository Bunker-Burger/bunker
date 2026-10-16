import { expect, test, type Page } from "@playwright/test";
import { openScreen } from "./screens";
import { categories as fixtureCategories, products } from "../../src/data/catalog";
import { serializePublicCatalog } from "../../src/server/catalog/public-products";

/*
 * BB-10: with the store open and the catalog verified, the checkout asks for no personal data,
 * sends the server only ids, quantities, options and notes, and links to the WhatsApp message
 * the server built. The public endpoints are answered with the shapes the server produces.
 */

const openStore = {
  state: "open",
  acceptingOrders: true,
  reason: "manual_open",
  closesAt: null,
  nextOpeningAt: null,
  deliveryFeeCents: "120000",
  timezone: "America/Argentina/Tucuman"
};

const SERVER_URL = "https://wa.me/5493865207458?text=Hola%20B%C3%BAnker%20Burger!%20Quiero%20hacer%20este%20pedido%3A";

async function serveOpenStore(page: Page, checkout: (body: unknown) => { status: number; json: unknown }) {
  const sent: unknown[] = [];
  await page.route("**/api/store/status", (route) => route.fulfill({ json: openStore, headers: { "cache-control": "no-store" } }));
  await page.route("**/api/store/promotions", (route) => route.fulfill({ json: { promotions: [] }, headers: { "cache-control": "no-store" } }));
  await page.route("**/api/store/products", (route) =>
    route.fulfill({ json: serializePublicCatalog({ products, categories: fixtureCategories }), headers: { "cache-control": "no-store" } })
  );
  await page.route("**/api/checkout/whatsapp", (route) => {
    const body: unknown = route.request().postDataJSON();
    sent.push(body);
    const answer = checkout(body);
    return route.fulfill({ status: answer.status, json: answer.json, headers: { "cache-control": "no-store" } });
  });
  return sent;
}

test.describe("WhatsApp checkout", () => {
  // page.route() does not see requests made by the service worker.
  test.use({ serviceWorkers: "block" });

  test("links to the server-built message with the server's total and no personal data asked", async ({ page }) => {
    const sent = await serveOpenStore(page, () => ({
      status: 200,
      json: { url: SERVER_URL, subtotalCents: "780000", discountCents: "0", deliveryCents: "120000", totalCents: "900000", promotion: null }
    }));
    await page.goto("/");
    await page.getByRole("button", { name: "Agregar Smash Búnker Doble" }).click();
    const checkout = await openScreen(page, "checkout");
    await checkout.getByRole("radio", { name: /Delivery a domicilio/i }).check();

    await expect(checkout.getByRole("textbox")).toHaveCount(0);
    const link = checkout.getByRole("link", { name: "Enviar pedido por WhatsApp" });
    await expect(link).toHaveAttribute("href", SERVER_URL);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(page.getByTestId("checkout-total")).toContainText("9.000");
    expect(sent.at(-1)).toEqual({
      items: [{ productId: "smash-doble", quantity: 1, optionSelections: { patty: ["double"] }, notes: "" }],
      fulfilment: "delivery",
      paymentMethod: "transfer"
    });
  });

  test("gives no link when the server refuses the order", async ({ page }) => {
    await serveOpenStore(page, () => ({ status: 409, json: { error: "store_closed" } }));
    await page.goto("/");
    await page.getByRole("button", { name: "Agregar Smash Búnker Doble" }).click();
    const checkout = await openScreen(page, "checkout");

    await expect(checkout.getByRole("alert")).toHaveText("El local no está tomando pedidos ahora.");
    await expect(page.locator('a[href*="wa.me"]:not([data-credit])')).toHaveCount(0);
  });
});
