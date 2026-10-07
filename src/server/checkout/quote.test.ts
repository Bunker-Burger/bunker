import { describe, expect, it } from "vitest";

import { evaluateStoreStatus, StoreNotAcceptingOrdersError, type StoreOperatingSettings } from "@/domain/store-status";
import type { PaymentQuote, PaymentQuotesPort, PricingRepository } from "../payments/ports";
import { createAuthoritativeQuote } from "./quote";

const NOW = new Date("2026-10-06T12:00:00Z");

function storeStatus(overrides: Partial<StoreOperatingSettings> = {}) {
  const settings: StoreOperatingSettings = {
    timezone: "America/Argentina/Tucuman",
    statusOverride: "open",
    deliveryFeeCents: 120000n,
    businessHours: [],
    ...overrides
  };
  return async () => evaluateStoreStatus(settings, NOW);
}

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
  async getApplicableDiscountCents() { return 100000n; }
};

function quotesPort() {
  const saved = new Map<string, PaymentQuote>();
  const port: PaymentQuotesPort = {
    async save(quote) { saved.set(quote.id, quote); },
    async findById(id) { return saved.get(id) ?? null; }
  };
  return { saved, port };
}

const doubleBurgers = (fulfilment: "delivery" | "pickup") => ({
  items: [
    { productId: "burger-1", quantity: 2, optionSelections: { size: ["triple"] }, notes: "" },
    { productId: "burger-1", quantity: 1, optionSelections: { size: ["triple"] }, notes: "sin cebolla" }
  ],
  fulfilment,
  paymentMethod: "cash_exact" as const
});

describe("createAuthoritativeQuote", () => {
  it("recalculates every amount from the repository and saves a snapshot", async () => {
    const { saved, port } = quotesPort();

    const quote = await createAuthoritativeQuote({
      items: [{ productId: "burger-1", quantity: 2, optionSelections: { size: ["triple"] }, notes: "" }],
      fulfilment: "delivery",
      paymentMethod: "cash_exact"
    }, { repository, quotes: port, storeStatus: storeStatus(), createId: () => "quote-1", now: () => NOW });

    expect(quote.subtotalCents).toBe(1_880_000n);
    expect(quote.discountCents).toBe(100_000n);
    expect(quote.deliveryCents).toBe(120_000n);
    expect(quote.totalCents).toBe(1_900_000n);
    expect(saved.get("quote-1")).toEqual(quote);
  });

  it("applies the store's fixed delivery fee exactly once, whatever the number of lines and units", async () => {
    const { port } = quotesPort();
    const dependencies = { repository, quotes: port, storeStatus: storeStatus(), createId: () => "q", now: () => NOW };

    const delivery = await createAuthoritativeQuote(doubleBurgers("delivery"), dependencies);
    const pickup = await createAuthoritativeQuote(doubleBurgers("pickup"), dependencies);

    expect(delivery.deliveryCents).toBe(120_000n);
    expect(pickup.deliveryCents).toBe(0n);
    expect(delivery.totalCents - pickup.totalCents).toBe(120_000n);
  });

  it.each([
    ["closed by schedule", { statusOverride: "auto" as const }],
    ["paused", { statusOverride: "paused" as const }],
    ["manually closed", { statusOverride: "closed" as const }],
    ["missing a delivery fee", { deliveryFeeCents: null }]
  ])("refuses to quote, and saves nothing, while the store is %s", async (_case, overrides) => {
    const { saved, port } = quotesPort();
    let productLookups = 0;
    const counting: PricingRepository = {
      ...repository,
      async findProduct(id) {
        productLookups += 1;
        return repository.findProduct(id);
      }
    };

    await expect(createAuthoritativeQuote(doubleBurgers("pickup"), {
      repository: counting, quotes: port, storeStatus: storeStatus(overrides), createId: () => "q", now: () => NOW
    })).rejects.toBeInstanceOf(StoreNotAcceptingOrdersError);
    expect(saved.size).toBe(0);
    expect(productLookups).toBe(0);
  });

  it("rejects unavailable or invalid option selections", async () => {
    const strict: PricingRepository = {
      async findProduct() {
        return {
          id: "burger-1", name: "Doble", priceCents: 1n, available: true,
          optionGroups: [{ id: "size", minSelections: 1, maxSelections: 1, options: [] }]
        };
      },
      async getApplicableDiscountCents() { return 0n; }
    };
    const quotes: PaymentQuotesPort = { async save() {}, async findById() { return null; } };

    await expect(createAuthoritativeQuote({
      items: [{ productId: "burger-1", quantity: 1, optionSelections: { size: ["browser-fake"] }, notes: "" }],
      fulfilment: "pickup", paymentMethod: "transfer"
    }, { repository: strict, quotes, storeStatus: storeStatus(), createId: () => "q", now: () => new Date() })).rejects.toThrow(/opción inválida/i);
  });
});
