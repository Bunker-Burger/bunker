"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      position="top-center"
      // Top: below the header. Bottom: above the bottom navigation and the cart tray.
      offset={{ top: "calc(var(--header-height) + 0.5rem)", bottom: "calc(var(--bottom-nav-height) + var(--bottom-nav-offset) + env(safe-area-inset-bottom) + 5rem)" }}
      mobileOffset={{ top: "calc(var(--header-height) + 0.5rem)", bottom: "calc(var(--bottom-nav-height) + var(--bottom-nav-offset) + env(safe-area-inset-bottom) + 5rem)" }}
      containerAriaLabel="Notificaciones"
      toastOptions={{
        unstyled: true,
        closeButtonAriaLabel: "Cerrar notificación",
        classNames: {
          toast: "flex w-full items-center gap-3 rounded-lg border border-accent-border bg-surface-raised p-4 text-body text-foreground shadow-overlay",
          title: "font-bold",
          description: "text-body-sm text-muted",
          actionButton: "ml-auto min-h-tap shrink-0 whitespace-nowrap rounded-full bg-primary px-4 text-body-sm font-bold uppercase text-on-primary",
          success: "border-success",
          error: "border-danger",
          icon: "text-primary"
        }
      }}
      {...props}
    />
  );
}

export { Toaster };
export { toast } from "sonner";
