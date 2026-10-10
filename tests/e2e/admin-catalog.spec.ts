import { expect, test } from "@playwright/test";

// BB-12: the catalog screens live under the protected admin layout; anonymous visits never render them.
for (const path of ["/bunker/admin/catalogo", "/bunker/admin/catalogo?tipo=bebidas", "/bunker/admin/catalogo/productos/nuevo", "/bunker/admin/catalogo/productos/0199b2c8-40b0-7000-8000-000000000201"]) {
  test(`anonymous ${path} goes back to the login`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(/\/bunker$/);
    await expect(page.getByRole("heading", { name: "Administración" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Tipos de producto" })).toHaveCount(0);
  });
}
