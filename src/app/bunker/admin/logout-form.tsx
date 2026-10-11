"use client";

import { purgeSessionCaches } from "@/lib/session-caches";
import { logout } from "../actions";

/** Signs out after clearing what this browser may have cached for the admin session (BB-16). */
export function LogoutForm({ buttonClassName }: { buttonClassName?: string | undefined }) {
  async function signOut() {
    // A cache that cannot be cleared never blocks signing out.
    await purgeSessionCaches().catch(() => undefined);
    await logout();
  }
  return (
    <form action={signOut}>
      <button className={buttonClassName} type="submit">
        Cerrar sesión
      </button>
    </form>
  );
}
