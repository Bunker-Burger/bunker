"use client";

import { useEffect } from "react";

/** Same-origin paths that may hold administrative content. */
export function isAdminPath(pathname: string): boolean {
  return pathname === "/bunker" || pathname.startsWith("/bunker/");
}

/**
 * Removes any administrative response from the browser's Cache Storage. The service worker
 * already never stores `/bunker/**` (NetworkOnly); this also drops entries left by an older
 * worker, every time the login page is shown (after signing out, or when access is refused).
 */
export async function purgeAdminCaches(storage: CacheStorage | undefined = globalThis.caches): Promise<number> {
  if (!storage) return 0;
  let removed = 0;
  for (const name of await storage.keys()) {
    const cache = await storage.open(name);
    for (const request of await cache.keys()) {
      const url = new URL(request.url);
      if (url.origin === location.origin && isAdminPath(url.pathname) && (await cache.delete(request))) removed += 1;
    }
  }
  return removed;
}

export function PurgeAdminCaches() {
  useEffect(() => {
    purgeAdminCaches().catch(() => undefined);
  }, []);
  return null;
}
