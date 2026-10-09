import { describe, expect, it } from "vitest";
import { checkMercadoPagoPaymentStatus } from "./mercadopago-status";
import { createInMemoryPaymentRepository } from "../payments/payment-repository";
import type { Catalog } from "@/domain/types";
import { ok } from "@/lib/result";
import type { PaymentQuote } from "../payments/ports";

function mockQuote(
  id: string,
  totalCents = 1500000n,
  expiresAt?: Date,
  fulfillmentChannel: "pickup" | "delivery" = "pickup",
  deliveryCents = 0n
): PaymentQuote {
  return {
    id,
    lines: [{
      productId: "p1",
      productName: "Smash",
      quantity: 1,
      unitPriceCents: totalCents - deliveryCents,
      basePriceCents: totalCents - deliveryCents,
      selectedOptions: [],
      notes: ""
    }],
    subtotalCents: totalCents - deliveryCents,
    discountCents: 0n,
    deliveryCents,
    totalCents,
    promotion: null,
    fulfillmentChannel,
    expiresAt: expiresAt ?? new Date(Date.now() + 15 * 60_000)
  };
}

describe("checkMercadoPagoPaymentStatus", () => {
  it("TC-VAL: rechaza referencias inválidas o vacías", async () => {
    const repo = createInMemoryPaymentRepository();
    const res1 = await checkMercadoPagoPaymentStatus({ ref: "" }, { attempts: repo.attempts, quotes: repo.quotes });
    expect(res1.status).toBe("invalid_reference");

    const res2 = await checkMercadoPagoPaymentStatus({ ref: "short" }, { attempts: repo.attempts, quotes: repo.quotes });
    expect(res2.status).toBe("invalid_reference");
  });

  it("retorna not_found si la referencia no existe en la base de datos", async () => {
    const repo = createInMemoryPaymentRepository();
    const res = await checkMercadoPagoPaymentStatus(
      { ref: "attempt-non-existent-12345" },
      { attempts: repo.attempts, quotes: repo.quotes }
    );
    expect(res.status).toBe("not_found");
  });

  it("TC-RET-02: retorna approved si el intento ya fue marcado como aprobado", async () => {
    const repo = createInMemoryPaymentRepository();
    await repo.quotes.save(mockQuote("quote-1"));
    await repo.attempts.save({
      id: "attempt-1",
      quoteId: "quote-1",
      externalReference: "ext-ref-approved",
      expectedAmountCents: 1500000n,
      status: "approved",
      providerPaymentId: "mp-pay-999",
      createdAt: new Date()
    });

    const res = await checkMercadoPagoPaymentStatus(
      { ref: "ext-ref-approved" },
      {
        attempts: repo.attempts,
        quotes: repo.quotes,
        loadCatalog: async () => ok({
          store: {
            id: "s1",
            name: "Bunker",
            slug: "bunker",
            whatsappE164: "+5493815551234",
            timezone: "America/Argentina/Tucuman",
            currency: "ARS",
            statusOverride: "open",
            isPublic: true,
            deliveryFeeCents: 0n,
            businessHours: [],
            paymentMethods: []
          },
          categories: [],
          products: [],
          promotions: []
        })
      }
    );

    expect(res.status).toBe("approved");
    if (res.status !== "approved") return;
    expect(res.paymentReference).toBe("mp-pay-999");
    expect(res.totalCents).toBe("1500000");
    expect(res.whatsappUrl).toContain("wa.me/5493815551234");
    expect(res.whatsappUrl).toContain("mp-pay-999");
  });

  it("TC-RET-01: retorna pending verificando si sigue pendiente y no hay payment_id", async () => {
    const repo = createInMemoryPaymentRepository();
    await repo.quotes.save(mockQuote("quote-1"));
    await repo.attempts.save({
      id: "attempt-1",
      quoteId: "quote-1",
      externalReference: "ext-ref-pending",
      expectedAmountCents: 1500000n,
      status: "pending",
      createdAt: new Date()
    });

    const res = await checkMercadoPagoPaymentStatus(
      { ref: "ext-ref-pending" },
      { attempts: repo.attempts, quotes: repo.quotes }
    );

    expect(res.status).toBe("pending");
    if (res.status === "pending") {
      expect(res.verifying).toBe(true);
    }
  });

  it("reconcilia server-to-server con MP cuando el retorno incluye payment_id y está aprobado", async () => {
    const repo = createInMemoryPaymentRepository();
    await repo.quotes.save(mockQuote("quote-1"));
    await repo.attempts.save({
      id: "attempt-1",
      quoteId: "quote-1",
      externalReference: "ext-ref-reconcile",
      expectedAmountCents: 1500000n,
      status: "pending",
      createdAt: new Date()
    });

    const fetcher: typeof fetch = async () =>
      new Response(JSON.stringify({
        id: 777888999,
        external_reference: "ext-ref-reconcile",
        currency_id: "ARS",
        transaction_amount: 15000,
        status: "approved"
      }), { status: 200 });

    const res = await checkMercadoPagoPaymentStatus(
      { ref: "ext-ref-reconcile", paymentId: "777888999" },
      {
        attempts: repo.attempts,
        quotes: repo.quotes,
        detectConfig: () => ({
          enabled: true,
          config: { accessToken: "token", webhookSecret: "secret", appUrl: "https://bunker.test" }
        }),
        fetcher
      }
    );

    expect(res.status).toBe("approved");
    if (res.status !== "approved") return;
    expect(res.paymentReference).toBe("777888999");

    // Verificar que el intento fue marcado como aprobado en BD
    const updatedAttempt = await repo.attempts.findByExternalReference("ext-ref-reconcile");
    expect(updatedAttempt?.status).toBe("approved");
    expect(updatedAttempt?.providerPaymentId).toBe("777888999");
  });

  it("rechaza si MP indica status rejected en la reconciliación", async () => {
    const repo = createInMemoryPaymentRepository();
    await repo.quotes.save(mockQuote("quote-1"));
    await repo.attempts.save({
      id: "attempt-1",
      quoteId: "quote-1",
      externalReference: "ext-ref-rejected",
      expectedAmountCents: 1500000n,
      status: "pending",
      createdAt: new Date()
    });

    const fetcher: typeof fetch = async () =>
      new Response(JSON.stringify({
        id: 111222333,
        external_reference: "ext-ref-rejected",
        currency_id: "ARS",
        transaction_amount: 15000,
        status: "rejected"
      }), { status: 200 });

    const res = await checkMercadoPagoPaymentStatus(
      { ref: "ext-ref-rejected", paymentId: "111222333" },
      {
        attempts: repo.attempts,
        quotes: repo.quotes,
        detectConfig: () => ({
          enabled: true,
          config: { accessToken: "token", webhookSecret: "secret", appUrl: "https://bunker.test" }
        }),
        fetcher
      }
    );

    expect(res.status).toBe("rejected");
  });

  it("no aprueba si el pago en MP tiene un importe o moneda que no coincide (tampering)", async () => {
    const repo = createInMemoryPaymentRepository();
    await repo.quotes.save(mockQuote("quote-1"));
    await repo.attempts.save({
      id: "attempt-1",
      quoteId: "quote-1",
      externalReference: "ext-ref-tampered",
      expectedAmountCents: 1500000n, // $15.000
      status: "pending",
      createdAt: new Date()
    });

    const fetcher: typeof fetch = async () =>
      new Response(JSON.stringify({
        id: 999111,
        external_reference: "ext-ref-tampered",
        currency_id: "ARS",
        transaction_amount: 10, // $10 en vez de $15.000
        status: "approved"
      }), { status: 200 });

    const res = await checkMercadoPagoPaymentStatus(
      { ref: "ext-ref-tampered", paymentId: "999111" },
      {
        attempts: repo.attempts,
        quotes: repo.quotes,
        detectConfig: () => ({
          enabled: true,
          config: { accessToken: "token", webhookSecret: "secret", appUrl: "https://bunker.test" }
        }),
        fetcher
      }
    );

    // No se acredita, sigue en pending
    expect(res.status).toBe("pending");
  });

  it("retorna expired si la cotización venció y no fue aprobada", async () => {
    const repo = createInMemoryPaymentRepository();
    const expiredDate = new Date("2026-10-09T00:50:00Z");
    await repo.quotes.save(mockQuote("quote-1", 1500000n, expiredDate));
    await repo.attempts.save({
      id: "attempt-1",
      quoteId: "quote-1",
      externalReference: "ext-ref-expired",
      expectedAmountCents: 1500000n,
      status: "pending",
      createdAt: new Date("2026-10-09T00:40:00Z")
    });

    const res = await checkMercadoPagoPaymentStatus(
      { ref: "ext-ref-expired" },
      {
        attempts: repo.attempts,
        quotes: repo.quotes,
        now: () => new Date("2026-10-09T01:00:00Z") // 10 minutos después del vencimiento
      }
    );

    expect(res.status).toBe("expired");
  });

  it("TC-DELIVERY: genera mensaje de WhatsApp con modalidad Delivery, tarifa y solicitud de dirección (P2-03)", async () => {
    const repo = createInMemoryPaymentRepository();
    // Delivery quote: subtotal $15.000 + delivery $1.500 = total $16.500
    await repo.quotes.save(mockQuote("quote-deliv", 1650000n, undefined, "delivery", 150000n));
    await repo.attempts.save({
      id: "attempt-deliv",
      quoteId: "quote-deliv",
      externalReference: "ext-ref-deliv",
      expectedAmountCents: 1650000n,
      status: "approved",
      providerPaymentId: "mp-pay-delivery-123",
      createdAt: new Date()
    });

    const mockCatalog = {
      store: { whatsappE164: "+5493815550000" }
    } as unknown as Catalog;

    const res = await checkMercadoPagoPaymentStatus(
      { ref: "ext-ref-deliv" },
      {
        attempts: repo.attempts,
        quotes: repo.quotes,
        loadCatalog: async () => ok(mockCatalog)
      }
    );

    expect(res.status).toBe("approved");
    if (res.status !== "approved") return;
    expect(res.whatsappUrl).toBeDefined();
    const decodedUrl = decodeURIComponent(res.whatsappUrl!);
    expect(decodedUrl).toContain("Modalidad: Delivery");
    expect(decodedUrl).toContain("Envío: $1.500");
    expect(decodedUrl).toContain("Te paso la dirección de entrega por este chat.");
    expect(decodedUrl).toContain("Pago: Mercado Pago acreditado por webhook (ref. mp-pay-delivery-123)");
  });

  it("TC-PICKUP: genera mensaje de WhatsApp con modalidad Retiro en el local sin costo de envío (P2-03)", async () => {
    const repo = createInMemoryPaymentRepository();
    await repo.quotes.save(mockQuote("quote-pickup", 1500000n, undefined, "pickup", 0n));
    await repo.attempts.save({
      id: "attempt-pickup",
      quoteId: "quote-pickup",
      externalReference: "ext-ref-pickup",
      expectedAmountCents: 1500000n,
      status: "approved",
      providerPaymentId: "mp-pay-pickup-123",
      createdAt: new Date()
    });

    const mockCatalog = {
      store: { whatsappE164: "+5493815550000" }
    } as unknown as Catalog;

    const res = await checkMercadoPagoPaymentStatus(
      { ref: "ext-ref-pickup" },
      {
        attempts: repo.attempts,
        quotes: repo.quotes,
        loadCatalog: async () => ok(mockCatalog)
      }
    );

    expect(res.status).toBe("approved");
    if (res.status !== "approved") return;
    expect(res.whatsappUrl).toBeDefined();
    const decodedUrl = decodeURIComponent(res.whatsappUrl!);
    expect(decodedUrl).toContain("Modalidad: Retiro en el local");
    expect(decodedUrl).not.toContain("Envío:");
    expect(decodedUrl).not.toContain("Te paso la dirección de entrega");
  });

  it("TC-ABANDONED: reconcilia retorno abandonado sin payment_id mediante búsqueda MP server-to-server (P2-06)", async () => {
    const repo = createInMemoryPaymentRepository();
    await repo.quotes.save(mockQuote("quote-abandoned", 1500000n));
    await repo.attempts.save({
      id: "attempt-abandoned",
      quoteId: "quote-abandoned",
      externalReference: "ext-ref-abandoned",
      expectedAmountCents: 1500000n,
      status: "pending",
      createdAt: new Date()
    });

    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/v1/payments/search?external_reference=ext-ref-abandoned")) {
        return new Response(JSON.stringify({
          paging: { total: 1 },
          results: [{
            id: 888777666,
            external_reference: "ext-ref-abandoned",
            currency_id: "ARS",
            transaction_amount: 15000,
            status: "approved"
          }]
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
    };

    // Client returns WITHOUT payment_id parameter (abandoned flow or polled by ref)
    const res = await checkMercadoPagoPaymentStatus(
      { ref: "ext-ref-abandoned" },
      {
        attempts: repo.attempts,
        quotes: repo.quotes,
        detectConfig: () => ({
          enabled: true,
          config: { accessToken: "token", webhookSecret: "secret", appUrl: "https://bunker.test" }
        }),
        fetcher
      }
    );

    expect(res.status).toBe("approved");
    if (res.status !== "approved") return;
    expect(res.paymentReference).toBe("888777666");

    const saved = await repo.attempts.findByExternalReference("ext-ref-abandoned");
    expect(saved?.status).toBe("approved");
    expect(saved?.providerPaymentId).toBe("888777666");
  });

  it("TC-ABANDONED-EXPIRED: retorno abandonado sin pago en MP transcurrido el tiempo marca expired (P2-06)", async () => {
    const repo = createInMemoryPaymentRepository();
    const expiredDate = new Date("2026-10-09T00:50:00Z");
    await repo.quotes.save(mockQuote("quote-abandoned-exp", 1500000n, expiredDate));
    await repo.attempts.save({
      id: "attempt-abandoned-exp",
      quoteId: "quote-abandoned-exp",
      externalReference: "ext-ref-abandoned-exp",
      expectedAmountCents: 1500000n,
      status: "pending",
      createdAt: new Date("2026-10-09T00:40:00Z")
    });

    const fetcher: typeof fetch = async () =>
      new Response(JSON.stringify({ paging: { total: 0 }, results: [] }), { status: 200 });

    const res = await checkMercadoPagoPaymentStatus(
      { ref: "ext-ref-abandoned-exp" },
      {
        attempts: repo.attempts,
        quotes: repo.quotes,
        detectConfig: () => ({
          enabled: true,
          config: { accessToken: "token", webhookSecret: "secret", appUrl: "https://bunker.test" }
        }),
        fetcher,
        now: () => new Date("2026-10-09T01:00:00Z")
      }
    );

    expect(res.status).toBe("expired");
  });

  it("TC-ZERO-TRUST: nunca acredita por parámetros de URL arbitrarios sin validación con MP (P2-06)", async () => {
    const repo = createInMemoryPaymentRepository();
    await repo.quotes.save(mockQuote("quote-tamper-url"));
    await repo.attempts.save({
      id: "attempt-tamper-url",
      quoteId: "quote-tamper-url",
      externalReference: "ext-ref-tamper-url",
      expectedAmountCents: 1500000n,
      status: "pending",
      createdAt: new Date()
    });

    // Adversary provides a fake payment_id and claims it was approved in URL query
    const fetcher: typeof fetch = async () =>
      new Response(JSON.stringify({ error: "not_found" }), { status: 404 });

    const res = await checkMercadoPagoPaymentStatus(
      { ref: "ext-ref-tamper-url", paymentId: "fake-id-999" },
      {
        attempts: repo.attempts,
        quotes: repo.quotes,
        detectConfig: () => ({
          enabled: true,
          config: { accessToken: "token", webhookSecret: "secret", appUrl: "https://bunker.test" }
        }),
        fetcher
      }
    );

    // Stays pending (never credited by untrusted URL params)
    expect(res.status).toBe("pending");
    const attempt = await repo.attempts.findByExternalReference("ext-ref-tamper-url");
    expect(attempt?.status).toBe("pending");
  });
});
