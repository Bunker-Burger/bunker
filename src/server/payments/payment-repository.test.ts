import { describe, expect, it } from "vitest";
import { createInMemoryPaymentRepository } from "./payment-repository";
import type { PaymentAttempt, PaymentQuote } from "./ports";

describe("createInMemoryPaymentRepository", () => {
  it("saves and retrieves quotes by id", async () => {
    const repo = createInMemoryPaymentRepository();
    const expiresAt = new Date("2026-10-09T01:00:00Z");

    const quote: PaymentQuote = {
      id: "quote-123",
      lines: [{
        productId: "p1",
        productName: "Smash",
        quantity: 2,
        unitPriceCents: 150000n,
        basePriceCents: 150000n,
        selectedOptions: [],
        notes: "Sin sal"
      }],
      subtotalCents: 300000n,
      discountCents: 0n,
      deliveryCents: 120000n,
      totalCents: 420000n,
      promotion: null,
      expiresAt
    };

    await repo.quotes.save(quote);
    const retrieved = await repo.quotes.findById("quote-123");

    expect(retrieved).toEqual(quote);
    expect(await repo.quotes.findById("non-existent")).toBeNull();
  });

  it("saves, finds, and marks approved payment attempts", async () => {
    const repo = createInMemoryPaymentRepository();
    const createdAt = new Date("2026-10-09T01:00:00Z");

    const attempt: PaymentAttempt = {
      id: "attempt-uuid-1",
      quoteId: "quote-123",
      externalReference: "attempt-uuid-1",
      expectedAmountCents: 420000n,
      status: "pending",
      createdAt
    };

    await repo.attempts.save(attempt);
    const found = await repo.attempts.findByExternalReference("attempt-uuid-1");
    expect(found).toEqual(attempt);

    await repo.attempts.markApproved("attempt-uuid-1", "mp-payment-999");
    const updated = await repo.attempts.findByExternalReference("attempt-uuid-1");
    expect(updated?.status).toBe("approved");
    expect(updated?.providerPaymentId).toBe("mp-payment-999");
  });
});
