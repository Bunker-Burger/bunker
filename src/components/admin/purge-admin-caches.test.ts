import { describe, expect, it } from "vitest";
import { isAdminPath, purgeAdminCaches } from "./purge-admin-caches";

function fakeCacheStorage(entries: Record<string, string[]>) {
  const stores = new Map(Object.entries(entries).map(([name, urls]) => [name, new Set(urls)]));
  const storage = {
    keys: async () => [...stores.keys()],
    open: async (name: string) => ({
      keys: async () => [...(stores.get(name) ?? [])].map((url) => new Request(url)),
      delete: async (request: Request) => stores.get(name)?.delete(request.url) ?? false
    })
  } as unknown as CacheStorage;
  return { storage, stores };
}

describe("purgeAdminCaches", () => {
  it("removes every same-origin /bunker entry and keeps the rest", async () => {
    const origin = location.origin;
    const { storage, stores } = fakeCacheStorage({
      pages: [`${origin}/`, `${origin}/bunker`, `${origin}/bunker/admin`, `${origin}/bunker/admin?_rsc=1`],
      assets: [`${origin}/_next/static/app.js`, `${origin}/bunkerito.png`, "https://cdn.example/bunker/admin"]
    });

    expect(await purgeAdminCaches(storage)).toBe(3);
    expect([...stores.get("pages")!]).toEqual([`${origin}/`]);
    expect([...stores.get("assets")!]).toEqual([`${origin}/_next/static/app.js`, `${origin}/bunkerito.png`, "https://cdn.example/bunker/admin"]);
  });

  it("does nothing where Cache Storage is unavailable", async () => {
    expect(await purgeAdminCaches(undefined)).toBe(0);
  });

  it("matches admin paths exactly", () => {
    expect(isAdminPath("/bunker")).toBe(true);
    expect(isAdminPath("/bunker/admin")).toBe(true);
    expect(isAdminPath("/bunkerito")).toBe(false);
    expect(isAdminPath("/")).toBe(false);
  });
});
