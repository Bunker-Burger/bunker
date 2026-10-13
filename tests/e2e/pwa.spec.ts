import { expect, test, type Page } from "@playwright/test";
import { openScreen } from "./screens";

/*
 * BB-16 against the production build: installable, the caching policy (what is stored and what is
 * never stored), the offline fallback, and that offline nothing can be sent or paid.
 */

/** Waits, without reloading, until this page's worker finished activating (activation stores the menu). */
async function workerActivated(page: Page) {
  await page.evaluate(async () => {
    const worker = (await navigator.serviceWorker.ready).active;
    if (!worker || worker.state === "activated") return;
    await new Promise<void>((resolve) => {
      worker.addEventListener("statechange", () => {
        if (worker.state === "activated") resolve();
      });
    });
  });
}

async function controlledByWorker(page: Page) {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // Reload so this page load goes through the worker (and its document is cached).
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
}

async function cachedUrls(page: Page) {
  return page.evaluate(async () => {
    const entries: Array<{ cache: string; url: string }> = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) entries.push({ cache: name, url: request.url });
    }
    return entries;
  });
}

test("the menu is installable: manifest, icons and a controlling worker", async ({ page, request, browserName }) => {
  const manifestResponse = await request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBe(true);
  const manifest = (await manifestResponse.json()) as { start_url: string; display: string; icons: Array<{ src: string; sizes: string; purpose?: string }> };
  expect(manifest).toMatchObject({ start_url: "/", display: "standalone" });
  for (const icon of manifest.icons) {
    const response = await request.get(icon.src);
    expect(response.ok(), icon.src).toBe(true);
    expect(response.headers()["content-type"]).toContain("image/png");
  }

  const worker = await request.get("/sw.js");
  expect(worker.headers()["cache-control"]).toContain("no-cache");

  await controlledByWorker(page);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/icons/apple-touch-icon.png");

  test.skip(browserName !== "chromium", "installability errors are a Chromium DevTools API");
  const devtools = await page.context().newCDPSession(page);
  const { installabilityErrors } = (await devtools.send("Page.getInstallabilityErrors")) as { installabilityErrors: Array<{ errorId: string }> };
  expect(installabilityErrors.map((error) => error.errorId)).toEqual([]);
});

test("the worker stores the public menu and assets, never admin, APIs or RSC payloads", async ({ page }) => {
  await controlledByWorker(page);
  await page.goto("/bunker");
  await page.goto("/");
  // A client navigation fetches an RSC payload through the worker.
  await page.getByRole("button", { name: "Agregar Smash Búnker Doble" }).click();

  const entries = await cachedUrls(page);
  const paths = entries.map(({ url }) => {
    const parsed = new URL(url);
    return { path: parsed.pathname, rsc: parsed.searchParams.has("_rsc") };
  });
  expect(entries.some(({ cache, url }) => cache === "bunker-pages" && new URL(url).pathname === "/")).toBe(true);
  expect(paths.filter(({ path }) => path === "/bunker" || path.startsWith("/bunker/") || path.startsWith("/api/"))).toEqual([]);
  expect(paths.filter(({ rsc }) => rsc)).toEqual([]);
  expect(entries.some(({ cache, url }) => cache.includes("precache") && new URL(url).pathname === "/offline")).toBe(true);
});

test("offline the cached menu opens and the cart works, but nothing can be sent or paid", async ({ page, context }) => {
  await controlledByWorker(page);
  await context.setOffline(true);
  await page.reload();

  await expect(page.getByRole("heading", { level: 1, name: "LA CARTA DEL BÚNKER" })).toBeVisible();
  await page.getByRole("button", { name: "Agregar Smash Búnker Doble" }).click();
  await expect(page.getByLabel("Carrito, 1 productos")).toBeVisible();

  const checkout = await openScreen(page, "checkout");
  await expect(checkout.getByTestId("offline-note")).toBeVisible();
  await expect(checkout.getByRole("button", { name: "Sin conexión" })).toBeDisabled();
  await expect(page.locator('a[href*="wa.me"]')).toHaveCount(0);
  await context.setOffline(false);
});

test("a single online visit leaves the menu ready offline, without reloading the page", async ({ page, context }) => {
  // Fresh context: no worker, no caches. The first document arrives before the worker exists.
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "LA CARTA DEL BÚNKER" })).toBeVisible();
  await page.evaluate(() => {
    (window as Window & { firstVisit?: boolean }).firstVisit = true;
  });
  await workerActivated(page);
  // Still the same document: nothing reloaded it to get the menu cached.
  expect(await page.evaluate(() => (window as Window & { firstVisit?: boolean }).firstVisit)).toBe(true);
  expect(await page.evaluate(() => performance.getEntriesByType("navigation").length)).toBe(1);

  await context.setOffline(true);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "LA CARTA DEL BÚNKER" })).toBeVisible();
  await page.getByRole("button", { name: "Agregar Smash Búnker Doble" }).click();
  await expect(page.getByLabel("Carrito, 1 productos")).toBeVisible();
  const checkout = await openScreen(page, "checkout");
  await expect(checkout.getByRole("button", { name: "Sin conexión" })).toBeDisabled();
  // APIs stay network-only: offline they fail instead of answering from a cache.
  expect(await page.evaluate(() => fetch("/api/store/products").then(() => "answered", () => "failed"))).toBe("failed");
  expect(await page.evaluate(() => fetch("/api/store/status").then(() => "answered", () => "failed"))).toBe("failed");
  await context.setOffline(false);
});

test("offline, Admin and pages never visited show the public offline page, not cached content", async ({ page, context }) => {
  await controlledByWorker(page);
  await context.setOffline(true);
  for (const path of ["/bunker", "/bunker/admin", "/design-system"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: "Sin conexión" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Volver a la carta" })).toHaveAttribute("href", "/");
    await expect(page.getByRole("textbox", { name: "Email" })).toHaveCount(0);
  }
  await context.setOffline(false);
});
