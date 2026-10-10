import "server-only";

import { clearAuthCookiesAtScopes, createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { SupabaseConfig } from "./config";
import type { Database } from "./database.types";

/** Cache tag for every public catalog read; admin mutations revalidate it. */
export const CATALOG_CACHE_TAG = "catalog";
/** Public catalog responses are reused for up to five minutes. */
export const CATALOG_REVALIDATE_SECONDS = 300;

/**
 * Anonymous, cookie-less client for public catalog reads. Its responses go through Next's
 * data cache (tagged `catalog`), which is safe because they carry no user data.
 */
export function createPublicReadClient(config: SupabaseConfig): SupabaseClient<Database> {
  return createClient<Database>(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          cache: "force-cache",
          next: { revalidate: CATALOG_REVALIDATE_SECONDS, tags: [CATALOG_CACHE_TAG] }
        })
    }
  });
}

/**
 * Anonymous, cookie-less client for operational reads that must reflect the database right
 * now (store open/paused/closed, hours, delivery fee). Never cached: a pause or a fee change
 * must reach the next status check, quote or payment without waiting for a tag revalidation.
 */
export function createOperationalReadClient(config: SupabaseConfig): SupabaseClient<Database> {
  return createClient<Database>(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) }
  });
}

/**
 * Client acting as the signed-in user (session from cookies), for administrative reads.
 * Requests opt out of every cache so one admin's data is never served to another request.
 */
export async function createSessionClient(config: SupabaseConfig): Promise<SupabaseClient<Database>> {
  const cookieStore = await cookies();
  return createServerClient<Database>(config.url, config.publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Server Components cannot set cookies; the session refresh happens in a Server
          // Function or Route Handler on the next request instead.
        }
      }
    },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) }
  });
}

/** Clears only this project's SSR auth cookie chunks at the root path. */
export async function clearSessionCookies(config: SupabaseConfig): Promise<void> {
  const cookieStore = await cookies();
  await clearAuthCookiesAtScopes({
    getAll: () => cookieStore.getAll(),
    setAll: async (cookiesToSet) => {
      for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
    },
    storageKey: `sb-${config.projectRef}-auth-token`,
    scopes: [{ path: "/" }]
  });
}
