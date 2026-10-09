"use client";

import { useEffect, useState } from "react";
import type { FulfilmentMethod, SelectedOptions } from "@/domain/types";

export const WHATSAPP_CHECKOUT_ENDPOINT = "/api/checkout/whatsapp";

/** Debounce for quantity clicks, and how often a shown total is recomputed while it stays on screen. */
export const WHATSAPP_QUOTE_DEBOUNCE_MS = 250;
export const WHATSAPP_QUOTE_REFRESH_MS = 60_000;
/** A quote that takes longer than this is dropped (fail closed): no link from a hung request. */
export const WHATSAPP_QUOTE_TIMEOUT_MS = 10_000;

/** What the browser may send: ids, quantities, notes and choices; never prices or totals. */
export interface WhatsAppCheckoutRequest {
  items: Array<{ productId: string; quantity: number; optionSelections: SelectedOptions; notes: string }>;
  fulfilment: FulfilmentMethod;
  paymentMethod: "cash_exact" | "transfer";
}

export interface ServerCheckout {
  url: string;
  subtotalCents: bigint;
  discountCents: bigint;
  deliveryCents: bigint;
  totalCents: bigint;
  promotion: { name: string; explanation: string } | null;
}

export type WhatsAppCheckoutView =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; checkout: ServerCheckout }
  | { kind: "error"; code: string };

const CENTS = /^\d+$/;

function parseServerCheckout(value: unknown): ServerCheckout | null {
  if (typeof value !== "object" || value === null) return null;
  const body = value as Record<string, unknown>;
  const amounts = [body.subtotalCents, body.discountCents, body.deliveryCents, body.totalCents];
  if (!amounts.every((amount) => typeof amount === "string" && CENTS.test(amount))) return null;
  if (typeof body.url !== "string" || !body.url.startsWith("https://wa.me/")) return null;
  const promotion = body.promotion as { name?: unknown; explanation?: unknown } | null;
  if (promotion !== null && (typeof promotion?.name !== "string" || typeof promotion.explanation !== "string")) return null;
  const [subtotalCents, discountCents, deliveryCents, totalCents] = amounts.map((amount) => BigInt(amount as string)) as [bigint, bigint, bigint, bigint];
  return {
    url: body.url,
    subtotalCents,
    discountCents,
    deliveryCents,
    totalCents,
    promotion: promotion ? { name: promotion.name as string, explanation: promotion.explanation as string } : null
  };
}

/**
 * The server's total and WhatsApp link for the current cart. A quote belongs to one `token`:
 * the request plus `freshness` (versions of the catalog, store status and promotions it was
 * computed against). Any token change, including a passage through `null` (nothing sendable),
 * discards the quote for good: an earlier link and total never come back, even for an identical
 * request, without a new POST. A refresh (every minute) drops the shown quote as it starts; only
 * the latest request's answer applies, and a failure or timeout leaves no link.
 */
export function useWhatsAppCheckout(request: WhatsAppCheckoutRequest | null, freshness: string): WhatsAppCheckoutView {
  const body = request ? JSON.stringify(request) : null;
  const token = body === null ? null : `${freshness}
${body}`;
  const [answer, setAnswer] = useState<{ token: string; view: WhatsAppCheckoutView } | null>(null);
  const [trackedToken, setTrackedToken] = useState(token);

  // Adjusting state while rendering (React's pattern for "reset on prop change"): the old answer
  // is gone before anything can render it under the new token.
  if (trackedToken !== token) {
    setTrackedToken(token);
    setAnswer(null);
  }

  useEffect(() => {
    if (token === null || body === null) return;
    let controller: AbortController | null = null;
    let disposed = false;

    const load = () => {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      const settle = (view: WhatsAppCheckoutView) => {
        // Only the latest request of this token, while mounted, may answer.
        if (controller === current && !disposed) setAnswer({ token, view });
      };
      const timeout = window.setTimeout(() => {
        current.abort();
        settle({ kind: "error", code: "unavailable" });
      }, WHATSAPP_QUOTE_TIMEOUT_MS);
      fetch(WHATSAPP_CHECKOUT_ENDPOINT, {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body,
        signal: current.signal
      })
        .then(async (response) => {
          const payload: unknown = await response.json().catch(() => null);
          if (current.signal.aborted) return;
          const checkout = response.ok ? parseServerCheckout(payload) : null;
          const code = (payload as { error?: unknown } | null)?.error;
          settle(checkout ? { kind: "ready", checkout } : { kind: "error", code: typeof code === "string" ? code : "unavailable" });
        })
        .catch(() => {
          if (!current.signal.aborted) settle({ kind: "error", code: "unavailable" });
        })
        .finally(() => window.clearTimeout(timeout));
    };
    const refresh = () => {
      // The shown link stops being sendable the moment its re-check starts.
      setAnswer({ token, view: { kind: "loading" } });
      load();
    };

    const debounce = window.setTimeout(load, WHATSAPP_QUOTE_DEBOUNCE_MS);
    const timer = window.setInterval(refresh, WHATSAPP_QUOTE_REFRESH_MS);
    return () => {
      disposed = true;
      window.clearTimeout(debounce);
      window.clearInterval(timer);
      controller?.abort();
    };
  }, [token, body]);

  if (token === null) return { kind: "idle" };
  return answer?.token === token ? answer.view : { kind: "loading" };
}
