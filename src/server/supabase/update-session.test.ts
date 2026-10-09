import { createServerClient } from "@supabase/ssr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { updateSupabaseSession } from "./update-session";

vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn() }));

const createServerClientMock = vi.mocked(createServerClient);

type CookieToSet = {
  name: string;
  value: string;
  options: {
    httpOnly?: boolean;
    path?: string;
    sameSite?: "lax" | "strict" | "none";
    secure?: boolean;
  };
};

interface CookieAdapter {
  getAll(): Array<{ name: string; value: string }>;
  setAll(cookies: CookieToSet[]): void;
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.stubEnv("SUPABASE_PROJECT_ENV", "development");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("SUPABASE_PRODUCTION_PROJECT_REF", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("updateSupabaseSession", () => {
  it("copies refreshed cookies to the forwarded request and response with all options", async () => {
    createServerClientMock.mockImplementation(((_url: string, _key: string, options: { cookies: CookieAdapter }) => ({
      auth: {
        getClaims: async () => {
          expect(options.cookies.getAll()).toEqual([expect.objectContaining({ name: "existing", value: "1" })]);
          options.cookies.setAll([
            {
              name: "sb-refresh",
              value: "new-token",
              options: { httpOnly: true, path: "/", sameSite: "lax", secure: true }
            }
          ]);
          return { data: { claims: { sub: "user-1" } }, error: null };
        }
      }
    })) as typeof createServerClient);

    const request = new NextRequest("http://localhost/bunker", { headers: { cookie: "existing=1" } });
    const response = await updateSupabaseSession(request);

    expect(request.cookies.get("sb-refresh")?.value).toBe("new-token");
    expect(response.cookies.get("sb-refresh")?.value).toBe("new-token");
    expect(response.headers.get("set-cookie")).toContain("sb-refresh=new-token");
    expect(response.headers.get("set-cookie")).toContain("Path=/");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=lax");
    expect(response.headers.get("set-cookie")).toContain("Secure");
  });

  it("calls getClaims rather than getSession and returns a no-store response after refresh", async () => {
    const getClaims = vi.fn(async () => ({ data: { claims: null }, error: null }));
    const auth = Object.defineProperty({ getClaims }, "getSession", {
      get: () => {
        throw new Error("getSession must not be used on the server");
      }
    });
    createServerClientMock.mockReturnValue({ auth } as never);

    const response = await updateSupabaseSession(new NextRequest("http://localhost/bunker/admin"));

    expect(getClaims).toHaveBeenCalledOnce();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("keeps the public request reachable when Supabase configuration is absent", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");

    const response = await updateSupabaseSession(new NextRequest("http://localhost/"));

    expect(response.status).toBe(200);
    expect(createServerClientMock).not.toHaveBeenCalled();
  });
});
