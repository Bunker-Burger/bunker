import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signIn, signOut } from "@/app/bunker/actions";
import {
  accounts,
  AUTH_COOKIE,
  installFakeSupabase,
  issueSession,
  sessionCookieValue,
  stubSupabaseEnv,
  type FakeSupabase
} from "@/test/fake-supabase-auth";
import { redirectedTo } from "@/test/redirects";
import { signInAdmin } from "./admin-auth";
import { AUTH_UNAVAILABLE, INITIAL_SIGN_IN_STATE, INVALID_CREDENTIALS, INVALID_INPUT, TOO_MANY_ATTEMPTS } from "./messages";
import { getAdminSession, hasAdminSession, requireAdminSession } from "./session";

/*
 * BB-11 on the server, through the real Supabase clients and repositories; only the network
 * (GoTrue + PostgREST with RLS) and the request cookies (next/headers) are faked.
 */

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string, options: { maxAge?: number } = {}) => {
      if (value === "" || options.maxAge === 0) jar.delete(name);
      else jar.set(name, value);
    }
  })
}));
// getAdminSession memoizes per render pass with React's cache(); each test is its own request.
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

let fake: FakeSupabase;

beforeEach(() => {
  jar.clear();
  stubSupabaseEnv();
  fake = installFakeSupabase();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

function signedInAs(user: (typeof accounts)[keyof typeof accounts], options: { expired?: boolean } = {}) {
  const session = issueSession(fake, user, options);
  jar.set(AUTH_COOKIE, sessionCookieValue(session));
  return session;
}

describe("signing in (/bunker)", () => {
  it("keeps the session of an active admin of this store", async () => {
    expect(await signInAdmin(accounts.admin.email, accounts.admin.password)).toEqual({ ok: true });
    expect(jar.has(AUTH_COOKIE)).toBe(true);
    expect(await getAdminSession()).toMatchObject({ ok: true, value: { userId: "u-admin", email: accounts.admin.email, role: "owner", storeId: "store-1" } });
  });

  it("rejects a wrong password with the generic message and stores no session", async () => {
    expect(await signInAdmin(accounts.admin.email, "otra")).toEqual({ ok: false, message: INVALID_CREDENTIALS });
    expect(jar.size).toBe(0);
  });

  it.each([
    ["a user whose user_metadata claims admin but has no membership", accounts.metadataAdmin],
    ["an admin of another store (cross access)", accounts.otherStore],
    ["a user whose membership is inactive", accounts.inactive]
  ])("rejects %s and signs the new session out on the spot", async (_case, user) => {
    expect(await signInAdmin(user.email, user.password)).toEqual({ ok: false, message: INVALID_CREDENTIALS });
    expect(jar.size).toBe(0);
    expect(fake.requests.some(({ path }) => path.startsWith("/auth/v1/logout"))).toBe(true);
    expect(fake.sessions.every((session) => session.revoked)).toBe(true);
  });

  it("validates input before calling Supabase", async () => {
    expect(await signInAdmin("no-es-un-email", "x")).toEqual({ ok: false, message: INVALID_INPUT });
    expect(await signInAdmin(accounts.admin.email, "")).toEqual({ ok: false, message: INVALID_INPUT });
    expect(fake.requests).toEqual([]);
  });

  it("tells rate limiting and outages apart from bad credentials", async () => {
    fake.failAuth = { path: "/token", status: 429 };
    expect(await signInAdmin(accounts.admin.email, accounts.admin.password)).toEqual({ ok: false, message: TOO_MANY_ATTEMPTS });
    fake.failAuth = { path: "/token", status: 500 };
    expect(await signInAdmin(accounts.admin.email, accounts.admin.password)).toEqual({ ok: false, message: AUTH_UNAVAILABLE });
    expect(jar.size).toBe(0);
  });

  it("the form action redirects only inside /bunker/admin", async () => {
    const credentials = { email: accounts.admin.email, password: accounts.admin.password };
    expect(await redirectedTo(() => signIn(INITIAL_SIGN_IN_STATE, form({ ...credentials, next: "/bunker/admin/productos" })))).toBe(
      "/bunker/admin/productos"
    );
    for (const next of ["https://evil.example", "//evil.example", "/\\evil.example", "/"]) {
      jar.clear();
      expect(await redirectedTo(() => signIn(INITIAL_SIGN_IN_STATE, form({ ...credentials, next })))).toBe("/bunker/admin");
    }
  });

  it("the form action returns the error and keeps the typed email, never the password", async () => {
    const state = await signIn(INITIAL_SIGN_IN_STATE, form({ email: ` ${accounts.admin.email} `, password: "mal" }));
    expect(state).toEqual({ error: INVALID_CREDENTIALS, email: accounts.admin.email });
  });
});

describe("the admin session on later requests", () => {
  it("is refused without a session and sends /bunker/admin pages to the login", async () => {
    expect(await getAdminSession()).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(await hasAdminSession()).toBe(false);
    expect(await redirectedTo(() => requireAdminSession("/bunker/admin"))).toBe("/bunker");
    // Anonymous visitors never cost a call to Supabase.
    expect(fake.requests).toEqual([]);
    expect(await redirectedTo(() => requireAdminSession("/bunker/admin/productos"))).toBe("/bunker?next=%2Fbunker%2Fadmin%2Fproductos");
  });

  it("accepts a valid admin session", async () => {
    signedInAs(accounts.admin);
    expect(await hasAdminSession()).toBe(true);
    expect(await redirectedTo(() => requireAdminSession())).toBeNull();
  });

  it.each([
    ["user_metadata claiming admin", accounts.metadataAdmin],
    ["admin of another store", accounts.otherStore],
    ["inactive membership", accounts.inactive]
  ])("refuses a valid session of a non-admin (%s)", async (_case, user) => {
    signedInAs(user);
    expect(await getAdminSession()).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(await redirectedTo(() => requireAdminSession())).toBe("/bunker");
  });

  it("refreshes an expired access token when its refresh token is still valid", async () => {
    signedInAs(accounts.admin, { expired: true });
    expect(await getAdminSession()).toMatchObject({ ok: true, value: { userId: "u-admin" } });
    expect(fake.requests.some(({ path }) => path.includes("grant_type=refresh_token"))).toBe(true);
  });

  it("refuses an expired session whose refresh token was revoked", async () => {
    const session = signedInAs(accounts.admin, { expired: true });
    fake.sessions.find((issued) => issued.refreshToken === session.refresh_token)!.revoked = true;
    expect(await getAdminSession()).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(await redirectedTo(() => requireAdminSession())).toBe("/bunker");
  });

  it("refuses a session revoked on the server even if its token has not expired", async () => {
    signedInAs(accounts.admin);
    for (const issued of fake.sessions) issued.revoked = true;
    expect(await getAdminSession()).toMatchObject({ ok: false, error: { code: "unauthorized" } });
  });

  it("does not grant access when the check cannot run, and does not pretend the user is logged out", async () => {
    signedInAs(accounts.admin);
    fake.failAuth = { path: "/user", status: 500 };
    const session = await requireAdminSession();
    expect(session).toMatchObject({ ok: false, error: { code: "unavailable" } });
    expect(await hasAdminSession()).toBe(false);
  });
});

describe("signing out", () => {
  it("revokes the session, clears the cookies and returns to the login", async () => {
    signedInAs(accounts.admin);
    const stolenCookie = jar.get(AUTH_COOKIE)!;

    expect(await redirectedTo(() => signOut())).toBe("/bunker?sesion=cerrada");
    expect(jar.has(AUTH_COOKIE)).toBe(false);
    expect(await getAdminSession()).toMatchObject({ ok: false, error: { code: "unauthorized" } });

    // A copy of the old cookie is useless afterwards: the server revoked that session.
    jar.set(AUTH_COOKIE, stolenCookie);
    expect(await getAdminSession()).toMatchObject({ ok: false, error: { code: "unauthorized" } });
  });
});
