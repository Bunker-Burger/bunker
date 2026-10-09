import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/checkout/whatsapp/route";

/*
 * BB-10 review round 1 (P2 C): the real `POST /api/checkout/whatsapp` Route Handler, through
 * `getOperationalPublicCatalog` / `getStoreStatus`, the Supabase clients and repositories, the
 * option engine, promotions and fee, down to the HTTP answer. Only the transport to PostgREST is
 * replaced: a fake over a mutable "database", with every request recorded.
 */

const SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
const STORE_ID = "0199b2c8-40b0-7000-8000-000000000001";
const CATEGORY_ID = "0199b2c8-40b0-7000-8000-000000000101";
const PRODUCT_ID = "0199b2c8-40b0-7000-8000-000000000201";
const GROUP_ID = "0199b2c8-40b0-7000-8000-000000000301";
const DOUBLE_ID = "0199b2c8-40b0-7000-8000-000000000401";
const TRIPLE_ID = "0199b2c8-40b0-7000-8000-000000000402";

// Thursday 2026-10-08 20:00 and Tuesday 2026-10-13 21:00 in Tucumán (UTC-3).
const THURSDAY_NIGHT = new Date("2026-10-08T23:00:00Z");
const TUESDAY_NIGHT = new Date("2026-10-14T00:00:00Z");

interface Database {
  statusOverride: "auto" | "open" | "paused" | "closed";
  deliveryFeeCents: string | null;
  businessHours: Array<{ day_of_week: number; opens_at: string; closes_at: string }>;
  cashEnabled: boolean;
  transferEnabled: boolean;
  whatsapp: string;
  priceCents: string;
  inStock: boolean;
  tripleAvailable: boolean;
  promotionActive: boolean;
  failing: boolean;
}

let db: Database;
const supabaseRequests: Array<{ method: string; table: string; init: RequestInit }> = [];

const storeRow = () => ({
  id: STORE_ID,
  name: "Búnker Burger",
  slug: "bunker-burger",
  whatsapp_e164: db.whatsapp,
  timezone: "America/Argentina/Tucuman",
  currency: "ARS",
  status_override: db.statusOverride,
  is_public: true,
  delivery_fee_cents: db.deliveryFeeCents,
  store_business_hours: db.businessHours,
  store_payment_methods: [
    { method: "cash", display_name: "Efectivo", public_instructions: "", is_enabled: db.cashEnabled, sort_order: 10 },
    { method: "bank_transfer", display_name: "Transferencia", public_instructions: "", is_enabled: db.transferEnabled, sort_order: 20 },
    { method: "mercado_pago", display_name: "Mercado Pago", public_instructions: "", is_enabled: false, sort_order: 30 }
  ]
});

const categoryRow = () => ({ id: CATEGORY_ID, name: "Hamburguesas", slug: "burgers", kind: "burger", sort_order: 1, is_visible: true });

const productRow = () => ({
  id: PRODUCT_ID,
  category_id: CATEGORY_ID,
  name: "Smash Búnker Doble",
  slug: "smash-bunker-doble",
  description: "Doble medallón",
  base_price_cents: db.priceCents,
  is_published: true,
  is_available: db.inStock,
  is_featured: true,
  contains_alcohol: false,
  product_images: [],
  product_option_groups: [
    {
      default_option_ids: [DOUBLE_ID],
      minimum_selections_override: null,
      maximum_selections_override: null,
      sort_order: 1,
      option_groups: {
        id: GROUP_ID,
        name: "Medallones",
        selection_mode: "single",
        minimum_selections: 1,
        maximum_selections: 1,
        is_required: true,
        sort_order: 1,
        applicable_category_kinds: ["burger"],
        options: [
          { id: DOUBLE_ID, name: "Doble", price_delta_cents: "0", is_available: true, sort_order: 1 },
          { id: TRIPLE_ID, name: "Triple", price_delta_cents: "160000", is_available: db.tripleAvailable, sort_order: 2 }
        ]
      }
    }
  ]
});

const promotionRow = () => ({
  id: "0199b2c8-40b0-7000-8000-000000000501",
  slug: "martes-de-smash",
  name: "Martes de Smash",
  description: "",
  badge_text: null,
  promotion_type: "percent_off",
  priority: 10,
  is_active: true,
  starts_at: "2026-10-01T03:00:00+00:00",
  ends_at: "2027-04-01T02:59:00+00:00",
  fixed_price_cents: null,
  percent_off: 15,
  buy_quantity: null,
  get_quantity: null,
  applies_to_delivery: true,
  applies_to_pickup: true,
  promotion_items: [{ product_id: PRODUCT_ID, quantity: 1 }],
  promotion_schedule: [{ day_of_week: 2, starts_at: "18:00:00", ends_at: "23:59:00" }]
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fakePostgrest(url: URL, headers: Headers): Response {
  if (db.failing) return json({ message: "boom", code: "XX000" }, 500);
  const table = url.pathname.replace("/rest/v1/", "");
  switch (table) {
    case "stores":
      return json(headers.get("accept")?.includes("vnd.pgrst.object") ? storeRow() : [storeRow()]);
    case "categories":
      return json([categoryRow()]);
    case "products":
      return json([productRow()]);
    case "promotion_rules":
      // RLS `promotion_rules_public_read`: anonymous reads only see active rules.
      return json(db.promotionActive ? [promotionRow()] : []);
    default:
      return json({ message: `unexpected table ${table}` }, 404);
  }
}

function post(body: unknown, raw?: string) {
  return POST(
    new Request("http://localhost/api/checkout/whatsapp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw ?? JSON.stringify(body)
    })
  );
}

const order = (overrides: Record<string, unknown> = {}) => ({
  items: [{ productId: PRODUCT_ID, quantity: 2, optionSelections: { [GROUP_ID]: [TRIPLE_ID] }, notes: "sin cebolla" }],
  fulfilment: "delivery",
  paymentMethod: "cash_exact",
  ...overrides
});

async function message(response: Response) {
  const body = (await response.json()) as { url: string };
  return { url: new URL(body.url), text: new URL(body.url).searchParams.get("text") ?? "", body };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.stubEnv("SUPABASE_PROJECT_ENV", "development");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("SUPABASE_PRODUCTION_PROJECT_REF", "");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(THURSDAY_NIGHT);
  db = {
    statusOverride: "open",
    deliveryFeeCents: "120000",
    businessHours: [],
    cashEnabled: true,
    transferEnabled: true,
    whatsapp: "+5493865207458",
    priceCents: "780000",
    inStock: true,
    tripleAvailable: true,
    promotionActive: false,
    failing: false
  };
  supabaseRequests.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input instanceof Request ? input.url : input), "http://localhost");
      if (url.origin !== SUPABASE_URL) throw new Error(`unexpected request ${url.href}`);
      supabaseRequests.push({ method: (init.method ?? "GET").toUpperCase(), table: url.pathname, init });
      return fakePostgrest(url, new Headers(init.headers));
    })
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** Every read went to PostgREST uncached, without Next data-cache options, and nothing was written. */
function expectFreshReadsOnly() {
  expect(supabaseRequests.length).toBeGreaterThan(0);
  for (const request of supabaseRequests) {
    expect(request.method).toBe("GET");
    expect(request.init.cache).toBe("no-store");
    expect((request.init as { next?: unknown }).next).toBeUndefined();
  }
  expect(supabaseRequests.map((request) => request.table)).not.toContain("/rest/v1/payment_quotes");
}

describe("POST /api/checkout/whatsapp (real route, fake PostgREST transport)", () => {
  it("prices cash from fresh data and answers the owner's wa.me link, uncached", async () => {
    const response = await post(order());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { url, text, body } = await message(response);
    // 2 × (780.000 + 160.000) + 120.000 delivery once.
    expect(body).toMatchObject({ subtotalCents: "1880000", deliveryCents: "120000", discountCents: "0", totalCents: "2000000", promotion: null });
    expect(url.hostname).toBe("wa.me");
    expect(url.pathname).toBe("/5493865207458");
    expect(text).toContain("• 2x Smash Búnker Doble — $18.800\n   Opciones: Triple\n   Nota: sin cebolla");
    expect(text).toContain("Modalidad: Delivery\nSubtotal: $18.800\nEnvío: $1.200\nTotal: $20.000");
    expect(text).toContain("Pago: Efectivo. Tengo el importe exacto: $20.000.");
    expectFreshReadsOnly();
  });

  it("prices transfer, asking for the details in the chat", async () => {
    const response = await post(order({ paymentMethod: "transfer", fulfilment: "pickup" }));
    expect(response.status).toBe(200);
    const { text, body } = await message(response);
    expect(body).toMatchObject({ deliveryCents: "0", totalCents: "1880000" });
    expect(text).toContain("Pago: Transferencia de $18.800. ¿Me pasás el alias o CBU? Te envío el comprobante por este chat.");
    expectFreshReadsOnly();
  });

  it("follows consecutive changes to fee, price, number and promotion without any cache invalidation", async () => {
    expect((await message(await post(order()))).body).toMatchObject({ totalCents: "2000000" });

    db.deliveryFeeCents = "150000";
    expect((await message(await post(order()))).body).toMatchObject({ deliveryCents: "150000", totalCents: "2030000" });

    db.priceCents = "850000";
    db.whatsapp = "+5493815550000";
    const repriced = await message(await post(order()));
    expect(repriced.body).toMatchObject({ subtotalCents: "2020000", totalCents: "2170000" });
    expect(repriced.url.pathname).toBe("/5493815550000");

    vi.setSystemTime(TUESDAY_NIGHT);
    db.promotionActive = true;
    const promoted = await message(await post(order()));
    // 15% of 2 × 1.010.000.
    expect(promoted.body).toMatchObject({ discountCents: "303000", totalCents: "1867000", promotion: { name: "Martes de Smash" } });
    expect(promoted.text).toContain("Promoción: Martes de Smash (15% de descuento en productos seleccionados): -$3.030");
    expectFreshReadsOnly();
  });

  it.each([
    ["paused", () => (db.statusOverride = "paused")],
    ["closed", () => (db.statusOverride = "closed")],
    ["outside its hours", () => ((db.statusOverride = "auto"), (db.businessHours = [{ day_of_week: 4, opens_at: "11:00", closes_at: "15:00" }]))],
    ["without a delivery fee", () => (db.deliveryFeeCents = null)]
  ])("answers 409 without a link when the store is %s", async (_case, change) => {
    expect((await post(order())).status).toBe(200);
    change();
    const response = await post(order());
    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "store_closed" });
    expectFreshReadsOnly();
  });

  it("opens again by schedule as soon as the hours say so", async () => {
    db.statusOverride = "auto";
    db.businessHours = [{ day_of_week: 4, opens_at: "19:00", closes_at: "23:30" }];
    expect((await post(order())).status).toBe(200);
  });

  it.each([
    ["the product is sold out", () => (db.inStock = false), {}],
    ["the chosen option became unavailable", () => (db.tripleAvailable = false), {}],
    ["the payment method is disabled", () => (db.transferEnabled = false), { paymentMethod: "transfer" }],
    ["cash is disabled", () => (db.cashEnabled = false), {}]
  ])("answers 422 without a link when %s", async (_case, change, overrides) => {
    change();
    const response = await post(order(overrides));
    expect(response.status).toBe(422);
    expect(Object.keys(await response.json())).toEqual(["error"]);
    expectFreshReadsOnly();
  });

  it.each([
    ["malformed JSON", undefined, "{"],
    ["a browser price", order({ items: [{ ...order().items[0], unitPriceCents: "1" }] }), undefined],
    ["a browser total", order({ totalCents: "1" }), undefined],
    ["customer data", order({ customer: { name: "Ana", phone: "+54 9 381 555 0000" } }), undefined]
  ])("answers 400 for %s", async (_case, body, raw) => {
    const response = await post(body, raw);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });

  it("answers 503 and no link when the database fails", async () => {
    db.failing = true;
    const response = await post(order());
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "unavailable" });
  });
});
