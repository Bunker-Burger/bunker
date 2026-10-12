import type { StoreState, StoreStatus } from "@/domain/store-status";

/* Wording of the store status, shared by the store screen and the control panel. */

export const STATE_LABEL: Record<StoreState, string> = { open: "Abierto", paused: "Pausado", closed: "Cerrado" };

export const REASON: Record<StoreStatus["reason"], string> = {
  schedule: "según los horarios",
  manual_open: "abierto manualmente",
  manual_paused: "pausado manualmente",
  manual_closed: "cerrado manualmente",
  delivery_fee_missing: "sin tarifa de delivery: los pedidos están deshabilitados"
};

export const OVERRIDE_OPTIONS = [
  { value: "auto", label: "Seguir los horarios" },
  { value: "open", label: "Abierto (ignora los horarios)" },
  { value: "paused", label: "Pausado" },
  { value: "closed", label: "Cerrado" }
] as const;

/** "miércoles 00:00" in the store's time zone. */
export function when(date: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("es-AR", { timeZone, weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map((part) => [part.type, part.value])
  );
  return `${parts.weekday} ${parts.hour}:${parts.minute}`;
}

/** "según los horarios · próximo turno: jueves 20:00". */
export function statusReason(status: StoreStatus, timeZone: string) {
  return [
    REASON[status.reason],
    status.closesAt ? `cierra el ${when(status.closesAt, timeZone)}` : null,
    status.nextOpeningAt ? `próximo turno: ${when(status.nextOpeningAt, timeZone)}` : null
  ]
    .filter(Boolean)
    .join(" · ");
}
