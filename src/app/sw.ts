/// <reference lib="webworker" />
import type { PrecacheEntry, RouteMatchCallbackOptions, SerwistGlobalConfig, SerwistPlugin } from "serwist";
import { CacheFirst, ExpirationPlugin, NetworkFirst, NetworkOnly, Serwist, StaleWhileRevalidate } from "serwist";
import {
  isCacheableImage,
  isCacheableMenuDocument,
  isCacheKeptOnActivation,
  OFFLINE_PATH,
  publicImageOrigin,
  RUNTIME_CACHES,
  runtimePolicy,
  type RuntimePolicy
} from "./sw-routes";

/*
 * BB-16 caching strategy. Every policy decision lives in `sw-routes.ts` (unit tested):
 * - NetworkOnly: Admin/auth, every API (checkout, status, promotions, catalog), RSC payloads,
 *   Server Actions and any route not listed below.
 * - NetworkFirst: the public menu document, so it opens offline with what was last seen. The
 *   first visit's document arrives before the worker exists, so activation stores an anonymous
 *   copy of `/` right away (no reload needed to have the menu offline).
 * - StaleWhileRevalidate: images, including the product photos of the public `catalog` bucket of
 *   this build's Supabase project (fetched with CORS and no credentials, never stored opaque).
 *   CacheFirst: `/_next/static` (content-hashed).
 * - Offline: documents that cannot be fetched fall back to the precached public `/offline` page.
 *
 * Updates: a new worker waits until the page asks for it (`SKIP_WAITING`, sent when the person
 * accepts the update) and then replaces the cached menu document, which points at the previous
 * build's assets, so an old shell never runs against new assets.
 */
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const DAY = 24 * 60 * 60;
const MENU_PATH = "/";

/** Inlined at build time; without a valid Supabase URL no remote photo is cached. */
const IMAGE_ORIGIN = publicImageOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL);

/** Only complete, successful answers are stored: never an error page, a redirect or an opaque response. */
const onlyOk: SerwistPlugin = { cacheWillUpdate: async ({ response }) => (response.status === 200 ? response : null) };
const onlyMenuDocument: SerwistPlugin = { cacheWillUpdate: async ({ response }) => (isCacheableMenuDocument(response) ? response : null) };
const onlyImage: SerwistPlugin = { cacheWillUpdate: async ({ response }) => (isCacheableImage(response) ? response : null) };

/**
 * `<img>` asks other origins in no-cors mode, whose opaque answer cannot be checked. The public
 * bucket answers CORS (`Access-Control-Allow-Origin: *`), so the worker asks that way, without
 * cookies or credentials, and can verify what it stores.
 */
const corsWithoutCredentials: SerwistPlugin = {
  requestWillFetch: async ({ request }) => new Request(request.url, { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer" })
};

const imageExpiration = new ExpirationPlugin({ maxEntries: 120, maxAgeSeconds: 30 * DAY });

const is =
  (policy: RuntimePolicy) =>
  ({ request, url, sameOrigin }: RouteMatchCallbackOptions) =>
    runtimePolicy({ request, url, sameOrigin }, IMAGE_ORIGIN) === policy;

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
        plugins: [onlyMenuDocument, new ExpirationPlugin({ maxEntries: 8, maxAgeSeconds: 7 * DAY })]
      })
    },
    {
      matcher: is("image"),
      handler: new StaleWhileRevalidate({ cacheName: RUNTIME_CACHES.images, plugins: [onlyImage, imageExpiration] })
    },
    {
      matcher: is("remote-image"),
      handler: new StaleWhileRevalidate({ cacheName: RUNTIME_CACHES.images, plugins: [corsWithoutCredentials, onlyImage, imageExpiration] })
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

/**
 * Stores the public menu document for this build. Anonymous on purpose (`credentials: "omit"`):
 * even when an admin installs the worker, the copy is the customer menu, never a session's page.
 * Best effort: offline or slow, the next online visit to the menu stores it instead.
 */
async function warmMenuDocument() {
  try {
    const url = new URL(MENU_PATH, self.location.origin).href;
    const response = await fetch(url, { credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(5_000) });
    if (!isCacheableMenuDocument(response)) return;
    await (await caches.open(RUNTIME_CACHES.pages)).put(url, response);
  } catch {
    // No network now: nothing to store.
  }
}

// Leftovers from earlier workers (BB-02's default caches stored RSC and API answers) and the menu
// documents of the previous build go away when this version takes over; then the current menu
// document is stored, so the first visit already opens offline.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => !isCacheKeptOnActivation(name)).map((name) => caches.delete(name))))
      .then(warmMenuDocument)
  );
});

serwist.addEventListeners();
