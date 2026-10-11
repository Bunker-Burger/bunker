import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentStoreAdmin } from "@/server/auth/admin-session";
import Home from "./page";

vi.mock("@/server/auth/admin-session", () => ({ getCurrentStoreAdmin: vi.fn() }));

const currentAdminMock = vi.mocked(getCurrentStoreAdmin);

/*
 * BB-07: what the storefront route hands to the client. A store with nothing published is an
 * empty snapshot (rendered as an empty menu); only a failed read is "no snapshot" (null), which
 * lets the client show the demo copy until its own read answers.
 */

const SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
const STORE_ID = "0199b2c8-40b0-7000-8000-000000000001";
const CATEGORY_ID = "0199b2c8-40b0-7000-8000-000000000101";

const storeRow = {
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
};
const categoryRow = { id: CATEGORY_ID, name: "Hamburguesas", slug: "hamburguesas", kind: "burger", sort_order: 1, is_visible: true };

let tables: Record<string, unknown> | "down";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  currentAdminMock.mockResolvedValue({ ok: false, error: { code: "unauthorized", message: "no session" } });
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.stubEnv("SUPABASE_PROJECT_ENV", "development");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("SUPABASE_PRODUCTION_PROJECT_REF", "");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  tables = { categories: [categoryRow], products: [], promotion_rules: [] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      if (url.origin !== SUPABASE_URL) throw new Error(`unexpected request ${url.href}`);
      // 401 rather than 5xx: the client retries 5xx with backoff, which only slows the test.
      if (tables === "down") return json({ message: "Invalid API key" }, 401);
      const table = url.pathname.replace("/rest/v1/", "");
      if (table === "stores") {
        return json(new Headers(init.headers).get("accept")?.includes("vnd.pgrst.object") ? storeRow : [storeRow]);
      }
      return table in tables ? json(tables[table]) : json({ message: `unexpected table ${table}` }, 404);
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const initialCatalogOf = async () => {
  const element = (await Home({ searchParams: Promise.resolve({}) })) as { props: { initialCatalog: unknown } };
  return element.props.initialCatalog;
};

const catalogFallbackOf = async () => {
  const element = (await Home({ searchParams: Promise.resolve({}) })) as { props: { catalogFallback: string } };
  return element.props.catalogFallback;
};

const showAdminNavOf = async () => {
  const element = (await Home({ searchParams: Promise.resolve({}) })) as { props: { showAdminNav: boolean } };
  return element.props.showAdminNav;
};

describe("/ (server render)", () => {
  it("passes an empty, real snapshot when the store has nothing published", async () => {
    expect(await initialCatalogOf()).toEqual({
      products: [],
      categories: [expect.objectContaining({ id: CATEGORY_ID, name: "Hamburguesas", sortOrder: 1, visible: true })]
    });
  });

  it("passes no snapshot (null) when the catalog cannot be read", async () => {
    tables = "down";
    expect(await initialCatalogOf()).toBeNull();
  });

  it("never falls back to the demo menu when a configured project fails to answer (BB-18)", async () => {
    tables = "down";
    expect(await catalogFallbackOf()).toBe("empty");
  });

  it("never falls back to the demo menu on a Vercel deployment, even without Supabase (BB-18)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(await catalogFallbackOf()).toBe("empty");
  });

  it("keeps the demo menu for local work and CI without Supabase", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(await catalogFallbackOf()).toBe("demo");
  });

  it("shows admin navigation only for a valid active store membership", async () => {
    currentAdminMock.mockResolvedValue({
      ok: true,
      value: { userId: "user-1", storeId: STORE_ID, role: "owner" }
    });
    expect(await showAdminNavOf()).toBe(true);
  });

  it.each([
    ["absent session", "unauthorized" as const],
    ["expired session", "unauthorized" as const],
    ["cross-store membership", "unauthorized" as const],
    ["backend unavailable", "unavailable" as const]
  ])("hides admin navigation for %s", async (_case, code) => {
    currentAdminMock.mockResolvedValue({ ok: false, error: { code, message: "private details" } });
    expect(await showAdminNavOf()).toBe(false);
  });
});
