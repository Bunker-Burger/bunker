import { expect, test, type Page } from "@playwright/test";

/*
 * BB-02 responsive matrix. Runs once per `viewport-*` project (320, 390, 768, 1280 px) against
 * the production build and the real storefront/design-system UI — nothing is mocked.
 */

const DESKTOP_MIN = 1024; // lg breakpoint: floating bottom nav, two-column checkout
const TWO_COLUMN_GRID_MIN = 672; // 42rem in storefront.css

const INTERACTIVE = [
  "a[href]",
  "button",
  "[role=tab]",
  "[role=switch]",
  "[role=combobox]",
  "input:not([type=hidden])",
  "textarea",
  "select"
].join(",");

interface Target {
  label: string;
  width: number;
  height: number;
}

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** Visible interactive targets; radios/checkboxes are measured through their wrapping label. */
async function undersizedTargets(page: Page): Promise<Target[]> {
  return page.locator(INTERACTIVE).evaluateAll((elements) =>
    elements.flatMap((element) => {
      if (element.closest("[aria-hidden=true]")) return [];
      const style = getComputedStyle(element);
      if (style.visibility === "hidden" || style.display === "none") return [];
      const boxOwner =
        element instanceof HTMLInputElement && (element.type === "radio" || element.type === "checkbox")
          ? element.closest("label") ?? element
          : element;
      const { width, height } = boxOwner.getBoundingClientRect();
      if (width <= 1 && height <= 1) return []; // visually hidden (e.g. skip link before focus)
      if (width >= 44 && height >= 44) return [];
      const label = (element.getAttribute("aria-label") ?? element.textContent ?? element.tagName).trim().slice(0, 40);
      return [{ label, width: Math.round(width), height: Math.round(height) }];
    })
  );
}

/**
 * Moves focus through every interactive element in <main> (the browser scrolls each into view as a
 * keyboard user would) and reports any whose center is painted over by another element, e.g. the
 * fixed bottom nav or the cart tray.
 */
async function coveredWhenFocused(page: Page): Promise<string[]> {
  const count = await page.locator(`main :is(${INTERACTIVE})`).count();
  const covered: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const result = await page.locator(`main :is(${INTERACTIVE})`).nth(index).evaluate((element: HTMLElement) => {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || element.closest("[aria-hidden=true]")) return null;
      element.focus({ preventScroll: false });
      if (document.activeElement !== element) return null; // not focusable (e.g. disabled)
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      const label = (element.getAttribute("aria-label") ?? element.textContent ?? element.tagName).trim().slice(0, 40);
      const owner = element.closest("label");
      return hit && (element.contains(hit) || hit.contains(element) || owner?.contains(hit)) ? null : `${label} → covered by ${hit?.tagName ?? "nothing"}.${hit?.className ?? ""}`;
    });
    if (result) covered.push(result);
  }
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  return covered;
}

/** At the very end of the page, the last content of <main> must sit above every fixed bar. */
async function endOfPageClearance(page: Page) {
  return page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    const main = document.querySelector("main");
    const last = main?.lastElementChild?.getBoundingClientRect();
    const fixed = [...document.querySelectorAll<HTMLElement>("body *")].filter((element) => {
      const style = getComputedStyle(element);
      return style.position === "fixed" && style.display !== "none" && !element.hidden && element.getBoundingClientRect().height > 0;
    });
    const overlapping = fixed
      .map((element) => element.getBoundingClientRect())
      // Bottom-anchored bars only; top notices (e.g. the "added to cart" status) are transient overlays.
      .filter((rect) => last && rect.top > window.innerHeight / 2 && rect.left < last.right && rect.right > last.left);
    const firstFixedTop = Math.min(window.innerHeight, ...overlapping.map((rect) => rect.top));
    return { lastContentBottom: Math.round(last?.bottom ?? 0), firstFixedTop: Math.round(firstFixedTop) };
  });
}

async function layoutMetrics(page: Page) {
  return page.evaluate(() => {
    const columns = (selector: string) => {
      const element = document.querySelector(selector);
      return element ? getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean).length : 0;
    };
    const rect = (selector: string) => {
      const box = document.querySelector(selector)?.getBoundingClientRect();
      return box ? { left: Math.round(box.left), right: Math.round(box.right), top: Math.round(box.top), bottom: Math.round(box.bottom), width: Math.round(box.width) } : null;
    };
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      header: rect("header"),
      nav: rect("nav[aria-label='Navegación principal']"),
      content: rect("main > div"),
      productColumns: columns(".product-grid"),
      checkoutColumns: columns(".checkout-layout")
    };
  });
}

test.describe("responsive shell", () => {
  // Measure final positions: reduced motion turns off smooth scrolling in globals.css.
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("storefront: no overflow, 44px targets, nothing hidden by fixed bars, coherent layout", async ({ page }, testInfo) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "LA CARTA DEL BÚNKER" })).toBeVisible();

    // Fill the cart so the fixed cart tray is on screen too.
    await page.getByRole("button", { name: "Agregar Smash Búnker Doble" }).click();
    await expect(page.locator(".cart-tray")).toBeVisible();

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    expect(await undersizedTargets(page)).toEqual([]);
    expect(await coveredWhenFocused(page)).toEqual([]);
    const clearance = await endOfPageClearance(page);
    expect(clearance.lastContentBottom).toBeLessThanOrEqual(clearance.firstFixedTop);

    await page.evaluate(() => window.scrollTo(0, 0));
    // Back at the top, the scroll-spy hands the current marker back to Menú.
    await expect(page.locator("nav a[aria-current=location]")).toHaveAccessibleName(/^Menú/);
    const metrics = await layoutMetrics(page);
    const { width, height } = metrics.viewport;

    expect(metrics.header).toMatchObject({ top: 0, left: 0, right: width });
    expect(metrics.content?.width).toBeLessThanOrEqual(1280);
    if (width >= DESKTOP_MIN) {
      expect(metrics.nav?.width).toBeLessThan(width / 2); // floating pill
      expect(metrics.nav?.right).toBeLessThan(width);
      expect(metrics.checkoutColumns).toBe(2);
    } else {
      expect(metrics.nav).toMatchObject({ left: 0, right: width, bottom: height }); // full-width bottom bar
      expect(metrics.checkoutColumns).toBe(1);
    }
    expect(metrics.productColumns).toBe(width >= DESKTOP_MIN ? 3 : width >= TWO_COLUMN_GRID_MIN ? 2 : 1);

    await testInfo.attach(`metrics-${width}`, { body: JSON.stringify({ ...metrics, clearance }, null, 2), contentType: "application/json" });
    await testInfo.attach(`storefront-${width}`, { body: await page.screenshot(), contentType: "image/png" });
  });

  test("bottom nav marks the section the user navigates to", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Navegación principal" });
    for (const label of ["Carrito", "Checkout", "Menú"]) {
      await nav.getByRole("link", { name: new RegExp(`^${label}`) }).click();
      const current = nav.locator("a[aria-current=location]");
      await expect(current).toHaveCount(1);
      await expect(current).toHaveAccessibleName(new RegExp(`^${label}`));
    }

    // Scrolling by hand (not via a link) moves the marker with the content.
    const current = nav.locator("a[aria-current=location]");
    await page.mouse.wheel(0, 100_000);
    await expect(current).toHaveAccessibleName(/^Checkout/);
    await page.mouse.wheel(0, -100_000);
    await expect(current).toHaveAccessibleName(/^Menú/);
    await expect(current).toHaveCount(1);
  });

  test("design system page holds the same guarantees", async ({ page }, testInfo) => {
    await page.goto("/design-system");
    await expect(page.getByRole("heading", { level: 1, name: "Sistema visual" })).toBeVisible();

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    expect(await undersizedTargets(page)).toEqual([]);
    expect(await coveredWhenFocused(page)).toEqual([]);
    const clearance = await endOfPageClearance(page);
    expect(clearance.lastContentBottom).toBeLessThanOrEqual(clearance.firstFixedTop);

    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator("nav a[aria-current=location]")).toHaveAccessibleName(/^Tokens/);
    await testInfo.attach(`design-system-${page.viewportSize()?.width}`, { body: await page.screenshot(), contentType: "image/png" });
  });

  test("fixed bars step aside while typing on touch devices", async ({ page, isMobile }) => {
    test.skip(!isMobile, "no on-screen keyboard on the desktop pointer project");
    await page.goto("/");
    await page.getByRole("button", { name: "Agregar Smash Búnker Doble" }).click();
    const nav = page.getByRole("navigation", { name: "Navegación principal" });
    const tray = page.locator(".cart-tray");
    await expect(nav).toBeVisible();
    await expect(tray).toBeVisible();

    const name = page.getByPlaceholder("¿A nombre de quién?");
    await name.focus();
    await expect(nav).toBeHidden();
    await expect(tray).toBeHidden();
    await expect(name).toBeInViewport();

    await name.blur();
    await expect(nav).toBeVisible();
    await expect(tray).toBeVisible();
  });
});
