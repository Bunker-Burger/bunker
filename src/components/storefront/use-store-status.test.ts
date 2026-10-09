import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicStoreStatus } from "@/domain/store-status";
import {
  acceptsOrdersNow,
  STORE_STATUS_ENDPOINT,
  STORE_STATUS_REFRESH_MS,
  STORE_STATUS_TIMEOUT_MS,
  useStoreStatus
} from "./use-store-status";

/*
 * BB-10 review round 1 (P1 B): the store status is re-read periodically and on focus/visibility;
 * while a re-read is in flight it authorizes nothing, and a pause, closure, error or hang reached
 * between two reads ends the ability to send.
 */

const TIMEZONE = "America/Argentina/Tucuman";
const open: PublicStoreStatus = { state: "open", acceptingOrders: true, reason: "manual_open", closesAt: null, nextOpeningAt: null, deliveryFeeCents: "120000", timezone: TIMEZONE };
const paused: PublicStoreStatus = { ...open, state: "paused", acceptingOrders: false, reason: "manual_paused" };

let pending: Array<(response: Response) => void>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.useFakeTimers();
  pending = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
      expect(String(input)).toBe(STORE_STATUS_ENDPOINT);
      expect(init.cache).toBe("no-store");
      return new Promise<Response>((resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        pending.push(resolve);
      });
    })
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function answer(index: number, body: unknown, status = 200) {
  await act(async () => {
    pending[index]!(json(body, status));
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useStoreStatus", () => {
  it("re-reads periodically, authorizes nothing while re-reading, and follows a pause", async () => {
    const hook = renderHook(() => useStoreStatus());
    await answer(0, open);
    expect(acceptsOrdersNow(hook.result.current)).toBe(true);

    await advance(STORE_STATUS_REFRESH_MS);
    expect(pending).toHaveLength(2);
    // The last answer is still displayed, but cannot authorize an order mid re-read.
    expect(hook.result.current).toMatchObject({ kind: "ready", checking: true, status: { acceptingOrders: true } });
    expect(acceptsOrdersNow(hook.result.current)).toBe(false);

    await answer(1, paused);
    expect(hook.result.current).toEqual({ kind: "ready", status: paused, checking: false });
    expect(acceptsOrdersNow(hook.result.current)).toBe(false);
  });

  it.each([
    ["focus", () => window.dispatchEvent(new Event("focus"))],
    ["visibility", () => document.dispatchEvent(new Event("visibilitychange"))]
  ])("re-reads on %s", async (_case, trigger) => {
    const hook = renderHook(() => useStoreStatus());
    await answer(0, open);
    act(trigger);
    expect(pending).toHaveLength(2);
    expect(acceptsOrdersNow(hook.result.current)).toBe(false);
    await answer(1, open);
    expect(acceptsOrdersNow(hook.result.current)).toBe(true);
  });

  it("fails closed on an error between two reads", async () => {
    const hook = renderHook(() => useStoreStatus());
    await answer(0, open);
    await advance(STORE_STATUS_REFRESH_MS);
    await answer(1, { acceptingOrders: false, error: "unavailable" }, 503);
    expect(hook.result.current).toEqual({ kind: "unavailable" });
  });

  it("fails closed when a read hangs", async () => {
    const hook = renderHook(() => useStoreStatus());
    await answer(0, open);
    await advance(STORE_STATUS_REFRESH_MS);
    await advance(STORE_STATUS_TIMEOUT_MS);
    expect(hook.result.current).toEqual({ kind: "unavailable" });
  });

  it("ignores a superseded read", async () => {
    const hook = renderHook(() => useStoreStatus());
    act(() => window.dispatchEvent(new Event("focus")));
    expect(pending).toHaveLength(2);
    await answer(1, paused);
    // The first read was aborted when the second started; it can no longer report "open".
    await answer(0, open);
    expect(hook.result.current).toEqual({ kind: "ready", status: paused, checking: false });
  });
});
