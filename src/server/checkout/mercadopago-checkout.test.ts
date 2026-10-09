import { describe, expect, it } from "vitest";
import type { StoreOperatingSettings } from "@/domain/store-status";
import { evaluateStoreStatus } from "@/domain/store-status";
import type { Catalog } from "@/domain/types";
import { ok } from "@/lib/result";
import {
  prepareMercadoPagoCheckout,
  mercadoPagoCheckoutResponse
} from "./mercadopago-checkout";
import { createInMemoryPaymentRepository } from "../payments/payment-repository";

const STORE_ID = "0199b2c8-40b0-7000-8000-000000000001";
const PRODUCT_ID = "0199b2c8-40b0-7000-8000-000000000201";

function mockCatalog(options?: { mpEnabled?: boolean }): Catalog {
  return {
    store: {
      id: STORE_ID,
      name: "Búnker Burger",
      slug: "bunker-burger",
      whatsappE164: "+5493815550000",
      timezone: "America/Argentina/Tucuman",
      currency: "ARS",
      statusOverride: "open",
      isPublic: true,
      deliveryFeeCents: 150000n,
      businessHours: [],
      paymentMethods: [
        { method: "cash", displayName: "Efectivo", instructions: "", enabled: true, sortOrder: 10 },
        { method: "bank_transfer", displayName: "Transferencia", instructions: "", enabled: true, sortOrder: 20 },
        { method: "mercado_pago", displayName: "Mercado Pago", instructions: "", enabled: options?.mpEnabled ?? true, sortOrder: 30 }
      ]
    },
    categories: [],
    products: [
      {
        id: PRODUCT_ID,
        type: "burger",
        categoryId: "c1",
        name: "Smash Clásica",
        slug: "smash-clasica",
        description: "Doble carne",
        priceCents: 800000n,
        featured: true,
        published: true,
        inStock: true,
        containsAlcohol: false,
        imageUrl: null,
        optionGroups: []
      }
    ],
    promotions: []
  };
}

function mockStoreStatus(override: StoreOperatingSettings["statusOverride"] = "open") {
  return async () =>
    ok(
      evaluateStoreStatus(
        {
          timezone: "America/Argentina/Tucuman",
          statusOverride: override,
          deliveryFeeCents: 150000n,
          businessHours: []
        },
        new Date("2026-10-09T01:00:00Z")
      )
    );
}

describe("prepareMercadoPagoCheckout", () => {
  it("TC-SEC-01 (strict): rechaza con invalid_request si el payload inyecta claves desconocidas como precios", async () => {
    const repo = createInMemoryPaymentRepository();
    const maliciousPayload = {
      items: [{ productId: PRODUCT_ID, quantity: 2, unitPriceCents: 100, optionSelections: {}, notes: "" }],
      fulfilment: "pickup",
      paymentMethod: "mercado_pago",
      customer: { name: "Juan Pérez", phone: "+54 9 381 555-1234" },
      totalCents: 200
    };

    const result = await prepareMercadoPagoCheckout(maliciousPayload, {
      detectConfig: () => ({
        enabled: true,
        config: { accessToken: "test-token", webhookSecret: "test-secret", appUrl: "https://bunker.test" }
      }),
      loadCatalog: async () => ok(mockCatalog()),
      loadStoreStatus: mockStoreStatus("open"),
      quotes: repo.quotes,
      attempts: repo.attempts,
      createId: () => "uuid-attempt-1",
      now: () => new Date("2026-10-09T01:00:00Z")
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_request");
  });

  it("TC-SEC-01 (authoritative): calcula autoritativamente con la base de datos sin recibir precios del navegador", async () => {
    const repo = createInMemoryPaymentRepository();
    const mpRequests: Array<{ input: RequestInfo | URL; init?: RequestInit | undefined }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      mpRequests.push({ input, init });
      return new Response(JSON.stringify({ id: "pref-100", init_point: "https://mp.example/checkout" }), { status: 201 });
    };

    const validPayload = {
      items: [{ productId: PRODUCT_ID, quantity: 2, optionSelections: {}, notes: "" }],
      fulfilment: "pickup",
      paymentMethod: "mercado_pago",
      customer: { name: "Juan Pérez", phone: "+54 9 381 555-1234" }
    };

    const result = await prepareMercadoPagoCheckout(validPayload, {
      detectConfig: () => ({
        enabled: true,
        config: { accessToken: "test-token", webhookSecret: "test-secret", appUrl: "https://bunker.test" }
      }),
      loadCatalog: async () => ok(mockCatalog()),
      loadStoreStatus: mockStoreStatus("open"),
      quotes: repo.quotes,
      attempts: repo.attempts,
      fetcher,
      createId: () => "uuid-attempt-1",
      now: () => new Date("2026-10-09T01:00:00Z")
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 2x 800000n = 1600000n ($16.000)
    expect(result.value.quote.totalCents).toBe(1600000n);
    expect(result.value.preferenceId).toBe("pref-100");
    expect(result.value.checkoutUrl).toBe("https://mp.example/checkout");
    expect(result.value.externalReference).toBe("uuid-attempt-1");

    // Verificar que en MP se envió el precio autoritativo
    const sentBody = JSON.parse(String(mpRequests[0]?.init?.body));
    expect(sentBody.items[0]?.unit_price).toBe(16000); // 1600000 / 100
  });

  it("TC-VAL-01 & TC-VAL-02: rechaza si faltan nombre o teléfono para Mercado Pago", async () => {
    const repo = createInMemoryPaymentRepository();

    const missingCustomer = {
      items: [{ productId: PRODUCT_ID, quantity: 1, optionSelections: {}, notes: "" }],
      fulfilment: "pickup",
      paymentMethod: "mercado_pago"
    };

    const result = await prepareMercadoPagoCheckout(missingCustomer, {
      detectConfig: () => ({
        enabled: true,
        config: { accessToken: "test-token", webhookSecret: "test-secret", appUrl: "https://bunker.test" }
      }),
      loadCatalog: async () => ok(mockCatalog()),
      loadStoreStatus: mockStoreStatus("open"),
      quotes: repo.quotes,
      attempts: repo.attempts,
      createId: () => "uuid-1",
      now: () => new Date("2026-10-09T01:00:00Z")
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_request");
  });

  it("TC-STORE-01: rechaza crear preferencia si el local está cerrado o en pausa", async () => {
    const repo = createInMemoryPaymentRepository();

    const validPayload = {
      items: [{ productId: PRODUCT_ID, quantity: 1, optionSelections: {}, notes: "" }],
      fulfilment: "pickup",
      paymentMethod: "mercado_pago",
      customer: { name: "Juan Pérez", phone: "+54 9 381 555-1234" }
    };

    const result = await prepareMercadoPagoCheckout(validPayload, {
      detectConfig: () => ({
        enabled: true,
        config: { accessToken: "test-token", webhookSecret: "test-secret", appUrl: "https://bunker.test" }
      }),
      loadCatalog: async () => ok(mockCatalog()),
      loadStoreStatus: mockStoreStatus("closed"),
      quotes: repo.quotes,
      attempts: repo.attempts,
      createId: () => "uuid-1",
      now: () => new Date("2026-10-09T01:00:00Z")
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("store_closed");
  });

  it("TC-ENV-01: responde payment_method_unavailable (503) si faltan keys de Mercado Pago", async () => {
    const repo = createInMemoryPaymentRepository();

    const validPayload = {
      items: [{ productId: PRODUCT_ID, quantity: 1, optionSelections: {}, notes: "" }],
      fulfilment: "pickup",
      paymentMethod: "mercado_pago",
      customer: { name: "Juan Pérez", phone: "+54 9 381 555-1234" }
    };

    const result = await prepareMercadoPagoCheckout(validPayload, {
      detectConfig: () => ({ enabled: false, missing: ["MERCADO_PAGO_ACCESS_TOKEN"] }),
      loadCatalog: async () => ok(mockCatalog()),
      loadStoreStatus: mockStoreStatus("open"),
      quotes: repo.quotes,
      attempts: repo.attempts,
      createId: () => "uuid-1",
      now: () => new Date("2026-10-09T01:00:00Z")
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("payment_method_unavailable");

    const response = mercadoPagoCheckoutResponse(result);
    expect(response.status).toBe(503);
  });

  it("rechaza si el comercio tiene deshabilitado Mercado Pago", async () => {
    const repo = createInMemoryPaymentRepository();

    const validPayload = {
      items: [{ productId: PRODUCT_ID, quantity: 1, optionSelections: {}, notes: "" }],
      fulfilment: "pickup",
      paymentMethod: "mercado_pago",
      customer: { name: "Juan Pérez", phone: "+54 9 381 555-1234" }
    };

    const result = await prepareMercadoPagoCheckout(validPayload, {
      detectConfig: () => ({
        enabled: true,
        config: { accessToken: "test-token", webhookSecret: "test-secret", appUrl: "https://bunker.test" }
      }),
      loadCatalog: async () => ok(mockCatalog({ mpEnabled: false })),
      loadStoreStatus: mockStoreStatus("open"),
      quotes: repo.quotes,
      attempts: repo.attempts,
      createId: () => "uuid-1",
      now: () => new Date("2026-10-09T01:00:00Z")
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("payment_method_unavailable");
  });

  it("falla cerrado con 503 cuando la base de datos falla al guardar la quote (P1-02)", async () => {
    const errorQuotes = {
      save: async () => {
        throw new Error("DB write failed");
      },
      findById: async () => null
    };
    const repo = createInMemoryPaymentRepository();

    const validPayload = {
      items: [{ productId: PRODUCT_ID, quantity: 1, optionSelections: {}, notes: "" }],
      fulfilment: "pickup",
      paymentMethod: "mercado_pago",
      customer: { name: "Juan Pérez", phone: "+54 9 381 555-1234" }
    };

    const result = await prepareMercadoPagoCheckout(validPayload, {
      detectConfig: () => ({
        enabled: true,
        config: { accessToken: "test-token", webhookSecret: "test-secret", appUrl: "https://bunker.test" }
      }),
      loadCatalog: async () => ok(mockCatalog()),
      loadStoreStatus: mockStoreStatus("open"),
      quotes: errorQuotes,
      attempts: repo.attempts,
      createId: () => "uuid-1",
      now: () => new Date("2026-10-09T01:00:00Z")
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("unavailable");
    const response = mercadoPagoCheckoutResponse(result);
    expect(response.status).toBe(503);
  });

  it("falla cerrado con 503 cuando falla la persistencia del attempt (P1-02)", async () => {
    const repo = createInMemoryPaymentRepository();
    const errorAttempts = {
      save: async () => {
        throw new Error("Attempts DB failure");
      },
      findByExternalReference: async () => null,
      markApproved: async () => {}
    };

    const validPayload = {
      items: [{ productId: PRODUCT_ID, quantity: 1, optionSelections: {}, notes: "" }],
      fulfilment: "pickup",
      paymentMethod: "mercado_pago",
      customer: { name: "Juan Pérez", phone: "+54 9 381 555-1234" }
    };

    const result = await prepareMercadoPagoCheckout(validPayload, {
      detectConfig: () => ({
        enabled: true,
        config: { accessToken: "test-token", webhookSecret: "test-secret", appUrl: "https://bunker.test" }
      }),
      loadCatalog: async () => ok(mockCatalog()),
      loadStoreStatus: mockStoreStatus("open"),
      quotes: repo.quotes,
      attempts: errorAttempts,
      createId: () => "uuid-1",
      now: () => new Date("2026-10-09T01:00:00Z"),
      fetcher: async () =>
        new Response(JSON.stringify({ id: "pref_123", init_point: "https://mp.test/init" }), { status: 200 })
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("unavailable");
    const response = mercadoPagoCheckoutResponse(result);
    expect(response.status).toBe(503);
  });

  it("calcula y congela delivery con fulfillmentChannel='delivery' y tarifa oficial (P2-03)", async () => {
    const repo = createInMemoryPaymentRepository();

    const validPayload = {
      items: [{ productId: PRODUCT_ID, quantity: 1, optionSelections: {}, notes: "" }],
      fulfilment: "delivery",
      paymentMethod: "mercado_pago",
      customer: { name: "Juan Pérez", phone: "+54 9 381 555-1234" }
    };

    const result = await prepareMercadoPagoCheckout(validPayload, {
      detectConfig: () => ({
        enabled: true,
        config: { accessToken: "test-token", webhookSecret: "test-secret", appUrl: "https://bunker.test" }
      }),
      loadCatalog: async () => ok(mockCatalog()),
      loadStoreStatus: mockStoreStatus("open"),
      quotes: repo.quotes,
      attempts: repo.attempts,
      createId: () => "uuid-1",
      now: () => new Date("2026-10-09T01:00:00Z"),
      fetcher: async () =>
        new Response(JSON.stringify({ id: "pref_123", init_point: "https://mp.test/init" }), { status: 200 })
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.quote.fulfillmentChannel).toBe("delivery");
    expect(result.value.quote.deliveryCents).toBe(150000n);
    expect(result.value.quote.totalCents).toBe(950000n); // 800000 + 150000
  });

  it("P2-09: dos POST equivalentes reúsan la misma preferencia y no crean preferencias extra en MP", async () => {
    const repo = createInMemoryPaymentRepository();
    let mpCalls = 0;

    const fetcher: typeof fetch = async () => {
      mpCalls += 1;
      return new Response(JSON.stringify({ id: "pref_dedup_1", init_point: "https://mp.test/init" }), { status: 200 });
    };

    const payload = {
      items: [{ productId: PRODUCT_ID, quantity: 2, optionSelections: {}, notes: "Sin cebolla" }],
      fulfilment: "pickup",
      paymentMethod: "mercado_pago",
      customer: { name: "Carlos López", phone: "+54 9 381 555-9999" }
    };

    // Primer POST
    const result1 = await prepareMercadoPagoCheckout(payload, {
      detectConfig: () => ({
        enabled: true,
        config: { accessToken: "test-token", webhookSecret: "test-secret", appUrl: "https://bunker.test" }
      }),
      loadCatalog: async () => ok(mockCatalog()),
      loadStoreStatus: mockStoreStatus("open"),
      quotes: repo.quotes,
      attempts: repo.attempts,
      createId: () => "id-call-1",
      now: () => new Date("2026-10-09T01:00:00Z"),
      fetcher
    });

    expect(result1.ok).toBe(true);
    if (!result1.ok) return;
    expect(result1.value.preferenceId).toBe("pref_dedup_1");
    expect(mpCalls).toBe(1);

    // Segundo POST equivalente (ej. doble clic, reintento o respuesta perdida)
    const result2 = await prepareMercadoPagoCheckout(payload, {
      detectConfig: () => ({
        enabled: true,
        config: { accessToken: "test-token", webhookSecret: "test-secret", appUrl: "https://bunker.test" }
      }),
      loadCatalog: async () => ok(mockCatalog()),
      loadStoreStatus: mockStoreStatus("open"),
      quotes: repo.quotes,
      attempts: repo.attempts,
      createId: () => "id-call-2",
      now: () => new Date("2026-10-09T01:01:00Z"),
      fetcher
    });

    expect(result2.ok).toBe(true);
    if (!result2.ok) return;
    // Reutiliza exactamente la misma preferencia y referencia externa!
    expect(result2.value.preferenceId).toBe("pref_dedup_1");
    expect(result2.value.externalReference).toBe(result1.value.externalReference);
    // CERO llamadas extra a Mercado Pago!
    expect(mpCalls).toBe(1);
  });

  it("P2-09: reintento tras timeout reutiliza el attempt existente y la misma clave de idempotencia", async () => {
    const repo = createInMemoryPaymentRepository();
    let callCount = 0;
    const sentIdempotencyKeys: string[] = [];

    const fetcher: typeof fetch = async (_input, init) => {
      callCount += 1;
      const headers = init?.headers as Record<string, string>;
      if (headers?.["X-Idempotency-Key"]) {
        sentIdempotencyKeys.push(headers["X-Idempotency-Key"]);
      }
      if (callCount === 1) {
        throw new Error("Network timeout contacting MP");
      }
      return new Response(JSON.stringify({ id: "pref_after_timeout", init_point: "https://mp.test/init" }), { status: 200 });
    };

    const payload = {
      items: [{ productId: PRODUCT_ID, quantity: 1, optionSelections: {}, notes: "" }],
      fulfilment: "pickup",
      paymentMethod: "mercado_pago",
      customer: { name: "Lucía Gómez", phone: "+54 9 381 555-8888" }
    };

    // Primer intento: falla por timeout en la llamada a MP
    const firstTry = await prepareMercadoPagoCheckout(payload, {
      detectConfig: () => ({
        enabled: true,
        config: { accessToken: "test-token", webhookSecret: "test-secret", appUrl: "https://bunker.test" }
      }),
      loadCatalog: async () => ok(mockCatalog()),
      loadStoreStatus: mockStoreStatus("open"),
      quotes: repo.quotes,
      attempts: repo.attempts,
      createId: () => "attempt-try-1",
      now: () => new Date("2026-10-09T01:00:00Z"),
      fetcher
    });

    expect(firstTry.ok).toBe(false);

    // Segundo intento (reintento del cliente tras timeout):
    const secondTry = await prepareMercadoPagoCheckout(payload, {
      detectConfig: () => ({
        enabled: true,
        config: { accessToken: "test-token", webhookSecret: "test-secret", appUrl: "https://bunker.test" }
      }),
      loadCatalog: async () => ok(mockCatalog()),
      loadStoreStatus: mockStoreStatus("open"),
      quotes: repo.quotes,
      attempts: repo.attempts,
      createId: () => "attempt-try-2",
      now: () => new Date("2026-10-09T01:00:05Z"),
      fetcher
    });

    expect(secondTry.ok).toBe(true);
    if (!secondTry.ok) return;
    expect(secondTry.value.preferenceId).toBe("pref_after_timeout");

    // Ambas llamadas a MP enviaron la misma clave de idempotencia
    expect(sentIdempotencyKeys.length).toBe(2);
    expect(sentIdempotencyKeys[0]).toBe(sentIdempotencyKeys[1]);
  });

  it("P2-09: carrera concurrente entre dos POST idénticos devuelve la misma preferencia con una sola llamada a MP", async () => {
    const repo = createInMemoryPaymentRepository();
    let mpCalls = 0;

    const fetcher: typeof fetch = async () => {
      mpCalls += 1;
      // Simular latencia de red en MP
      await new Promise((resolve) => setTimeout(resolve, 20));
      return new Response(JSON.stringify({ id: "pref_concurrent_win", init_point: "https://mp.test/init" }), { status: 200 });
    };

    const payload = {
      items: [{ productId: PRODUCT_ID, quantity: 1, optionSelections: {}, notes: "" }],
      fulfilment: "pickup",
      paymentMethod: "mercado_pago",
      customer: { name: "Mateo Ruiz", phone: "+54 9 381 555-7777" }
    };

    const [resA, resB] = await Promise.all([
      prepareMercadoPagoCheckout(payload, {
        detectConfig: () => ({
          enabled: true,
          config: { accessToken: "test-token", webhookSecret: "test-secret", appUrl: "https://bunker.test" }
        }),
        loadCatalog: async () => ok(mockCatalog()),
        loadStoreStatus: mockStoreStatus("open"),
        quotes: repo.quotes,
        attempts: repo.attempts,
        createId: () => "race-id-a",
        now: () => new Date("2026-10-09T01:00:00Z"),
        fetcher
      }),
      prepareMercadoPagoCheckout(payload, {
        detectConfig: () => ({
          enabled: true,
          config: { accessToken: "test-token", webhookSecret: "test-secret", appUrl: "https://bunker.test" }
        }),
        loadCatalog: async () => ok(mockCatalog()),
        loadStoreStatus: mockStoreStatus("open"),
        quotes: repo.quotes,
        attempts: repo.attempts,
        createId: () => "race-id-b",
        now: () => new Date("2026-10-09T01:00:00Z"),
        fetcher
      })
    ]);

    expect(resA.ok).toBe(true);
    expect(resB.ok).toBe(true);
    if (!resA.ok || !resB.ok) return;

    expect(resA.value.preferenceId).toBe("pref_concurrent_win");
    expect(resB.value.preferenceId).toBe("pref_concurrent_win");
    expect(resA.value.externalReference).toBe(resB.value.externalReference);

    // Exactamente 1 llamada a Mercado Pago gracias a la deduplicación concurrente
    expect(mpCalls).toBe(1);
  });
});
