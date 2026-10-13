"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useVirtualKeyboardOpen } from "./use-virtual-keyboard";

export interface BottomNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
  /** Accessible name when the visible label alone says too little (e.g. "Carrito, 2 productos"). */
  ariaLabel?: string;
}

interface BottomNavProps {
  items: BottomNavItem[];
  activeHref?: string;
  label?: string;
}

/**
 * The app's only bottom bar: full-width with safe-area padding on mobile, floating pill on desktop.
 * The current item is a filled amber pill, as in the canonical captures (issue #54).
 * It hides while the on-screen keyboard is open so it never covers the field being edited.
 */
export function BottomNav({ items, activeHref, label = "Navegación principal" }: BottomNavProps) {
  const keyboardOpen = useVirtualKeyboardOpen();

  return (
    <nav
      aria-label={label}
      hidden={keyboardOpen}
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-border bg-glass pb-[env(safe-area-inset-bottom)] shadow-overlay backdrop-blur-lg",
        "lg:inset-x-auto lg:right-(--bottom-nav-offset) lg:bottom-(--bottom-nav-offset) lg:rounded-full lg:border lg:border-border-strong lg:pb-0"
      )}
    >
      <ul className="m-0 mx-auto flex h-(--bottom-nav-height) max-w-xl list-none items-stretch justify-around gap-1 p-1.5 lg:gap-0">
        {items.map(({ href, label: itemLabel, icon: Icon, badge, ariaLabel }) => {
          const active = href === activeHref;
          // In-page anchors mark the current location; real routes mark the current page.
          const current = href.startsWith("#") ? "location" : "page";
          return (
            <li key={href} className="flex flex-1 lg:w-24 lg:flex-none">
              <a
                href={href}
                aria-current={active ? current : undefined}
                aria-label={ariaLabel}
                className={cn(
                  "relative mx-auto flex min-h-tap w-full max-w-24 flex-col items-center justify-center gap-0.5 rounded-full text-badge font-bold uppercase tracking-badge no-underline transition-colors",
                  active ? "bg-primary text-on-primary shadow-glow" : "text-muted hover:text-foreground"
                )}
              >
                <Icon aria-hidden="true" className="size-5" />
                <span>{itemLabel}</span>
                {badge ? (
                  <>
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute top-0.5 left-[calc(50%+0.4rem)] grid h-4 min-w-4 place-items-center rounded-full px-1 text-badge leading-none",
                        active ? "bg-on-primary text-primary" : "bg-primary text-on-primary"
                      )}
                    >
                      {badge}
                    </span>
                    {ariaLabel ? null : <span className="sr-only">{` (${badge})`}</span>}
                  </>
                ) : null}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
