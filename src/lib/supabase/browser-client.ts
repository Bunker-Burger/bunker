import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/server/supabase/database.types";

/**
 * Browser client for auth flows (session cookies shared with the server). Catalog data never
 * goes through it: UI components receive domain objects from server repositories.
 * The `NEXT_PUBLIC_*` variables are referenced literally so Next can inline them.
 */
export function getBrowserSupabaseClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required");
  }
  return createBrowserClient<Database>(url, publishableKey);
}
