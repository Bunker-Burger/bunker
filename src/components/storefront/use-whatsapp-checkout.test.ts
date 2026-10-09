import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useWhatsAppCheckout,
  WHATSAPP_CHECKOUT_ENDPOINT,
  WHATSAPP_QUOTE_DEBOUNCE_MS,
  WHATSAPP_QUOTE_REFRESH_MS,
  WHATSAPP_QUOTE_TIMEOUT_MS,
  type WhatsAppCheckoutRequest
} from "./use-whatsapp-checkout";

/*
 * BB-10 review round 1 (P1 A/B): a quote belongs to one request + freshness token. It is never
 * shown again once the token changed (even back to the same value), it stops being sendable as
 * soon as a refresh starts, only the latest request answers, and failures or hangs leave no link.
 */

const request: WhatsAppCheckoutRequest = {
  items: [{ productId: "smash-doble", quantity: 1, optionSelections: { patty: ["double"] }, notes: "" }],
  fulfilment: "pickup",
  paymentMethod: "cash_exact"
};

const quote = (url: string, totalCents: string) => ({
  url,
  subtotalCents: totalCents,
  discountCents: "0",
  deliveryCents: "0",
  totalCents,
  promotion: null
});
const A = quote("https://wa.me/5493865207458?text=A", "780000");
const B = quote("https://wa.me/5493865207458?text=B", "850000");

interface Pending {
  body: unknown;
  resolve: (response: Response) => void;
}

let pending: Pending[];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.useFakeTimers();
  pending = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
      expect(String(input)).toBe(WHATSAPP_CHECKOUT_ENDPOINT);
      return new Promise<Response>((resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        pending.push({ body: JSON.parse(String(init.body)), resolve });
      });
    })
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function answer(index: number, body: unknown, status = 200) {
  await act(async () => {
    pending[index]!.resolve(json(body, status));
    await vi.advanceTimersByTimeAsync(0);
  });
}

function render(initial: { request: WhatsAppCheckoutRequest | null; freshness: string }) {
  return renderHook(({ request, freshness }) => useWhatsAppCheckout(request, freshness), { initialProps: initial });
}

const urlOf = (view: ReturnType<typeof useWhatsAppCheckout>) => (view.kind === "ready" ? view.checkout.url : null);

describe("useWhatsAppCheckout freshness", () => {
  it("never shows quote A again after the request went away, even for the identical request", async () => {
    const hook = render({ request, freshness: "v1" });
    await advance(WHATSAPP_QUOTE_DEBOUNCE_MS);
    await answer(0, A);
    expect(urlOf(hook.result.current)).toBe(A.url);

    hook.rerender({ request: null, freshness: "v1" });
    expect(hook.result.current).toEqual({ kind: "idle" });

    // Same JSON and same freshness as A: a new POST, and A is not shown while it is pending.
    hook.rerender({ request, freshness: "v1" });
    expect(hook.result.current).toEqual({ kind: "loading" });
    await advance(WHATSAPP_QUOTE_DEBOUNCE_MS);
    expect(pending).toHaveLength(2);
    expect(pending[1]!.body).toEqual(pending[0]!.body);
    expect(hook.result.current).toEqual({ kind: "loading" });

    // B fails: still no link, and certainly not A's.
    await answer(1, { error: "unavailable" }, 503);
    expect(hook.result.current).toEqual({ kind: "error", code: "unavailable" });

    // A later valid answer B is the one shown.
    await advance(WHATSAPP_QUOTE_REFRESH_MS);
    await answer(2, B);
    expect(urlOf(hook.result.current)).toBe(B.url);
  });

  it("drops quote A when only the freshness changes (new price or promotion, same request)", async () => {
    const hook = render({ request, freshness: "catalog-1" });
    await advance(WHATSAPP_QUOTE_DEBOUNCE_MS);
    await answer(0, A);

    hook.rerender({ request, freshness: "catalog-2" });
    expect(hook.result.current).toEqual({ kind: "loading" });
    await advance(WHATSAPP_QUOTE_DEBOUNCE_MS);
    await answer(1, B);
    expect(hook.result.current).toMatchObject({ kind: "ready", checkout: { url: B.url, totalCents: 850000n } });

    // Back to the first freshness value: still a new POST, never A from memory.
    hook.rerender({ request, freshness: "catalog-1" });
    expect(hook.result.current).toEqual({ kind: "loading" });
    await advance(WHATSAPP_QUOTE_DEBOUNCE_MS);
    expect(pending).toHaveLength(3);
  });

  it("stops offering the shown link as soon as a refresh starts, and keeps none if it fails", async () => {
    const hook = render({ request, freshness: "v1" });
    await advance(WHATSAPP_QUOTE_DEBOUNCE_MS);
    await answer(0, A);
    expect(urlOf(hook.result.current)).toBe(A.url);

    await advance(WHATSAPP_QUOTE_REFRESH_MS);
    expect(pending).toHaveLength(2);
    expect(hook.result.current).toEqual({ kind: "loading" });

    await answer(1, { error: "store_closed" }, 409);
    expect(hook.result.current).toEqual({ kind: "error", code: "store_closed" });
  });

  it("applies only the latest request's answer", async () => {
    const hook = render({ request, freshness: "v1" });
    await advance(WHATSAPP_QUOTE_DEBOUNCE_MS);
    // A refresh supersedes the first request before it answers.
    await advance(WHATSAPP_QUOTE_REFRESH_MS);
    expect(pending).toHaveLength(2);

    await answer(1, B);
    expect(urlOf(hook.result.current)).toBe(B.url);
    // The superseded request was aborted; even if its server answered, it cannot replace B.
    await answer(0, A);
    expect(urlOf(hook.result.current)).toBe(B.url);
  });

  it("fails closed when the server does not answer in time", async () => {
    const hook = render({ request, freshness: "v1" });
    await advance(WHATSAPP_QUOTE_DEBOUNCE_MS);
    expect(hook.result.current).toEqual({ kind: "loading" });

    await advance(WHATSAPP_QUOTE_TIMEOUT_MS);
    expect(hook.result.current).toEqual({ kind: "error", code: "unavailable" });
  });

  it("rejects an answer that is not a wa.me link with cent amounts", async () => {
    const hook = render({ request, freshness: "v1" });
    await advance(WHATSAPP_QUOTE_DEBOUNCE_MS);
    await answer(0, { ...A, url: "https://evil.example/?text=A" });
    expect(hook.result.current).toEqual({ kind: "error", code: "unavailable" });

    await advance(WHATSAPP_QUOTE_REFRESH_MS);
    await answer(1, { ...A, totalCents: "7800.50" });
    expect(hook.result.current).toEqual({ kind: "error", code: "unavailable" });
  });

  it("sends nothing while there is no request", async () => {
    const hook = render({ request: null, freshness: "v1" });
    await advance(WHATSAPP_QUOTE_REFRESH_MS * 2);
    expect(pending).toEqual([]);
    expect(hook.result.current).toEqual({ kind: "idle" });
  });
});
