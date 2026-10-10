import { expect, test } from "@playwright/test";

const adminEmail = process.env.SUPABASE_TEST_ADMIN_EMAIL;
const adminPassword = process.env.SUPABASE_TEST_ADMIN_PASSWORD;
const hasDevelopmentAuthConfig = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
    process.env.SUPABASE_PROJECT_ENV === "development" &&
    adminEmail &&
    adminPassword
);

if (process.env.SUPABASE_TEST_REQUIRE_CLOUD === "1" && !hasDevelopmentAuthConfig) {
  throw new Error("SUPABASE_TEST_REQUIRE_CLOUD=1 requires complete development Auth configuration");
}

test("login is private and direct anonymous admin access returns to it", async ({ page }) => {
  await page.goto("/bunker/admin");

  await expect(page).toHaveURL(/\/bunker$/);
  await expect(page.getByRole("heading", { name: "Administración" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Email" })).toBeVisible();
  await expect(page.getByLabel("Contraseña")).toHaveAttribute("type", "password");
  await expect(page.getByRole("link", { name: /registr|recuper/i })).toHaveCount(0);
});

test("invalid credentials reveal neither account existence nor a redirect target", async ({ page }) => {
  test.skip(!hasDevelopmentAuthConfig, "complete development Auth configuration is not available");

  await page.goto("/bunker?returnTo=https://evil.example");
  await page.getByRole("textbox", { name: "Email" }).fill("nobody@example.com");
  await page.getByLabel("Contraseña").fill("definitely-wrong");
  await page.getByRole("button", { name: "Ingresar" }).click();

  await expect(page.locator("form").getByRole("alert")).toHaveText("Email o contraseña incorrectos");
  await expect(page).toHaveURL(/\/bunker\?returnTo=/);
});

test("the sole owner can enter, sees Admin navigation, logs out, and cannot return", async ({ page }) => {
  test.skip(!hasDevelopmentAuthConfig, "complete development Auth configuration is not available");

  await page.goto("/bunker");
  await page.getByRole("textbox", { name: "Email" }).fill(adminEmail!);
  await page.getByLabel("Contraseña").fill(adminPassword!);
  await page.getByRole("button", { name: "Ingresar" }).click();

  await expect(page).toHaveURL(/\/bunker\/admin$/);
  await expect(page.getByRole("heading", { name: "Panel administrativo" })).toBeVisible();
  await page.getByRole("link", { name: "Búnker Burger, volver al menú" }).click();
  await expect(page.getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/bunker/admin");

  await page.goto("/bunker/admin");
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(/\/bunker$/);
  await page.goto("/bunker/admin");
  await expect(page).toHaveURL(/\/bunker$/);
});

// BB-12: read-only walk through the catalog admin. Nothing is written: the SVG is rejected on the
// server before any upload, and no form that saves data is submitted with valid values.
test("the owner manages the catalog by product type and a fake image is rejected server-side", async ({ page }) => {
  test.skip(!hasDevelopmentAuthConfig, "complete development Auth configuration is not available");

  await page.goto("/bunker");
  await page.getByRole("textbox", { name: "Email" }).fill(adminEmail!);
  await page.getByLabel("Contraseña").fill(adminPassword!);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/bunker\/admin$/);

  await page.getByRole("link", { name: "Administrar catálogo" }).click();
  const tabs = page.getByRole("navigation", { name: "Tipos de producto" }).getByRole("link");
  await expect(tabs).toHaveText(["Hamburguesas", "Sándwiches", "Papas", "Bebidas"]);
  await expect(page.locator("body")).not.toContainText(/pedidos|ventas|factura|ingresos|kpi/i);

  await page.getByRole("list", { name: /^Productos de / }).first().getByRole("link").first().click();
  await expect(page.getByRole("heading", { level: 2, name: "Foto" })).toBeVisible();
  await page.getByLabel(/^(Foto|Reemplazar foto)$/).setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"/>')
  });
  await page.getByRole("button", { name: /^(Subir foto|Guardar foto)$/ }).click();
  await expect(page.getByText("Formato no permitido: subí una imagen JPEG, PNG, WebP o AVIF.")).toBeVisible();
});
