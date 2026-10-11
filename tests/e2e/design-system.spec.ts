import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const WCAG_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

for (const path of ["/", "/design-system"]) {
  test(`${path} has no WCAG AA violations`, async ({ page }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
    expect(results.violations.map(({ id, nodes }) => `${id}: ${nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
  });

  test(`${path} does not scroll horizontally`, async ({ page }) => {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("design system shows every primitive and state", async ({ page }) => {
  await page.goto("/design-system");

  for (const heading of ["Tokens", "Componentes", "Estados", "Overlays"]) {
    await expect(page.getByRole("heading", { level: 2, name: heading })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Deshabilitado" })).toBeDisabled();
  await expect(page.getByText("Agotado", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tu carrito está vacío" })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "No pudimos cargar la carta" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Retiro en el local" })).toBeChecked();
  await expect(page.getByRole("tab", { name: "Bebidas" })).toBeDisabled();
  await expect(page.getByLabel("Cargando producto")).toHaveAttribute("aria-busy", "true");
});

test("keyboard users can skip to content and operate overlays", async ({ page }) => {
  await page.goto("/design-system");

  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Saltar al contenido" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();

  const trigger = page.getByRole("button", { name: "Abrir diálogo" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "¿Vaciar el carrito?" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await page.getByRole("button", { name: "Mostrar toast" }).click();
  await expect(page.getByText("Smash Búnker Doble se agregó al carrito.")).toBeVisible();
});

test("a populated drawer and checkout stay accessible and announce cart changes", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Ver Smash Búnker Doble" }).click();

  const drawer = page.getByRole("dialog", { name: "Personalizar Smash Búnker Doble" });
  await expect(drawer.getByRole("button", { name: "Cerrar personalizador" })).toBeFocused();
  const drawerAudit = await new AxeBuilder({ page }).include("[role=dialog]").withTags(WCAG_AA).analyze();
  expect(drawerAudit.violations).toEqual([]);

  await drawer.getByRole("button", { name: /Agregar 1 al carrito/ }).click();
  await expect(page.getByRole("status")).toHaveText("Smash Búnker Doble se agregó al carrito.");

  const checkout = page.getByRole("region", { name: "Finalizar pedido" });
  await checkout.getByRole("radio", { name: /Delivery/ }).check();
  const checkoutAudit = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
  expect(checkoutAudit.violations).toEqual([]);
});

test("interactive targets in the shell are at least 44px", async ({ page }) => {
  await page.goto("/design-system");
  const targets = page.locator("nav a, main button:visible, [role=tab], [role=combobox]");
  const sizes = await targets.evaluateAll((elements) =>
    elements.map((element) => {
      const { width, height } = element.getBoundingClientRect();
      return { label: element.textContent?.trim() || element.getAttribute("aria-label"), width, height };
    })
  );
  expect(sizes.length).toBeGreaterThan(10);
  expect(sizes.filter(({ width, height }) => width < 44 || height < 44)).toEqual([]);
});

test.describe("on touch devices", () => {
  test.skip(({ isMobile }) => !isMobile, "virtual keyboard only exists on touch devices");

  test("bottom bar hides while editing so it never covers the field", async ({ page }) => {
    await page.goto("/design-system");
    const nav = page.getByRole("navigation", { name: "Navegación principal" });
    await expect(nav).toBeVisible();

    await page.getByLabel("Tu nombre").focus();
    await expect(nav).toBeHidden();

    await page.getByLabel("Tu nombre").blur();
    await expect(nav).toBeVisible();
  });
});
