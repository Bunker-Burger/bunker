"use client";

import { useSyncExternalStore } from "react";

const MINUTE = 60_000;

function subscribe(listener: () => void) {
  const timer = window.setInterval(listener, MINUTE);
  return () => window.clearInterval(timer);
}

const currentMinute = () => Math.floor(Date.now() / MINUTE) * MINUTE;

/**
 * Current time, refreshed every minute. While server rendering and hydrating it is `renderedAt`
 * (the minute the server rendered the page) or null without it, so time-dependent content
 * (promotion windows) is the same on both sides and never causes a hydration mismatch.
 */
export function useNow(renderedAt: number | null = null): Date | null {
  const minute = useSyncExternalStore(subscribe, currentMinute, () => renderedAt);
  return minute === null ? null : new Date(minute);
}
