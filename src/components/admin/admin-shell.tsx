"use client";

import { Settings2, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { BottomNav, type BottomNavItem } from "@/components/shell/bottom-nav";
import { AppShell, SiteHeader } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";

export const ADMIN_NAV_ITEM: BottomNavItem = { href: "/bunker/admin", label: "Admin", icon: Settings2 };

interface AdminShellProps {
  /** Only a validated admin session shows the Admin tab. */
  signedIn: boolean;
  children: ReactNode;
}

/** Frame for `/bunker/**`: normal navigation back to the menu, plus Admin during a valid session. */
export function AdminShell({ signedIn, children }: AdminShellProps) {
  const items: BottomNavItem[] = [{ href: "/", label: "Menú", icon: UtensilsCrossed }, ...(signedIn ? [ADMIN_NAV_ITEM] : [])];
  return (
    <AppShell
      header={
        <SiteHeader>
          <Link className="font-display text-title font-bold tracking-display text-primary" href="/">
            BÚNKER BURGER
          </Link>
          <Badge variant="neutral">Administración</Badge>
        </SiteHeader>
      }
      bottomNav={<BottomNav {...(signedIn ? { activeHref: ADMIN_NAV_ITEM.href } : {})} items={items} />}
    >
      {children}
    </AppShell>
  );
}
