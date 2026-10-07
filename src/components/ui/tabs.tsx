"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn("-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]", className)}
      {...props}
    />
  );
}

function TabsTrigger({ className, onFocus, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      onFocus={(event) => {
        // The list scrolls horizontally; keep the focused tab fully visible.
        event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
        onFocus?.(event);
      }}
      className={cn(
        "min-h-tap shrink-0 cursor-pointer rounded-full border border-border-strong bg-surface px-4 text-body-sm font-bold uppercase tracking-label text-muted transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-on-primary data-[state=active]:shadow-glow",
        className
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn("pt-4", className)} {...props} />;
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
