import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

function Container({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mx-auto w-full max-w-content px-4 md:px-6 lg:px-10", className)} {...props} />;
}

function SiteHeader({ className, children, ...props }: ComponentProps<"header">) {
  return (
    <header
      className={cn("sticky top-0 z-30 border-b border-border bg-glass pt-[env(safe-area-inset-top)] backdrop-blur-lg", className)}
      {...props}
    >
      <Container className="flex min-h-(--header-height) items-center justify-between gap-4">{children}</Container>
    </header>
  );
}

interface AppShellProps {
  header: ReactNode;
  bottomNav?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Mobile-first page frame: sticky header, centered content capped at `max-w-content`,
 * and room at the bottom for the single fixed BottomNav plus the device safe area.
 */
function AppShell({ header, bottomNav, children, className }: AppShellProps) {
  return (
    <div
      className={cn(
        "flex min-h-dvh flex-col",
        bottomNav ? "pb-(--fixed-bottom-clearance)" : "pb-[env(safe-area-inset-bottom)]",
        className
      )}
    >
      <a
        href="#contenido"
        className="sr-only z-50 rounded-full bg-primary font-bold text-on-primary focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:min-h-tap focus:px-4 focus:py-3"
      >
        Saltar al contenido
      </a>
      {header}
      <main id="contenido" tabIndex={-1} className="flex-1 outline-none">
        <Container>{children}</Container>
      </main>
      {bottomNav}
    </div>
  );
}

export { AppShell, Container, SiteHeader };
