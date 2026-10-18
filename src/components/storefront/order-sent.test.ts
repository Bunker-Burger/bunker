import { beforeEach, describe, expect, it } from "vitest";
import type { CartLine } from "@/domain/types";
import { cartSignature, forgetOrderSent, markOrderSent, ORDER_SENT_MAX_AGE_MS, shouldAskOrderSent } from "./order-sent";

const line = (id: string, quantity: number): CartLine => ({
  id,
  productId: id,
  productSlug: id,
  productName: id,
  quantity,
  unitPriceCents: 100n,
  selectedOptions: {},
  notes: ""
});

describe("order sent to WhatsApp", () => {
  beforeEach(() => localStorage.clear());

  it("asks for the same cart that was sent, until it is forgotten", () => {
    const cart = [line("a", 2)];
    markOrderSent(cart, 1000);
    expect(shouldAskOrderSent(cart, 2000)).toBe(true);
    forgetOrderSent();
    expect(shouldAskOrderSent(cart, 2000)).toBe(false);
  });

  it("asks nothing, and drops the mark, when the cart changed or the mark is old", () => {
    markOrderSent([line("a", 2)], 1000);
    expect(shouldAskOrderSent([line("a", 3)], 2000)).toBe(false);
    expect(shouldAskOrderSent([line("a", 2)], 2000)).toBe(false);

    markOrderSent([line("a", 2)], 1000);
    expect(shouldAskOrderSent([line("a", 2)], 1000 + ORDER_SENT_MAX_AGE_MS + 1)).toBe(false);
    expect(localStorage.getItem("bunker-order-sent")).toBeNull();
  });

  it("keeps the mark while the cart is still empty (not read yet on load)", () => {
    markOrderSent([line("a", 1)], 1000);
    expect(shouldAskOrderSent([], 2000)).toBe(false);
    expect(shouldAskOrderSent([line("a", 1)], 2000)).toBe(true);
  });

  it("ignores a broken mark", () => {
    localStorage.setItem("bunker-order-sent", "{nope");
    expect(shouldAskOrderSent([line("a", 1)], 2000)).toBe(false);
    expect(cartSignature([line("a", 1), line("b", 2)])).toBe('[["a",1],["b",2]]');
  });
});
