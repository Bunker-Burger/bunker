"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// The button itself is the 44px target; the visible 48×28 track is drawn with ::before.
function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "group relative inline-flex h-tap w-14 shrink-0 cursor-pointer items-center rounded-full bg-transparent",
        "before:absolute before:inset-x-1 before:top-1/2 before:h-7 before:-translate-y-1/2 before:rounded-full before:border before:border-border-strong before:bg-surface-high before:transition-colors before:content-['']",
        "data-[state=checked]:before:border-primary data-[state=checked]:before:bg-primary disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="relative block size-5 translate-x-2 rounded-full bg-foreground transition-transform data-[state=checked]:translate-x-7 data-[state=checked]:bg-on-primary"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
