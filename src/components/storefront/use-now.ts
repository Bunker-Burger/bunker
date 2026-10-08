"use client";

import { useSyncExternalStore } from "react";

const MINUTE = 60_000;

function subscribe(listener: () => void) {
  const timer = window.setInterval(listener, MINUTE);
  return () => window.clearInterval(timer);
}

const currentMinute = () => Math.floor(Date.now() / MINUTE) * MINUTE;

/**
 * Current time, refreshed every minute, or null while server rendering and hydrating, so
 * time-dependent content (promotion windows) never causes a hydration mismatch.
 */
export function useNow(): Date | null {
  const minute = useSyncExternalStore(subscribe, currentMinute, () => null);
  return minute === null ? null : new Date(minute);
}
