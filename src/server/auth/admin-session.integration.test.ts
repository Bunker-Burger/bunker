import { beforeEach, describe, expect, it, vi } from "vitest";
import { readSupabaseConfig } from "@/server/supabase/config";
import { authenticateStoreAdmin, getCurrentStoreAdmin, signOutCurrentSession } from "./admin-session";

/*
 * Cloud DEVELOPMENT verification for the real password Auth -> SSR cookies -> getUser() ->
 * admin_memberships path. Credentials are optional locally and mandatory for release evidence.
 */
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

const config = readSupabaseConfig();
const credentials = {
  email: process.env.SUPABASE_TEST_ADMIN_EMAIL ?? "",
  password: process.env.SUPABASE_TEST_ADMIN_PASSWORD ?? ""
};
const enabled = config.ok && config.value.projectEnv === "development" && Boolean(credentials.email && credentials.password);

describe.skipIf(!enabled)("admin session (cloud development project)", () => {
  beforeEach(() => cookieJar.clear());

  it("authenticates the sole owner, reads the same current membership, and revokes the local session", async () => {
    const authenticated = await authenticateStoreAdmin(credentials);
    expect(authenticated).toMatchObject({
      kind: "authorized",
      membership: { role: "owner" }
    });
    if (authenticated.kind !== "authorized") throw new Error(`expected authorized, got ${authenticated.kind}`);

    const current = await getCurrentStoreAdmin();
    expect(current).toEqual({ ok: true, value: authenticated.membership });

    await signOutCurrentSession();
    expect(await getCurrentStoreAdmin()).toMatchObject({ ok: false, error: { code: "unauthorized" } });
  });

  it("rejects an invalid password without creating an authenticated session", async () => {
    const result = await authenticateStoreAdmin({ email: credentials.email, password: `${credentials.password}-invalid` });
    expect(result).toEqual({ kind: "rejected" });
    expect(await getCurrentStoreAdmin()).toMatchObject({ ok: false, error: { code: "unauthorized" } });
  });
});
