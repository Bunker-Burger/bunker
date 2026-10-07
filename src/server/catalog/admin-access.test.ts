import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { fromAuthError, membershipForStore } from "./admin-access";

describe("fromAuthError", () => {
  it.each([
    ["no session cookie", new AuthSessionMissingError()],
    ["expired access token", new AuthApiError("invalid JWT: unable to parse or verify signature, token has invalid claims: token is expired", 403, "bad_jwt")],
    ["expired session whose refresh token is gone", new AuthApiError("Invalid Refresh Token: Refresh Token Not Found", 400, "refresh_token_not_found")],
    ["user deleted after sign-in", new AuthApiError("User from sub claim in JWT does not exist", 403, "user_not_found")]
  ])("treats %s as unauthorized", (_case, error) => {
    const result = fromAuthError(error);
    expect(result.error).toMatchObject({ code: "unauthorized", cause: error });
  });

  it.each([
    ["network failure", new AuthRetryableFetchError("fetch failed", 0)],
    ["Auth server error", new AuthApiError("Internal Server Error", 500, "unexpected_failure")]
  ])("treats %s as unavailable", (_case, error) => {
    expect(fromAuthError(error).error).toMatchObject({ code: "unavailable", cause: error });
  });
});

describe("membershipForStore", () => {
  const row = (slug: string | null, active = true, role: "owner" | "admin" = "admin") => ({
    store_id: `id-${slug}`,
    role,
    is_active: active,
    stores: slug === null ? null : { slug }
  });

  it("accepts an active owner or admin of the requested store", () => {
    expect(membershipForStore("u-1", [row("otra"), row("bunker-burger", true, "owner")], "bunker-burger")).toEqual({
      ok: true,
      value: { userId: "u-1", storeId: "id-bunker-burger", role: "owner" }
    });
  });

  it.each([
    ["no memberships", []],
    ["inactive membership", [row("bunker-burger", false)]],
    ["membership of another store", [row("otra")]],
    ["membership whose store is not readable", [row(null)]]
  ])("rejects %s as unauthorized", (_case, rows) => {
    expect(membershipForStore("u-1", rows, "bunker-burger")).toMatchObject({ ok: false, error: { code: "unauthorized" } });
  });
});
