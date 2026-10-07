import { createClient, type Session } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { catalogImageBaseUrl, readSupabaseConfig } from "@/server/supabase/config";
import type { Database } from "@/server/supabase/database.types";
import { loadPublicCatalog } from "./catalog-service";
import { getAdminCatalog } from "./index";
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
    set: (name: string, value: string) => void cookieJar.set(name, value)
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
});
