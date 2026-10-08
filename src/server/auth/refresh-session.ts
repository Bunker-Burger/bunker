import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { readSupabaseConfig } from "@/server/supabase/config";
import type { Database } from "@/server/supabase/database.types";
import { isAuthCookieName } from "./auth-cookie";

/** Whether the request carries a Supabase auth cookie (possibly chunked: `.0`, `.1`, …). */
export function hasAuthCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some(({ name }) => isAuthCookieName(name));
}

/**
 * Keeps the Supabase session cookies fresh, as `@supabase/ssr` recommends for Next: Server
 * Components cannot write cookies, so an expired access token is refreshed here, once per
 * request, and the rotated tokens go both to the rendering request and to the browser.
 *
 * This is not authorization: pages and actions still validate the session and the admin
 * membership on the server (`getAdminSession`). Visitors without an auth cookie cost nothing.
 */
export async function refreshSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  if (!hasAuthCookie(request)) return response;
  const config = readSupabaseConfig();
  if (!config.ok) return response;

  const supabase = createServerClient<Database>(config.value.url, config.value.publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        // Cache-Control and friends, so a response that sets a session is never shared.
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      }
    }
  });
  // Validates the token (refreshing it when expired); a failure just leaves no valid session.
  await supabase.auth.getClaims();
  return response;
}
