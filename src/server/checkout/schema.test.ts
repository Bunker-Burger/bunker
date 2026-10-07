import { describe, expect, it } from "vitest";

import { parseUntrustedCheckout } from "./schema";

const baseCheckout = {
  items: [{ productId: "burger-1", quantity: 2, optionSelections: { size: ["double"] }, notes: "Sin cebolla" }],
  fulfilment: "pickup",
  paymentMethod: "cash_exact"
};

describe("parseUntrustedCheckout", () => {
  it("accepts a minimal checkout without an address", () => {
    expect(parseUntrustedCheckout(baseCheckout)).toEqual(baseCheckout);
  });

  it("rejects browser supplied prices", () => {
    expect(() => parseUntrustedCheckout({
      ...baseCheckout,
      items: [{ ...baseCheckout.items[0], unitPriceCents: "1" }]
    })).toThrow(/unrecognized key/i);
  });

  it("requires name and phone only for Mercado Pago", () => {
    expect(() => parseUntrustedCheckout({ ...baseCheckout, paymentMethod: "mercado_pago" }))
      .toThrow(/nombre y teléfono/i);

    expect(parseUntrustedCheckout({
      ...baseCheckout,
      paymentMethod: "mercado_pago",
      customer: { name: "Ana", phone: "+54 9 11 5555 1234" }
    }).customer).toEqual({ name: "Ana", phone: "+54 9 11 5555 1234" });
  });
});
