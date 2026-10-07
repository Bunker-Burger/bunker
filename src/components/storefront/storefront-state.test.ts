import { describe, expect, it } from "vitest";
import type { CartLine } from "@/domain/types";
import {
  changeLineQuantity,
  createWhatsAppUrl,
  toggleOption,
  validateCashAmount
} from "./storefront-state";

const line: CartLine = {
  id: "line-1",
  productId: "classic",
  productSlug: "bunker-clasica",
  productName: "Búnker Clásica",
  unitPriceCents: 780000n,
  quantity: 2,
  notes: "",
  selectedOptions: {}
};

describe("cart editing", () => {
  it("removes a cart line when its quantity reaches zero", () => {
    expect(changeLineQuantity([line], line.id, -2)).toEqual([]);
  });

  it("changes only the requested cart line quantity", () => {
    const other = { ...line, id: "line-2", quantity: 1 };
    expect(changeLineQuantity([line, other], line.id, 1)).toEqual([
      { ...line, quantity: 3 },
      other
    ]);
  });
});

describe("product option selection", () => {
  it("replaces the previous option in a single-select group", () => {
    expect(toggleOption({ size: ["double"] }, "size", "triple", 1)).toEqual({
      size: ["triple"]
    });
  });

  it("toggles options without exceeding a multi-select maximum", () => {
    expect(toggleOption({ extras: ["bacon", "cheddar"] }, "extras", "egg", 2)).toEqual({
      extras: ["bacon", "cheddar"]
    });
    expect(toggleOption({ extras: ["bacon", "cheddar"] }, "extras", "bacon", 2)).toEqual({
      extras: ["cheddar"]
    });
  });
});

describe("checkout boundaries", () => {
  it("requires a cash amount at least equal to the total", () => {
    expect(validateCashAmount("14999", 1500000n)).toBe(false);
    expect(validateCashAmount("15000", 1500000n)).toBe(true);
    expect(validateCashAmount("", 1500000n)).toBe(false);
  });

  it("encodes the normalized order in the WhatsApp link", () => {
    const url = createWhatsAppUrl({
      phone: "54 9 3865-207458",
      fulfilment: "pickup",
      payment: "cash",
      totalCents: 1560000n,
      lines: [line]
    });

    expect(url).toBe(
      "https://wa.me/5493865207458?text=Hola%20B%C3%BAnker%20Burger!%0A%0AQuiero%20confirmar%20este%20pedido%3A%0A%E2%80%A2%202%C3%97%20B%C3%BAnker%20Cl%C3%A1sica%20%E2%80%94%20%2415.600%0A%0AModalidad%3A%20Retiro%20en%20el%20local%0APago%3A%20Efectivo%0ATotal%3A%20%2415.600"
    );
  });
});
