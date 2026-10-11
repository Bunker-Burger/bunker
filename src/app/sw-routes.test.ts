import { describe, expect, it } from "vitest";
import {
  isCacheableImage,
  isCacheableMenuDocument,
  isCacheKeptOnActivation,
  isSensitiveRuntimeRequest,
  publicImageOrigin,
  RUNTIME_CACHES,
  runtimePolicy
} from "./sw-routes";

function matches(url: string, sameOrigin = true) {
  return isSensitiveRuntimeRequest({ sameOrigin, url: new URL(url) });
}

interface RequestShape {
  method?: string;
  mode?: string;
  destination?: string;
  headers?: Record<string, string>;
  sameOrigin?: boolean;
  imageOrigin?: string | null;
}

function policy(
  url: string,
  { method = "GET", mode = "cors", destination = "", headers = {}, sameOrigin = true, imageOrigin = null }: RequestShape = {}
) {
  const lower = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return runtimePolicy(
    {
      sameOrigin,
      url: new URL(url),
      request: {
        method,
        mode,
        destination,
        headers: { get: (name) => lower[name.toLowerCase()] ?? null, has: (name) => name.toLowerCase() in lower }
      }
    },
    imageOrigin
  );
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

describe("product photos from Supabase Storage", () => {
  const imageOrigin = "https://abcdefghijklmnopqrst.supabase.co";
  const photo = `${imageOrigin}/storage/v1/object/public/catalog/products/9b1f/smash-doble.webp`;
  const remote = { sameOrigin: false, destination: "image", mode: "no-cors", imageOrigin } as const;

  it("caches a public catalog photo of this deployment's project", () => {
    expect(policy(photo, remote)).toBe("remote-image");
    expect(policy(`${imageOrigin}/storage/v1/object/public/catalog/a%20b.jpg`, remote)).toBe("remote-image");
  });

  it("caches nothing remote when the build has no Supabase project", () => {
    expect(policy(photo, { ...remote, imageOrigin: null })).toBeNull();
  });

  it.each([
    ["Supabase Auth", `${imageOrigin}/auth/v1/user`],
    ["the Auth token endpoint", `${imageOrigin}/auth/v1/token?grant_type=password`],
    ["PostgREST", `${imageOrigin}/rest/v1/products?select=*`],
    ["an RPC", `${imageOrigin}/rest/v1/rpc/admin_save_promotion`],
    ["authenticated Storage", `${imageOrigin}/storage/v1/object/authenticated/catalog/a.webp`],
    ["a signed Storage URL", `${imageOrigin}/storage/v1/object/sign/catalog/a.webp?token=abc`],
    ["another bucket", `${imageOrigin}/storage/v1/object/public/private-orders/a.webp`],
    ["a bucket named like catalog", `${imageOrigin}/storage/v1/object/public/catalog-private/a.webp`],
    ["the bucket root", `${imageOrigin}/storage/v1/object/public/catalog/`],
    ["a query (transform, cache-buster or token)", `${photo}?token=abc`],
    ["an encoded separator", `${imageOrigin}/storage/v1/object/public/catalog/..%2Fprivate%2Fa.webp`],
    ["a dot segment out of the bucket", `${imageOrigin}/storage/v1/object/public/catalog/%2e%2e/private-orders/a.webp`],
    ["an encoded dot", `${imageOrigin}/storage/v1/object/public/catalog/a%2Ewebp`],
    ["image transforms", `${imageOrigin}/storage/v1/render/image/public/catalog/a.webp?width=200`],
    ["another Supabase project", "https://zzzzzzzzzzzzzzzzzzzz.supabase.co/storage/v1/object/public/catalog/a.webp"],
    ["a look-alike host", "https://abcdefghijklmnopqrst.supabase.co.evil.test/storage/v1/object/public/catalog/a.webp"],
    ["plain http", "http://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/catalog/a.webp"],
    ["any other image host", "https://lh3.googleusercontent.com/aida-public/a.webp"]
  ])("never caches %s", (_case, url) => {
    expect(policy(url, remote)).toBeNull();
  });

  it("only for images: a fetch, a document or a mutation of the same photo URL stays with the browser", () => {
    expect(policy(photo, { ...remote, destination: "", mode: "cors" })).toBeNull();
    expect(policy(photo, { ...remote, destination: "document", mode: "navigate" })).toBeNull();
    expect(policy(photo, { ...remote, method: "POST" })).toBeNull();
    expect(policy(photo, { ...remote, method: "DELETE" })).toBeNull();
  });

  it("reads the project origin only from a https://<project-ref>.supabase.co URL", () => {
    expect(publicImageOrigin("https://abcdefghijklmnopqrst.supabase.co")).toBe(imageOrigin);
    expect(publicImageOrigin(" https://abcdefghijklmnopqrst.supabase.co/ ")).toBe(imageOrigin);
    expect(publicImageOrigin(undefined)).toBeNull();
    expect(publicImageOrigin("")).toBeNull();
    expect(publicImageOrigin("not a url")).toBeNull();
    expect(publicImageOrigin("http://abcdefghijklmnopqrst.supabase.co")).toBeNull();
    expect(publicImageOrigin("https://abcdefghijklmnopqrst.supabase.co:8443")).toBeNull();
    expect(publicImageOrigin("https://example.com")).toBeNull();
    expect(publicImageOrigin("https://short.supabase.co")).toBeNull();
  });
});

function response({ status = 200, type = "basic", redirected = false, contentType = null as string | null } = {}) {
  return { status, type, redirected, headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? contentType : null) } };
}

describe("what the worker stores", () => {
  const html = "text/html; charset=utf-8";

  it("keeps the menu document only as a complete same-origin HTML answer", () => {
    expect(isCacheableMenuDocument(response({ contentType: html }))).toBe(true);
    expect(isCacheableMenuDocument(response({ contentType: html, status: 500 }))).toBe(false);
    expect(isCacheableMenuDocument(response({ contentType: html, status: 404 }))).toBe(false);
    expect(isCacheableMenuDocument(response({ contentType: html, status: 206 }))).toBe(false);
    expect(isCacheableMenuDocument(response({ contentType: html, redirected: true }))).toBe(false);
    expect(isCacheableMenuDocument(response({ contentType: html, type: "opaque", status: 0 }))).toBe(false);
    expect(isCacheableMenuDocument(response({ contentType: html, type: "cors" }))).toBe(false);
    expect(isCacheableMenuDocument(response({ contentType: "text/x-component" }))).toBe(false);
    expect(isCacheableMenuDocument(response({ contentType: "application/json" }))).toBe(false);
    expect(isCacheableMenuDocument(response())).toBe(false);
  });

  it("keeps images only when they are readable 200 images, never opaque", () => {
    expect(isCacheableImage(response({ contentType: "image/webp" }))).toBe(true);
    expect(isCacheableImage(response({ contentType: "image/jpeg", type: "cors" }))).toBe(true);
    expect(isCacheableImage(response({ type: "opaque", status: 0 }))).toBe(false);
    expect(isCacheableImage(response({ contentType: "image/webp", type: "opaque", status: 0 }))).toBe(false);
    expect(isCacheableImage(response({ contentType: "image/webp", type: "cors", status: 400 }))).toBe(false);
    expect(isCacheableImage(response({ contentType: "application/json", type: "cors" }))).toBe(false);
    expect(isCacheableImage(response({ contentType: "text/html" }))).toBe(false);
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
