import { expect, test } from "@playwright/test";

const adminEmail = process.env.SUPABASE_TEST_ADMIN_EMAIL;
const adminPassword = process.env.SUPABASE_TEST_ADMIN_PASSWORD;

test("login is private and direct anonymous admin access returns to it", async ({ page }) => {
  await page.goto("/bunker/admin");

  await expect(page).toHaveURL(/\/bunker$/);
  await expect(page.getByRole("heading", { name: "Administración" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Email" })).toBeVisible();
  await expect(page.getByLabel("Contraseña")).toHaveAttribute("type", "password");
  await expect(page.getByRole("link", { name: /registr|recuper/i })).toHaveCount(0);
});

test("invalid credentials reveal neither account existence nor a redirect target", async ({ page }) => {
  await page.goto("/bunker?returnTo=https://evil.example");
  await page.getByRole("textbox", { name: "Email" }).fill("nobody@example.com");
  await page.getByLabel("Contraseña").fill("definitely-wrong");
  await page.getByRole("button", { name: "Ingresar" }).click();

  await expect(page.locator("form").getByRole("alert")).toHaveText("Email o contraseña incorrectos");
  await expect(page).toHaveURL(/\/bunker\?returnTo=/);
});

test("the sole owner can enter, sees Admin navigation, logs out, and cannot return", async ({ page }) => {
  test.skip(!adminEmail || !adminPassword, "development owner credentials are not configured");

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
