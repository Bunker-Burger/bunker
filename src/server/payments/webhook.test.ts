import { describe, expect, it } from "vitest";

import type { MercadoPagoPaymentGateway, PaymentAttemptsPort, WebhookEventsPort, WebhookSignatureVerifier } from "./ports";
import { processMercadoPagoWebhook } from "./webhook";

function dependencies(overrides: Partial<{
  verifier: WebhookSignatureVerifier;
  events: WebhookEventsPort;
  attempts: PaymentAttemptsPort;
  gateway: MercadoPagoPaymentGateway;
}> = {}) {
  return {
    verifier: { async verify() { return true; } },
    events: { async begin() { return "started" as const; }, async complete() {}, async fail() {} },
    attempts: {
      async save() {},
      async findByExternalReference() { return { id: "attempt-1", quoteId: "quote-1", externalReference: "attempt-1", expectedAmountCents: 1500000n, status: "pending" as const, createdAt: new Date() }; },
      async markApproved() {}
    },
    gateway: { async getPayment() { return { id: "payment-1", externalReference: "attempt-1", status: "approved" as const, amountCents: 1500000n, currency: "ARS" }; } },
    ...overrides
  };
}

const notification = { eventId: "event-1", paymentId: "payment-1", headers: {}, query: {} };

describe("processMercadoPagoWebhook", () => {
  it("rejects an invalid signature before touching idempotency", async () => {
    let began = false;
    const result = await processMercadoPagoWebhook(notification, dependencies({
      verifier: { async verify() { return false; } },
      events: { async begin() { began = true; return "started"; }, async complete() {}, async fail() {} }
    }));
    expect(result).toEqual({ kind: "invalid_signature" });
    expect(began).toBe(false);
  });

  it("treats an already claimed event as an idempotent duplicate", async () => {
    const result = await processMercadoPagoWebhook(notification, dependencies({
      events: { async begin() { return "duplicate"; }, async complete() {}, async fail() {} }
    }));
    expect(result).toEqual({ kind: "duplicate" });
  });

  it("queries Mercado Pago and approves only a matching authoritative payment", async () => {
    let approvedReference = "";
    const result = await processMercadoPagoWebhook(notification, dependencies({
      attempts: {
        async save() {},
        async findByExternalReference(reference) { return { id: reference, quoteId: "quote-1", externalReference: reference, expectedAmountCents: 1500000n, status: "pending", createdAt: new Date() }; },
        async markApproved(reference) { approvedReference = reference; }
      }
    }));
    expect(result).toEqual({ kind: "approved", attemptId: "attempt-1", paymentId: "payment-1" });
    expect(approvedReference).toBe("attempt-1");
  });

  it("does not approve a payment whose amount does not match", async () => {
    await expect(processMercadoPagoWebhook(notification, dependencies({
      gateway: { async getPayment() { return { id: "payment-1", externalReference: "attempt-1", status: "approved", amountCents: 1n, currency: "ARS" }; } }
    }))).rejects.toThrow(/importe/i);
  });
});
