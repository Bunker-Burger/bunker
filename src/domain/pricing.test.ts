import { describe, expect, it } from "vitest";
import { quoteCart } from "./pricing";
import type { PromotionLine } from "./promotions";
import type { PromotionRule } from "./types";

const lines: PromotionLine[] = [{ productId: "classic", quantity: 2, unitPriceCents: 1000000n, basePriceCents: 1000000n }];
const context = { now: new Date("2026-10-07T00:00:00Z"), timezone: "America/Argentina/Tucuman" };

const base = {
  description: "",
  badgeText: null,
  active: true,
  startsAt: new Date("2026-01-01T00:00:00Z"),
  endsAt: new Date("2027-01-01T00:00:00Z"),
  channels: ["delivery", "pickup"] as PromotionRule["channels"],
  items: [],
  schedule: []
};
const tenPercent: PromotionRule = { ...base, id: "ten", slug: "ten", name: "10%", priority: 5, mechanic: { type: "percent_off", percentOff: 10 } };
const freeDelivery: PromotionRule = { ...base, id: "envio", slug: "envio", name: "Envío gratis", priority: 9, mechanic: { type: "free_delivery" } };

describe("quoteCart", () => {
  it("applies the fixed delivery fee exactly once and a single promotion", () => {
    const quote = quoteCart(lines, [tenPercent], "delivery", 150000n, context);
    expect(quote).toMatchObject({ subtotalCents: 2000000n, discountCents: 200000n, deliveryCents: 150000n, totalCents: 1950000n });
    expect(quote.promotion?.promotionId).toBe("ten");
  });

  it("does not charge delivery for pickup", () => {
    expect(quoteCart(lines, [], "pickup", 150000n, context)).toMatchObject({ deliveryCents: 0n, totalCents: 2000000n, promotion: null });
  });

  it("waives the fee with free delivery instead of also taking the 10%", () => {
    const quote = quoteCart(lines, [tenPercent, freeDelivery], "delivery", 150000n, context);
    expect(quote).toMatchObject({ discountCents: 150000n, deliveryCents: 150000n, totalCents: 2000000n });
    expect(quote.promotion?.promotionId).toBe("envio");
  });
});
