"use client";

import { useMemo, useSyncExternalStore } from "react";

// Keys that scroll the page; pressing one means the user, not a link, now drives the position.
const SCROLL_KEYS = new Set(["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "]);

/**
 * Tracks which in-page section is current, by id.
 * - Activating a `#id` link (or back/forward to it) selects that section, even when the page
 *   cannot scroll far enough to bring it to the top.
 * - Once the user scrolls by hand, the section crossing the upper third of the viewport wins
 *   (the last one when the page is scrolled to the bottom).
 * Server render and hydration always use the first id, so markup stays stable.
 */
export function createActiveSectionStore(ids: readonly string[]) {
  const fallback = ids[0] ?? "";
  let current = fallback;
  let followLink = false;
  const listeners = new Set<() => void>();

  const set = (id: string) => {
    if (id === current) return;
    current = id;
    listeners.forEach((listener) => listener());
  };

  const fromHash = () => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!ids.includes(id)) return false;
    followLink = true;
    set(id);
    return true;
  };

  const fromScroll = () => {
    if (followLink) return;
    const { scrollY, innerHeight } = window;
    const atBottom = scrollY > 0 && innerHeight + scrollY >= document.documentElement.scrollHeight - 2;
    if (atBottom) return set(ids[ids.length - 1] ?? fallback);
    const line = innerHeight / 3;
    let active = fallback;
    for (const id of ids) {
      const element = document.getElementById(id);
      if (element && element.getBoundingClientRect().top <= line) active = id;
    }
    set(active);
  };

  let frame = 0;
  const onScroll = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(fromScroll);
  };
  const onUserScroll = () => {
    followLink = false;
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (SCROLL_KEYS.has(event.key)) onUserScroll();
  };
  const onClick = (event: MouseEvent) => {
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href^='#']") : null;
    const id = link ? decodeURIComponent(link.hash.slice(1)) : "";
    if (!ids.includes(id)) return;
    followLink = true;
    set(id);
  };

  return {
    getSnapshot: () => current,
    getServerSnapshot: () => fallback,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) {
        fromHash();
        window.addEventListener("hashchange", fromHash);
        window.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("wheel", onUserScroll, { passive: true });
        window.addEventListener("touchmove", onUserScroll, { passive: true });
        window.addEventListener("keydown", onKeyDown);
        document.addEventListener("click", onClick);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0) return;
        cancelAnimationFrame(frame);
        window.removeEventListener("hashchange", fromHash);
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("wheel", onUserScroll);
        window.removeEventListener("touchmove", onUserScroll);
        window.removeEventListener("keydown", onKeyDown);
        document.removeEventListener("click", onClick);
      };
    }
  };
}

/** `ids` must be referentially stable (e.g. a module-level constant). */
export function useActiveSection(ids: readonly string[]): string {
  const store = useMemo(() => createActiveSectionStore(ids), [ids]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}
