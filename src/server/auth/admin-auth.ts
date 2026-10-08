import "server-only";

import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { z } from "zod";
import { STORE_SLUG } from "@/server/catalog";
import { createSupabaseAdminAccess } from "@/server/catalog/admin-access";
import { reportCatalogError } from "@/server/catalog/errors";
import { createSessionClient } from "@/server/supabase/clients";
import { readSupabaseConfig } from "@/server/supabase/config";
import { AUTH_UNAVAILABLE, INVALID_CREDENTIALS, INVALID_INPUT, TOO_MANY_ATTEMPTS } from "./messages";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  password: z.string().min(1).max(256)
});

function signInFailure(error: { status?: number | undefined }) {
  if (error.status === 429) return TOO_MANY_ATTEMPTS;
  if (isAuthRetryableFetchError(error) || (error.status !== undefined && error.status >= 500)) return AUTH_UNAVAILABLE;
  return INVALID_CREDENTIALS;
}

/**
 * Email + password sign-in for manually provisioned admins (there is no sign-up). The session
 * cookies are kept only if Supabase Auth accepts the credentials *and* the user has an active
 * membership of this store; otherwise the session is signed out again on the spot. Nothing
 * about the user (`user_metadata`, claims) grants access by itself.
 */
export async function signInAdmin(email: string, password: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const credentials = credentialsSchema.safeParse({ email, password });
  if (!credentials.success) return { ok: false, message: INVALID_INPUT };

  const config = readSupabaseConfig();
  if (!config.ok) {
    reportCatalogError("admin", config.error);
    return { ok: false, message: AUTH_UNAVAILABLE };
  }
  const client = await createSessionClient(config.value);
  const { error } = await client.auth.signInWithPassword(credentials.data);
  if (error) return { ok: false, message: signInFailure(error) };

  const membership = await createSupabaseAdminAccess(client).requireStoreAdmin(STORE_SLUG);
  if (!membership.ok) {
    // Never leave a session behind for someone who is not an admin of this store.
    await client.auth.signOut({ scope: "local" });
    if (membership.error.code !== "unauthorized") reportCatalogError("admin", membership.error);
    return { ok: false, message: membership.error.code === "unauthorized" ? INVALID_CREDENTIALS : AUTH_UNAVAILABLE };
  }
  return { ok: true };
}

/** Ends this device's session: Supabase revokes it and the auth cookies are cleared. */
export async function signOutAdmin(): Promise<void> {
  const config = readSupabaseConfig();
  if (!config.ok) return;
  const client = await createSessionClient(config.value);
  await client.auth.signOut({ scope: "local" });
}
