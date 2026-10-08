import { isAuthRetryableFetchError, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ok, type Result } from "@/lib/result";
import { Constants, type Database } from "@/server/supabase/database.types";
import { parseRows } from "./adapters";
import { catalogError, fromSupabaseError, type CatalogError } from "./errors";

export interface AdminMembership {
  userId: string;
  /** Sign-in email, for display only; authorization never depends on it. */
  email: string | null;
  storeId: string;
  role: Database["public"]["Enums"]["admin_role"];
}

/**
 * Confirms that the current session belongs to an active admin of a store before any
 * administrative read. RLS stays the authoritative filter; this gate keeps a missing,
 * expired or non-admin session from receiving the public subset as an "admin" catalog.
 */
export interface AdminAccessGate {
  requireStoreAdmin(storeSlug: string): Promise<Result<AdminMembership, CatalogError>>;
}

/**
 * Auth failures: transport problems (retryable fetch errors, 5xx) are `unavailable`; every
 * other auth error (no session, expired or revoked session, invalid JWT) is `unauthorized`.
 */
export function fromAuthError(error: unknown) {
  const status = typeof error === "object" && error !== null && "status" in error ? Number(error.status) : undefined;
  const message = error instanceof Error ? error.message : String(error);
  if (isAuthRetryableFetchError(error) || (status !== undefined && status >= 500)) {
    return catalogError("unavailable", `auth.getUser failed: ${message}`, error);
  }
  return catalogError("unauthorized", `auth.getUser: no valid session (${message})`, error);
}

const membershipRowSchema = z.object({
  store_id: z.string(),
  role: z.enum(Constants.public.Enums.admin_role),
  is_active: z.boolean(),
  stores: z.object({ slug: z.string() }).nullable()
});
type MembershipRow = z.output<typeof membershipRowSchema>;

export const MEMBERSHIP_SELECT = "store_id, role, is_active, stores!inner(slug)";

/** Picks the active membership of `userId` for the store `storeSlug`, or `unauthorized`. */
export function membershipForStore(
  userId: string,
  rows: MembershipRow[],
  storeSlug: string,
  email: string | null = null
): Result<AdminMembership, CatalogError> {
  const membership = rows.find((row) => row.is_active && row.stores?.slug === storeSlug);
  return membership
    ? ok({ userId, email, storeId: membership.store_id, role: membership.role })
    : catalogError("unauthorized", `admin_memberships: user is not an active admin of "${storeSlug}"`);
}

export function createSupabaseAdminAccess(client: SupabaseClient<Database>): AdminAccessGate {
  return {
    async requireStoreAdmin(storeSlug) {
      let userId: string;
      let email: string | null;
      try {
        // getUser() validates the session with Supabase Auth (expiry, revocation, signature);
        // getSession() would trust whatever the cookie says.
        const { data, error } = await client.auth.getUser();
        if (error) return fromAuthError(error);
        if (!data.user) return catalogError("unauthorized", "auth.getUser: no user in session");
        userId = data.user.id;
        email = data.user.email ?? null;
      } catch (thrown) {
        return fromAuthError(thrown);
      }

      try {
        const { data, error, status } = await client
          .from("admin_memberships")
          .select(MEMBERSHIP_SELECT)
          .eq("user_id", userId)
          .eq("is_active", true)
          .eq("stores.slug", storeSlug);
        if (error) return fromSupabaseError("admin_memberships.select", error, status);
        const rows = parseRows("admin_memberships", membershipRowSchema, data);
        return rows.ok ? membershipForStore(userId, rows.value, storeSlug, email) : rows;
      } catch (thrown) {
        return fromSupabaseError("admin_memberships.select", thrown);
      }
    }
  };
}
