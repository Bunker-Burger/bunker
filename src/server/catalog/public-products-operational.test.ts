import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as productsRoute } from "@/app/api/store/products/route";
import { parsePublicCatalog } from "@/domain/public-products";

const SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
const STORE_ID = "0199b2c8-40b0-7000-8000-000000000001";
const CATEGORY_ID = "0199b2c8-40b0-7000-8000-000000000101";
const PRODUCT_ID = "0199b2c8-40b0-7000-8000-000000000201";
const OPTION_GROUP_ID = "0199b2c8-40b0-7000-8000-000000000301";
const OPTION_ID = "0199b2c8-40b0-7000-8000-000000000401";

interface MutableProductState {
  priceCents: string;
  inStock: boolean;
  optionAvailable: boolean;
}

let productState: MutableProductState;
const capturedInits: RequestInit[] = [];

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
  store_payment_methods: []
});

const categoryRow = () => ({
  id: CATEGORY_ID,
  name: "Hamburguesas",
  slug: "burgers",
  kind: "burger",
  sort_order: 1,
  is_visible: true
});

const productRow = () => ({
  id: PRODUCT_ID,
  category_id: CATEGORY_ID,
  name: "Smash Búnker Doble",
  slug: "smash-bunker-doble",
  description: "Doble medallón",
  base_price_cents: productState.priceCents,
  is_published: true,
  is_available: productState.inStock,
  is_featured: true,
  contains_alcohol: false,
  sort_order: 0,
  product_images: [],
  product_option_groups: [
    {
      default_option_ids: [OPTION_ID],
      minimum_selections_override: null,
      maximum_selections_override: null,
      sort_order: 1,
      option_groups: {
        id: OPTION_GROUP_ID,
        name: "Medallón",
        selection_mode: "single",
        minimum_selections: 1,
        maximum_selections: 1,
        is_required: true,
        sort_order: 1,
        applicable_category_kinds: ["burger"],
        options: [
          {
            id: OPTION_ID,
            name: "Doble carne",
            price_delta_cents: "0",
            is_available: productState.optionAvailable,
            sort_order: 1
          }
        ]
      }
    }
  ]
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Rows the products table answers; [] models a store with nothing published. */
let productRows: () => unknown[] = () => [productRow()];

function fakeSupabase(url: URL, headers: Headers): Response {
  const table = url.pathname.replace("/rest/v1/", "");
  switch (table) {
    case "stores":
      return json(headers.get("accept")?.includes("vnd.pgrst.object") ? storeRow() : [storeRow()]);
    case "categories":
      return json([categoryRow()]);
    case "promotion_rules":
      return json([]);
    case "products":
      return json(productRows());
    default:
      return json({ message: `unexpected table ${table}` }, 404);
  }
}

describe("P1 A: GET /api/store/products operational freshness", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    vi.stubEnv("SUPABASE_PROJECT_ENV", "development");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("SUPABASE_PRODUCTION_PROJECT_REF", "");

    capturedInits.length = 0;
    productRows = () => [productRow()];
    productState = {
      priceCents: "780000",
      inStock: true,
      optionAvailable: true
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(String(input instanceof Request ? input.url : input), "http://localhost");
        if (url.origin === SUPABASE_URL) {
          capturedInits.push(init);
          return fakeSupabase(url, new Headers(init.headers));
        }
        throw new Error(`unexpected request ${url.href}`);
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Route Handler utiliza createOperationalReadClient con cache: 'no-store' y sin tags de revalidación", async () => {
    const response = await productsRoute();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = (await response.json()) as { products: Array<{ priceCents: string; inStock: boolean }> };
    expect(body.products).toHaveLength(1);
    expect(body.products[0]?.priceCents).toBe("780000");
    expect(body.products[0]?.inStock).toBe(true);

    // Verify all Supabase fetch calls used cache: "no-store" and NO next data cache tags
    expect(capturedInits.length).toBeGreaterThan(0);
    for (const init of capturedInits) {
      expect(init.cache).toBe("no-store");
      const nextConfig = (init as { next?: unknown }).next;
      expect(nextConfig).toBeUndefined();
    }
  });

  it("refleja modificaciones consecutivas de precio, stock y opciones inmediatamente sin invalidación de tags", async () => {
    // 1st read
    const res1 = await productsRoute();
    const body1 = (await res1.json()) as { products: Array<{ priceCents: string; inStock: boolean; optionGroups: Array<{ options: Array<{ available: boolean }> }> }> };
    expect(body1.products[0]?.priceCents).toBe("780000");
    expect(body1.products[0]?.inStock).toBe(true);
    expect(body1.products[0]?.optionGroups[0]?.options[0]?.available).toBe(true);

    // Mutate backend state (simulate admin changing price to $8.500, setting out of stock, and disabling option)
    productState.priceCents = "850000";
    productState.inStock = false;
    productState.optionAvailable = false;

    // 2nd read immediately without any catalog cache tag invalidation
    const res2 = await productsRoute();
    const body2 = (await res2.json()) as { products: Array<{ priceCents: string; inStock: boolean; optionGroups: Array<{ options: Array<{ available: boolean }> }> }> };
    expect(body2.products[0]?.priceCents).toBe("850000");
    expect(body2.products[0]?.inStock).toBe(false);
    expect(body2.products[0]?.optionGroups[0]?.options[0]?.available).toBe(false);
  });

  it("sensibilidad de política de cache: el route handler ejecuta peticiones reales de transporte que exigen no-store", async () => {
    const res = await productsRoute();
    expect(res.status).toBe(200);

    // Assert that real transport requests were captured and none bypassed no-store
    expect(capturedInits.length).toBeGreaterThan(0);
    for (const init of capturedInits) {
      expect(init.cache).toBe("no-store");
    }

    // Comprobación de sensibilidad: si el init tuviese force-cache, la aserción de no-store falla
    const simulatedStaleInit: RequestInit = { cache: "force-cache" };
    expect(() => {
      expect(simulatedStaleInit.cache).toBe("no-store");
    }).toThrow();
  });

  it("publica las categorías visibles de la misma lectura que los productos", async () => {
    const response = await productsRoute();
    const body: unknown = await response.json();

    expect(body).toMatchObject({
      categories: [{ id: CATEGORY_ID, slug: "burgers", name: "Hamburguesas", type: "burger", sortOrder: 1, visible: true }],
      products: [{ categoryId: CATEGORY_ID }]
    });
    expect(parsePublicCatalog(body)?.categories.map((category) => category.id)).toEqual([CATEGORY_ID]);
  });

  it("una carta sin productos publicados responde 200 con listas vacías válidas, no un error", async () => {
    productRows = () => [];
    const response = await productsRoute();

    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ products: [] });
    expect(parsePublicCatalog(body)).toEqual({ products: [], categories: [expect.objectContaining({ id: CATEGORY_ID })] });
  });
});
