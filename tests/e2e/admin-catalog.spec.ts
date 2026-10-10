import { expect, test } from "@playwright/test";

// BB-12/BB-13: the admin screens live under the protected admin layout; anonymous visits never render them.
// BB-13: store and promotion screens too.
for (const path of [
  "/bunker/admin/catalogo",
  "/bunker/admin/catalogo?tipo=bebidas",
  "/bunker/admin/catalogo/productos/nuevo",
  "/bunker/admin/catalogo/productos/0199b2c8-40b0-7000-8000-000000000201",
  "/bunker/admin/tienda",
  "/bunker/admin/promociones",
  "/bunker/admin/promociones/nueva",
  "/bunker/admin/promociones/0d000000-0000-4000-8000-000000000001"
]) {
  test(`anonymous ${path} goes back to the login`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(/\/bunker$/);
    await expect(page.getByRole("heading", { name: "Administración" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Tipos de producto" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Administración" })).toHaveCount(0);
  });
}
