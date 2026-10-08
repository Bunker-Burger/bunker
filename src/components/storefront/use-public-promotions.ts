"use client";

import { useEffect, useState } from "react";
import { parsePublicPromotions, type PublicPromotion } from "@/domain/public-promotions";

export const PROMOTIONS_ENDPOINT = "/api/store/promotions";

/** How often the open menu re-reads the rules, so a pause or edit reaches it without a reload. */
export const PROMOTIONS_REFRESH_MS = 60_000;

const NONE: readonly PublicPromotion[] = [];

/**
 * Promotion rules the server currently publishes (the same fresh read the quote uses), for
 * display only. Until the first answer arrives, and after any failure, there are none: the menu
 * never advertises a discount it could not confirm. Re-read every minute and when the tab
 * becomes visible again.
 */
export function usePublicPromotions(): readonly PublicPromotion[] {
  const [promotions, setPromotions] = useState(NONE);

  useEffect(() => {
    let controller: AbortController | null = null;
    const load = () => {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      fetch(PROMOTIONS_ENDPOINT, { cache: "no-store", signal: current.signal })
        .then(async (response) => {
          const parsed = response.ok ? parsePublicPromotions(await response.json()) : null;
          if (!current.signal.aborted) setPromotions(parsed ?? NONE);
        })
        .catch(() => {
          if (!current.signal.aborted) setPromotions(NONE);
        });
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") load();
    };

    load();
    const timer = window.setInterval(load, PROMOTIONS_REFRESH_MS);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      controller?.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return promotions;
}
