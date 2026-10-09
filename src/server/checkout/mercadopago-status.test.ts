import { describe, expect, it } from "vitest";
import { checkMercadoPagoPaymentStatus } from "./mercadopago-status";
import { createInMemoryPaymentRepository } from "../payments/payment-repository";
import type { PaymentQuote } from "../payments/ports";
import { ok } from "@/lib/result";

function mockQuote(id: string, totalCents = 1500000n, expiresAt?: Date): PaymentQuote {
  return {
    id,
    lines: [{
      productId: "p1",
      productName: "Smash",
      quantity: 1,
      unitPriceCents: totalCents,
      basePriceCents: totalCents,
      selectedOptions: [],
      notes: ""
    }],
    subtotalCents: totalCents,
    discountCents: 0n,
    deliveryCents: 0n,
    totalCents,
    promotion: null,
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
});
