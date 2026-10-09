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

  it("accepts MERCADOPAGO_* variable naming and VERCEL_URL fallback", () => {
    expect(detectMercadoPagoConfig({
      MERCADOPAGO_ACCESS_TOKEN: "mp-token",
      MERCADOPAGO_WEBHOOK_SECRET: "mp-secret",
      VERCEL_URL: "bunker-preview.vercel.app",
      NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY: "public-key"
    })).toEqual({
      enabled: true,
      config: {
        accessToken: "mp-token",
        webhookSecret: "mp-secret",
        appUrl: "https://bunker-preview.vercel.app",
        publicKey: "public-key"
      }
    });
  });

  it("throws when APP_URL protocol is not http or https", () => {
    expect(() => detectMercadoPagoConfig({
      MERCADO_PAGO_ACCESS_TOKEN: "token",
      MERCADO_PAGO_WEBHOOK_SECRET: "secret",
      APP_URL: "ftp://bunker.example"
    })).toThrow("APP_URL debe usar HTTP o HTTPS");
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

    expect(result).toEqual({ preferenceId: "pref-1", checkoutUrl: "https://mp.example/pay", externalReference: "attempt-1" });
    expect(requests[0]?.init?.headers).toMatchObject({ Authorization: "Bearer secret-token", "X-Idempotency-Key": "attempt-1" });
    expect(JSON.parse(String(requests[0]?.init?.body))).toMatchObject({
      external_reference: "attempt-1",
      items: [{ quantity: 1, unit_price: 15000, currency_id: "ARS" }],
      back_urls: {
        success: "https://bunker.example/?payment=success&ref=attempt-1",
        pending: "https://bunker.example/?payment=pending&ref=attempt-1",
        failure: "https://bunker.example/?payment=failure&ref=attempt-1"
      }
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

  describe("P2-08: Persistencia previa de attempt y trazabilidad durable", () => {
    it("persiste attempt e idempotency key ANTES de llamar a Mercado Pago y completa providerPreferenceId al volver", async () => {
      const orderOfOperations: string[] = [];
      let preferenceUpdatedWith: { ref: string; prefId: string } | null = null;

      const fetcher: typeof fetch = async () => {
        orderOfOperations.push("mercadopago_call");
        return new Response(JSON.stringify({ id: "pref-mp-777", init_point: "https://mp.example/pay" }), { status: 201 });
      };

      const port: PaymentAttemptsPort = {
        async save(attempt) {
          orderOfOperations.push("db_save_attempt");
          expect(attempt.idempotencyKey).toBe("attempt-order-test");
          expect(attempt.externalReference).toBe("attempt-order-test");
          expect(attempt.status).toBe("pending");
        },
        async updatePreferenceId(reference, providerPreferenceId) {
          orderOfOperations.push("db_update_preference_id");
          preferenceUpdatedWith = { ref: reference, prefId: providerPreferenceId };
        },
        async findByExternalReference() { return null; },
        async markApproved() {}
      };

      const result = await createCheckoutProPreference(
        {
          quote: { id: "quote-1", totalCents: 1_500_000n, expiresAt: new Date("2026-10-06T12:15:00Z") },
          customer: { name: "Ana Pérez", phone: "+5491155551234" }
        },
        {
          config: { accessToken: "secret-token", webhookSecret: "wh-secret", appUrl: "https://bunker.example" },
          fetcher,
          attempts: port,
          storeStatus: storeStatus("open"),
          createId: () => "attempt-order-test",
          now: () => new Date("2026-10-06T12:00:00Z")
        }
      );

      expect(result.preferenceId).toBe("pref-mp-777");
      // STRICT ORDER OF OPERATIONS:
      // 1. db_save_attempt FIRST
      // 2. mercadopago_call SECOND
      // 3. db_update_preference_id THIRD
      expect(orderOfOperations).toEqual([
        "db_save_attempt",
        "mercadopago_call",
        "db_update_preference_id"
      ]);
      expect(preferenceUpdatedWith).toEqual({
        ref: "attempt-order-test",
        prefId: "pref-mp-777"
      });
    });

    it("falla y NUNCA llama a Mercado Pago si ocurre un error al persistir el attempt en DB (P2-08)", async () => {
      let fetchCalls = 0;
      const fetcher: typeof fetch = async () => {
        fetchCalls += 1;
        return new Response(JSON.stringify({ id: "pref-1", init_point: "https://mp.example/pay" }), { status: 201 });
      };

      const failingPort: PaymentAttemptsPort = {
        async save() {
          throw new Error("Database connection failure on attempt insert");
        },
        async findByExternalReference() { return null; },
        async markApproved() {}
      };

      await expect(
        createCheckoutProPreference(
          {
            quote: { id: "quote-1", totalCents: 1_500_000n, expiresAt: new Date("2026-10-06T12:15:00Z") },
            customer: { name: "Ana Pérez", phone: "+5491155551234" }
          },
          {
            config: { accessToken: "secret-token", webhookSecret: "wh-secret", appUrl: "https://bunker.example" },
            fetcher,
            attempts: failingPort,
            storeStatus: storeStatus("open"),
            createId: () => "attempt-fail-test",
            now: () => new Date("2026-10-06T12:00:00Z")
          }
        )
      ).rejects.toThrow("Database connection failure on attempt insert");

      // Critical invariant: NO cobrable preference created remotely if DB fails to persist attempt
      expect(fetchCalls).toBe(0);
    });

    it("mantiene el intento rastreable en base de datos si Mercado Pago hace timeout o falla la red (P2-08)", async () => {
      const attempts = new Map();
      const port: PaymentAttemptsPort = {
        async save(attempt) {
          attempts.set(attempt.id, attempt);
        },
        async findByExternalReference(ref) {
          return attempts.get(ref) ?? null;
        },
        async markApproved() {}
      };

      const timeoutFetcher: typeof fetch = async () => {
        throw new Error("Network timeout contacting Mercado Pago");
      };

      await expect(
        createCheckoutProPreference(
          {
            quote: { id: "quote-1", totalCents: 1_500_000n, expiresAt: new Date("2026-10-06T12:15:00Z") },
            customer: { name: "Ana Pérez", phone: "+5491155551234" }
          },
          {
            config: { accessToken: "secret-token", webhookSecret: "wh-secret", appUrl: "https://bunker.example" },
            fetcher: timeoutFetcher,
            attempts: port,
            storeStatus: storeStatus("open"),
            createId: () => "attempt-timeout-test",
            now: () => new Date("2026-10-06T12:00:00Z")
          }
        )
      ).rejects.toThrow("Network timeout contacting Mercado Pago");

      // The attempt was already persisted prior to the call, so it is durable and traceable!
      const saved = attempts.get("attempt-timeout-test");
      expect(saved).toBeDefined();
      expect(saved.externalReference).toBe("attempt-timeout-test");
      expect(saved.idempotencyKey).toBe("attempt-timeout-test");
      expect(saved.expectedAmountCents).toBe(1_500_000n);
    });
  });
});
