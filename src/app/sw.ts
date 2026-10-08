/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { NetworkOnly, Serwist } from "serwist";

// Minimal worker so the production build is installable; BB-16 owns the final caching strategy.
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST ?? [],
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // Store status (BB-08) and promotions (BB-09) must always come from the server: never
    // answer them from a cache.
    {
      matcher: ({ sameOrigin, url: { pathname } }) =>
        sameOrigin && (pathname === "/api/store/status" || pathname === "/api/store/promotions"),
      handler: new NetworkOnly()
    },
    // Administration (BB-11) is never available offline nor kept after signing out.
    {
      matcher: ({ sameOrigin, url: { pathname } }) => sameOrigin && (pathname === "/bunker" || pathname.startsWith("/bunker/")),
      handler: new NetworkOnly()
    },
    ...defaultCache
  ]
});

serwist.addEventListeners();
