import { wallClockSeconds, zonedInstant, type BusinessHoursWindow } from "./store-status";

/*
 * Pure helpers for the store administration screens: weekly shifts that must not overlap, and
 * the conversion between a `datetime-local` value typed in the store's time zone and an instant.
 */

const WEEK_MINUTES = 7 * 24 * 60;

/** [start, end) in minutes since Sunday 00:00; a shift that crosses midnight ends the next day. */
function weeklyInterval(window: BusinessHoursWindow): { start: number; end: number } {
  const opens = Math.floor(wallClockSeconds(window.opensAt) / 60);
  const closes = Math.floor(wallClockSeconds(window.closesAt) / 60);
  const start = window.dayOfWeek * 24 * 60 + opens;
  const length = closes > opens ? closes - opens : 24 * 60 - opens + closes;
  return { start, end: start + length };
}

/**
 * The existing shift `candidate` would overlap, if any (touching ends do not overlap). The week
 * wraps: a Saturday shift until 02:00 overlaps a Sunday shift from 01:00.
 */
export function findOverlappingShift<W extends BusinessHoursWindow>(existing: readonly W[], candidate: BusinessHoursWindow): W | null {
  const next = weeklyInterval(candidate);
  for (const window of existing) {
    const current = weeklyInterval(window);
    for (const shift of [-WEEK_MINUTES, 0, WEEK_MINUTES]) {
      if (next.start < current.end + shift && current.start + shift < next.end) return window;
    }
  }
  return null;
}

const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** "2026-10-10T19:30" typed in `timeZone` → the instant it names; null when malformed. */
export function instantFromLocalInput(value: string, timeZone: string): Date | null {
  const match = LOCAL_INPUT.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number) as [number, number, number, number, number, number];
  if (month < 1 || month > 12 || hour > 23 || minute > 59) return null;
  const dateMs = Date.UTC(year, month - 1, day);
  const date = new Date(dateMs);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return new Date(zonedInstant(dateMs, hour * 3600 + minute * 60, timeZone));
}

/** An instant as the `datetime-local` value ("YYYY-MM-DDTHH:MM") it shows in `timeZone`. */
export function localInputFromInstant(instant: Date, timeZone: string): string {
  const parts: Record<string, string> = {};
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
  for (const part of formatter.formatToParts(instant)) parts[part.type] = part.value;
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
