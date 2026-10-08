import { vi } from "vitest";

/*
 * In-process stand-in for the network side of Supabase (GoTrue + PostgREST), so auth tests run
 * the real clients (`@supabase/ssr`, `getUser`, refresh, `signOut`) and the real repositories.
 * It models what matters for BB-11: password sign-in, access-token expiry, refresh-token
 * rotation and revocation, logout, and RLS on `admin_memberships` (a user sees only their rows).
 *
 * Like the real services, the two halves judge an access token differently:
 * - GoTrue (`/auth/v1/user`, what `getUser()` calls) also looks up the token's session, so a
 *   signed-out (revoked) session is refused at once.
 * - PostgREST (`/rest/v1/*`) only verifies the JWT (signature, `exp`) and applies RLS on
 *   `auth.uid()`: a copied access token keeps working there until it expires, even after logout.
 */

export const SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
export const AUTH_COOKIE = "sb-abcdefghijklmnopqrst-auth-token";
export const STORE = { id: "store-1", slug: "bunker-burger" };

export interface FakeUser {
  id: string;
  email: string;
  password: string;
  /** Free-form profile data; must never grant anything. */
  userMetadata?: Record<string, unknown>;
  memberships: Array<{ storeId: string; storeSlug: string; role: "owner" | "admin"; active: boolean }>;
}

interface IssuedSession {
  userId: string;
  refreshToken: string;
  revoked: boolean;
}

export const accounts = {
  admin: { id: "u-admin", email: "duena@bunker.test", password: "clave-correcta", memberships: [{ storeId: STORE.id, storeSlug: STORE.slug, role: "owner", active: true }] },
  // Claims to be an admin in its profile, but has no membership row.
  metadataAdmin: { id: "u-meta", email: "meta@bunker.test", password: "clave-meta", userMetadata: { role: "admin", is_admin: true, store: STORE.slug }, memberships: [] },
  // Admin of a different store: cross access must be refused.
  otherStore: { id: "u-other", email: "otra@tienda.test", password: "clave-otra", memberships: [{ storeId: "store-2", storeSlug: "otra-tienda", role: "owner", active: true }] },
  // No membership, and a profile big enough that @supabase/ssr stores the session in chunks.
  largeProfile: { id: "u-large", email: "grande@bunker.test", password: "clave-grande", userMetadata: { bio: "x".repeat(4000) }, memberships: [] },
  // Membership switched off by the owner.
  inactive: { id: "u-inactive", email: "baja@bunker.test", password: "clave-baja", memberships: [{ storeId: STORE.id, storeSlug: STORE.slug, role: "admin", active: false }] }
} satisfies Record<string, FakeUser>;

export interface FakeSupabase {
  users: FakeUser[];
  sessions: IssuedSession[];
  requests: Array<{ method: string; path: string }>;
  /** Overrides the response of an auth endpoint (e.g. 429 or 500); `"network"` rejects the request. */
  failAuth: { path: string; status: number | "network" } | null;
  /** Access tokens issued from now on are already expired. */
  issueExpiredTokens: boolean;
  now: () => number;
}

const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function accessToken(userId: string, refreshToken: string, expiresAt: number) {
  const header = base64url({ alg: "HS256", typ: "JWT" });
  const payload = base64url({ sub: userId, aud: "authenticated", role: "authenticated", exp: expiresAt, session_id: refreshToken });
  return `${header}.${payload}.fake-signature`;
}

function decode(token: string): { sub: string; exp: number; session_id: string } | null {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function userBody(user: FakeUser) {
  return {
    id: user.id,
    aud: "authenticated",
    role: "authenticated",
    email: user.email,
    app_metadata: { provider: "email" },
    user_metadata: user.userMetadata ?? {},
    created_at: "2026-10-01T00:00:00Z"
  };
}

export function createFakeSupabase(): FakeSupabase {
  return { users: Object.values(accounts), sessions: [], requests: [], failAuth: null, issueExpiredTokens: false, now: () => Date.now() };
}

/** A session object as GoTrue returns it (and as `@supabase/ssr` stores it in the cookie). */
export function issueSession(fake: FakeSupabase, user: FakeUser, options: { expired?: boolean } = {}) {
  const refreshToken = `refresh-${user.id}-${fake.sessions.length + 1}`;
  fake.sessions.push({ userId: user.id, refreshToken, revoked: false });
  const nowSeconds = Math.floor(fake.now() / 1000);
  const expiresAt = options.expired || fake.issueExpiredTokens ? nowSeconds - 60 : nowSeconds + 3600;
  return {
    access_token: accessToken(user.id, refreshToken, expiresAt),
    refresh_token: refreshToken,
    token_type: "bearer",
    expires_in: expiresAt - nowSeconds,
    expires_at: expiresAt,
    user: userBody(user)
  };
}

/** Cookie value `@supabase/ssr` writes for a session (base64url encoding, single chunk). */
export function sessionCookieValue(session: ReturnType<typeof issueSession>) {
  return `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
}

/** PostgREST's view of the caller: a well-formed, unexpired JWT is enough (no session lookup). */
function jwtUser(fake: FakeSupabase, headers: Headers): FakeUser | "expired" | null {
  const claims = decode(headers.get("authorization")?.replace(/^Bearer /, "") ?? "");
  if (!claims) return null;
  if (claims.exp * 1000 <= fake.now()) return "expired";
  return fake.users.find((user) => user.id === claims.sub) ?? null;
}

/** GoTrue's view: the JWT must also belong to a session that still exists (not signed out). */
function authUser(fake: FakeSupabase, headers: Headers): FakeUser | "expired" | null {
  const user = jwtUser(fake, headers);
  if (user === null || user === "expired") return user;
  const claims = decode(headers.get("authorization")?.replace(/^Bearer /, "") ?? "");
  const session = fake.sessions.find((candidate) => candidate.refreshToken === claims?.session_id);
  return session && !session.revoked ? user : null;
}

async function handleAuth(fake: FakeSupabase, url: URL, init: RequestInit, headers: Headers): Promise<Response> {
  const path = url.pathname.replace("/auth/v1", "");
  if (fake.failAuth && fake.failAuth.path === path) {
    if (fake.failAuth.status === "network") throw new TypeError("fetch failed");
    return json({ code: "unexpected_failure", message: "Simulated failure" }, fake.failAuth.status);
  }
  const body = init.body ? JSON.parse(String(init.body)) : {};

  if (path === "/token" && url.searchParams.get("grant_type") === "password") {
    const user = fake.users.find((candidate) => candidate.email === body.email && candidate.password === body.password);
    return user ? json(issueSession(fake, user)) : json({ code: "invalid_credentials", message: "Invalid login credentials" }, 400);
  }
  if (path === "/token" && url.searchParams.get("grant_type") === "refresh_token") {
    const session = fake.sessions.find((candidate) => candidate.refreshToken === body.refresh_token && !candidate.revoked);
    const user = session && fake.users.find((candidate) => candidate.id === session.userId);
    if (!session || !user) return json({ code: "refresh_token_not_found", message: "Invalid Refresh Token: Refresh Token Not Found" }, 400);
    session.revoked = true; // rotation: a refresh token is single-use
    return json(issueSession(fake, user));
  }
  if (path === "/user") {
    const user = authUser(fake, headers);
    if (user === "expired") return json({ code: "bad_jwt", message: "invalid JWT: token is expired" }, 403);
    return user ? json(userBody(user)) : json({ code: "session_not_found", message: "Session from session_id claim in JWT does not exist" }, 403);
  }
  if (path === "/logout") {
    const claims = decode(headers.get("authorization")?.replace(/^Bearer /, "") ?? "");
    for (const session of fake.sessions) if (session.refreshToken === claims?.session_id) session.revoked = true;
    return new Response(null, { status: 204 });
  }
  return json({ message: `unexpected auth path ${path}` }, 404);
}

function handleRest(fake: FakeSupabase, url: URL, headers: Headers): Response {
  const table = url.pathname.replace("/rest/v1/", "");
  const caller = jwtUser(fake, headers);
  const user = caller === "expired" ? null : caller;
  switch (table) {
    case "admin_memberships": {
      // RLS `memberships_read_self`: anonymous callers see nothing, users only their own rows.
      const userFilter = url.searchParams.get("user_id")?.replace(/^eq\./, "");
      const slugFilter = url.searchParams.get("stores.slug")?.replace(/^eq\./, "");
      const activeFilter = url.searchParams.get("is_active");
      const rows = (user?.memberships ?? [])
        .filter(() => !userFilter || userFilter === user?.id)
        .filter((membership) => !slugFilter || membership.storeSlug === slugFilter)
        .filter((membership) => activeFilter !== "eq.true" || membership.active)
        .map((membership) => ({ store_id: membership.storeId, role: membership.role, is_active: membership.active, stores: { slug: membership.storeSlug } }));
      return json(rows);
    }
    case "stores": {
      const row = {
        id: STORE.id,
        name: "Búnker Burger",
        slug: STORE.slug,
        whatsapp_e164: "+5493865207458",
        timezone: "America/Argentina/Tucuman",
        currency: "ARS",
        status_override: "auto",
        is_public: true,
        delivery_fee_cents: "120000",
        store_business_hours: [],
        store_payment_methods: []
      };
      return json(headers.get("accept")?.includes("vnd.pgrst.object") ? row : [row]);
    }
    default:
      return json([]);
  }
}

/** Replaces global fetch with the fake; returns it for assertions. */
export function installFakeSupabase(fake: FakeSupabase = createFakeSupabase()): FakeSupabase {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const request = input instanceof Request ? input : null;
      const url = new URL(request ? request.url : String(input));
      const headers = new Headers(init.headers ?? request?.headers);
      const method = init.method ?? request?.method ?? "GET";
      const body = init.body ?? (request && method !== "GET" ? await request.text() : undefined);
      fake.requests.push({ method, path: `${url.pathname}${url.search}` });
      if (url.origin !== SUPABASE_URL) throw new Error(`unexpected request ${url.href}`);
      if (url.pathname.startsWith("/auth/v1/")) return handleAuth(fake, url, { ...init, body: body ?? null }, headers);
      return handleRest(fake, url, headers);
    })
  );
  return fake;
}

export function stubSupabaseEnv() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.stubEnv("SUPABASE_PROJECT_ENV", "development");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("SUPABASE_PRODUCTION_PROJECT_REF", "");
}
