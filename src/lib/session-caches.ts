import { RUNTIME_CACHES } from "@/app/sw-routes";

/*
 * Run when an admin signs out (BB-16). Admin pages, APIs and RSC payloads are never cached, but
 * the cached menu document may have been rendered for the admin session (it shows the Admin tab),
 * so it goes too; and anything under /bunker or /api that an older worker might have stored.
 * Images and build assets are public and stay.
 */
export async function purgeSessionCaches(storage: Pick<CacheStorage, "keys" | "open" | "delete"> | undefined = globalThis.caches) {
  if (!storage) return;
  await storage.delete(RUNTIME_CACHES.pages);
  for (const name of await storage.keys()) {
    const cache = await storage.open(name);
    for (const request of await cache.keys()) {
      const { pathname } = new URL(request.url);
      if (pathname === "/bunker" || pathname.startsWith("/bunker/") || pathname.startsWith("/api/")) await cache.delete(request);
    }
  }
}
