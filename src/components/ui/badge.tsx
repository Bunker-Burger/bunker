import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-badge font-bold uppercase tracking-[0.08em] [&_svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-accent-border bg-accent-soft text-primary",
        solid: "border-primary bg-primary text-on-primary",
        neutral: "border-border-strong bg-surface-high text-foreground",
        success: "border-success bg-success-soft text-success",
        soldOut: "border-danger bg-danger-soft text-danger-text"
      }
    },
    defaultVariants: { variant: "default" }
  }
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";
  return <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
