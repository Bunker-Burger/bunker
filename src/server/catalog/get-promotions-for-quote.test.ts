import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPromotionsForQuote } from "./index";

/*
 * Production seam of getPromotionsForQuote(): real config, client construction and repository.
 * Only the network is replaced, by a fake that behaves like Next's data cache (a request made
 * with `cache: "force-cache"` or a positive `next.revalidate` is served from the cache).
 */

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => undefined })
}));

type CapturedInit = RequestInit & { next?: { revalidate?: number | false; tags?: string[] } };

const database = { martesActive: true };
const requests: Array<{ url: string; init: CapturedInit }> = [];

const storeRow = {
  id: "store-1",
  name: "Búnker Burger",
  slug: "bunker-burger",
  whatsapp_e164: "+5493865207458",
  timezone: "America/Argentina/Tucuman",
  currency: "ARS",
  status_override: "auto",
  is_public: true,
  delivery_fee_cents: "120000",
  store_business_hours: [],
  store_payment_methods: []
};

const promotionRow = () => ({
  id: "promo-1",
  slug: "martes-de-smash",
  name: "Martes de Smash",
  description: "",
  badge_text: "15% OFF",
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
  promotion_items: [{ product_id: "smash", quantity: 1 }],
  promotion_schedule: [{ day_of_week: 2, starts_at: "18:00:00", ends_at: "23:59:00" }]
});

function respond(url: URL, headers: Headers): Response {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  if (url.pathname.endsWith("/stores")) {
    return json(headers.get("accept")?.includes("vnd.pgrst.object") ? storeRow : [storeRow]);
  }
  // Public reads only see active rules (RLS); a paused promotion is simply not returned.
  return json(database.martesActive ? [promotionRow()] : []);
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.stubEnv("SUPABASE_PROJECT_ENV", "development");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("SUPABASE_PRODUCTION_PROJECT_REF", "");
  database.martesActive = true;
  requests.length = 0;
  const dataCache = new Map<string, string>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: CapturedInit = {}) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      requests.push({ url: url.href, init });
      const cacheable = init.cache === "force-cache" || (typeof init.next?.revalidate === "number" && init.next.revalidate > 0);
      const cached = cacheable ? dataCache.get(url.href) : undefined;
      if (cached !== undefined) return new Response(cached, { status: 200, headers: { "content-type": "application/json" } });
      const response = respond(url, new Headers(init.headers));
      if (cacheable) dataCache.set(url.href, await response.clone().text());
      return response;
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("getPromotionsForQuote() freshness", () => {
  it("reads the store and its rules without any cache", async () => {
    const result = await getPromotionsForQuote("bunker-burger");

    expect(result).toMatchObject({ ok: true, value: [{ slug: "martes-de-smash", mechanic: { type: "percent_off", percentOff: 15 } }] });
    expect(requests.map(({ url }) => new URL(url).pathname)).toEqual(["/rest/v1/stores", "/rest/v1/promotion_rules"]);
    for (const { init } of requests) {
      expect(init.cache).toBe("no-store");
      expect(init.next).toBeUndefined();
    }
  });

  it("sees a pause persisted between two quotes, without any tag invalidation", async () => {
    expect(await getPromotionsForQuote("bunker-burger")).toMatchObject({ ok: true, value: [{ slug: "martes-de-smash" }] });
    database.martesActive = false;
    expect(await getPromotionsForQuote("bunker-burger")).toEqual({ ok: true, value: [] });
  });
});
