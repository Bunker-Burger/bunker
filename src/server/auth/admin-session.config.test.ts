import { afterEach, describe, expect, it, vi } from "vitest";
import { clearSessionCookies } from "@/server/supabase/clients";
import { getCurrentStoreAdmin, signOutCurrentSession } from "./admin-session";

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

const currentProjectCookie = "sb-abcdefghijklmnopqrst-auth-token";
const currentProjectChunk = `${currentProjectCookie}.0`;
const otherProjectCookie = "sb-otherprojectref00000-auth-token";

afterEach(() => {
  vi.unstubAllEnvs();
  cookieJar.clear();
});

describe("admin logout configuration failures", () => {
  it("does not redirect or silently report success when project configuration is missing", async () => {
    cookieJar.set(currentProjectCookie, "session");
    cookieJar.set(currentProjectChunk, "chunk");
    cookieJar.set(otherProjectCookie, "other-session");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("SUPABASE_PROJECT_ENV", "");

    await expect(signOutCurrentSession()).rejects.toThrow("Admin logout unavailable");
    expect(cookieJar.get(currentProjectCookie)).toBe("session");
    expect(cookieJar.get(currentProjectChunk)).toBe("chunk");
    expect(cookieJar.get(otherProjectCookie)).toBe("other-session");

    // The same invalid configuration is the server-side admin gate: a request
    // carrying the old cookie is unavailable/denied, never authorized.
    await expect(getCurrentStoreAdmin()).resolves.toMatchObject({
      ok: false,
      error: { code: "misconfigured" }
    });
  });

  it("clears only the validated project's session after configuration is restored", async () => {
    cookieJar.set(currentProjectCookie, "session");
    cookieJar.set(currentProjectChunk, "chunk");
    cookieJar.set(otherProjectCookie, "other-session");

    await clearSessionCookies({
      url: "https://abcdefghijklmnopqrst.supabase.co",
      publishableKey: "sb_publishable_test",
      projectRef: "abcdefghijklmnopqrst",
      projectEnv: "development"
    });

    expect(cookieJar.has(currentProjectCookie)).toBe(false);
    expect(cookieJar.has(currentProjectChunk)).toBe(false);
    expect(cookieJar.get(otherProjectCookie)).toBe("other-session");
  });
});
