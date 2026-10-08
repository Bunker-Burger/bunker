import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/*
 * BB-09: the menu and the checkout estimate announce only the promotions the server publishes
 * at `/api/store/promotions` (the same fresh read the quote uses), re-read every minute. The
 * endpoint is answered with the exact shape the server produces, built from the development
 * seed's "Martes de Smash"; the last tests run against the real endpoint of this build. The
 * browser clock sits on a Tuesday night in Tucumán, inside the rule's weekly window.
 */

// Tuesday 2026-10-13 21:00 and Wednesday 2026-10-14 21:00 in Tucumán (UTC-3).
const TUESDAY_NIGHT = new Date("2026-10-14T00:00:00Z");
const WEDNESDAY_NIGHT = new Date("2026-10-15T00:00:00Z");
const REFRESH_MS = 60_000;

const martesDeSmash = (overrides: { percentOff?: number; channels?: string[] } = {}) => ({
  id: "0199b2c8-40b0-7000-8000-000000000501",
  slug: "martes-de-smash",
  name: "Martes de Smash",
  priority: 10,
  startsAt: "2026-10-01T03:00:00.000Z",
  endsAt: "2027-04-01T02:59:00.000Z",
  mechanic: { type: "percent_off", percentOff: overrides.percentOff ?? 15 },
  channels: overrides.channels ?? ["delivery", "pickup"],
  items: [{ productSlug: "smash-bunker-doble", quantity: 1 }],
  schedule: [{ dayOfWeek: 2, startsAt: "18:00:00", endsAt: "23:59:00" }]
});

const openStore = {
  state: "open",
  acceptingOrders: true,
  reason: "manual_open",
  closesAt: null,
  nextOpeningAt: null,
  deliveryFeeCents: "120000",
  timezone: "America/Argentina/Tucuman"
};

/** Answers the public endpoints; `published.body` can change between reads, like the database. */
async function serve(page: Page, body: unknown) {
  const published = { body };
  await page.route("**/api/store/promotions", (route) =>
    route.fulfill({ json: published.body, headers: { "cache-control": "no-store" } })
  );
  await page.route("**/api/store/status", (route) => route.fulfill({ json: openStore, headers: { "cache-control": "no-store" } }));
  return published;
}

const smashCard = (page: Page) =>
  page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Smash Búnker Doble" }) });
const total = (page: Page) => page.locator(".summary-card .summary-total strong");

test.describe("with the promotions answered by state", () => {
  // page.route() does not see requests made by the service worker; the SW is covered below.
  test.use({ serviceWorkers: "block" });

  for (const width of [320, 390, 768, 1280]) {
    test(`shows the published promotion on the card and in the checkout at ${width}px`, async ({ page }) => {
      await page.clock.install({ time: TUESDAY_NIGHT });
      await serve(page, { promotions: [martesDeSmash()] });
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");

      const card = smashCard(page);
      await expect(card.locator("s.compare-at")).toHaveText("Antes $ 7.800");
      await expect(card.getByText("$ 6.630")).toBeVisible();
      await expect(card.getByText("Martes de Smash: 15% de descuento en productos seleccionados")).toBeVisible();

      await card.getByRole("button", { name: "Agregar Smash Búnker Doble" }).click();
      const applied = page.getByTestId("applied-promotion");
      await expect(applied).toContainText("Promoción: Martes de Smash");
      await expect(applied).toContainText("-$ 1.170");
      await expect(applied).toContainText("No se acumula con otras promociones.");
      await expect(total(page)).toHaveText("$ 6.630");

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test("a promotion paused, then edited, in the database reaches the open page at the next read", async ({ page }) => {
    await page.clock.install({ time: TUESDAY_NIGHT });
    const published = await serve(page, { promotions: [martesDeSmash()] });
    await page.goto("/");
    await smashCard(page).getByRole("button", { name: "Agregar Smash Búnker Doble" }).click();
    await expect(total(page)).toHaveText("$ 6.630");

    published.body = { promotions: [] };
    await page.clock.runFor(REFRESH_MS);
    await expect(smashCard(page).locator("s.compare-at")).toHaveCount(0);
    await expect(page.getByTestId("applied-promotion")).toHaveCount(0);
    await expect(total(page)).toHaveText("$ 7.800");

    published.body = { promotions: [martesDeSmash({ percentOff: 25 })] };
    await page.clock.runFor(REFRESH_MS);
    await expect(smashCard(page).getByText("$ 5.850")).toBeVisible();
    await expect(page.getByTestId("applied-promotion")).toContainText("-$ 1.950");
    await expect(total(page)).toHaveText("$ 5.850");
  });

  test("a delivery-only promotion is announced only once delivery is chosen (keyboard)", async ({ page }) => {
    await page.clock.install({ time: TUESDAY_NIGHT });
    await serve(page, { promotions: [martesDeSmash({ channels: ["delivery"] })] });
    await page.goto("/");
    await smashCard(page).getByRole("button", { name: "Agregar Smash Búnker Doble" }).click();

    const pickup = page.getByRole("radio", { name: /Retiro en local/ });
    await expect(pickup).toBeChecked();
    await expect(page.getByTestId("store-status")).toHaveText("El local está abierto.");
    await expect(smashCard(page).locator("s.compare-at")).toHaveCount(0);
    await expect(total(page)).toHaveText("$ 7.800");

    await pickup.focus();
    await page.keyboard.press("ArrowUp");
    await expect(page.getByRole("radio", { name: /Delivery/ })).toBeChecked();
    await expect(smashCard(page).locator("s.compare-at")).toHaveText("Antes $ 7.800");
    await expect(page.getByTestId("applied-promotion")).toContainText("-$ 1.170");
    // 7.800 − 1.170 + 1.200 delivery.
    await expect(total(page)).toHaveText("$ 7.830");
  });

  test("the struck price, the promotion note and the applied promotion meet WCAG AA", async ({ page }) => {
    await page.clock.install({ time: TUESDAY_NIGHT });
    await serve(page, { promotions: [martesDeSmash()] });
    await page.goto("/");
    await smashCard(page).getByRole("button", { name: "Agregar Smash Búnker Doble" }).click();
    await expect(page.getByTestId("applied-promotion")).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map(({ id, nodes }) => `${id}: ${nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
  });

  test("shows no promotion outside the Tuesday window", async ({ page }) => {
    await page.clock.install({ time: WEDNESDAY_NIGHT });
    await serve(page, { promotions: [martesDeSmash()] });
    await page.goto("/");
    const card = smashCard(page);
    await expect(card.getByText("$ 7.800")).toBeVisible();
    await expect(card.locator("s.compare-at")).toHaveCount(0);
  });
});

test("the service worker never stores the promotions", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // Reload so the page is controlled and its promotions request goes through the worker.
  const reread = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/store/promotions");
  await page.reload();
  await reread;
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) urls.push(request.url);
    }
    return urls;
  });
  expect(cached.filter((url) => new URL(url).pathname === "/api/store/promotions")).toEqual([]);
});

test("the real promotions endpoint answers fresh and without admin text; without it the menu announces no discount", async ({
  page,
  request
}) => {
  const response = await request.get("/api/store/promotions");
  expect(response.headers()["cache-control"]).toBe("no-store");
  const body = (await response.json()) as { promotions?: unknown[]; error?: unknown };
  if (response.ok()) {
    expect(Array.isArray(body.promotions)).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/"description"|"badgeText"/);
  } else {
    // Without Supabase credentials (e.g. CI) the endpoint publishes no rules, only an error code.
    expect([404, 503]).toContain(response.status());
    expect(body.promotions).toBeUndefined();
    await page.clock.install({ time: TUESDAY_NIGHT });
    await page.goto("/");
    await expect(page.getByTestId("store-status")).not.toHaveText("Verificando si el local está tomando pedidos…");
    await expect(page.locator("s.compare-at")).toHaveCount(0);
  }
});
