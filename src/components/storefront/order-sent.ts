import type { CartLine } from "@/domain/types";

/**
 * "Did you send the order?" (issue: cart after WhatsApp). Opening WhatsApp does not prove the
 * message was sent, so the cart is not emptied on the click: the click leaves a mark here, and
 * when the customer comes back to the menu they are asked. The mark belongs to the cart as it was
 * sent; a different cart (they kept shopping) or an old mark asks nothing.
 */
const ORDER_SENT_KEY = "bunker-order-sent";
export const ORDER_SENT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

interface OrderSentMark {
  at: number;
  cart: string;
}

/** The cart as sent: its lines and quantities (a line's id already covers its options and notes). */
export function cartSignature(cart: readonly CartLine[]): string {
  return JSON.stringify(cart.map((line) => [line.id, line.quantity]));
}

export function markOrderSent(cart: readonly CartLine[], now: number): void {
  try {
    localStorage.setItem(ORDER_SENT_KEY, JSON.stringify({ at: now, cart: cartSignature(cart) } satisfies OrderSentMark));
  } catch {
    // Without storage there is no question afterwards; the cart simply stays.
  }
}

export function forgetOrderSent(): void {
  try {
    localStorage.removeItem(ORDER_SENT_KEY);
  } catch {
    // Nothing to forget.
  }
}

function readMark(): OrderSentMark | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(ORDER_SENT_KEY) ?? "null");
    if (typeof value !== "object" || value === null) return null;
    const { at, cart } = value as Record<string, unknown>;
    return typeof at === "number" && typeof cart === "string" ? { at, cart } : null;
  } catch {
    return null;
  }
}

/**
 * Whether to ask about this cart now. An expired mark, or one for a cart that changed since, is
 * dropped. An empty cart asks nothing but keeps the mark: on load the cart may not be read yet.
 */
export function shouldAskOrderSent(cart: readonly CartLine[], now: number): boolean {
  const mark = readMark();
  if (!mark) return false;
  if (now - mark.at > ORDER_SENT_MAX_AGE_MS) {
    forgetOrderSent();
    return false;
  }
  if (cart.length === 0) return false;
  if (mark.cart !== cartSignature(cart)) {
    forgetOrderSent();
    return false;
  }
  return true;
}
