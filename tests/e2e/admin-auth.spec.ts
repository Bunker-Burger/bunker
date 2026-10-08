import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";

/*
 * BB-11 on the production build: the admin area answers only to a server-validated session.
 * Without real admin accounts here, these cover what any visitor can reach: the login page,
 * the refusal of /bunker/admin, safe redirects, no caching and the storefront's tabs. The
 * signed-in paths (membership, expiry, cross access, sign-out) are covered by the unit tests
 * against the real Supabase clients.
 */

const WCAG_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** Session cookie name the server reads: `sb-<project ref>-auth-token` (ref from the build's env). */
function authCookieName() {
  const fromFile = existsSync(".env.local") ? /^NEXT_PUBLIC_SUPABASE_URL=(.*)$/m.exec(readFileSync(".env.local", "utf8"))?.[1] : undefined;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? fromFile?.trim();
  const ref = url ? new URL(url).hostname.split(".")[0] : "no-project";
  return `sb-${ref}-auth-token`;
}

test("an anonymous visitor is sent from /bunker/admin to the login, with no admin content", async ({ page }) => {
  const response = await page.goto("/bunker/admin");
  await expect(page).toHaveURL(/\/bunker$/);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Ingresar al panel" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Panel de administración" })).toHaveCount(0);
  await expect(page.locator('input[name="next"]')).toHaveValue("/bunker/admin");

  // A deep admin link survives the trip through the login (pages beyond the home come in BB-12/13).
  await page.goto(`/bunker?next=${encodeURIComponent("/bunker/admin/productos?tab=papas")}`);
  await expect(page.locator('input[name="next"]')).toHaveValue("/bunker/admin/productos?tab=papas");
});

test("a forged session cookie does not open the admin area", async ({ page, context }) => {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ sub: "00000000-0000-4000-8000-000000000000", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, user_metadata: { role: "admin" } })
  ).toString("base64url");
  const session = {
    access_token: `${header}.${payload}.forged`,
    refresh_token: "forged",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600,
    token_type: "bearer",
    user: { id: "00000000-0000-4000-8000-000000000000", aud: "authenticated", app_metadata: {}, user_metadata: { role: "admin" }, created_at: new Date(0).toISOString() }
  };
  await context.addCookies([
    { name: authCookieName(), value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`, url: "http://127.0.0.1:3000" }
  ]);

  await page.goto("/bunker/admin");
  await expect(page.getByRole("heading", { name: "Panel de administración" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cerrar sesión" })).toHaveCount(0);

  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Navegación principal" }).getByRole("link", { name: "Admin" })).toHaveCount(0);
});

test("the login never sends anyone outside /bunker/admin", async ({ page }) => {
  for (const next of ["https://evil.example/bunker/admin", "//evil.example", "/\\evil.example", "/"]) {
    await page.goto(`/bunker?next=${encodeURIComponent(next)}`);
    await expect(page.locator('input[name="next"]')).toHaveValue("/bunker/admin");
  }
});

for (const width of [320, 390, 768, 1280]) {
  test(`the login page works by keyboard, meets WCAG AA and fits at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/bunker");

    await expect(page.getByRole("link", { name: /registr|crear cuenta/i })).toHaveCount(0);
    const nav = page.getByRole("navigation", { name: "Navegación principal" });
    await expect(nav.getByRole("link", { name: "Menú" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Admin" })).toHaveCount(0);

    await page.getByLabel("Email").focus();
    await page.keyboard.type("nadie@bunker.test");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Contraseña")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Ingresar" })).toBeFocused();

    const results = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
    expect(results.violations.map(({ id, nodes }) => `${id}: ${nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("a rejected sign-in stays on the login with an announced error and no session", async ({ page, context }) => {
  // The same answer for unknown accounts and wrong passwords (checked by the server against the
  // development project locally); without Supabase (CI) the check cannot run and says so.
  // Either way, nobody gets in.
  await page.goto("/bunker");
  await page.getByLabel("Email").fill("nadie@bunker.test");
  await page.getByLabel("Contraseña").fill("incorrecta");
  await page.getByRole("button", { name: "Ingresar" }).click();

  await expect(page.locator("#admin-login-error")).toHaveText(
    /Email o contraseña incorrectos, o la cuenta no tiene acceso de administración\.|No pudimos verificar tu acceso\. Intentá de nuevo en unos minutos\./
  );
  await expect(page).toHaveURL(/\/bunker$/);
  await expect(page.getByLabel("Email")).toHaveValue("nadie@bunker.test");
  await expect(page.getByLabel("Contraseña")).toHaveValue("");
  expect((await context.cookies()).filter(({ name }) => /^sb-.+-auth-token/.test(name))).toEqual([]);
});

test("admin pages are never cacheable", async ({ request }) => {
  for (const path of ["/bunker", "/bunker/admin"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.headers()["cache-control"], path).toMatch(/no-store/);
    expect(response.headers()["cache-control"], path).not.toMatch(/public|s-maxage/);
  }
});

test("the service worker never stores administrative pages", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  // Navigations through the controlling worker, including a redirect from /bunker/admin.
  await page.goto("/bunker");
  await page.goto("/bunker/admin");
  await expect(page.getByRole("heading", { name: "Ingresar al panel" })).toBeVisible();

  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) urls.push(request.url);
    }
    return urls;
  });
  expect(cached.filter((url) => /^\/bunker(\/|$)/.test(new URL(url).pathname))).toEqual([]);
});

test("the storefront shows no Admin tab to anonymous visitors", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Navegación principal" });
  await expect(nav.getByRole("link", { name: "Menú" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Admin" })).toHaveCount(0);
});
