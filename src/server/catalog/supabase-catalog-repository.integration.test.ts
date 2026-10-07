import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { catalogImageBaseUrl, readSupabaseConfig } from "@/server/supabase/config";
import type { Database } from "@/server/supabase/database.types";
import { loadCatalog } from "./catalog-service";
import { createSupabaseCatalogRepository } from "./supabase-catalog-repository";

/*
 * Reads the seeded catalog (supabase/seed.sql) from the cloud DEVELOPMENT project through
 * the real repository and RLS. Runs with `npm run test:integration` when `.env.local` holds
 * development credentials; readSupabaseConfig refuses production credentials here.
 */

const config = readSupabaseConfig();
const enabled = config.ok && config.value.projectEnv === "development";

function anonClient(key: string) {
  if (!config.ok) throw new Error(config.error.message);
  return createClient<Database>(config.value.url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
}

function repository(scope: "public" | "admin", key = config.ok ? config.value.publishableKey : "") {
  if (!config.ok) throw new Error(config.error.message);
  return createSupabaseCatalogRepository(anonClient(key), { scope, imageBaseUrl: catalogImageBaseUrl(config.value) });
}

describe.skipIf(!enabled)("Supabase catalog repository (cloud development project)", () => {
  it("returns the public seed catalog in configured order with bigint money", async () => {
    const result = await loadCatalog(repository("public"), "bunker-burger");
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

  it("keeps sold-out items flagged, hides drafts, alcohol and unavailable options", async () => {
    const result = await loadCatalog(repository("public"), "bunker-burger");
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    const bySlug = new Map(result.value.products.map((product) => [product.slug, product]));

    expect(bySlug.get("pulled-pork-bunker")?.inStock).toBe(false);
    expect(bySlug.get("aros-de-cebolla")?.inStock).toBe(false);
    expect(bySlug.has("burger-del-mes")).toBe(false);
    expect(result.value.products.some((product) => product.containsAlcohol)).toBe(false);

    const smash = bySlug.get("smash-bunker-doble");
    expect(smash?.optionGroups.map((group) => group.name)).toEqual(["Tamaño / medallones", "Extras"]);
    expect(smash?.optionGroups[0]?.defaultOptionIds).toHaveLength(1);
    expect(smash?.optionGroups[1]?.options.map((option) => option.name)).not.toContain("Pepinillos extra");
    expect(smash?.optionGroups[0]?.options[1]?.priceDeltaCents).toBe(160000n);
  });

  it("does not leak admin-only rows to an anonymous client even in admin scope", async () => {
    const result = await loadCatalog(repository("admin"), "bunker-burger");
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    expect(result.value.products.some((product) => product.slug === "burger-del-mes")).toBe(false);
    expect(result.value.promotions.some((promotion) => promotion.slug === "envio-gratis")).toBe(false);
  });

  it("translates real failures into controlled results", async () => {
    const missing = await loadCatalog(repository("public"), "tienda-inexistente");
    expect(missing).toMatchObject({ ok: false, error: { code: "not_found" } });

    const badKey = await loadCatalog(repository("public", "sb_publishable_invalid"), "bunker-burger");
    expect(badKey).toMatchObject({ ok: false, error: { code: "unauthorized" } });
  });
});
