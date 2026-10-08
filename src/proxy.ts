import type { NextRequest } from "next/server";
import { refreshSession } from "@/server/auth/refresh-session";

export async function proxy(request: NextRequest) {
  return refreshSession(request);
}

export const config = {
  // Every page that reads the admin session: the storefront (Admin tab) and `/bunker/**`.
  matcher: ["/", "/bunker", "/bunker/:path*"]
};
