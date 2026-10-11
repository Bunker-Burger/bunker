import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Home from "./page";

/*
 * BB-14 R6 P2-12/P2-13: the real Home server component, reading the catalog through the real
 * Supabase client and repository (only the PostgREST transport is faked), then rendered. Mercado
 * Pago is offered only when a checkout could actually start; a bad optional setting never takes
 * the menu down.
 */

const SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
const STORE_ID = "0199b2c8-40b0-7000-8000-000000000001";
const CATEGORY_ID = "0199b2c8-40b0-7000-8000-000000000101";

let mercadoPagoMethodEnabled: boolean;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const storeRow = () => ({
  id: STORE_ID,
  name: "Búnker Burger",
  slug: "bunker-burger",
  whatsapp_e164: "+5493865207458",
  timezone: "America/Argentina/Tucuman",
  currency: "ARS",
  status_override: "open",
  is_public: true,
  delivery_fee_cents: "120000",
  store_business_hours: [],
  store_payment_methods: [
    { method: "cash", is_enabled: true, sort_order: 10 },
    { method: "mercado_pago", is_enabled: mercadoPagoMethodEnabled, sort_order: 30 }
  ]
});

const productRow = {
  id: "0199b2c8-40b0-7000-8000-000000000201",
  category_id: CATEGORY_ID,
  name: "Smash Búnker Doble",
  slug: "smash-bunker-doble",
  description: "Doble medallón",
  base_price_cents: "780000",
  is_published: true,
  is_available: true,
  is_featured: true,
  contains_alcohol: false,
  sort_order: 0,
  product_images: [],
  product_option_groups: []
};

function fakePostgrest(url: URL, headers: Headers): Response {
  switch (url.pathname.replace("/rest/v1/", "")) {
    case "stores":
      return json(headers.get("accept")?.includes("vnd.pgrst.object") ? storeRow() : [storeRow()]);
    case "categories":
      return json([{ id: CATEGORY_ID, name: "Hamburguesas", slug: "burgers", kind: "burger", sort_order: 1, is_visible: true }]);
    case "products":
      return json([productRow]);
    case "promotion_rules":
      return json([]);
    default:
      return json({ message: "unexpected table" }, 404);
  }
}

/** Settings a real production checkout needs; only a boolean derived from them reaches the page. */
function stubEnvironment(overrides: Record<string, string | undefined> = {}) {
  const environment: Record<string, string | undefined> = {
    NODE_ENV: "production",
    NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    SUPABASE_PROJECT_ENV: "development",
    VERCEL_ENV: "",
    SUPABASE_PRODUCTION_PROJECT_REF: "",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test",
    MERCADO_PAGO_ACCESS_TOKEN: "TEST-access-token",
    APP_URL: "https://bunker.example",
    RATE_LIMIT_UPSTREAM_URL: "https://quota.example/increment",
    ...overrides
  };
  for (const [key, value] of Object.entries(environment)) vi.stubEnv(key, value ?? "");
}

async function renderHome() {
  render(await Home({ searchParams: Promise.resolve({}) }));
  // The menu is up, with the product read from the (fake) database.
  expect(await screen.findByRole("heading", { name: "Smash Búnker Doble" })).toBeInTheDocument();
  return within(screen.getByRole("region", { name: "Finalizar pedido" }));
}

beforeEach(() => {
  mercadoPagoMethodEnabled = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input instanceof Request ? input.url : input), "http://localhost");
      if (url.origin === SUPABASE_URL) return fakePostgrest(url, new Headers(init.headers));
      // The storefront's own public endpoints are not under test here.
      return json({ error: "unavailable" }, 503);
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Home and Mercado Pago availability", () => {
  it("offers Mercado Pago when a checkout could start", async () => {
    stubEnvironment();
    const checkout = await renderHome();
    expect(checkout.getByRole("radio", { name: /Mercado Pago/ })).toBeInTheDocument();
  });

  it.each([
    ["APP_URL has no scheme", { APP_URL: "sin-esquema" }],
    ["APP_URL is ftp", { APP_URL: "ftp://example.com" }],
    ["production has no distributed quota service", { RATE_LIMIT_UPSTREAM_URL: undefined }],
    ["production has empty quota service url", { RATE_LIMIT_UPSTREAM_URL: "" }],
    ["production has quota url without scheme", { RATE_LIMIT_UPSTREAM_URL: "sin-esquema" }],
    ["production has ftp quota service url", { RATE_LIMIT_UPSTREAM_URL: "ftp://example.com" }],
    ["production has http quota service url", { RATE_LIMIT_UPSTREAM_URL: "http://example.com" }],
    ["production has http quota service with api key", { RATE_LIMIT_UPSTREAM_URL: "http://example.com", RATE_LIMIT_API_KEY: "secret" }],
    ["payments cannot be stored durably", { SUPABASE_SERVICE_ROLE_KEY: undefined }]
  ])("keeps the menu up and hides Mercado Pago when %s", async (_case, overrides) => {
    stubEnvironment(overrides);
    const checkout = await renderHome();
    expect(checkout.queryByRole("radio", { name: /Mercado Pago/ })).toBeNull();
    expect(checkout.getByRole("radio", { name: /Efectivo/ })).toBeInTheDocument();
  });

  it("hides Mercado Pago when the store has not enabled it", async () => {
    mercadoPagoMethodEnabled = false;
    stubEnvironment();
    const checkout = await renderHome();
    expect(checkout.queryByRole("radio", { name: /Mercado Pago/ })).toBeNull();
  });
});
