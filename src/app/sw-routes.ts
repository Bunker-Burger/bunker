interface RuntimeRequestMatch {
  sameOrigin: boolean;
  url: Pick<URL, "pathname">;
}

const NETWORK_ONLY_PATHS = new Set([
  "/api/store/status",
  "/api/store/promotions",
  "/api/store/products"
]);

/** Requests that may carry auth or operational data and must never be served from a cache. */
export function isSensitiveRuntimeRequest({ sameOrigin, url: { pathname } }: RuntimeRequestMatch) {
  return (
    sameOrigin &&
    (pathname === "/bunker" ||
      pathname.startsWith("/bunker/") ||
      NETWORK_ONLY_PATHS.has(pathname) ||
      pathname.startsWith("/api/checkout/"))
  );
}
