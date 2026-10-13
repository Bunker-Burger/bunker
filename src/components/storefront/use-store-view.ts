"use client";

import { useSyncExternalStore } from "react";

export const STORE_VIEWS = ["menu", "carrito", "checkout"] as const;
export type StoreView = (typeof STORE_VIEWS)[number];

function viewFromHash(): StoreView {
  const hash = decodeURIComponent(window.location.hash.slice(1));
  return (STORE_VIEWS as readonly string[]).includes(hash) ? (hash as StoreView) : "menu";
}

function subscribe(listener: () => void) {
  window.addEventListener("hashchange", listener);
  window.addEventListener("popstate", listener);
  return () => {
    window.removeEventListener("hashchange", listener);
    window.removeEventListener("popstate", listener);
  };
}

/**
 * The storefront screen on show, as in the canonical captures (issue #54): the menu, the cart or
 * the checkout, one at a time. `/` stays a single page; the URL hash (`#menu`, `#carrito`,
 * `#checkout`) picks the screen, so the bottom nav, Back/Forward and shared links all work.
 * Server render and hydration always show the menu.
 */
export function useStoreView(): StoreView {
  return useSyncExternalStore(subscribe, viewFromHash, () => "menu");
}
