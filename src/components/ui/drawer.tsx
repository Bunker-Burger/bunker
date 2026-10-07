"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { DialogCloseButton, DialogOverlay } from "./dialog";

// Bottom sheet on mobile, centered panel from `md` up. Built on Radix Dialog for focus trap and Escape.
const Drawer = DialogPrimitive.Root;
const DrawerTrigger = DialogPrimitive.Trigger;
const DrawerClose = DialogPrimitive.Close;

function DrawerContent({
  className,
  children,
  showClose = true,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { showClose?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="drawer-content"
        className={cn(
          "fixed inset-x-0 bottom-0 z-80 flex max-h-[94dvh] flex-col overflow-hidden rounded-t-xl border border-b-0 border-accent-border bg-surface-raised text-foreground shadow-overlay",
          "md:top-1/2 md:bottom-auto md:left-1/2 md:w-[calc(100%-4rem)] md:max-w-2xl md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl md:border-b",
          className
        )}
        {...props}
      >
        <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border-strong md:hidden" />
        {children}
        {showClose ? <DialogCloseButton /> : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function DrawerHeader({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="drawer-header" className={cn("grid gap-1 px-4 pt-4 pr-16", className)} {...props} />;
}

function DrawerBody({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="drawer-body" className={cn("min-h-0 flex-1 overflow-y-auto px-4 py-4", className)} {...props} />;
}

function DrawerFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn("flex gap-2 border-t border-border bg-glass px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]", className)}
      {...props}
    />
  );
}

function DrawerTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="drawer-title"
      className={cn("m-0 font-display text-headline-md font-bold uppercase", className)}
      {...props}
    />
  );
}

function DrawerDescription({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description data-slot="drawer-description" className={cn("m-0 text-body text-muted", className)} {...props} />;
}

export { Drawer, DrawerBody, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger };
