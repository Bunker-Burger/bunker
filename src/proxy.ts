import type { NextRequest } from "next/server";
import { updateSupabaseSession } from "@/server/supabase/update-session";

export function proxy(request: NextRequest) {
  return updateSupabaseSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|sw.js.map|.*\\.[^/]+$).*)"]
};
