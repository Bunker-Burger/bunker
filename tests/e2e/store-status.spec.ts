import { expect, test, type Page } from "@playwright/test";
import { openScreen } from "./screens";

/*
 * BB-08: a paused or closed store blocks sending an order from the app, while the menu and the
 * persisted cart keep working. The status endpoint is answered with the exact shape the server
 * produces for each state; the last test runs against the real endpoint of this build.
 */

const TIMEZONE = "America/Argentina/Tucuman";
const statuses = {
  paused: {
    state: "paused",
    acceptingOrders: false,
    reason: "manual_paused",
    closesAt: null,
    nextOpeningAt: null,
    deliveryFeeCents: "120000",
    timezone: TIMEZONE
  },
  closed: {
    state: "closed",
    acceptingOrders: false,
    reason: "manual_closed",
    closesAt: null,
    nextOpeningAt: null,
    deliveryFeeCents: "120000",
    timezone: TIMEZONE
  }
} as const;

async function fillCompleteOrder(page: Page) {
  await page.getByRole("button", { name: "Agregar Smash Búnker Doble" }).click();
  const checkout = await openScreen(page, "checkout");
  await checkout.getByText("Delivery a domicilio", { exact: true }).click();
  return checkout;
}

async function expectNoSendAction(page: Page) {
  await expect(page.locator('a[href*="wa.me"], a[href*="whatsapp"]')).toHaveCount(0);
  const checkout = page.getByRole("region", { name: "Finalizar pedido" });
  // Only in-page navigation (the back arrow to the cart) may be a link in the checkout screen.
  await expect(checkout.locator('a:not([href^="#"])')).toHaveCount(0);
}

test.describe("with the status answered per state", () => {
  // page.route() does not see requests made by the service worker; the SW is covered below.
  test.use({ serviceWorkers: "block" });

  for (const [name, body] of Object.entries(statuses)) {
    test(`a ${name} store cannot receive an order from the app, but the menu and cart keep working`, async ({
      page
    }) => {
      await page.route("**/api/store/status", (route) =>
        route.fulfill({ json: body, headers: { "cache-control": "no-store" } })
      );
      await page.goto("/");

      const checkout = await fillCompleteOrder(page);

      await expect(page.getByTestId("store-status")).toHaveText(
        name === "paused" ? "El local pausó los pedidos por un momento." : "El local está cerrado."
      );
      await expect(checkout.getByRole("button", { name: "No se pueden enviar pedidos ahora" })).toBeDisabled();
      await expectNoSendAction(page);

      // Browsing and the persisted cart are unaffected, across a reload too.
      // Exact: with every section listed, "Ver Papas Búnker" and "Agregar Papas Búnker" match too.
      await page.getByRole("button", { name: "Papas", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Papas Búnker" })).toBeVisible();
      await page.reload();
      await expect(page.getByLabel("Carrito, 1 productos")).toBeVisible();
      await expect(page.getByTestId("store-status")).toHaveText(
        name === "paused" ? "El local pausó los pedidos por un momento." : "El local está cerrado."
      );
      await expectNoSendAction(page);
    });
  }
});

test("the service worker never stores the store status", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // Reload so the page is controlled and its status request goes through the worker.
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expect(page.getByTestId("store-status")).not.toHaveText("Verificando si el local está tomando pedidos…");

  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) urls.push(request.url);
    }
    return urls;
  });
  expect(cached.filter((url) => new URL(url).pathname === "/api/store/status")).toEqual([]);
});

test("the real status endpoint answers fresh and fails closed, and the checkout never sends while closed", async ({
  page,
  request
}) => {
  const response = await request.get("/api/store/status");
  expect(response.headers()["cache-control"]).toBe("no-store");
  const body = (await response.json()) as { acceptingOrders: unknown; error?: unknown };
  if (response.ok()) {
    expect(typeof body.acceptingOrders).toBe("boolean");
  } else {
    // Without Supabase credentials (e.g. CI) the endpoint must refuse orders, not guess.
    expect([404, 503]).toContain(response.status());
    expect(body.acceptingOrders).toBe(false);
  }

  await page.goto("/");
  await fillCompleteOrder(page);
  await expect(page.getByTestId("store-status")).not.toHaveText("Verificando si el local está tomando pedidos…");
  // An open store with a real catalog may offer the server-built WhatsApp link (BB-10); otherwise nothing sends.
  if (body.acceptingOrders !== true) await expectNoSendAction(page);
});
