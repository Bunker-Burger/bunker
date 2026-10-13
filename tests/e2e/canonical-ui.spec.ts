import { expect, test } from "@playwright/test";
import { openScreen } from "./screens";

/*
 * Issue #54: Canonical UI Behaviors (Toast, Product Drawer, Cart Tray, Hash Routing)
 */

test.describe("Canonical UI: Toast Notifications", () => {
  test.use({ serviceWorkers: "block" });

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("toast auto-dismisses after ~4 seconds with lower and upper boundary verification", async ({ page }) => {
    const addBtn = page.getByRole("button", { name: "Agregar Smash Búnker Doble" });
    await addBtn.click();

    const toast = page.locator(".store-toast");
    await expect(toast).toBeVisible();
    await expect(toast).toContainText("Smash Búnker Doble se agregó al carrito.");

    // Lower bound: must remain visible near 3 seconds (rejects premature dismissal <3s / 100ms)
    await page.waitForTimeout(3000);
    await expect(toast).toBeVisible();

    // Upper bound: auto-dismisses at ~4s (must be gone by ~5.5s)
    await expect(toast).toHaveCount(0, { timeout: 2500 });
  });

  test("toast pauses countdown on mouse hover and resumes when unhovered", async ({ page }) => {
    const addBtn = page.getByRole("button", { name: "Agregar Smash Búnker Doble" });
    await addBtn.click();

    const toast = page.locator(".store-toast");
    await expect(toast).toBeVisible();

    // Hover to pause
    await toast.hover();
    await page.waitForTimeout(4500);
    // Still visible because timer was paused
    await expect(toast).toBeVisible();

    // Unhover to resume countdown
    await page.mouse.move(0, 0);
    await expect(toast).toHaveCount(0, { timeout: 6000 });
  });

  test("toast pauses countdown on keyboard focus and resumes on blur", async ({ page }) => {
    const addBtn = page.getByRole("button", { name: "Agregar Smash Búnker Doble" });
    await addBtn.click();

    const closeBtn = page.getByRole("button", { name: "Cerrar aviso" });
    await expect(closeBtn).toBeVisible();

    // Focus to pause
    await closeBtn.focus();
    await page.waitForTimeout(4500);
    await expect(page.locator(".store-toast")).toBeVisible();

    // Blur to resume countdown
    await closeBtn.blur();
    await expect(page.locator(".store-toast")).toHaveCount(0, { timeout: 6000 });
  });

  test("toast dismisses immediately with close button ✕", async ({ page }) => {
    const addBtn = page.getByRole("button", { name: "Agregar Smash Búnker Doble" });
    await addBtn.click();

    const closeBtn = page.getByRole("button", { name: "Cerrar aviso" });
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();

    await expect(page.locator(".store-toast")).toHaveCount(0);
  });

  test("toast renews 4-second timer on consecutive adds, avoids orphan timers, and tracks accurate cart line count", async ({ page }) => {
    const addBtn = page.getByRole("button", { name: "Agregar Smash Búnker Doble" });
    await addBtn.click();

    const toast = page.locator(".store-toast");
    await expect(toast).toBeVisible();

    // Wait 2.5s (> half duration)
    await page.waitForTimeout(2500);
    await expect(toast).toBeVisible();

    // Second click at 2.5s restarts the 4000ms timer
    await addBtn.click();

    // Wait another 2.5s (total 5.0s from first click)
    // If previous timer was still active (orphan timer), it would have fired at 4.0s.
    // Because timer renewed, toast MUST still be visible at 5.0s!
    await page.waitForTimeout(2500);
    await expect(toast).toBeVisible();

    // Third click
    await addBtn.click();

    // Single DOM notification element exists and cart reflects all 3 items
    await expect(page.locator(".store-toast")).toHaveCount(1);
    const region = page.locator(".store-toast-region[role='status'][aria-live='polite']");
    await expect(region).toBeVisible();
    await expect(region).toContainText("Smash Búnker Doble se agregó al carrito.");
    await expect(page.locator(".cart-tray")).toContainText("3 productos");

    // Eventually dismisses ~4s after the last click
    await expect(toast).toHaveCount(0, { timeout: 6000 });
  });
});

test.describe("Canonical UI: Product Personalizer Drawer", () => {
  test.use({ serviceWorkers: "block" });

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("opens drawer, customizes options, updates quantities, and adds with notes", async ({ page }) => {
    const card = page.getByRole("article").filter({ hasText: "Smash Búnker Doble" });
    const trigger = card.getByRole("button", { name: /Ver Smash Búnker Doble/i });
    await trigger.click();

    const drawer = page.getByRole("dialog", { name: "Personalizar Smash Búnker Doble" });
    await expect(drawer).toBeVisible();

    // Size / patty option selection (radio)
    const tripleRadio = drawer.getByRole("radio", { name: /Triple/i });
    await tripleRadio.check();
    await expect(tripleRadio).toBeChecked();

    // Kitchen notes textarea
    const notes = drawer.getByRole("textbox", { name: "Aclaraciones para la cocina" });
    await notes.fill("Sin cebolla por favor");

    // Quantity modification
    const plusBtn = drawer.getByRole("button", { name: "Aumentar cantidad" });
    const minusBtn = drawer.getByRole("button", { name: "Disminuir cantidad" });
    await plusBtn.click();
    await expect(drawer.getByText("2", { exact: true })).toBeVisible();
    await minusBtn.click();
    await expect(drawer.getByText("1", { exact: true })).toBeVisible();

    // Submit line
    await drawer.getByRole("button", { name: /Agregar 1 al carrito/i }).click();
    await expect(drawer).not.toBeVisible();

    // Verify in cart
    await openScreen(page, "carrito");
    const cartSection = page.locator("#carrito");
    await expect(cartSection.getByText("Smash Búnker Doble")).toBeVisible();
    await expect(cartSection.getByText("Sin cebolla por favor")).toBeVisible();
  });

  test("closes drawer with 'Seguir pidiendo' and returns focus to origin card", async ({ page }) => {
    const card = page.getByRole("article").filter({ hasText: "Smash Búnker Doble" });
    const trigger = card.getByRole("button", { name: /Ver Smash Búnker Doble/i });
    await trigger.click();

    const drawer = page.getByRole("dialog", { name: "Personalizar Smash Búnker Doble" });
    await expect(drawer).toBeVisible();

    const backBtn = drawer.getByRole("button", { name: "Seguir pidiendo" });
    await backBtn.click();
    await expect(drawer).not.toBeVisible();

    // Focus restored to trigger
    await expect(trigger).toBeFocused();
  });

  test("closes drawer with Escape key and returns focus to origin card", async ({ page }) => {
    const card = page.getByRole("article").filter({ hasText: "Smash Búnker Doble" });
    const trigger = card.getByRole("button", { name: /Ver Smash Búnker Doble/i });
    await trigger.click();

    const drawer = page.getByRole("dialog", { name: "Personalizar Smash Búnker Doble" });
    await expect(drawer).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(drawer).not.toBeVisible();

    // Focus restored to trigger
    await expect(trigger).toBeFocused();
  });
});

test.describe("Canonical UI: Fast Tray (cart-tray)", () => {
  test.use({ serviceWorkers: "block" });

  test("appears only on #menu when cart has items, shows correct subtotal, navigates to cart, and hides on other screens", async ({ page }) => {
    await page.goto("/");

    const tray = page.locator(".cart-tray");
    // Initially empty cart: tray hidden
    await expect(tray).toHaveCount(0);

    // Add 1 item
    await page.getByRole("button", { name: "Agregar Smash Búnker Doble" }).click();
    await expect(tray).toBeVisible();
    await expect(tray).toContainText("1 producto");
    await expect(tray).toContainText("$ 7.800");

    // Add another item
    await page.getByRole("button", { name: "Agregar Oklahoma Onion" }).click();
    await expect(tray).toContainText("2 productos");
    await expect(tray).toContainText("$ 15.000");

    // Clicking tray navigates to #carrito
    await tray.click();
    await expect(page.getByRole("region", { name: "Tu pedido" })).toBeVisible();
    expect(new URL(page.url()).hash).toBe("#carrito");

    // Tray is hidden on #carrito
    await expect(tray).toHaveCount(0);

    // Tray is hidden on #checkout
    await openScreen(page, "checkout");
    await expect(tray).toHaveCount(0);

    // Returning to #menu displays tray again
    await openScreen(page, "menu");
    await expect(tray).toBeVisible();
    await expect(tray).toContainText("2 productos");
  });
});

test.describe("Canonical UI: Hash Routing & Deep-Linking", () => {
  test.use({ serviceWorkers: "block" });

  test("deep-linking directly to /#menu, /#carrito, /#checkout renders active screen, hides inactive screens, and sets aria-current", async ({ page }) => {
    const nav = page.getByRole("navigation", { name: "Navegación principal" });
    const current = () => nav.locator("a[aria-current=location]");

    // /#carrito
    await page.goto("/#carrito");
    await expect(page.locator("#carrito")).toHaveAttribute("data-active", "true");
    await expect(page.locator("#carrito")).toBeVisible();
    await expect(page.locator("#menu")).toHaveAttribute("data-active", "false");
    await expect(page.locator("#menu")).toBeHidden();
    await expect(page.locator("#checkout")).toHaveAttribute("data-active", "false");
    await expect(page.locator("#checkout")).toBeHidden();
    await expect(page.getByRole("region", { name: "Tu pedido" })).toBeVisible();
    await expect(current()).toHaveAccessibleName(/^Carrito/);
    await expect(current()).toHaveCount(1);
    expect(await page.locator("#menu button:visible, #checkout button:visible").count()).toBe(0);

    // /#checkout
    await page.goto("/#checkout");
    await expect(page.locator("#checkout")).toHaveAttribute("data-active", "true");
    await expect(page.locator("#checkout")).toBeVisible();
    await expect(page.locator("#menu")).toHaveAttribute("data-active", "false");
    await expect(page.locator("#menu")).toBeHidden();
    await expect(page.locator("#carrito")).toHaveAttribute("data-active", "false");
    await expect(page.locator("#carrito")).toBeHidden();
    await expect(page.getByRole("region", { name: "Finalizar pedido" })).toBeVisible();
    await expect(current()).toHaveAccessibleName(/^Checkout/);
    await expect(current()).toHaveCount(1);
    expect(await page.locator("#menu button:visible, #carrito button:visible").count()).toBe(0);

    // /#menu
    await page.goto("/#menu");
    await expect(page.locator("#menu")).toHaveAttribute("data-active", "true");
    await expect(page.locator("#menu")).toBeVisible();
    await expect(page.locator("#carrito")).toHaveAttribute("data-active", "false");
    await expect(page.locator("#carrito")).toBeHidden();
    await expect(page.locator("#checkout")).toHaveAttribute("data-active", "false");
    await expect(page.locator("#checkout")).toBeHidden();
    await expect(page.getByRole("region", { name: "LA CARTA DEL BÚNKER" })).toBeVisible();
    await expect(current()).toHaveAccessibleName(/^Menú/);
    await expect(current()).toHaveCount(1);
    expect(await page.locator("#carrito button:visible, #checkout button:visible").count()).toBe(0);
  });

  test("invalid hash falls back to #menu as active and keeps other screens hidden", async ({ page }) => {
    await page.goto("/#pantalla-inexistente");
    const nav = page.getByRole("navigation", { name: "Navegación principal" });
    const current = nav.locator("a[aria-current=location]");

    await expect(page.locator("#menu")).toHaveAttribute("data-active", "true");
    await expect(page.locator("#menu")).toBeVisible();
    await expect(page.locator("#carrito")).toHaveAttribute("data-active", "false");
    await expect(page.locator("#carrito")).toBeHidden();
    await expect(page.locator("#checkout")).toHaveAttribute("data-active", "false");
    await expect(page.locator("#checkout")).toBeHidden();
    await expect(current).toHaveAccessibleName(/^Menú/);
  });

  test("reloading the page preserves active screen and keeps inactive screens hidden", async ({ page }) => {
    await page.goto("/#carrito");
    await expect(page.locator("#carrito")).toBeVisible();
    await expect(page.locator("#menu")).toBeHidden();
    await expect(page.locator("#checkout")).toBeHidden();

    await page.reload();
    await expect(page.locator("#carrito")).toHaveAttribute("data-active", "true");
    await expect(page.locator("#carrito")).toBeVisible();
    await expect(page.locator("#menu")).toHaveAttribute("data-active", "false");
    await expect(page.locator("#menu")).toBeHidden();
    await expect(page.locator("#checkout")).toHaveAttribute("data-active", "false");
    await expect(page.locator("#checkout")).toBeHidden();
  });

  test("browser Back and Forward buttons alternate screens while preserving cart state and hiding inactive views", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Agregar Smash Búnker Doble" }).click();

    // Navigate to carrito then checkout via nav
    await openScreen(page, "carrito");
    await expect(page.locator("#carrito")).toHaveAttribute("data-active", "true");
    await expect(page.locator("#carrito")).toBeVisible();
    await expect(page.locator("#menu")).toBeHidden();
    await expect(page.locator("#checkout")).toBeHidden();

    await openScreen(page, "checkout");
    await expect(page.locator("#checkout")).toHaveAttribute("data-active", "true");
    await expect(page.locator("#checkout")).toBeVisible();
    await expect(page.locator("#menu")).toBeHidden();
    await expect(page.locator("#carrito")).toBeHidden();

    // Browser back -> carrito
    await page.goBack();
    await expect(page.locator("#carrito")).toHaveAttribute("data-active", "true");
    await expect(page.locator("#carrito")).toBeVisible();
    await expect(page.locator("#carrito").getByText("Smash Búnker Doble")).toBeVisible();
    await expect(page.locator("#menu")).toBeHidden();
    await expect(page.locator("#checkout")).toBeHidden();

    // Browser back -> menu
    await page.goBack();
    await expect(page.locator("#menu")).toHaveAttribute("data-active", "true");
    await expect(page.locator("#menu")).toBeVisible();
    await expect(page.locator(".cart-tray")).toContainText("1 producto");
    await expect(page.locator("#carrito")).toBeHidden();
    await expect(page.locator("#checkout")).toBeHidden();

    // Browser forward -> carrito
    await page.goForward();
    await expect(page.locator("#carrito")).toHaveAttribute("data-active", "true");
    await expect(page.locator("#carrito")).toBeVisible();
    await expect(page.locator("#carrito").getByText("Smash Búnker Doble")).toBeVisible();
    await expect(page.locator("#menu")).toBeHidden();
    await expect(page.locator("#checkout")).toBeHidden();

    // Browser forward -> checkout
    await page.goForward();
    await expect(page.locator("#checkout")).toHaveAttribute("data-active", "true");
    await expect(page.locator("#checkout")).toBeVisible();
    await expect(page.locator("#menu")).toBeHidden();
    await expect(page.locator("#carrito")).toBeHidden();
  });
});
