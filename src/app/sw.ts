/// <reference lib="webworker" />
import type { PrecacheEntry, RouteMatchCallbackOptions, SerwistGlobalConfig, SerwistPlugin } from "serwist";
import { CacheFirst, ExpirationPlugin, NetworkFirst, NetworkOnly, Serwist, StaleWhileRevalidate } from "serwist";
import { isCacheKeptOnActivation, OFFLINE_PATH, RUNTIME_CACHES, runtimePolicy, type RuntimePolicy } from "./sw-routes";

/*
 * BB-16 caching strategy. Every policy decision lives in `sw-routes.ts` (unit tested):
 * - NetworkOnly: Admin/auth, every API (checkout, status, promotions, catalog), RSC payloads,
 *   Server Actions and any route not listed below.
 * - NetworkFirst: the public menu document, so it opens offline with what was last seen.
 * - StaleWhileRevalidate: images. CacheFirst: `/_next/static` (content-hashed).
 * - Offline: documents that cannot be fetched fall back to the precached public `/offline` page.
 *
 * Updates: a new worker waits until the page asks for it (`SKIP_WAITING`, sent when the person
 * accepts the update) and then deletes the cached menu documents, which point at the previous
 * build's assets, so an old shell never runs against new assets.
 */
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const DAY = 24 * 60 * 60;

/** Only complete, successful answers are stored: never an error page, a redirect or an opaque response. */
const onlyOk: SerwistPlugin = { cacheWillUpdate: async ({ response }) => (response.status === 200 ? response : null) };

const is =
  (policy: RuntimePolicy) =>
  ({ request, url, sameOrigin }: RouteMatchCallbackOptions) =>
    runtimePolicy({ request, url, sameOrigin }) === policy;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST ?? [],
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    { matcher: is("network-only"), handler: new NetworkOnly() },
    {
      matcher: is("public-page"),
      handler: new NetworkFirst({
        cacheName: RUNTIME_CACHES.pages,
        networkTimeoutSeconds: 4,
        plugins: [onlyOk, new ExpirationPlugin({ maxEntries: 8, maxAgeSeconds: 7 * DAY })]
      })
    },
    {
      matcher: is("image"),
      handler: new StaleWhileRevalidate({
        cacheName: RUNTIME_CACHES.images,
        plugins: [onlyOk, new ExpirationPlugin({ maxEntries: 120, maxAgeSeconds: 30 * DAY })]
      })
    },
    {
      matcher: is("hashed-asset"),
      handler: new CacheFirst({
        cacheName: RUNTIME_CACHES.static,
        plugins: [onlyOk, new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 365 * DAY })]
      })
    }
  ],
  fallbacks: {
    entries: [{ url: OFFLINE_PATH, matcher: ({ request }) => request.destination === "document" }]
  }
});

// Leftovers from earlier workers (BB-02's default caches stored RSC and API answers) and the menu
// documents of the previous build go away when this version takes over.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(names.filter((name) => !isCacheKeptOnActivation(name)).map((name) => caches.delete(name))))
  );
});

serwist.addEventListeners();
