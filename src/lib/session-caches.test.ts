import { describe, expect, it } from "vitest";
import { RUNTIME_CACHES } from "@/app/sw-routes";
import { purgeSessionCaches } from "./session-caches";

/** In-memory CacheStorage with the parts the purge uses. */
function fakeCaches(content: Record<string, string[]>) {
  const stores = new Map(Object.entries(content).map(([name, urls]) => [name, new Set(urls)]));
  return {
    storage: {
      keys: async () => [...stores.keys()],
      delete: async (name: string) => stores.delete(name),
      open: async (name: string) => {
        const urls = stores.get(name) ?? new Set<string>();
        stores.set(name, urls);
        return {
          keys: async () => [...urls].map((url) => new Request(url)),
          delete: async (request: Request) => urls.delete(request.url)
        } as unknown as Cache;
      }
    },
    left: () => Object.fromEntries([...stores].map(([name, urls]) => [name, [...urls].sort()]))
  };
}

describe("purgeSessionCaches", () => {
  it("drops the cached menu documents and any admin or API entry, keeping public images and assets", async () => {
    const fake = fakeCaches({
      [RUNTIME_CACHES.pages]: ["http://localhost/", "http://localhost/?producto=smash"],
      [RUNTIME_CACHES.images]: ["http://localhost/_next/image?url=a&w=640&q=75", "http://localhost/bunker/admin/foto.png"],
      [RUNTIME_CACHES.static]: ["http://localhost/_next/static/chunks/app-1.js"],
      "pages-rsc": ["http://localhost/bunker/admin?_rsc=1", "http://localhost/api/store/status"],
      "serwist-precache-v2-http://localhost/": ["http://localhost/offline"]
    });
    await purgeSessionCaches(fake.storage);
    expect(fake.left()).toEqual({
      [RUNTIME_CACHES.images]: ["http://localhost/_next/image?url=a&w=640&q=75"],
      [RUNTIME_CACHES.static]: ["http://localhost/_next/static/chunks/app-1.js"],
      "pages-rsc": [],
      "serwist-precache-v2-http://localhost/": ["http://localhost/offline"]
    });
  });

  it("does nothing where the browser has no CacheStorage", async () => {
    await expect(purgeSessionCaches(undefined)).resolves.toBeUndefined();
  });
});
