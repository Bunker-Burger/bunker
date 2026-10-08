import { describe, expect, it } from "vitest";
import { ADMIN_HOME, loginPathFor, safeAdminPath } from "./safe-redirect";

describe("safeAdminPath", () => {
  it.each([
    ["/bunker/admin", "/bunker/admin"],
    ["/bunker/admin/productos", "/bunker/admin/productos"],
    ["/bunker/admin/productos?tab=papas", "/bunker/admin/productos?tab=papas"],
    ["/bunker/admin/./productos", "/bunker/admin/productos"]
  ])("keeps the admin path %s", (next, expected) => {
    expect(safeAdminPath(next)).toBe(expected);
  });

  it.each([
    ["missing", undefined],
    ["not a string", ["/bunker/admin"]],
    ["empty", ""],
    ["absolute URL", "https://evil.example/bunker/admin"],
    ["protocol-relative", "//evil.example/bunker/admin"],
    ["backslash host", "/\evil.example/bunker/admin"],
    ["javascript scheme", "javascript:alert(1)"],
    ["relative path", "bunker/admin"],
    ["other section", "/"],
    ["login page", "/bunker"],
    ["prefix lookalike", "/bunker/administrador"],
    ["dot segments out of admin", "/bunker/admin/../../evil"],
    ["encoded traversal stays a literal segment outside admin", "/bunker/%2e%2e/admin"],
    ["control characters", "/bunker/admin\r\nLocation: https://evil.example"],
    ["tab-split scheme", "/\t/evil.example"],
    ["too long", `/bunker/admin/${"a".repeat(600)}`]
  ])("falls back to the admin home for %s", (_case, next) => {
    expect(safeAdminPath(next)).toBe(ADMIN_HOME);
  });
});

describe("loginPathFor", () => {
  it("returns to the requested admin page, and to the plain login for the home", () => {
    expect(loginPathFor("/bunker/admin/productos")).toBe("/bunker?next=%2Fbunker%2Fadmin%2Fproductos");
    expect(loginPathFor("/bunker/admin")).toBe("/bunker");
    expect(loginPathFor("https://evil.example")).toBe("/bunker");
  });
});
