import { describe, expect, it } from "vitest";
import { choosePromotion, quoteCart } from "./pricing";
import type { CartLine, Promotion } from "./types";

const lines: CartLine[] = [
  {
    id: "a",
    productId: "classic",
    productSlug: "bunker-clasica",
    productName: "Búnker Clásica",
    unitPriceCents: 1000000n,
    quantity: 2,
    notes: "",
    selectedOptions: {}
  }
];

const promotions: Promotion[] = [
  { id: "ten", name: "10%", priority: 5, kind: "percentage", value: 10, active: true },
  { id: "fixed", name: "$3.000 menos", priority: 10, kind: "fixed", value: 300000, active: true }
];

describe("pricing", () => {
  it("selects a single eligible promotion by configured priority", () => {
    expect(choosePromotion(lines, promotions)?.id).toBe("fixed");
  });

  it("applies fixed delivery exactly once", () => {
    const quote = quoteCart(lines, promotions, "delivery", 150000n);
    expect(quote.subtotalCents).toBe(2000000n);
    expect(quote.discountCents).toBe(300000n);
    expect(quote.deliveryCents).toBe(150000n);
    expect(quote.totalCents).toBe(1850000n);
  });

  it("does not apply delivery to pickup", () => {
    expect(quoteCart(lines, [], "pickup", 150000n).deliveryCents).toBe(0n);
  });
});

