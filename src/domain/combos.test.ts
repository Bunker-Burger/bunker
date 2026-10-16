import { describe, expect, it } from "vitest";
import { comboCount, removeOneCombo } from "./combos";
import type { CartLine } from "./types";

const combo = {
  id: "combo",
  items: [
    { productId: "burger", quantity: 1 },
    { productId: "fries", quantity: 2 }
  ]
};

const line = (productId: string, quantity: number, extras: Partial<CartLine> = {}): CartLine => ({
  id: `${productId}-${quantity}-${JSON.stringify(extras)}`,
  productId,
  productSlug: productId,
  productName: productId,
  unitPriceCents: 100n,
  quantity,
  notes: "",
  selectedOptions: {},
  ...extras
});

describe("combos in the cart", () => {
  it("counts complete combos from the lines added from the combo only", () => {
    const lines = [line("burger", 2, { comboId: "combo" }), line("fries", 4, { comboId: "combo" }), line("burger", 5), line("fries", 9)];
    expect(comboCount(lines, combo)).toBe(2);
    expect(comboCount([line("burger", 1, { comboId: "combo" }), line("fries", 1, { comboId: "combo" })], combo)).toBe(0);
    expect(comboCount([line("burger", 1), line("fries", 2)], combo)).toBe(0);
  });

  it("takes one combo away, from the last lines first, and everything with the last one", () => {
    const lines = [
      line("burger", 1, { comboId: "combo", notes: "con extras" }),
      line("fries", 2, { comboId: "combo" }),
      line("burger", 1, { comboId: "combo" }),
      line("fries", 2, { comboId: "combo", notes: "otras" }),
      line("burger", 3)
    ];
    const one = removeOneCombo(lines, combo);
    expect(comboCount(one, combo)).toBe(1);
    // The last burger line and the last fries line went; what was loose stays.
    expect(one.map((candidate) => [candidate.productId, candidate.quantity, candidate.notes])).toEqual([
      ["burger", 1, "con extras"],
      ["fries", 2, ""],
      ["burger", 3, ""]
    ]);
    expect(removeOneCombo(one, combo).map((candidate) => candidate.productId)).toEqual(["burger"]);
  });
});
