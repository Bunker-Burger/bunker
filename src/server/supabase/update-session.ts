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
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      }
    }
  });

  await client.auth.getClaims();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
