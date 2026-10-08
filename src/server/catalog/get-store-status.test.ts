import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getStoreStatus } from "./index";

/*
 * Goes through the production seam of getStoreStatus(): real config reader, real Supabase client
 * construction and real repository. Only the network is replaced, by a fake that behaves like
 * Next's data cache: a request made with `cache: "force-cache"` (or a positive
 * `next.revalidate`) is answered from the cache once stored, exactly as in `next start`.
 */

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => undefined })
}));

type CapturedInit = RequestInit & { next?: { revalidate?: number | false; tags?: string[] } };

interface StoreRowState {
  status_override: "auto" | "open" | "paused" | "closed";
  delivery_fee_cents: string | null;
}

const database: StoreRowState = { status_override: "open", delivery_fee_cents: "120000" };
const requests: Array<{ url: string; init: CapturedInit }> = [];

function rowResponse(headers: Headers): Response {
  const row = {
    id: "store-1",
    slug: "bunker-burger",
    timezone: "America/Argentina/Tucuman",
    status_override: database.status_override,
    delivery_fee_cents: database.delivery_fee_cents,
    store_business_hours: [{ day_of_week: 3, opens_at: "19:30:00", closes_at: "00:00:00" }]
  };
  const single = headers.get("accept")?.includes("vnd.pgrst.object");
  return new Response(JSON.stringify(single ? row : [row]), { status: 200, headers: { "content-type": "application/json" } });
}

function installNextLikeFetch() {
  const dataCache = new Map<string, string>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: CapturedInit = {}) => {
      const url = String(input instanceof Request ? input.url : input);
      requests.push({ url, init });
      const cacheable = init.cache === "force-cache" || (typeof init.next?.revalidate === "number" && init.next.revalidate > 0);
      const cached = cacheable ? dataCache.get(url) : undefined;
      if (cached !== undefined) return new Response(cached, { status: 200, headers: { "content-type": "application/json" } });
      const response = rowResponse(new Headers(init.headers));
      if (cacheable) dataCache.set(url, await response.clone().text());
      return response;
    })
  );
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.stubEnv("SUPABASE_PROJECT_ENV", "development");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("SUPABASE_PRODUCTION_PROJECT_REF", "");
  database.status_override = "open";
  database.delivery_fee_cents = "120000";
  requests.length = 0;
  installNextLikeFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const NOW = new Date("2026-10-07T12:00:00Z");

describe("getStoreStatus() freshness", () => {
  it("reads the store with an uncached request, separate from the catalog's cached store read", async () => {
    await getStoreStatus("bunker-burger", NOW);

    expect(requests).toHaveLength(1);
    const [{ url, init }] = requests as [{ url: string; init: CapturedInit }];
    expect(init.cache).toBe("no-store");
    expect(init.next).toBeUndefined();
    const select = new URL(url).searchParams.get("select") ?? "";
    expect(select).toContain("status_override");
    expect(select).toContain("store_business_hours");
    expect(select).not.toContain("store_payment_methods");
  });

  it("sees a pause or closure persisted between two consecutive checks, without any tag invalidation", async () => {
    expect(await getStoreStatus("bunker-burger", NOW)).toMatchObject({ ok: true, value: { state: "open", acceptingOrders: true } });

    database.status_override = "paused";
    expect(await getStoreStatus("bunker-burger", NOW)).toMatchObject({ ok: true, value: { state: "paused", acceptingOrders: false } });

    database.status_override = "closed";
    expect(await getStoreStatus("bunker-burger", NOW)).toMatchObject({ ok: true, value: { state: "closed", acceptingOrders: false } });
  });

  it("sees a delivery fee change on the next check", async () => {
    expect(await getStoreStatus("bunker-burger", NOW)).toMatchObject({ ok: true, value: { deliveryFeeCents: 120000n } });

    database.delivery_fee_cents = "150000";
    expect(await getStoreStatus("bunker-burger", NOW)).toMatchObject({ ok: true, value: { deliveryFeeCents: 150000n } });
  });
});
