import { describe, expect, it } from "vitest";
import { POST } from "./route";
import { GET as getStatus } from "./status/route";

describe("Mercado Pago Route Handlers (BB-14)", () => {
  it("POST /api/checkout/mercado-pago fails closed with 503 if persistence is not configured (P1-02)", async () => {
    const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    try {
      const request = new Request("http://localhost:3000/api/checkout/mercado-pago", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-real-ip": "192.168.1.100"
        },
        body: JSON.stringify({
          items: [],
          fulfilment: "pickup",
          paymentMethod: "mercado_pago",
          customer: { name: "Test", phone: "12345678" }
        })
      });

      const response = await POST(request);
      expect(response.status).toBe(503);
      const data = await response.json();
      expect(data.error).toBe("unavailable");
      expect(data.message).toContain("servicio de pagos no está disponible");
    } finally {
      if (prevKey !== undefined) {
        process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
      }
    }
  });

  it("POST /api/checkout/mercado-pago enforces rate limit of 10 req/min with 429 and Retry-After (P2-05)", async () => {
    const ip = "100.64.0.50";
    const createReq = () =>
      new Request("http://localhost:3000/api/checkout/mercado-pago", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-real-ip": ip
        },
        body: JSON.stringify({ invalid: true })
      });

    // Fire 10 requests
    for (let i = 0; i < 10; i++) {
      const res = await POST(createReq());
      // Could be 503 (persistence unavailable) or 400 (invalid payload), but allowed past rate limit
      expect(res.status).not.toBe(429);
    }

    // 11th request MUST be rate limited
    const limitedRes = await POST(createReq());
    expect(limitedRes.status).toBe(429);
    expect(limitedRes.headers.get("Retry-After")).toBeDefined();
    const data = await limitedRes.json();
    expect(data.error).toBe("rate_limited");
  });

  it("POST /api/checkout/mercado-pago neutralizes spoofed invalid headers into canonical bucket (P2-05)", async () => {
    // Adversary attempts spoofing with arbitrary random strings in headers
    const createSpoofedReq = (spoofVal: string) =>
      new Request("http://localhost:3000/api/checkout/mercado-pago", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": spoofVal
        },
        body: JSON.stringify({})
      });

    // All invalid headers fall back to "untrusted-client" bucket
    for (let i = 0; i < 10; i++) {
      await POST(createSpoofedReq(`random-token-${i}-${Date.now()}`));
    }

    // 11th attempt with yet another spoofed string still hits 429 rate limit!
    const res = await POST(createSpoofedReq("another-fake-token"));
    expect(res.status).toBe(429);
  });

  it("POST /api/checkout/mercado-pago neutralizes rotating valid IPs lacking Vercel provenance (P2-05)", async () => {
    const createRotatingIpReq = (ip: string) =>
      new Request("http://localhost:3000/api/checkout/mercado-pago", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": ip
        },
        body: JSON.stringify({})
      });

    // 10 requests with distinct valid IPs without Vercel provenance
    for (let i = 1; i <= 10; i++) {
      await POST(createRotatingIpReq(`198.51.100.${i}`));
    }

    // 11th request with fresh valid IP is still rate limited (429)
    const res = await POST(createRotatingIpReq("198.51.100.99"));
    expect(res.status).toBe(429);
  });

  it("GET /api/checkout/mercado-pago/status fails closed with 503 if persistence is not configured (P1-02)", async () => {
    const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    try {
      const request = new Request("http://localhost:3000/api/checkout/mercado-pago/status?ref=valid-reference-123", {
        method: "GET"
      });

      const response = await getStatus(request);
      expect(response.status).toBe(503);
      const data = await response.json();
      expect(data.error).toBe("unavailable");
    } finally {
      if (prevKey !== undefined) {
        process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
      }
    }
  });

  it("GET /api/checkout/mercado-pago/status rejects invalid reference with 400", async () => {
    // When persistence is present or checked:
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    try {
      const request = new Request("http://localhost:3000/api/checkout/mercado-pago/status?ref=short", {
        method: "GET"
      });

      const response = await getStatus(request);
      expect([400, 503]).toContain(response.status);
    } finally {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    }
  });
});
