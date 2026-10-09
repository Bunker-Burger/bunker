"use client";

import { useEffect, useState } from "react";
import { parsePublicStoreStatus, type PublicStoreStatus } from "@/domain/store-status";

export const STORE_STATUS_ENDPOINT = "/api/store/status";

/** How often an open page re-reads the status, so a pause or closure reaches it without a reload. */
export const STORE_STATUS_REFRESH_MS = 60_000;
/** A status read that takes longer than this is treated as unavailable (fail closed). */
export const STORE_STATUS_TIMEOUT_MS = 10_000;

export type StoreStatusView =
  | { kind: "loading" }
  | { kind: "unavailable" }
  /** `checking`: a re-read is in flight; the last answer is still shown but authorizes nothing. */
  | { kind: "ready"; status: PublicStoreStatus; checking: boolean };

/** Whether the server's last answer, already confirmed (not mid re-read), accepts orders. */
export function acceptsOrdersNow(view: StoreStatusView): boolean {
  return view.kind === "ready" && !view.checking && view.status.acceptingOrders;
}

/**
 * Reads the server's decision from the public status endpoint, for display only. Browsing and
 * the cart never wait for it; any failure or timeout is shown as "could not verify", never as
 * open. Re-read every minute and when the tab regains focus or visibility; while a re-read is in
 * flight the last answer is marked `checking`, so it cannot authorize an order.
 */
export function useStoreStatus(): StoreStatusView {
  const [view, setView] = useState<StoreStatusView>({ kind: "loading" });

  useEffect(() => {
    let controller: AbortController | null = null;
    let disposed = false;

    const read = () => {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      let timedOut = false;
      const timeout = window.setTimeout(() => {
        timedOut = true;
        current.abort();
      }, STORE_STATUS_TIMEOUT_MS);
      fetch(STORE_STATUS_ENDPOINT, { cache: "no-store", signal: current.signal })
        .then(async (response) => {
          const status = response.ok ? parsePublicStoreStatus(await response.json()) : null;
          if (controller !== current || disposed) return;
          setView(status ? { kind: "ready", status, checking: false } : { kind: "unavailable" });
        })
        .catch(() => {
          // Superseded or unmounted reads say nothing; a timeout or network failure fails closed.
          if (controller !== current || disposed) return;
          if (timedOut || !current.signal.aborted) setView({ kind: "unavailable" });
        })
        .finally(() => window.clearTimeout(timeout));
    };
    const refresh = () => {
      setView((previous) => (previous.kind === "ready" ? { ...previous, checking: true } : previous));
      read();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };

    read();
    const timer = window.setInterval(refresh, STORE_STATUS_REFRESH_MS);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", refresh);
    return () => {
      disposed = true;
      controller?.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  return view;
}

function timeOfDay(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("es-AR", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

function weekday(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("es-AR", { timeZone, weekday: "long" }).format(new Date(iso));
}

/** One sentence explaining whether orders are accepted right now. */
export function describeStoreStatus(view: StoreStatusView): string {
  if (view.kind === "loading") return "Verificando si el local está tomando pedidos…";
  if (view.kind === "unavailable") return "No pudimos verificar si el local está tomando pedidos.";
  const { status } = view;
  switch (status.reason) {
    case "manual_paused":
      return "El local pausó los pedidos por un momento.";
    case "manual_closed":
      return "El local está cerrado.";
    case "delivery_fee_missing":
      return "El local todavía no habilitó los pedidos.";
    case "manual_open":
      return "El local está abierto.";
    case "schedule":
      if (status.acceptingOrders) {
        return status.closesAt ? `El local está abierto hasta las ${timeOfDay(status.closesAt, status.timezone)}.` : "El local está abierto.";
      }
      return status.nextOpeningAt
        ? `El local está cerrado. Abre el ${weekday(status.nextOpeningAt, status.timezone)} a las ${timeOfDay(status.nextOpeningAt, status.timezone)}.`
        : "El local está cerrado.";
  }
}
