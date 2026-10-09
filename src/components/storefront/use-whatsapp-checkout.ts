"use client";

import { useEffect, useState } from "react";
import type { FulfilmentMethod, SelectedOptions } from "@/domain/types";

export const WHATSAPP_CHECKOUT_ENDPOINT = "/api/checkout/whatsapp";

/** Debounce for quantity clicks, and how often a shown total is recomputed while it stays on screen. */
export const WHATSAPP_QUOTE_DEBOUNCE_MS = 250;
export const WHATSAPP_QUOTE_REFRESH_MS = 60_000;

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
 * The server's total and WhatsApp link for the current cart, recomputed whenever the request
 * changes and every minute while shown. `null` (nothing sendable) yields `idle`; a total from
 * an older request is never shown for the current one.
 */
export function useWhatsAppCheckout(request: WhatsAppCheckoutRequest | null): WhatsAppCheckoutView {
  const key = request ? JSON.stringify(request) : null;
  const [answer, setAnswer] = useState<{ key: string; view: WhatsAppCheckoutView } | null>(null);

  useEffect(() => {
    if (key === null) return;
    let controller: AbortController | null = null;
    const load = () => {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      fetch(WHATSAPP_CHECKOUT_ENDPOINT, {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: key,
        signal: current.signal
      })
        .then(async (response) => {
          const body: unknown = await response.json().catch(() => null);
          if (current.signal.aborted) return;
          const checkout = response.ok ? parseServerCheckout(body) : null;
          const code = (body as { error?: unknown } | null)?.error;
          setAnswer({
            key,
            view: checkout ? { kind: "ready", checkout } : { kind: "error", code: typeof code === "string" ? code : "unavailable" }
          });
        })
        .catch(() => {
          if (!current.signal.aborted) setAnswer({ key, view: { kind: "error", code: "unavailable" } });
        });
    };

    const debounce = window.setTimeout(load, WHATSAPP_QUOTE_DEBOUNCE_MS);
    const refresh = window.setInterval(load, WHATSAPP_QUOTE_REFRESH_MS);
    return () => {
      window.clearTimeout(debounce);
      window.clearInterval(refresh);
      controller?.abort();
    };
  }, [key]);

  if (key === null) return { kind: "idle" };
  return answer?.key === key ? answer.view : { kind: "loading" };
}
