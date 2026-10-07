import { describe, expect, it } from "vitest";

import type { PaymentQuotesPort, PricingRepository } from "../payments/ports";
import { createAuthoritativeQuote } from "./quote";

describe("createAuthoritativeQuote", () => {
  it("recalculates every amount from the repository and saves a snapshot", async () => {
    const repository: PricingRepository = {
      async findProduct() {
        return {
          id: "burger-1",
          name: "Doble",
          priceCents: 780000n,
          available: true,
          optionGroups: [{
            id: "size",
            minSelections: 1,
            maxSelections: 1,
            options: [{ id: "triple", name: "Triple", priceDeltaCents: 160000n, available: true }]
          }]
        };
      },
      async getDeliveryFeeCents() { return 120000n; },
      async getApplicableDiscountCents() { return 100000n; }
    };
    const saved = new Map();
    const quotes: PaymentQuotesPort = {
      async save(quote) { saved.set(quote.id, quote); },
      async findById(id) { return saved.get(id) ?? null; }
    };

    const quote = await createAuthoritativeQuote({
      items: [{ productId: "burger-1", quantity: 2, optionSelections: { size: ["triple"] }, notes: "" }],
      fulfilment: "delivery",
      paymentMethod: "cash_exact"
    }, { repository, quotes, createId: () => "quote-1", now: () => new Date("2026-10-06T12:00:00Z") });

    expect(quote.subtotalCents).toBe(1_880_000n);
    expect(quote.discountCents).toBe(100_000n);
    expect(quote.deliveryCents).toBe(120_000n);
    expect(quote.totalCents).toBe(1_900_000n);
    expect(saved.get("quote-1")).toEqual(quote);
  });

  it("rejects unavailable or invalid option selections", async () => {
    const repository: PricingRepository = {
      async findProduct() {
        return {
          id: "burger-1", name: "Doble", priceCents: 1n, available: true,
          optionGroups: [{ id: "size", minSelections: 1, maxSelections: 1, options: [] }]
        };
      },
      async getDeliveryFeeCents() { return 0n; },
      async getApplicableDiscountCents() { return 0n; }
    };
    const quotes: PaymentQuotesPort = { async save() {}, async findById() { return null; } };

    await expect(createAuthoritativeQuote({
      items: [{ productId: "burger-1", quantity: 1, optionSelections: { size: ["browser-fake"] }, notes: "" }],
      fulfilment: "pickup", paymentMethod: "transfer"
    }, { repository, quotes, createId: () => "q", now: () => new Date() })).rejects.toThrow(/opción inválida/i);
  });
});
