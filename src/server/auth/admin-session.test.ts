import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { catalogError } from "@/server/catalog/errors";
import {
  authenticateStoreAdmin,
  getCurrentStoreAdmin,
  signOutCurrentSession,
  type AdminAuthDependencies
} from "./admin-session";

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

    await signOutCurrentSession({ client: deps.value.client });

    expect(deps.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});
