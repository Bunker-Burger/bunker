import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config as proxyConfig } from "@/proxy";
import {
  accounts,
  AUTH_COOKIE,
  installFakeSupabase,
  issueSession,
  sessionCookieValue,
  stubSupabaseEnv,
  type FakeSupabase
} from "@/test/fake-supabase-auth";
import { refreshSession } from "./refresh-session";

/*
 * The proxy keeps Supabase session cookies fresh (Server Components cannot write cookies):
 * an expired access token is refreshed once, here, and the rotated tokens reach both the page
 * being rendered and the browser.
 */

let fake: FakeSupabase;

beforeEach(() => {
  stubSupabaseEnv();
  fake = installFakeSupabase();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const request = (path: string, cookie?: string) =>
  new NextRequest(`http://localhost${path}`, cookie ? { headers: { cookie: `${AUTH_COOKIE}=${cookie}` } } : {});

const decodeCookie = (value: string) => JSON.parse(Buffer.from(value.replace(/^base64-/, ""), "base64url").toString("utf8"));

describe("refreshSession (proxy)", () => {
  it("costs nothing for visitors without an auth cookie", async () => {
    const response = await refreshSession(request("/"));
    expect(fake.requests).toEqual([]);
    expect(response.cookies.getAll()).toEqual([]);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("rotates an expired session and hands the new tokens to the page and to the browser", async () => {
    const expired = issueSession(fake, accounts.admin, { expired: true });
    const response = await refreshSession(request("/bunker/admin", sessionCookieValue(expired)));

    expect(fake.requests.filter(({ path }) => path.includes("grant_type=refresh_token"))).toHaveLength(1);
    const written = response.cookies.get(AUTH_COOKIE);
    expect(written?.value).toBeTruthy();
    const rotated = decodeCookie(written!.value);
    expect(rotated.refresh_token).not.toBe(expired.refresh_token);
    expect(rotated.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(written).toMatchObject({ path: "/", sameSite: "lax", httpOnly: false });
    // The rendering request sees the rotated cookie too (no second refresh downstream).
    expect(response.headers.get("x-middleware-override-headers")).toContain("cookie");
    expect(response.headers.get("x-middleware-request-cookie")).toContain(written!.value);
    // A response that sets a session is never stored by shared caches.
    expect(response.headers.get("cache-control")).toMatch(/no-store/);
  });

  it("clears the cookies of a session that can no longer be refreshed", async () => {
    const expired = issueSession(fake, accounts.admin, { expired: true });
    fake.sessions[0]!.revoked = true;
    const response = await refreshSession(request("/bunker/admin", sessionCookieValue(expired)));
    expect(response.cookies.get(AUTH_COOKIE)?.value ?? "").toBe("");
  });

  it("leaves a valid session untouched", async () => {
    const valid = issueSession(fake, accounts.admin);
    const response = await refreshSession(request("/", sessionCookieValue(valid)));
    expect(fake.requests.some(({ path }) => path.includes("grant_type=refresh_token"))).toBe(false);
    expect(response.cookies.get(AUTH_COOKIE)).toBeUndefined();
  });

  it("runs on the pages that read the admin session, not on APIs or static assets", () => {
    expect(proxyConfig.matcher).toEqual(["/", "/bunker", "/bunker/:path*"]);
  });
});
