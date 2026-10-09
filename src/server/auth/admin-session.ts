import "server-only";

import { isAuthRetryableFetchError, type AuthError } from "@supabase/supabase-js";
import type { Result } from "@/lib/result";
import { createSupabaseAdminAccess, type AdminAccessGate, type AdminMembership } from "@/server/catalog/admin-access";
import { catalogError, type CatalogError } from "@/server/catalog/errors";
import { STORE_SLUG } from "@/server/catalog";
import { createSessionClient } from "@/server/supabase/clients";
import { readSupabaseConfig } from "@/server/supabase/config";

export interface AdminLoginCredentials {
  email: string;
  password: string;
}

export type AdminLoginOutcome =
  | { kind: "authorized"; membership: AdminMembership }
  | { kind: "rejected" }
  | { kind: "unavailable" };

interface AdminAuthClient {
  auth: {
    signInWithPassword(credentials: AdminLoginCredentials): Promise<{
      data: { user: { id: string } | null; session: unknown | null };
      error: AuthError | null;
    }>;
    signOut(options: { scope: "local" }): Promise<{ error: AuthError | null }>;
  };
}

export interface AdminAuthDependencies {
  client: AdminAuthClient;
  access: AdminAccessGate;
  storeSlug?: string;
}

export interface AdminSessionDependencies {
  client: AdminAuthClient;
  access: AdminAccessGate;
  storeSlug?: string;
}

export interface AdminLogoutDependencies {
  client: AdminAuthClient;
}

function loginErrorIsUnavailable(error: AuthError) {
  const status = error.status;
  return isAuthRetryableFetchError(error) || status === undefined || status >= 500 || status < 400;
}

async function defaultDependencies(): Promise<Result<AdminAuthDependencies, CatalogError>> {
  const config = readSupabaseConfig();
  if (!config.ok) return config;
  try {
    const client = await createSessionClient(config.value);
    return { ok: true, value: { client, access: createSupabaseAdminAccess(client) } };
  } catch (cause) {
    return catalogError("unavailable", "Could not create the admin session client", cause);
  }
}

export async function authenticateStoreAdmin(
  credentials: AdminLoginCredentials,
  dependencies?: AdminAuthDependencies
): Promise<AdminLoginOutcome> {
  const resolved = dependencies ? { ok: true as const, value: dependencies } : await defaultDependencies();
  if (!resolved.ok) return { kind: "unavailable" };
  const { client, access, storeSlug = STORE_SLUG } = resolved.value;

  let authResult: Awaited<ReturnType<AdminAuthClient["auth"]["signInWithPassword"]>>;
  try {
    authResult = await client.auth.signInWithPassword(credentials);
  } catch {
    return { kind: "unavailable" };
  }
  if (authResult.error) {
    return { kind: loginErrorIsUnavailable(authResult.error) ? "unavailable" : "rejected" };
  }
  if (!authResult.data.user) return { kind: "rejected" };

  const membership = await access.requireStoreAdmin(storeSlug);
  if (membership.ok) return { kind: "authorized", membership: membership.value };
  if (membership.error.code !== "unauthorized") return { kind: "unavailable" };

  try {
    await client.auth.signOut({ scope: "local" });
  } catch {
    // The user still receives no access; cookie deletion can be retried by the proxy/logout path.
  }
  return { kind: "rejected" };
}

export async function getCurrentStoreAdmin(
  dependencies?: AdminSessionDependencies
): Promise<Result<AdminMembership, CatalogError>> {
  const resolved = dependencies ? { ok: true as const, value: dependencies } : await defaultDependencies();
  if (!resolved.ok) return resolved;
  return resolved.value.access.requireStoreAdmin(resolved.value.storeSlug ?? STORE_SLUG);
}

export async function signOutCurrentSession(dependencies?: AdminLogoutDependencies): Promise<void> {
  const resolved = dependencies ? { ok: true as const, value: dependencies } : await defaultDependencies();
  if (!resolved.ok) return;
  await resolved.value.client.auth.signOut({ scope: "local" });
}
