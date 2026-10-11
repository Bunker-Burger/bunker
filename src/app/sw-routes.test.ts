import { describe, expect, it } from "vitest";
import { isCacheKeptOnActivation, isSensitiveRuntimeRequest, RUNTIME_CACHES, runtimePolicy } from "./sw-routes";

function matches(url: string, sameOrigin = true) {
  return isSensitiveRuntimeRequest({ sameOrigin, url: new URL(url) });
}

interface RequestShape {
  method?: string;
  mode?: string;
  destination?: string;
  headers?: Record<string, string>;
  sameOrigin?: boolean;
}

function policy(url: string, { method = "GET", mode = "cors", destination = "", headers = {}, sameOrigin = true }: RequestShape = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return runtimePolicy({
    sameOrigin,
    url: new URL(url),
    request: {
      method,
      mode,
      destination,
      headers: { get: (name) => lower[name.toLowerCase()] ?? null, has: (name) => name.toLowerCase() in lower }
    }
  });
}

const document = { mode: "navigate", destination: "document" } as const;

describe("sensitive runtime routes", () => {
  it.each([
    "http://localhost/bunker",
    "http://localhost/bunker/",
    "http://localhost/bunker/admin",
    "http://localhost/bunker/admin/catalogo",
    "http://localhost/bunker?from=menu",
    "http://localhost/api/store/status",
    "http://localhost/api/store/promotions",
    "http://localhost/api/store/products",
    "http://localhost/api/checkout/whatsapp",
    "http://localhost/api/checkout/mercado-pago",
    "http://localhost/api/payments/mercado-pago/webhook",
    "http://localhost/api/anything-new"
  ])("keeps %s network-only", (url) => {
    expect(matches(url)).toBe(true);
    expect(policy(url)).toBe("network-only");
    expect(policy(url, document)).toBe("network-only");
  });

  it.each([
    ["public home", "http://localhost/", true],
    ["similar public path", "http://localhost/bunkers", true],
    ["similar API-like path", "http://localhost/apiary", true],
    ["cross-origin admin path", "https://example.com/bunker", false]
  ])("does not claim %s", (_case, url, sameOrigin) => {
    expect(matches(url, sameOrigin)).toBe(false);
  });
});

describe("runtime policy", () => {
  it("serves the public menu document network-first, also when it deep-links a product", () => {
    expect(policy("http://localhost/", document)).toBe("public-page");
    expect(policy("http://localhost/?producto=smash-bunker", document)).toBe("public-page");
  });

  it.each([
    ["the Mercado Pago return", "http://localhost/?ref=abc&payment_id=123"],
    ["a collection id", "http://localhost/?collection_id=123"],
    ["an unknown parameter", "http://localhost/?utm_source=x"],
    ["another page", "http://localhost/design-system"],
    ["the admin login", "http://localhost/bunker"]
  ])("never answers %s from a cache", (_case, url) => {
    expect(policy(url, document)).toBe("network-only");
  });

  it.each([
    ["an RSC payload", "http://localhost/", { headers: { RSC: "1" } }],
    ["an RSC prefetch", "http://localhost/", { headers: { RSC: "1", "Next-Router-Prefetch": "1" } }],
    ["an RSC request by query", "http://localhost/?_rsc=abc", {}],
    ["a router state request", "http://localhost/", { headers: { "Next-Router-State-Tree": "%5B%5D" } }],
    ["a Server Action", "http://localhost/bunker/admin", { method: "POST", headers: { "Next-Action": "abc" } }],
    ["a checkout POST", "http://localhost/api/checkout/whatsapp", { method: "POST" }],
    ["a POST to the home page", "http://localhost/", { method: "POST", ...document }],
    ["the manifest", "http://localhost/manifest.webmanifest", {}],
    ["an unknown same-origin file", "http://localhost/robots.txt", {}]
  ])("keeps %s network-only", (_case, url, shape) => {
    expect(policy(url, shape)).toBe("network-only");
  });

  it.each([
    ["an optimized product photo", "http://localhost/_next/image?url=https%3A%2F%2Fx.supabase.co%2Fa.webp&w=640&q=75", {}],
    ["an image request", "http://localhost/some/photo", { destination: "image" }],
    ["an app icon", "http://localhost/icons/icon-192.png", {}]
  ])("serves %s stale-while-revalidate", (_case, url, shape) => {
    expect(policy(url, shape)).toBe("image");
  });

  it.each([
    "http://localhost/_next/static/chunks/app/page-0a1b2c.js",
    "http://localhost/_next/static/css/1234abcd.css",
    "http://localhost/_next/static/media/oswald.0f1e2d.woff2"
  ])("serves the hashed asset %s cache-first", (url) => {
    expect(policy(url)).toBe("hashed-asset");
  });

  it("leaves other origins (Supabase, Mercado Pago) to the browser", () => {
    expect(policy("https://x.supabase.co/rest/v1/products", { sameOrigin: false })).toBeNull();
    expect(policy("https://x.supabase.co/storage/v1/object/public/a.webp", { sameOrigin: false, destination: "image" })).toBeNull();
  });
});

describe("activation cleanup", () => {
  it("keeps the precache, images and hashed assets", () => {
    expect(isCacheKeptOnActivation("serwist-precache-v2-http://localhost/")).toBe(true);
    expect(isCacheKeptOnActivation(RUNTIME_CACHES.images)).toBe(true);
    expect(isCacheKeptOnActivation(RUNTIME_CACHES.static)).toBe(true);
  });

  it.each([RUNTIME_CACHES.pages, "pages", "pages-rsc", "pages-rsc-prefetch", "apis", "next-data", "static-js-assets", "others"])(
    "drops %s (previous build's documents or an older worker's caches)",
    (name) => {
      expect(isCacheKeptOnActivation(name)).toBe(false);
    }
  );
});
