import { AuthRetryableFetchError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signIn, signOut } from "@/app/bunker/actions";
import {
  accounts,
  AUTH_COOKIE,
  installFakeSupabase,
  issueSession,
  sessionCookieValue,
  stubSupabaseEnv,
  SUPABASE_URL,
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
/** Every cookie name ever written with a value during the test. */
const written = vi.hoisted(() => new Set<string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string, options: { maxAge?: number } = {}) => {
      if (value !== "" && options.maxAge !== 0) written.add(name);
      if (value === "" || options.maxAge === 0) jar.delete(name);
      else jar.set(name, value);
    }
  })
}));
// getAdminSession memoizes per render pass with React's cache(); each test is its own request.
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

/**
 * Fault injection on the session client. `fail`: building it throws. `signOut`: replaces its
 * `auth.signOut` with an SDK that does NOT drop the local session (as other @supabase versions
 * do on failure, supabase-js#2501): "error" resolves with a retryable error, "throws" rejects.
 */
const sessionClient = vi.hoisted(() => ({ fail: false, signOut: "real" as "real" | "error" | "throws" }));
vi.mock("@/server/supabase/clients", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/supabase/clients")>();
  return {
    ...original,
    createSessionClient: async (...args: Parameters<typeof original.createSessionClient>) => {
      if (sessionClient.fail) throw new Error("simulated failure building the session client");
      const client = await original.createSessionClient(...args);
      if (sessionClient.signOut === "error") client.auth.signOut = async () => ({ error: new AuthRetryableFetchError("fetch failed", 0) });
      if (sessionClient.signOut === "throws") client.auth.signOut = async () => Promise.reject(new Error("socket hang up"));
      return client;
    }
  };
});

let fake: FakeSupabase;

beforeEach(() => {
  jar.clear();
  written.clear();
  sessionClient.fail = false;
  sessionClient.signOut = "real";
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

  describe.each([
    ["Auth answers 500 to the logout", { path: "/logout", status: 500 }],
    ["the logout request fails on the network", { path: "/logout", status: "network" }]
  ] as const)("when the rejection's sign-out fails (%s)", (_failure, failure) => {
    it.each([
      ["no membership (user_metadata claims admin)", accounts.metadataAdmin],
      ["admin of another store", accounts.otherStore],
      ["inactive membership", accounts.inactive],
      ["no membership, session stored in chunked cookies", accounts.largeProfile]
    ])("still refuses %s with the same message and leaves no auth cookie", async (_case, user) => {
      fake.failAuth = failure;

      expect(await signInAdmin(user.email, user.password)).toEqual({ ok: false, message: INVALID_CREDENTIALS });
      // Sign-in did store a session first (chunked for the large profile)…
      expect([...written].some((name) => name.startsWith(AUTH_COOKIE))).toBe(true);
      if (user === accounts.largeProfile) expect(written.has(`${AUTH_COOKIE}.1`)).toBe(true);
      // …and none of it survives, although Supabase never confirmed the revocation.
      expect([...jar.keys()].filter((name) => name.startsWith(AUTH_COOKIE))).toEqual([]);
      expect(fake.sessions.some((session) => !session.revoked)).toBe(true);
      expect(await hasAdminSession()).toBe(false);
    });
  });

  it.each([
    ["resolves with an error", "error"],
    ["throws", "throws"]
  ] as const)("expires the cookies itself when the SDK's sign-out %s and keeps the local session", async (_case, behavior) => {
    sessionClient.signOut = behavior;
    for (const user of [accounts.metadataAdmin, accounts.otherStore, accounts.inactive, accounts.largeProfile]) {
      jar.clear();
      written.clear();
      expect(await signInAdmin(user.email, user.password)).toEqual({ ok: false, message: INVALID_CREDENTIALS });
      expect([...written].some((name) => name.startsWith(AUTH_COOKIE))).toBe(true);
      expect([...jar.keys()].filter((name) => name.startsWith(AUTH_COOKIE))).toEqual([]);
      expect(await hasAdminSession()).toBe(false);
    }
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
  const signedOutVia = () => redirectedTo(() => signOut());
  const authCookies = () => [...jar.keys()].filter((name) => name.startsWith(AUTH_COOKIE));

  it("revokes the session in Supabase, clears this device and says so", async () => {
    signedInAs(accounts.admin);

    expect(await signedOutVia()).toBe("/bunker?sesion=cerrada");
    expect(fake.requests.some(({ method, path }) => method === "POST" && path.startsWith("/auth/v1/logout"))).toBe(true);
    expect(fake.sessions.every((session) => session.revoked)).toBe(true);
    // This browser holds no session any more.
    expect(authCookies()).toEqual([]);
    expect(await getAdminSession()).toMatchObject({ ok: false, error: { code: "unauthorized" } });
  });

  it("the app's gate refuses a copy of the old cookie, because getUser checks the session in Auth", async () => {
    signedInAs(accounts.admin);
    const copiedCookie = jar.get(AUTH_COOKIE)!;
    await signedOutVia();

    jar.set(AUTH_COOKIE, copiedCookie);
    expect(await getAdminSession()).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(await redirectedTo(() => requireAdminSession())).toBe("/bunker");
  });

  it("does not make the old access token useless against the Data API before it expires (documented window)", async () => {
    const session = signedInAs(accounts.admin);
    await signedOutVia();

    // PostgREST verifies only the JWT and applies RLS on auth.uid(): the copied token still reads
    // what RLS allows that user until `exp`. The app never authorizes with it (see above).
    const readMemberships = () =>
      fetch(`${SUPABASE_URL}/rest/v1/admin_memberships?select=store_id,role,is_active,stores!inner(slug)`, {
        headers: { apikey: "sb_publishable_test", authorization: `Bearer ${session.access_token}` }
      }).then((response) => response.json());
    expect(await readMemberships()).toEqual([{ store_id: "store-1", role: "owner", is_active: true, stores: { slug: "bunker-burger" } }]);

    // Once `exp` passes, the Data API refuses it too.
    fake.now = () => Date.now() + 2 * 60 * 60 * 1000;
    expect(await readMemberships()).toEqual([]);
  });

  it.each([
    ["Auth answers 500 to the logout", { path: "/logout", status: 500 }],
    ["the logout request fails on the network", { path: "/logout", status: "network" }]
  ] as const)("when %s: clears this device anyway and says the revocation was not confirmed", async (_case, failure) => {
    signedInAs(accounts.admin);
    fake.failAuth = failure;

    expect(await signedOutVia()).toBe("/bunker?sesion=local");
    expect(authCookies()).toEqual([]);
    expect(await getAdminSession()).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    // Nothing pretends the server-side session ended.
    expect(fake.sessions.some((issued) => !issued.revoked)).toBe(true);
  });

  it("when the SDK's sign-out fails without dropping the session: clears this device anyway", async () => {
    signedInAs(accounts.admin);
    sessionClient.signOut = "error";

    expect(await signedOutVia()).toBe("/bunker?sesion=local");
    expect(authCookies()).toEqual([]);
  });

  it("without Supabase configuration: clears this device and says the revocation was not confirmed", async () => {
    signedInAs(accounts.admin);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    fake.requests.length = 0;

    expect(await signedOutVia()).toBe("/bunker?sesion=local");
    expect(authCookies()).toEqual([]);
    expect(fake.requests).toEqual([]);
  });

  it("when signing out throws: clears this device anyway and says the revocation was not confirmed", async () => {
    signedInAs(accounts.admin);
    sessionClient.fail = true;

    expect(await signedOutVia()).toBe("/bunker?sesion=local");
    expect(authCookies()).toEqual([]);
    expect(fake.sessions.some((issued) => !issued.revoked)).toBe(true);
  });

  it("clears every chunk of a session stored in chunked cookies", async () => {
    // @supabase/ssr splits a large session into `<name>.0`, `<name>.1`, … with no base cookie.
    const value = sessionCookieValue(issueSession(fake, accounts.admin));
    const half = Math.ceil(value.length / 2);
    jar.set(`${AUTH_COOKIE}.0`, value.slice(0, half));
    jar.set(`${AUTH_COOKIE}.1`, value.slice(half));
    jar.set("otra-cookie", "se-queda");
    expect(await getAdminSession()).toMatchObject({ ok: true });
    fake.failAuth = { path: "/logout", status: 500 };

    expect(await signedOutVia()).toBe("/bunker?sesion=local");
    expect(authCookies()).toEqual([]);
    expect(jar.get("otra-cookie")).toBe("se-queda");
  });
});
