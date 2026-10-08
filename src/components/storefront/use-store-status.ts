"use client";

import { useEffect, useState } from "react";
import { parsePublicStoreStatus, type PublicStoreStatus } from "@/domain/store-status";

export const STORE_STATUS_ENDPOINT = "/api/store/status";

export type StoreStatusView =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "ready"; status: PublicStoreStatus };

/**
 * Reads the server's decision from the public status endpoint, for display only. Browsing and
 * the cart never wait for it; any failure is shown as "could not verify", never as open.
 */
export function useStoreStatus(): StoreStatusView {
  const [view, setView] = useState<StoreStatusView>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetch(STORE_STATUS_ENDPOINT, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const status = response.ok ? parsePublicStoreStatus(await response.json()) : null;
        setView(status ? { kind: "ready", status } : { kind: "unavailable" });
      })
      .catch(() => {
        if (!controller.signal.aborted) setView({ kind: "unavailable" });
      });
    return () => controller.abort();
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
