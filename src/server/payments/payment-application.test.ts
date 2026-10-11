import { describe, expect, it } from "vitest";
import { applyProviderPaymentToAttempt } from "./payment-application";
import type { PaymentAttempt, ProviderPayment } from "./ports";

/* Same rules as public.apply_mercado_pago_payment (pgTAP: bb15_mercado_pago_webhook.test.sql). */

const attempt = (overrides: Partial<PaymentAttempt> = {}): PaymentAttempt => ({
  id: "attempt-1",
  quoteId: "quote-1",
  externalReference: "ref-00000001",
  expectedAmountCents: 150000n,
  status: "pending",
  createdAt: new Date("2026-10-11T12:00:00Z"),
  ...overrides
});

const payment = (overrides: Partial<ProviderPayment> = {}): ProviderPayment => ({
  id: "1001",
  externalReference: "ref-00000001",
  status: "approved",
  amountCents: 150000n,
  currency: "ARS",
  ...overrides
});

describe("applyProviderPaymentToAttempt", () => {
  it("approves a pending attempt with a matching payment and records it", () => {
    expect(applyProviderPaymentToAttempt(attempt(), 150000n, payment())).toEqual({
      outcome: "approved",
      next: expect.objectContaining({ status: "approved", providerPaymentId: "1001", providerStatus: "approved" })
    });
  });

  it("credits nothing without an attempt, in another currency or for another amount", () => {
    expect(applyProviderPaymentToAttempt(null, null, payment())).toEqual({ outcome: "unknown_reference" });
    expect(applyProviderPaymentToAttempt(attempt(), 150000n, payment({ currency: "USD" }))).toEqual({ outcome: "currency_mismatch" });
    expect(applyProviderPaymentToAttempt(attempt(), 150000n, payment({ amountCents: 149999n }))).toEqual({ outcome: "amount_mismatch" });
  });

  it("checks the frozen quote total too", () => {
    expect(applyProviderPaymentToAttempt(attempt({ expectedAmountCents: 95000n }), 90000n, payment({ amountCents: 95000n }))).toEqual({
      outcome: "amount_mismatch"
    });
  });

  it.each(["pending", "in_process", "authorized", "in_mediation"])("only records %s", (status) => {
    expect(applyProviderPaymentToAttempt(attempt(), 150000n, payment({ status }))).toEqual({
      outcome: "pending",
      next: expect.objectContaining({ status: "pending", providerStatus: status })
    });
  });

  it("rejects or cancels an open attempt, which a later approved payment can still approve", () => {
    const rejected = applyProviderPaymentToAttempt(attempt(), 150000n, payment({ id: "1", status: "rejected" }));
    expect(rejected.outcome).toBe("rejected");
    expect(applyProviderPaymentToAttempt(rejected.next!, 150000n, payment({ id: "2" })).outcome).toBe("approved");
    expect(applyProviderPaymentToAttempt(attempt(), 150000n, payment({ status: "cancelled" })).outcome).toBe("cancelled");
  });

  it("never takes an approval back, and replays change nothing", () => {
    const approved = attempt({ status: "approved", providerPaymentId: "1001" });
    for (const status of ["approved", "pending", "rejected", "cancelled"]) {
      expect(applyProviderPaymentToAttempt(approved, 150000n, payment({ status }))).toEqual({ outcome: "unchanged" });
    }
    expect(applyProviderPaymentToAttempt(approved, 150000n, payment({ id: "999", status: "rejected" }))).toEqual({ outcome: "unchanged" });
  });

  it("reports a second approved payment instead of recording it", () => {
    expect(applyProviderPaymentToAttempt(attempt({ status: "approved", providerPaymentId: "1001" }), 150000n, payment({ id: "2002" }))).toEqual({
      outcome: "conflicting_payment"
    });
  });

  it("records a refund or chargeback of the approved payment, and a refunded attempt is final", () => {
    const approved = attempt({ status: "approved", providerPaymentId: "1001" });
    expect(applyProviderPaymentToAttempt(approved, 150000n, payment({ status: "refunded" }))).toEqual({
      outcome: "refunded",
      next: expect.objectContaining({ status: "refunded", providerStatus: "refunded" })
    });
    expect(applyProviderPaymentToAttempt(approved, 150000n, payment({ status: "charged_back" })).outcome).toBe("refunded");
    expect(applyProviderPaymentToAttempt(attempt({ status: "refunded", providerPaymentId: "1001" }), 150000n, payment())).toEqual({ outcome: "unchanged" });
  });

  it("refuses a malformed provider payment", () => {
    expect(() => applyProviderPaymentToAttempt(attempt(), 150000n, payment({ status: "Approved; drop" }))).toThrow();
    expect(() => applyProviderPaymentToAttempt(attempt(), 150000n, payment({ id: "" }))).toThrow();
  });
});
