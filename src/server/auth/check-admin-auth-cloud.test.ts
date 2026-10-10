import { afterEach, describe, expect, it, vi } from "vitest";
// The trusted harness is plain Node ESM so it can run from main without installing app code.
// @ts-expect-error The JavaScript module carries its own runtime contract and is tested below.
import { isBunkerOwner, run } from "../../../scripts/check-admin-auth-cloud.mjs";

const env = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_TEST_ADMIN_EMAIL: "owner@example.com",
  SUPABASE_TEST_ADMIN_PASSWORD: "password-that-never-logs",
  EXPECTED_PROJECT_REF: "abcdefghijklmnopqrst"
};

afterEach(() => vi.restoreAllMocks());

describe("trusted Auth cloud harness", () => {
  it.each([
    ["bunker owner", [{ role: "owner", is_active: true, stores: { slug: "bunker-burger" } }], true],
    ["other store owner", [{ role: "owner", is_active: true, stores: { slug: "other-store" } }], false],
    ["inactive bunker owner", [{ role: "owner", is_active: false, stores: { slug: "bunker-burger" } }], false],
    ["missing membership", [], false]
  ])("accepts only the active bunker-burger owner (%s)", (_name, rows, expected) => {
    expect(isBunkerOwner(rows)).toBe(expected);
  });

  it("uses local logout, checks HTTP 204, and filters the bunker store", async () => {
    const calls: Array<{ url: string; init?: RequestInit | undefined }> = [];
    const fakeFetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.includes("/token?grant_type=password") && JSON.parse(String(init?.body)).password.endsWith("-invalid")) return new Response("{}", { status: 400 });
      if (url.includes("/token?grant_type=password")) return new Response(JSON.stringify({ access_token: "access-token", user: { id: "user-id" } }), { status: 200 });
      if (url.includes("admin_memberships")) return new Response(JSON.stringify([{ role: "owner", is_active: true, stores: { slug: "bunker-burger" } }]), { status: 200 });
      if (url.includes("/auth/v1/logout")) return new Response(null, { status: 204 });
      throw new Error(`unexpected URL ${url}`);
    });

    await expect(run(fakeFetch, env, false)).resolves.toMatchObject({ passed: true });
    const membershipCall = calls.find((call) => call.url.includes("admin_memberships"));
    expect(membershipCall?.url).toContain("stores!inner(slug)");
    expect(membershipCall?.url).toContain("stores.slug=eq.bunker-burger");
    const logoutCall = calls.find((call) => call.url.includes("/auth/v1/logout"));
    expect(logoutCall?.url).toBe("https://abcdefghijklmnopqrst.supabase.co/auth/v1/logout?scope=local");
    expect(logoutCall?.init?.method).toBe("POST");
    expect(logoutCall?.init?.headers).toMatchObject({ Authorization: "Bearer access-token" });
  });

  it("fails when local logout is not confirmed with HTTP 204", async () => {
    const fakeFetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/token?grant_type=password") && JSON.parse(String(init?.body)).password.endsWith("-invalid")) return new Response("{}", { status: 400 });
      if (url.includes("/token?grant_type=password")) return new Response(JSON.stringify({ access_token: "access-token", user: { id: "user-id" } }), { status: 200 });
      if (url.includes("admin_memberships")) return new Response(JSON.stringify([{ role: "owner", is_active: true, stores: { slug: "bunker-burger" } }]), { status: 200 });
      return new Response(null, { status: 500 });
    });

    await expect(run(fakeFetch, env, false)).resolves.toMatchObject({ passed: false });
  });
});
