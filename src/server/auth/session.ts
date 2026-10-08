import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Result } from "@/lib/result";
import { STORE_SLUG } from "@/server/catalog";
import { createSupabaseAdminAccess, type AdminMembership } from "@/server/catalog/admin-access";
import { catalogError, reportCatalogError, type CatalogError } from "@/server/catalog/errors";
import { createSessionClient } from "@/server/supabase/clients";
import { readSupabaseConfig } from "@/server/supabase/config";
import { isAuthCookieName } from "./auth-cookie";
import { ADMIN_HOME, loginPathFor } from "./safe-redirect";

export type AdminSession = AdminMembership;

/**
 * The signed-in admin of this store, decided on the server on every request: Supabase Auth
 * validates the session (`getUser`, never the cookie alone nor `user_metadata`), then an active
 * row in `admin_memberships` for the store is required. Memoized per render pass.
 *
 * `unauthorized`: no session, an expired/revoked one, or a user without an active membership
 * of this store. `unavailable`/`misconfigured`: the check itself could not run.
 */
export const getAdminSession = cache(async (storeSlug: string = STORE_SLUG): Promise<Result<AdminSession, CatalogError>> => {
  // No auth cookie, no session: anonymous visitors never cost a call to Supabase.
  if (!(await cookies()).getAll().some(({ name }) => isAuthCookieName(name))) {
    return catalogError("unauthorized", "no session cookie");
  }
  const config = readSupabaseConfig();
  if (!config.ok) {
    reportCatalogError("admin", config.error);
    return config;
  }
  const client = await createSessionClient(config.value);
  return createSupabaseAdminAccess(client).requireStoreAdmin(storeSlug);
});

/**
 * Gate for every page under `/bunker/admin`: anyone who is not an active admin is sent to the
 * login (which returns to `path` afterwards). A check that could not run is returned as an
 * error for the page to show; it never grants access.
 */
export async function requireAdminSession(path: string = ADMIN_HOME): Promise<Result<AdminSession, CatalogError>> {
  const session = await getAdminSession();
  if (!session.ok && session.error.code === "unauthorized") redirect(loginPathFor(path));
  if (!session.ok) reportCatalogError("admin", session.error);
  return session;
}

/** Whether the current visitor is a signed-in active admin (for the Admin tab only). */
export async function hasAdminSession(): Promise<boolean> {
  const session = await getAdminSession();
  return session.ok;
}
