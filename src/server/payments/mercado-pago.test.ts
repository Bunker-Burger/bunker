import { describe, expect, it } from "vitest";

import { evaluateStoreStatus, StoreNotAcceptingOrdersError, type StoreOperatingSettings } from "@/domain/store-status";
import type { PaymentAttemptsPort } from "./ports";
import { createCheckoutProPreference, detectMercadoPagoConfig } from "./mercado-pago";

describe("detectMercadoPagoConfig", () => {
  it("enables Mercado Pago only with complete server configuration", () => {
    expect(detectMercadoPagoConfig({ MERCADO_PAGO_ACCESS_TOKEN: "token" })).toEqual({
      enabled: false,
      missing: ["MERCADO_PAGO_WEBHOOK_SECRET", "APP_URL"]
    });
    expect(detectMercadoPagoConfig({
      MERCADO_PAGO_ACCESS_TOKEN: " token ",
      MERCADO_PAGO_WEBHOOK_SECRET: " secret ",
      APP_URL: "https://bunker.example/"
    })).toEqual({ enabled: true, config: {
      accessToken: "token", webhookSecret: "secret", appUrl: "https://bunker.example"
    } });
  });
});

function storeStatus(statusOverride: StoreOperatingSettings["statusOverride"]) {
  const settings: StoreOperatingSettings = {
    timezone: "America/Argentina/Tucuman",
    statusOverride,
    deliveryFeeCents: 120000n,
    businessHours: []
  };
  return async () => evaluateStoreStatus(settings, new Date("2026-10-06T12:00:00Z"));
}

describe("createCheckoutProPreference", () => {
  it("posts an authoritative quote and stores a pending attempt", async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      requests.push({ input, ...(init === undefined ? {} : { init }) });
      return new Response(JSON.stringify({ id: "pref-1", init_point: "https://mp.example/pay" }), { status: 201 });
    };
    const attempts = new Map();
    const port: PaymentAttemptsPort = {
      async save(attempt) { attempts.set(attempt.id, attempt); },
      async findByExternalReference() { return null; },
      async markApproved() {}
    };

    const result = await createCheckoutProPreference({
      quote: { id: "quote-1", totalCents: 1_500_000n, expiresAt: new Date("2026-10-06T12:15:00Z") },
      customer: { name: "Ana Pérez", phone: "+5491155551234" }
    }, {
      config: { accessToken: "secret-token", webhookSecret: "wh-secret", appUrl: "https://bunker.example" },
      fetcher,
      attempts: port,
      storeStatus: storeStatus("open"),
      createId: () => "attempt-1",
      now: () => new Date("2026-10-06T12:00:00Z")
    });

    expect(result).toEqual({ preferenceId: "pref-1", checkoutUrl: "https://mp.example/pay" });
    expect(requests[0]?.init?.headers).toMatchObject({ Authorization: "Bearer secret-token", "X-Idempotency-Key": "attempt-1" });
    expect(JSON.parse(String(requests[0]?.init?.body))).toMatchObject({
      external_reference: "attempt-1",
      items: [{ quantity: 1, unit_price: 15000, currency_id: "ARS" }]
    });
    expect(attempts.get("attempt-1")).toMatchObject({ quoteId: "quote-1", expectedAmountCents: 1_500_000n, status: "pending" });
  });

  it("does not contact Mercado Pago nor record an attempt once the store stopped taking orders", async () => {
    let requests = 0;
    const fetcher: typeof fetch = async () => {
      requests += 1;
      return new Response(JSON.stringify({ id: "pref-1", init_point: "https://mp.example/pay" }), { status: 201 });
    };
    const attempts: string[] = [];
    const port: PaymentAttemptsPort = {
      async save(attempt) { attempts.push(attempt.id); },
      async findByExternalReference() { return null; },
      async markApproved() {}
    };

    for (const statusOverride of ["paused", "closed"] as const) {
      await expect(createCheckoutProPreference({
        quote: { id: "quote-1", totalCents: 1_500_000n, expiresAt: new Date("2026-10-06T12:15:00Z") },
        customer: { name: "Ana Pérez", phone: "+5491155551234" }
      }, {
        config: { accessToken: "secret-token", webhookSecret: "wh-secret", appUrl: "https://bunker.example" },
        fetcher,
        attempts: port,
        storeStatus: storeStatus(statusOverride),
        createId: () => "attempt-1",
        now: () => new Date("2026-10-06T12:00:00Z")
      })).rejects.toBeInstanceOf(StoreNotAcceptingOrdersError);
    }
    expect(requests).toBe(0);
    expect(attempts).toEqual([]);
  });
});
