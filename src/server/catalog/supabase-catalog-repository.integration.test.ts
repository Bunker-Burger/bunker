import { createClient, type Session } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { catalogImageBaseUrl, readSupabaseConfig } from "@/server/supabase/config";
import type { Database } from "@/server/supabase/database.types";
import { loadPublicCatalog } from "./catalog-service";
import { quoteCart } from "@/domain/pricing";
import { toPromotionRule } from "@/domain/public-promotions";
import { signInAdmin, signOutAdmin } from "@/server/auth/admin-auth";
import { INVALID_CREDENTIALS } from "@/server/auth/messages";
import { getAdminSession } from "@/server/auth/session";
import { getAdminCatalog, getPromotionsForQuote, getPublicPromotions, getStoreStatus } from "./index";
import { createSupabaseCatalogRepository } from "./supabase-catalog-repository";

/*
 * Reads the seeded catalog (supabase/seed.sql) from the cloud DEVELOPMENT project through
 * the real repositories, auth and RLS. Runs with `npm run test:integration` when `.env.local`
 * holds development credentials; readSupabaseConfig refuses production credentials here.
 *
 * Admin reads go through the production entry point `getAdminCatalog()`; only the request
 * cookies (next/headers) are supplied by the test. Cases needing real accounts are opt-in:
 *   SUPABASE_TEST_ADMIN_EMAIL / SUPABASE_TEST_ADMIN_PASSWORD          active admin of bunker-burger
 *   SUPABASE_TEST_MEMBERLESS_EMAIL / SUPABASE_TEST_MEMBERLESS_PASSWORD signed-in user, no membership
 */

const cookieJar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [...cookieJar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string, options: { maxAge?: number } = {}) =>
      void (value === "" || options.maxAge === 0 ? cookieJar.delete(name) : cookieJar.set(name, value))
  })
}));

const config = readSupabaseConfig();
const enabled = config.ok && config.value.projectEnv === "development";
const adminAccount = { email: process.env.SUPABASE_TEST_ADMIN_EMAIL, password: process.env.SUPABASE_TEST_ADMIN_PASSWORD };
const memberlessAccount = { email: process.env.SUPABASE_TEST_MEMBERLESS_EMAIL, password: process.env.SUPABASE_TEST_MEMBERLESS_PASSWORD };

function requireConfig() {
  if (!config.ok) throw new Error(config.error.message);
  return config.value;
}

function anonClient(key = requireConfig().publishableKey) {
  return createClient<Database>(requireConfig().url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
}

function publicRepository(key?: string) {
  return createSupabaseCatalogRepository(anonClient(key), { scope: "public", imageBaseUrl: catalogImageBaseUrl(requireConfig()) });
}

/** Stores a session the way @supabase/ssr does: `sb-<ref>-auth-token` = "base64-" + base64url(JSON). */
function setSessionCookie(session: Pick<Session, "access_token" | "refresh_token" | "expires_at" | "expires_in" | "token_type" | "user">) {
  const value = `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  cookieJar.set(`sb-${requireConfig().projectRef}-auth-token`, value);
}

async function signIn(account: { email?: string | undefined; password?: string | undefined }) {
  const { data, error } = await anonClient().auth.signInWithPassword({ email: account.email ?? "", password: account.password ?? "" });
  if (error || !data.session) throw new Error(`test account sign-in failed: ${error?.message ?? "no session"}`);
  setSessionCookie(data.session);
}

describe.skipIf(!enabled)("Supabase catalog (cloud development project)", () => {
  beforeEach(() => cookieJar.clear());

  describe("public reads", () => {
    it("returns the seed catalog in configured order with bigint money", async () => {
      const result = await loadPublicCatalog(publicRepository(), "bunker-burger");
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
      const { store, categories, products, promotions } = result.value;

      expect(store).toMatchObject({ slug: "bunker-burger", currency: "ARS", deliveryFeeCents: 120000n });
      expect(store.paymentMethods.every((method) => method.enabled)).toBe(true);
      expect(categories.map((category) => category.type)).toEqual(["burger", "sandwich", "fries", "beverage"]);
      expect(products.map((product) => product.slug)).toEqual([
        "smash-bunker-doble",
        "oklahoma-onion",
        "crispy-chicken-bunker",
        "pulled-pork-bunker",
        "aros-de-cebolla",
        "papas-bunker",
        "gaseosa-lata",
        "limonada-de-la-casa"
      ]);
      expect(products.find((product) => product.slug === "smash-bunker-doble")?.priceCents).toBe(780000n);
      expect(promotions.map((promotion) => promotion.slug)).toEqual(["martes-de-smash"]);
      expect(promotions[0]?.mechanic).toEqual({ type: "percent_off", percentOff: 15 });
    });

    it("keeps sold-out items flagged, hides drafts, alcohol and unavailable options, and carries selection modes", async () => {
      const result = await loadPublicCatalog(publicRepository(), "bunker-burger");
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
      const bySlug = new Map(result.value.products.map((product) => [product.slug, product]));

      expect(bySlug.get("pulled-pork-bunker")?.inStock).toBe(false);
      expect(bySlug.get("aros-de-cebolla")?.inStock).toBe(false);
      expect(bySlug.has("burger-del-mes")).toBe(false);
      expect(result.value.products.some((product) => product.containsAlcohol)).toBe(false);

      const smash = bySlug.get("smash-bunker-doble");
      expect(smash?.optionGroups.map((group) => [group.name, group.selectionMode])).toEqual([
        ["Tamaño / medallones", "single"],
        ["Extras", "multiple"]
      ]);
      expect(smash?.optionGroups[0]?.defaultOptionIds).toHaveLength(1);
      expect(smash?.optionGroups[1]?.options.map((option) => option.name)).not.toContain("Pepinillos extra");
      expect(smash?.optionGroups[0]?.options[1]?.priceDeltaCents).toBe(160000n);
    });

    it("translates real failures into controlled results", async () => {
      const missing = await loadPublicCatalog(publicRepository(), "tienda-inexistente");
      expect(missing).toMatchObject({ ok: false, error: { code: "not_found" } });

      const badKey = await loadPublicCatalog(publicRepository("sb_publishable_invalid"), "bunker-burger");
      expect(badKey).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    });
  });

  describe("store status via getStoreStatus()", () => {
    // Seed hours, America/Argentina/Tucuman (UTC-3): closed Mondays, Wed 19:30–00:00, Fri 19:30–01:30.
    it("reads the persisted override, hours, time zone and fee and decides on the server", async () => {
      const store = await loadPublicCatalog(publicRepository(), "bunker-burger");
      if (!store.ok) throw new Error(`${store.error.code}: ${store.error.message}`);
      expect(store.value.store).toMatchObject({ timezone: "America/Argentina/Tucuman", statusOverride: "auto" });
      expect(store.value.store.businessHours).toHaveLength(6);

      // Wednesday 2026-10-07 09:00 local → closed until 19:30.
      expect(await getStoreStatus("bunker-burger", new Date("2026-10-07T12:00:00Z"))).toMatchObject({
        ok: true,
        value: { state: "closed", acceptingOrders: false, nextOpeningAt: new Date("2026-10-07T22:30:00Z"), deliveryFeeCents: 120000n }
      });
      // Saturday 2026-10-10 00:45 local → inside Friday's shift, which crosses midnight.
      expect(await getStoreStatus("bunker-burger", new Date("2026-10-10T03:45:00Z"))).toMatchObject({
        ok: true,
        value: { state: "open", acceptingOrders: true, closesAt: new Date("2026-10-10T04:30:00Z") }
      });
      // Monday 2026-10-12 12:00 local → closed all day, next opening Tuesday 19:30.
      expect(await getStoreStatus("bunker-burger", new Date("2026-10-12T15:00:00Z"))).toMatchObject({
        ok: true,
        value: { state: "closed", nextOpeningAt: new Date("2026-10-13T22:30:00Z") }
      });
    });

    it("returns not_found for an unknown store", async () => {
      expect(await getStoreStatus("tienda-inexistente")).toMatchObject({ ok: false, error: { code: "not_found" } });
    });
  });

  describe("promotions for quoting via getPromotionsForQuote()", () => {
    const SMASH_ID = "0199b2c8-40b0-7000-8000-000000000201";
    const smash = (quantity: number) => [{ productId: SMASH_ID, quantity, unitPriceCents: 780000n, basePriceCents: 780000n }];
    const context = (now: string) => ({ now: new Date(now), timezone: "America/Argentina/Tucuman" });

    it("reads only active rules and applies the seed's Tuesday promotion inside its window", async () => {
      const rules = await getPromotionsForQuote("bunker-burger");
      if (!rules.ok) throw new Error(`${rules.error.code}: ${rules.error.message}`);
      // "envio-gratis" is paused in the seed: RLS does not even return it to anonymous reads.
      expect(rules.value.map((rule) => rule.slug)).toEqual(["martes-de-smash"]);

      // Tuesday 2026-10-13 21:00 local: 15% on 2 × 780.000.
      const tuesday = quoteCart(smash(2), rules.value, "pickup", 120000n, context("2026-10-14T00:00:00Z"));
      expect(tuesday).toMatchObject({ discountCents: 234000n, totalCents: 1326000n });
      expect(tuesday.promotion).toMatchObject({ slug: "martes-de-smash", explanation: "15% de descuento en productos seleccionados" });

      // Wednesday 2026-10-14 21:00 local: outside the weekly window.
      expect(quoteCart(smash(2), rules.value, "pickup", 120000n, context("2026-10-15T00:00:00Z"))).toMatchObject({ promotion: null, discountCents: 0n });
    });

    it("publishes the same rules to the menu, by product slug and without admin text, quoting the same", async () => {
      const [published, rules] = await Promise.all([getPublicPromotions("bunker-burger"), getPromotionsForQuote("bunker-burger")]);
      if (!published.ok) throw new Error(`${published.error.code}: ${published.error.message}`);
      if (!rules.ok) throw new Error(`${rules.error.code}: ${rules.error.message}`);
      expect(published.value).toMatchObject([{ slug: "martes-de-smash", items: [{ productSlug: "smash-bunker-doble", quantity: 1 }] }]);
      expect(JSON.stringify(published.value)).not.toMatch(/Fixture de demostración|15% OFF/);

      // The storefront resolves the slug to its own product id; the result matches the quote.
      const menuRules = published.value.map((promotion) => toPromotionRule(promotion, new Map([["smash-bunker-doble", SMASH_ID]])));
      const tuesday = context("2026-10-14T00:00:00Z");
      const { promotion: menuPromotion, ...menuTotals } = quoteCart(smash(2), menuRules, "pickup", 120000n, tuesday);
      const { promotion: serverPromotion, ...serverTotals } = quoteCart(smash(2), rules.value, "pickup", 120000n, tuesday);
      expect(menuTotals).toEqual(serverTotals);
      expect(menuTotals).toMatchObject({ discountCents: 234000n, totalCents: 1326000n });
      // Same promotion and amounts; only the badge text, which is never published, is absent.
      expect(menuPromotion).toEqual({ ...serverPromotion, badgeText: null });
    });
  });

  describe("admin reads via getAdminCatalog()", () => {
    it("rejects an anonymous request (no session cookie) as unauthorized", async () => {
      const result = await getAdminCatalog("bunker-burger");
      expect(result).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    });

    it("rejects an expired session as unauthorized", async () => {
      // Expired access token plus a refresh token Supabase Auth does not know: the client must
      // refresh, Auth rejects it, and the read is refused.
      const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
      const expiredAt = Math.floor(Date.now() / 1000) - 3600;
      const payload = Buffer.from(
        JSON.stringify({ sub: "00000000-0000-4000-8000-000000000000", role: "authenticated", aud: "authenticated", exp: expiredAt })
      ).toString("base64url");
      setSessionCookie({
        access_token: `${header}.${payload}.invalid-signature`,
        refresh_token: "expired-refresh-token",
        expires_at: expiredAt,
        expires_in: 0,
        token_type: "bearer",
        user: {
          id: "00000000-0000-4000-8000-000000000000",
          aud: "authenticated",
          app_metadata: {},
          user_metadata: {},
          created_at: new Date(0).toISOString()
        }
      });
      const result = await getAdminCatalog("bunker-burger");
      expect(result).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    });

    it.skipIf(!memberlessAccount.email || !memberlessAccount.password)(
      "rejects a signed-in user without an active membership as unauthorized",
      async () => {
        await signIn(memberlessAccount);
        const result = await getAdminCatalog("bunker-burger");
        expect(result).toMatchObject({ ok: false, error: { code: "unauthorized" } });
      }
    );

    it.skipIf(!adminAccount.email || !adminAccount.password)(
      "returns the full catalog, including admin-only rows, to an active admin",
      async () => {
        await signIn(adminAccount);
        const result = await getAdminCatalog("bunker-burger");
        if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
        expect(result.value.products.some((product) => product.slug === "burger-del-mes")).toBe(true);
        expect(result.value.promotions.map((promotion) => promotion.slug)).toEqual(["martes-de-smash", "envio-gratis"]);
      }
    );
  });

  describe("Auth configuration and the admin login (BB-11)", () => {
    it("does not allow public sign-up: Auth reports it disabled and refuses signUp without creating a user", async () => {
      // Read-only public settings of the development project (no credentials beyond the publishable key).
      const response = await fetch(`${requireConfig().url}/auth/v1/settings`, { headers: { apikey: requireConfig().publishableKey } });
      const settings = (await response.json()) as { disable_signup?: boolean; external?: { email?: boolean } };
      // Email + password stays enabled for provisioned admins.
      expect(settings.external?.email).toBe(true);
      // If this fails, sign-ups are open: the probe below is never attempted, so no user is created.
      expect(settings.disable_signup).toBe(true);

      const probe = `signup-probe-${Date.now()}@example.invalid`;
      const { data, error } = await anonClient().auth.signUp({ email: probe, password: `Probe-${crypto.randomUUID()}` });
      expect(error).toMatchObject({ code: "signup_disabled" });
      expect(data.user).toBeNull();
    });

    it.skipIf(!adminAccount.email || !adminAccount.password)("a provisioned admin signs in, is recognized and signs out", async () => {
      expect(await signInAdmin(adminAccount.email ?? "", adminAccount.password ?? "")).toEqual({ ok: true });
      expect(await getAdminSession("bunker-burger")).toMatchObject({ ok: true, value: { role: expect.any(String) } });
      expect(await signOutAdmin()).toBe("revoked");
      expect([...cookieJar.keys()].filter((name) => name.includes("-auth-token"))).toEqual([]);
    });

    it.skipIf(!memberlessAccount.email || !memberlessAccount.password)("a user without membership is refused and left without a session", async () => {
      expect(await signInAdmin(memberlessAccount.email ?? "", memberlessAccount.password ?? "")).toEqual({ ok: false, message: INVALID_CREDENTIALS });
      expect([...cookieJar.keys()].filter((name) => name.includes("-auth-token"))).toEqual([]);
    });
  });
});
