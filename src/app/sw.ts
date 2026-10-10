/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { NetworkOnly, Serwist } from "serwist";
import { isSensitiveRuntimeRequest } from "./sw-routes";

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
    // Auth/Admin (BB-11), store status (BB-08), promotions (BB-09), fresh catalog (BB-06)
    // and checkout (BB-10) always come from the server: never answer them from a cache.
    {
      matcher: isSensitiveRuntimeRequest,
      handler: new NetworkOnly()
    },
    ...defaultCache
  ]
});

serwist.addEventListeners();
