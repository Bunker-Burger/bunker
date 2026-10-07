"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useVirtualKeyboardOpen } from "./use-virtual-keyboard";

export interface BottomNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
}

interface BottomNavProps {
  items: BottomNavItem[];
  activeHref?: string;
  label?: string;
}

/**
 * The app's only bottom bar: full-width with safe-area padding on mobile, floating pill on desktop.
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
        "lg:inset-x-auto lg:right-6 lg:bottom-6 lg:rounded-full lg:border lg:border-border-strong lg:pb-0"
      )}
    >
      <ul className="m-0 mx-auto flex h-(--bottom-nav-height) max-w-xl list-none items-stretch justify-around gap-1 p-1.5 lg:gap-0">
        {items.map(({ href, label: itemLabel, icon: Icon, badge }) => {
          const active = href === activeHref;
          return (
            <li key={href} className="flex flex-1 lg:w-24 lg:flex-none">
              <a
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-tap flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-badge font-bold uppercase tracking-[0.06em] no-underline transition-colors hover:text-foreground",
                  active ? "text-primary" : "text-muted"
                )}
              >
                <Icon aria-hidden="true" className="size-5" />
                <span>{itemLabel}</span>
                {badge ? (
                  <>
                    <span
                      aria-hidden="true"
                      className="absolute top-0.5 left-[calc(50%+0.4rem)] grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-badge leading-none text-on-primary"
                    >
                      {badge}
                    </span>
                    <span className="sr-only">{` (${badge})`}</span>
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
