import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * BB-14 R6 P2-12: the route refuses (503, fail closed) in exactly the configurations where the
 * storefront no longer offers Mercado Pago, before touching the database or Mercado Pago. The
 * route builds its rate limiter at import time, so each case imports it after setting the env.
 */

const complete: Record<string, string> = {
  NODE_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_PROJECT_ENV: "development",
  VERCEL_ENV: "",
  SUPABASE_PRODUCTION_PROJECT_REF: "",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test",
  MERCADO_PAGO_ACCESS_TOKEN: "TEST-access-token",
  APP_URL: "https://bunker.example",
  RATE_LIMIT_UPSTREAM_URL: ""
};

const outbound: string[] = [];

async function post(environment: Record<string, string>) {
  for (const [key, value] of Object.entries(environment)) vi.stubEnv(key, value);
  vi.resetModules();
  const { POST } = await import("./route");
  return POST(
    new Request("http://localhost/api/checkout/mercado-pago", {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": "203.0.113.7" },
      body: JSON.stringify({
        items: [{ productId: "p", quantity: 1, optionSelections: {}, notes: "" }],
        fulfilment: "pickup",
        paymentMethod: "mercado_pago",
        customer: { name: "Ana Pérez", phone: "+5491155551234" }
      })
    })
  );
}

beforeEach(() => {
  outbound.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      outbound.push(String(input instanceof Request ? input.url : input));
      return new Response("{}", { status: 500 });
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POST /api/checkout/mercado-pago availability", () => {
  it("answers 503 in production without the distributed quota service, with complete Mercado Pago config", async () => {
    const response = await post(complete);
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).error).toBe("service_unavailable");
    expect(outbound).toEqual([]);
  });

  it.each([
    ["APP_URL has no scheme", { APP_URL: "sin-esquema" }],
    ["APP_URL is ftp", { APP_URL: "ftp://example.com" }],
    ["there is no access token", { MERCADO_PAGO_ACCESS_TOKEN: "" }],
    ["payments cannot be stored durably", { SUPABASE_SERVICE_ROLE_KEY: "" }]
  ])("answers 503, without throwing or calling out, when %s (development quota)", async (_case, overrides) => {
    const response = await post({ ...complete, NODE_ENV: "development", ...overrides });
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("unavailable");
    expect(outbound).toEqual([]);
  });
});
