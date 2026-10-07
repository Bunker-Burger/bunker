import { describe, expect, it } from "vitest";
import { addCartLine, cartLineIdentity, parsePersistedCart } from "./cart";
import type { CartLine } from "./types";

const line: CartLine = {
  id: "temporary",
  productId: "classic",
  productSlug: "bunker-clasica",
  productName: "Búnker Clásica",
  unitPriceCents: 980000n,
  quantity: 1,
  notes: " sin cebolla ",
  selectedOptions: { extras: ["bacon", "cheddar"], patty: ["double"] }
};

describe("cart", () => {
  it("normalizes option order and notes when identifying a line", () => {
    const reordered = {
      ...line,
      notes: "sin cebolla",
      selectedOptions: { patty: ["double"], extras: ["cheddar", "bacon"] }
    };
    expect(cartLineIdentity(line)).toBe(cartLineIdentity(reordered));
  });

  it("merges equivalent lines and preserves bigint money", () => {
    const first = addCartLine([], line);
    const second = addCartLine(first, { ...line, id: "another", quantity: 2 });
    expect(second).toHaveLength(1);
    expect(second[0]?.quantity).toBe(3);
    expect(second[0]?.unitPriceCents).toBe(980000n);
  });

  it("recovers safely from corrupt local storage", () => {
    expect(parsePersistedCart("not-json")).toEqual([]);
    expect(parsePersistedCart('{"version":99}')).toEqual([]);
  });
});

