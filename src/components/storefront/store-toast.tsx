"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";

/** How long a confirmation stays on screen (issue #54: brief and consistent, 3–5 s). */
export const TOAST_DURATION_MS = 4000;
/** A cart that changed by itself says more, so it gets a little longer. */
export const LONG_TOAST_DURATION_MS = 8000;

export interface ToastMessage {
  text: string;
  /** Changes on every new message, so the same text twice restarts the timer. */
  key: number;
  /** null: a state that lasts while it is true (e.g. "Buscando el producto…"), never timed out. */
  durationMs: number | null;
}

/**
 * The storefront's single notice, at the bottom above the cart tray and the bottom nav, never over
 * the header. The live region is always in the page so each message is announced once; a timed
 * message dismisses itself, pauses while hovered or focused and can be closed by hand. It never
 * blocks taps on what is behind it except on its own card.
 */
export function StoreToast({ message, onDismiss }: { message: ToastMessage | null; onDismiss: () => void }) {
  const onDismissRef = useRef(onDismiss);
  const remaining = useRef(0);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paused = useRef(false);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const start = () => {
    stop();
    startedAt.current = Date.now();
    timer.current = setTimeout(() => onDismissRef.current(), remaining.current);
  };

  const key = message?.key;
  const durationMs = message?.durationMs ?? null;
  // Each new message gets the full time, counted only while the toast is not hovered or focused.
  useEffect(() => {
    if (key === undefined || durationMs === null) return;
    remaining.current = durationMs;
    // A card removed while hovered or focused never reports leaving: a new message starts unpaused.
    paused.current = false;
    startedAt.current = Date.now();
    timer.current = setTimeout(() => onDismissRef.current(), durationMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [key, durationMs]);

  const pause = () => {
    if (paused.current) return;
    paused.current = true;
    if (!timer.current) return;
    stop();
    remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
  };
  const resume = () => {
    if (!paused.current) return;
    paused.current = false;
    if (message && message.durationMs !== null) start();
  };

  return (
    <div aria-live="polite" className="store-toast-region" role="status">
      {message ? (
        <div
          className="store-toast"
          key={message.key}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) resume();
          }}
          onFocus={pause}
          onMouseEnter={pause}
          onMouseLeave={resume}
        >
          <p>{message.text}</p>
          {message.durationMs !== null ? (
            <button aria-label="Cerrar aviso" className="store-toast-close" onClick={() => onDismissRef.current()} type="button">
              <X aria-hidden="true" size={16} />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
