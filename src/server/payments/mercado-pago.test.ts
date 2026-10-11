import { describe, expect, it } from "vitest";

import { evaluateStoreStatus, StoreNotAcceptingOrdersError, type StoreOperatingSettings } from "@/domain/store-status";
import type { PaymentAttempt, PaymentAttemptsPort } from "./ports";
import { createCheckoutProPreference, detectMercadoPagoConfig } from "./mercado-pago";

describe("detectMercadoPagoConfig", () => {
  it("enables Mercado Pago with required BB-14 server configuration (token + appUrl, webhookSecret optional)", () => {
    expect(detectMercadoPagoConfig({ MERCADO_PAGO_ACCESS_TOKEN: "token" })).toEqual({
      enabled: false,
      missing: ["APP_URL"]
    });
    expect(detectMercadoPagoConfig({
      MERCADO_PAGO_ACCESS_TOKEN: " token ",
      APP_URL: "https://bunker.example/"
    })).toEqual({ enabled: true, config: {
      accessToken: "token", appUrl: "https://bunker.example"
    } });
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

  // P2-13: an unusable APP_URL disables this optional method instead of throwing into the page.
  it.each([
    ["without a scheme", "sin-esquema"],
    ["with an unsupported protocol", "ftp://example.com"],
    ["that is not a URL at all", "http://"]
  ])("disables Mercado Pago, without throwing, for an APP_URL %s", (_case, appUrl) => {
    expect(detectMercadoPagoConfig({ MERCADO_PAGO_ACCESS_TOKEN: "token", APP_URL: appUrl })).toEqual({
      enabled: false,
      missing: [],
      invalid: ["APP_URL"]
    });
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
      },
      // BB-15: Mercado Pago notifies payment changes here.
      notification_url: "https://bunker.example/api/payments/mercado-pago/webhook"
    });
    expect(attempts.get("attempt-1")).toMatchObject({
      quoteId: "quote-1",
      expectedAmountCents: 1_500_000n,
      status: "pending",
      // BB-15: minimal contact kept with the attempt for the 90-day retention.
      customer: { name: "Ana Pérez", phone: "+5491155551234" }
    });
  });

  it("does not send a notification_url Mercado Pago would refuse (http APP_URL in development)", async () => {
    let body: Record<string, unknown> = {};
    await createCheckoutProPreference({
      quote: { id: "quote-1", totalCents: 1_500_000n, expiresAt: new Date("2026-10-06T12:15:00Z") },
      customer: { name: "Ana Pérez", phone: "+5491155551234" }
    }, {
      config: { accessToken: "secret-token", webhookSecret: "wh-secret", appUrl: "http://localhost:3000" },
      fetcher: async (_input, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ id: "pref-1", init_point: "https://mp.example/pay" }), { status: 201 });
      },
      attempts: { async save() {}, async findByExternalReference() { return null; }, async markApproved() {} },
      storeStatus: storeStatus("open"),
      createId: () => "attempt-1",
      now: () => new Date("2026-10-06T12:00:00Z")
    });
    expect(body).not.toHaveProperty("notification_url");
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

    it("P2-09: retorna la preferencia existente sin invocar a MP si findByIdempotencyKey ya tiene providerPreferenceId", async () => {
      let fetchCalls = 0;
      const fetcher: typeof fetch = async () => {
        fetchCalls += 1;
        return new Response(JSON.stringify({ id: "pref-new", init_point: "https://mp.example/pay" }), { status: 201 });
      };

      const port: PaymentAttemptsPort = {
        async save() {},
        async findByExternalReference() { return null; },
        async findByIdempotencyKey(key) {
          if (key === "idem-key-existing") {
            return {
              id: "att-existing",
              quoteId: "quote-1",
              idempotencyKey: "idem-key-existing",
              externalReference: "ext-ref-existing",
              expectedAmountCents: 1_500_000n,
              status: "pending",
              createdAt: new Date("2026-10-06T12:00:00Z"),
              providerPreferenceId: "pref-already-created"
            };
          }
          return null;
        },
        async markApproved() {}
      };

      const res = await createCheckoutProPreference(
        {
          quote: { id: "quote-1", totalCents: 1_500_000n, expiresAt: new Date("2026-10-06T12:15:00Z") },
          customer: { name: "Ana Pérez", phone: "+5491155551234" },
          idempotencyKey: "idem-key-existing"
        },
        {
          config: { accessToken: "secret-token", webhookSecret: "wh-secret", appUrl: "https://bunker.example" },
          fetcher,
          attempts: port,
          storeStatus: storeStatus("open"),
          createId: () => "fresh-id",
          now: () => new Date("2026-10-06T12:00:00Z")
        }
      );

      expect(res.preferenceId).toBe("pref-already-created");
      expect(res.externalReference).toBe("ext-ref-existing");
      expect(fetchCalls).toBe(0); // Cero llamadas remotas!
    });

    it("P2-09: deduplica carreras concurrentes en createCheckoutProPreference realizando solo 1 llamada a MP", async () => {
      let fetchCalls = 0;
      const fetcher: typeof fetch = async () => {
        fetchCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return new Response(JSON.stringify({ id: "pref-concurrent", init_point: "https://mp.example/pay" }), { status: 201 });
      };

      const attempts = new Map();
      const port: PaymentAttemptsPort = {
        async save(att) { attempts.set(att.idempotencyKey, att); },
        async findByExternalReference(ref) { return attempts.get(ref) ?? null; },
        async findByIdempotencyKey(key) { return attempts.get(key) ?? null; },
        async markApproved() {}
      };

      const [res1, res2] = await Promise.all([
        createCheckoutProPreference(
          {
            quote: { id: "quote-1", totalCents: 1_500_000n, expiresAt: new Date("2026-10-06T12:15:00Z") },
            customer: { name: "Ana Pérez", phone: "+5491155551234" },
            idempotencyKey: "idem-race-1"
          },
          {
            config: { accessToken: "secret-token", webhookSecret: "wh-secret", appUrl: "https://bunker.example" },
            fetcher,
            attempts: port,
            storeStatus: storeStatus("open"),
            createId: () => "id-1",
            now: () => new Date("2026-10-06T12:00:00Z")
          }
        ),
        createCheckoutProPreference(
          {
            quote: { id: "quote-1", totalCents: 1_500_000n, expiresAt: new Date("2026-10-06T12:15:00Z") },
            customer: { name: "Ana Pérez", phone: "+5491155551234" },
            idempotencyKey: "idem-race-1"
          },
          {
            config: { accessToken: "secret-token", webhookSecret: "wh-secret", appUrl: "https://bunker.example" },
            fetcher,
            attempts: port,
            storeStatus: storeStatus("open"),
            createId: () => "id-2",
            now: () => new Date("2026-10-06T12:00:00Z")
          }
        )
      ]);

      expect(res1.preferenceId).toBe("pref-concurrent");
      expect(res2.preferenceId).toBe("pref-concurrent");
      expect(res1.externalReference).toBe(res2.externalReference);
      expect(fetchCalls).toBe(1); // Exactamente 1 llamada remota!
    });

    it("P1-11: dos runtimes aislados sin memoria compartida ejecutan conflicto UNIQUE 23505 y coordinan atómicamente a 1 sola llamada a MP", async () => {
      let fetchCalls = 0;
      let resolveWinnerFetcher!: (value: Response) => void;
      const winnerFetcherPromise = new Promise<Response>((resolve) => {
        resolveWinnerFetcher = resolve;
      });

      const fetcherWinner: typeof fetch = async () => {
        fetchCalls += 1;
        return winnerFetcherPromise;
      };

      const fetcherLoser: typeof fetch = async () => {
        fetchCalls += 1;
        return new Response(JSON.stringify({ id: "pref-loser-should-never-be-called", init_point: "https://mp.example/loser" }), { status: 201 });
      };

      let conflictTriggered = false;
      const sharedDbAttempts = new Map<string, PaymentAttempt>();
      const sharedDbIdempotency = new Map<string, PaymentAttempt>();

      const createIsolatedPort = (): PaymentAttemptsPort => ({
        async save(att) {
          if (att.idempotencyKey) {
            const existing = sharedDbIdempotency.get(att.idempotencyKey);
            if (existing && existing.id !== att.id) {
              conflictTriggered = true;
              const err = Object.assign(
                new Error('duplicate key value violates unique constraint "payment_attempts_idempotency_key_key"'),
                { code: "23505" }
              );
              throw err;
            }
            sharedDbIdempotency.set(att.idempotencyKey, att);
          }
          sharedDbAttempts.set(att.externalReference, att);
        },
        async updatePreferenceId(ref, prefId) {
          const found = sharedDbAttempts.get(ref);
          if (found) {
            found.providerPreferenceId = prefId;
            found.status = "pending";
          }
        },
        async findByExternalReference(ref) {
          return sharedDbAttempts.get(ref) ?? null;
        },
        async findByIdempotencyKey(key) {
          return sharedDbIdempotency.get(key) ?? null;
        },
        async markApproved() {}
      });

      // Runtime A y Runtime B tienen instancias separadas de port y mapas aislados de in-flight (simulan 2 Lambdas independientes)
      const portA = createIsolatedPort();
      const portB = createIsolatedPort();
      const inFlightA = new Map();
      const inFlightB = new Map();

      const baseInput = {
        quote: { id: "quote-p1-11", totalCents: 2_000_000n, expiresAt: new Date(Date.now() + 15 * 60_000) },
        customer: { name: "Carlos Gardel", phone: "+5491155554321" },
        idempotencyKey: "checkout-unique-race-p1-11"
      };

      // Runtime A y Runtime B ejecutan concurrentemente con mapas in-flight aislados (2 Lambdas)
      // Ambos inician cuando DB aún no tiene el intento, provocando la carrera real sobre save() y el conflicto 23505
      setTimeout(() => {
        resolveWinnerFetcher(new Response(JSON.stringify({ id: "pref-winner-mp", init_point: "https://mp.example/winner" }), { status: 201 }));
      }, 50);

      const [resA, resB] = await Promise.all([
        createCheckoutProPreference(baseInput, {
          config: { accessToken: "secret-token", appUrl: "https://bunker.example" },
          fetcher: fetcherWinner,
          attempts: portA,
          storeStatus: storeStatus("open"),
          createId: () => "winner-attempt-id",
          now: () => new Date(),
          inFlightMap: inFlightA
        }),
        createCheckoutProPreference(baseInput, {
          config: { accessToken: "secret-token", appUrl: "https://bunker.example" },
          fetcher: fetcherLoser,
          attempts: portB,
          storeStatus: storeStatus("open"),
          createId: () => "loser-attempt-id",
          now: () => new Date(),
          inFlightMap: inFlightB
        })
      ]);

      // Aserciones estrictas de P1-11:
      expect(conflictTriggered).toBe(true); // Se ejecutó el conflicto 23505 real!
      expect(fetchCalls).toBe(1); // Runtime B NUNCA llamó a Mercado Pago!
      expect(resA.preferenceId).toBe("pref-winner-mp");
      expect(resB.preferenceId).toBe("pref-winner-mp");
      expect(resA.checkoutUrl).toBe("https://mp.example/winner");
      expect(resB.checkoutUrl).toBe("https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-winner-mp");
      expect(resA.externalReference).toBe("winner-attempt-id");
      expect(resB.externalReference).toBe("winner-attempt-id");
    });

    it("P1-11: falla de manera segura si el intento ganador en DB corresponde a otra cotización o expiró", async () => {
      const sharedDbIdempotency = new Map<string, PaymentAttempt>();
      sharedDbIdempotency.set("conflict-key-different-quote", {
        id: "existing-winner",
        quoteId: "different-quote-id",
        expectedAmountCents: 999_999n,
        status: "pending",
        idempotencyKey: "conflict-key-different-quote",
        externalReference: "ext-different",
        createdAt: new Date()
      });

      const port: PaymentAttemptsPort = {
        async save() {
          const err = Object.assign(
            new Error('duplicate key value violates unique constraint "payment_attempts_idempotency_key_key"'),
            { code: "23505" }
          );
          throw err;
        },
        async findByExternalReference() { return null; },
        async findByIdempotencyKey(key) { return sharedDbIdempotency.get(key) ?? null; },
        async markApproved() {}
      };

      await expect(
        createCheckoutProPreference(
          {
            quote: { id: "my-quote-id", totalCents: 1_500_000n, expiresAt: new Date(Date.now() + 15 * 60_000) },
            customer: { name: "Ana Pérez", phone: "+5491155551234" },
            idempotencyKey: "conflict-key-different-quote"
          },
          {
            config: { accessToken: "secret-token", appUrl: "https://bunker.example" },
            fetcher: async () => new Response("{}", { status: 200 }),
            attempts: port,
            storeStatus: storeStatus("open"),
            createId: () => "my-attempt",
            now: () => new Date(),
            inFlightMap: new Map()
          }
        )
      ).rejects.toThrow("El intento de pago concurrente en DB no coincide con la cotización o ha expirado.");
    });
  });
});
