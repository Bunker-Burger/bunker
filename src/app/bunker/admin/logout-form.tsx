"use client";

import { LogOut } from "lucide-react";
import { purgeSessionCaches } from "@/lib/session-caches";
import { logout } from "../actions";

/** Signs out after clearing what this browser may have cached for the admin session (BB-16). */
export function LogoutForm({ buttonClassName, icon = false }: { buttonClassName?: string | undefined; icon?: boolean }) {
  async function signOut() {
    // A cache that cannot be cleared never blocks signing out.
    await purgeSessionCaches().catch(() => undefined);
    await logout();
  }
  return (
    <form action={signOut}>
      {/* The admin header shows the icon of the capture; its name stays "Cerrar sesión". */}
      <button aria-label={icon ? "Cerrar sesión" : undefined} className={buttonClassName} title={icon ? "Cerrar sesión" : undefined} type="submit">
        {icon ? <LogOut aria-hidden="true" size={18} /> : "Cerrar sesión"}
      </button>
    </form>
  );
}
