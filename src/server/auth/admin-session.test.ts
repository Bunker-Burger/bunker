import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { catalogError } from "@/server/catalog/errors";
import { clearSessionCookies } from "@/server/supabase/clients";
import {
  authenticateStoreAdmin,
  getCurrentStoreAdmin,
  signOutCurrentSession,
  type AdminAuthDependencies
} from "./admin-session";

const cookieJar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [...cookieJar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => {
      if (value) cookieJar.set(name, value);
      else cookieJar.delete(name);
    }
  })
}));

const membership = { userId: "user-1", storeId: "store-1", role: "owner" as const };
const credentials = { email: "owner@example.com", password: "correct horse battery staple" };
type SignInResult = Awaited<ReturnType<AdminAuthDependencies["client"]["auth"]["signInWithPassword"]>>;
type SignOutResult = Awaited<ReturnType<AdminAuthDependencies["client"]["auth"]["signOut"]>>;
type MembershipResult = Awaited<ReturnType<AdminAuthDependencies["access"]["requireStoreAdmin"]>>;

function dependencies(overrides: {
  signInResult?: SignInResult;
  membershipResult?: MembershipResult;
  signOutResult?: SignOutResult;
} = {}) {
  const signInWithPassword = vi.fn(async () =>
    overrides.signInResult ?? { data: { user: { id: "user-1" }, session: { access_token: "token" } }, error: null }
  );
  const signOut = vi.fn(async () => overrides.signOutResult ?? { error: null });
  const membershipResult: MembershipResult = overrides.membershipResult ?? { ok: true, value: membership };
  const requireStoreAdmin = vi.fn(async () => membershipResult);
  const value: AdminAuthDependencies = { client: { auth: { signInWithPassword, signOut } }, access: { requireStoreAdmin } };
  return {
    value,
    signInWithPassword,
    signOut,
    requireStoreAdmin
  };
}

describe("authenticateStoreAdmin", () => {
  it("returns the active store membership after password login", async () => {
    const deps = dependencies();

    await expect(authenticateStoreAdmin(credentials, deps.value)).resolves.toEqual({ kind: "authorized", membership });
    expect(deps.signInWithPassword).toHaveBeenCalledWith(credentials);
    expect(deps.requireStoreAdmin).toHaveBeenCalledWith("bunker-burger");
    expect(deps.signOut).not.toHaveBeenCalled();
  });

  it("maps invalid credentials to rejected without checking membership", async () => {
    const error = new AuthApiError("Invalid login credentials", 400, "invalid_credentials");
    const deps = dependencies({ signInResult: { data: { user: null, session: null }, error } });

    await expect(authenticateStoreAdmin(credentials, deps.value)).resolves.toEqual({ kind: "rejected" });
    expect(deps.requireStoreAdmin).not.toHaveBeenCalled();
  });

  it.each([
    ["memberless", catalogError("unauthorized", "no membership")],
    ["inactive", catalogError("unauthorized", "inactive membership")],
    ["cross-store", catalogError("unauthorized", "wrong store")]
  ])("signs out locally and rejects a %s user", async (_case, membershipResult) => {
    const deps = dependencies({ membershipResult });

    await expect(authenticateStoreAdmin(credentials, deps.value)).resolves.toEqual({ kind: "rejected" });
    expect(deps.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("maps retryable auth and membership failures to unavailable and never authorizes", async () => {
    const authFailure = dependencies({
      signInResult: {
        data: { user: null, session: null },
        error: new AuthRetryableFetchError("fetch failed", 0)
      }
    });
    await expect(authenticateStoreAdmin(credentials, authFailure.value)).resolves.toEqual({ kind: "unavailable" });
    expect(authFailure.requireStoreAdmin).not.toHaveBeenCalled();

    const membershipFailure = dependencies({ membershipResult: catalogError("unavailable", "database unavailable") });
    await expect(authenticateStoreAdmin(credentials, membershipFailure.value)).resolves.toEqual({ kind: "unavailable" });
    expect(membershipFailure.signOut).not.toHaveBeenCalled();
  });

  it.each([408, 429])("maps HTTP %i auth failures to unavailable", async (status) => {
    const deps = dependencies({
      signInResult: {
        data: { user: null, session: null },
        error: new AuthApiError("temporary auth failure", status, "temporary_failure")
      }
    });

    await expect(authenticateStoreAdmin(credentials, deps.value)).resolves.toEqual({ kind: "unavailable" });
    expect(deps.requireStoreAdmin).not.toHaveBeenCalled();
  });
});

describe("current admin session", () => {
  it("gets the current admin through getUser and the membership gate without metadata", async () => {
    const deps = dependencies();

    await expect(getCurrentStoreAdmin(deps.value)).resolves.toEqual({ ok: true, value: membership });
    expect(deps.requireStoreAdmin).toHaveBeenCalledWith("bunker-burger");
    expect(deps.signInWithPassword).not.toHaveBeenCalled();
  });

  it("signs out with scope local", async () => {
    const deps = dependencies();

    await signOutCurrentSession({ client: deps.value.client, clearSessionCookies: vi.fn(async () => undefined) });

    expect(deps.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it.each([
    ["returned error", async () => ({ error: new AuthApiError("logout failed", 500, "logout_failed") })],
    ["thrown exception", async () => { throw new Error("transport failed"); }]
  ] as const)("clears only the local session cookie when signOut has a %s", async (_case, signOutImplementation) => {
    const deps = dependencies();
    deps.signOut.mockImplementation(signOutImplementation);
    const clearSessionCookies = vi.fn(async () => undefined);

    await expect(signOutCurrentSession({ client: deps.value.client, clearSessionCookies })).resolves.toBeUndefined();
    expect(clearSessionCookies).toHaveBeenCalledOnce();
    expect(deps.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("proves the real cookie adapter clears the current session after returned and thrown failures", async () => {
    const config = {
      url: "https://abcdefghijklmnopqrst.supabase.co",
      publishableKey: "sb_publishable_test",
      projectRef: "abcdefghijklmnopqrst",
      projectEnv: "development" as const
    };
    const deps = dependencies();
    const clear = () => clearSessionCookies(config);

    for (const failure of [
      { kind: "returned" as const, value: new AuthApiError("logout failed", 500, "logout_failed") },
      { kind: "thrown" as const, value: new Error("transport failed") }
    ]) {
      cookieJar.clear();
      cookieJar.set("sb-abcdefghijklmnopqrst-auth-token", "session");
      cookieJar.set("sb-abcdefghijklmnopqrst-auth-token.0", "chunk");
      deps.signOut.mockImplementation(
        failure.kind === "returned"
          ? async () => ({ error: failure.value })
          : async () => {
              throw failure.value;
            }
      );

      await expect(signOutCurrentSession({ client: deps.value.client, clearSessionCookies: clear })).resolves.toBeUndefined();
      expect(cookieJar.has("sb-abcdefghijklmnopqrst-auth-token")).toBe(false);
      expect(cookieJar.has("sb-abcdefghijklmnopqrst-auth-token.0")).toBe(false);
    }
  });
});
