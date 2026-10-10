import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { readSupabaseConfig } from "./config";
import type { Database } from "./database.types";

/** Refreshes Supabase's SSR session cookies without making authorization decisions. */
export async function updateSupabaseSession(request: NextRequest): Promise<NextResponse> {
  const config = readSupabaseConfig();
  if (!config.ok) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const client = createServerClient<Database>(config.value.url, config.value.publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headersToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [name, value] of Object.entries(headersToSet)) response.headers.set(name, value);
      }
    }
  });

  await client.auth.getClaims();
  if (!response.headers.has("Cache-Control")) response.headers.set("Cache-Control", "private, no-store");
  return response;
}
