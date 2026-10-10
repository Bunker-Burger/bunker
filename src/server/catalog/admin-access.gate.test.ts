import { AuthApiError, AuthSessionMissingError, type AuthError, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/server/supabase/database.types";
import { createSupabaseAdminAccess } from "./admin-access";

type GateUserResult = { data: { user: { id: string } | null }; error: AuthError | null };

function gate(userResult: GateUserResult, rows: unknown[]) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    then: (resolve: (value: { data: unknown[]; error: null; status: number }) => unknown) =>
      Promise.resolve(resolve({ data: rows, error: null, status: 200 }))
  };
  const client = {
    auth: { getUser: async () => userResult },
    from: () => builder
  } as unknown as SupabaseClient<Database>;
  return createSupabaseAdminAccess(client).requireStoreAdmin("bunker-burger");
}

const ownerRow = { store_id: "store-1", role: "owner", is_active: true, stores: { slug: "bunker-burger" } };

describe("admin authorization gate through the Supabase client boundary", () => {
  it.each([
    ["missing session", { data: { user: null }, error: null }],
    ["expired session", { data: { user: null }, error: new AuthApiError("expired", 403, "bad_jwt") }],
    ["revoked session", { data: { user: null }, error: new AuthApiError("revoked", 400, "refresh_token_not_found") }]
  ] as const)("rejects %s before reading memberships", async (_case, userResult) => {
    await expect(gate(userResult as GateUserResult, [ownerRow])).resolves.toMatchObject({ ok: false, error: { code: "unauthorized" } });
  });

  it("rejects a session whose Auth user exists but whose membership is inactive", async () => {
    await expect(
      gate({ data: { user: { id: "user-1" } }, error: null } satisfies GateUserResult, [
        { ...ownerRow, is_active: false }
      ])
    ).resolves.toMatchObject({ ok: false, error: { code: "unauthorized" } });
  });

  it("rejects an active membership belonging to another store", async () => {
    await expect(
      gate({ data: { user: { id: "user-1" } }, error: null } satisfies GateUserResult, [
        { ...ownerRow, stores: { slug: "other-store" } }
      ])
    ).resolves.toMatchObject({ ok: false, error: { code: "unauthorized" } });
  });

  it("authorizes only the active membership returned for the requested store", async () => {
    await expect(gate({ data: { user: { id: "user-1" } }, error: null } satisfies GateUserResult, [ownerRow])).resolves.toEqual({
      ok: true,
      value: { userId: "user-1", storeId: "store-1", role: "owner" }
    });
  });

  it("keeps a missing Supabase session unauthorized even when membership data is present", async () => {
    await expect(gate({ data: { user: null }, error: new AuthSessionMissingError() } satisfies GateUserResult, [ownerRow])).resolves.toMatchObject({
      ok: false,
      error: { code: "unauthorized" }
    });
  });
});
