import { describe, expect, it } from "vitest";

import {
  deriveLogicalCheckoutIdempotencyKey,
  deriveLogicalCheckoutPayloadDigest,
  deriveRotatedCheckoutIdempotencyKey,
  parseUntrustedCheckout
} from "./schema";

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

  it("accepts optional intentNonce in payload", () => {
    const parsed = parseUntrustedCheckout({
      ...baseCheckout,
      intentNonce: "custom-nonce-1234"
    });
    expect(parsed.intentNonce).toBe("custom-nonce-1234");
  });
});

describe("deriveLogicalCheckoutPayloadDigest and deriveLogicalCheckoutIdempotencyKey (P1-10)", () => {
  const mpCheckout = {
    items: [
      { productId: "p-2", quantity: 1, optionSelections: { cheese: ["cheddar"] }, notes: "Poco hielo" },
      { productId: "p-1", quantity: 2, optionSelections: { size: ["double"] }, notes: "" }
    ],
    fulfilment: "delivery" as const,
    paymentMethod: "mercado_pago" as const,
    customer: { name: " Carlos Gómez ", phone: "+54 9 381 555-1111" }
  };

  it("produces deterministic canonical key invariant to item ordering", () => {
    const digest = deriveLogicalCheckoutPayloadDigest(mpCheckout);
    expect(digest).toBeTypeOf("string");
    expect(digest.length).toBe(64);

    const permutedCheckout = {
      ...mpCheckout,
      items: [
        { productId: "p-1", quantity: 2, optionSelections: { size: ["double"] }, notes: "" },
        { productId: "p-2", quantity: 1, optionSelections: { cheese: ["cheddar"] }, notes: "Poco hielo" }
      ]
    };

    const key1 = deriveLogicalCheckoutIdempotencyKey(mpCheckout);
    const key2 = deriveLogicalCheckoutIdempotencyKey(permutedCheckout);

    expect(key1).toBe(key2);
    expect(key1.startsWith("checkout-")).toBe(true);
    expect(key1.length).toBe(41); // checkout- (9) + 32 hex = 41 chars, satisfies check between 16 and 128
  });

  it("separates purchase intent nonce: different nonces produce distinct keys", () => {
    const keyA = deriveLogicalCheckoutIdempotencyKey(mpCheckout, "intent-nonce-1");
    const keyB = deriveLogicalCheckoutIdempotencyKey(mpCheckout, "intent-nonce-2");

    expect(keyA).not.toBe(keyB);
    expect(keyA.length).toBe(41);
    expect(keyB.length).toBe(41);
  });

  it("P1-10: deriveRotatedCheckoutIdempotencyKey generates deterministic, distinct 41-char keys across generations", () => {
    const baseKey = "checkout-12345678901234567890123456789012";
    expect(deriveRotatedCheckoutIdempotencyKey(baseKey, 1)).toBe(baseKey);

    const gen2 = deriveRotatedCheckoutIdempotencyKey(baseKey, 2);
    const gen3 = deriveRotatedCheckoutIdempotencyKey(baseKey, 3);

    expect(gen2).not.toBe(baseKey);
    expect(gen3).not.toBe(gen2);
    expect(gen2.length).toBe(41);
    expect(gen3.length).toBe(41);
    expect(gen2.startsWith("checkout-")).toBe(true);
    expect(gen3.startsWith("checkout-")).toBe(true);

    // Determinismo: llamar nuevamente con gen=2 devuelve exactamente la misma clave
    expect(deriveRotatedCheckoutIdempotencyKey(baseKey, 2)).toBe(gen2);
  });
});
