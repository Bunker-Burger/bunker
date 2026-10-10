import { describe, expect, it } from "vitest";
import { isSensitiveRuntimeRequest } from "./sw-routes";

function matches(url: string, sameOrigin = true) {
  return isSensitiveRuntimeRequest({ sameOrigin, url: new URL(url) });
}

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
    "http://localhost/api/checkout/whatsapp"
  ])("keeps %s network-only", (url) => {
    expect(matches(url)).toBe(true);
  });

  it.each([
    ["public home", "http://localhost/", true],
    ["similar public path", "http://localhost/bunkers", true],
    ["cross-origin admin path", "https://example.com/bunker", false]
  ])("does not claim %s", (_case, url, sameOrigin) => {
    expect(matches(url, sameOrigin)).toBe(false);
  });
});
