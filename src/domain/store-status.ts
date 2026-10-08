import type { FulfilmentMethod } from "./types";

/** Manual switch configured by the store: `auto` follows the weekly hours. */
export type StoreStatusOverride = "auto" | "open" | "paused" | "closed";

/**
 * Weekly shift in the store time zone. `dayOfWeek` (0 = Sunday … 6 = Saturday) is the day the
 * shift opens; a `closesAt` not after `opensAt` closes the next day ("00:00" = at midnight).
 */
export interface BusinessHoursWindow {
  dayOfWeek: number;
  /** Local wall-clock time, "HH:MM" or "HH:MM:SS". */
  opensAt: string;
  closesAt: string;
}

export interface StoreOperatingSettings {
  timezone: string;
  statusOverride: StoreStatusOverride;
  /** Fixed delivery fee; null while it is not configured, which keeps orders disabled. */
  deliveryFeeCents: bigint | null;
  businessHours: readonly BusinessHoursWindow[];
}

export type StoreState = "open" | "paused" | "closed";

export type StoreStatusReason =
  | "schedule"
  | "manual_open"
  | "manual_paused"
  | "manual_closed"
  | "delivery_fee_missing";

export interface StoreStatus {
  state: StoreState;
  /** Whether payment and order submission are allowed right now. Browsing never depends on it. */
  acceptingOrders: boolean;
  reason: StoreStatusReason;
  /** End of the current shift, when open by schedule. */
  closesAt: Date | null;
  /** Start of the next shift, when closed by schedule and hours are configured. */
  nextOpeningAt: Date | null;
  deliveryFeeCents: bigint | null;
  timezone: string;
}

export class StoreNotAcceptingOrdersError extends Error {
  constructor(readonly status: StoreStatus) {
    super(`El local no está tomando pedidos (${status.reason})`);
    this.name = "StoreNotAcceptingOrdersError";
  }
}

const WALL_CLOCK = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
const DAY_MS = 86_400_000;
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Seconds since local midnight for "HH:MM[:SS]"; throws on anything else. */
export function wallClockSeconds(value: string): number {
  const match = WALL_CLOCK.exec(value);
  if (!match) throw new RangeError(`Invalid wall-clock time: ${value}`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0);
}

interface LocalDateTime {
  /** Local calendar date as a UTC midnight timestamp (a pure date, no zone). */
  dateMs: number;
  dayOfWeek: number;
}

function localDateTime(instantMs: number, timeZone: string): LocalDateTime & { wallMs: number } {
  const parts: Record<string, string> = {};
  for (const part of formatterFor(timeZone).formatToParts(new Date(instantMs))) parts[part.type] = part.value;
  const dateMs = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  const seconds = Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second);
  return { dateMs, dayOfWeek: WEEKDAYS[parts.weekday ?? ""] ?? 0, wallMs: dateMs + seconds * 1000 };
}

/** Local wall clock minus UTC at an instant, in ms (whole seconds; sub-second offsets do not exist here). */
function offsetAt(instantMs: number, timeZone: string): number {
  const flooredMs = Math.floor(instantMs / 1000) * 1000;
  return localDateTime(flooredMs, timeZone).wallMs - flooredMs;
}

/**
 * Instant of a local wall-clock time in a time zone. Repeated times (clocks set back) resolve
 * to the earlier instant; skipped times (clocks set forward) move forward by the gap, like
 * Temporal's "compatible" disambiguation.
 */
export function zonedInstant(dateMs: number, seconds: number, timeZone: string): number {
  const wallMs = dateMs + seconds * 1000;
  const before = offsetAt(wallMs - DAY_MS, timeZone);
  const after = offsetAt(wallMs + DAY_MS, timeZone);
  const valid = [wallMs - before, wallMs - after].filter((candidate) => candidate + offsetAt(candidate, timeZone) === wallMs);
  if (valid.length > 0) return Math.min(...valid);
  return wallMs - before;
}

interface Interval {
  start: number;
  end: number;
}

/** Concrete shifts from the day before `now` to a week after it, merged where they touch. */
function shiftsAround(nowMs: number, settings: StoreOperatingSettings): Interval[] {
  const today = localDateTime(nowMs, settings.timezone);
  const shifts: Interval[] = [];
  for (let offset = -1; offset <= 7; offset += 1) {
    const dateMs = today.dateMs + offset * DAY_MS;
    const dayOfWeek = (((today.dayOfWeek + offset) % 7) + 7) % 7;
    for (const window of settings.businessHours) {
      if (window.dayOfWeek !== dayOfWeek) continue;
      const opens = wallClockSeconds(window.opensAt);
      const closes = wallClockSeconds(window.closesAt);
      if (opens === closes) continue;
      const start = zonedInstant(dateMs, opens, settings.timezone);
      const end = zonedInstant(closes > opens ? dateMs : dateMs + DAY_MS, closes, settings.timezone);
      if (end > start) shifts.push({ start, end });
    }
  }
  shifts.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Interval[] = [];
  for (const shift of shifts) {
    const last = merged.at(-1);
    if (last && shift.start <= last.end) last.end = Math.max(last.end, shift.end);
    else merged.push({ ...shift });
  }
  return merged;
}

/**
 * Authoritative store status at `now`. The delivery fee gates everything: without it orders
 * stay disabled even when forced open. Manual overrides win over the weekly hours.
 */
export function evaluateStoreStatus(settings: StoreOperatingSettings, now: Date): StoreStatus {
  const base = { deliveryFeeCents: settings.deliveryFeeCents, timezone: settings.timezone, closesAt: null, nextOpeningAt: null };

  if (settings.statusOverride === "paused") return { ...base, state: "paused", acceptingOrders: false, reason: "manual_paused" };
  if (settings.statusOverride === "closed") return { ...base, state: "closed", acceptingOrders: false, reason: "manual_closed" };
  if (settings.deliveryFeeCents === null || settings.deliveryFeeCents < 0n) {
    return { ...base, deliveryFeeCents: null, state: "closed", acceptingOrders: false, reason: "delivery_fee_missing" };
  }
  if (settings.statusOverride === "open") return { ...base, state: "open", acceptingOrders: true, reason: "manual_open" };

  const nowMs = now.getTime();
  const shifts = shiftsAround(nowMs, settings);
  const current = shifts.find((shift) => shift.start <= nowMs && nowMs < shift.end);
  if (current) return { ...base, state: "open", acceptingOrders: true, reason: "schedule", closesAt: new Date(current.end) };

  const next = shifts.find((shift) => shift.start > nowMs);
  return { ...base, state: "closed", acceptingOrders: false, reason: "schedule", nextOpeningAt: next ? new Date(next.start) : null };
}

/** Throws unless the store is taking orders. Use before quoting, paying or sending an order. */
export function assertAcceptingOrders(status: StoreStatus): asserts status is StoreStatus & { deliveryFeeCents: bigint } {
  if (!status.acceptingOrders || status.deliveryFeeCents === null) throw new StoreNotAcceptingOrdersError(status);
}

/** Delivery charge for one order: the fixed fee once for delivery, nothing for pickup. */
export function deliveryChargeCents(status: StoreStatus, fulfilment: FulfilmentMethod): bigint {
  assertAcceptingOrders(status);
  return fulfilment === "delivery" ? status.deliveryFeeCents : 0n;
}

/** Minimal public shape: no hours table, no override details beyond the reason. Money as string. */
export interface PublicStoreStatus {
  state: StoreState;
  acceptingOrders: boolean;
  reason: StoreStatusReason;
  closesAt: string | null;
  nextOpeningAt: string | null;
  deliveryFeeCents: string | null;
  timezone: string;
}

export function toPublicStoreStatus(status: StoreStatus): PublicStoreStatus {
  return {
    state: status.state,
    acceptingOrders: status.acceptingOrders,
    reason: status.reason,
    closesAt: status.closesAt?.toISOString() ?? null,
    nextOpeningAt: status.nextOpeningAt?.toISOString() ?? null,
    deliveryFeeCents: status.deliveryFeeCents?.toString() ?? null,
    timezone: status.timezone
  };
}

const STATES: readonly StoreState[] = ["open", "paused", "closed"];
const REASONS: readonly StoreStatusReason[] = ["schedule", "manual_open", "manual_paused", "manual_closed", "delivery_fee_missing"];
const isoOrNull = (value: unknown) => value === null || (typeof value === "string" && !Number.isNaN(Date.parse(value)));

/** Validates a `GET /api/store/status` body; anything else (errors included) yields null. */
export function parsePublicStoreStatus(value: unknown): PublicStoreStatus | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  const valid =
    STATES.includes(candidate.state as StoreState) &&
    typeof candidate.acceptingOrders === "boolean" &&
    REASONS.includes(candidate.reason as StoreStatusReason) &&
    isoOrNull(candidate.closesAt) &&
    isoOrNull(candidate.nextOpeningAt) &&
    (candidate.deliveryFeeCents === null || (typeof candidate.deliveryFeeCents === "string" && /^\d+$/.test(candidate.deliveryFeeCents))) &&
    typeof candidate.timezone === "string" &&
    isValidTimeZone(candidate.timezone);
  return valid ? (candidate as unknown as PublicStoreStatus) : null;
}
