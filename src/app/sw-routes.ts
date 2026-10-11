/*
 * Which caching policy the service worker applies to each request (BB-16). Pure, so it is unit
 * tested without a worker. Anything not explicitly cacheable goes to the network: a new route is
 * private until someone decides otherwise.
 */

interface RuntimeRequestMatch {
  sameOrigin: boolean;
  url: Pick<URL, "pathname">;
}

export interface RuntimeRequest {
  sameOrigin: boolean;
  url: Pick<URL, "pathname" | "searchParams">;
  request: {
    method: string;
    mode: string;
    destination: string;
    headers: { get(name: string): string | null; has(name: string): boolean };
  };
}

export type RuntimePolicy =
  /** Auth/Admin, APIs (checkout, status, promotions, catalog), RSC payloads, mutations, unknown routes. */
  | "network-only"
  /** The public menu document: fresh when online, the last copy when offline. */
  | "public-page"
  /** Product photos and public images: served at once, refreshed in the background. */
  | "image"
  /** Build assets whose URL changes with their content (`/_next/static`). */
  | "hashed-asset";

/** Cache names the worker owns besides its precache; anything else found at activation is deleted. */
export const RUNTIME_CACHES = {
  pages: "bunker-pages",
  images: "bunker-images",
  static: "bunker-static"
} as const;

/** Precached public page shown when a document cannot be fetched or found in the cache. */
export const OFFLINE_PATH = "/offline";

/** Query parameters the public menu may carry and still be served from the cache (deep link to a product). */
const CACHEABLE_MENU_PARAMS = new Set(["producto"]);

const IMAGE_EXTENSION = /\.(?:avif|gif|ico|jpe?g|png|svg|webp)$/i;

/**
 * Requests that may carry auth or operational data and must never be served from a cache: Auth and
 * Admin (BB-11) and every API, among them store status (BB-08), promotions (BB-09), the fresh
 * catalog (BB-06) and checkout (BB-10).
 */
export function isSensitiveRuntimeRequest({ sameOrigin, url: { pathname } }: RuntimeRequestMatch) {
  return sameOrigin && (pathname === "/bunker" || pathname.startsWith("/bunker/") || pathname === "/api" || pathname.startsWith("/api/"));
}

/** `null`: not the worker's business (other origins). */
export function runtimePolicy(candidate: RuntimeRequest): RuntimePolicy | null {
  const { sameOrigin, url, request } = candidate;
  if (!sameOrigin) return null;
  // Mutations (checkout, Server Actions, login, logout) never go through a cache.
  if (request.method !== "GET") return "network-only";
  if (isSensitiveRuntimeRequest(candidate)) return "network-only";
  if (url.pathname.startsWith("/_next/static/")) return "hashed-asset";
  if (url.pathname === "/_next/image" || request.destination === "image" || IMAGE_EXTENSION.test(url.pathname)) return "image";
  if (request.mode === "navigate" || request.destination === "document") {
    const onlyMenuParams = [...url.searchParams.keys()].every((key) => CACHEABLE_MENU_PARAMS.has(key));
    // The Mercado Pago return (`ref`, `payment_id`…) shows a payment state: never from a cache.
    return url.pathname === "/" && onlyMenuParams ? "public-page" : "network-only";
  }
  // Everything else, including RSC payloads (`RSC: 1`, `?_rsc`) and router fetches, which are not
  // navigations: the server's current answer.
  return "network-only";
}

/** Caches a new worker keeps at activation: its precache, images and hashed assets. */
export function isCacheKeptOnActivation(name: string) {
  return name.includes("precache") || name === RUNTIME_CACHES.images || name === RUNTIME_CACHES.static;
}
